"""FastAPI entrypoint exposing the LangGraph agent to the Next.js frontend.

Runs at http://localhost:8001 by default. The Next.js layer uses
AGENT_SERVICE_URL to call /state, /reasoning, /chat, /run.
"""

from __future__ import annotations

import asyncio
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

from .graph import GRAPH, HypeState  # noqa: E402
from .state import AgentNode, AgentState, ChatRequest, ChatTurn, ReasoningEntry  # noqa: E402
from .tools import terminal  # noqa: E402


@asynccontextmanager
async def lifespan(_app: FastAPI):
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
    )


async def _runner() -> None:
    """Background task that drives the LangGraph loop on a cadence.

    Cadence is controlled by AGENT_LOOP_SEC, while SoSoValue request pacing and
    cache TTLs are controlled by SOSOVALUE_* env vars. Demo-tier deployments
    should use a much slower loop and longer cache than paid-tier/dev setups.
    """
    global TOOL_CALLS, DECISIONS, GAS_VAL
    sectors_cycle = ["DePIN", "RWA", "AI", "Memes", "GameFi"]  # rotates through SSI indices
    i = 0
    while True:
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
        except Exception as exc:  # noqa: BLE001
            LATEST_LOG.append(
                ReasoningEntry(
                    ts=datetime.now(timezone.utc),
                    kind="WAIT",
                    text=f"loop crash · {exc}",
                )
            )
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


@app.post("/chat", response_model=ChatTurn)
async def chat(req: ChatRequest) -> ChatTurn:
    last_user = next((t for t in reversed(req.turns) if t.role == "user"), None)
    if last_user is None:
        return ChatTurn(role="agent", content="No user turn supplied.", ts=datetime.now(timezone.utc))

    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        return ChatTurn(
            role="agent",
            content=(
                "No ANTHROPIC_API_KEY set in the agent service. "
                "Set the key and the LangGraph chat path will run live; "
                f"echoing your prompt: {last_user.content!r}"
            ),
            ts=datetime.now(timezone.utc),
        )

    # Lazy import to keep cold-start cheap when no key is set.
    from langchain_anthropic import ChatAnthropic
    from langchain_core.messages import HumanMessage, SystemMessage

    llm = ChatAnthropic(
        model=os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-5"),
        api_key=api_key,
        max_tokens=1024,
    )
    system = SystemMessage(
        content=(
            "You are HypeNode, an autonomous on-chain index agent. "
            "Use the SoSoValue Terminal data and SSI Protocol context the user provides. "
            "Be concise, give actionable index suggestions, and surface risk gates."
        )
    )
    history = [system]
    for t in req.turns:
        if t.role == "user":
            history.append(HumanMessage(content=t.content))
    msg = await llm.ainvoke(history)
    return ChatTurn(role="agent", content=msg.content, ts=datetime.now(timezone.utc))


@app.post("/run")
async def run(payload: dict[str, Any]) -> HypeState:
    """One-shot graph execution useful for tests / manual triggers."""
    state = await GRAPH.ainvoke(payload or {"sector": "DePIN"})
    LATEST_STATE.update(state)
    return state


@app.get("/terminal/sentiment")
async def sentiment(sector: str = "DePIN", window: str = "1h") -> dict[str, Any]:
    return await terminal.get_sentiment(sector, window)


@app.get("/terminal/fund-flow")
async def fund_flow(sector: str = "DePIN", window: str = "24h") -> dict[str, Any]:
    return await terminal.get_fund_flow(sector, window)


@app.get("/terminal/news")
async def news(sector: str = "DePIN", limit: int = 10) -> list[dict[str, Any]]:
    return await terminal.get_news(sector, limit)


@app.get("/terminal/status")
async def terminal_status() -> dict[str, Any]:
    return terminal.status()


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", 8001))
    uvicorn.run("src.main:app", host="0.0.0.0", port=port, reload=True)
