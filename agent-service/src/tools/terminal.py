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
import re
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

# Per-path cache TTL overrides. Daily klines (historical) basically never
# change for past candles, so we cache them 30 minutes — without this, the
# `asyncio.gather` fan-out in real_backtest.py keeps hitting the rate-limit
# guard and serving the same stale entry every cycle (see "rate-limit guard:
# serving stale" log lines). Sentiment / flow stay short because they ARE
# the realtime signal the loop reacts to.
#
# First match wins. Non-matching paths fall back to CACHE_TTL_SEC.
PATH_TTL_RULES: list[tuple[re.Pattern[str], float]] = [
    # Daily klines (historical) — 30min. Past candles immutable.
    (re.compile(r"/(currencies|indices)/[^/]+/klines"), 30 * 60),
    # News — short, signal velocity matters.
    (re.compile(r"/news(\?|/|$)"), 30),
    # Realtime market snapshots — short.
    (re.compile(r"/market-snapshot"), 60),
    (re.compile(r"/currencies/[^/]+/pairs"), 60),
    # Token economics rarely change — 1h is fine.
    (re.compile(r"/currencies/[^/]+/token-economics"), 60 * 60),
    # Currency master list — very stable, cache long.
    (re.compile(r"/currencies(\?|$)"), 60 * 60),
    # SSI index list (rarely changes) — cache long.
    (re.compile(r"/indices(\?|$)"), 60 * 60),
    # SSI constituents — rebalance event-driven, 5min is conservative.
    (re.compile(r"/indices/[^/]+/constituents"), 5 * 60),
    # Fundraising data — slow-moving (VC rounds).
    (re.compile(r"/fundraising"), 60 * 60),
    # BTC treasury filings — quarterly cadence.
    (re.compile(r"/btc-treasuries"), 60 * 60),
]


def _ttl_for(path: str) -> float:
    """Return the cache TTL (seconds) for a given path, falling back to the
    global CACHE_TTL_SEC when no path-specific rule matches."""
    for rx, ttl in PATH_TTL_RULES:
        if rx.search(path):
            return ttl
    return CACHE_TTL_SEC
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
            # If we have cached data, return it stale rather than block —
            # the caller wanted "freshish" not "synchronously block 60s".
            if cached is not None:
                age = int(time.time() - cached[2])
                print(
                    f"[terminal] rate-limit guard: serving stale {path} "
                    f"(age {age}s, next slot in {int(wait)}s)"
                )
                return cached[0]
            # No cache → sleep until the slot opens. Without this, parallel
            # fan-outs (e.g. propose_basket fetching 10 snapshots) would
            # have 9 of 10 calls return None because they all see the
            # same `last_request_at`. Sleeping serializes them at the
            # MIN_GAP_SEC cadence — 10 fetches × 0.7s = ~7s on paid tier.
            # On Demo (65s gap) this would be impractical for parallel
            # fetches; callers should batch-cache or use sector tools
            # that stay within a single round trip.
            if wait > 30:
                # Don't block forever on a long backoff; the caller can
                # retry or accept None.
                return None
            await asyncio.sleep(wait)
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
        _cache[path] = (data, time.time() + _ttl_for(path), time.time())
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
    """ETF universe for the given symbol/region. Returns an empty list when
    upstream is unreachable so callers don't render hardcoded IBIT/FBTC
    entries as if they were live."""
    data = await _get(f"/etfs?symbol={symbol}&country_code={country_code}")
    if isinstance(data, list):
        return data
    return []


async def get_etf_history(
    ticker: str,
    start_date: str | None = None,
    end_date: str | None = None,
    limit: int = 30,
) -> list[dict[str, Any]]:
    """Daily ETF flow history. Returns an empty list when upstream is
    unreachable — previously seeded synthetic IBIT-shaped numbers that
    looked indistinguishable from real $10M/day inflow signals."""
    qs = f"limit={limit}"
    if start_date:
        qs += f"&start_date={start_date}"
    if end_date:
        qs += f"&end_date={end_date}"
    data = await _get(f"/etfs/{ticker}/history?{qs}")
    if isinstance(data, list):
        return data
    return []


async def get_news_raw(
    category: int | None = None,
    language: str = "en",
    page: int = 1,
    page_size: int = 20,
) -> dict[str, Any]:
    """Raw /news payload. Returns an empty list shape when upstream is
    unreachable — previously seeded a 2-headline Filecoin/Helium fallback
    that get_sentiment / get_news already short-circuit around via
    `_backoff_explainer`."""
    qs = f"language={language}&page={page}&page_size={page_size}"
    if category:
        qs += f"&category={category}"
    data = await _get(f"/news?{qs}")
    if isinstance(data, dict):
        return data
    return {"page": page, "page_size": page_size, "total": 0, "list": []}


async def get_sector_spotlight() -> dict[str, Any]:
    """Real sector momentum from SoSoValue. Returns `ok: false` on
    backoff so the chat agent doesn't cite the synthetic fallback shape
    as live data. Background graph.py callers fall back to `sector: []`
    via the `.get(...)` defaults they already use."""
    explain = _backoff_explainer()
    if explain:
        return {"ok": False, "sector": [], "spotlight": [], "error": explain}
    data = await _get("/currencies/sector-spotlight")
    if data is None:
        explain = _backoff_explainer() or "transport failure"
        return {"ok": False, "sector": [], "spotlight": [], "error": explain}
    if isinstance(data, dict):
        # Tag the source so caller can render "live" vs synthetic — only
        # set ok:true when shape includes the real `sector` array.
        return {**data, "ok": True}
    return {"ok": False, "sector": [], "spotlight": [], "error": "unexpected response shape"}


async def list_ssi_tickers() -> Any:
    """List of SSI index tickers. Returns `{ok: false, error}` during
    backoff so the agent doesn't fabricate a curated list."""
    explain = _backoff_explainer()
    if explain:
        return {"ok": False, "tickers": [], "error": explain}
    data = await _get("/indices")
    if not isinstance(data, list):
        explain = _backoff_explainer() or "transport failure"
        return {"ok": False, "tickers": [], "error": explain}
    return {"ok": True, "tickers": data}


async def get_ssi_constituents(ticker: str) -> list[dict[str, Any]]:
    """Real SSI index constituents (currency_id, symbol, weight). Returns
    an empty list when upstream is unreachable. basket.py filters
    non-numeric currency_ids defensively, but the cleaner contract is
    "no data" rather than placeholder ['1', '2'] entries that look like
    real SoSoValue ids until you inspect them."""
    data = await _get(f"/indices/{ticker}/constituents")
    if isinstance(data, list):
        return data
    return []


async def get_currency_snapshot(currency_id: str) -> dict[str, Any] | None:
    """Live market snapshot for a single asset. Returns price, market cap,
    24h change %, turnover, rank. None on transport failure (caller decides
    whether to fall back or surface 'data unavailable')."""
    return await _get(f"/currencies/{currency_id}/market-snapshot")


async def get_currency_klines(
    currency_id: str,
    interval: str = "1d",
    limit: int = 90,
) -> list[dict[str, Any]] | None:
    """Historical OHLCV for a single asset. Default 90d daily candles —
    enough window to compute Sharpe + max drawdown for the backtester.
    Returns None on transport failure."""
    return await _get(
        f"/currencies/{currency_id}/klines?interval={interval}&limit={limit}"
    )


async def get_ssi_snapshot(ticker: str) -> dict[str, Any] | None:
    """Live snapshot for an SSI index (price, 24h change, ROI windows).
    Used as the BTC/ETH benchmark in the real backtester (an SSI index
    aggregates the asset class — better baseline than a single coin)."""
    return await _get(f"/indices/{ticker}/market-snapshot")


async def get_ssi_klines(
    ticker: str,
    interval: str = "1d",
    limit: int = 90,
) -> list[dict[str, Any]] | None:
    """Historical OHLC for an SSI index. Returns None on transport failure."""
    return await _get(
        f"/indices/{ticker}/klines?interval={interval}&limit={limit}"
    )


# ---------- adapters consumed by the LangGraph nodes ----------


def _score_from_title(title: str) -> int:
    t = title.lower()
    s = 50
    if any(w in t for w in ["jump", "surge", "breakout", "record", "grant", "launch"]):
        s += 30
    if any(w in t for w in ["down", "drop", "fall", "outflow", "hack", "exploit", "sell"]):
        s -= 35
    return max(-50, min(100, s))


def _backoff_explainer() -> str | None:
    """If SoSoValue is in a backoff window or unkeyed, return a one-line
    explanation. Same shape as the helper in basket.py — surfaced via tool
    results so the agent can tell the user 'data unavailable' instead of
    citing a synthetic placeholder."""
    if int(_seconds_until(_transient_error_until)) > 0:
        return f"SoSoValue API in 5xx outage backoff (~{_seconds_until(_transient_error_until)}s remaining)"
    if int(_seconds_until(_quota_exhausted_until)) > 0:
        return f"SoSoValue monthly quota exhausted (~{_seconds_until(_quota_exhausted_until)}s until reset)"
    if not KEY:
        return "SOSOVALUE_API_KEY not configured"
    return None


async def get_sentiment(sector: str = "DePIN", window: str = "1h") -> dict[str, Any]:
    """Sector sentiment proxy from news velocity. Score is a heuristic
    (`min(100, 40 + matches*8)`) until SoSoValue exposes a first-class
    sentiment metric. Returns `ok: false` with `data_source: 'unavailable'`
    when the API is unreachable so the agent doesn't cite the synthetic
    Filecoin/Helium fallback news as live signal."""
    # Refuse before fetching — `get_news_raw` always returns synthetic
    # fallback when transport fails, so post-hoc detection is impossible.
    # We have to short-circuit on the documented backoff state.
    explain = _backoff_explainer()
    if explain:
        return {
            "ok": False,
            "sector": sector,
            "window": window,
            "score": 0,
            "delta": 0,
            "data_source": "unavailable",
            "error": explain,
        }
    news = await get_news_raw(language="en", page_size=50)
    items = news.get("list", []) if isinstance(news, dict) else []
    # If the call landed in backoff state in the interim (e.g. our own
    # request triggered a fresh 5xx), refuse rather than score on the
    # fallback dict that get_news_raw may now be returning.
    explain = _backoff_explainer()
    if explain:
        return {
            "ok": False,
            "sector": sector,
            "window": window,
            "score": 0,
            "delta": 0,
            "data_source": "unavailable",
            "error": explain,
        }
    matching = [
        n for n in items
        if any(t.lower() == sector.lower() for t in (n.get("tags") or []))
    ]
    score = min(100, 40 + len(matching) * 8)
    return {
        "ok": True,
        "sector": sector,
        "window": window,
        "score": score,
        "delta": 15 if len(matching) >= 3 else 0,
        "matched_news_count": len(matching),
        "data_source": "live_news_velocity_proxy",
        "note": "Heuristic — score = min(100, 40 + matches*8) over /news. Not an official SoSoValue sentiment metric.",
        "ts": datetime.now(timezone.utc).isoformat(),
    }


async def get_fund_flow(sector: str = "DePIN", window: str = "24h") -> dict[str, Any]:
    """Net fund flow into a sector. REAL ETF data for BTC (via /etfs/IBIT/history);
    for other sectors SoSoValue does not currently expose per-sector flow,
    so we return `ok: false` with a clear note rather than a synthetic placeholder."""
    if sector.lower() in ("btc", "bitcoin"):
        rows = await get_etf_history("IBIT", limit=1)
        if rows:
            last = rows[0]
            return {
                "ok": True,
                "sector": sector,
                "window": window,
                "net_inflow_usd": last["net_inflow"],
                "top_asset": "BTC",
                "top_asset_flow_usd": last["net_inflow"],
                "data_source": "etf_ibit_history",
                "ts": last["date"],
            }
        explain = _backoff_explainer()
        return {
            "ok": False,
            "sector": sector,
            "window": window,
            "net_inflow_usd": 0,
            "top_asset": "?",
            "data_source": "unavailable",
            "error": explain or "ETF history unavailable",
        }
    # Non-BTC sectors: SoSoValue doesn't expose per-sector flow. Keep
    # numeric keys present (0) so the LangGraph background loop's
    # f-string `f['net_inflow_usd']:.0f` access doesn't KeyError.
    return {
        "ok": False,
        "sector": sector,
        "window": window,
        "net_inflow_usd": 0,
        "top_asset": "?",
        "data_source": "unsupported",
        "error": (
            "SoSoValue does not expose per-sector fund flow. Real ETF flow "
            "is only available for BTC (via /etfs/IBIT/history). For other "
            "sectors, use propose_basket + get_currency_snapshot to look at "
            "per-asset price/marketcap movement instead."
        ),
    }


async def get_news(sector: str = "DePIN", limit: int = 10) -> Any:
    """Real-news adapter for the chat agent. During backoff, returns
    `{ok: false, error}` instead of the synthetic Filecoin/Helium
    fallback list. Background graph.py callers handle list-or-dict
    responses defensively."""
    explain = _backoff_explainer()
    if explain:
        return {
            "ok": False,
            "sector": sector,
            "data_source": "unavailable",
            "error": explain,
            "items": [],
        }
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


# ---------------------------------------------------------------------------
# Fundraising — backed by /currencies + /currencies/{id}/fundraising.
#
# SoSoValue's `/fundraising/projects` family of endpoints returns 404 as of
# 2026-05; the per-currency `/currencies/{currency_id}/fundraising` endpoint
# is the only public OpenAPI route that still exposes funding data, so we
# probe top-N currencies and flatten/sort their disclosed rounds.
#
# Coverage limitation: this misses pre-launch / private startups (Sportix,
# Reap, etc) that sosovalue.com surfaces via its internal API — those projects
# aren't listed currencies, so they don't appear in /currencies. The chat
# agent should be aware of this when answering "what fundraised this week".
# ---------------------------------------------------------------------------


async def list_currencies() -> list[dict[str, Any]]:
    """Return the full SoSoValue currency catalog (id + name + symbol)."""
    data = await _get("/currencies")
    return data if isinstance(data, list) else []


async def get_currency_fundraising(currency_id: str) -> dict[str, Any] | None:
    """Per-currency fundraising payload (rounds, investors, team, stats)."""
    if not currency_id:
        return None
    return await _get(f"/currencies/{currency_id}/fundraising")


def _amount_millions_to_usd(v: Any) -> float:
    """Wire `amount` is millions USD. Coerce safely; non-numeric → 0."""
    if v is None or v == "":
        return 0.0
    try:
        n = float(v) if not isinstance(v, (int, float)) else float(v)
    except (ValueError, TypeError):
        return 0.0
    return n * 1_000_000


def _ts_to_iso_date(ts: Any) -> str:
    if ts is None or ts == "":
        return ""
    try:
        n = int(ts) if not isinstance(ts, int) else ts
    except (ValueError, TypeError):
        return ""
    if n < 1_000_000_000_000:
        return ""
    from datetime import datetime, timezone
    return datetime.fromtimestamp(n / 1000, tz=timezone.utc).strftime("%Y-%m-%d")


async def list_funding_rounds(
    limit: int = 20,
    probe_count: int = 60,
) -> dict[str, Any]:
    """Cross-currency funding round timeline.

    Probes the top `probe_count` currencies, flattens every disclosed round
    across them, then returns the top `limit` sorted by date descending.

    Returns:
        {
          "rounds":     [ {project_name, project_symbol, currency_id,
                          round, amount_usd, amount_display, valuation_usd,
                          date, investors[]}, ... ],
          "total_raised_usd": float,
          "projects_count":   int,
          "rounds_count":     int,
          "coverage_note":    str,  # surface the API limitation to the model
        }
    """
    currencies = await list_currencies()
    head = currencies[: max(1, int(probe_count))]

    # Parallel probe with the existing rate limiter — _get() handles serializing
    # via MIN_GAP_SEC token bucket.
    tasks = [
        get_currency_fundraising(c.get("currency_id", "")) for c in head
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    flat: list[dict[str, Any]] = []
    for c, payload in zip(head, results):
        if isinstance(payload, Exception) or not isinstance(payload, dict):
            continue
        rounds = payload.get("fundraising_rounds") or []
        if not isinstance(rounds, list):
            continue
        for r in rounds:
            if not isinstance(r, dict):
                continue
            ts_raw = r.get("timestamp")
            try:
                ts = int(ts_raw) if ts_raw not in (None, "") else 0
            except (ValueError, TypeError):
                ts = 0
            investors_raw = r.get("investors") or []
            investors = [
                {
                    "name": (inv.get("name") or "").strip(),
                    "is_lead": bool(inv.get("is_lead_investor")),
                    "type": inv.get("type"),
                }
                for inv in investors_raw
                if isinstance(inv, dict) and inv.get("name")
            ]
            flat.append({
                "project_name": c.get("name"),
                "project_symbol": (c.get("symbol") or "").upper() or None,
                "currency_id": c.get("currency_id"),
                "round": (r.get("round") or "").strip() or "Disclosed",
                "amount_usd": _amount_millions_to_usd(r.get("amount")),
                "amount_display": r.get("amount_display"),
                "valuation_usd": _amount_millions_to_usd(r.get("valuation")),
                "date": _ts_to_iso_date(ts),
                "_ts": ts,
                "investors": investors,
            })

    flat.sort(key=lambda e: e["_ts"], reverse=True)
    for e in flat:
        e.pop("_ts", None)

    truncated = flat[: max(1, int(limit))]
    total_raised = sum(e["amount_usd"] for e in flat)
    projects = {e["project_name"] for e in flat if e.get("project_name")}

    return {
        "rounds": truncated,
        "total_raised_usd": total_raised,
        "projects_count": len(projects),
        "rounds_count": len(flat),
        "coverage_note": (
            f"Probed top {len(head)} currencies on SoSoValue. Only listed "
            "currencies are exposed via /currencies; pre-launch / private "
            "startups visible on sosovalue.com/assets/fundraising (sourced "
            "from RootData) are NOT reachable via OpenAPI."
        ),
    }
