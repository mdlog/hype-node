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

Returns ``{"ok": False, "error": ...}`` when SOSOVALUE_API_KEY is missing or
upstream is unreachable, so the chat agent surfaces "data unavailable"
rather than fabricated calendar entries that could be cited as live macro.
"""

from __future__ import annotations

from typing import Any
from urllib.parse import quote

from .terminal import _get  # shared async http helper + rate-limit gate


async def get_upcoming_events(days: int = 7) -> dict[str, Any]:
    """Return the macro release calendar for the next `days` days.

    Shape: ``{"ok": True, "days": [{"date": ..., "events": [...]}], ...}``.
    Returns ``{"ok": False, "error": ...}`` on transport failure or when the
    SoSoValue API key is missing.
    """

    days = max(1, min(int(days), 30))
    try:
        data = await _get("/macro/events")
        if data is None:
            return {
                "ok": False,
                "error": (
                    "SoSoValue macro feed unavailable — API key missing, "
                    "quota exhausted, or upstream in backoff"
                ),
            }
        if not isinstance(data, list):
            return {
                "ok": False,
                "error": f"unexpected payload type: {type(data).__name__}",
            }
        try:
            sorted_days = sorted(data, key=lambda r: r.get("date", ""))
        except Exception:
            sorted_days = data
        return {
            "ok": True,
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
                "ok": False,
                "error": (
                    f"SoSoValue history for {event} unavailable — API key "
                    "missing, quota exhausted, or upstream in backoff"
                ),
                "event": event,
            }
        if not isinstance(data, list):
            return {
                "ok": False,
                "error": f"unexpected payload type: {type(data).__name__}",
            }
        return {
            "ok": True,
            "event": event,
            "rows": data,
            "source": "sosovalue",
        }
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": str(e)}
