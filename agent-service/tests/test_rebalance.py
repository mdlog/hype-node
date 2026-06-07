"""TDD tests for diff_basket (pure), should_cancel_before_pull (pure),
and keeper rebalance orchestration.

These tests are written FIRST; run them before implementation to see them fail,
then implement to pass.  The orchestration tests use fake executor + fake store.
"""
import pytest
from src.vault.rebalance import diff_basket, should_cancel_before_pull


# ── diff_basket pure tests ────────────────────────────────────────────────────

def test_diff_basket_60_40_to_40_60():
    """Classic 2-asset rebalance: BTC over-weight, ETH under-weight."""
    current_value = {"BTC": 6_000.0, "ETH": 4_000.0}   # 60/40 portfolio
    target_weights = {"BTC": 0.40, "ETH": 0.60}          # flip to 40/60
    total = 10_000.0

    trades = diff_basket(current_value, target_weights, total)

    # Sells must come before buys
    sell_idx = next(i for i, t in enumerate(trades) if t["side"] == "sell")
    buy_idx  = next(i for i, t in enumerate(trades) if t["side"] == "buy")
    assert sell_idx < buy_idx, "sells must precede buys"

    sell = next(t for t in trades if t["side"] == "sell")
    buy  = next(t for t in trades if t["side"] == "buy")

    assert sell["symbol"] == "BTC"
    assert abs(sell["usdc_amount"] - 2_000.0) < 1e-6

    assert buy["symbol"] == "ETH"
    assert abs(buy["usdc_amount"] - 2_000.0) < 1e-6


def test_diff_basket_below_threshold_no_trade():
    """Drift below threshold_bps → no trade generated."""
    # Total = 10_000, target 50/50, current 50.04/49.96 = 4 bps drift
    current_value = {"A": 5_004.0, "B": 4_996.0}
    target_weights = {"A": 0.50, "B": 0.50}
    total = 10_000.0

    trades = diff_basket(current_value, target_weights, total, threshold_bps=50)
    assert trades == [], f"expected no trades for sub-threshold drift, got {trades}"


def test_diff_basket_new_symbol_buy():
    """A symbol in target_weights that isn't in current_value → full buy."""
    current_value = {"BTC": 10_000.0}
    target_weights = {"BTC": 0.80, "SOL": 0.20}
    total = 10_000.0

    trades = diff_basket(current_value, target_weights, total)
    symbols = [t["symbol"] for t in trades]
    assert "SOL" in symbols
    sol_trade = next(t for t in trades if t["symbol"] == "SOL")
    assert sol_trade["side"] == "buy"
    assert abs(sol_trade["usdc_amount"] - 2_000.0) < 1e-6


def test_diff_basket_dropped_symbol_full_sell():
    """A symbol in current_value with 0 target weight → full sell."""
    current_value = {"BTC": 8_000.0, "DOGE": 2_000.0}
    target_weights = {"BTC": 1.0}           # DOGE dropped
    total = 10_000.0

    trades = diff_basket(current_value, target_weights, total)
    doge_trades = [t for t in trades if t["symbol"] == "DOGE"]
    assert len(doge_trades) == 1
    assert doge_trades[0]["side"] == "sell"
    assert abs(doge_trades[0]["usdc_amount"] - 2_000.0) < 1e-6


def test_diff_basket_sells_before_buys_multi_asset():
    """In multi-asset rebalances all sells must appear before any buy."""
    current_value = {"A": 5000.0, "B": 3000.0, "C": 2000.0}
    target_weights = {"A": 0.30, "B": 0.40, "C": 0.30}
    total = 10_000.0

    trades = diff_basket(current_value, target_weights, total)
    sides = [t["side"] for t in trades]
    # Once we see a buy, all subsequent entries must also be buys
    seen_buy = False
    for side in sides:
        if side == "buy":
            seen_buy = True
        assert not (seen_buy and side == "sell"), "sell appeared after buy"


def test_diff_basket_above_threshold_trade():
    """Drift above threshold_bps must produce a trade."""
    # 100 bps drift on a 10_000 portfolio = 10 USDC imbalance; threshold=50 bps
    current_value = {"A": 5_100.0, "B": 4_900.0}
    target_weights = {"A": 0.50, "B": 0.50}
    total = 10_000.0

    trades = diff_basket(current_value, target_weights, total, threshold_bps=50)
    assert len(trades) == 2  # sell A and buy B


def test_diff_basket_exact_balance_no_trade():
    """Exactly balanced portfolio → no trades regardless of threshold."""
    current_value = {"A": 5_000.0, "B": 5_000.0}
    target_weights = {"A": 0.50, "B": 0.50}
    total = 10_000.0

    trades = diff_basket(current_value, target_weights, total)
    assert trades == []


# ── should_cancel_before_pull pure tests ─────────────────────────────────────

def test_should_cancel_returns_true_when_id_in_set():
    assert should_cancel_before_pull(42, {42, 99}) is True


def test_should_cancel_returns_false_when_id_not_in_set():
    assert should_cancel_before_pull(7, {42, 99}) is False


def test_should_cancel_returns_false_for_empty_set():
    assert should_cancel_before_pull(1, set()) is False


def test_should_cancel_type_strict_int_match():
    """deposit_id is always int — set lookup must match."""
    assert should_cancel_before_pull(5, {5}) is True
    assert should_cancel_before_pull(0, {0}) is True


# ── Rebalance orchestration tests (fake executor + fake store) ────────────────

from src.vault.rebalance import rebalance_once

IDX = "0x" + "ab" * 32
TOTAL_USDC = 10_000


class FakeExecutor:
    """Simulated executor that records trade calls and returns passed-through value."""
    def __init__(self):
        self.deposit_calls: list[tuple] = []
        self.redeem_calls: list[tuple] = []

    def execute_deposit_swap(self, index_id: str, usdc_in: int) -> int:
        self.deposit_calls.append((index_id, usdc_in))
        return usdc_in

    def execute_redeem_swap(self, index_id: str, usdc_target: int) -> int:
        self.redeem_calls.append((index_id, usdc_target))
        return usdc_target


class FakeNavEngine:
    """Simple nav engine that tracks basket value."""
    def __init__(self, basket_usdc: int):
        self._basket: dict[str, int] = {}
        self._total = basket_usdc

    def basket_usd(self, index_id: str) -> int:
        return self._total


class FakeVault:
    """Records updateNav calls."""
    def __init__(self):
        self.update_nav_calls: list[tuple] = []

    def updateNav(self, index_id_bytes, nav, signed_at, sig):
        self.update_nav_calls.append((index_id_bytes, nav, signed_at, sig))
        return self  # fluent for chaining in tests

    def build_transaction(self, _tx_dict):
        return {}


class FakeKeeper:
    """Fake keeper exposing _sign_nav and vault.functions.updateNav."""
    def __init__(self):
        self.vault = _FakeVaultContract()
        self._sign_nav_calls: list[tuple] = []
        self._nav_counter = 1_000_000

    def _sign_nav(self, idx_bytes: bytes, nav: int) -> tuple[int, bytes]:
        self._sign_nav_calls.append((idx_bytes, nav))
        return 9999, b"\x00" * 65

    def _send(self, fn):
        fn._called = True
        return fn


class _FakeVaultFns:
    def __init__(self):
        self.update_nav_calls: list[tuple] = []

    def updateNav(self, idx_bytes, nav, signed_at, sig):
        self.update_nav_calls.append((idx_bytes, nav, signed_at, sig))
        return self


class _FakeVaultContract:
    def __init__(self):
        self.functions = _FakeVaultFns()


def _make_proposal(constituents: dict) -> dict:
    """Build a fake pb_proposals row with the given weights as constituents list."""
    return {
        "on_chain_index_id": IDX,
        "creator_address": "0x" + "aa" * 20,
        "status": "live",
        "constituents": [
            {"symbol": sym, "weight": w}
            for sym, w in constituents.items()
        ],
    }


def _make_store(proposal: dict, basket_value: dict[str, float]):
    """Return a fake store-like object with proposal_for_index returning proposal."""
    class FakeStore:
        def proposal_for_index(self, index_id: str):
            return proposal

    return FakeStore()


def test_rebalance_once_generates_trades_and_calls_update_nav():
    """Full orchestration: 60/40 → 40/60 with fakes → updateNav is called."""
    proposal = _make_proposal({"BTC": 0.40, "ETH": 0.60})
    current_basket = {"BTC": 6_000.0, "ETH": 4_000.0}
    store = _make_store(proposal, current_basket)

    keeper = FakeKeeper()
    executor = FakeExecutor()

    trades, nav_called = rebalance_once(
        index_id=IDX,
        store=store,
        keeper=keeper,
        executor=executor,
        current_basket=current_basket,
        total_value_usdc=10_000.0,
    )

    # Should produce 2 trades (sell BTC, buy ETH)
    assert len(trades) == 2
    sell = next(t for t in trades if t["side"] == "sell")
    buy  = next(t for t in trades if t["side"] == "buy")
    assert sell["symbol"] == "BTC"
    assert buy["symbol"] == "ETH"

    # updateNav must have been invoked
    assert nav_called, "updateNav was not called after rebalance"


def test_rebalance_once_no_trades_no_update_nav_call():
    """When basket already matches target → no trades, updateNav still called (checkpoint)."""
    proposal = _make_proposal({"BTC": 0.50, "ETH": 0.50})
    current_basket = {"BTC": 5_000.0, "ETH": 5_000.0}
    store = _make_store(proposal, current_basket)

    keeper = FakeKeeper()
    executor = FakeExecutor()

    trades, nav_called = rebalance_once(
        index_id=IDX,
        store=store,
        keeper=keeper,
        executor=executor,
        current_basket=current_basket,
        total_value_usdc=10_000.0,
    )

    assert trades == []
    # updateNav is called even when no trades (NAV checkpoint is always valuable)
    assert nav_called


def test_rebalance_once_missing_proposal_is_noop():
    """When proposal_for_index returns None → no trades, no crash."""
    class EmptyStore:
        def proposal_for_index(self, index_id: str):
            return None

    keeper = FakeKeeper()
    executor = FakeExecutor()

    trades, nav_called = rebalance_once(
        index_id=IDX,
        store=EmptyStore(),
        keeper=keeper,
        executor=executor,
        current_basket={"BTC": 5_000.0},
        total_value_usdc=5_000.0,
    )

    assert trades == []
    assert not nav_called


# ── VaultDaemon rebalance_due orchestration tests ─────────────────────────────
# These tests inject fake executor + store and assert the trade list and that
# updateNav is eventually invoked.  Uses monkeypatching of VAULT_REBALANCE_ENABLED
# so the gate is bypassed in tests without changing real env.

from unittest.mock import patch
from src.vault.daemon import VaultDaemon


PROP_LIVE = {
    "id": "p1",
    "creator_address": "0x" + "aa" * 20,
    "on_chain_index_id": IDX,
    "status": "live",
    "constituents": [
        {"symbol": "BTC", "weight": 0.40},
        {"symbol": "ETH", "weight": 0.60},
    ],
}


class _DaemonFakeW3:
    class eth:
        block_number = 1000

        @staticmethod
        def get_block(_):
            return {"timestamp": 9999}


class _DaemonFakeVaultFns:
    def __init__(self):
        self.update_nav_calls: list = []

    def vaults(self, idx_bytes):
        class _F:
            def call(self_):
                return [True, "0x" + "aa" * 20, 0, 0, 0, 0, 0]
        return _F()

    def updateNav(self, idx_bytes, nav, signed_at, sig):
        self.update_nav_calls.append((idx_bytes, nav, signed_at, sig))
        return self


class _DaemonFakeVaultContract:
    def __init__(self):
        self.functions = _DaemonFakeVaultFns()


class _DaemonFakeNavEngine:
    def basket_usd(self, index_id: str) -> int:
        return 10_000  # simulated total basket value


class _DaemonFakeKeeper:
    """Keeper-like object for daemon tests — records rebalance_once calls."""
    def __init__(self):
        self.w3 = _DaemonFakeW3()
        self.vault = _DaemonFakeVaultContract()
        self.nav_engine = _DaemonFakeNavEngine()
        self.executor = FakeExecutor()
        self.rebalance_calls: list[str] = []
        self._sign_nav_calls: list = []

    def poll_once(self, store=None):
        pass

    def open_vault(self, idx_bytes, creator):
        pass

    def accrue(self, idx_bytes):
        pass

    def _sign_nav(self, idx_bytes: bytes, nav: int) -> tuple[int, bytes]:
        self._sign_nav_calls.append((idx_bytes, nav))
        return 9999, b"\x00" * 65

    def _send(self, fn):
        if hasattr(fn, "_called"):
            fn._called = True
        return fn

    def rebalance_once(self, index_id: str, store) -> list[dict]:
        self.rebalance_calls.append(index_id)
        return [{"symbol": "BTC", "side": "sell", "usdc_amount": 2000.0}]


class _DaemonFakeStore:
    def published_indices(self):
        return [PROP_LIVE]

    def proposal_for_index(self, index_id: str):
        return PROP_LIVE

    def get_checkpoint(self, key: str):
        return 999

    def set_checkpoint(self, key: str, block: int):
        pass


class _DaemonFakeIndexer:
    def index_range(self, a, b):
        return {}


def test_daemon_rebalance_due_calls_keeper_when_enabled():
    """When VAULT_REBALANCE_ENABLED=true, daemon.rebalance_due calls keeper.rebalance_once."""
    keeper = _DaemonFakeKeeper()
    store = _DaemonFakeStore()
    d = VaultDaemon(keeper, _DaemonFakeIndexer(), store)

    with patch("src.vault.daemon._REBALANCE_ENABLED", True):
        count = d.rebalance_due()

    assert count == 1
    assert IDX in keeper.rebalance_calls


def test_daemon_rebalance_due_skips_when_disabled():
    """When VAULT_REBALANCE_ENABLED is off (default), rebalance_due is a no-op."""
    keeper = _DaemonFakeKeeper()
    store = _DaemonFakeStore()
    d = VaultDaemon(keeper, _DaemonFakeIndexer(), store)

    with patch("src.vault.daemon._REBALANCE_ENABLED", False):
        count = d.rebalance_due()

    assert count == 0
    assert keeper.rebalance_calls == []


def test_daemon_rebalance_due_daily_cadence():
    """rebalance_due does not re-run the same index on the same UTC day."""
    keeper = _DaemonFakeKeeper()
    store = _DaemonFakeStore()
    d = VaultDaemon(keeper, _DaemonFakeIndexer(), store)

    with patch("src.vault.daemon._REBALANCE_ENABLED", True):
        first = d.rebalance_due()
        second = d.rebalance_due()  # same day → should skip

    assert first == 1
    assert second == 0   # already rebalanced today
    assert len(keeper.rebalance_calls) == 1  # only called once


def test_daemon_tick_includes_rebalance_step():
    """daemon.tick with rebalance enabled → rebalance_once is invoked mid-tick."""
    keeper = _DaemonFakeKeeper()
    store = _DaemonFakeStore()
    d = VaultDaemon(keeper, _DaemonFakeIndexer(), store, confirmations=0)

    with patch("src.vault.daemon._REBALANCE_ENABLED", True):
        d.tick()

    assert IDX in keeper.rebalance_calls


# ── Keeper cancel-before-pull integration test ────────────────────────────────

from src.vault.store import InMemoryStore


class _CancelFakeVaultFns:
    """Fake vault functions that record pull/cancel/settle calls."""
    def __init__(self, pulled=False):
        self.pulled = pulled
        self.pull_calls: list[int] = []
        self.cancel_calls: list[tuple] = []
        self.settle_calls: list[int] = []
        self._owner = None  # back-reference set after construction

    def pendingDeposits(self, req_id):
        pulled = self.pulled
        idx_bytes = bytes(32)
        who = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"
        result = (idx_bytes, who, 1_000_000, 0, 0, pulled)
        # Return a callable object whose .call() returns the tuple
        class _R:
            def call(_self): return result
        return _R()

    def pullForDeposit(self, req_id):
        self.pull_calls.append(req_id)
        self.pulled = True  # mark as pulled after the call
        class _R:
            def build_transaction(_self, _tx): return {}
        return _R()

    def cancelDeposit(self, req_id, returned):
        self.cancel_calls.append((req_id, returned))
        class _R:
            def build_transaction(_self, _tx): return {}
        return _R()

    def settleDeposit(self, req_id, nav, bval, signed_at, sig):
        self.settle_calls.append(req_id)
        class _R:
            def build_transaction(_self, _tx): return {}
        return _R()

    def build_transaction(self, _):
        return {}

    def nextRequestId(self):
        outer_self = self
        class _R:
            def call(_self): return 2  # one deposit (id=1)
        return _R()


class _CancelFakeVaultContract:
    def __init__(self, pulled=False):
        self.functions = _CancelFakeVaultFns(pulled=pulled)


class _CancelFakeW3:
    class eth:
        block_number = 100

        @staticmethod
        def get_block(_): return {"timestamp": 9999}

        @staticmethod
        def gas_price(): return 1

        @staticmethod
        def get_transaction_count(_): return 0

        @staticmethod
        def send_raw_transaction(_): return b"\x00" * 32

        @staticmethod
        def wait_for_transaction_receipt(_):
            class R:
                status = 1
            return R()


def _make_cancel_keeper(pulled=False):
    """Build a minimal Keeper-like object for cancel-before-pull tests without Web3."""
    from src.vault.keeper import Keeper
    from unittest.mock import MagicMock
    from eth_account import Account

    cfg = MagicMock()
    cfg.rpc_url = "http://localhost:8545"
    cfg.vault_address = "0x" + "aa" * 20
    cfg.usdc_address = "0x" + "bb" * 20
    cfg.chain_id = 1

    fake_vault = _CancelFakeVaultContract(pulled=pulled)
    fake_w3 = MagicMock()
    fake_w3.eth.block_number = 100
    fake_w3.eth.get_block.return_value = {"timestamp": 9999}
    fake_w3.eth.get_transaction_count.return_value = 0
    fake_w3.eth.gas_price = 1
    fake_w3.eth.send_raw_transaction.return_value = b"\x00" * 32
    fake_w3.eth.wait_for_transaction_receipt.return_value = MagicMock(status=1)

    keeper_acct = Account.from_key(b"\xcc" * 32)
    signer_acct = Account.from_key(b"\xdd" * 32)

    k = object.__new__(Keeper)
    k.cfg = cfg
    k.executor = MagicMock()
    k.nav_engine = MagicMock()
    k.w3 = fake_w3
    k.vault = fake_vault
    k.usdc = MagicMock()
    k.keeper_acct = keeper_acct
    k.signer_acct = signer_acct
    k._last_block = 0
    k._seen_deposits = set()
    k._seen_redeems = set()

    return k, fake_vault


def test_keeper_cancel_before_pull_honors_request():
    """When a cancel request exists and deposit is not yet pulled,
    keeper calls cancelDeposit(id, 0) and marks it honored."""
    store = InMemoryStore()
    store.add_cancel_request(1)  # deposit id 1 is pending cancel

    k, fake_vault = _make_cancel_keeper(pulled=False)

    # Override _send to directly invoke the function object (record calls).
    called = []
    def fake_send(fn):
        called.append(fn)
        return fn
    k._send = fake_send

    k.process_deposit(1, store=store)

    # cancelDeposit(1, 0) must have been called
    assert fake_vault.functions.cancel_calls == [(1, 0)], (
        f"Expected cancelDeposit(1, 0), got {fake_vault.functions.cancel_calls}"
    )
    # pullForDeposit must NOT have been called
    assert fake_vault.functions.pull_calls == []
    # Store must have marked the request honored
    assert 1 not in store.pending_cancel_ids()


def test_keeper_cancel_before_pull_skips_when_no_request():
    """When no cancel request exists, process_deposit proceeds normally."""
    store = InMemoryStore()
    # No cancel request registered

    k, fake_vault = _make_cancel_keeper(pulled=False)

    calls = []
    def fake_send(fn):
        calls.append(fn)
        return fn
    k._send = fake_send
    # Make executor + nav_engine safe to call
    k.executor.execute_deposit_swap.return_value = 1_000_000
    k.nav_engine.quote_deposit.return_value = (1_000_000, 0)
    k.nav_engine.on_deposit_settled.return_value = None

    # vault.functions.vaults needs to return a proper tuple
    k.vault.functions.vaults = lambda _: type("F", (), {"call": lambda self: [True, "0x" + "aa" * 20, 0, 0, 0, 0, 0]})()

    # Override _sign_nav so it doesn't need the chain
    k._sign_nav = lambda idx_bytes, nav: (9999, b"\x00" * 65)

    k.process_deposit(1, store=store)

    # pullForDeposit must have been called (normal path)
    assert fake_vault.functions.pull_calls == [1]
    # cancelDeposit must NOT have been called via cancel-before-pull
    assert fake_vault.functions.cancel_calls == []


def test_keeper_cancel_skips_when_already_pulled():
    """When the deposit is already pulled, cancel-before-pull does not apply."""
    store = InMemoryStore()
    store.add_cancel_request(1)  # request exists but deposit was already pulled

    k, fake_vault = _make_cancel_keeper(pulled=True)

    calls = []
    def fake_send(fn):
        calls.append(fn)
        return fn
    k._send = fake_send
    k.executor.execute_deposit_swap.return_value = 1_000_000
    k.nav_engine.quote_deposit.return_value = (1_000_000, 0)
    k.nav_engine.on_deposit_settled.return_value = None
    k.vault.functions.vaults = lambda _: type("F", (), {"call": lambda self: [True, "0x" + "aa" * 20, 0, 0, 0, 0, 0]})()
    k._sign_nav = lambda idx_bytes, nav: (9999, b"\x00" * 65)

    k.process_deposit(1, store=store)

    # cancel-before-pull should NOT have fired (already pulled)
    # The normal settle path should proceed
    assert fake_vault.functions.pull_calls == []  # pulled=True so no pull call
    assert fake_vault.functions.cancel_calls == []  # no pre-pull cancel
