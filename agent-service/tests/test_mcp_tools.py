import asyncio

from src import mcp_server

READ_ONLY = {
    "get_sector_sentiment", "get_fund_flow", "get_news", "get_sector_spotlight",
    "list_ssi_indices", "propose_basket", "run_backtest", "get_currency_snapshot",
    "check_risk_thresholds", "get_macro_calendar", "get_macro_event_history",
    "get_smart_money_signal", "list_funding_rounds", "get_project_fundraising",
    "search_rootdata", "get_rootdata_project", "get_rootdata_investor",
}
FORBIDDEN_SUBSTRINGS = ("trade", "transfer", "cancel", "wrap", "balances", "list_orders")


def _tool_names():
    tools = asyncio.run(mcp_server.list_tools())
    return {t.name for t in tools}


def test_exposes_exactly_the_readonly_set():
    assert _tool_names() == READ_ONLY


def test_no_stateful_tool_is_exposed():
    for name in _tool_names():
        for bad in FORBIDDEN_SUBSTRINGS:
            assert bad not in name, f"stateful tool leaked into MCP: {name}"


def test_every_listed_tool_is_dispatchable():
    # Each advertised tool must resolve to a callable handler (no dangling names).
    for name in _tool_names():
        assert mcp_server.can_dispatch(name), f"no handler for {name}"
