"""Real basket proposer — replaces Claude's training-data recall with
SSI Protocol's actual constituent list.

Flow:
    1. Map sector name → SSI ticker (DePIN → ssiDePIN, etc.)
    2. Pull current constituents from `/indices/{ticker}/constituents`
       (real list of asset_ids + symbols + reference weights)
    3. Pull live snapshot for each constituent in parallel (price, mcap,
       24h change, marketcap_rank)
    4. Score each: composite of size + momentum
         score = log10(mcap) * (1 + change_pct_24h)
       Bigger + rising → higher score. Falling assets stay if mcap is
       large enough; small caps need positive momentum to survive.
    5. Pick top N, normalize scores → weights (sums to 1.0).
    6. Surface excluded assets (no snapshot / failed fetch) so the agent
       can flag data gaps rather than pretend.

The agent calls `propose_basket(sector, n_assets)`. To run a full pipeline,
chain into `run_real_backtest(result["constituents"])`.
"""

from __future__ import annotations

import asyncio
import math
from typing import Any

from . import terminal


# Mirror of `SECTOR_TO_SSI` in terminal.py — adds explicit alias forms the
# model is likely to use ("L1" / "Layer1" / "layer1"). Lookup is case-
# insensitive at the entry point.
SECTOR_ALIASES: dict[str, str] = {
    "depin": "ssiDePIN",
    "rwa": "ssiRWA",
    "ai": "ssiAI",
    "memes": "ssiMeme",
    "meme": "ssiMeme",
    "gaming": "ssiGameFi",
    "gamefi": "ssiGameFi",
    "defi": "ssiDeFi",
    "l1": "ssiLayer1",
    "layer1": "ssiLayer1",
    "l2": "ssiLayer2",
    "layer2": "ssiLayer2",
    "nft": "ssiNFT",
    "cefi": "ssiCeFi",
    "payfi": "ssiPayFi",
    "socialfi": "ssiSocialFi",
    "mag7": "ssiMAG7",
}


def _resolve_ticker(sector_or_ticker: str) -> str | None:
    s = (sector_or_ticker or "").strip()
    if not s:
        return None
    # If the model already passes an SSI ticker, accept it as-is.
    if s.lower().startswith("ssi"):
        return s if s.startswith("ssi") else "ssi" + s[3:]
    return SECTOR_ALIASES.get(s.lower().replace(" ", ""))


def _is_real_currency_id(cid: Any) -> bool:
    """SoSoValue currency_ids are 19-char numeric strings (e.g. the BTC id
    is '1673723677362319867'). The synthetic fallback in
    `terminal.get_ssi_constituents` uses '1'/'2'. Filter those out so we
    can distinguish 'real data, no usable snapshots' from 'we never got
    real data in the first place'."""
    s = str(cid or "")
    return s.isdigit() and len(s) >= 15


def _backoff_explainer() -> str | None:
    """If SoSoValue is currently in a backoff window, return a one-line
    user-facing explanation. Otherwise None."""
    try:
        st = terminal.status()
    except Exception:
        return None
    backoff = st.get("backoff", {}) or {}
    if int(backoff.get("transient_error_for_sec", 0)) > 0:
        return (
            f"SoSoValue API in 5xx outage backoff "
            f"(~{backoff['transient_error_for_sec']}s remaining)"
        )
    if int(backoff.get("quota_exhausted_for_sec", 0)) > 0:
        return (
            f"SoSoValue monthly quota exhausted "
            f"(~{backoff['quota_exhausted_for_sec']}s until reset)"
        )
    if not st.get("has_api_key"):
        return "SOSOVALUE_API_KEY not configured — cannot fetch live data"
    return None


def _composite_score(snapshot: dict[str, Any]) -> float | None:
    """log10(mcap) × (1 + change_pct_24h). None if mcap is missing/zero."""
    try:
        mcap = float(snapshot.get("marketcap", 0) or 0)
        if mcap <= 0:
            return None
        change = float(snapshot.get("change_pct_24h", 0) or 0)
        # Floor the multiplier at 0.1 so a -90% day doesn't produce
        # negative scores that break the weight normalization.
        multiplier = max(0.1, 1.0 + change)
        return math.log10(mcap) * multiplier
    except (TypeError, ValueError):
        return None


async def propose_basket(
    sector: str,
    n_assets: int = 8,
    weighting: str = "score",
) -> dict[str, Any]:
    """Build a real, on-chain-grounded basket proposal for a sector.

    Returns either `{ok: True, ...}` with `constituents` ready to feed into
    `run_real_backtest`, or `{ok: False, error, ...}` if the sector can't
    be resolved or the underlying SSI index has no constituents.
    """
    ticker = _resolve_ticker(sector)
    if not ticker:
        return {
            "ok": False,
            "error": f"unknown sector '{sector}' — no SSI index mapping",
            "known_sectors": sorted(set(SECTOR_ALIASES.values())),
        }

    raw = await terminal.get_ssi_constituents(ticker)
    if not raw:
        return {
            "ok": False,
            "error": f"no constituents returned for {ticker}",
            "ticker": ticker,
        }

    # Filter to real constituents — the underlying terminal helper falls
    # back to a synthetic [btc, eth] list when the API is unreachable or
    # un-keyed. We refuse to dress up that fallback as a real basket.
    real_raw = [c for c in raw if _is_real_currency_id(c.get("currency_id"))]
    if not real_raw:
        explain = _backoff_explainer()
        return {
            "ok": False,
            "error": (
                f"no live constituents available for {ticker}"
                + (f" — {explain}" if explain else "")
            ),
            "ticker": ticker,
        }

    # Fan out snapshot fetches in parallel. The transport layer enforces
    # the SoSoValue rate gate, so this self-paces correctly.
    snapshots = await asyncio.gather(
        *[terminal.get_currency_snapshot(c["currency_id"]) for c in real_raw],
        return_exceptions=True,
    )

    scored: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    for c, snap in zip(real_raw, snapshots):
        if isinstance(snap, Exception) or not isinstance(snap, dict):
            skipped.append({"symbol": c.get("symbol"), "reason": "snapshot fetch failed"})
            continue
        score = _composite_score(snap)
        if score is None:
            skipped.append({"symbol": c.get("symbol"), "reason": "missing marketcap"})
            continue
        scored.append(
            {
                "currency_id": c["currency_id"],
                "symbol": c.get("symbol"),
                "score": score,
                "marketcap": float(snap.get("marketcap", 0) or 0),
                "price": float(snap.get("price", 0) or 0),
                "change_pct_24h": float(snap.get("change_pct_24h", 0) or 0),
                "marketcap_rank": snap.get("marketcap_rank"),
                "ssi_reference_weight": float(c.get("weight", 0) or 0),
            }
        )

    if not scored:
        explain = _backoff_explainer()
        return {
            "ok": False,
            "error": (
                "no constituents had usable snapshots"
                + (f" — {explain}" if explain else "")
            ),
            "ticker": ticker,
            "skipped": skipped,
        }

    # Take top N by composite score, then renormalize to sum to 1.0.
    scored.sort(key=lambda x: x["score"], reverse=True)
    top = scored[: max(1, min(int(n_assets), len(scored)))]

    if weighting == "equal":
        weights = [1.0 / len(top)] * len(top)
    elif weighting == "marketcap":
        total_mcap = sum(a["marketcap"] for a in top) or 1.0
        weights = [a["marketcap"] / total_mcap for a in top]
    elif weighting == "ssi_reference":
        # Use SSI Protocol's own reference weights — most "official" option.
        ref_total = sum(a["ssi_reference_weight"] for a in top) or 1.0
        weights = [a["ssi_reference_weight"] / ref_total for a in top]
    else:
        # default: composite score
        total = sum(a["score"] for a in top) or 1.0
        weights = [a["score"] / total for a in top]

    constituents = [
        {
            "currency_id": a["currency_id"],
            "symbol": a["symbol"],
            "weight": round(w, 4),
            "marketcap": a["marketcap"],
            "change_pct_24h": round(a["change_pct_24h"], 4),
            "marketcap_rank": a["marketcap_rank"],
        }
        for a, w in zip(top, weights)
    ]

    return {
        "ok": True,
        "ticker": ticker,
        "weighting": weighting,
        "n_pool": len(scored),
        "n_picked": len(top),
        "constituents": constituents,
        "skipped": skipped,
        # Convenience aggregate so the model can render the basket without
        # iterating constituents itself.
        "summary": {
            "symbols": [c["symbol"] for c in constituents],
            "weights_pct": [round(c["weight"] * 100, 1) for c in constituents],
            "total_marketcap_usd": sum(c["marketcap"] for c in constituents),
            "avg_change_24h_pct": round(
                sum(c["change_pct_24h"] for c in constituents) / len(constituents) * 100,
                2,
            ),
        },
    }
