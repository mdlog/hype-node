"""Real backtester that replays SoSoValue historical klines.

Replaces the synthetic equity-curve generator in `backtest.py` with an
actual portfolio simulation:

  1. Fetch daily klines for each constituent (default 90d window).
  2. Compute daily returns per asset.
  3. Sum weighted daily returns into a portfolio return series.
  4. Reduce to Sharpe (annualized), max drawdown, total return, win rate.
  5. Fetch BTC + ETH klines as benchmarks; compute their total return over
     the same window for the "vs BTC / vs ETH" comparison the UI surfaces.

If any constituent's klines are unavailable (SoSoValue outage, missing
asset, etc.), we exclude it from the basket and renormalize weights —
better to backtest 6/8 real assets than fall back to fully synthetic.
The result includes `excluded_assets` so the agent can tell the user.
"""

from __future__ import annotations

import asyncio
import math
from typing import Any

from . import terminal

# Canonical currency_id values for the standard benchmarks. Verified via
# /indices/ssiMAG7/constituents (which holds the top-7 by market cap):
#   BTC=…866 ($76k, $1.53T mcap, rank #1)
#   ETH=…867 ($2.26k, $273B mcap, rank #2)
# Hardcoding so we don't pay an extra round trip on every backtest call;
# if SoSoValue ever re-maps these, propose_basket → run_backtest will
# still work for the basket itself, only `vs_btc` / `vs_eth` would be
# off until these are updated.
BTC_CURRENCY_ID = "1673723677362319866"
ETH_CURRENCY_ID = "1673723677362319867"

TRADING_DAYS_PER_YEAR = 365  # crypto trades 24/7 — annualize against full year


def _closes_from_klines(klines: list[dict[str, Any]]) -> list[float]:
    """Extract the close-price series. Klines arrive oldest→newest from
    SoSoValue (verified) with `close` either a float or numeric string."""
    out: list[float] = []
    for k in klines:
        c = k.get("close")
        if c is None:
            continue
        try:
            out.append(float(c))
        except (TypeError, ValueError):
            continue
    return out


def _daily_returns(closes: list[float]) -> list[float]:
    """Simple arithmetic returns: r_t = close_t / close_{t-1} - 1."""
    if len(closes) < 2:
        return []
    return [
        (closes[i] / closes[i - 1]) - 1.0
        for i in range(1, len(closes))
        if closes[i - 1] > 0
    ]


def _stdev(xs: list[float]) -> float:
    if len(xs) < 2:
        return 0.0
    mean = sum(xs) / len(xs)
    var = sum((x - mean) ** 2 for x in xs) / (len(xs) - 1)
    return math.sqrt(var)


def _max_drawdown(equity: list[float]) -> float:
    """Max peak-to-trough decline as a negative decimal (−0.184 = −18.4%)."""
    if not equity:
        return 0.0
    peak = equity[0]
    worst = 0.0
    for v in equity:
        peak = max(peak, v)
        if peak > 0:
            dd = (v - peak) / peak
            worst = min(worst, dd)
    return worst


def _portfolio_returns(
    asset_returns: dict[str, list[float]],
    weights: dict[str, float],
) -> list[float]:
    """Sum weighted daily returns into a single portfolio return series.

    All assets must align on length. We truncate to the shortest series so
    a partial history on one constituent doesn't poison the whole window.
    """
    if not asset_returns:
        return []
    n = min(len(r) for r in asset_returns.values())
    if n == 0:
        return []
    out: list[float] = []
    for t in range(n):
        r = 0.0
        for sym, returns in asset_returns.items():
            r += weights.get(sym, 0.0) * returns[t]
        out.append(r)
    return out


def _equity_curve(returns: list[float], start: float = 1.0) -> list[float]:
    eq = [start]
    for r in returns:
        eq.append(eq[-1] * (1 + r))
    return eq


def _sharpe(returns: list[float]) -> float:
    """Annualized Sharpe with rf=0. Crypto baseline; tune if needed."""
    if not returns:
        return 0.0
    mean = sum(returns) / len(returns)
    sd = _stdev(returns)
    if sd == 0:
        return 0.0
    return (mean / sd) * math.sqrt(TRADING_DAYS_PER_YEAR)


def _win_rate(returns: list[float]) -> float:
    if not returns:
        return 0.0
    wins = sum(1 for r in returns if r > 0)
    return wins / len(returns)


async def run_real_backtest(
    constituents: list[dict[str, Any]],
    days: int = 90,
    benchmarks: bool = True,
) -> dict[str, Any]:
    """Backtest a basket against historical klines.

    `constituents` is a list of `{currency_id, symbol, weight}` items
    (same shape as `terminal.get_ssi_constituents` returns). Weights are
    renormalized over the assets that actually have klines available.
    """

    if not constituents:
        return {
            "ok": False,
            "error": "no constituents supplied",
            "n_assets": 0,
            "days": days,
        }

    # Fan out kline fetches in parallel — SoSoValue has a global rate
    # limiter (60s gap on Demo, faster on paid), so the underlying
    # `_get()` will serialize for us. With cache warm, parallel is free.
    tasks = [
        terminal.get_currency_klines(c["currency_id"], "1d", days)
        for c in constituents
    ]
    if benchmarks:
        tasks.extend(
            [
                terminal.get_currency_klines(BTC_CURRENCY_ID, "1d", days),
                terminal.get_currency_klines(ETH_CURRENCY_ID, "1d", days),
            ]
        )
    results = await asyncio.gather(*tasks, return_exceptions=True)

    # Split kline results back into constituents vs benchmarks.
    n_const = len(constituents)
    const_klines = results[:n_const]
    btc_klines = results[n_const] if benchmarks else None
    eth_klines = results[n_const + 1] if benchmarks else None

    asset_returns: dict[str, list[float]] = {}
    asset_closes: dict[str, list[float]] = {}
    excluded: list[str] = []
    raw_weights: dict[str, float] = {}

    for c, klines in zip(constituents, const_klines):
        symbol = c.get("symbol") or c.get("currency_id")
        weight = float(c.get("weight", 0))
        if isinstance(klines, Exception) or not isinstance(klines, list) or len(klines) < 2:
            excluded.append(str(symbol))
            continue
        closes = _closes_from_klines(klines)
        rets = _daily_returns(closes)
        if not rets:
            excluded.append(str(symbol))
            continue
        asset_closes[symbol] = closes
        asset_returns[symbol] = rets
        raw_weights[symbol] = weight

    if not asset_returns:
        # Surface SoSoValue backoff state so the agent can tell the user
        # whether to retry vs give up — a 5xx outage clears in minutes,
        # a quota exhaustion is hours.
        explain: str | None = None
        try:
            st = terminal.status()
            backoff = st.get("backoff", {}) or {}
            if int(backoff.get("transient_error_for_sec", 0)) > 0:
                explain = (
                    f"SoSoValue API outage (~{backoff['transient_error_for_sec']}s "
                    "until retry)"
                )
            elif int(backoff.get("quota_exhausted_for_sec", 0)) > 0:
                explain = (
                    f"SoSoValue monthly quota exhausted "
                    f"(~{backoff['quota_exhausted_for_sec']}s until reset)"
                )
            elif not st.get("has_api_key"):
                explain = "no SOSOVALUE_API_KEY configured"
        except Exception:
            pass
        return {
            "ok": False,
            "error": (
                "no constituents had usable klines"
                + (f" — {explain}" if explain else "")
            ),
            "excluded_assets": excluded,
            "n_assets": 0,
            "days": days,
        }

    # Renormalize weights over the assets that survived.
    total_w = sum(raw_weights.values())
    weights = {s: (w / total_w if total_w > 0 else 1 / len(raw_weights)) for s, w in raw_weights.items()}

    portfolio_returns = _portfolio_returns(asset_returns, weights)
    equity = _equity_curve(portfolio_returns, 1.0)
    total_return = (equity[-1] / equity[0]) - 1.0 if equity else 0.0
    sharpe = _sharpe(portfolio_returns)
    max_dd = _max_drawdown(equity)
    win_rate = _win_rate(portfolio_returns)

    out: dict[str, Any] = {
        "ok": True,
        "days": days,
        "n_assets": len(asset_returns),
        "n_returns": len(portfolio_returns),
        "weights": {s: round(w, 4) for s, w in weights.items()},
        "excluded_assets": excluded,
        "return": round(total_return, 4),
        "sharpe": round(sharpe, 2),
        "max_drawdown": round(max_dd, 4),
        "win_rate": round(win_rate, 3),
        # Cap equity series at 90 points to keep payload trim — UI can
        # reconstruct curve shape from this. Drop intermediate close
        # series to keep tool_result compact for Claude's context.
        "equity_preview": [round(v, 4) for v in equity[-90:]],
    }

    if benchmarks:
        for label, klines in (("btc", btc_klines), ("eth", eth_klines)):
            if isinstance(klines, list) and len(klines) >= 2:
                closes = _closes_from_klines(klines)
                if len(closes) >= 2:
                    bench_return = (closes[-1] / closes[0]) - 1.0
                    out[f"{label}_return"] = round(bench_return, 4)
                    out[f"vs_{label}"] = round(total_return - bench_return, 4)

    return out
