"""Claude tool-use strategy node for the autonomous LangGraph loop.

Replaces the hardcoded `if sentiment < 60: idle` rule in graph.strategy_node
with a real LLM that:

  1. Calls SoSoValue read-only tools (sentiment, flow, news, SSI constituents,
     token economics, backtest) — exactly the same data sources as before.
  2. Reasons over the data with Claude (model + temperature + max_tokens
     pulled from env so the UI badge values are accurate, not decorative).
  3. Submits the final basket via a `submit_basket` terminator tool.

Reasoning + tool-call traces are pushed live to a host-supplied callback
(see `set_emitter`) so the /agent page reasoning stream updates as Claude
thinks, instead of arriving as a single batch at end-of-cycle.

Falls back to a deterministic rule-based basket on any of:
  - ANTHROPIC_API_KEY missing
  - Claude API unreachable / 5xx
  - Loop exceeds MAX_ITER without a submit_basket call
  - Pydantic schema mismatch on submit_basket input
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from typing import Any, Callable

from anthropic import AsyncAnthropic
from anthropic import (
    APIConnectionError,
    APIStatusError,
    APITimeoutError,
    InternalServerError,
    RateLimitError,
)

from .chat_agent import TOOL_DISPATCH, TOOL_SCHEMAS as CHAT_TOOL_SCHEMAS, _summarize_output

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Live emitter — set by main.py at startup so reasoning entries reach the
# /agent page stream the moment Claude produces them, not at end-of-cycle.
# Optional: when unset, strategy_agent runs silently (e.g. in unit tests).
# ---------------------------------------------------------------------------

EmitFn = Callable[[str, str], None]
_emitter: EmitFn | None = None


def set_emitter(fn: EmitFn | None) -> None:
    global _emitter
    _emitter = fn


def _emit(kind: str, text: str) -> None:
    if _emitter is None:
        return
    try:
        _emitter(kind, text)
    except Exception:  # noqa: BLE001
        logger.exception("strategy_agent emitter raised — ignoring")


# ---------------------------------------------------------------------------
# Tool surface — read-only data fetchers + a loop-terminating submit_basket.
# We re-use chat_agent.TOOL_DISPATCH so write-tools (ssi.wrap, sodex.execute)
# stay out of reach (those run downstream in graph.py via wrap_node/exec_node
# under explicit on-chain confirmation flow).
# ---------------------------------------------------------------------------

STRATEGY_READ_TOOLS = [
    "get_sector_sentiment",
    "get_fund_flow",
    "get_news",
    "list_ssi_indices",
    "propose_basket",
    "run_backtest",
    "get_currency_snapshot",
]


SUBMIT_BASKET_SCHEMA: dict[str, Any] = {
    "name": "submit_basket",
    "description": (
        "Submit the final basket composition for this cycle. Call this "
        "EXACTLY ONCE at the end of your reasoning. After this returns, the "
        "cycle ends and the basket flows to backtest → risk → wrap → exec "
        "on-chain. Use weights={} to skip this cycle (idle)."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "weights": {
                "type": "object",
                "additionalProperties": {"type": "number"},
                "description": (
                    "Map of token symbol (uppercase, e.g. 'FIL', 'RNDR') to "
                    "weight (0.0-1.0). Sum must be ~1.0 (±0.05). Empty {} "
                    "means idle this cycle."
                ),
            },
            "reasoning": {
                "type": "string",
                "description": "1-3 sentence summary of why these weights.",
            },
            "confidence": {
                "type": "string",
                "enum": ["low", "medium", "high"],
                "description": "How confident you are in this composition.",
            },
        },
        "required": ["weights", "reasoning", "confidence"],
    },
}


def _build_tool_schemas() -> list[dict[str, Any]]:
    by_name = {t["name"]: t for t in CHAT_TOOL_SCHEMAS}
    selected: list[dict[str, Any]] = []
    for name in STRATEGY_READ_TOOLS:
        if name in by_name:
            selected.append(by_name[name])
    selected.append(SUBMIT_BASKET_SCHEMA)
    return selected


SYSTEM_PROMPT = """You are a crypto index strategist running inside an autonomous loop.

Each cycle you receive a sector (e.g. "DePIN", "RWA", "AI") and propose a basket of token weights that the operator's wallet will deploy on-chain via SSI Protocol + SoDEX.

Standard workflow:
  1. get_sector_sentiment(sector) — current score 0-100 + delta vs baseline.
  2. If sentiment < 50 AND delta < +5 → idle (empty basket). Return immediately.
  3. get_fund_flow(sector) — confirm sentiment with money-on-the-move.
  4. get_news(sector, limit=5) — surface catalysts or risks.
  5. list_ssi_indices() — find the relevant SSI ticker (e.g. "ssiDePIN").
  6. propose_basket(sector, n_assets=8) — get a baseline weighted basket.
  7. (Optional) get_currency_snapshot for top 1-2 tokens to spot risks (unlocks, regulatory news).
  8. run_backtest(weights, days=90) — validate Sharpe + drawdown.
  9. submit_basket(weights, reasoning, confidence) — EXACTLY ONCE to end the cycle.

Hard rules:
  - Weights must sum to 1.0 (±0.05). Use {} for idle.
  - Use only token symbols that appear in your tool results. Don't invent.
  - If 3+ tool calls return synthetic/unavailable data, prefer idle and say so.
  - If backtest Sharpe < 1.0 OR max_drawdown < -0.20, downgrade confidence to "low" or idle.
  - Be concise. Each text block appears in the live operator reasoning stream.

Output format:
  - Brief text reasoning between tool calls is OK and useful for the operator view.
  - submit_basket MUST be your final tool call. After it, the cycle ends."""


# ---------------------------------------------------------------------------
# Main entry — one Claude-driven strategy cycle.
# ---------------------------------------------------------------------------

# Hard cap on tool-use round trips before forcing a fallback. Each round
# costs one Claude API call; 8 is enough for the standard 4-6 step workflow
# with 2 buffer iterations for retry / clarification.
MAX_ITER = 8
# Truncate tool-result payloads sent back to Claude. Keeps prompt size sane
# (and per-turn cost predictable) when an endpoint returns a large list.
TOOL_RESULT_MAX_CHARS = 8000
# Retry policy for transient Anthropic errors (529 OverloadedError, 5xx,
# 429, network blips). Each retry waits exponentially: 4s, 12s, 30s.
# Total worst-case wait before giving up: ~46s, which is well within the
# user's tolerance for a single LangGraph cycle (next /pause check still
# fires every 0.5s during the wait).
TRANSIENT_RETRY_DELAYS_SEC = (4, 12, 30)
# How aggressively the underlying httpx client retries before raising. The
# Anthropic SDK default is 2; bumping to 4 absorbs short-lived overload
# blips before our outer retry loop kicks in.
SDK_MAX_RETRIES = 4
# Per-request timeout. Long because tool-use can need ~30s on heavy prompts;
# but bounded so a stuck request doesn't hold the LangGraph cycle forever.
SDK_TIMEOUT_SEC = 60.0


# Network-level retryable errors (no HTTP response — connection/timeout).
# These always retry. `APIStatusError` (HTTP responses) is filtered by
# status code in `_is_retryable_status` below so we only retry transients
# like 429/5xx/529 and fail fast on 4xx auth/bad-request errors.
_RETRYABLE_NETWORK_EXCEPTIONS = (
    APIConnectionError,     # network blip / DNS / TLS
    APITimeoutError,        # request timed out
)
# HTTP status codes treated as transient. 529 is Anthropic's "Overloaded"
# (returned from `OverloadedError` in private module) — we detect it by
# code instead of class so we don't depend on `anthropic._exceptions`.
_RETRYABLE_STATUS_CODES = frozenset({408, 425, 429, 500, 502, 503, 504, 529})


def _is_retryable_status(exc: APIStatusError) -> bool:
    code = getattr(exc, "status_code", None)
    return isinstance(code, int) and code in _RETRYABLE_STATUS_CODES


async def _claude_create_with_retry(
    client: AsyncAnthropic,
    **kwargs: Any,
) -> Any:
    """Call client.messages.create with manual retry for transient errors.

    The SDK already retries internally (SDK_MAX_RETRIES, with exponential
    backoff and Retry-After honoring) — we layer a coarser retry on top so
    that even after the SDK gives up, we wait through a longer Anthropic
    overload window before falling back to rule-based.

    Retries only on:
      - Network errors (connection, timeout)
      - HTTP statuses in `_RETRYABLE_STATUS_CODES` (408, 425, 429, 5xx, 529)
    Bubbles up immediately on auth (401), bad-request (400), not-found
    (404) etc. so caller can fallback fast on permanent errors.
    """
    last_exc: Exception | None = None
    for attempt, delay in enumerate((0,) + TRANSIENT_RETRY_DELAYS_SEC):
        if delay > 0:
            assert last_exc is not None
            kind = type(last_exc).__name__
            status = getattr(last_exc, "status_code", None)
            tag = f"{kind}{f' {status}' if status else ''}"
            _emit(
                "WAIT",
                f"strategy · Anthropic {tag} · backing off {delay}s "
                f"(attempt {attempt}/{len(TRANSIENT_RETRY_DELAYS_SEC)})",
            )
            await asyncio.sleep(delay)
        try:
            return await client.messages.create(**kwargs)
        except _RETRYABLE_NETWORK_EXCEPTIONS as exc:
            last_exc = exc
            logger.warning("Claude network error (will retry): %s", exc)
            continue
        except APIStatusError as exc:
            # Only retry transient status codes — bubble up permanent ones
            # (auth/bad-request/etc.) so the caller can fallback immediately
            # without burning the full backoff schedule.
            if not _is_retryable_status(exc):
                raise
            last_exc = exc
            logger.warning(
                "Claude HTTP %s (will retry): %s",
                getattr(exc, "status_code", "?"),
                exc,
            )
            continue
    assert last_exc is not None  # loop ran at least once
    raise last_exc


async def run_strategy_agent(sector: str) -> dict[str, Any]:
    """Drive Claude through one strategy cycle for `sector`.

    Returns:
        {
          "basket": dict[symbol -> weight],
          "reasoning": str,
          "confidence": "low" | "medium" | "high",
          "source": "claude" | "fallback",
          "tokens_in": int,
          "tokens_out": int,
        }

    Always returns — never raises. On any failure, returns a rule-based
    fallback so the LangGraph loop keeps progressing.
    """
    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        _emit("WAIT", "strategy · ANTHROPIC_API_KEY not set — using rule-based fallback")
        return _rule_based_fallback("no api key")

    # Configure SDK with extra retries + a generous per-request timeout. The
    # SDK's built-in retry handles the most common transient blips (429 with
    # Retry-After, single-shot 5xx); our outer _claude_create_with_retry
    # absorbs the rest.
    client = AsyncAnthropic(
        api_key=api_key,
        max_retries=SDK_MAX_RETRIES,
        timeout=SDK_TIMEOUT_SEC,
    )
    model = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-5")
    temperature = float(os.getenv("ANTHROPIC_TEMPERATURE", "0.2"))
    max_tokens = int(os.getenv("ANTHROPIC_MAX_TOKENS", "2048"))
    tools = _build_tool_schemas()
    # cache_control on the system block freezes tools+system as a cache
    # prefix → ~70% cost drop on repeat cycles within the 5-min ephemeral TTL.
    system_blocks: list[dict[str, Any]] = [
        {
            "type": "text",
            "text": SYSTEM_PROMPT,
            "cache_control": {"type": "ephemeral"},
        },
    ]

    messages: list[dict[str, Any]] = [
        {
            "role": "user",
            "content": (
                f"Sector this cycle: {sector}\n\n"
                "Run your standard workflow. End the cycle with submit_basket."
            ),
        }
    ]

    _emit(
        "THINK",
        f"strategy · sector={sector} · invoking {model} · temp={temperature} max_tokens={max_tokens}",
    )

    tokens_in = 0
    tokens_out = 0

    for _ in range(MAX_ITER):
        try:
            resp = await _claude_create_with_retry(
                client,
                model=model,
                max_tokens=max_tokens,
                temperature=temperature,
                system=system_blocks,
                tools=tools,
                messages=messages,
            )
        except _RETRYABLE_NETWORK_EXCEPTIONS as exc:
            _emit(
                "WAIT",
                f"strategy · Anthropic {type(exc).__name__} after "
                f"{len(TRANSIENT_RETRY_DELAYS_SEC)+1} attempts — fallback",
            )
            logger.warning("Claude network error after all retries: %s", exc)
            return _rule_based_fallback(f"network: {type(exc).__name__}")
        except APIStatusError as exc:
            # Either retries exhausted (transient still down) or permanent
            # status (auth/bad-request) bubbled up immediately. Both fallback.
            status = getattr(exc, "status_code", None)
            kind = type(exc).__name__
            if status and _is_retryable_status(exc):
                msg = (
                    f"strategy · Anthropic still {kind} {status} after "
                    f"{len(TRANSIENT_RETRY_DELAYS_SEC)+1} attempts — fallback"
                )
            else:
                msg = f"strategy · Anthropic {kind} {status} (permanent) — fallback"
            _emit("WAIT", msg)
            logger.warning("Claude API error: %s status=%s", kind, status)
            return _rule_based_fallback(f"http {status or 'error'}")
        except Exception as exc:  # noqa: BLE001 — final safety net
            _emit("WAIT", f"strategy · Claude API error: {exc} — fallback")
            logger.exception("Claude API call failed (unexpected)")
            return _rule_based_fallback("claude api error")

        u = resp.usage
        tokens_in += getattr(u, "input_tokens", 0) or 0
        tokens_out += getattr(u, "output_tokens", 0) or 0

        # Stream Claude's reasoning text immediately so operators see the
        # thought process before tool calls fire.
        for block in resp.content:
            if getattr(block, "type", None) == "text":
                txt = block.text.strip()
                if not txt:
                    continue
                # Break long reasoning into paragraph-sized log entries for
                # legibility in the operator stream.
                for paragraph in txt.split("\n\n"):
                    para = paragraph.strip()
                    if para:
                        _emit("THINK", f"strategy · {para}")

        if resp.stop_reason in ("end_turn", "max_tokens"):
            _emit("WAIT", f"strategy · stop_reason={resp.stop_reason} without submit — fallback")
            return _rule_based_fallback("no submit_basket")

        if resp.stop_reason != "tool_use":
            _emit("WAIT", f"strategy · unexpected stop_reason={resp.stop_reason} — fallback")
            return _rule_based_fallback(f"stop_reason={resp.stop_reason}")

        # Mirror assistant turn back so the next call has matching tool_use_ids.
        messages.append({
            "role": "assistant",
            "content": [b.model_dump() for b in resp.content],
        })

        tool_results: list[dict[str, Any]] = []
        submitted: dict[str, Any] | None = None

        for block in resp.content:
            if getattr(block, "type", None) != "tool_use":
                continue
            name = block.name
            args = block.input or {}

            # The submit_basket tool is the loop terminator — handled outside
            # TOOL_DISPATCH because there's no Python handler for it.
            if name == "submit_basket":
                submitted = args
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": "basket submitted — cycle complete",
                })
                continue

            handler = TOOL_DISPATCH.get(name)
            t0 = time.monotonic()
            if handler is None:
                result: Any = {"error": f"unknown tool: {name}"}
                ok = False
            else:
                try:
                    result = await handler(args)
                    ok = True
                except Exception as exc:  # noqa: BLE001
                    logger.exception("strategy tool %s failed", name)
                    result = {"error": str(exc)}
                    ok = False
            duration_ms = int((time.monotonic() - t0) * 1000)

            summary = _summarize_output(name, result) if ok else f"error: {result.get('error')}"
            args_brief = ",".join(f"{k}={v!r}" for k, v in args.items())[:80]
            _emit("TOOL", f"strategy · {name}({args_brief}) → {summary} · {duration_ms}ms")

            tool_results.append({
                "type": "tool_result",
                "tool_use_id": block.id,
                "content": json.dumps(result, default=str)[:TOOL_RESULT_MAX_CHARS],
            })

        messages.append({"role": "user", "content": tool_results})

        if submitted is not None:
            return _finalize_submission(submitted, tokens_in, tokens_out)

    _emit("WAIT", f"strategy · MAX_ITER {MAX_ITER} reached without submit — fallback")
    return _rule_based_fallback("max_iter")


def _finalize_submission(
    submitted: dict[str, Any],
    tokens_in: int,
    tokens_out: int,
) -> dict[str, Any]:
    """Validate + normalize the basket Claude submitted and emit summary logs."""
    weights_raw = submitted.get("weights") or {}
    weights: dict[str, float] = {}
    for k, v in weights_raw.items():
        if isinstance(v, (int, float)) and v > 0:
            weights[str(k).upper()] = float(v)
    reasoning = str(submitted.get("reasoning", "")).strip()
    confidence = str(submitted.get("confidence", "low"))

    if weights:
        total = sum(weights.values())
        top_sym, top_w = max(weights.items(), key=lambda kv: kv[1])
        _emit(
            "ACT",
            f"strategy · basket N={len(weights)} top {top_sym}@{top_w:.0%} sum={total:.2f} conf={confidence}",
        )
    else:
        _emit("ACT", f"strategy · idle (Claude judgment) conf={confidence}")
    if reasoning:
        _emit("THINK", f"strategy · final · {reasoning}")
    return {
        "basket": weights,
        "reasoning": reasoning,
        "confidence": confidence,
        "source": "claude",
        "tokens_in": tokens_in,
        "tokens_out": tokens_out,
    }


# ---------------------------------------------------------------------------
# Fallback — same shape as a Claude submission so callers can treat both
# uniformly. Used when API key missing, Claude unreachable, or budget caps.
# ---------------------------------------------------------------------------


def _rule_based_fallback(reason: str) -> dict[str, Any]:
    return {
        "basket": {"BTC": 0.5, "ETH": 0.3, "SOL": 0.2},
        "reasoning": f"rule-based fallback ({reason}) — blue-chip 50/30/20",
        "confidence": "low",
        "source": "fallback",
        "tokens_in": 0,
        "tokens_out": 0,
    }
