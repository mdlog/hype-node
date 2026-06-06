"""Pure decision logic for autonomous SoDEX execution — no I/O, unit-testable."""

MAX_TRADE_ATTEMPTS = 3


def backoff_seconds(attempt: int) -> float:
    """Exponential backoff capped at 8 seconds. attempt=0 → 1s, 1 → 2s, 2 → 4s, 3+ → 8s."""
    return min(2.0 ** attempt, 8.0)


def classify_trade_result(tx: dict) -> str:
    """Classify a trade result dict into a disposition.

    Returns one of:
      'done'          — order accepted; proceed.
      'retry'         — transient failure; retry with backoff.
      'route_to_perps'— spot is cancel-only / halted; try perps instead.
      'give_up'       — unrecoverable; skip this asset.
    """
    if tx.get("ok"):
        return "done" if tx.get("order_id") is not None else "retry"

    if tx.get("skipped"):
        reason = tx.get("reason", "")
        if "status=" in reason and "TRADING" not in reason:
            return "route_to_perps"
        if "no SoDEX spot pair" in reason:
            return "give_up"
        if "notional" in reason and "< min" in reason:
            return "give_up"
        if "no last price" in reason:
            return "retry"
        return "give_up"

    error = tx.get("error", "")
    low = error.lower()
    if "429" in error or "timeout" in low or "sodex 5" in low:
        return "retry"
    return "give_up"
