"""SoSoValue BTC Treasury tool — surfaces "smart money" signals for the
agent loop. A treasury company adding BTC is a stronger conviction signal
than a single retail trade; the chat agent uses this to answer questions
like "is anyone accumulating?" and "who's the biggest 30d buyer?".

Endpoints:
    GET /btc-treasuries                                list (no params)
    GET /btc-treasuries/{ticker}/purchase-history      daily holdings ladder

Returns empty arrays when the SoSoValue API key is missing or upstream is
unreachable — the chat agent surfaces "data unavailable" rather than
seeded synthetic numbers that could be cited as live disclosures.
"""

from __future__ import annotations

import asyncio
import os
from datetime import datetime, timedelta, timezone
from typing import Any

from .terminal import _get

KEY = os.getenv("SOSOVALUE_API_KEY", "")


async def list_treasuries() -> list[dict[str, Any]]:
    """Companies tracked by SoSoValue's BTC treasury feed."""
    if not KEY:
        return []
    data = await _get("/btc-treasuries")
    if isinstance(data, list):
        return data
    return []


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
        return []
    qs = f"limit={capped}"
    if start_date:
        qs += f"&start_date={start_date}"
    if end_date:
        qs += f"&end_date={end_date}"
    data = await _get(f"/btc-treasuries/{ticker}/purchase-history?{qs}")
    if isinstance(data, list):
        return data
    return []


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
