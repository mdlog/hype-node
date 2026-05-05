"""SoSoValue BTC Treasury tool — surfaces "smart money" signals for the
agent loop. A treasury company adding BTC is a stronger conviction signal
than a single retail trade; the chat agent uses this to answer questions
like "is anyone accumulating?" and "who's the biggest 30d buyer?".

Endpoints:
    GET /btc-treasuries                                list (no params)
    GET /btc-treasuries/{ticker}/purchase-history      daily holdings ladder

Synthetic fallback mirrors lib/api/sosovalue/treasuries.ts so the agent
loop stays callable without an API key (returns deterministic data).
"""

from __future__ import annotations

import asyncio
import os
from datetime import datetime, timedelta, timezone
from typing import Any

from .terminal import _get

KEY = os.getenv("SOSOVALUE_API_KEY", "")

# Hard-coded synthetic roster — matches the TS-side fallback so a no-key
# environment shows the same five companies in widget + agent answers.
_SYNTH_LIST: list[dict[str, Any]] = [
    {"ticker": "MSTR", "name": "MicroStrategy", "list_location": "NASDAQ"},
    {"ticker": "TSLA", "name": "Tesla", "list_location": "NASDAQ"},
    {"ticker": "MARA", "name": "Marathon Digital", "list_location": "NASDAQ"},
    {"ticker": "RIOT", "name": "Riot Platforms", "list_location": "NASDAQ"},
    {"ticker": "CLSK", "name": "CleanSpark", "list_location": "NASDAQ"},
]

# 2025-2026 reference holdings used to seed synthetic histories. These
# numbers are loosely calibrated to public disclosures so the synthetic
# response reads plausibly when shown to the agent's reasoning loop.
_SYNTH_BASE: dict[str, int] = {
    "MSTR": 252_000,
    "TSLA": 11_500,
    "MARA": 28_500,
    "RIOT": 14_900,
    "CLSK": 9_800,
}


async def list_treasuries() -> list[dict[str, Any]]:
    """Companies tracked by SoSoValue's BTC treasury feed."""
    if not KEY:
        return _SYNTH_LIST
    data = await _get("/btc-treasuries")
    if isinstance(data, list) and data:
        return data
    return _SYNTH_LIST


async def get_purchase_history(
    ticker: str,
    *,
    start_date: str | None = None,
    end_date: str | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    """Per-ticker purchase ladder. Returns newest-first per the docs."""
    capped = max(1, min(limit, 100))
    if not KEY:
        return _synth_history(ticker, capped)
    qs = f"limit={capped}"
    if start_date:
        qs += f"&start_date={start_date}"
    if end_date:
        qs += f"&end_date={end_date}"
    data = await _get(f"/btc-treasuries/{ticker}/purchase-history?{qs}")
    if isinstance(data, list) and data:
        return data
    return _synth_history(ticker, capped)


def _synth_history(ticker: str, limit: int) -> list[dict[str, Any]]:
    """Deterministic synthetic ladder. Newest-first, monotonic-decreasing
    btc_holding so that latest − oldest is always a non-negative buy
    signal (mirrors the TS fallback exactly)."""
    base = _SYNTH_BASE.get(ticker.upper(), 5_000)
    rows: list[dict[str, Any]] = []
    count = max(2, min(limit, 100))
    holding = base
    today = datetime.now(timezone.utc).date()
    for i in range(count):
        d = today - timedelta(days=i * 11)
        # Larger acquisitions for more recent rows so the latest row is
        # naturally the headline buy. Shape matches the TS synth.
        acq = round(150 + ((count - i) ** 1.4) * 18)
        px = 95_000 - (i / count) * 23_000
        rows.append(
            {
                "date": d.isoformat(),
                "ticker": ticker.upper(),
                "btc_holding": holding,
                "btc_acq": acq,
                "acq_cost": int(round(acq * px)),
                "avg_btc_cost": int(round(px)),
            }
        )
        holding = max(0, holding - acq)
    return rows


# ---------------------------------------------------------------------------
# Public agent-facing signal: top-5 ranked by latest holdings, augmented
# with a 30d buy delta and the largest recent acquisition. Designed so the
# chat agent can drop the dict into a tool_result without further shaping.
# ---------------------------------------------------------------------------


async def get_smart_money_signal() -> dict[str, Any]:
    """Treasury accumulation signal for the chat agent.

    Returns:
        {
          "ok": bool,
          "top5": [
            {ticker, name, btc_holding, delta_30d_btc, delta_30d_usd,
             last_buy_date, days_since_buy, last_acq_btc}
          ],
          "any_recent_buy": bool,             # any company bought in last 7d
          "biggest_buyer_30d": {              # max delta_30d_btc across top5
            ticker, name, delta_30d_btc, delta_30d_usd
          } | None,
        }
    """
    try:
        listing = await list_treasuries()
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc), "top5": [], "any_recent_buy": False, "biggest_buyer_30d": None}

    # Cap fan-out — treasury endpoint may return dozens; we only need
    # enough candidates to fill a top-5 after sorting by holding.
    candidates = listing[:8]

    histories = await asyncio.gather(
        *(get_purchase_history(c["ticker"], limit=30) for c in candidates),
        return_exceptions=True,
    )

    today = datetime.now(timezone.utc).date()
    cutoff = today - timedelta(days=30)
    rows: list[dict[str, Any]] = []
    for meta, hist in zip(candidates, histories):
        if isinstance(hist, Exception) or not hist:
            continue
        # Sort newest-first defensively (API contract is newest-first but
        # we don't want to depend on that for the math).
        sorted_hist = sorted(hist, key=lambda r: r.get("date", ""), reverse=True)
        latest = sorted_hist[0]
        within = [r for r in sorted_hist if r.get("date", "") >= cutoff.isoformat()]
        # Fall back to absolute oldest if no row within 30d window.
        oldest = within[-1] if within else sorted_hist[-1]
        delta_btc = float(latest.get("btc_holding", 0)) - float(oldest.get("btc_holding", 0))
        delta_usd = int(round(delta_btc * float(latest.get("avg_btc_cost", 0) or 0)))
        try:
            last_date = datetime.strptime(latest.get("date", ""), "%Y-%m-%d").date()
            days_since = max(0, (today - last_date).days)
        except ValueError:
            days_since = 999
        rows.append(
            {
                "ticker": meta["ticker"],
                "name": meta.get("name", meta["ticker"]),
                "btc_holding": float(latest.get("btc_holding", 0)),
                "delta_30d_btc": delta_btc,
                "delta_30d_usd": delta_usd,
                "last_buy_date": latest.get("date", ""),
                "days_since_buy": days_since,
                "last_acq_btc": float(latest.get("btc_acq", 0)),
            }
        )

    rows.sort(key=lambda r: r["btc_holding"], reverse=True)
    top5 = rows[:5]
    any_recent = any(r["days_since_buy"] <= 7 for r in top5)
    # Biggest buyer of the period: max delta_30d_btc, not max acquisition
    # — caller asked for "biggest_buyer_30d", which is the cumulative add
    # over the window, not a single-day spike.
    biggest = max(top5, key=lambda r: r["delta_30d_btc"], default=None)
    biggest_compact = (
        {
            "ticker": biggest["ticker"],
            "name": biggest["name"],
            "delta_30d_btc": biggest["delta_30d_btc"],
            "delta_30d_usd": biggest["delta_30d_usd"],
        }
        if biggest
        else None
    )

    return {
        "ok": True,
        "top5": top5,
        "any_recent_buy": any_recent,
        "biggest_buyer_30d": biggest_compact,
    }
