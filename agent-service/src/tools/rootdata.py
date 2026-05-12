"""RootData OpenAPI client (Basic tier scope).

Endpoints exposed at this tier:
  - POST /open/ser_inv         (FREE)   — search project / VC / people
  - POST /open/get_item        (2 cr)   — full project detail (funding,
                                          investors, team, ecosystem, etc.)
  - POST /open/get_org         (2 cr)   — VC detail (investments, social)
  - POST /open/quotacredits    (FREE)   — credit balance probe

Locked behind Plus tier (returns result=110 "Please upgrade your application
level"): get_fac (fundraising rounds list), get_invest (investor batch),
id_map. Those are the endpoints we'd want for a real-time funding feed; until
the user upgrades, this module gives chat-agent search + per-project detail
only.

Caching: every call goes through `_get_cached()` with a long TTL because
the Basic plan has just 1000 credits/month (~500 get_item calls). 24h TTL on
get_item / 1h on ser_inv keeps repeated chat questions free.
"""

from __future__ import annotations

import asyncio
import json
import os
import time
from typing import Any
from urllib.error import HTTPError
from urllib.request import Request, urlopen

BASE = "https://api.rootdata.com/open"
KEY = os.getenv("ROOTDATA_API_KEY", "").strip()

# Cache TTLs — tuned for 1000 credits/month budget. ser_inv is free so we can
# afford a shorter TTL; get_item costs 2 credits so we keep it warm for a day.
TTL_SER_INV_SEC = float(os.getenv("ROOTDATA_SER_INV_TTL_SEC", "3600"))
TTL_GET_ITEM_SEC = float(os.getenv("ROOTDATA_GET_ITEM_TTL_SEC", str(24 * 3600)))
TTL_QUOTA_SEC = 60.0

# In-process cache: key -> (data, expires_at_epoch)
_cache: dict[str, tuple[Any, float]] = {}
_inflight: dict[str, asyncio.Future[Any]] = {}


def is_configured() -> bool:
    return bool(KEY)


async def _post(path: str, body: dict[str, Any]) -> dict[str, Any]:
    """Single POST to RootData. Runs urllib in a thread to stay async-friendly."""

    def _blocking() -> dict[str, Any]:
        req = Request(
            f"{BASE}/{path}",
            data=json.dumps(body).encode(),
            headers={
                "apikey": KEY,
                "language": "en",
                "Content-Type": "application/json",
                "user-agent": "HypeNode/0.1 (+https://hypenode.ai)",
            },
            method="POST",
        )
        try:
            with urlopen(req, timeout=15) as r:
                return json.loads(r.read())
        except HTTPError as e:
            try:
                return json.loads(e.read())
            except Exception:
                return {"result": e.code, "message": str(e), "data": None}

    return await asyncio.to_thread(_blocking)


async def _get_cached(cache_key: str, ttl_sec: float, body: dict[str, Any], path: str) -> dict[str, Any]:
    """Memoized POST.

    Treats `result == 200` as the only cacheable success — error envelopes
    (e.g. result=110 tier upgrade required) are NOT cached so a tier upgrade
    on the same key is picked up immediately by the next call.
    """
    now = time.time()
    cached = _cache.get(cache_key)
    if cached and cached[1] > now:
        return cached[0]

    if cache_key in _inflight:
        return await _inflight[cache_key]

    fut: asyncio.Future[Any] = asyncio.get_event_loop().create_future()
    _inflight[cache_key] = fut
    try:
        resp = await _post(path, body)
        if resp.get("result") == 200:
            _cache[cache_key] = (resp, now + ttl_sec)
        fut.set_result(resp)
        return resp
    finally:
        _inflight.pop(cache_key, None)


# ---------- public helpers ----------


async def get_balance() -> dict[str, Any] | None:
    """Tier + credits remaining. Free, used by /tools/health."""
    if not is_configured():
        return None
    resp = await _get_cached("quota", TTL_QUOTA_SEC, {}, "quotacredits")
    return resp.get("data") if resp.get("result") == 200 else None


async def search(query: str, precise_x: bool = False) -> list[dict[str, Any]]:
    """Search project / VC / people by keyword. FREE.

    Returns up to ~10 ranked results; trim to a manageable size for chat.
    """
    q = (query or "").strip()
    if not q:
        return []
    if not is_configured():
        return []
    cache_key = f"ser_inv:{q.lower()}:{int(precise_x)}"
    resp = await _get_cached(
        cache_key,
        TTL_SER_INV_SEC,
        {"query": q, "precise_x_search": precise_x},
        "ser_inv",
    )
    if resp.get("result") != 200:
        return []
    raw = resp.get("data") or []
    if not isinstance(raw, list):
        return []
    return [
        {
            "id": item.get("id"),
            "type": item.get("type"),
            "type_name": _type_name(item.get("type")),
            "name": item.get("name"),
            "one_liner": item.get("one_liner"),
            "introduce": item.get("introduce"),
            "logo": item.get("logo"),
            "rootdataurl": item.get("rootdataurl"),
            "active": bool(item.get("active")),
        }
        for item in raw[:10]
    ]


async def get_project(
    project_id: int,
    include_team: bool = True,
    include_investors: bool = True,
) -> dict[str, Any] | None:
    """Full project detail by RootData project_id. Costs 2 credits."""
    if not is_configured():
        return None
    pid = int(project_id)
    cache_key = f"get_item:p={pid}:t={int(include_team)}:i={int(include_investors)}"
    resp = await _get_cached(
        cache_key,
        TTL_GET_ITEM_SEC,
        {
            "project_id": pid,
            "include_team": bool(include_team),
            "include_investors": bool(include_investors),
        },
        "get_item",
    )
    if resp.get("result") != 200:
        return None
    return resp.get("data") or None


async def get_org(
    org_id: int,
    include_team: bool = False,
    include_investments: bool = True,
) -> dict[str, Any] | None:
    """VC / investor profile by org_id. Costs 2 credits."""
    if not is_configured():
        return None
    oid = int(org_id)
    cache_key = f"get_org:o={oid}:t={int(include_team)}:i={int(include_investments)}"
    resp = await _get_cached(
        cache_key,
        TTL_GET_ITEM_SEC,
        {
            "org_id": oid,
            "include_team": bool(include_team),
            "include_investments": bool(include_investments),
        },
        "get_org",
    )
    if resp.get("result") != 200:
        return None
    return resp.get("data") or None


def _type_name(t: int | None) -> str:
    if t == 1:
        return "Project"
    if t == 2:
        return "VC"
    if t == 3:
        return "People"
    return "Unknown"
