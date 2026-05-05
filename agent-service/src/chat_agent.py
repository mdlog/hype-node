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
import json
import logging
import os
import time
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable

from anthropic import AsyncAnthropic

from .state import ChatRequest, ChatTurn, ChatUsage, ToolCallTrace
from .tools import basket, macro, real_backtest, risk, terminal, treasuries

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
    except Exception:
        # Summary is purely cosmetic — never let a formatting error fail the
        # tool call itself.
        pass
    return None


def _truncate_for_trace(value: Any, max_chars: int = 600) -> Any:
    """Cap the raw output we ship to the UI so equity series etc. don't bloat
    the chat history. The full payload still went to Claude via tool_result."""
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


async def run_agentic_chat(req: ChatRequest) -> ChatTurn:
    """Run one /chat turn through the tool-use loop. Returns the final agent
    message with tool_calls populated for any tools that ran."""

    last_user = next((t for t in reversed(req.turns) if t.role == "user"), None)
    if last_user is None:
        return ChatTurn(role="agent", content="No user turn supplied.", ts=datetime.now(timezone.utc))

    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        return ChatTurn(
            role="agent",
            content=(
                "No ANTHROPIC_API_KEY set in the agent service. Set the key and "
                f"the live agent will pick up your prompt: {last_user.content!r}"
            ),
            ts=datetime.now(timezone.utc),
        )

    client = AsyncAnthropic(api_key=api_key)
    model = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-5")
    messages = _to_anthropic_messages(req.turns)
    if not messages:
        return ChatTurn(
            role="agent",
            content="No usable user turn found in history.",
            ts=datetime.now(timezone.utc),
        )

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
    started = time.monotonic()

    async def _loop() -> str:
        nonlocal traces, usage
        for _ in range(MAX_TOOL_ITER):
            resp = await client.messages.create(
                model=model,
                max_tokens=2048,
                system=system_blocks,
                tools=TOOL_SCHEMAS,
                messages=messages,
            )
            # Aggregate token usage across all loop iterations so the UI sees
            # the total cost of the turn, not just the final round.
            u = resp.usage
            usage.input_tokens += getattr(u, "input_tokens", 0) or 0
            usage.output_tokens += getattr(u, "output_tokens", 0) or 0
            usage.cache_read_tokens += getattr(u, "cache_read_input_tokens", 0) or 0
            usage.cache_creation_tokens += getattr(u, "cache_creation_input_tokens", 0) or 0

            if resp.stop_reason == "end_turn" or resp.stop_reason == "max_tokens":
                # Concatenate every text block in the final assistant message.
                # Thinking blocks (when adaptive thinking is enabled) are
                # ignored here — they're surfaced via separate UI later if
                # needed.
                parts: list[str] = []
                for block in resp.content:
                    if getattr(block, "type", None) == "text":
                        parts.append(block.text)
                return "\n".join(p for p in parts if p).strip() or "(empty response)"

            if resp.stop_reason == "tool_use":
                # Append the assistant turn verbatim so the next API call has
                # the matching tool_use_id available for the tool_result.
                # `model_dump` produces a JSON-safe dict the SDK accepts.
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

                    # Send the FULL result back to Claude (not the truncated
                    # trace version) so its reasoning has the data it needs.
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
            return ("\n".join(parts).strip()) or f"(stopped: {resp.stop_reason})"

        return "(reached max tool iterations — stopping to avoid runaway loop)"

    try:
        text = await asyncio.wait_for(_loop(), timeout=LOOP_TIMEOUT_SEC)
    except asyncio.TimeoutError:
        text = (
            "(agent timed out after "
            f"{int(LOOP_TIMEOUT_SEC)}s; partial tool calls captured below)"
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception("chat loop failed")
        text = f"Agent error: {exc}"

    usage.elapsed_ms = int((time.monotonic() - started) * 1000)

    return ChatTurn(
        role="agent",
        content=text,
        ts=datetime.now(timezone.utc),
        tool_calls=traces if traces else None,
        usage=usage,
    )
