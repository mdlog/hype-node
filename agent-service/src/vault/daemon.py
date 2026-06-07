"""VaultDaemon — the always-on loop that makes the vault revenue loop run.

Each tick:
  1. reconcile_vaults  — open a vault on-chain for every published index whose
                         vault isn't active yet (openVault is keeper-only).
  2. settle            — keeper.poll_once(): pull+settle pending deposits and
                         settle pending redeems.
  3. rebalance_due     — [GATED] when VAULT_REBALANCE_ENABLED=true and the
                         per-index daily cadence allows, call keeper.rebalance_once
                         to diff target(pb_proposals) → trades → updateNav.
  4. accrue_due        — accrue the 1%/yr mgmt fee for each active vault
                         (contract is idempotent per UTC day; reverts are
                         swallowed).
  5. index_new_blocks  — read vault events from the persisted block checkpoint
                         to the confirmed head and write pb_earnings /
                         pb_subscriptions (idempotent), then advance the
                         checkpoint.

This is the missing piece between "contract + keeper class exist + tested" and
"a subscriber's deposit actually mints shares and a creator actually earns".
Run it as a long-lived process (see scripts/run_keeper.py).
"""
from __future__ import annotations

import logging
import os
import time
from datetime import datetime, timezone

from web3 import Web3

log = logging.getLogger(__name__)

# Rebalance env gate — also checked inside keeper.rebalance_once, but we read
# it here to guard the per-index daily cadence tracking in daemon.
_REBALANCE_ENABLED = os.getenv("VAULT_REBALANCE_ENABLED", "false").lower() in {"true", "1", "yes"}

CHECKPOINT_KEY = "vault_earnings_indexer"
ZERO = "0x0000000000000000000000000000000000000000"


class VaultDaemon:
    def __init__(
        self,
        keeper,
        indexer,
        store,
        *,
        deploy_block: int = 0,
        confirmations: int = 1,
        poll_interval: int = 30,
        max_block_span: int = 5_000,
    ) -> None:
        self.keeper = keeper
        self.indexer = indexer
        self.store = store
        self.deploy_block = deploy_block
        self.confirmations = max(0, confirmations)
        self.poll_interval = poll_interval
        self.max_block_span = max_block_span
        # Per-index daily rebalance cadence: {index_id: utc_date_str}
        # Prevents churning multiple times in the same UTC day.
        self._last_rebalance_day: dict[str, str] = {}

    # -- helpers --------------------------------------------------------
    @property
    def w3(self):
        return self.keeper.w3

    @property
    def vault(self):
        return self.keeper.vault

    def _idx_bytes(self, idx_hex: str) -> bytes:
        return Web3.to_bytes(hexstr=idx_hex)

    # -- steps ----------------------------------------------------------
    def reconcile_vaults(self) -> int:
        """Open a vault for each published index that isn't active yet."""
        opened = 0
        for p in self.store.published_indices():
            idx_hex = p.get("on_chain_index_id")
            creator = p.get("creator_address")
            if not idx_hex or not creator:
                continue
            idx_bytes = self._idx_bytes(idx_hex)
            try:
                state = self.vault.functions.vaults(idx_bytes).call()
                if not state[0]:  # not active
                    self.keeper.open_vault(idx_bytes, Web3.to_checksum_address(creator))
                    opened += 1
            except Exception as exc:  # noqa: BLE001 — one bad index can't stop the loop
                log.warning("reconcile vault %s failed: %s", idx_hex, exc)
        return opened

    def accrue_due(self) -> int:
        """Accrue mgmt fee for each active vault. Idempotent per day on-chain."""
        accrued = 0
        for p in self.store.published_indices():
            idx_hex = p.get("on_chain_index_id")
            if not idx_hex:
                continue
            idx_bytes = self._idx_bytes(idx_hex)
            try:
                state = self.vault.functions.vaults(idx_bytes).call()
                if not state[0]:
                    continue
                self.keeper.accrue(idx_bytes)
                accrued += 1
            except Exception as exc:  # already accrued today / inactive → skip
                log.debug("accrue %s skipped: %s", idx_hex, exc)
        return accrued

    def index_new_blocks(self) -> dict:
        """Ingest vault events from checkpoint+1 .. confirmed head."""
        head = self.w3.eth.block_number - self.confirmations
        if head < 0:
            return {}
        last = self.store.get_checkpoint(CHECKPOINT_KEY)
        if last is None:
            last = max(self.deploy_block - 1, -1)
        if head <= last:
            return {}
        from_block = last + 1
        # Bound the span so the first catch-up after a long downtime doesn't
        # request an unbounded log range from the RPC.
        to_block = min(head, from_block + self.max_block_span - 1)
        counts = self.indexer.index_range(from_block, to_block)
        self.store.set_checkpoint(CHECKPOINT_KEY, to_block)
        log.info("indexed blocks %d..%d → %s", from_block, to_block, counts)
        return counts

    def rebalance_due(self) -> int:
        """Rebalance each active vault at most once per UTC day.

        Env-gated: no-ops when VAULT_REBALANCE_ENABLED is not truthy.
        Exceptions per-index are swallowed so one bad index can't block others.
        """
        if not _REBALANCE_ENABLED:
            return 0

        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        rebalanced = 0

        for p in self.store.published_indices():
            idx_hex = p.get("on_chain_index_id")
            if not idx_hex:
                continue

            # Daily cadence guard — skip if already rebalanced today.
            if self._last_rebalance_day.get(idx_hex) == today:
                log.debug("rebalance_due: %s already rebalanced today (%s)", idx_hex, today)
                continue

            try:
                trades = self.keeper.rebalance_once(idx_hex, self.store)
                self._last_rebalance_day[idx_hex] = today
                rebalanced += 1
                log.info(
                    "rebalance_due: %s rebalanced on %s (%d trades)",
                    idx_hex, today, len(trades),
                )
            except Exception as exc:  # noqa: BLE001
                log.warning("rebalance_due: %s failed: %s", idx_hex, exc)

        return rebalanced

    def tick(self) -> dict:
        self.reconcile_vaults()
        # Pass the store so process_deposit can check pb_cancel_requests
        # before pulling — if the subscriber has requested cancellation the
        # keeper honors it (cancelDeposit instead of pull+settle).
        self.keeper.poll_once(store=self.store)
        self.rebalance_due()   # after settlement, before accrue — gated by VAULT_REBALANCE_ENABLED
        self.accrue_due()
        return self.index_new_blocks()

    def run(self) -> None:
        log.info(
            "VaultDaemon started (interval=%ds, confirmations=%d, deploy_block=%d)",
            self.poll_interval, self.confirmations, self.deploy_block,
        )
        while True:
            try:
                self.tick()
            except Exception as exc:  # noqa: BLE001 — never let one tick kill the daemon
                log.exception("tick failed: %s", exc)
            time.sleep(self.poll_interval)
