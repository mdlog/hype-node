"""Shared pydantic models for the agent service."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

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


class ReasoningEntry(BaseModel):
    ts: datetime
    kind: Literal["TOOL", "OBS", "THINK", "ACT", "WAIT"]
    text: str


class ChatTurn(BaseModel):
    role: Literal["user", "agent"]
    content: str
    ts: datetime | None = None


class ChatRequest(BaseModel):
    turns: list[ChatTurn]


class IndexSpec(BaseModel):
    symbol: str
    name: str
    base: Literal["USDC"] = "USDC"
    weights: dict[str, float]
    rebalance_cron: str | None = None
    management_fee_bps: int | None = None
    performance_fee_bps: int | None = None
