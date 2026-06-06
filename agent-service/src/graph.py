"""LangGraph state machine for the autonomous research-to-execution loop.

10 nodes mirror the Agent Console UI:
    signal → sentiment → flow → strategy → backtest → risk → wrap → exec → loop
                                                          └─ emergency_exit (USSI)

State carries the latest sentiment, flow, basket, backtest, risk verdict and
agent reasoning trace. Each node appends a `ReasoningEntry` so the frontend can
stream the log."""

from __future__ import annotations

import asyncio
import os
from datetime import datetime, timezone
from typing import Any, TypedDict

from langgraph.graph import END, START, StateGraph

from . import store
from .tools import backtest as bt
from .tools import risk as risk_tool
from .tools import sodex
from .tools import ssi
from .tools import terminal
from .tools.sodex_policy import (
    MAX_TRADE_ATTEMPTS,
    backoff_seconds,
    classify_trade_result,
)
from .strategy_agent import run_strategy_agent

# Total USDC notional spread across basket constituents per rebalance cycle.
EXEC_NOTIONAL_USDC = float(os.getenv("AGENT_EXEC_NOTIONAL_USDC", "50"))


class HypeState(TypedDict, total=False):
    sector: str
    sentiment: dict[str, Any]
    flow: dict[str, Any]
    news: list[dict[str, Any]]
    basket: dict[str, float]
    backtest: dict[str, Any]
    risk: dict[str, Any]
    ssi_tx: dict[str, Any]
    sodex_txs: list[dict[str, Any]]
    emergency: bool
    log: list[dict[str, Any]]
    current_node: str


def _log(state: HypeState, kind: str, text: str, url: str | None = None) -> HypeState:
    entry: dict[str, Any] = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "kind": kind,
        "text": text,
    }
    if url:
        entry["url"] = url
    state.setdefault("log", []).append(entry)
    return state


async def signal_listener(state: HypeState) -> HypeState:
    state["current_node"] = "signal"
    return _log(state, "TOOL", "signal_listener · polling 2s for new sector spikes")


async def sentiment_node(state: HypeState) -> HypeState:
    state["current_node"] = "sentiment"
    s = await terminal.get_sentiment(state.get("sector", "DePIN"))
    state["sentiment"] = s
    return _log(state, "OBS", f"sentiment · {s['sector']} score={s['score']} Δ={s['delta']}")


async def flow_node(state: HypeState) -> HypeState:
    state["current_node"] = "flow"
    f = await terminal.get_fund_flow(state.get("sector", "DePIN"))
    state["flow"] = f
    return _log(
        state,
        "OBS",
        f"flow · net_inflow={f['net_inflow_usd']:.0f} top={f['top_asset']}",
    )


async def strategy_node(state: HypeState) -> HypeState:
    """Compose the basket for this cycle.

    Replaces the legacy `if sentiment < 60: idle` rule with a Claude tool-use
    loop (see strategy_agent.py). Claude has access to read-only SoSoValue
    tools — sentiment, fund flow, news, SSI constituents, run_backtest — and
    decides composition + confidence. Tool calls + reasoning stream live to
    the /agent page via strategy_agent's emitter.

    Hard floor at sentiment < 30: skip Claude entirely and idle to save tokens
    on cycles that clearly aren't going anywhere. Above that, defer judgment
    to the LLM (it can override with delta + flow context).

    On any failure (no API key, Claude error, max_iter exceeded), the agent
    returns a rule-based fallback basket so the LangGraph loop never stalls.
    """
    state["current_node"] = "strategy"
    sentiment_score = state.get("sentiment", {}).get("score", 0)
    sector = state.get("sector", "DePIN")

    # Hard floor — below this, even Claude can't talk us into a basket and
    # spending tokens reasoning about an empty signal is wasteful.
    if sentiment_score < 30:
        state["basket"] = {}
        state["idle"] = True
        state["strategy_source"] = "rule_floor"
        return _log(
            state,
            "THINK",
            f"basket · idle (sentiment {sentiment_score} < 30 hard floor — skipping LLM)",
        )

    try:
        result = await run_strategy_agent(sector)
    except Exception as exc:  # noqa: BLE001 — last-resort safety net
        _log(state, "WAIT", f"strategy_agent crashed: {exc}")
        result = {
            "basket": {"BTC": 0.5, "ETH": 0.3, "SOL": 0.2},
            "reasoning": "post-crash fallback",
            "confidence": "low",
            "source": "fallback",
        }

    basket = result.get("basket") or {}
    state["basket"] = basket
    state["idle"] = len(basket) == 0
    state["strategy_source"] = result.get("source", "fallback")
    state["strategy_confidence"] = result.get("confidence", "low")
    state["strategy_reasoning"] = result.get("reasoning", "")

    if basket:
        top_sym, top_w = max(basket.items(), key=lambda kv: kv[1])
        return _log(
            state,
            "THINK",
            f"basket · {result.get('source')}-driven N={len(basket)} "
            f"top {top_sym}@{top_w:.0%} conf={result.get('confidence')}",
        )
    return _log(state, "THINK", f"basket · idle ({result.get('source')})")


async def backtest_node(state: HypeState) -> HypeState:
    state["current_node"] = "backtest"
    # Legacy `bt.run()` returned synthetic equity curves that misled the
    # downstream risk gate. Now it returns `{ok: False, ...}` with neutral
    # zero metrics. Real backtests run via run_real_backtest(constituents)
    # in the chat agent path; the autonomous loop here records the skip
    # rather than fabricating numbers. Risk_node already uses .get() with
    # safe defaults, so a zero drawdown won't trip rules.
    res = await bt.run(strategy_id="hdp8", days=90, n_assets=len(state.get("basket", {}) or {1: 1}))
    state["backtest"] = res
    if res.get("ok") is False:
        return _log(state, "WAIT", "backtest · skipped (real backtest path not wired in autonomous loop)")
    return _log(
        state,
        "OBS",
        f"backtest · sharpe={res['sharpe']} dd={res['max_drawdown']} win={res['win_rate']}",
    )


async def risk_node(state: HypeState) -> HypeState:
    state["current_node"] = "risk"
    metrics = {
        "volatility": 0.18,
        "drawdown": abs(state.get("backtest", {}).get("max_drawdown", 0)),
        "sentiment_delta": state.get("sentiment", {}).get("delta", 0),
        "weights": state.get("basket", {}),
        "net_outflow_24h_usd": 0,
    }
    # Pull live config from SQLite each cycle so UI changes take effect on
    # the next rebalance without restarting the service. Falls through to
    # DEFAULT_THRESHOLDS in tools/risk.py if the DB is unreachable.
    try:
        cfg = store.get_risk_config()
    except Exception:  # noqa: BLE001 — never fail the loop on a config read
        cfg = None
    verdict = await risk_tool.check_thresholds(metrics, cfg)
    state["risk"] = verdict
    state["emergency"] = not verdict["ok"]
    skipped = verdict.get("skipped_rules") or []
    suffix = f" skipped={len(skipped)}" if skipped else ""
    return _log(
        state,
        "THINK",
        f"risk · {verdict['verdict']} breaches={len(verdict['breaches'])}{suffix}",
    )


def risk_router(state: HypeState) -> str:
    if state.get("idle"):
        return "loop"
    return "emergency_exit" if state.get("emergency") else "wrap"


async def wrap_node(state: HypeState) -> HypeState:
    state["current_node"] = "wrap"
    basket = state.get("basket") or {}
    if not basket:
        return _log(state, "WAIT", "wrap · skipped (empty basket)")
    # Symbol per sector keeps idempotency clean — re-runs of the same sector
    # hit `already_registered` instead of reverting on-chain.
    sector = state.get("sector", "GEN")
    symbol = f"H{sector[:3].upper()}"
    try:
        res = await ssi.wrap(symbol, basket)
    except Exception as exc:  # noqa: BLE001
        return _log(state, "WAIT", f"ssi.wrap · failed: {exc}")
    state["ssi_tx"] = res
    if res.get("status") == "already_registered":
        return _log(state, "OBS", f"ssi.wrap · {symbol} already registered, skip")
    txh = res.get("tx_hash") or ""
    return _log(
        state,
        "ACT",
        f"ssi.wrap · {symbol} tx={txh[:10]}… block={res.get('block_number')}",
        url=res.get("external_url"),
    )


async def exec_node(state: HypeState) -> HypeState:
    state["current_node"] = "exec"
    basket = state.get("basket") or {}
    if not basket:
        state.setdefault("sodex_txs", [])
        return _log(state, "WAIT", "exec · skipped (empty basket)")

    # Allocate USDC across constituents proportionally — bobot di basket
    # nilainya 0..1, total ≈ 1.0.
    notional_total = float(state.get("exec_notional_usdc") or EXEC_NOTIONAL_USDC)
    txs: list[dict[str, Any]] = []        # summary list (kept for legacy callers)
    sodex_txs: list[dict[str, Any]] = []  # per-asset result dicts for Feature 2 / _persist_cycle
    placed = skipped = errors = 0
    total_latency = 0

    for sym, weight in basket.items():
        amount_in = max(notional_total * float(weight), 1.0)
        tx: dict[str, Any] = {}

        for attempt in range(MAX_TRADE_ATTEMPTS):
            tx = await sodex.execute_trade("USDC", sym, amount_in)
            disposition = classify_trade_result(tx)

            if disposition == "done":
                placed += 1
                _log(
                    state,
                    "ACT",
                    f"sodex · {sym} order #{tx.get('order_id')} "
                    f"{tx.get('quantity')} @ {tx.get('limit_price')} "
                    f"(attempt {attempt + 1})",
                    url=tx.get("external_url"),
                )
                # Best-effort partial-fill log (non-blocking).
                if tx.get("cl_ord_id") and tx.get("pair"):
                    try:
                        fill = await sodex.poll_spot_fill(
                            tx["cl_ord_id"], tx["pair"]
                        )
                        if fill.get("resting") is True:
                            _log(
                                state,
                                "WAIT",
                                f"sodex · {sym} resting "
                                f"filled={fill.get('filled_pct', 0):.1f}%",
                            )
                    except Exception:  # noqa: BLE001
                        pass
                break

            elif disposition == "retry":
                wait = backoff_seconds(attempt)
                _log(
                    state,
                    "THINK",
                    f"sodex · {sym} retry in {wait:.0f}s "
                    f"(attempt {attempt + 1}/{MAX_TRADE_ATTEMPTS}): "
                    f"{tx.get('error') or tx.get('reason')}",
                )
                if attempt < MAX_TRADE_ATTEMPTS - 1:
                    await asyncio.sleep(wait)
                else:
                    # Exhausted retries — record as error.
                    errors += 1
                    _log(
                        state,
                        "WAIT",
                        f"sodex · {sym} gave up after {MAX_TRADE_ATTEMPTS} retries: "
                        f"{tx.get('error') or tx.get('reason')}",
                    )

            elif disposition == "route_to_perps":
                _log(
                    state,
                    "THINK",
                    f"sodex · {sym} spot cancel-only ({tx.get('reason')}), "
                    "cascading to perps",
                )
                perps_tx = await sodex.execute_perps_trade(sym, amount_in)
                perps_d = classify_trade_result(perps_tx)
                if perps_d == "done":
                    placed += 1
                    tx = perps_tx
                    _log(
                        state,
                        "ACT",
                        f"sodex · {sym} via perps order #{perps_tx.get('order_id')} "
                        f"{perps_tx.get('quantity')} @ {perps_tx.get('limit_price')}",
                        url=perps_tx.get("external_url"),
                    )
                elif perps_tx.get("skipped"):
                    # Perps disabled / skipped — treat as skipped overall.
                    skipped += 1
                    tx = perps_tx
                    _log(
                        state,
                        "WAIT",
                        f"sodex · {sym} perps skip ({perps_tx.get('reason')})",
                    )
                else:
                    errors += 1
                    tx = perps_tx
                    _log(
                        state,
                        "WAIT",
                        f"sodex · {sym} perps error: {perps_tx.get('error')}",
                    )
                break  # cascade is a single attempt — no inner retry loop

            else:  # give_up
                if tx.get("skipped"):
                    skipped += 1
                    _log(state, "WAIT", f"sodex · skip {sym} ({tx.get('reason')})")
                else:
                    errors += 1
                    _log(state, "WAIT", f"sodex · error {sym}: {tx.get('error')}")
                break

        # Accumulate per-asset result for Feature 2 track-record write-path.
        tx["_sym"] = sym
        sodex_txs.append(tx)
        txs.append(tx)
        total_latency += int(tx.get("latency_ms") or 0)

    state["sodex_txs"] = sodex_txs  # Feature 2 consumes this list
    avg = (total_latency / len(txs) / 1000) if txs else 0.0
    return _log(
        state,
        "ACT",
        f"sodex · {placed} placed · {skipped} skipped · {errors} errors · avg {avg:.1f}s",
    )


async def emergency_exit(state: HypeState) -> HypeState:
    state["current_node"] = "emergency_exit"
    # Hedge spec: 100% USDC. Idempotent — first emergency in the registry's
    # lifetime registers it; subsequent ones report already_registered and
    # cost zero gas.
    try:
        res = await ssi.wrap("USSI", {"USDC": 1.0})
    except Exception as exc:  # noqa: BLE001
        return _log(state, "WAIT", f"emergency · ssi.wrap failed: {exc}")
    state["ssi_tx"] = res
    txh = (res.get("tx_hash") or "")[:10]
    return _log(
        state,
        "WAIT",
        f"emergency · routed to USSI hedge tx={txh}…",
        url=res.get("external_url"),
    )


async def monitor_loop(state: HypeState) -> HypeState:
    state["current_node"] = "loop"
    return _log(state, "WAIT", "monitor · sleeping 30s before re-entry")


def build_graph():
    g = StateGraph(HypeState)
    g.add_node("signal", signal_listener)
    g.add_node("sentiment", sentiment_node)
    g.add_node("flow", flow_node)
    g.add_node("strategy", strategy_node)
    g.add_node("backtest", backtest_node)
    g.add_node("risk", risk_node)
    g.add_node("wrap", wrap_node)
    g.add_node("exec", exec_node)
    g.add_node("emergency_exit", emergency_exit)
    g.add_node("loop", monitor_loop)

    g.add_edge(START, "signal")
    g.add_edge("signal", "sentiment")
    g.add_edge("sentiment", "flow")
    g.add_edge("flow", "strategy")
    g.add_edge("strategy", "backtest")
    g.add_edge("backtest", "risk")
    g.add_conditional_edges(
        "risk",
        risk_router,
        {"wrap": "wrap", "emergency_exit": "emergency_exit", "loop": "loop"},
    )
    g.add_edge("wrap", "exec")
    g.add_edge("exec", "loop")
    g.add_edge("emergency_exit", "loop")
    g.add_edge("loop", END)
    return g.compile()


GRAPH = build_graph()
