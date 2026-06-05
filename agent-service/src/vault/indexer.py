"""Map HypeIndexVault events to Supabase rows. Pure mappers are unit-tested;
the VaultIndexer (Task 2C) reads events from chain and drives them through a store."""
from typing import Optional
from .store import IndexerStore


class VaultIndexer:
    """Reads HypeIndexVault events over a block range and writes rows via an IndexerStore.
    Subscription shares mirror on-chain positions(); mgmt-fee USD uses vaults().lastNav."""

    def __init__(self, w3, vault, store):
        self.w3 = w3
        self.vault = vault
        self.store = store

    def _idx_hex(self, idx_bytes) -> str:
        return "0x" + bytes(idx_bytes).hex()

    def _last_nav(self, idx_bytes) -> int:
        return self.vault.functions.vaults(idx_bytes).call()[6]

    def _aum_and_count(self, idx_hex: str, last_nav: int):
        subs = [s for s in self.store.subscriptions_for_index(idx_hex) if s.get("status") == "active"]
        aum = sum(int(s["shares"]) for s in subs) * last_nav / 1e18 / 1e6
        return aum, len(subs)

    def index_range(self, from_block: int, to_block: int) -> dict:
        """Collect Subscribed, Redeemed, MgmtAccrued logs in [from_block, to_block],
        ordered by (blockNumber, logIndex), and process each into store rows."""
        from web3.exceptions import MismatchedABI

        # Gather all raw logs from vault address
        raw_logs = self.w3.eth.get_logs({
            "address": self.vault.address,
            "fromBlock": from_block,
            "toBlock": to_block,
        })

        # Map event name → contract event object
        event_map = {
            "Subscribed": self.vault.events.Subscribed(),
            "Redeemed": self.vault.events.Redeemed(),
            "MgmtAccrued": self.vault.events.MgmtAccrued(),
        }

        # Decode each log — try each event type until one matches
        decoded_events = []
        for log in raw_logs:
            for name, ev_obj in event_map.items():
                try:
                    decoded = ev_obj.process_log(log)
                    decoded_events.append((name, decoded))
                    break
                except (MismatchedABI, Exception):
                    continue

        # Sort by (blockNumber, logIndex)
        decoded_events.sort(key=lambda x: (x[1]["blockNumber"], x[1]["logIndex"]))

        counts = {"mgmt_fee": 0, "perf_fee": 0, "subscriptions": 0}

        for name, ev in decoded_events:
            if name == "Subscribed":
                idx_bytes = ev.args.indexId
                idx_hex = self._idx_hex(idx_bytes)
                who = ev.args.who
                shares = self.vault.functions.positions(idx_bytes, who).call()[0]
                map_subscribed(self.store, idx_hex, who, shares, "active")
                counts["subscriptions"] += 1

            elif name == "Redeemed":
                idx_bytes = ev.args.indexId
                idx_hex = self._idx_hex(idx_bytes)
                who = ev.args.who
                shares = self.vault.functions.positions(idx_bytes, who).call()[0]
                status = "redeemed" if shares == 0 else "active"
                map_subscribed(self.store, idx_hex, who, shares, status)
                last_nav = self._last_nav(idx_bytes)
                aum, count = self._aum_and_count(idx_hex, last_nav)
                map_redeemed(
                    self.store, idx_hex, who, ev.args.perfFeeUsdc,
                    aum, count, ev.transactionHash.hex(), ev.blockNumber,
                )
                counts["perf_fee"] += 1

            elif name == "MgmtAccrued":
                idx_bytes = ev.args.indexId
                idx_hex = self._idx_hex(idx_bytes)
                last_nav = self._last_nav(idx_bytes)
                aum, count = self._aum_and_count(idx_hex, last_nav)
                map_mgmt_accrued(
                    self.store, idx_hex, ev.args.feeShares, last_nav,
                    aum, count, ev.transactionHash.hex(), ev.blockNumber,
                )
                counts["mgmt_fee"] += 1

        return counts

def map_mgmt_accrued(store: IndexerStore, index_id: str, fee_shares: int, last_nav: int,
                     aum_usd: float, subscriber_count: int, tx_hash: str, block_number: int) -> Optional[dict]:
    prop = store.proposal_for_index(index_id)
    if not prop:
        return None
    amount_usd = fee_shares * last_nav / 1e18 / 1e6
    row = {"proposal_id": prop["id"], "creator_address": prop["creator_address"],
           "event_type": "mgmt_fee", "amount_usd": amount_usd, "tx_hash": tx_hash,
           "block_number": block_number, "aum_usd_at_accrual": aum_usd, "subscriber_count": subscriber_count}
    store.insert_earning(row)
    return row

def map_redeemed(store: IndexerStore, index_id: str, who: str, perf_fee_usdc: int,
                 aum_usd: float, subscriber_count: int, tx_hash: str, block_number: int) -> Optional[dict]:
    prop = store.proposal_for_index(index_id)
    if not prop:
        return None
    row = {"proposal_id": prop["id"], "creator_address": prop["creator_address"],
           "event_type": "perf_fee", "amount_usd": perf_fee_usdc / 1e6, "tx_hash": tx_hash,
           "block_number": block_number, "aum_usd_at_accrual": aum_usd, "subscriber_count": subscriber_count}
    store.insert_earning(row)
    return row

def map_subscribed(store: IndexerStore, index_id: str, who: str, onchain_shares: int, status: str) -> Optional[dict]:
    prop = store.proposal_for_index(index_id)
    if not prop:
        return None
    row = {"proposal_id": prop["id"], "index_id": index_id, "subscriber_address": who,
           "shares": onchain_shares, "status": status}
    store.upsert_subscription(row)
    return row
