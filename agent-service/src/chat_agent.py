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
from .tools import basket, real_backtest, risk, terminal

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

## CRITICAL — never invent on-chain data

You have ZERO knowledge of which assets are currently in any SSI sector index,
their current weights, prices, or market caps. ALWAYS call tools to get real
data. Specifically:

- NEVER list "FIL, RNDR, HNT, AR, AKT, IOTX, DIMO, ATH" or similar from memory
  as constituents of any sector — call `propose_basket(sector=...)` and use
  what comes back. Constituents change constantly; your training data is stale.
- NEVER assert specific weights (FIL 22%, RNDR 18%, …) without running
  `propose_basket`. Weights come from the live composite-score calculation,
  not your reasoning.
- NEVER quote Sharpe / drawdown / return / vs-BTC numbers without first running
  `run_backtest`. The synthetic placeholder is gone — those numbers ONLY come
  from real klines replay.
- NEVER quote a specific price, market cap, or 24h change without calling
  `get_currency_snapshot` (or having seen it from `propose_basket`).

If a tool fails (transient outage, no constituents, missing klines), say so
honestly. Do NOT fabricate replacement data. "Data unavailable, the SoSoValue
backend is in 5xx backoff" is the correct answer when that's true.

## Standard pipelines

"Build a top-N basket for sector X (with optional sentiment threshold)":
  1. `get_sector_sentiment(sector=X)` — gate on the threshold if specified
  2. `propose_basket(sector=X, n_assets=N)` — REAL constituents from SSI
  3. `run_backtest(constituents=<from step 2>, days=90)` — REAL replay
  4. (optional) `check_risk_thresholds` if the user mentioned risk

"How is sector X doing?":
  1. `get_sector_sentiment(sector=X)` and `get_fund_flow(sector=X)` in parallel
  2. (optional) `get_news(sector=X, limit=5)` for headline color

"What's hot right now?":
  1. `get_sector_spotlight()` — all sectors with 24h change

"Compare an asset / basket to BTC":
  - For an asset: `get_currency_snapshot(currency_id=...)` + benchmark in
    `run_backtest` (BTC/ETH benchmarks always included).
  - For a basket: `run_backtest` returns `vs_btc` and `vs_eth` directly.

## Tool-use boundaries

- Read-only tools may be called freely.
- NEVER claim to have wrapped/unwrapped via SSI or executed a SoDEX trade —
  those require the user's wallet signature and are not exposed as tools here.
- `get_fund_flow` returns real ETF flow ONLY for BTC. For any other sector it
  returns `ok: false` with `data_source: "unsupported"` — surface that and pivot
  to `propose_basket` + per-asset snapshots if the user wants flow-like signal.
- When ANY tool returns `ok: false`, do NOT cite synthetic numbers. Quote the
  `error` field and offer a retry path or a different tool. The user explicitly
  prefers honest "data unavailable" over fabricated values.

## Response style

- Be concise and concrete. Lead with specific numbers from tool outputs
  ("DePIN: sentiment 78, +15 vs 1h ago. Top 8 by composite score: FIL 18.2%,
  RNDR 14.7%, …"). Use ONLY numbers that came from a tool result this turn.
- Don't dump raw JSON. The UI renders a tool-trace card automatically — your
  job is to interpret the data, not echo it.
- Surface caveats: if a tool returned `ok: false` or excluded assets, say so.
- When you propose a concrete next step (deploy, hedge, rebalance, exit), end
  with a clear single-line action statement so the UI can highlight it.
  Example: "Action: deploy HDP8 (8 constituents from ssiDePIN) to SSI Protocol
  — awaiting your signature."
- Numbers in markdown only — no LaTeX, no `\\frac`, no `$`."""


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
# hang.
LOOP_TIMEOUT_SEC = 90.0


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
