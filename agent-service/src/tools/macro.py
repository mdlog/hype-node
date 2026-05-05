"""SoSoValue macro economic calendar tool.

Wraps the `/macro/events` and `/macro/events/{event}/history` endpoints from
SoSoValue's OpenAPI surface and exposes them as agent-callable async
functions. Reuses the shared `_get` transport from `.terminal` so we inherit
the rate-limit gate, per-path cache, quota/transient backoffs, and stale
serving behaviour without re-implementing them.

Endpoints (base: https://openapi.sosovalue.com/openapi/v1):
    GET /macro/events
        → [{"date": "YYYY-MM-DD", "events": ["Nonfarm Payrolls", "CPI", ...]}]

    GET /macro/events/{event}/history?start_date=&end_date=&limit=
        → [{"date": "YYYY-MM-DD",
            "actual": float, "forecast": float, "previous": float}]

When SOSOVALUE_API_KEY is empty (`_get` short-circuits to `None`) we return a
small deterministic synthetic shape so the LangGraph loop and any unit tests
stay callable offline. All public coroutines are wrapped in try/except and
return `{"ok": False, "error": str(e)}` on transport failure rather than
raising — chat_agent's tool dispatch can JSON-serialize the result without
crashing the turn.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from math import cos, pi, sin
from typing import Any
from urllib.parse import quote

from .terminal import _get  # shared async http helper + rate-limit gate

# Catalog used for the no-key synthetic upcoming calendar. Kept short so the
# UI fallback shows meaningful events without inventing a fake schedule.
_FALLBACK_EVENTS = ("FOMC", "CPI", "NFP")


def _today_utc() -> datetime:
    now = datetime.now(timezone.utc)
    return now.replace(hour=0, minute=0, second=0, microsecond=0)


def _synthetic_upcoming(days: int) -> list[dict[str, Any]]:
    base = _today_utc()
    out: list[dict[str, Any]] = []
    for i in range(days):
        d = base + timedelta(days=i)
        pick = _FALLBACK_EVENTS[i % len(_FALLBACK_EVENTS)]
        out.append({"date": d.date().isoformat(), "events": [pick]})
    return out


def _synthetic_history(event: str, months: int) -> list[dict[str, Any]]:
    """Per-event base/scale tuned to give realistic-looking magnitudes that
    match what the upstream API returns (NFP in jobs-thousands, CPI in YoY %,
    FOMC in target-rate %, etc)."""

    e = event.lower()
    base = 3.2
    scale = 0.3
    if "nonfarm" in e or "nfp" in e or "payroll" in e:
        base, scale = 185.0, 35.0
    elif "cpi" in e or "inflation" in e:
        base, scale = 3.2, 0.3
    elif "fomc" in e or "fed funds" in e or "rate" in e:
        base, scale = 5.375, 0.0625
    elif "ppi" in e:
        base, scale = 2.4, 0.4
    elif "gdp" in e:
        base, scale = 2.5, 0.5
    elif "unemployment" in e:
        base, scale = 3.9, 0.2

    today = _today_utc()
    out: list[dict[str, Any]] = []
    for i in range(months):
        # months ago: months-1-i = 0 (oldest) .. months-1 (newest)
        offset = months - 1 - i
        # Approximate month-1-back by stepping 30 * offset days then snapping
        # to the 1st of the month.
        d = today - timedelta(days=30 * offset)
        d = d.replace(day=1)
        phase = (i / max(months, 1)) * pi * 2
        forecast = round(base + sin(phase) * scale * 0.6, 3)
        actual = round(forecast + cos(phase * 1.7) * scale * 0.5, 3)
        previous = round(base + sin(phase - 0.5) * scale * 0.6, 3)
        out.append({
            "date": d.date().isoformat(),
            "actual": actual,
            "forecast": forecast,
            "previous": previous,
        })
    return out


async def get_upcoming_events(days: int = 7) -> dict[str, Any]:
    """Return the macro release calendar for the next `days` days.

    Shape: ``{"ok": True, "days": [{"date": ..., "events": [...]}], ...}``.
    On transport failure the synthetic fallback is served and ``"synthetic":
    True`` is set so callers can disclose the source.
    """

    days = max(1, min(int(days), 30))
    try:
        data = await _get("/macro/events")
        if data is None:
            # No key, or backoff window — fall back to the deterministic shape.
            return {
                "ok": True,
                "synthetic": True,
                "days": _synthetic_upcoming(days),
                "source": "synthetic",
            }
        if not isinstance(data, list):
            return {"ok": False, "error": f"unexpected payload type: {type(data).__name__}"}
        # Sort ascending by date and trim to the requested horizon.
        try:
            sorted_days = sorted(data, key=lambda r: r.get("date", ""))
        except Exception:
            sorted_days = data
        return {
            "ok": True,
            "synthetic": False,
            "days": sorted_days[:days],
            "source": "sosovalue",
        }
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": str(e)}


async def get_event_history(event: str, limit: int = 12) -> dict[str, Any]:
    """Return historical actual/forecast/previous rows for a named macro event.

    `event` is the event label as returned by `get_upcoming_events`
    (e.g. ``"Nonfarm Payrolls"``). `limit` is capped at 100 per upstream.
    """

    if not event:
        return {"ok": False, "error": "event required"}
    limit = max(1, min(int(limit), 100))
    try:
        path = f"/macro/events/{quote(event, safe='')}/history?limit={limit}"
        data = await _get(path)
        if data is None:
            return {
                "ok": True,
                "synthetic": True,
                "event": event,
                "rows": _synthetic_history(event, min(limit, 12)),
                "source": "synthetic",
            }
        if not isinstance(data, list):
            return {"ok": False, "error": f"unexpected payload type: {type(data).__name__}"}
        return {
            "ok": True,
            "synthetic": False,
            "event": event,
            "rows": data,
            "source": "sosovalue",
        }
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": str(e)}
