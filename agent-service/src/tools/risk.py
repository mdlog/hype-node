"""Risk gate — checks volatility / drawdown / sentiment / flow thresholds.

Returns a verdict the LangGraph router uses to either continue to SSI wrap
or short-circuit to the emergency-exit branch (USSI hedge).

Configuration arrives from the SQLite-backed `store.get_risk_config()` so the
user can update thresholds + toggle individual rules from the UI without
restarting the service. The `DEFAULT_THRESHOLDS` here is only used when no
config is supplied (e.g. from one-shot `/run` calls in tests)."""

from __future__ import annotations

from typing import Any


DEFAULT_THRESHOLDS = {
    "volatility_max": 0.35,
    "drawdown_max": 0.15,
    "sentiment_delta_min": -20,
    "single_asset_weight_max": 0.25,
    "net_outflow_24h_max_usd": 5_000_000,
    # Per-rule enable flags. When false, that rule's check is skipped — useful
    # when the user temporarily silences a noisy threshold rather than
    # widening the bound. `manual_override` short-circuits the entire gate to
    # PASS so an operator can force a rebalance through (with a logged note
    # in the verdict).
    "rule_volatility_enabled": True,
    "rule_drawdown_enabled": True,
    "rule_sentiment_enabled": True,
    "rule_weight_enabled": True,
    "rule_outflow_enabled": True,
    "manual_override": False,
}


async def check_thresholds(metrics: dict[str, Any], thresholds: dict[str, Any] | None = None) -> dict[str, Any]:
    cfg = {**DEFAULT_THRESHOLDS, **(thresholds or {})}

    if bool(cfg.get("manual_override")):
        # Honor the operator's override but stamp the verdict so the audit
        # trail still tells reviewers a human bypassed the gate.
        return {
            "ok": True,
            "breaches": [],
            "verdict": "MANUAL_OVERRIDE",
            "thresholds": cfg,
            "skipped_rules": [],
        }

    breaches: list[dict[str, Any]] = []
    skipped_rules: list[str] = []

    if cfg.get("rule_volatility_enabled", True):
        vol = float(metrics.get("volatility", 0))
        if vol > cfg["volatility_max"]:
            breaches.append({"k": "volatility", "v": vol, "limit": cfg["volatility_max"]})
    else:
        skipped_rules.append("volatility")

    if cfg.get("rule_drawdown_enabled", True):
        dd = float(metrics.get("drawdown", 0))
        if dd > cfg["drawdown_max"]:
            breaches.append({"k": "drawdown", "v": dd, "limit": cfg["drawdown_max"]})
    else:
        skipped_rules.append("drawdown")

    if cfg.get("rule_sentiment_enabled", True):
        sd = float(metrics.get("sentiment_delta", 0))
        if sd < cfg["sentiment_delta_min"]:
            breaches.append({"k": "sentiment_delta", "v": sd, "limit": cfg["sentiment_delta_min"]})
    else:
        skipped_rules.append("sentiment_delta")

    if cfg.get("rule_weight_enabled", True):
        weights = metrics.get("weights") or {}
        for sym, w in weights.items():
            if float(w) > cfg["single_asset_weight_max"]:
                breaches.append(
                    {"k": "single_weight", "asset": sym, "v": w, "limit": cfg["single_asset_weight_max"]}
                )
    else:
        skipped_rules.append("single_weight")

    if cfg.get("rule_outflow_enabled", True):
        out_24h = float(metrics.get("net_outflow_24h_usd", 0))
        if out_24h > cfg["net_outflow_24h_max_usd"]:
            breaches.append(
                {"k": "net_outflow", "v": out_24h, "limit": cfg["net_outflow_24h_max_usd"]}
            )
    else:
        skipped_rules.append("net_outflow")

    return {
        "ok": not breaches,
        "breaches": breaches,
        "verdict": "PASS" if not breaches else "EMERGENCY_EXIT",
        "thresholds": cfg,
        "skipped_rules": skipped_rules,
    }
