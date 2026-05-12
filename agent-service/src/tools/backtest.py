"""DEPRECATED: legacy synthetic backtest stub.

This module's previous implementation generated deterministic-but-fake
equity curves to keep the LangGraph loop callable when the real backtest
path wasn't wired. That seeded misleading "Sharpe 1.5+" numbers into the
risk gate even when no real klines were ever fetched.

Use `tools.real_backtest.run_real_backtest(constituents, days)` instead.
That helper replays actual SoSoValue klines for the basket constituents.

`run()` is kept as a thin shim that returns an explicit error envelope so
older callers (graph.py backtest_node, mcp_server.py backtest.run tool)
don't crash — they just see `{"ok": False, ...}` and skip downstream
gates that depend on backtest output.
"""

from __future__ import annotations

from typing import Any


async def run(
    strategy_id: str = "",
    days: int = 90,
    rebalance_hours: int = 6,
    n_assets: int = 8,
    min_sentiment: int = 60,
    slippage_bps: int = 25,
) -> dict[str, Any]:
    return {
        "ok": False,
        "error": (
            "Synthetic backtest removed. Call run_real_backtest with explicit "
            "{currency_id, symbol, weight} constituents."
        ),
        "strategy_id": strategy_id,
        "days": days,
        "rebalance_hours": rebalance_hours,
        "n_assets": n_assets,
        "min_sentiment": min_sentiment,
        "slippage_bps": slippage_bps,
        # Neutral defaults so graph.py risk_node still works on .get() fallbacks
        # without claiming a fake sharpe/drawdown.
        "sharpe": 0,
        "sortino": 0,
        "max_drawdown": 0,
        "win_rate": 0,
        "trades": 0,
        "return": 0,
        "equity": [],
        "benchmarks": {},
    }
