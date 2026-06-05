"""Model Context Protocol server exposing HypeNode read-only research tools.

Run via:
    python -m src.mcp_server
    # or, after `pip install -e .`:
    hypenode-mcp

Designed for Claude Desktop (`claude_desktop_config.json`) and any other MCP
client. Exposes 17 READ-ONLY SoSoValue research tools reused from the chat
agent's registry.

SECURITY NOTE: Stateful/wallet tools (sodex trades, transfers, cancel, SSI
wrap/unwrap) are intentionally excluded. With no SIWE session an MCP caller
would fall back to the server's signer key, which is a key-drain risk.
"""

from __future__ import annotations

from dotenv import load_dotenv

# Load .env before importing tools. Some tool modules read env at import time.
load_dotenv()

from mcp.server import Server  # noqa: E402
from mcp.server.stdio import stdio_server  # noqa: E402
from mcp.types import TextContent, Tool  # noqa: E402

from . import chat_agent  # noqa: E402  reuses TOOL_SCHEMAS + TOOL_DISPATCH

server = Server("hypenode")

# Explicit allowlist — READ-ONLY research tools only. Stateful/wallet tools are
# intentionally excluded: with no SIWE session an MCP caller would fall back to
# the server's signer key, which is a key-drain risk.
MCP_READONLY_TOOLS = (
    "get_sector_sentiment",
    "get_fund_flow",
    "get_news",
    "get_sector_spotlight",
    "list_ssi_indices",
    "propose_basket",
    "run_backtest",
    "get_currency_snapshot",
    "check_risk_thresholds",
    "get_macro_calendar",
    "get_macro_event_history",
    "get_smart_money_signal",
    "list_funding_rounds",
    "get_project_fundraising",
    "search_rootdata",
    "get_rootdata_project",
    "get_rootdata_investor",
)


def _schema_for(name: str) -> dict:
    """Locate the schema entry for *name* in chat_agent.TOOL_SCHEMAS.

    TOOL_SCHEMAS entries use Anthropic format: flat dict with keys
    {"name", "description", "input_schema"}.  No nested "function" wrapper.
    """
    for s in chat_agent.TOOL_SCHEMAS:
        if s.get("name") == name:
            return s
    raise KeyError(name)


def _build_tools() -> list[Tool]:
    tools = []
    for name in MCP_READONLY_TOOLS:
        s = _schema_for(name)
        tools.append(
            Tool(
                name=name,
                description=s.get("description", ""),
                inputSchema=s.get(
                    "input_schema", {"type": "object", "properties": {}}
                ),
            )
        )
    return tools


def can_dispatch(name: str) -> bool:
    """Return True if *name* is in the read-only allowlist AND has a handler."""
    return name in MCP_READONLY_TOOLS and name in chat_agent.TOOL_DISPATCH


@server.list_tools()
async def list_tools() -> list[Tool]:
    return _build_tools()


@server.call_tool()
async def call_tool(name: str, arguments: dict) -> list[TextContent]:
    if not can_dispatch(name):
        return [TextContent(type="text", text=f"unknown or non-exposed tool: {name}")]
    handler = chat_agent.TOOL_DISPATCH[name]
    result = await handler(arguments or {})
    return [TextContent(type="text", text=str(result))]


async def main() -> None:
    async with stdio_server() as (read, write):
        await server.run(read, write, server.create_initialization_options())


def cli() -> None:
    """Sync console-script entrypoint (`hypenode-mcp`)."""
    import asyncio

    asyncio.run(main())


if __name__ == "__main__":
    cli()
