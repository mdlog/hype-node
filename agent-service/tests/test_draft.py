"""TDD tests for draft.py — written FIRST (red), then implemented (green).

Covers:
  - should_draft: threshold boundary, already_drafted guard
  - build_proposal_row: required fields, source/status defaults, sane title/thesis
"""
from __future__ import annotations

import pytest


# ── should_draft ───────────────────────────────────────────────────────────────

def test_should_draft_at_threshold_returns_true():
    """Exactly at threshold (60.0) should return True."""
    from src.draft import should_draft
    assert should_draft(60.0) is True


def test_should_draft_above_threshold_returns_true():
    """Well above threshold should return True."""
    from src.draft import should_draft
    assert should_draft(85.5) is True


def test_should_draft_below_threshold_returns_false():
    """59.9 (just below 60.0 default) should return False."""
    from src.draft import should_draft
    assert should_draft(59.9) is False


def test_should_draft_zero_returns_false():
    """Score 0 is always below threshold."""
    from src.draft import should_draft
    assert should_draft(0.0) is False


def test_should_draft_custom_threshold():
    """Custom threshold respected: 59.0 with threshold=59 → True."""
    from src.draft import should_draft
    assert should_draft(59.0, threshold=59.0) is True


def test_should_draft_already_drafted_returns_false():
    """Even if score >= threshold, already_drafted=True → False."""
    from src.draft import should_draft
    assert should_draft(60.0, already_drafted=True) is False


def test_should_draft_already_drafted_with_high_score():
    """already_drafted overrides even a very high score."""
    from src.draft import should_draft
    assert should_draft(99.9, already_drafted=True) is False


# ── build_proposal_row ────────────────────────────────────────────────────────

MOCK_BASKET = {
    "ok": True,
    "ticker": "ssiDePIN",
    "weighting": "score",
    "n_pool": 10,
    "n_picked": 5,
    "constituents": [
        {"currency_id": "1673723677362319867", "symbol": "RNDR", "weight": 0.35, "marketcap": 1e9, "change_pct_24h": 2.1, "marketcap_rank": 42},
        {"currency_id": "1673723677362319868", "symbol": "FIL", "weight": 0.25, "marketcap": 8e8, "change_pct_24h": 1.5, "marketcap_rank": 50},
        {"currency_id": "1673723677362319869", "symbol": "HNT", "weight": 0.40, "marketcap": 5e8, "change_pct_24h": 3.0, "marketcap_rank": 60},
    ],
    "skipped": [],
    "summary": {
        "symbols": ["RNDR", "FIL", "HNT"],
        "weights_pct": [35.0, 25.0, 40.0],
        "total_marketcap_usd": 2.3e9,
        "avg_change_24h_pct": 2.2,
    },
}

MOCK_SENTIMENT = {
    "score": 72.5,
    "delta": 5.0,
    "label": "bullish",
    "window": "1h",
}

CREATOR = "0xDeadBeef1234567890DeadBeef1234567890aBcD"


def test_build_proposal_row_has_creator_address():
    from src.draft import build_proposal_row
    row = build_proposal_row("DePIN", MOCK_BASKET, MOCK_SENTIMENT, CREATOR)
    assert row["creator_address"] == CREATOR


def test_build_proposal_row_has_ssi_ticker():
    from src.draft import build_proposal_row
    row = build_proposal_row("DePIN", MOCK_BASKET, MOCK_SENTIMENT, CREATOR)
    assert row["ssi_ticker"] == "ssiDePIN"


def test_build_proposal_row_has_constituents():
    from src.draft import build_proposal_row
    row = build_proposal_row("DePIN", MOCK_BASKET, MOCK_SENTIMENT, CREATOR)
    assert isinstance(row["constituents"], list)
    assert len(row["constituents"]) == 3
    # Each constituent has a symbol and weight
    for c in row["constituents"]:
        assert "symbol" in c
        assert "weight" in c


def test_build_proposal_row_source_is_hype_radar():
    from src.draft import build_proposal_row
    row = build_proposal_row("DePIN", MOCK_BASKET, MOCK_SENTIMENT, CREATOR)
    assert row["source"] == "hype_radar"


def test_build_proposal_row_status_is_draft():
    from src.draft import build_proposal_row
    row = build_proposal_row("DePIN", MOCK_BASKET, MOCK_SENTIMENT, CREATOR)
    assert row["status"] == "draft"


def test_build_proposal_row_has_non_empty_title():
    from src.draft import build_proposal_row
    row = build_proposal_row("DePIN", MOCK_BASKET, MOCK_SENTIMENT, CREATOR)
    assert isinstance(row.get("title"), str)
    assert len(row["title"]) > 0


def test_build_proposal_row_has_non_empty_thesis():
    from src.draft import build_proposal_row
    row = build_proposal_row("DePIN", MOCK_BASKET, MOCK_SENTIMENT, CREATOR)
    assert isinstance(row.get("thesis"), str)
    assert len(row["thesis"]) > 0


def test_build_proposal_row_title_contains_sector():
    from src.draft import build_proposal_row
    row = build_proposal_row("DePIN", MOCK_BASKET, MOCK_SENTIMENT, CREATOR)
    assert "DePIN" in row["title"]


def test_build_proposal_row_has_meta():
    from src.draft import build_proposal_row
    row = build_proposal_row("DePIN", MOCK_BASKET, MOCK_SENTIMENT, CREATOR)
    assert isinstance(row.get("meta"), dict)
    # meta should carry sentiment info
    assert "sentiment_score" in row["meta"]


def test_build_proposal_row_custom_source():
    from src.draft import build_proposal_row
    row = build_proposal_row("DePIN", MOCK_BASKET, MOCK_SENTIMENT, CREATOR, source="agent_draft")
    assert row["source"] == "agent_draft"


def test_build_proposal_row_basket_not_ok_raises():
    """build_proposal_row with basket ok=False should raise ValueError."""
    from src.draft import build_proposal_row
    bad_basket = {"ok": False, "error": "no data"}
    with pytest.raises((ValueError, KeyError)):
        build_proposal_row("DePIN", bad_basket, MOCK_SENTIMENT, CREATOR)
