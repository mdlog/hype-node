"""SSI Protocol tool — wraps / unwraps index baskets on ValueChain L1."""

from __future__ import annotations

import os
import random
from typing import Any

RPC = os.getenv("SSI_RPC_URL", "https://rpc.valuechain.io")


def _fake_tx() -> str:
    return "0x" + "".join(random.choices("0123456789abcdef", k=64))


async def wrap(symbol: str, weights: dict[str, float]) -> dict[str, Any]:
    total = sum(weights.values())
    if abs(total - 1.0) > 0.01 and abs(total - 100.0) > 0.5:
        raise ValueError(f"weights must sum to 1.0 (or 100), got {total}")
    return {
        "tx_hash": _fake_tx(),
        "rpc": RPC,
        "symbol": symbol,
        "status": "confirmed",
        "weights": weights,
    }


async def unwrap(symbol: str, amount: float) -> dict[str, Any]:
    return {
        "tx_hash": _fake_tx(),
        "rpc": RPC,
        "symbol": symbol,
        "amount": amount,
        "status": "confirmed",
    }
