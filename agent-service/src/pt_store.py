"""Best-effort writer for strategy track-record tables (pt_rebalances + pt_trades).

Mirrors agent-service/src/vault/store.py's SupabaseRestStore pattern:
  - PostgREST over httpx with service-role key
  - Returns None and never raises (best-effort, cycle must never crash)

When SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is unset, insert_rebalance is a
no-op so the agent runs safely without Supabase configured.
"""
from __future__ import annotations

import os
from typing import Any

import httpx

_SUPABASE_URL = os.environ.get("SUPABASE_URL", "").strip()
_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()


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


def _is_configured() -> bool:
    """Return True only when both Supabase env vars are set and non-empty."""
    return bool(
        os.environ.get("SUPABASE_URL", "").strip()
        and os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    )


def _maybe_float(v: Any) -> float | None:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _maybe_int(v: Any) -> int | None:
    if v is None:
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def _build_rebalance_row(state: dict[str, Any], sodex_txs: list[dict[str, Any]]) -> dict[str, Any]:
    """Extract pt_rebalances columns from the agent cycle state dict."""
    risk = state.get("risk") or {}
    ssi_tx = state.get("ssi_tx") or {}
    sentiment = state.get("sentiment") or {}
    placed = sum(1 for t in sodex_txs if t.get("ok"))
    skipped = sum(1 for t in sodex_txs if t.get("skipped"))
    errors = sum(1 for t in sodex_txs if not (t.get("ok") or t.get("skipped")))
    return {
        "sector": state.get("sector") or "",
        "ssi_ticker": state.get("ssi_ticker"),
        "creator_address": state.get("creator_address"),
        "basket_before": state.get("basket_before"),
        "basket_after": state.get("basket") if state.get("basket") else None,
        "strategy_source": state.get("strategy_source"),
        "sentiment_score": _maybe_float(sentiment.get("score")),
        "risk_verdict": risk.get("verdict"),
        "ssi_tx_hash": ssi_tx.get("tx_hash"),
        "sodex_placed": placed,
        "sodex_skipped": skipped,
        "sodex_errors": errors,
        "emergency": bool(state.get("emergency")),
    }


def _build_trade_rows(rebalance_id: str, sodex_txs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Map per-asset tx dicts to pt_trades rows."""
    rows = []
    for tx in sodex_txs:
        rows.append({
            "rebalance_id": rebalance_id,
            "symbol": tx.get("symbol"),
            "weight": _maybe_float(tx.get("weight")),
            "amount_in_usdc": _maybe_float(tx.get("amount_in_usdc")),
            "limit_price": str(tx["limit_price"]) if tx.get("limit_price") is not None else None,
            "last_price": str(tx["last_price"]) if tx.get("last_price") is not None else None,
            "quantity": str(tx["quantity"]) if tx.get("quantity") is not None else None,
            "notional": _maybe_float(tx.get("notional")),
            "gas_val": _maybe_float(tx.get("gas_val")),
            "latency_ms": _maybe_int(tx.get("latency_ms")),
            "order_id": str(tx["order_id"]) if tx.get("order_id") is not None else None,
            "cl_ord_id": tx.get("cl_ord_id"),
            "pair": tx.get("pair"),
            "mode": tx.get("mode", "spot"),
            "status": "placed" if tx.get("ok") else ("skipped" if tx.get("skipped") else "error"),
            "error": tx.get("error") or tx.get("reason"),
        })
    return rows


async def insert_rebalance(state: dict[str, Any], sodex_txs: list[dict[str, Any]]) -> None:
    """Write one pt_rebalances row and its pt_trades children to Supabase.

    No-op (silent return) when SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is
    unset. Never raises — any exception is swallowed so the cycle always
    continues.
    """
    if not _is_configured():
        return

    try:
        rebalance_row = _build_rebalance_row(state, sodex_txs)
        async with httpx.AsyncClient(timeout=15) as client:
            # Insert pt_rebalances; ask PostgREST to return the new row.
            r = await client.post(
                f"{_base()}/pt_rebalances",
                json=rebalance_row,
                headers=_headers(),
            )
            r.raise_for_status()
            inserted = r.json()
            # PostgREST with Prefer: return=representation returns a list.
            if isinstance(inserted, list) and inserted:
                rebalance_id = inserted[0]["id"]
            elif isinstance(inserted, dict):
                rebalance_id = inserted["id"]
            else:
                # Shouldn't happen, but bail silently.
                return

            # Insert pt_trades rows (if any).
            if sodex_txs:
                trade_rows = _build_trade_rows(rebalance_id, sodex_txs)
                tr = await client.post(
                    f"{_base()}/pt_trades",
                    json=trade_rows,
                    headers=_headers(),
                )
                tr.raise_for_status()
    except Exception:  # noqa: BLE001 — best-effort, never crash the cycle
        pass
