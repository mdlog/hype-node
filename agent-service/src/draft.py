"""Hype-Radar auto-draft helpers: pure logic + PostgREST write path.

Three public symbols:

  should_draft(sentiment_score, threshold, already_drafted) -> bool
      Pure predicate — no I/O. Determines whether the current cycle is
      eligible to produce an auto-draft proposal.

  build_proposal_row(sector, basket_result, sentiment, creator_address,
                     source="hype_radar") -> dict
      Pure builder — no I/O. Constructs a pb_proposals INSERT row from the
      propose_basket() output (basket_result) and get_sentiment() output
      (sentiment). Raises ValueError when basket_result["ok"] is falsy.

      Input contract:
        basket_result — dict returned by basket.propose_basket():
          {ok, ticker, constituents: [{symbol, weight, ...}], summary, ...}
        sentiment — dict returned by terminal.get_sentiment():
          {score, delta, label, window}

  insert_pb_proposal(row) -> None  (async)
      Best-effort PostgREST POST → {SUPABASE_URL}/rest/v1/pb_proposals.
      No-op when SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is unset, or when
      row["creator_address"] is falsy. Never raises.

ENV vars read:
  SUPABASE_URL                — Supabase project URL (required to write)
  SUPABASE_SERVICE_ROLE_KEY   — service-role key   (required to write)
"""
from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any


# ── Pure helpers ──────────────────────────────────────────────────────────────

def should_draft(
    sentiment_score: float,
    threshold: float = 60.0,
    already_drafted: bool = False,
) -> bool:
    """Return True iff this cycle should emit an auto-draft proposal.

    Rules (all must hold):
      1. sentiment_score >= threshold  (at-boundary is included)
      2. already_drafted is False      (dedup — one draft per sector/day)

    Args:
        sentiment_score: Numeric sentiment from terminal.get_sentiment()["score"].
        threshold:       Minimum score required (default 60.0).
        already_drafted: True if a draft was already emitted today for this
                         (sector, utc_date) pair.
    """
    if already_drafted:
        return False
    return sentiment_score >= threshold


def build_proposal_row(
    sector: str,
    basket_result: dict[str, Any],
    sentiment: dict[str, Any],
    creator_address: str,
    source: str = "hype_radar",
) -> dict[str, Any]:
    """Build a pb_proposals INSERT dict from cycle state.

    Args:
        sector:          Human-readable sector label (e.g. "DePIN").
        basket_result:   Output of basket.propose_basket() — must have ok=True.
                         Key fields used: ticker, constituents, summary.
        sentiment:       Output of terminal.get_sentiment().
                         Key fields used: score, delta, label.
        creator_address: On-chain address that will own the proposal.
        source:          pb_proposals.source value; default "hype_radar".

    Returns:
        dict ready for httpx POST to pb_proposals (PostgREST INSERT).

    Raises:
        ValueError: if basket_result["ok"] is falsy (no valid basket data).
    """
    if not basket_result.get("ok"):
        raise ValueError(
            f"Cannot build proposal: basket_result.ok is falsy — {basket_result.get('error', 'unknown error')}"
        )

    ticker: str = basket_result["ticker"]
    constituents: list[dict] = basket_result["constituents"]
    summary: dict = basket_result.get("summary") or {}

    score: float = float(sentiment.get("score") or 0.0)
    delta: float = float(sentiment.get("delta") or 0.0)
    label: str = str(sentiment.get("label") or "neutral")

    # Build a concise, human-readable title and thesis.
    top_symbols = summary.get("symbols") or [c["symbol"] for c in constituents[:3]]
    top_3 = ", ".join(top_symbols[:3])
    sign = "+" if delta >= 0 else ""

    title = (
        f"{sector} Auto-Draft — {ticker} basket "
        f"(sentiment {score:.0f}, {label})"
    )

    thesis = (
        f"Hype-Radar detected elevated sentiment ({score:.1f}/100, {sign}{delta:.1f} delta) "
        f"in the {sector} sector. "
        f"The proposed basket for {ticker} includes {len(constituents)} assets "
        f"(top: {top_3}) weighted by composite score. "
        f"Source: agent auto-draft triggered by sentiment threshold."
    )

    meta: dict[str, Any] = {
        "sentiment_score": score,
        "sentiment_delta": delta,
        "sentiment_label": label,
        "sentiment_window": sentiment.get("window"),
        "n_pool": basket_result.get("n_pool"),
        "n_picked": basket_result.get("n_picked"),
        "weighting": basket_result.get("weighting"),
        "auto_draft": True,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }

    return {
        "creator_address": creator_address,
        "ssi_ticker": ticker,
        "title": title,
        "thesis": thesis,
        "constituents": constituents,
        "source": source,
        "status": "draft",
        "meta": meta,
    }


# ── PostgREST write path ──────────────────────────────────────────────────────

def _is_configured() -> bool:
    """Return True only when both Supabase env vars are set and non-empty."""
    return bool(
        os.environ.get("SUPABASE_URL", "").strip()
        and os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    )


def _headers() -> dict[str, str]:
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }


def _base() -> str:
    url = os.environ.get("SUPABASE_URL", "").strip()
    return url.rstrip("/") + "/rest/v1"


async def insert_pb_proposal(row: dict[str, Any]) -> None:
    """POST a pb_proposals row to Supabase via PostgREST.

    No-op when:
      - SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is unset
      - row["creator_address"] is falsy (misconfigured agent)
    Never raises — any error is swallowed so the agent loop continues.
    """
    if not _is_configured():
        return
    if not (row or {}).get("creator_address"):
        return

    try:
        import httpx

        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post(
                f"{_base()}/pb_proposals",
                json=row,
                headers=_headers(),
            )
            r.raise_for_status()
    except Exception:  # noqa: BLE001 — best-effort, never crash the cycle
        pass
