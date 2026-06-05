"""Unit tests for build_purity_block (pure helper — no I/O).

Written TDD-style: the test asserts the contract, the implementation satisfies it.
Run with:
    cd agent-service && .venv/bin/python -m pytest tests/test_purity.py -q
"""

from src.tools.real_backtest import build_purity_block


def test_constant_flags_are_true():
    """Lookahead-free and synthetic-free are constant algorithm properties."""
    block = build_purity_block(
        n_assets=5,
        n_returns=89,
        excluded_assets=[],
        oldest_ts=1_700_000_000_000,
        newest_ts=1_710_000_000_000,
    )
    assert block["lookahead_free"] is True
    assert block["synthetic_free"] is True


def test_kline_source_constant():
    block = build_purity_block(3, 59, [], None, None)
    assert block["kline_source"] == "sosovalue_daily_klines"


def test_kline_count_equals_n_returns_plus_one():
    block = build_purity_block(
        n_assets=6,
        n_returns=89,
        excluded_assets=[],
        oldest_ts=None,
        newest_ts=None,
    )
    assert block["kline_count"] == 90  # 89 returns + 1


def test_kline_count_zero_returns():
    block = build_purity_block(0, 0, [], None, None)
    assert block["kline_count"] == 1  # 0 returns + 1


def test_excluded_assets_passthrough():
    excluded = ["TOKEN_X", "TOKEN_Y"]
    block = build_purity_block(
        n_assets=3,
        n_returns=88,
        excluded_assets=excluded,
        oldest_ts=None,
        newest_ts=None,
    )
    assert block["excluded_assets"] == ["TOKEN_X", "TOKEN_Y"]


def test_excluded_assets_are_copied():
    """Mutating the original list must not affect the purity block."""
    original = ["A"]
    block = build_purity_block(1, 10, original, None, None)
    original.append("B")
    assert block["excluded_assets"] == ["A"]


def test_oldest_newest_ts_passthrough():
    block = build_purity_block(
        n_assets=4,
        n_returns=59,
        excluded_assets=[],
        oldest_ts=1_700_000_000_000,
        newest_ts=1_710_000_000_000,
    )
    assert block["oldest_ts"] == 1_700_000_000_000
    assert block["newest_ts"] == 1_710_000_000_000


def test_oldest_newest_ts_none_when_missing():
    block = build_purity_block(0, 0, [], None, None)
    assert block["oldest_ts"] is None
    assert block["newest_ts"] is None


def test_n_assets_passthrough():
    block = build_purity_block(7, 89, [], 0, 0)
    assert block["n_assets"] == 7
