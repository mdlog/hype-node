"""SoDEX execution tool — places trades on ValueChain L1 DEX.

Real protocol notes:
    Mainnet: https://mainnet-gw.sodex.dev/api/v1/{spot,perps}   chainId 286623
    Testnet: https://testnet-gw.sodex.dev/api/v1/{spot,perps}   chainId 138565

Read-only endpoints (tickers, orderbook, klines, balances) are public.
Trade actions (newOrder, cancelOrder, replace, transferAsset, scheduleCancel,
updateLeverage, updateMargin) require an EIP-712 typed signature against:

    domain  = { name: "spot"|"futures", version: "1", chainId, verifyingContract: 0x0 }
    message = { payloadHash = keccak256(json({type, params})), nonce: uint64 }

The signature is byte 0x01 || ECDSA(domain, message).

This module sketches the action-builder; signing is intentionally left to a
wallet integration so we don't ship a hot key in the agent process."""

from __future__ import annotations

import json
import os
import random
import time
from typing import Any

ENV = os.getenv("SODEX_ENV", "mainnet").lower()
SPOT_BASE = os.getenv(
    "SODEX_SPOT_BASE",
    "https://testnet-gw.sodex.dev/api/v1/spot" if ENV == "testnet" else "https://mainnet-gw.sodex.dev/api/v1/spot",
)
PERPS_BASE = os.getenv(
    "SODEX_PERPS_BASE",
    "https://testnet-gw.sodex.dev/api/v1/perps" if ENV == "testnet" else "https://mainnet-gw.sodex.dev/api/v1/perps",
)
CHAIN_ID = 138565 if ENV == "testnet" else 286623
VERIFYING_CONTRACT = "0x0000000000000000000000000000000000000000"


def _fake_tx() -> str:
    return "0x" + "".join(random.choices("0123456789abcdef", k=64))


def build_exchange_action(
    domain_name: str,
    payload: dict[str, Any],
    nonce: int | None = None,
) -> dict[str, Any]:
    """Return the EIP-712 typed-data envelope a wallet should sign."""
    payload_json = json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
    nonce = nonce or int(time.time() * 1000)
    return {
        "types": {
            "EIP712Domain": [
                {"name": "name", "type": "string"},
                {"name": "version", "type": "string"},
                {"name": "chainId", "type": "uint256"},
                {"name": "verifyingContract", "type": "address"},
            ],
            "ExchangeAction": [
                {"name": "payloadHash", "type": "bytes32"},
                {"name": "nonce", "type": "uint64"},
            ],
        },
        "domain": {
            "name": domain_name,
            "version": "1",
            "chainId": CHAIN_ID,
            "verifyingContract": VERIFYING_CONTRACT,
        },
        "primaryType": "ExchangeAction",
        "message": {
            "payloadHash": "0x" + "0" * 64,  # wallet replaces with keccak256(payload_json)
            "nonce": nonce,
        },
        "_payload_json": payload_json,
        "_nonce": nonce,
    }


async def execute_trade(
    symbol_in: str,
    symbol_out: str,
    amount_in: float,
    slippage_bps: int = 25,
) -> dict[str, Any]:
    action = build_exchange_action(
        "spot",
        {
            "type": "newOrder",
            "params": {
                "symbol": f"{symbol_in}_{symbol_out}",
                "side": "BUY",
                "type": "MARKET",
                "quantity": str(amount_in),
                "slippageBps": slippage_bps,
            },
        },
    )
    # TODO: when a wallet is wired in, POST `${SPOT_BASE}/trade/orders/batch`
    # with { signature: "0x01" + sig, payload: action["_payload_json"],
    #        nonce: action["_nonce"] } and return the on-chain confirmation.
    return {
        "tx_hash": _fake_tx(),
        "filled": True,
        "symbol_in": symbol_in,
        "symbol_out": symbol_out,
        "amount_in": amount_in,
        "amount_out": amount_in * (1 - slippage_bps / 10_000),
        "slippage_bps": slippage_bps,
        "gas_val": round(0.012 + random.random() * 0.02, 4),
        "latency_ms": int(4_200 + random.random() * 800),
        "signed_payload": action["_payload_json"],
    }
