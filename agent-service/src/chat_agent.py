"""Agentic /chat handler.

Wraps the Anthropic Messages API with a manual tool-use loop. The loop:

  1. Send the conversation + tool schemas to Claude.
  2. If Claude requests a tool call, dispatch to the corresponding Python
     coroutine (terminal / backtest / risk), append `tool_result` blocks,
     and continue.
  3. Stop when Claude returns `stop_reason == "end_turn"` or after a hard
     iteration cap (defense against runaway loops).

Tool traces flow back to the UI inside `ChatTurn.tool_calls`, so the chat
page can render the "Tool execution trace" card from the redesign.

Prompt caching: a single `cache_control` breakpoint sits on the last
system block. Render order is `tools → system → messages`, so that one
breakpoint caches the entire static prefix (tool schemas + system prompt)
on the first request and serves it at ~10% cost on every subsequent one.
The 5-minute ephemeral TTL fits typical chat cadence.
"""

from __future__ import annotations

import asyncio
import contextvars
import json
import logging
import os
import time
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable

from anthropic import AsyncAnthropic
from openai import AsyncOpenAI

from .state import ChatRequest, ChatTurn, ChatUsage, ToolCallTrace
from .tools import basket, macro, real_backtest, risk, rootdata, sodex, terminal, treasuries

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Tool surface — exposes a curated, read-only subset of MCP tools to chat.
# Write tools (ssi.wrap, sodex.execute_trade) require a wallet signature and
# are not safe to auto-call from a conversational agent.
# ---------------------------------------------------------------------------

SECTORS = ["DePIN", "RWA", "AI", "DeFi", "Memes", "GameFi", "Layer1", "Layer2", "NFT"]

TOOL_SCHEMAS: list[dict[str, Any]] = [
    {
        "name": "get_sector_sentiment",
        "description": (
            "Get the current sentiment score (0-100) for a crypto sector based on "
            "SoSoValue Terminal news velocity + classification. Use for any 'how is "
            "X sector doing' / 'sentiment on X' question."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "sector": {
                    "type": "string",
                    "description": f"Sector name. Common values: {', '.join(SECTORS)}.",
                },
                "window": {
                    "type": "string",
                    "enum": ["1h", "4h", "24h", "7d", "30d"],
                    "description": "Time window. Default 1h.",
                    "default": "1h",
                },
            },
            "required": ["sector"],
        },
    },
    {
        "name": "get_fund_flow",
        "description": (
            "Get net fund flow (USD) into a sector over a window, plus the top "
            "asset by inflow. For BTC, this returns ETF flow data (IBIT). For "
            "other sectors, returns aggregated sector flow."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "sector": {"type": "string", "description": "Sector or asset symbol."},
                "window": {
                    "type": "string",
                    "enum": ["1h", "4h", "24h", "7d", "30d"],
                    "default": "24h",
                },
            },
            "required": ["sector"],
        },
    },
    {
        "name": "get_news",
        "description": (
            "Recent news headlines tagged to a sector, with a heuristic sentiment "
            "score per headline. Use when the user asks 'why is X moving' or "
            "wants headlines."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "sector": {"type": "string"},
                "limit": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 50,
                    "default": 10,
                },
            },
            "required": ["sector"],
        },
    },
    {
        "name": "get_sector_spotlight",
        "description": (
            "Snapshot of all macro sectors with 24h change % and market-cap "
            "dominance, plus narrative spotlight rotation. Use for 'what's hot' "
            "or 'which sectors are moving' questions."
        ),
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "list_ssi_indices",
        "description": (
            "List the SSI Protocol's narrative index tickers (ssiDePIN, ssiRWA, "
            "ssiAI, ssiMAG7, etc.) that users can wrap into."
        ),
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "propose_basket",
        "description": (
            "Build a real, on-chain-grounded basket from the SSI Protocol's "
            "live constituent list for a sector. Pulls actual asset_ids + "
            "current market snapshots (price/mcap/change_24h), scores by "
            "composite of size × momentum, and returns top-N with weights "
            "summing to 1.0. ALWAYS call this before claiming what assets "
            "are in a sector — never recall asset names from memory."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "sector": {
                    "type": "string",
                    "description": (
                        "Sector name (DePIN, RWA, AI, DeFi, GameFi, Layer1, "
                        "Layer2, NFT, Meme, MAG7, CeFi, PayFi, SocialFi) or "
                        "an explicit SSI ticker (ssiDePIN, etc)."
                    ),
                },
                "n_assets": {
                    "type": "integer",
                    "default": 8,
                    "minimum": 1,
                    "maximum": 20,
                },
                "weighting": {
                    "type": "string",
                    "enum": ["score", "marketcap", "equal", "ssi_reference"],
                    "default": "score",
                    "description": (
                        "score = log10(mcap)*(1+chg24h); marketcap = pure mcap; "
                        "equal = 1/N; ssi_reference = SSI Protocol's reference."
                    ),
                },
            },
            "required": ["sector"],
        },
    },
    {
        "name": "run_backtest",
        "description": (
            "Replay a basket's historical performance using REAL daily klines "
            "from SoSoValue (default 90d window). Computes annualized Sharpe, "
            "max drawdown, total return, win rate, and BTC/ETH benchmark "
            "comparison. ALWAYS pass the constituents from `propose_basket` — "
            "never invent asset_ids."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "constituents": {
                    "type": "array",
                    "description": (
                        "List of {currency_id, symbol, weight} from "
                        "propose_basket.constituents."
                    ),
                    "items": {
                        "type": "object",
                        "properties": {
                            "currency_id": {"type": "string"},
                            "symbol": {"type": "string"},
                            "weight": {"type": "number"},
                        },
                        "required": ["currency_id", "weight"],
                    },
                },
                "days": {
                    "type": "integer",
                    "default": 90,
                    "minimum": 14,
                    "maximum": 365,
                },
            },
            "required": ["constituents"],
        },
    },
    {
        "name": "get_currency_snapshot",
        "description": (
            "Live market snapshot for a single asset by SoSoValue currency_id "
            "(price, marketcap, 24h change %, turnover, rank). Use when the "
            "user asks 'how is FIL doing right now' for a specific asset."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "currency_id": {"type": "string", "description": "SoSoValue currency id (long numeric string)."},
                "symbol_hint": {"type": "string", "description": "Optional ticker for logging context."},
            },
            "required": ["currency_id"],
        },
    },
    {
        "name": "check_risk_thresholds",
        "description": (
            "Evaluate current portfolio metrics (volatility, drawdown, sentiment "
            "delta, single-asset weight, 24h net outflow) against the standard "
            "risk gate. Returns PASS or EMERGENCY_EXIT plus a list of breaches. "
            "Use when the user asks 'is this risky', 'should I exit', or wants "
            "to verify risk gates."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "metrics": {
                    "type": "object",
                    "description": (
                        "Object with optional fields: volatility (decimal, e.g. "
                        "0.28), drawdown (decimal), sentiment_delta (signed int), "
                        "weights (object of symbol → weight), net_outflow_24h_usd "
                        "(number)."
                    ),
                },
                "thresholds": {
                    "type": "object",
                    "description": "Optional override of default risk thresholds.",
                },
            },
            "required": ["metrics"],
        },
    },
    {
        "name": "get_macro_calendar",
        "description": (
            "Upcoming US macro economic releases (FOMC, CPI, NFP, GDP, etc.) "
            "for the next N days. Use when the user asks about scheduled macro "
            "risk, 'what's the calendar', or 'any FOMC this week'."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "days": {"type": "integer", "minimum": 1, "maximum": 30, "default": 7},
            },
        },
    },
    {
        "name": "get_macro_event_history",
        "description": (
            "Historical actual / forecast / previous prints for a named macro "
            "event (e.g. 'Nonfarm Payrolls', 'CPI'). Use when the user wants "
            "the surprise track record or recent prints for a specific event."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "event": {"type": "string", "description": "Event label as listed by get_macro_calendar."},
                "limit": {"type": "integer", "minimum": 1, "maximum": 100, "default": 12},
            },
            "required": ["event"],
        },
    },
    {
        "name": "get_smart_money_signal",
        "description": (
            "Public-company BTC treasury accumulation signal. Returns the top-5 "
            "companies (MSTR, TSLA, MARA, RIOT, CLSK, etc.) ranked by current "
            "BTC holdings, each company's 30-day buy delta in BTC and USD, "
            "whether any of them bought in the last 7 days, and the biggest "
            "30-day net buyer. Use when the user asks 'who's accumulating', "
            "'is smart money buying BTC', or 'what did MSTR do this month'."
        ),
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "list_funding_rounds",
        "description": (
            "Recent crypto fundraising rounds across listed-currency projects "
            "on SoSoValue. Returns latest rounds sorted by date descending, "
            "each with project name, round (Seed/Series A/B/Strategic/IPO/etc), "
            "amount raised USD, valuation USD, date, and investor list "
            "(with lead-investor flag). Also returns total_raised_usd, "
            "projects_count, rounds_count, and a coverage_note. "
            "IMPORTANT: coverage is limited to listed currencies — pre-launch "
            "/ private startups visible on sosovalue.com/assets/fundraising "
            "(sourced from RootData) are NOT reachable via OpenAPI. Be honest "
            "about this when the user asks 'what fundraised today/this week'."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "limit": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 100,
                    "default": 20,
                    "description": "How many recent rounds to return.",
                },
                "probe_count": {
                    "type": "integer",
                    "minimum": 10,
                    "maximum": 200,
                    "default": 60,
                    "description": (
                        "How many top currencies to probe. Higher = more "
                        "coverage but slower (rate-limited). Default 60."
                    ),
                },
            },
        },
    },
    {
        "name": "get_project_fundraising",
        "description": (
            "Full fundraising history for a single project, addressed by "
            "SoSoValue currency_id. Returns rounds (with investors), aggregate "
            "investor list, team, investment stats (total_rounds, "
            "rounds_last_year, lead_invest_count, last_invest_date, "
            "portfolio_count), and portfolio of related projects. Use when "
            "the user asks 'who funded X', 'what's X's funding history', or "
            "'show valuation history for X'."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "currency_id": {
                    "type": "string",
                    "description": (
                        "SoSoValue numeric currency_id (e.g. "
                        "1673723677362319866 for Bitcoin). Resolve via "
                        "list_funding_rounds or list_ssi_indices first if "
                        "the user gave a name/symbol."
                    ),
                },
            },
            "required": ["currency_id"],
        },
    },
    {
        "name": "search_rootdata",
        "description": (
            "Search RootData (the upstream venture-funding database that "
            "sosovalue.com uses for /assets/fundraising) for projects, VCs, "
            "or people by keyword. FREE — costs zero RootData credits. Use "
            "when the user names a project that may NOT be a listed currency "
            "yet (e.g. Sportix, Reap, Sahara, OpenTrade). Returns id, type "
            "(1=Project / 2=VC / 3=People), name, one-liner, and rootdataurl. "
            "Pass the resulting `id` to get_rootdata_project for full funding "
            "+ investors detail."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Project, VC, or person name. e.g. 'Sahara', 'Pantera'.",
                },
                "precise_x_search": {
                    "type": "boolean",
                    "default": False,
                    "description": "If true, treat query as exact X (Twitter) handle.",
                },
            },
            "required": ["query"],
        },
    },
    {
        "name": "get_rootdata_project",
        "description": (
            "Full RootData project profile (incl. private/pre-launch projects "
            "not on SoSoValue). Returns total_funding (USD), full investor "
            "list with lead-investor flag, team members, ecosystem, tags, "
            "social links. Costs 2 RootData credits — use after "
            "search_rootdata to resolve `project_id`. Cached 24h to stay "
            "within the 1000 credits/month budget."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "project_id": {
                    "type": "integer",
                    "description": "RootData project id (e.g. 11646 for Sahara). Resolve via search_rootdata first.",
                },
                "include_team": {"type": "boolean", "default": True},
                "include_investors": {"type": "boolean", "default": True},
            },
            "required": ["project_id"],
        },
    },
    {
        "name": "get_rootdata_investor",
        "description": (
            "Full RootData VC / investor profile. Returns invest_overview, "
            "investment list, areas, social media. Costs 2 RootData credits. "
            "Use after search_rootdata returns a result with type=2 (VC), or "
            "when the user asks about a known investor (e.g. 'show Pantera "
            "Capital portfolio')."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "org_id": {
                    "type": "integer",
                    "description": "RootData VC id (e.g. 150 for Pantera Capital).",
                },
                "include_team": {"type": "boolean", "default": False},
                "include_investments": {"type": "boolean", "default": True},
            },
            "required": ["org_id"],
        },
    },
    {
        "name": "sodex_execute_trade",
        "description": (
            "PREPARE a buy on SoDEX spot for the USER'S CONNECTED WALLET "
            "(from the navbar via SIWE). Returns ready_to_sign=True with a "
            "typed_data envelope — the chat UI then prompts the user to "
            "approve and sign in their wallet (wagmi). This NEVER touches the "
            "server's signer key. Supports any listed SoDEX spot pair (BTC, "
            "ETH, SOL, AVAX, SOSO, …); resolves pair, tickSize, stepSize and "
            "minNotional against the live ticker. Always summarize the prepared "
            "order's pair / quantity / limit_price / notional / explorer_url "
            "and TELL THE USER to click Approve in the wallet to fill. If "
            "unsure, suggest mode=\"defensive\" so the limit rests 50%% below "
            "market and won't fill until the user re-trades."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "symbol_out": {
                    "type": "string",
                    "description": "Asset to buy, e.g. 'BTC', 'ETH', 'SOL', 'AVAX'.",
                },
                "amount_in_usdc": {
                    "type": "number",
                    "description": "USDC notional to spend on this buy. Must be ≥ pair minNotional (~$5–10 typical on testnet).",
                },
                "mode": {
                    "type": "string",
                    "enum": ["market", "defensive"],
                    "default": "market",
                    "description": "market=real fill at last × (1 − slippage). defensive=resting limit 50% below market (dry-run, won't fill).",
                },
                "slippage_bps": {
                    "type": "integer",
                    "default": 25,
                    "minimum": 0,
                    "maximum": 1000,
                    "description": "Slippage tolerance in basis points (25 = 0.25%). Only used in market mode.",
                },
            },
            "required": ["symbol_out", "amount_in_usdc"],
        },
    },
    {
        "name": "sodex_sell_trade",
        "description": (
            "PREPARE a sell on SoDEX spot for the USER'S CONNECTED WALLET. "
            "Liquidates `amount_in_asset` units of `symbol` (e.g. 0.05 ETH) "
            "and credits USDC. Returns ready_to_sign=True with a typed_data "
            "envelope — the chat UI then prompts the user to approve and "
            "sign in their wallet (wagmi). NEVER touches the server's "
            "signer key. Use this when the user says 'sell X of Y', "
            "'liquidate', 'close my Y position', or 'exit Y'. Always "
            "summarize quantity / limit_price / notional / explorer_url and "
            "tell the user to click Approve. Suggest mode=\"defensive\" "
            "(rest 100%% above market — won't fill) only for dry-run."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "symbol": {
                    "type": "string",
                    "description": "Asset to sell, e.g. 'ETH', 'AVAX', 'SOSO'. USDC is the implicit quote.",
                },
                "amount_in_asset": {
                    "type": "number",
                    "description": "Quantity of `symbol` to sell. Must produce ≥ pair minNotional (~$5 USDC equivalent).",
                },
                "mode": {
                    "type": "string",
                    "enum": ["market", "defensive"],
                    "default": "market",
                    "description": "market=real fill at last × (1 − slippage). defensive=resting limit 100%% above market (dry-run, won't fill).",
                },
                "slippage_bps": {
                    "type": "integer",
                    "default": 25,
                    "minimum": 0,
                    "maximum": 1000,
                },
            },
            "required": ["symbol", "amount_in_asset"],
        },
    },
    {
        "name": "sodex_get_balances",
        "description": (
            "Check the USER'S CONNECTED WALLET balances on SoDEX. Returns "
            "structured data PLUS a `display` array of pre-formatted lines. "
            "MANDATORY: when answering the user about their balances, echo "
            "the `display` lines VERBATIM — do not paraphrase or round. "
            "Lines look like 'vETH: 0.002 available · 0.005 locked (in "
            "resting orders)'. If `locked > 0`, ALSO mention "
            "`open_orders_summary` so the user knows what's tying up the "
            "balance and offer to cancel via sodex_cancel_order. If a "
            "recent trade isn't reflected, mention SoDEX testnet block lag "
            "(2-5s) — don't claim the trade failed. Output also has "
            "`open_orders_count`, `freshness`, raw `balances` (with total, "
            "locked, available per row), and a `note`."
        ),
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "sodex_list_orders",
        "description": (
            "List open SoDEX spot orders for the USER'S CONNECTED WALLET. "
            "Returns {wallet, wallet_source, orders}. Use before placing "
            "more, and to grab order_id + symbol_id for cancellations."
        ),
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "sodex_cancel_order",
        "description": (
            "Cancel a single open SoDEX spot order by symbol_id + order_id. "
            "Resolve both via sodex_list_orders first."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "symbol_id": {"type": "integer"},
                "order_id": {"type": "integer"},
            },
            "required": ["symbol_id", "order_id"],
        },
    },
]


# ---------------------------------------------------------------------------
# Dispatch table — maps tool names to async callables. Each callable accepts
# the raw `input` dict from the model and returns whatever the tool returns;
# the loop serializes the return value to JSON for the tool_result block.
# ---------------------------------------------------------------------------


async def _tool_get_sentiment(args: dict[str, Any]) -> Any:
    return await terminal.get_sentiment(
        sector=args.get("sector", "DePIN"),
        window=args.get("window", "1h"),
    )


async def _tool_get_fund_flow(args: dict[str, Any]) -> Any:
    return await terminal.get_fund_flow(
        sector=args.get("sector", "DePIN"),
        window=args.get("window", "24h"),
    )


async def _tool_get_news(args: dict[str, Any]) -> Any:
    return await terminal.get_news(
        sector=args.get("sector", "DePIN"),
        limit=int(args.get("limit", 10)),
    )


async def _tool_get_sector_spotlight(_args: dict[str, Any]) -> Any:
    return await terminal.get_sector_spotlight()


async def _tool_list_ssi(_args: dict[str, Any]) -> Any:
    return await terminal.list_ssi_tickers()


async def _tool_propose_basket(args: dict[str, Any]) -> Any:
    return await basket.propose_basket(
        sector=args.get("sector", "DePIN"),
        n_assets=int(args.get("n_assets", 8)),
        weighting=args.get("weighting", "score"),
    )


async def _tool_run_backtest(args: dict[str, Any]) -> Any:
    constituents = args.get("constituents") or []
    if not isinstance(constituents, list):
        return {"ok": False, "error": "constituents must be a list"}
    return await real_backtest.run_real_backtest(
        constituents=constituents,
        days=int(args.get("days", 90)),
    )


async def _tool_get_currency_snapshot(args: dict[str, Any]) -> Any:
    cid = args.get("currency_id")
    if not cid:
        return {"error": "currency_id required"}
    snap = await terminal.get_currency_snapshot(cid)
    return snap if snap is not None else {"error": "snapshot unavailable (transport failure or unknown id)"}


async def _tool_check_risk(args: dict[str, Any]) -> Any:
    return await risk.check_thresholds(
        metrics=args.get("metrics", {}) or {},
        thresholds=args.get("thresholds") or None,
    )


async def _tool_get_macro_calendar(args: dict[str, Any]) -> Any:
    return await macro.get_upcoming_events(days=int(args.get("days", 7)))


async def _tool_get_macro_event_history(args: dict[str, Any]) -> Any:
    return await macro.get_event_history(
        event=args.get("event", ""),
        limit=int(args.get("limit", 12)),
    )


async def _tool_get_smart_money(_args: dict[str, Any]) -> Any:
    return await treasuries.get_smart_money_signal()


async def _tool_list_funding_rounds(args: dict[str, Any]) -> Any:
    return await terminal.list_funding_rounds(
        limit=int(args.get("limit", 20)),
        probe_count=int(args.get("probe_count", 60)),
    )


async def _tool_get_project_fundraising(args: dict[str, Any]) -> Any:
    cid = args.get("currency_id")
    if not cid:
        return {"error": "currency_id required"}
    payload = await terminal.get_currency_fundraising(str(cid))
    if not payload:
        return {"error": "no fundraising data for currency_id (unknown id or transport failure)"}
    return payload


async def _tool_search_rootdata(args: dict[str, Any]) -> Any:
    if not rootdata.is_configured():
        return {"error": "ROOTDATA_API_KEY not set — set it in agent-service/.env"}
    return await rootdata.search(
        query=str(args.get("query", "")),
        precise_x=bool(args.get("precise_x_search", False)),
    )


async def _tool_get_rootdata_project(args: dict[str, Any]) -> Any:
    if not rootdata.is_configured():
        return {"error": "ROOTDATA_API_KEY not set"}
    pid = args.get("project_id")
    if pid is None:
        return {"error": "project_id required"}
    detail = await rootdata.get_project(
        project_id=int(pid),
        include_team=bool(args.get("include_team", True)),
        include_investors=bool(args.get("include_investors", True)),
    )
    if not detail:
        return {"error": "no detail (unknown project_id, tier-locked, or rate-limited)"}
    return detail


async def _tool_get_rootdata_investor(args: dict[str, Any]) -> Any:
    if not rootdata.is_configured():
        return {"error": "ROOTDATA_API_KEY not set"}
    oid = args.get("org_id")
    if oid is None:
        return {"error": "org_id required"}
    detail = await rootdata.get_org(
        org_id=int(oid),
        include_team=bool(args.get("include_team", False)),
        include_investments=bool(args.get("include_investments", True)),
    )
    if not detail:
        return {"error": "no detail (unknown org_id, tier-locked, or rate-limited)"}
    return detail


async def _tool_sodex_execute_trade(args: dict[str, Any]) -> Any:
    sym_out = args.get("symbol_out")
    if not sym_out:
        return {"error": "symbol_out required"}
    amount = args.get("amount_in_usdc")
    if amount is None:
        return {"error": "amount_in_usdc required"}
    try:
        amount_f = float(amount)
    except (TypeError, ValueError):
        return {"error": f"amount_in_usdc must be numeric, got {amount!r}"}
    if amount_f <= 0:
        return {"error": "amount_in_usdc must be > 0"}
    signer = _CURRENT_WALLET.get()
    if not signer:
        return {
            "error": (
                "no connected wallet — connect via the navbar (SIWE) before "
                "asking the agent to trade. The agent never holds your private key."
            )
        }
    return await sodex.prepare_trade(
        side="buy",
        asset_symbol=str(sym_out).upper(),
        amount=amount_f,
        signer_address=signer,
        slippage_bps=int(args.get("slippage_bps", 25)),
        mode=str(args.get("mode", "market")),
    )


async def _tool_sodex_sell_trade(args: dict[str, Any]) -> Any:
    sym = args.get("symbol")
    if not sym:
        return {"error": "symbol required (asset to sell, e.g. ETH)"}
    qty = args.get("amount_in_asset")
    if qty is None:
        return {"error": "amount_in_asset required (qty of asset to sell)"}
    try:
        qty_f = float(qty)
    except (TypeError, ValueError):
        return {"error": f"amount_in_asset must be numeric, got {qty!r}"}
    if qty_f <= 0:
        return {"error": "amount_in_asset must be > 0"}
    signer = _CURRENT_WALLET.get()
    if not signer:
        return {
            "error": (
                "no connected wallet — connect via the navbar (SIWE) before "
                "asking the agent to trade. The agent never holds your private key."
            )
        }
    return await sodex.prepare_trade(
        side="sell",
        asset_symbol=str(sym).upper(),
        amount=qty_f,
        signer_address=signer,
        slippage_bps=int(args.get("slippage_bps", 25)),
        mode=str(args.get("mode", "market")),
    )


async def _tool_sodex_get_balances(_args: dict[str, Any]) -> Any:
    addr = _resolve_user_address()
    if not addr:
        return {"error": "no wallet — connect via the navbar (SIWE) or set SODEX_PRIVATE_KEY"}

    # Fetch balances + open orders in parallel so the agent can correlate
    # "missing" balance with resting orders. SoDEX's `total` field includes
    # locked qty (parked in open orders), which routinely confuses users —
    # surface `available = total − locked` and `open_orders_count` explicitly.
    raw_balances, open_orders = await asyncio.gather(
        sodex.get_balances(user_address=addr),
        sodex.list_open_spot_orders(user_address=addr),
    )

    def _enrich(rows: Any) -> Any:
        if not isinstance(rows, list):
            return rows
        out = []
        for b in rows:
            if not isinstance(b, dict):
                out.append(b)
                continue
            try:
                total = float(b.get("total") or 0)
                locked = float(b.get("locked") or 0)
                available = total - locked
            except (TypeError, ValueError):
                available = None
            entry = dict(b)
            if available is not None:
                # Format with up to 8 decimals, strip trailing zeros for readability.
                s = f"{available:.8f}".rstrip("0").rstrip(".")
                entry["available"] = s or "0"
            out.append(entry)
        return out

    balances = dict(raw_balances) if isinstance(raw_balances, dict) else {}
    balances["spot"] = _enrich(balances.get("spot"))
    balances["perps"] = _enrich(balances.get("perps"))

    # Pre-formatted display lines the agent should echo verbatim. We've seen
    # Claude paraphrase balance numbers and silently drop `locked` info,
    # leading to "0.0000 ETH" claims when in fact ETH is locked in a resting
    # sell. These strings remove that ambiguity.
    display_lines: list[str] = []
    n_open = len(open_orders) if isinstance(open_orders, list) else 0
    for b in balances.get("spot") or []:
        if not isinstance(b, dict):
            continue
        coin = b.get("coin", "?")
        avail = b.get("available", "0")
        try:
            locked = float(b.get("locked") or 0)
        except (TypeError, ValueError):
            locked = 0.0
        if locked > 0:
            locked_s = f"{locked:.8f}".rstrip("0").rstrip(".") or "0"
            display_lines.append(
                f"{coin}: {avail} available · {locked_s} locked (in resting orders)"
            )
        else:
            display_lines.append(f"{coin}: {avail} available")

    spot_meta = balances.get("spot_meta") or {}
    perps_meta = balances.get("perps_meta") or {}
    return {
        "wallet": addr,
        "wallet_source": _CURRENT_WALLET.get() and "connected" or "server_signer",
        "display": display_lines,
        "open_orders_count": n_open,
        "open_orders_summary": [
            {
                "side": ("BUY" if o.get("side") in (1, "1", "BUY") else "SELL"),
                "symbol_id": o.get("symbolID"),
                "price": o.get("price"),
                "quantity": o.get("quantity"),
                "filled": o.get("cumQty"),
                "status": o.get("status"),
                "cl_ord_id": o.get("clOrdID"),
                "order_id": o.get("orderID"),
            }
            for o in (open_orders or [])
            if isinstance(o, dict)
        ][:10],
        "balances": balances,
        "freshness": {
            "spot_block_time": spot_meta.get("blockTime") if isinstance(spot_meta, dict) else None,
            "perps_block_time": perps_meta.get("blockTime") if isinstance(perps_meta, dict) else None,
            "now_ms": int(time.time() * 1000),
        },
        "note": (
            "`available` = total − locked. Locked qty is parked in resting "
            "open orders (cancel them to free it). If a recent trade isn't "
            "reflected, SoDEX testnet block lag is usually 2–5s — re-check "
            "after a few seconds."
        ),
    }


async def _tool_sodex_list_orders(_args: dict[str, Any]) -> Any:
    addr = _resolve_user_address()
    return {
        "wallet": addr,
        "wallet_source": _CURRENT_WALLET.get() and "connected" or "server_signer",
        "orders": await sodex.list_open_spot_orders(user_address=addr),
    }


async def _tool_sodex_cancel_order(args: dict[str, Any]) -> Any:
    sid = args.get("symbol_id")
    oid = args.get("order_id")
    if sid is None or oid is None:
        return {"error": "symbol_id and order_id required"}
    return await sodex.cancel_spot_order(symbol_id=int(sid), order_id=int(oid))


# Per-request wallet address from the SIWE-connected user. Set in
# run_agentic_chat() before tool dispatch. Tools read this via
# _resolve_user_address() so balance/order queries reflect the navbar
# wallet, not the server's signer key.
_CURRENT_WALLET: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "current_wallet", default=None
)


def _resolve_user_address() -> str | None:
    """Address that read-only SoDEX tools should query.

    Priority: connected SIWE wallet → SODEX_PUBLIC_ADDRESS env →
    address derived from SODEX_PRIVATE_KEY (server signer fallback).
    """
    addr = _CURRENT_WALLET.get()
    if addr:
        return addr
    env_addr = os.getenv("SODEX_PUBLIC_ADDRESS", "").strip()
    if env_addr:
        return env_addr
    return _derive_signer_address()


def _derive_signer_address() -> str | None:
    """Recover the public address from SODEX_PRIVATE_KEY for balance / order lookups.

    Cached at module level to avoid recomputing on every tool call.
    """
    global _SIGNER_ADDR_CACHE
    if _SIGNER_ADDR_CACHE is not None:
        return _SIGNER_ADDR_CACHE or None
    pk = os.getenv("SODEX_PRIVATE_KEY", "").strip()
    if not pk:
        _SIGNER_ADDR_CACHE = ""
        return None
    try:
        from eth_account import Account
        if not pk.startswith("0x"):
            pk = "0x" + pk
        addr = Account.from_key(pk).address
        _SIGNER_ADDR_CACHE = addr
        return addr
    except Exception:
        _SIGNER_ADDR_CACHE = ""
        return None


_SIGNER_ADDR_CACHE: str | None = None


TOOL_DISPATCH: dict[str, Callable[[dict[str, Any]], Awaitable[Any]]] = {
    "get_sector_sentiment": _tool_get_sentiment,
    "get_fund_flow": _tool_get_fund_flow,
    "get_news": _tool_get_news,
    "get_sector_spotlight": _tool_get_sector_spotlight,
    "list_ssi_indices": _tool_list_ssi,
    "propose_basket": _tool_propose_basket,
    "run_backtest": _tool_run_backtest,
    "get_currency_snapshot": _tool_get_currency_snapshot,
    "check_risk_thresholds": _tool_check_risk,
    "get_macro_calendar": _tool_get_macro_calendar,
    "get_macro_event_history": _tool_get_macro_event_history,
    "get_smart_money_signal": _tool_get_smart_money,
    "list_funding_rounds": _tool_list_funding_rounds,
    "get_project_fundraising": _tool_get_project_fundraising,
    "search_rootdata": _tool_search_rootdata,
    "get_rootdata_project": _tool_get_rootdata_project,
    "get_rootdata_investor": _tool_get_rootdata_investor,
    "sodex_execute_trade": _tool_sodex_execute_trade,
    "sodex_sell_trade": _tool_sodex_sell_trade,
    "sodex_get_balances": _tool_sodex_get_balances,
    "sodex_list_orders": _tool_sodex_list_orders,
    "sodex_cancel_order": _tool_sodex_cancel_order,
}


# ---------------------------------------------------------------------------
# Output summarization — keeps tool_calls payload to the UI compact while
# staying recognizable. The full result is also returned to Claude via
# tool_result; only the UI trace is summarized here.
# ---------------------------------------------------------------------------


def _summarize_output(name: str, result: Any) -> str | None:
    try:
        if name == "get_sector_sentiment":
            if not result.get("ok", True):
                return f"unavailable — {result.get('error', 'unknown')}"
            d = result.get("delta", 0)
            sign = "+" if d >= 0 else ""
            return (
                f"score={result.get('score')} delta={sign}{d} "
                f"sector={result.get('sector')} (proxy: news velocity)"
            )
        if name == "get_fund_flow":
            if not result.get("ok", True):
                return f"unavailable — {(result.get('error') or '')[:80]}"
            inflow = int(result.get("net_inflow_usd", 0))
            top = result.get("top_asset") or "?"
            return f"net inflow ${inflow:,} (top: {top})"
        if name == "get_news":
            # Real responses are a plain list; backoff returns {ok:false}.
            if isinstance(result, dict) and not result.get("ok", True):
                return f"unavailable — {(result.get('error') or '')[:80]}"
            n = len(result) if isinstance(result, list) else 0
            return f"{n} headline{'' if n == 1 else 's'}"
        if name == "get_sector_spotlight":
            if isinstance(result, dict) and not result.get("ok", True):
                return f"unavailable — {(result.get('error') or '')[:80]}"
            sectors = result.get("sector", []) if isinstance(result, dict) else []
            if sectors:
                top = max(sectors, key=lambda s: float(s.get("change_pct_24h", 0)))
                return (
                    f"{len(sectors)} sectors · top: {top['name']} "
                    f"({float(top['change_pct_24h']) * 100:+.2f}%)"
                )
            return "no data"
        if name == "list_ssi_indices":
            if isinstance(result, dict):
                if not result.get("ok", True):
                    return f"unavailable — {(result.get('error') or '')[:80]}"
                tickers = result.get("tickers", [])
                return f"{len(tickers)} indices"
            n = len(result) if isinstance(result, list) else 0
            return f"{n} indices"
        if name == "propose_basket":
            if not result.get("ok"):
                return f"error: {result.get('error', 'unknown')}"
            summary = result.get("summary", {})
            symbols = summary.get("symbols", [])[:5]
            extra = "" if len(summary.get("symbols", [])) <= 5 else f"+{len(summary.get('symbols', [])) - 5} more"
            avg_chg = summary.get("avg_change_24h_pct", 0)
            return f"{result['n_picked']}/{result['n_pool']} picked: {', '.join(symbols)}{extra} · avg 24h {avg_chg:+.1f}%"
        if name == "run_backtest":
            if not result.get("ok"):
                return f"error: {result.get('error', 'unknown')}"
            sharpe = result.get("sharpe", 0)
            ret = float(result.get("return", 0)) * 100
            dd = float(result.get("max_drawdown", 0)) * 100
            vs_btc = result.get("vs_btc")
            tail = f" · vs BTC {float(vs_btc) * 100:+.1f}%" if vs_btc is not None else ""
            return f"Sharpe {sharpe} · MaxDD {dd:+.1f}% · ret {ret:+.1f}%{tail}"
        if name == "get_currency_snapshot":
            if "error" in result:
                return f"error: {result['error']}"
            chg = float(result.get("change_pct_24h", 0)) * 100
            mcap = float(result.get("marketcap", 0))
            return f"price ${result.get('price', 0):.4f} · 24h {chg:+.2f}% · mcap ${mcap:,.0f}"
        if name == "check_risk_thresholds":
            verdict = result.get("verdict", "?")
            n = len(result.get("breaches", []) or [])
            return f"{verdict} · {n} breach{'es' if n != 1 else ''}"
        if name == "sodex_get_balances":
            if "error" in result:
                return f"error: {result['error']}"
            spot = (result.get("balances") or {}).get("spot") or []
            n_open = result.get("open_orders_count", 0)
            n_locked = sum(
                1 for b in spot if isinstance(b, dict) and float(b.get("locked") or 0) > 0
            )
            tail = f" · {n_open} open order{'s' if n_open != 1 else ''}"
            if n_locked:
                tail += f" · {n_locked} asset{'s' if n_locked != 1 else ''} locked"
            return f"{len(spot)} spot balance{'s' if len(spot) != 1 else ''}{tail}"
    except Exception:
        # Summary is purely cosmetic — never let a formatting error fail the
        # tool call itself.
        pass
    return None


def _truncate_for_trace(value: Any, max_chars: int = 600) -> Any:
    """Cap the raw output we ship to the UI so equity series etc. don't bloat
    the chat history. The full payload still went to Claude via tool_result.

    Bypass: when the payload signals a UI-driven follow-up (e.g.
    `ready_to_sign=True` from sodex_execute_trade), keep it intact — the
    chat UI extracts typed_data + submit_payload from the trace to render
    the approval card. Truncating those would silently break the flow.
    """
    if isinstance(value, dict) and value.get("ready_to_sign") is True:
        return value
    try:
        s = json.dumps(value, default=str)
    except Exception:
        s = str(value)
    if len(s) <= max_chars:
        return value
    return {"__truncated__": True, "preview": s[:max_chars] + "…"}


# ---------------------------------------------------------------------------
# System prompt — frozen across requests so it caches cleanly. Don't
# interpolate timestamps or per-request data here; that would invalidate the
# cached prefix.
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """You are HypeNode, an autonomous on-chain index research agent.

You help users research crypto sectors, draft index baskets, run backtests, and
evaluate risk gates using LIVE data from SoSoValue Terminal via the tools below.

## RED LINE RULES — violating any of these is a critical failure

**R1. NUMBERS MUST COME FROM TOOL CALLS THIS TURN.** Every quantitative claim
in your response — sentiment score, weight %, market cap, 24h change, price,
Sharpe, drawdown, win rate, return %, vs-BTC delta, fund flow $ — must trace
back to a tool result returned in the CURRENT turn. Earlier turns, system
prompt examples, and your training data are NOT valid sources.

**R2. NO BACKTEST NUMBERS WITHOUT `run_backtest`.** If you have not called
`run_backtest` in this turn, you MUST NOT mention Sharpe, max drawdown, win
rate, 90d return, vs-BTC return, vs-ETH return, or any "Risk Summary" /
"Historical Performance" section. Calling other tools (e.g. `propose_basket`)
does not unlock backtest numbers.

**R3. NO CONSTITUENT WEIGHTS / PRICES WITHOUT `propose_basket` OR
`get_currency_snapshot` THIS TURN.** Never list assets, weights, market caps,
or 24h % moves from memory. PENDLE 22%, SKY 21%, FIL 18% — all forbidden
unless those exact numbers appear in a tool result you just received.

**R4. TRUNCATED OUTPUT IS A WALL.** If a tool result includes
`__truncated__: true`, the only fields you may quote are those visible in
`output_summary` and the un-truncated portion of `output_raw`. Do NOT
extrapolate to fields hidden behind the truncation. If you need more detail,
call the tool again with narrower parameters or `get_currency_snapshot` for
each asset.

**R5. TOOL FAILURE IS THE TRUTH.** When a tool returns `ok: false`, surface
the `error` string verbatim. Never substitute fabricated data. Acceptable:
"Fund flow unavailable — SoSoValue does not expose per-sector flow for RWA."
Forbidden: any made-up flow figure.

**R6. NO FAKE EXECUTION CLAIMS.** SSI wrap, SSI unwrap, SoDEX trade — none
are exposed as tools here. Never say "I wrapped", "deployed", "executed", or
"submitted to SSI". The user signs from their wallet; you only prepare the
plan.

## Pre-response self-check (run mentally before sending)

1. Scan your draft for these forbidden patterns: `Sharpe \\d`, `drawdown.*-?\\d`,
   `return.*-?\\d.*%`, `\\d+%` weight assertions, `\\$\\d+(M|B)` market caps,
   `\\+?\\d+\\.\\d+%` 24h moves.
2. For each match: did a tool in THIS turn return that exact number?
3. If no — DELETE the sentence. Do not soften it ("approximately", "around")
   — delete it entirely.
4. Replace deleted sections with: "I haven't run `<tool_name>` this turn —
   call it explicitly if you need that figure" OR auto-call the tool now.

## Auto-pipelines (call BEFORE responding, do not skip steps)

User says "deploy / wrap / publish / launch <basket> to SSI":
  REQUIRED before answering:
  1. `propose_basket(sector=<X>, n_assets=<N>)` — get real constituents
  2. `run_backtest(constituents=<from step 1>, days=90)` — get real metrics
  3. `check_risk_thresholds(...)` — get gate status
  Only then describe the plan + ask for signature. NEVER skip step 2 then
  cite Sharpe/drawdown — that is a critical failure.

User says "build top-N basket for sector X" OR "build <sector> index":
  Default N=8 if user didn't specify a number. DO NOT ask back — just proceed
  with N=8 and mention the default in your response so they can adjust.
  1. `get_sector_sentiment(sector=X)` — gate if threshold given
  2. `propose_basket(sector=X, n_assets=N)`
  3. `run_backtest(constituents=<step 2>, days=90)`

User says "how is sector X doing?":
  1. `get_sector_sentiment(sector=X)` + `get_fund_flow(sector=X)` (parallel)
  2. (optional) `get_news(sector=X, limit=5)`

User says "what's hot right now?":
  1. `get_sector_spotlight()`

User says "compare X to BTC / ETH":
  - Asset → `get_currency_snapshot` + `run_backtest` (vs_btc included)
  - Basket → `run_backtest` (vs_btc, vs_eth included)

## Tool-use boundaries

- Read-only tools — call freely. Never apologize for calling tools.
- `get_fund_flow` returns real ETF flow ONLY for BTC. Other sectors return
  `ok: false / data_source: "unsupported"` — surface that, pivot to
  `propose_basket` + per-asset snapshots.
- Write tools (SSI wrap, SoDEX trade) are NOT in your toolset. Never claim
  execution; describe the plan and end with the action statement (below).

## Response style

- Concise and concrete. Lead with the specific numbers from THIS turn's
  tool outputs. Bullet points and small tables OK.
- No raw JSON dumps — the UI renders a tool-trace card. Your job is
  interpretation.
- When tools succeed: surface the numbers. When they fail: surface the error.
- When proposing a concrete next step, end with a single-line action:
    `Action: deploy HDP8 (8 constituents from ssiDePIN) to SSI Protocol —
     awaiting your signature.`
- Markdown only — no LaTeX, no `\\frac`, no escaped `$`.

## Honest hedges (use these instead of fabricating)

- "I haven't run `run_backtest` for this basket this turn — say the word and
  I'll pull real Sharpe / drawdown / 90d numbers."
- "Per-sector fund flow isn't exposed by SoSoValue for RWA. I can give you
  per-asset price/marketcap movement instead — want me to pull that?"
- "The propose_basket output was truncated; I have the 5 ticker names but
  not full per-asset metrics. Should I run get_currency_snapshot on each?"
- "SSI wrap requires your wallet signature — I can't execute it from here.
  The plan is ready when you're ready to sign."
"""


# ---------------------------------------------------------------------------
# Tool-use loop
# ---------------------------------------------------------------------------

# Hard cap on tool-use iterations per /chat call. Realistic flows resolve in
# 1-3 rounds; cap at 8 to bound runaway loops where Claude oscillates between
# tools without converging.
MAX_TOOL_ITER = 8

# Per-request budget for the entire loop (model + tool latency). Chat UI
# expects sub-30s responses; if a tool call (e.g. cold SoSoValue fetch +
# rate-limit gate) blows the budget we surface a partial answer rather than
# hang. Override via CHAT_LOOP_TIMEOUT_SEC for slower local models.
LOOP_TIMEOUT_SEC = float(os.getenv("CHAT_LOOP_TIMEOUT_SEC", "90"))


def _to_anthropic_messages(turns: list[ChatTurn]) -> list[dict[str, Any]]:
    """Translate the UI's `{role: 'user'|'agent', content: str}` history into
    the `{role: 'user'|'assistant', content: str}` shape Anthropic expects.

    Tool-call traces from prior agent turns are intentionally NOT replayed —
    they're a UI artifact, not part of the model's working context. Replaying
    them would require also replaying tool_use_id / tool_result pairs, which
    would force us to persist server-side state. Text-only history keeps the
    handler stateless and is sufficient for follow-up reasoning.
    """
    out: list[dict[str, Any]] = []
    for t in turns:
        role = "assistant" if t.role == "agent" else "user"
        # Skip empty agent turns (defensive: failed prior calls might have stored "").
        if not t.content:
            continue
        out.append({"role": role, "content": t.content})
    # Anthropic requires the first message to be `user`. If the history
    # starts with an assistant turn (corrupted state, paste from elsewhere),
    # drop leading assistants.
    while out and out[0]["role"] != "user":
        out.pop(0)
    return out


def _to_openai_messages(turns: list[ChatTurn], system_text: str) -> list[dict[str, Any]]:
    """Build OpenAI chat-completions messages from the internal ChatTurn list.

    Differences from Anthropic shape:
      - System prompt goes in `messages[0]` with `role: 'system'`, not a
        separate top-level `system` field.
      - Roles are 'system' / 'user' / 'assistant' / 'tool'; the 'agent' label
        from the UI maps to 'assistant'.
      - Prior tool calls are NOT replayed — same rationale as the Anthropic
        path: it's a UI artifact, replaying would require persisting
        tool_call_id / tool_result pairs server-side.
    """
    out: list[dict[str, Any]] = [{"role": "system", "content": system_text}]
    for t in turns:
        if not t.content:
            continue
        role = "assistant" if t.role == "agent" else "user"
        out.append({"role": role, "content": t.content})
    return out


# Cache the OpenAI-format tool list so we don't re-convert TOOL_SCHEMAS on
# every request. The Anthropic shape is `{name, description, input_schema}`;
# OpenAI wants `{type: "function", function: {name, description, parameters}}`.
_OPENAI_TOOLS_CACHE: list[dict[str, Any]] | None = None


def _openai_tools() -> list[dict[str, Any]]:
    global _OPENAI_TOOLS_CACHE
    if _OPENAI_TOOLS_CACHE is None:
        _OPENAI_TOOLS_CACHE = [
            {
                "type": "function",
                "function": {
                    "name": t["name"],
                    "description": t["description"],
                    "parameters": t["input_schema"],
                },
            }
            for t in TOOL_SCHEMAS
        ]
    return _OPENAI_TOOLS_CACHE


async def _run_anthropic_loop(
    turns: list[ChatTurn],
) -> tuple[str, list[ToolCallTrace], ChatUsage]:
    """Anthropic Messages API tool-use loop. Same behaviour as the original
    inline loop — extracted so `run_agentic_chat` can dispatch between
    providers without growing into a 200-line function."""
    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY not set")

    client = AsyncAnthropic(api_key=api_key)
    model = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-5")
    messages = _to_anthropic_messages(turns)
    if not messages:
        return "No usable user turn found in history.", [], ChatUsage()

    # `cache_control` on the LAST system block caches everything from the
    # start of the rendered prompt through that block — i.e. tools + system
    # together. Keep the system text byte-stable across requests; any change
    # invalidates the cached prefix.
    system_blocks: list[dict[str, Any]] = [
        {
            "type": "text",
            "text": SYSTEM_PROMPT,
            "cache_control": {"type": "ephemeral"},
        },
    ]

    traces: list[ToolCallTrace] = []
    usage = ChatUsage()

    for _ in range(MAX_TOOL_ITER):
        resp = await client.messages.create(
            model=model,
            max_tokens=2048,
            system=system_blocks,
            tools=TOOL_SCHEMAS,
            messages=messages,
        )
        u = resp.usage
        usage.input_tokens += getattr(u, "input_tokens", 0) or 0
        usage.output_tokens += getattr(u, "output_tokens", 0) or 0
        usage.cache_read_tokens += getattr(u, "cache_read_input_tokens", 0) or 0
        usage.cache_creation_tokens += getattr(u, "cache_creation_input_tokens", 0) or 0

        if resp.stop_reason == "end_turn" or resp.stop_reason == "max_tokens":
            parts: list[str] = []
            for block in resp.content:
                if getattr(block, "type", None) == "text":
                    parts.append(block.text)
            return ("\n".join(p for p in parts if p).strip() or "(empty response)"), traces, usage

        if resp.stop_reason == "tool_use":
            messages.append(
                {
                    "role": "assistant",
                    "content": [b.model_dump() for b in resp.content],
                }
            )

            tool_results: list[dict[str, Any]] = []
            for block in resp.content:
                if getattr(block, "type", None) != "tool_use":
                    continue
                name = block.name
                args = block.input or {}
                handler = TOOL_DISPATCH.get(name)
                t0 = time.monotonic()
                if handler is None:
                    result: Any = {"error": f"unknown tool: {name}"}
                    ok = False
                    err: str | None = result["error"]
                else:
                    try:
                        result = await handler(args)
                        ok = True
                        err = None
                    except Exception as exc:  # noqa: BLE001
                        logger.exception("tool %s failed", name)
                        result = {"error": str(exc)}
                        ok = False
                        err = str(exc)
                duration_ms = int((time.monotonic() - t0) * 1000)

                traces.append(
                    ToolCallTrace(
                        name=name,
                        input=args if isinstance(args, dict) else {"_": args},
                        output_summary=_summarize_output(name, result) if ok else f"error: {err}",
                        output_raw=_truncate_for_trace(result),
                        duration_ms=duration_ms,
                        ok=ok,
                        error=err,
                    )
                )

                tool_results.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": json.dumps(result, default=str),
                        "is_error": not ok,
                    }
                )
            messages.append({"role": "user", "content": tool_results})
            continue

        # Any other stop_reason (e.g. "refusal", "pause_turn"): surface
        # whatever text we got and bail out.
        parts = [b.text for b in resp.content if getattr(b, "type", None) == "text"]
        return (("\n".join(parts).strip()) or f"(stopped: {resp.stop_reason})"), traces, usage

    return "(reached max tool iterations — stopping to avoid runaway loop)", traces, usage


async def _run_openai_loop(
    turns: list[ChatTurn],
) -> tuple[str, list[ToolCallTrace], ChatUsage]:
    """OpenAI Chat Completions tool-use loop. Mirrors the Anthropic loop but
    uses function-call protocol: assistant emits `tool_calls`, we run them,
    feed results back as `role: 'tool'` messages keyed by `tool_call_id`.

    OpenAI exposes prompt-cache reuse via `prompt_tokens_details.cached_tokens`
    on newer models (gpt-4o-2024-08-06+, gpt-4-turbo). We surface it under
    the same `cache_read_tokens` field the UI already reads, so the Usage
    panel works identically across providers."""
    api_key = os.getenv("OPENAI_API_KEY", "")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY not set")

    client = AsyncOpenAI(api_key=api_key)
    model = os.getenv("OPENAI_MODEL", "gpt-4o")
    messages: list[dict[str, Any]] = _to_openai_messages(turns, SYSTEM_PROMPT)
    tools = _openai_tools()

    traces: list[ToolCallTrace] = []
    usage = ChatUsage()

    for _ in range(MAX_TOOL_ITER):
        resp = await client.chat.completions.create(
            model=model,
            messages=messages,
            tools=tools,
            tool_choice="auto",
            max_tokens=2048,
        )
        u = resp.usage
        if u:
            usage.input_tokens += getattr(u, "prompt_tokens", 0) or 0
            usage.output_tokens += getattr(u, "completion_tokens", 0) or 0
            ptd = getattr(u, "prompt_tokens_details", None)
            if ptd is not None:
                usage.cache_read_tokens += getattr(ptd, "cached_tokens", 0) or 0

        choice = resp.choices[0]
        msg = choice.message

        if choice.finish_reason in ("stop", "length"):
            return ((msg.content or "").strip() or "(empty response)"), traces, usage

        if choice.finish_reason == "tool_calls" and msg.tool_calls:
            # Mirror the assistant turn back into history so the next call has
            # matching tool_call_id values to attach tool results to.
            messages.append(
                {
                    "role": "assistant",
                    "content": msg.content or "",
                    "tool_calls": [
                        {
                            "id": tc.id,
                            "type": "function",
                            "function": {
                                "name": tc.function.name,
                                "arguments": tc.function.arguments,
                            },
                        }
                        for tc in msg.tool_calls
                    ],
                }
            )

            for tc in msg.tool_calls:
                name = tc.function.name
                try:
                    args = json.loads(tc.function.arguments) if tc.function.arguments else {}
                except json.JSONDecodeError:
                    args = {}
                handler = TOOL_DISPATCH.get(name)
                t0 = time.monotonic()
                if handler is None:
                    result: Any = {"error": f"unknown tool: {name}"}
                    ok = False
                    err: str | None = result["error"]
                else:
                    try:
                        result = await handler(args)
                        ok = True
                        err = None
                    except Exception as exc:  # noqa: BLE001
                        logger.exception("tool %s failed", name)
                        result = {"error": str(exc)}
                        ok = False
                        err = str(exc)
                duration_ms = int((time.monotonic() - t0) * 1000)

                traces.append(
                    ToolCallTrace(
                        name=name,
                        input=args if isinstance(args, dict) else {"_": args},
                        output_summary=_summarize_output(name, result) if ok else f"error: {err}",
                        output_raw=_truncate_for_trace(result),
                        duration_ms=duration_ms,
                        ok=ok,
                        error=err,
                    )
                )

                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": tc.id,
                        "content": json.dumps(result, default=str),
                    }
                )
            continue

        # content_filter, function_call (legacy), or any other reason —
        # surface whatever text we got and stop.
        return ((msg.content or "").strip() or f"(stopped: {choice.finish_reason})"), traces, usage

    return "(reached max tool iterations — stopping to avoid runaway loop)", traces, usage


async def run_agentic_chat(req: ChatRequest) -> ChatTurn:
    """Run one /chat turn through the tool-use loop. Returns the final agent
    message with tool_calls populated for any tools that ran."""

    # Bind the SIWE-connected wallet for the duration of this request so any
    # tool that resolves _resolve_user_address() sees the navbar wallet.
    wallet = (req.wallet_address or "").strip().lower()
    _CURRENT_WALLET.set(wallet or None)

    last_user = next((t for t in reversed(req.turns) if t.role == "user"), None)
    if last_user is None:
        return ChatTurn(role="agent", content="No user turn supplied.", ts=datetime.now(timezone.utc))

    # Provider dispatch. `LLM_PROVIDER` selects the backend; unknown values
    # fall back to Anthropic so existing deployments aren't disrupted by a
    # typo. Each loop fn validates its own API key and raises if missing.
    provider = os.getenv("LLM_PROVIDER", "anthropic").strip().lower()
    if provider not in ("anthropic", "openai"):
        provider = "anthropic"

    started = time.monotonic()
    traces: list[ToolCallTrace] = []
    usage = ChatUsage()

    try:
        if provider == "openai":
            text, traces, usage = await asyncio.wait_for(
                _run_openai_loop(req.turns), timeout=LOOP_TIMEOUT_SEC
            )
        else:
            text, traces, usage = await asyncio.wait_for(
                _run_anthropic_loop(req.turns), timeout=LOOP_TIMEOUT_SEC
            )
    except asyncio.TimeoutError:
        text = (
            "(agent timed out after "
            f"{int(LOOP_TIMEOUT_SEC)}s; partial tool calls captured below)"
        )
    except RuntimeError as exc:
        # Missing API key for the selected provider — surface clearly so the
        # operator knows which env var to populate.
        return ChatTurn(
            role="agent",
            content=(
                f"LLM provider '{provider}' is not configured: {exc}. "
                f"Set the matching API key in .env and restart the agent."
            ),
            ts=datetime.now(timezone.utc),
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception("chat loop failed (provider=%s)", provider)
        text = f"Agent error: {exc}"

    usage.elapsed_ms = int((time.monotonic() - started) * 1000)

    return ChatTurn(
        role="agent",
        content=text,
        ts=datetime.now(timezone.utc),
        tool_calls=traces if traces else None,
        usage=usage,
    )
