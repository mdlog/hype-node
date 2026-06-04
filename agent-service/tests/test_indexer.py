from src.vault.store import InMemoryStore
from src.vault.indexer import map_mgmt_accrued, map_redeemed, map_subscribed

PROP = {"id": "prop-uuid", "creator_address": "0xCreator", "on_chain_index_id": "0xidx"}

def _store():
    s = InMemoryStore(); s.add_proposal(PROP); return s

def test_mgmt_accrued_maps_to_mgmt_fee_usd():
    s = _store()
    row = map_mgmt_accrued(s, index_id="0xidx", fee_shares=10*10**18, last_nav=1_000_000,
                           aum_usd=1000.0, subscriber_count=1, tx_hash="0xtx", block_number=5)
    assert row["event_type"] == "mgmt_fee"
    assert row["proposal_id"] == "prop-uuid"
    assert row["creator_address"] == "0xCreator"
    assert abs(row["amount_usd"] - 10.0) < 1e-9
    assert row["subscriber_count"] == 1

def test_redeemed_maps_to_perf_fee_usd():
    s = _store()
    row = map_redeemed(s, index_id="0xidx", who="0xSub", perf_fee_usdc=100_000_000,
                       aum_usd=500.0, subscriber_count=1, tx_hash="0xtx", block_number=6)
    assert row["event_type"] == "perf_fee"
    assert abs(row["amount_usd"] - 100.0) < 1e-9

def test_subscribed_upserts_subscription():
    s = _store()
    map_subscribed(s, index_id="0xidx", who="0xSub", onchain_shares=123, status="active")
    subs = s.subscriptions_for_index("0xidx")
    assert len(subs) == 1 and subs[0]["subscriber_address"] == "0xSub" and subs[0]["shares"] == 123

def test_unknown_index_skips():
    s = _store()
    row = map_mgmt_accrued(s, index_id="0xUNKNOWN", fee_shares=1, last_nav=1, aum_usd=0,
                           subscriber_count=0, tx_hash="0x", block_number=1)
    assert row is None
