"""FastAPI entrypoint exposing the LangGraph agent to the Next.js frontend.

Runs at http://localhost:8001 by default. The Next.js layer uses
AGENT_SERVICE_URL to call /state, /reasoning, /chat, /run.
"""

from __future__ import annotations

import asyncio
import json
import os
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Load .env before importing the graph/tools. terminal.py reads its SoSoValue
# settings at import time, so late dotenv loading can leave it with stale env.
load_dotenv()

from .chat_agent import run_agentic_chat  # noqa: E402
from .graph import GRAPH, HypeState  # noqa: E402
from .state import AgentNode, AgentState, ChatRequest, ChatTurn, ReasoningEntry  # noqa: E402
from . import store  # noqa: E402
from . import strategy_agent  # noqa: E402
from .tools import basket as basket_tool  # noqa: E402
from .tools import real_backtest  # noqa: E402
from .tools import terminal  # noqa: E402


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Bind the step-request event to the running event loop now that one
    # exists (FastAPI's lifespan runs inside the asyncio loop, unlike module
    # import where there is none).
    global STEP_REQUEST
    STEP_REQUEST = asyncio.Event()
    # Eagerly init SQLite — schema migration runs here so a fresh disk's
    # first /risk/config or /history call doesn't pay the cost mid-request.
    try:
        store.init()
    except Exception as exc:  # noqa: BLE001 — never block startup on DB
        # Log to stderr; the runner falls back to DEFAULT_THRESHOLDS and
        # decision rows simply aren't persisted until the DB recovers.
        print(f"[startup] store.init failed: {exc}")
    # Start the LangGraph driver as a background task; cancel it on shutdown.
    task = asyncio.create_task(_runner())
    try:
        yield
    finally:
        task.cancel()
        try:
            await task
        except (asyncio.CancelledError, Exception):
            pass


app = FastAPI(title="HypeNode Agent", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

START_TS = time.time()
LATEST_STATE: dict[str, Any] = {}
LATEST_LOG: list[ReasoningEntry] = []
TOOL_CALLS = 0
DECISIONS = 0
GAS_VAL = 0.0

# Run-control flags wired to /pause /step /reset /halt endpoints. The
# background runner reads these every iteration:
#   - paused: skip the iteration unless STEP_REQUEST is set
#   - halted: stop running entirely; only /reset clears it
#   - STEP_REQUEST: one-shot — execute one iteration and clear, even when
#     paused. Created lazily inside lifespan() so we attach to the running
#     event loop instead of FastAPI's import-time loop.
RUN_STATE: dict[str, bool] = {"paused": False, "halted": False}
STEP_REQUEST: asyncio.Event | None = None


def _strategy_live_emit(kind: str, text: str) -> None:
    """Forward strategy_agent's live reasoning entries directly to LATEST_LOG
    so the /agent page reasoning stream updates as Claude reasons (within a
    cycle), not just when the cycle finishes.

    Also bumps TOOL_CALLS for kind=="TOOL" so the KPI strip reflects real
    tool-use volume — strategy_agent emits TOOL entries here, bypassing the
    state["log"] channel that the runner counts at end-of-cycle.
    """
    global TOOL_CALLS
    LATEST_LOG.append(
        ReasoningEntry(
            ts=datetime.now(timezone.utc),
            # state.ReasoningEntry constrains kind to a Literal; the strategy
            # agent only emits valid values, but cast defensively to keep
            # pydantic happy if a future caller drifts.
            kind=kind,  # type: ignore[arg-type]
            text=text,
        )
    )
    if len(LATEST_LOG) > 250:
        del LATEST_LOG[: len(LATEST_LOG) - 250]
    if kind == "TOOL":
        TOOL_CALLS += 1


strategy_agent.set_emitter(_strategy_live_emit)
NODE_LABELS: dict[str, tuple[str, str]] = {
    "signal": ("Signal Listener", "polls 2s"),
    "sentiment": ("Sentiment Analysis", "AI score"),
    "flow": ("Flow Aggregator", "Terminal API"),
    "strategy": ("Strategy Builder", "weighted basket"),
    "backtest": ("Backtest Runner", "90d window"),
    "risk": ("Risk Gate", "5 thresholds"),
    "wrap": ("SSI Wrap", "wrap / unwrap"),
    "exec": ("SoDEX Execute", "L1 TX"),
    "emergency_exit": ("Emergency Exit", "→ USSI hedge"),
    "loop": ("Monitor Loop", "re-enter"),
}


def _build_state_response() -> AgentState:
    current = LATEST_STATE.get("current_node")
    nodes: list[AgentNode] = []
    for nid, (label, sub) in NODE_LABELS.items():
        status = "current" if nid == current else "active" if nid in {"signal", "sentiment", "flow"} else "idle"
        if nid == "risk" and LATEST_STATE.get("emergency"):
            status = "warn"
        if nid == "emergency_exit" and LATEST_STATE.get("emergency"):
            status = "danger"
        nodes.append(AgentNode(id=nid, label=label, status=status, sub=sub))
    return AgentState(
        uptime_sec=int(time.time() - START_TS),
        decisions_24h=DECISIONS,
        tool_calls=TOOL_CALLS,
        gas_spent_val=GAS_VAL,
        model=os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-5"),
        current_node=current,
        nodes=nodes,
        paused=RUN_STATE["paused"],
        halted=RUN_STATE["halted"],
    )


def _persist_cycle(state: dict[str, Any], sector: str) -> None:
    """Build a summary row from the cycle's terminal state and append it to
    the SQLite decision log. Runs synchronously inside the runner — sqlite3
    is fast enough that this doesn't impact loop cadence (~ms per write)."""
    basket = state.get("basket") or {}
    top_symbol: str | None = None
    top_weight: float | None = None
    if basket:
        top_symbol, top_weight = max(basket.items(), key=lambda kv: kv[1])
    risk = state.get("risk") or {}
    sodex_txs = state.get("sodex_txs") or []
    placed = sum(1 for t in sodex_txs if t.get("ok"))
    skipped = sum(1 for t in sodex_txs if t.get("skipped"))
    errors = sum(1 for t in sodex_txs if not (t.get("ok") or t.get("skipped")))
    ssi_tx = state.get("ssi_tx") or {}
    backtest = state.get("backtest") or {}
    sentiment = state.get("sentiment") or {}
    flow = state.get("flow") or {}
    record = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "sector": sector,
        "idle": 1 if state.get("idle") else 0,
        "basket_size": len(basket) if basket else 0,
        "basket_top_symbol": top_symbol,
        "basket_top_weight": float(top_weight) if top_weight is not None else None,
        "basket_json": json.dumps(basket) if basket else None,
        "strategy_source": state.get("strategy_source"),
        "strategy_confidence": state.get("strategy_confidence"),
        "strategy_reasoning": (state.get("strategy_reasoning") or "")[:400] or None,
        "sentiment_score": _maybe_float(sentiment.get("score")),
        "sentiment_delta": _maybe_float(sentiment.get("delta")),
        "flow_inflow_usd": _maybe_float(flow.get("net_inflow_usd")),
        "backtest_sharpe": _maybe_float(backtest.get("sharpe")),
        "backtest_drawdown": _maybe_float(backtest.get("max_drawdown")),
        "backtest_win_rate": _maybe_float(backtest.get("win_rate")),
        "risk_verdict": risk.get("verdict"),
        "risk_breaches_json": json.dumps(risk.get("breaches", [])) if risk else None,
        "ssi_tx_hash": ssi_tx.get("tx_hash"),
        "ssi_status": ssi_tx.get("status"),
        "sodex_placed": placed,
        "sodex_skipped": skipped,
        "sodex_errors": errors,
        "emergency": 1 if state.get("emergency") else 0,
    }
    store.append_decision(record)


def _maybe_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


async def _runner() -> None:
    """Background task that drives the LangGraph loop on a cadence.

    Cadence is controlled by AGENT_LOOP_SEC, while SoSoValue request pacing and
    cache TTLs are controlled by SOSOVALUE_* env vars. Demo-tier deployments
    should use a much slower loop and longer cache than paid-tier/dev setups.

    Honors three control flags exposed via the /pause /step /halt endpoints:
      - RUN_STATE["halted"]: hard stop until /reset clears it. Idle-polls 1s.
      - RUN_STATE["paused"]: skip the iteration unless STEP_REQUEST is set.
        While paused, idle-polls every 0.5s so /step has snappy latency.
      - STEP_REQUEST: one-shot — execute exactly one iteration and clear,
        regardless of paused state.
    """
    global TOOL_CALLS, DECISIONS, GAS_VAL
    sectors_cycle = ["DePIN", "RWA", "AI", "Memes", "GameFi"]  # rotates through SSI indices
    i = 0
    while True:
        # Halt is a latched safety stop — exits only via /reset.
        if RUN_STATE["halted"]:
            await asyncio.sleep(1)
            continue
        # Paused without a pending step → idle-poll. Cheap loop so the next
        # /resume or /step doesn't have to wait the full AGENT_LOOP_SEC.
        if RUN_STATE["paused"] and not (STEP_REQUEST and STEP_REQUEST.is_set()):
            await asyncio.sleep(0.5)
            continue
        try:
            sector = sectors_cycle[i % len(sectors_cycle)]
            i += 1
            state = await GRAPH.ainvoke({"sector": sector})
            LATEST_STATE.update(state)
            for entry in state.get("log", []):
                LATEST_LOG.append(ReasoningEntry(**entry))
            TOOL_CALLS += sum(1 for e in state.get("log", []) if e.get("kind") == "TOOL")
            DECISIONS += 1
            for tx in state.get("sodex_txs") or []:
                GAS_VAL += tx.get("gas_val", 0.0)
            if len(LATEST_LOG) > 250:
                del LATEST_LOG[: len(LATEST_LOG) - 250]
            # Persist a one-row summary of this cycle. RAM logs are capped
            # at 250 entries; this is the durable audit trail surfaced by
            # the History page.
            try:
                _persist_cycle(state, sector)
            except Exception as exc:  # noqa: BLE001 — DB issues never crash the loop
                LATEST_LOG.append(
                    ReasoningEntry(
                        ts=datetime.now(timezone.utc),
                        kind="WAIT",
                        text=f"history · persist failed: {exc}",
                    )
                )
        except Exception as exc:  # noqa: BLE001
            LATEST_LOG.append(
                ReasoningEntry(
                    ts=datetime.now(timezone.utc),
                    kind="WAIT",
                    text=f"loop crash · {exc}",
                )
            )
        finally:
            # Step is a one-shot — clear after the iteration regardless of
            # success so the next paused tick goes back to idle-polling.
            if STEP_REQUEST and STEP_REQUEST.is_set():
                STEP_REQUEST.clear()
        # If paused or halted, skip the long sleep so the next state-change
        # control takes effect immediately.
        if RUN_STATE["paused"] or RUN_STATE["halted"]:
            continue
        # Override with AGENT_LOOP_SEC. Demo tier should usually be >=120s.
        await asyncio.sleep(int(os.getenv("AGENT_LOOP_SEC", "120")))


@app.get("/health")
async def health() -> dict[str, Any]:
    return {"ok": True, "uptime_sec": int(time.time() - START_TS)}


@app.get("/state", response_model=AgentState)
async def state() -> AgentState:
    return _build_state_response()


@app.get("/reasoning", response_model=list[ReasoningEntry])
async def reasoning() -> list[ReasoningEntry]:
    return LATEST_LOG[-100:]


@app.post("/pause")
async def pause_endpoint() -> dict[str, Any]:
    """Toggle the paused flag. The runner finishes its current iteration
    (uninterruptible inside GRAPH.ainvoke) and then idles."""
    RUN_STATE["paused"] = not RUN_STATE["paused"]
    LATEST_LOG.append(
        ReasoningEntry(
            ts=datetime.now(timezone.utc),
            kind="WAIT",
            text="agent paused via /pause" if RUN_STATE["paused"] else "agent resumed via /pause",
        )
    )
    return {"paused": RUN_STATE["paused"], "halted": RUN_STATE["halted"]}


@app.post("/step")
async def step_endpoint() -> dict[str, Any]:
    """Run exactly one LangGraph iteration. Works whether the agent is
    paused or running — useful for nudging through the cycle deterministically.
    No-op while halted."""
    if RUN_STATE["halted"]:
        return {"stepped": False, "reason": "halted"}
    if STEP_REQUEST is None:
        return {"stepped": False, "reason": "service warming up"}
    STEP_REQUEST.set()
    LATEST_LOG.append(
        ReasoningEntry(
            ts=datetime.now(timezone.utc),
            kind="ACT",
            text="single-step requested via /step",
        )
    )
    return {"stepped": True}


@app.post("/reset")
async def reset_endpoint() -> dict[str, Any]:
    """Wipe accumulated counters / log, clear halted+paused flags. Doesn't
    cancel the running task — the next iteration starts fresh."""
    global TOOL_CALLS, DECISIONS, GAS_VAL
    LATEST_STATE.clear()
    LATEST_LOG.clear()
    TOOL_CALLS = 0
    DECISIONS = 0
    GAS_VAL = 0.0
    RUN_STATE["halted"] = False
    RUN_STATE["paused"] = False
    LATEST_LOG.append(
        ReasoningEntry(
            ts=datetime.now(timezone.utc),
            kind="ACT",
            text="state reset via /reset",
        )
    )
    return {"reset": True}


@app.post("/halt")
async def halt_endpoint() -> dict[str, Any]:
    """Emergency stop. The runner finishes its current iteration then idles
    until /reset clears the flag. /pause is implicitly cleared so the only
    state is `halted=True`."""
    RUN_STATE["halted"] = True
    RUN_STATE["paused"] = False
    LATEST_LOG.append(
        ReasoningEntry(
            ts=datetime.now(timezone.utc),
            kind="WAIT",
            text="agent halted via /halt — /reset to resume",
        )
    )
    return {"halted": True}


@app.post("/chat", response_model=ChatTurn)
async def chat(req: ChatRequest) -> ChatTurn:
    """Agentic chat — Claude with tool-use over the MCP-style read-only
    surface (terminal sentiment / fund flow / news / spotlight, backtest,
    risk gate). See `chat_agent.py` for the loop and tool schemas."""
    return await run_agentic_chat(req)


@app.post("/run")
async def run(payload: dict[str, Any]) -> HypeState:
    """One-shot graph execution useful for tests / manual triggers."""
    state = await GRAPH.ainvoke(payload or {"sector": "DePIN"})
    LATEST_STATE.update(state)
    return state


@app.get("/propose-basket")
async def propose_basket_endpoint(
    sector: str = "DePIN",
    n_assets: int = 8,
    weighting: str = "score",
) -> dict[str, Any]:
    """REST surface for the same `propose_basket` the chat agent uses as a
    tool. Lets server components (proposals, proposals/[id]) build real
    on-chain-grounded baskets without spinning up a chat turn."""
    return await basket_tool.propose_basket(
        sector=sector, n_assets=n_assets, weighting=weighting,
    )


@app.post("/run-backtest")
async def run_backtest_endpoint(payload: dict[str, Any]) -> dict[str, Any]:
    """REST surface for the chat agent's backtest tool. Body shape:
    `{constituents: [{currency_id, symbol, weight}, ...], days?: int,
       fee_bps?, slippage_bps?, position_cap?, risk_free_rate?,
       init_capital?, rebalance_days? }`. Cost knobs are all optional and
    fall through to no-op defaults so the existing chat-agent callers
    keep their current behaviour."""
    constituents = payload.get("constituents") or []
    days = int(payload.get("days", 90))
    if not isinstance(constituents, list):
        return {"ok": False, "error": "constituents must be a list"}

    def _opt(key: str, default: float) -> float:
        v = payload.get(key)
        if v is None or v == "":
            return default
        try:
            return float(v)
        except (TypeError, ValueError):
            return default

    cap = _opt("position_cap", 0.0)
    return await real_backtest.run_real_backtest(
        constituents=constituents,
        days=days,
        fee_bps=_opt("fee_bps", 0.0),
        slippage_bps=_opt("slippage_bps", 0.0),
        position_cap=cap if cap > 0 else None,
        risk_free_rate=_opt("risk_free_rate", 0.0),
        init_capital=_opt("init_capital", 1.0),
        rebalance_days=int(_opt("rebalance_days", 7.0)),
    )


@app.get("/risk/config")
async def get_risk_config_endpoint() -> dict[str, Any]:
    """Live risk gate config — thresholds + per-rule enable flags. Read every
    cycle by `risk_node`, edited by the Risk page UI."""
    return store.get_risk_config()


@app.post("/risk/config")
async def update_risk_config_endpoint(payload: dict[str, Any]) -> dict[str, Any]:
    """Partial update — only fields present in the body are touched. Unknown
    keys are silently dropped (whitelist enforced inside store.update_risk_config)."""
    updated = store.update_risk_config(payload or {})
    LATEST_LOG.append(
        ReasoningEntry(
            ts=datetime.now(timezone.utc),
            kind="ACT",
            text=(
                f"risk config updated · "
                f"vol≤{updated['volatility_max']} dd≤{updated['drawdown_max']} "
                f"manual={updated['manual_override']}"
            ),
        )
    )
    return updated


@app.get("/history")
async def history_endpoint(
    limit: int = 100,
    sector: str | None = None,
    since: str | None = None,
) -> dict[str, Any]:
    """Decision audit trail. `since` is an ISO timestamp; default returns
    the most recent `limit` rows across all sectors."""
    rows = store.list_decisions(limit=limit, sector=sector, since_iso=since)
    return {"rows": rows, "count": len(rows)}


@app.get("/history/stats")
async def history_stats_endpoint() -> dict[str, Any]:
    return store.decision_stats()


@app.get("/terminal/sentiment")
async def sentiment(sector: str = "DePIN", window: str = "1h") -> dict[str, Any]:
    return await terminal.get_sentiment(sector, window)


@app.get("/terminal/fund-flow")
async def fund_flow(sector: str = "DePIN", window: str = "24h") -> dict[str, Any]:
    return await terminal.get_fund_flow(sector, window)


@app.get("/terminal/news")
async def news(sector: str = "DePIN", limit: int = 10) -> Any:
    # Returns a list of news items on success, or {ok: false, error, items: []}
    # during a SoSoValue backoff window — see terminal.get_news.
    return await terminal.get_news(sector, limit)


@app.get("/terminal/status")
async def terminal_status() -> dict[str, Any]:
    return terminal.status()


@app.post("/sodex/submit")
async def sodex_submit(req: dict[str, Any]) -> dict[str, Any]:
    """Forward a browser-signed SoDEX trade envelope to the upstream gateway.

    Body shape:
      {
        "submit_payload": { domain_name, base_url, path, method, wire_body, nonce, signer_address },
        "signature":      "0x...130hex"   # wagmi signTypedDataAsync output
      }

    The signing happens in the browser via wagmi — server only re-formats the
    signature (v normalization + 0x01 type tag) and adds auth headers before
    relaying.
    """
    from .tools import sodex as _sodex
    payload = req.get("submit_payload") or {}
    sig = req.get("signature")
    if not isinstance(payload, dict) or not isinstance(sig, str):
        return {"ok": False, "error": "submit_payload (object) and signature (hex string) required"}
    try:
        result = await _sodex.submit_signed_envelope(payload, sig)
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc)}

    # SoDEX responses double-wrap: outer envelope (code: 0/error) and a per-item
    # code inside `data`. The outer can be 0 while the order is rejected — e.g.
    # price violates min/max, side restricted, asset paused for one direction.
    # The previous handler only checked outer code so the UI rendered "ORDER
    # SUBMITTED" green even though the order never went on the book. Surface
    # the inner failure as a hard error.
    #
    # Shape varies by action:
    #   spot  /trade/orders/batch (batchNewOrder)  → data is a list (one per order)
    #   perps /trade/orders       (newOrder)       → data is a single object
    #   any   /accounts/transfers (transferAsset)  → data is a single object (no orderID)
    action_kind = payload.get("action_kind") or (
        "transfer" if str(payload.get("path", "")).endswith("/accounts/transfers")
        else "order"
    )
    data = result.get("data")
    if isinstance(data, list):
        first = data[0] if data else {}
    elif isinstance(data, dict):
        first = data
    else:
        first = {}
    if not isinstance(first, dict):
        return {"ok": False, "error": "unexpected SoDEX response shape", "raw": result}

    inner_code = first.get("code", 0)
    order_id = first.get("orderID")
    # Inner code must be OK regardless of action. For orders we additionally
    # require an orderID (server returns 0 when an order was technically
    # accepted but immediately rejected — e.g. cancel-only mode). Transfers
    # don't return an orderID, so don't apply that check.
    inner_ok = inner_code in (0, "0", None)
    needs_order_id = action_kind == "order"
    if not inner_ok or (needs_order_id and order_id in (None, 0, "0")):
        return {
            "ok": False,
            "error": (
                first.get("error")
                or first.get("message")
                or f"SoDEX rejected {action_kind} (inner code={inner_code}): {first}"
            ),
            "raw": result,
        }
    return {
        "ok": True,
        "order_id": order_id,
        "cl_ord_id": first.get("clOrdID"),
        "raw": result,
    }


@app.get("/tools/health")
async def tools_health() -> dict[str, Any]:
    """Per-tool readiness probe for the chat UI's MCP panel.

    Cheap config + state checks only — never fires the actual tool, so this
    endpoint can be polled freely without burning SoSoValue quota or paying
    on-chain gas. Each tool resolves to one of:
      - ok                : config present, no active backoff
      - degraded          : config present but upstream is in backoff
      - missing_config    : a required env var is unset
    """

    sv = terminal.status()
    sv_key = bool(sv.get("has_api_key"))
    sv_backoff = (
        (sv.get("backoff", {}).get("quota_exhausted_for_sec") or 0) > 0
        or (sv.get("backoff", {}).get("transient_error_for_sec") or 0) > 0
    )

    def terminal_check() -> dict[str, Any]:
        if not sv_key:
            return {"status": "missing_config", "reason": "SOSOVALUE_API_KEY not set"}
        if sv_backoff:
            return {"status": "degraded", "reason": "upstream in backoff"}
        return {"status": "ok", "reason": None}

    def env_check(required: list[str]) -> dict[str, Any]:
        missing = [k for k in required if not os.getenv(k)]
        if missing:
            return {
                "status": "missing_config",
                "reason": f"missing env: {', '.join(missing)}",
            }
        return {"status": "ok", "reason": None}

    rootdata_status: dict[str, Any]
    if not os.getenv("ROOTDATA_API_KEY"):
        rootdata_status = {
            "status": "missing_config",
            "reason": "ROOTDATA_API_KEY not set",
        }
    else:
        rootdata_status = {"status": "ok", "reason": None}

    sodex_pk_status = env_check(["SODEX_PRIVATE_KEY"])
    tools = {
        "terminal.get_sentiment": terminal_check(),
        "terminal.get_fund_flow": terminal_check(),
        "terminal.get_news": terminal_check(),
        "list_funding_rounds": terminal_check(),
        "get_project_fundraising": terminal_check(),
        "search_rootdata": rootdata_status,
        "get_rootdata_project": rootdata_status,
        "get_rootdata_investor": rootdata_status,
        "backtest.run": {"status": "ok", "reason": None},
        "ssi.wrap / unwrap": env_check(
            ["SSI_PRIVATE_KEY", "SSI_REGISTRY_ADDRESS", "SSI_RPC_URL"],
        ),
        "sodex_execute_trade": sodex_pk_status,
        "sodex_sell_trade": sodex_pk_status,
        "sodex_perps_trade": sodex_pk_status,
        "sodex_transfer": sodex_pk_status,
        "sodex_get_balances": sodex_pk_status,
        "sodex_list_orders": sodex_pk_status,
        "sodex_cancel_order": sodex_pk_status,
        "risk.check_thresholds": {"status": "ok", "reason": None},
    }

    summary = {
        "ok": sum(1 for v in tools.values() if v["status"] == "ok"),
        "degraded": sum(1 for v in tools.values() if v["status"] == "degraded"),
        "missing_config": sum(
            1 for v in tools.values() if v["status"] == "missing_config"
        ),
        "total": len(tools),
    }
    return {"tools": tools, "summary": summary}


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", 8001))
    uvicorn.run("src.main:app", host="0.0.0.0", port=port, reload=True)
