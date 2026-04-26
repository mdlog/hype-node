"""Lightweight in-process backtester. Real implementation would replay historical
sentiment + flow series; here we generate deterministic synthetic equity curves
so the agent's tool surface stays callable end-to-end."""

from __future__ import annotations

import math
from typing import Any


def _series(n: int, base: float, vol: float, seed: int = 1) -> list[float]:
    s = seed
    out: list[float] = []
    for _ in range(n):
        s = (s * 9301 + 49297) % 233280
        r = s / 233280 - 0.5
        base = base * (1 + r * vol)
        out.append(base)
    return out


async def run(
    strategy_id: str,
    days: int = 90,
    rebalance_hours: int = 6,
    n_assets: int = 8,
    min_sentiment: int = 60,
    slippage_bps: int = 25,
) -> dict[str, Any]:
    equity = [v + i * 0.6 for i, v in enumerate(_series(60, 100, 0.025, 1))]
    btc = [v + i * 0.3 for i, v in enumerate(_series(60, 100, 0.03, 9))]
    eth = [v + i * 0.2 for i, v in enumerate(_series(60, 100, 0.035, 7))]
    sector = [v + i * 0.15 for i, v in enumerate(_series(60, 100, 0.02, 11))]

    ret = (equity[-1] - equity[0]) / equity[0]
    sharpe = round(1.5 + math.log1p(n_assets) * 0.1, 2)
    return {
        "strategy_id": strategy_id,
        "days": days,
        "rebalance_hours": rebalance_hours,
        "n_assets": n_assets,
        "min_sentiment": min_sentiment,
        "slippage_bps": slippage_bps,
        "return": round(ret, 4),
        "sharpe": sharpe,
        "sortino": round(sharpe * 1.32, 2),
        "max_drawdown": -0.081,
        "win_rate": 0.61,
        "trades": 142,
        "equity": equity,
        "benchmarks": {"BTC": btc, "ETH": eth, "Sector": sector},
    }
