"""Unit tests for earnings idempotency + VaultDaemon orchestration (no chain)."""
from src.vault.store import InMemoryStore
from src.vault.indexer import map_mgmt_accrued
from src.vault.daemon import VaultDaemon, CHECKPOINT_KEY

IDX = "0x" + "11" * 32
CREATOR = "0x" + "22" * 20
PROP = {"id": "p1", "creator_address": CREATOR, "on_chain_index_id": IDX, "status": "live"}


# ---- idempotency -----------------------------------------------------------

def test_earning_insert_is_idempotent_on_tx_event_proposal():
    s = InMemoryStore()
    s.add_proposal(PROP)
    for _ in range(3):
        map_mgmt_accrued(s, index_id=IDX, fee_shares=10**18, last_nav=1_000_000,
                         aum_usd=100.0, subscriber_count=1, tx_hash="0xabc", block_number=7)
    assert len(s.earnings) == 1  # deduped


def test_earning_dedupe_is_per_event_type():
    s = InMemoryStore()
    s.add_proposal(PROP)
    map_mgmt_accrued(s, index_id=IDX, fee_shares=1, last_nav=1, aum_usd=0,
                     subscriber_count=0, tx_hash="0xsame", block_number=1)
    # same tx + proposal but a different event_type is a distinct row
    s.insert_earning({"tx_hash": "0xsame", "event_type": "perf_fee", "proposal_id": "p1", "amount_usd": 5})
    assert len(s.earnings) == 2


def test_earning_without_tx_hash_is_not_deduped():
    s = InMemoryStore()
    # manual rows (no tx_hash) must not collapse into one
    s.insert_earning({"tx_hash": None, "event_type": "manual", "proposal_id": "p1", "amount_usd": 1})
    s.insert_earning({"tx_hash": None, "event_type": "manual", "proposal_id": "p1", "amount_usd": 2})
    assert len(s.earnings) == 2


def test_published_indices_filters_by_status():
    s = InMemoryStore()
    s.add_proposal(PROP)  # status live
    s.add_proposal({"id": "p2", "creator_address": CREATOR, "on_chain_index_id": "0x" + "33" * 32, "status": "draft"})
    out = s.published_indices()
    assert [p["id"] for p in out] == ["p1"]  # draft excluded


# ---- daemon fakes ----------------------------------------------------------

class _Eth:
    def __init__(self, block_number):
        self.block_number = block_number


class _W3:
    def __init__(self, block_number):
        self.eth = _Eth(block_number)


class _Fn:
    def __init__(self, val):
        self._val = val

    def call(self):
        return self._val


class _VaultFns:
    def __init__(self, active_by_idx):
        self._active = active_by_idx

    def vaults(self, idx_bytes):
        active = self._active.get(bytes(idx_bytes), False)
        return _Fn([active, CREATOR, 0, 0, 0, 0, 0])


class _Vault:
    def __init__(self, active_by_idx):
        self.functions = _VaultFns(active_by_idx)


class _Keeper:
    def __init__(self, block_number, active_by_idx):
        self.w3 = _W3(block_number)
        self.vault = _Vault(active_by_idx)
        self._active = active_by_idx
        self.opened = []
        self.accrued = []
        self.polled = 0

    def open_vault(self, idx_bytes, creator):
        self._active[bytes(idx_bytes)] = True
        self.opened.append((bytes(idx_bytes), creator))

    def accrue(self, idx_bytes):
        self.accrued.append(bytes(idx_bytes))

    def poll_once(self):
        self.polled += 1


class _Indexer:
    def __init__(self):
        self.calls = []

    def index_range(self, a, b):
        self.calls.append((a, b))
        return {"mgmt_fee": 0, "perf_fee": 0, "subscriptions": 0}


def _store():
    s = InMemoryStore()
    s.add_proposal(PROP)
    return s


# ---- daemon behavior -------------------------------------------------------

def test_reconcile_opens_inactive_vault_then_is_noop():
    k = _Keeper(block_number=1000, active_by_idx={})
    d = VaultDaemon(k, _Indexer(), _store(), deploy_block=0, confirmations=2)
    assert d.reconcile_vaults() == 1
    assert len(k.opened) == 1
    # second pass: vault now active → nothing to open
    assert d.reconcile_vaults() == 0


def test_accrue_due_only_for_active_vaults():
    k = _Keeper(block_number=1000, active_by_idx={})  # inactive
    d = VaultDaemon(k, _Indexer(), _store())
    assert d.accrue_due() == 0
    d.reconcile_vaults()  # activates it
    assert d.accrue_due() == 1


def test_index_new_blocks_advances_checkpoint():
    s = _store()
    idxr = _Indexer()
    k = _Keeper(block_number=1000, active_by_idx={})
    d = VaultDaemon(k, idxr, s, deploy_block=100, confirmations=2)
    counts = d.index_new_blocks()
    # head = 1000 - 2 = 998; from = deploy_block = 100
    assert idxr.calls == [(100, 998)]
    assert s.get_checkpoint(CHECKPOINT_KEY) == 998
    assert counts == {"mgmt_fee": 0, "perf_fee": 0, "subscriptions": 0}


def test_index_new_blocks_skips_when_no_new_blocks():
    s = _store()
    idxr = _Indexer()
    k = _Keeper(block_number=1000, active_by_idx={})
    d = VaultDaemon(k, idxr, s, confirmations=2)
    s.set_checkpoint(CHECKPOINT_KEY, 998)  # == head
    assert d.index_new_blocks() == {}
    assert idxr.calls == []


def test_index_new_blocks_bounds_span():
    s = _store()
    idxr = _Indexer()
    k = _Keeper(block_number=1_000_000, active_by_idx={})
    d = VaultDaemon(k, idxr, s, deploy_block=0, confirmations=0, max_block_span=5_000)
    d.index_new_blocks()
    # from = 0, capped to from + max_span - 1 = 4999 (not the full head)
    assert idxr.calls == [(0, 4999)]
    assert s.get_checkpoint(CHECKPOINT_KEY) == 4999
