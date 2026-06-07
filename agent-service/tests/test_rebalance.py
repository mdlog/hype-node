"""TDD tests for diff_basket (pure) and keeper rebalance orchestration.

These tests are written FIRST; run them before implementation to see them fail,
then implement to pass.  The orchestration tests use fake executor + fake store.
"""
import pytest
from src.vault.rebalance import diff_basket


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
