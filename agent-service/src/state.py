"""Shared pydantic models for the agent service."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel


NodeStatus = Literal["idle", "active", "current", "warn", "danger"]


class AgentNode(BaseModel):
    id: str
    label: str
    status: NodeStatus = "idle"
    sub: str | None = None


class AgentState(BaseModel):
    uptime_sec: int = 0
    decisions_24h: int = 0
    tool_calls: int = 0
    gas_spent_val: float = 0.0
    model: str = "claude-sonnet-4-5"
    current_node: str | None = None
    nodes: list[AgentNode] = []
    # Run controls — surfaced so the UI can flip the Pause button to "Resume"
    # and badge the agent as halted. `paused` is toggleable; `halted` is a
    # latched safety stop that only clears on /reset.
    paused: bool = False
    halted: bool = False


class ReasoningEntry(BaseModel):
    ts: datetime
    kind: Literal["TOOL", "OBS", "THINK", "ACT", "WAIT"]
    text: str
    # Optional clickable link surfaced in the UI — used for SoDEX order
    # details, Etherscan tx links, etc. Renders as a small "↗" next to the
    # entry in the reasoning panel when set.
    url: str | None = None


class ToolCallTrace(BaseModel):
    """One entry in an agent message's tool-call trace.

    The UI renders these as the "Tool execution trace" card from the chat
    redesign — name + args summary + one-line output + duration. `output_raw`
    is included for debugging but UI typically shows only `output_summary`.
    """

    name: str
    input: dict[str, Any]
    output_summary: str | None = None
    output_raw: Any = None
    duration_ms: int = 0
    ok: bool = True
    error: str | None = None


class ChatUsage(BaseModel):
    """Per-turn cost & latency surfaced back to the UI for the model badge."""

    # Model id the agent actually ran this turn (provider-aware). The Next.js
    # billing meter prices the turn by this so GPT-4o usage isn't billed at
    # Claude rates. None on error turns where no model was reached.
    model: str | None = None
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_creation_tokens: int = 0
    elapsed_ms: int = 0


class ChatTurn(BaseModel):
    role: Literal["user", "agent"]
    content: str
    ts: datetime | None = None
    # Populated only on agent turns when the agent ran tool calls. The Next.js
    # client treats it as optional so older transcripts (text-only) still load.
    tool_calls: list[ToolCallTrace] | None = None
    usage: ChatUsage | None = None


class ChatRequest(BaseModel):
    turns: list[ChatTurn]
    # SIWE-resolved EVM address of the user (lowercased). Threaded into
    # tool dispatch via a contextvar in chat_agent so balance / order tools
    # query the connected wallet instead of the server's signer key.
    # Optional so legacy callers / non-auth contexts still work.
    wallet_address: str | None = None


class IndexSpec(BaseModel):
    symbol: str
    name: str
    base: Literal["USDC"] = "USDC"
    weights: dict[str, float]
    rebalance_cron: str | None = None
    management_fee_bps: int | None = None
    performance_fee_bps: int | None = None
