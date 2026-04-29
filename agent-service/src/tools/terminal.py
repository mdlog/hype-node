"""SoSoValue Terminal tool surface (Python side).

Mirrors lib/api/sosovalue.ts in the Next.js app. Falls back to deterministic
synthetic data when no API key is set so the LangGraph loop stays callable.

Base: https://openapi.sosovalue.com/openapi/v1
Auth: header `x-soso-api-key: <YOUR_KEY>`

Endpoints used:
    GET /etfs                           ETF list (filter by symbol + country)
    GET /etfs/{ticker}/history          daily net inflow / cum inflow / NAV
    GET /news                           news feed (filter by category, language)
    GET /currencies/sector-spotlight    sector momentum + spotlight rotation
    GET /indices                        SSI index ticker list
    GET /indices/{ticker}/constituents  index constituents (symbol + weight)
"""

from __future__ import annotations

import asyncio
import os
import time
from datetime import datetime, timezone
from typing import Any

import httpx

BASE = os.getenv("SOSOVALUE_API_BASE", "https://openapi.sosovalue.com/openapi/v1")
KEY = os.getenv("SOSOVALUE_API_KEY", "")

# ---------- transport: rate limiter + persistent cache ----------
#
# Demo tier = 1 request per minute, total. Mirror the Node-side limiter:
#   1. Per-path in-memory cache, default 15-minute TTL.
#   2. Global gap of 65s between any two outbound calls.
#   3. In-flight dedup: parallel callers share one task per path.
#   4. Stale-on-failure / stale-on-rate-limit: prefer last good payload.

MIN_GAP_SEC = float(os.getenv("SOSOVALUE_MIN_GAP_SEC", "65"))
CACHE_TTL_SEC = float(os.getenv("SOSOVALUE_CACHE_TTL_SEC", str(15 * 60)))
# When the API reports "Monthly quota exceeded" (code 402901 + that message),
# back off for 6h instead of the 65s per-minute gap. Tunable.
QUOTA_BACKOFF_SEC = float(os.getenv("SOSOVALUE_QUOTA_BACKOFF_SEC", str(6 * 3600)))
# Server-side 5xx errors (e.g. 500 code=500001) usually mean a SoSoValue
# outage or a subscription-activation propagation delay. Back off for a
# short window instead of hammering the gateway with retries.
TRANSIENT_BACKOFF_SEC = float(os.getenv("SOSOVALUE_TRANSIENT_BACKOFF_SEC", "300"))

_cache: dict[str, tuple[Any, float, float]] = {}  # path → (data, expires_at, updated_at)
_inflight: dict[str, asyncio.Future[Any]] = {}
_last_request_at = 0.0
_quota_exhausted_until = 0.0  # epoch seconds; while > now() we skip the network
_transient_error_until = 0.0  # 5xx outage backoff (shorter than quota)
_last_success: dict[str, Any] | None = None
_last_error: dict[str, Any] | None = None
_gate_lock = asyncio.Lock()


def _fresh(entry: tuple[Any, float, float] | None) -> bool:
    return entry is not None and entry[1] > time.time()


def _is_monthly_quota_error(msg: str) -> bool:
    return "monthly quota" in (msg or "").lower()


def _seconds_until(ts: float) -> int:
    return max(0, int(ts - time.time()))


def _iso_from_epoch(ts: float | None) -> str | None:
    if not ts:
        return None
    return datetime.fromtimestamp(ts, timezone.utc).isoformat()


def _record_error(
    *,
    path: str,
    status_code: int,
    code: int | None,
    message: str,
    backoff_until: float | None,
) -> None:
    global _last_error
    _last_error = {
        "path": path,
        "status_code": status_code,
        "code": code,
        "message": message,
        "at": _iso_from_epoch(time.time()),
        "backoff_until": _iso_from_epoch(backoff_until),
    }


def status() -> dict[str, Any]:
    """Return non-secret SoSoValue transport diagnostics for /terminal/status."""

    now = time.time()
    cache = []
    for path, (_data, expires_at, updated_at) in sorted(_cache.items()):
        cache.append(
            {
                "path": path,
                "fresh": expires_at > now,
                "age_sec": max(0, int(now - updated_at)),
                "expires_in_sec": _seconds_until(expires_at),
            }
        )
    return {
        "base": BASE,
        "has_api_key": bool(KEY),
        "min_gap_sec": MIN_GAP_SEC,
        "cache_ttl_sec": CACHE_TTL_SEC,
        "quota_backoff_sec": QUOTA_BACKOFF_SEC,
        "transient_backoff_sec": TRANSIENT_BACKOFF_SEC,
        "last_request_at": _iso_from_epoch(_last_request_at),
        "backoff": {
            "quota_exhausted_for_sec": _seconds_until(_quota_exhausted_until),
            "transient_error_for_sec": _seconds_until(_transient_error_until),
        },
        "last_success": _last_success,
        "last_error": _last_error,
        "cache": cache,
        "inflight": sorted(_inflight.keys()),
    }


async def _get(path: str) -> Any:
    global _last_request_at, _quota_exhausted_until, _transient_error_until, _last_success

    if not KEY:
        return None

    cached = _cache.get(path)
    if _fresh(cached):
        return cached[0]

    # Hard backoff: monthly quota exhausted → don't even try the network.
    if time.time() < _quota_exhausted_until:
        return cached[0] if cached else None

    # Soft backoff: SoSoValue is having a server-side issue. Skip network
    # and serve cache/synthetic until the window closes.
    if time.time() < _transient_error_until:
        return cached[0] if cached else None

    if path in _inflight:
        return await _inflight[path]

    async with _gate_lock:
        gap = time.time() - _last_request_at
        if gap < MIN_GAP_SEC:
            wait = MIN_GAP_SEC - gap
            if cached is not None:
                age = int(time.time() - cached[2])
                print(
                    f"[terminal] rate-limit guard: serving stale {path} "
                    f"(age {age}s, next slot in {int(wait)}s)"
                )
                return cached[0]
            return None
        _last_request_at = time.time()

    fut: asyncio.Future[Any] = asyncio.get_event_loop().create_future()
    _inflight[path] = fut
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(f"{BASE}{path}", headers={"x-soso-api-key": KEY})
        try:
            body = r.json()
        except Exception:
            raise RuntimeError(f"non-JSON {r.status_code}: {r.text[:80]}")
        envelope_code = body.get("code") if isinstance(body, dict) else None
        msg = body.get("message", "") if isinstance(body, dict) else r.text[:80]

        if r.status_code != 200 or (envelope_code is not None and envelope_code != 0):
            if _is_monthly_quota_error(msg):
                if _quota_exhausted_until < time.time():
                    print(
                        f"[terminal] SoSoValue MONTHLY QUOTA EXHAUSTED · "
                        f"backing off until "
                        f"{time.strftime('%H:%M', time.localtime(time.time() + QUOTA_BACKOFF_SEC))} "
                        f"(serving cached/synthetic data)"
                    )
                _quota_exhausted_until = time.time() + QUOTA_BACKOFF_SEC
                _record_error(
                    path=path,
                    status_code=r.status_code,
                    code=envelope_code if isinstance(envelope_code, int) else None,
                    message=msg,
                    backoff_until=_quota_exhausted_until,
                )
            elif r.status_code >= 500 or (
                isinstance(envelope_code, int) and envelope_code >= 500000
            ):
                if _transient_error_until < time.time():
                    print(
                        f"[terminal] SoSoValue 5xx OUTAGE ({r.status_code} code={envelope_code}) · "
                        f"backing off {int(TRANSIENT_BACKOFF_SEC / 60)}min until "
                        f"{time.strftime('%H:%M', time.localtime(time.time() + TRANSIENT_BACKOFF_SEC))} "
                        f"(likely subscription propagation delay or service degradation)"
                    )
                _transient_error_until = time.time() + TRANSIENT_BACKOFF_SEC
                _record_error(
                    path=path,
                    status_code=r.status_code,
                    code=envelope_code if isinstance(envelope_code, int) else None,
                    message=msg,
                    backoff_until=_transient_error_until,
                )
            else:
                _record_error(
                    path=path,
                    status_code=r.status_code,
                    code=envelope_code if isinstance(envelope_code, int) else None,
                    message=msg,
                    backoff_until=None,
                )
            raise RuntimeError(f"{r.status_code} code={envelope_code} msg={msg}")

        data = body.get("data", body) if isinstance(body, dict) else body
        _cache[path] = (data, time.time() + CACHE_TTL_SEC, time.time())
        _last_success = {"path": path, "at": _iso_from_epoch(time.time())}
        fut.set_result(data)
        return data
    except Exception as exc:  # noqa: BLE001
        # Suppress per-retry noise during quota / transient-error backoff —
        # otherwise the agent loop fills the log with the same line every cycle.
        msg = str(exc)
        suppress = (
            _is_monthly_quota_error(msg)
            or " 5" in msg  # 5xx
            or "code=5" in msg
        )
        if not suppress:
            print(f"[terminal] {path} failed: {exc}")
        if cached is not None:
            fut.set_result(cached[0])
            return cached[0]
        fut.set_result(None)
        return None
    finally:
        _inflight.pop(path, None)


# ---------- raw endpoints ----------


async def list_etfs(symbol: str, country_code: str = "US") -> list[dict[str, Any]]:
    data = await _get(f"/etfs?symbol={symbol}&country_code={country_code}")
    if data is not None:
        return data
    return [
        {"ticker": "IBIT", "name": "iShares Bitcoin Trust", "exchange": "NASDAQ"},
        {"ticker": "FBTC", "name": "Fidelity Wise Origin Bitcoin Fund", "exchange": "CBOE"},
    ]


async def get_etf_history(
    ticker: str,
    start_date: str | None = None,
    end_date: str | None = None,
    limit: int = 30,
) -> list[dict[str, Any]]:
    qs = f"limit={limit}"
    if start_date:
        qs += f"&start_date={start_date}"
    if end_date:
        qs += f"&end_date={end_date}"
    data = await _get(f"/etfs/{ticker}/history?{qs}")
    if data is not None:
        return data
    today = datetime.now(timezone.utc).date()
    return [
        {
            "date": (today.replace(day=max(1, today.day - i))).isoformat(),
            "ticker": ticker,
            "net_inflow": int((10 + i) * 1_000_000),
            "cum_inflow": 400_000_000 + i * 12_000_000,
            "net_assets": 5_000_000_000,
            "currency_share": 0.005,
            "prem_dsc": -0.0001,
            "value_traded": 4_441_000_000,
            "volume": 322_302,
        }
        for i in range(min(limit, 5))
    ]


async def get_news_raw(
    category: int | None = None,
    language: str = "en",
    page: int = 1,
    page_size: int = 20,
) -> dict[str, Any]:
    qs = f"language={language}&page={page}&page_size={page_size}"
    if category:
        qs += f"&category={category}"
    data = await _get(f"/news?{qs}")
    if data is not None:
        return data
    return {
        "page": 1,
        "page_size": page_size,
        "total": 2,
        "list": [
            {
                "id": "n1",
                "title": "Filecoin storage demand jumps 38% QoQ, enterprise contracts expand",
                "release_time": int(datetime.now(timezone.utc).timestamp() * 1000),
                "author": "Messari",
                "matched_currencies": [{"id": "fil", "name": "FIL", "full_name": "Filecoin"}],
                "tags": ["DePIN", "storage"],
            },
            {
                "id": "n2",
                "title": "Helium network passes 1M devices, mobile subscriber growth accelerates",
                "release_time": int(datetime.now(timezone.utc).timestamp() * 1000),
                "author": "The Block",
                "matched_currencies": [{"id": "hnt", "name": "HNT", "full_name": "Helium"}],
                "tags": ["DePIN"],
            },
        ],
    }


async def get_sector_spotlight() -> dict[str, Any]:
    """Real response field is `change_pct_24h` (decimal fraction).

    Verified shape (2026-04-26):
      {"sector": [{"name": "DeFi", "change_pct_24h": 0.0034,
                   "marketcap_dom": 0.0138}, ...],
       "spotlight": [...]}
    """
    data = await _get("/currencies/sector-spotlight")
    if data is not None:
        return data
    return {
        "sector": [
            {"name": "Layer1", "change_pct_24h": -0.0046, "marketcap_dom": 0.0797},
            {"name": "DeFi", "change_pct_24h": 0.0034, "marketcap_dom": 0.0138},
            {"name": "Layer2", "change_pct_24h": -0.0067, "marketcap_dom": 0.0022},
            {"name": "GameFi", "change_pct_24h": -0.0357, "marketcap_dom": 0.0009},
            {"name": "NFT", "change_pct_24h": -0.0133, "marketcap_dom": 0.0006},
        ],
        "spotlight": [{"name": "perpdex", "change_pct_24h": 0.112}],
    }


async def list_ssi_tickers() -> list[str]:
    data = await _get("/indices")
    return data if isinstance(data, list) else ["ssimag7", "ssilayer1", "ssidepin"]


async def get_ssi_constituents(ticker: str) -> list[dict[str, Any]]:
    data = await _get(f"/indices/{ticker}/constituents")
    if data is not None:
        return data
    return [
        {"currency_id": "1", "symbol": "btc", "weight": 0.31},
        {"currency_id": "2", "symbol": "eth", "weight": 0.22},
    ]


# ---------- adapters consumed by the LangGraph nodes ----------


def _score_from_title(title: str) -> int:
    t = title.lower()
    s = 50
    if any(w in t for w in ["jump", "surge", "breakout", "record", "grant", "launch"]):
        s += 30
    if any(w in t for w in ["down", "drop", "fall", "outflow", "hack", "exploit", "sell"]):
        s -= 35
    return max(-50, min(100, s))


async def get_sentiment(sector: str = "DePIN", window: str = "1h") -> dict[str, Any]:
    news = await get_news_raw(language="en", page_size=50)
    matching = [
        n for n in news.get("list", [])
        if any(t.lower() == sector.lower() for t in (n.get("tags") or []))
    ]
    score = min(100, 40 + len(matching) * 8)
    return {
        "sector": sector,
        "window": window,
        "score": score,
        "delta": 15 if len(matching) >= 3 else 0,
        "ts": datetime.now(timezone.utc).isoformat(),
    }


async def get_fund_flow(sector: str = "DePIN", window: str = "24h") -> dict[str, Any]:
    if sector.lower() == "btc":
        rows = await get_etf_history("IBIT", limit=1)
        if rows:
            last = rows[0]
            return {
                "sector": sector,
                "window": window,
                "net_inflow_usd": last["net_inflow"],
                "top_asset": "BTC",
                "top_asset_flow_usd": last["net_inflow"],
                "ts": last["date"],
            }
    return {
        "sector": sector,
        "window": window,
        "net_inflow_usd": 24_600_000,
        "top_asset": "FIL",
        "top_asset_flow_usd": 8_100_000,
        "ts": datetime.now(timezone.utc).isoformat(),
    }


async def get_news(sector: str = "DePIN", limit: int = 10) -> list[dict[str, Any]]:
    raw = await get_news_raw(language="en", page_size=min(limit, 100))
    out: list[dict[str, Any]] = []
    for n in raw.get("list", [])[:limit]:
        # title is nullable on Twitter-sourced items; fall back to content.
        title = (n.get("title") or "").strip() or (n.get("content") or "")[:140]
        # release_time arrives as a numeric string.
        try:
            ts_ms = int(n.get("release_time") or 0)
        except (TypeError, ValueError):
            ts_ms = 0
        tags = n.get("tags") or [sector]
        out.append(
            {
                "id": n.get("id"),
                "title": title,
                "source": n.get("author") or "—",
                "sector": tags[0] if tags else sector,
                "sentiment": _score_from_title(title),
                "ts": ts_ms,
            }
        )
    return out


# Mirrors lib/api/sosovalue.ts SECTOR_TO_SSI — narrative SSI indices that match
# the design mockups (ssiDePIN, ssiRWA, ssiAI, etc.).
SECTOR_TO_SSI: dict[str, str] = {
    "DePIN": "ssiDePIN",
    "RWA": "ssiRWA",
    "AI": "ssiAI",
    "Memes": "ssiMeme",
    "Meme": "ssiMeme",
    "Gaming": "ssiGameFi",
    "GameFi": "ssiGameFi",
    "DeFi": "ssiDeFi",
    "L2": "ssiLayer2",
    "Layer2": "ssiLayer2",
    "L1": "ssiLayer1",
    "Layer1": "ssiLayer1",
    "NFT": "ssiNFT",
    "CeFi": "ssiCeFi",
    "PayFi": "ssiPayFi",
    "SocialFi": "ssiSocialFi",
    "MAG7": "ssiMAG7",
}


def sector_to_ssi(sector: str) -> str | None:
    return SECTOR_TO_SSI.get(sector) or SECTOR_TO_SSI.get(sector.replace(" ", ""))
