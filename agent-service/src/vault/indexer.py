"""Map HypeIndexVault events to Supabase rows. Pure mappers are unit-tested;
the VaultIndexer (Task 2C) reads events from chain and drives them through a store."""
from typing import Optional
from .store import IndexerStore

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
