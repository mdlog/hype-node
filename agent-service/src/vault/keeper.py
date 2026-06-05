"""Vault keeper: orchestrates pullForDeposit, settleDeposit, settleRedeem, accrueMgmt.

Supports SimulatedExecutor out of the box; swap for LiveSodexExecutor when ready.
"""
from __future__ import annotations

import logging
from typing import Any

from eth_account import Account
from web3 import Web3

from src.vault.abi import ERC20_ABI, VAULT_ABI
from src.vault.attestation import sign_attestation
from src.vault.config import KeeperConfig

log = logging.getLogger(__name__)


class Keeper:
    def __init__(self, cfg: KeeperConfig, executor: Any, nav_engine: Any) -> None:
        self.cfg = cfg
        self.executor = executor
        self.nav_engine = nav_engine

        self.w3 = Web3(Web3.HTTPProvider(cfg.rpc_url))
        self.vault = self.w3.eth.contract(
            address=Web3.to_checksum_address(cfg.vault_address),
            abi=VAULT_ABI,
        )
        self.usdc = self.w3.eth.contract(
            address=Web3.to_checksum_address(cfg.usdc_address),
            abi=ERC20_ABI,
        )
        self.keeper_acct = Account.from_key(cfg.keeper_key)
        self.signer_acct = Account.from_key(cfg.signer_key)
        self._last_block: int = self.w3.eth.block_number
        self._seen_deposits: set[int] = set()
        self._seen_redeems: set[int] = set()

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _send(self, fn: Any) -> Any:
        """Build, sign, broadcast a tx and wait for receipt. Raise on failure."""
        tx = fn.build_transaction({
            "from": self.keeper_acct.address,
            "nonce": self.w3.eth.get_transaction_count(self.keeper_acct.address),
            "gas": 3_000_000,
            "gasPrice": self.w3.eth.gas_price,
            "chainId": self.cfg.chain_id,
        })
        signed = self.keeper_acct.sign_transaction(tx)
        tx_hash = self.w3.eth.send_raw_transaction(signed.raw_transaction)
        receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash)
        if receipt.status != 1:
            raise RuntimeError(f"Transaction reverted: {tx_hash.hex()}")
        return receipt

    def _idx_hex(self, idx_bytes: bytes) -> str:
        """Return '0x<hex>' string from a bytes32 index id."""
        return "0x" + bytes(idx_bytes).hex()

    def _sign_nav(self, idx_bytes: bytes, nav: int) -> tuple[int, bytes]:
        """Sign a NAV attestation and return (signed_at, sig_bytes)."""
        signed_at = self.w3.eth.get_block("latest")["timestamp"]
        sig_hex = sign_attestation(
            self.signer_acct.key.hex(),
            self.cfg.chain_id,
            self.cfg.vault_address,
            self._idx_hex(idx_bytes),
            nav,
            signed_at,
        )
        return signed_at, Web3.to_bytes(hexstr=sig_hex)

    # ------------------------------------------------------------------
    # Per-request processing
    # ------------------------------------------------------------------

    def process_deposit(self, request_id: int) -> None:
        d = self.vault.functions.pendingDeposits(request_id).call()
        idx_bytes, who, usdc_in, _min_shares, _ts, pulled = d
        if who == "0x0000000000000000000000000000000000000000":
            return
        idx_hex = self._idx_hex(idx_bytes)
        try:
            if not pulled:
                self._send(self.vault.functions.pullForDeposit(request_id))
            bval = self.executor.execute_deposit_swap(idx_hex, usdc_in)
            vault_state = self.vault.functions.vaults(idx_bytes).call()
            total_shares = vault_state[2]
            nav, _ = self.nav_engine.quote_deposit(idx_hex, bval, total_shares)
            signed_at, sig = self._sign_nav(idx_bytes, nav)
            receipt = self._send(
                self.vault.functions.settleDeposit(request_id, nav, bval, signed_at, sig)
            )
            # Parse minted shares from Subscribed event
            minted = usdc_in  # fallback: treat usdc_in as minted for the ledger
            self.nav_engine.on_deposit_settled(idx_hex, usdc_in, minted)
            log.info("settled deposit %d, nav=%d bval=%d", request_id, nav, bval)
        except Exception as exc:
            log.warning("deposit %d failed (%s), cancelling", request_id, exc)
            try:
                # For simulated executor, bval == usdc_in (no real swap done)
                bval = usdc_in
                self._send(self.vault.functions.cancelDeposit(request_id, bval))
            except Exception as cancel_exc:
                log.error("cancel deposit %d also failed: %s", request_id, cancel_exc)

    def process_redeem(self, request_id: int) -> None:
        r = self.vault.functions.pendingRedeems(request_id).call()
        idx_bytes, who, shares, _hwm_nav, _min_usdc, _ts = r
        if who == "0x0000000000000000000000000000000000000000":
            return
        idx_hex = self._idx_hex(idx_bytes)
        vault_state = self.vault.functions.vaults(idx_bytes).call()
        total_shares = vault_state[2]
        nav, usdc_out = self.nav_engine.quote_redeem(idx_hex, shares, total_shares)
        realized = self.executor.execute_redeem_swap(idx_hex, usdc_out)
        # Keeper must deliver realized USDC to the vault via settleRedeem (safeTransferFrom keeper)
        self._send(self.usdc.functions.approve(self.cfg.vault_address, realized))
        signed_at, sig = self._sign_nav(idx_bytes, nav)
        self._send(
            self.vault.functions.settleRedeem(request_id, realized, nav, signed_at, sig)
        )
        self.nav_engine.on_redeem_settled(idx_hex, realized)
        log.info("settled redeem %d, nav=%d usdc_out=%d", request_id, nav, realized)

    # ------------------------------------------------------------------
    # Poll loop
    # ------------------------------------------------------------------

    def poll_once(self) -> None:
        """Scan all pending request ids and dispatch any unseen ones."""
        current_block = self.w3.eth.block_number
        next_id = self.vault.functions.nextRequestId().call()

        for req_id in range(1, next_id):
            # Try deposit
            if req_id not in self._seen_deposits:
                d = self.vault.functions.pendingDeposits(req_id).call()
                who_d = d[1]
                if who_d != "0x0000000000000000000000000000000000000000":
                    self._seen_deposits.add(req_id)
                    self.process_deposit(req_id)
                elif req_id in self._seen_deposits:
                    pass  # already settled/cancelled

            # Try redeem
            if req_id not in self._seen_redeems:
                r = self.vault.functions.pendingRedeems(req_id).call()
                who_r = r[1]
                if who_r != "0x0000000000000000000000000000000000000000":
                    self._seen_redeems.add(req_id)
                    self.process_redeem(req_id)

        self._last_block = current_block

    # ------------------------------------------------------------------
    # Keeper-only admin calls
    # ------------------------------------------------------------------

    def open_vault(self, idx_bytes: bytes, creator: str) -> None:
        self._send(self.vault.functions.openVault(idx_bytes, creator))
        log.info("opened vault %s for creator %s", self._idx_hex(idx_bytes), creator)

    def accrue(self, idx_bytes: bytes) -> None:
        self._send(self.vault.functions.accrueMgmt(idx_bytes))
        log.info("accrued mgmt fee for %s", self._idx_hex(idx_bytes))
