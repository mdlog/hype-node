"""Model Context Protocol server exposing HypeNode tools.

Run via:
    python -m src.mcp_server

Designed for Claude Desktop (`claude_desktop_config.json`) and any other MCP
client. The same async tool functions are reused by the LangGraph agent in
`graph.py`."""

from __future__ import annotations

import asyncio
import os
from typing import Any

from dotenv import load_dotenv
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import TextContent, Tool

from .tools import backtest as bt
from .tools import risk as risk_tool
from .tools import sodex
from .tools import ssi
from .tools import terminal

load_dotenv()

server = Server("hypenode")


TOOLS: list[Tool] = [
    Tool(
        name="terminal.get_sentiment",
        description="Get AI sentiment score & delta for a sector from SoSoValue Terminal.",
        inputSchema={
            "type": "object",
            "properties": {
                "sector": {"type": "string"},
                "window": {"type": "string", "enum": ["1h", "4h", "24h", "7d"]},
            },
        },
    ),
    Tool(
        name="terminal.get_fund_flow",
        description="Get net fund flow for a sector over a window.",
        inputSchema={
            "type": "object",
            "properties": {
                "sector": {"type": "string"},
                "window": {"type": "string", "enum": ["1h", "4h", "24h", "7d"]},
            },
        },
    ),
    Tool(
        name="terminal.get_news",
        description="Get latest scored news headlines for a sector.",
        inputSchema={
            "type": "object",
            "properties": {
                "sector": {"type": "string"},
                "limit": {"type": "integer", "minimum": 1, "maximum": 50},
            },
        },
    ),
    Tool(
        name="backtest.run",
        description="Run a sentiment-weighted basket backtest.",
        inputSchema={
            "type": "object",
            "properties": {
                "strategy_id": {"type": "string"},
                "days": {"type": "integer"},
                "rebalance_hours": {"type": "integer"},
                "n_assets": {"type": "integer"},
                "min_sentiment": {"type": "integer"},
                "slippage_bps": {"type": "integer"},
            },
            "required": ["strategy_id"],
        },
    ),
    Tool(
        name="ssi.wrap",
        description="Wrap an asset basket into an SSI Protocol index token.",
        inputSchema={
            "type": "object",
            "properties": {
                "symbol": {"type": "string"},
                "weights": {"type": "object", "additionalProperties": {"type": "number"}},
            },
            "required": ["symbol", "weights"],
        },
    ),
    Tool(
        name="ssi.unwrap",
        description="Unwrap SSI index tokens back to their constituents.",
        inputSchema={
            "type": "object",
            "properties": {"symbol": {"type": "string"}, "amount": {"type": "number"}},
            "required": ["symbol", "amount"],
        },
    ),
    Tool(
        name="sodex.execute_trade",
        description="Execute a trade on SoDEX (ValueChain L1).",
        inputSchema={
            "type": "object",
            "properties": {
                "symbol_in": {"type": "string"},
                "symbol_out": {"type": "string"},
                "amount_in": {"type": "number"},
                "slippage_bps": {"type": "integer"},
            },
            "required": ["symbol_in", "symbol_out", "amount_in"],
        },
    ),
    Tool(
        name="risk.check_thresholds",
        description="Run the risk gate against a set of metrics. Returns PASS or EMERGENCY_EXIT.",
        inputSchema={
            "type": "object",
            "properties": {
                "metrics": {"type": "object"},
                "thresholds": {"type": "object"},
            },
            "required": ["metrics"],
        },
    ),
]


@server.list_tools()
async def list_tools() -> list[Tool]:
    return TOOLS


@server.call_tool()
async def call_tool(name: str, arguments: dict[str, Any]) -> list[TextContent]:
    args = arguments or {}
    result: Any
    if name == "terminal.get_sentiment":
        result = await terminal.get_sentiment(args.get("sector", "DePIN"), args.get("window", "1h"))
    elif name == "terminal.get_fund_flow":
        result = await terminal.get_fund_flow(args.get("sector", "DePIN"), args.get("window", "24h"))
    elif name == "terminal.get_news":
        result = await terminal.get_news(args.get("sector", "DePIN"), args.get("limit", 10))
    elif name == "backtest.run":
        result = await bt.run(**args)
    elif name == "ssi.wrap":
        result = await ssi.wrap(args["symbol"], args["weights"])
    elif name == "ssi.unwrap":
        result = await ssi.unwrap(args["symbol"], args["amount"])
    elif name == "sodex.execute_trade":
        result = await sodex.execute_trade(
            args["symbol_in"],
            args["symbol_out"],
            args["amount_in"],
            args.get("slippage_bps", 25),
        )
    elif name == "risk.check_thresholds":
        result = await risk_tool.check_thresholds(args.get("metrics", {}), args.get("thresholds"))
    else:
        return [TextContent(type="text", text=f"unknown tool {name}")]
    return [TextContent(type="text", text=str(result))]


async def main() -> None:
    async with stdio_server() as (read, write):
        await server.run(read, write, server.create_initialization_options())


if __name__ == "__main__":
    asyncio.run(main())
