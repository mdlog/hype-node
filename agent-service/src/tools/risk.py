"""Risk gate — checks volatility / drawdown / sentiment / flow thresholds.

Returns a verdict the LangGraph router uses to either continue to SSI wrap
or short-circuit to the emergency-exit branch (USSI hedge)."""

from __future__ import annotations

from typing import Any


DEFAULT_THRESHOLDS = {
    "volatility_max": 0.35,
    "drawdown_max": 0.15,
    "sentiment_delta_min": -20,
    "single_asset_weight_max": 0.25,
    "net_outflow_24h_max_usd": 5_000_000,
}


async def check_thresholds(metrics: dict[str, Any], thresholds: dict[str, Any] | None = None) -> dict[str, Any]:
    cfg = {**DEFAULT_THRESHOLDS, **(thresholds or {})}
    breaches: list[dict[str, Any]] = []

    vol = float(metrics.get("volatility", 0))
    if vol > cfg["volatility_max"]:
        breaches.append({"k": "volatility", "v": vol, "limit": cfg["volatility_max"]})

    dd = float(metrics.get("drawdown", 0))
    if dd > cfg["drawdown_max"]:
        breaches.append({"k": "drawdown", "v": dd, "limit": cfg["drawdown_max"]})

    sd = float(metrics.get("sentiment_delta", 0))
    if sd < cfg["sentiment_delta_min"]:
        breaches.append({"k": "sentiment_delta", "v": sd, "limit": cfg["sentiment_delta_min"]})

    weights = metrics.get("weights") or {}
    for sym, w in weights.items():
        if float(w) > cfg["single_asset_weight_max"]:
            breaches.append({"k": "single_weight", "asset": sym, "v": w, "limit": cfg["single_asset_weight_max"]})

    out_24h = float(metrics.get("net_outflow_24h_usd", 0))
    if out_24h > cfg["net_outflow_24h_max_usd"]:
        breaches.append({
            "k": "net_outflow",
            "v": out_24h,
            "limit": cfg["net_outflow_24h_max_usd"],
        })

    return {
        "ok": not breaches,
        "breaches": breaches,
        "verdict": "PASS" if not breaches else "EMERGENCY_EXIT",
        "thresholds": cfg,
    }
