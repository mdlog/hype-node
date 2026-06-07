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
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

# Load .env before importing the graph/tools. terminal.py reads its SoSoValue
# settings at import time, so late dotenv loading can leave it with stale env.
load_dotenv()

from .chat_agent import run_agentic_chat  # noqa: E402
from .graph import GRAPH, HypeState  # noqa: E402
from .state import AgentNode, AgentState, ChatRequest, ChatTurn, ReasoningEntry  # noqa: E402
from . import store  # noqa: E402
from . import strategy_agent  # noqa: E402
from . import pt_store  # noqa: E402
from . import draft as draft_module  # noqa: E402
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


# --- Security config ---------------------------------------------------------
#
# Two layers of defense for the public-tunneled service:
#
# 1. AGENT_API_KEY — shared secret. Every request except /health and the OPTIONS
#    pre-flight must carry an `x-agent-key` header matching this value. The
#    Next.js proxy reads the same value from its server-only env and forwards
#    it on every fetch to AGENT_SERVICE_URL. When AGENT_API_KEY is unset the
#    service refuses to start so an unattended deploy can't end up wide-open.
#
# 2. Docs are disabled by default. /openapi.json /docs /redoc all 404 unless
#    AGENT_DOCS_ENABLED=true is set explicitly (handy for local dev).
#
# 3. CORS is locked to AGENT_ALLOWED_ORIGINS (comma-separated list of full
#    origins, e.g. "https://hype-node.vercel.app,http://localhost:3000").
#    Without it set we fall back to localhost-only — never wildcard in prod.

AGENT_API_KEY = os.environ.get("AGENT_API_KEY", "").strip()
AGENT_DOCS_ENABLED = os.environ.get("AGENT_DOCS_ENABLED", "").lower() in {"1", "true", "yes"}
AGENT_ALLOWED_ORIGINS = [
    o.strip()
    for o in os.environ.get(
        "AGENT_ALLOWED_ORIGINS",
        "http://localhost:3000,http://127.0.0.1:3000",
    ).split(",")
    if o.strip()
]

if not AGENT_API_KEY:
    raise RuntimeError(
        "AGENT_API_KEY is not set. Generate a 48-char random string and set it "
        "in agent-service/.env AND in the Next.js deployment env (Vercel) so "
        "the proxy can forward it. Run: "
        "python -c 'import secrets; print(secrets.token_hex(48))'"
    )

# --- Hype-Radar auto-draft config -------------------------------------------
#
# When AGENT_AUTODRAFT_ENABLED=true AND the sentiment score is >= DRAFT_THRESHOLD
# the runner writes a "hype_radar" draft to pb_proposals via PostgREST.
# Disabled by default so nothing fires without explicit opt-in.
#
# Dedup: _DRAFTED_TODAY is an in-memory set of (sector, utc_date) pairs that
# received a draft this process run.  Cleared only on process restart (fine:
# one draft per sector/day is the goal; no persistence needed).
_AUTODRAFT_ENABLED: bool = os.environ.get("AGENT_AUTODRAFT_ENABLED", "").lower() in {"1", "true", "yes"}
_DRAFT_THRESHOLD: float = float(os.environ.get("DRAFT_THRESHOLD", "60"))
_AGENT_CREATOR_ADDRESS: str = os.environ.get("AGENT_CREATOR_ADDRESS", "").strip()
_DRAFTED_TODAY: set[tuple[str, str]] = set()

# Paths that should be reachable without the API key. Keep this list short —
# anything here is publicly callable, so don't leak business state.
PUBLIC_PATHS = frozenset({"/health"})

# --- Activity-aware loop cadence ---------------------------------------------
#
# Last wall-clock time a REAL USER ACTION hit the service. The background
# _runner uses this to switch between two cadences:
#   - "active": within AGENT_ACTIVE_WINDOW_SEC of last activity → run cycle
#                every AGENT_LOOP_SEC (default 120s, fast — judges see live)
#   - "idle":  no recent activity → run cycle every AGENT_IDLE_LOOP_SEC
#                (default 1800s = 30 min, cheap — burn near-zero LLM tokens)
#
# A "real user action" is a POST that changes state, or a /chat /run /
# run-backtest call that costs LLM tokens. Background pollers (the UI
# refreshes /state and /reasoning every 5-30s while a tab is open) do NOT
# count — otherwise any open tab would pin the service in active mode
# forever and the cost saving evaporates.
LAST_ACTIVITY_TS: float = time.time()

# Endpoints that the UI polls passively. These read-only paths do NOT bump
# the activity timestamp; otherwise a single open Dashboard / Chat / Agent
# tab would keep the loop in active mode 24/7 (since each tab polls every
# 5-30s) and defeat the idle slowdown.
POLLING_PATHS = frozenset(
    {
        "/state",
        "/reasoning",
        "/tools/health",
        "/terminal/status",
        "/history",
        "/history/stats",
        "/risk/config",  # GET only — POST handled by method check below
    }
)


class ApiKeyMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        global LAST_ACTIVITY_TS
        # CORS preflight has no auth headers by spec.
        if request.method == "OPTIONS":
            return await call_next(request)
        if request.url.path in PUBLIC_PATHS:
            return await call_next(request)
        provided = request.headers.get("x-agent-key", "")
        if provided != AGENT_API_KEY:
            return JSONResponse({"error": "unauthorized"}, status_code=401)
        # Bump activity only on real user actions (anything that's NOT a
        # GET to a polling endpoint). POSTs and non-listed GETs all count.
        is_polling = (
            request.method == "GET" and request.url.path in POLLING_PATHS
        )
        if not is_polling:
            LAST_ACTIVITY_TS = time.time()
        return await call_next(request)


app = FastAPI(
    title="HypeNode Agent",
    lifespan=lifespan,
    # 404 the docs in production. Re-enable per-deploy with AGENT_DOCS_ENABLED.
    openapi_url="/openapi.json" if AGENT_DOCS_ENABLED else None,
    docs_url="/docs" if AGENT_DOCS_ENABLED else None,
    redoc_url="/redoc" if AGENT_DOCS_ENABLED else None,
)
# CORS first so preflight is handled before the API-key middleware kicks in.
app.add_middleware(
    CORSMiddleware,
    allow_origins=AGENT_ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(ApiKeyMiddleware)

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


def _active_model_label() -> str:
    """Model name to surface in the /state panel — provider-aware.

    Mirrors the LLM_PROVIDER dispatch in chat_agent / strategy_agent so the UI
    reports the model actually in use (e.g. a Qwen id when running against
    DashScope via LLM_PROVIDER=openai), not a hardcoded Anthropic default.
    """
    provider = (os.getenv("LLM_PROVIDER") or "anthropic").strip().lower()
    if provider == "openai":
        return os.getenv("OPENAI_MODEL", "gpt-4o")
    return os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-5")


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
        model=_active_model_label(),
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
    """Background task that drives the LangGraph loop on an activity-aware
    cadence.

    Two cadences:
      - AGENT_LOOP_SEC      (active mode, default 120s)  — used while there
                                                           has been an auth'd
                                                           request in the last
                                                           AGENT_ACTIVE_WINDOW_SEC
      - AGENT_IDLE_LOOP_SEC (idle mode,   default 1800s) — used when nobody
                                                           is interacting

    This keeps the service alive during judging (judges may probe at any
    time) without burning $3-7/day in LLM tokens during the long stretches
    when nobody is watching. The loop polls activity every 5s, so transition
    from idle → active happens almost immediately when a judge opens the UI.

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

    active_loop_sec = int(os.getenv("AGENT_LOOP_SEC", "120"))
    idle_loop_sec = int(os.getenv("AGENT_IDLE_LOOP_SEC", "1800"))
    active_window_sec = int(os.getenv("AGENT_ACTIVE_WINDOW_SEC", "300"))
    activity_poll_sec = 5  # how often we re-check activity while waiting
    last_cycle_at = 0.0  # 0 → run first cycle immediately on boot
    last_logged_mode: str | None = None

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

        now = time.time()
        is_step = bool(STEP_REQUEST and STEP_REQUEST.is_set())
        is_active = (now - LAST_ACTIVITY_TS) < active_window_sec
        cadence = active_loop_sec if is_active else idle_loop_sec

        # Wait for the next cycle (unless this is a /step or the very first
        # tick). Poll activity every `activity_poll_sec` so when a judge
        # arrives mid-idle-window we transition to active within seconds.
        if not is_step and last_cycle_at > 0 and (now - last_cycle_at) < cadence:
            await asyncio.sleep(activity_poll_sec)
            continue

        # First-time log + on every transition so operators can see in the
        # /reasoning stream which cadence the loop is on.
        mode = "active" if is_active else "idle"
        if mode != last_logged_mode:
            LATEST_LOG.append(
                ReasoningEntry(
                    ts=datetime.now(timezone.utc),
                    kind="WAIT",
                    text=(
                        f"loop · cadence={mode} · next cycle every "
                        f"{cadence}s (last activity {int(now - LAST_ACTIVITY_TS)}s ago)"
                    ),
                )
            )
            last_logged_mode = mode

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
            # Best-effort: write rebalance + trade rows to Supabase (track-record).
            # No-op when Supabase env vars unset; never crashes the loop.
            try:
                await pt_store.insert_rebalance(state, state.get("sodex_txs") or [])
            except Exception as exc:  # noqa: BLE001
                LATEST_LOG.append(
                    ReasoningEntry(
                        ts=datetime.now(timezone.utc),
                        kind="WAIT",
                        text=f"track-record · persist failed: {exc}",
                    )
                )
            # Hype-Radar auto-draft: env-gated (AGENT_AUTODRAFT_ENABLED), deduped
            # per (sector, utc_date). No-op when disabled or Supabase/creator unset.
            # Never crashes the loop.
            try:
                if _AUTODRAFT_ENABLED:
                    utc_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
                    draft_key = (sector, utc_date)
                    sentiment_data = state.get("sentiment") or {}
                    sentiment_score = float(sentiment_data.get("score") or 0.0)
                    already = draft_key in _DRAFTED_TODAY
                    if draft_module.should_draft(sentiment_score, _DRAFT_THRESHOLD, already):
                        # Build basket_result from state. The LangGraph runner stores
                        # the strategy weights dict in state["basket"]
                        # (e.g. {"RNDR": 0.35, "FIL": 0.25, ...}).
                        # propose_basket() output is richer; adapt from weights dict
                        # so build_proposal_row receives the expected shape.
                        raw_basket = state.get("basket") or {}
                        ssi_ticker = state.get("ssi_ticker") or f"ssi{sector}"
                        # Construct a basket_result-shaped dict from available state.
                        basket_result: dict[str, Any] = {
                            "ok": bool(raw_basket),
                            "ticker": ssi_ticker,
                            "weighting": state.get("strategy_source", "score"),
                            "n_pool": len(raw_basket),
                            "n_picked": len(raw_basket),
                            "constituents": [
                                {"symbol": sym, "weight": round(float(w), 4)}
                                for sym, w in raw_basket.items()
                            ],
                            "skipped": [],
                            "summary": {
                                "symbols": list(raw_basket.keys()),
                                "weights_pct": [
                                    round(float(w) * 100, 1) for w in raw_basket.values()
                                ],
                            },
                        }
                        if basket_result["ok"]:
                            row = draft_module.build_proposal_row(
                                sector=sector,
                                basket_result=basket_result,
                                sentiment=sentiment_data,
                                creator_address=_AGENT_CREATOR_ADDRESS,
                                source="hype_radar",
                            )
                            await draft_module.insert_pb_proposal(row)
                            _DRAFTED_TODAY.add(draft_key)
                            LATEST_LOG.append(
                                ReasoningEntry(
                                    ts=datetime.now(timezone.utc),
                                    kind="ACT",
                                    text=(
                                        f"auto-draft · hype_radar proposal queued for "
                                        f"{sector} (score={sentiment_score:.1f})"
                                    ),
                                )
                            )
            except Exception as exc:  # noqa: BLE001 — never crash the loop
                LATEST_LOG.append(
                    ReasoningEntry(
                        ts=datetime.now(timezone.utc),
                        kind="WAIT",
                        text=f"auto-draft · error (non-fatal): {exc}",
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
            last_cycle_at = time.time()
            # Step is a one-shot — clear after the iteration regardless of
            # success so the next paused tick goes back to idle-polling.
            if STEP_REQUEST and STEP_REQUEST.is_set():
                STEP_REQUEST.clear()


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
