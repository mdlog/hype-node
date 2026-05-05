"""SoDEX execution tool — places trades on ValueChain L1 DEX.

Real protocol notes:
    Mainnet: https://mainnet-gw.sodex.dev/api/v1/{spot,perps}   chainId 286623
    Testnet: https://testnet-gw.sodex.dev/api/v1/{spot,perps}   chainId 138565

Read-only endpoints (tickers, orderbook, klines, balances) are public.
Trade actions (newOrder, cancelOrder, replace, transferAsset, scheduleCancel,
updateLeverage, updateMargin) require an EIP-712 typed signature against:

    domain  = { name: "spot"|"futures", version: "1", chainId, verifyingContract: 0x0 }
    message = { payloadHash = keccak256(canonical-json({type, params})), nonce: uint64 }

The signature wire format is `0x01 || ECDSA(domain, message)` (1 byte type tag
prepended to the 65-byte raw signature).

Signing happens in this module when SODEX_PRIVATE_KEY is set. Without it, we
return an unsigned envelope so an external wallet integration can finish the
sign + submit step.
"""

from __future__ import annotations

import json
import os
import time
from decimal import Decimal, ROUND_DOWN
from typing import Any

import httpx
from eth_account import Account
from eth_account.messages import encode_typed_data
from eth_utils import keccak

ENV = os.getenv("SODEX_ENV", "mainnet").lower()
IS_TESTNET = ENV == "testnet"
SPOT_BASE = os.getenv(
    "SODEX_SPOT_BASE",
    "https://testnet-gw.sodex.dev/api/v1/spot" if IS_TESTNET else "https://mainnet-gw.sodex.dev/api/v1/spot",
)
PERPS_BASE = os.getenv(
    "SODEX_PERPS_BASE",
    "https://testnet-gw.sodex.dev/api/v1/perps" if IS_TESTNET else "https://mainnet-gw.sodex.dev/api/v1/perps",
)
CHAIN_ID = 138565 if IS_TESTNET else 286623
VERIFYING_CONTRACT = "0x0000000000000000000000000000000000000000"

SODEX_PRIVATE_KEY = os.getenv("SODEX_PRIVATE_KEY", "")
SODEX_API_KEY_NAME = os.getenv("SODEX_API_KEY_NAME", "")


def _canonical_json(value: Any) -> str:
    """Compact JSON, preserving caller-given key order.

    SoDEX server reproduces payloadHash via Go's json.Marshal which serializes
    in struct field declaration order. Callers MUST construct dicts in the
    matching order — see new_order_request.go etc. in the Go SDK. Decimal
    fields must be JSON strings (not numbers).
    """
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False)


def _payload_hash(action: dict[str, Any]) -> bytes:
    return keccak(_canonical_json(action).encode("utf-8"))


def build_typed_data(
    domain_name: str,
    payload_hash: bytes,
    nonce: int,
) -> dict[str, Any]:
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
            "payloadHash": payload_hash,
            "nonce": nonce,
        },
    }


def _sign(typed_data: dict[str, Any]) -> str:
    """Return the SoDEX-prefixed hex signature (0x01 || raw 65-byte sig).

    eth_account's `signed.signature` returns 65 bytes with v ∈ {27, 28}
    (Ethereum convention). SoDEX server uses Go's crypto.Sign signer-recovery
    which expects v ∈ {0, 1} (raw recovery id). We normalize before sending.
    """
    if not SODEX_PRIVATE_KEY:
        raise RuntimeError(
            "SODEX_PRIVATE_KEY not set. The agent autonomous flow needs a hot key "
            "to sign exchange actions."
        )
    pk = SODEX_PRIVATE_KEY if SODEX_PRIVATE_KEY.startswith("0x") else f"0x{SODEX_PRIVATE_KEY}"
    msg = encode_typed_data(full_message=typed_data)
    signed = Account.sign_message(msg, private_key=pk)
    sig = bytes(signed.signature)  # 65 bytes: r(32) || s(32) || v(1)
    if len(sig) != 65:
        raise RuntimeError(f"unexpected signature length: {len(sig)}")
    v = sig[-1]
    if v >= 27:
        v -= 27
    sig = sig[:-1] + bytes([v])
    return "0x01" + sig.hex()


def _auth_headers(signature: str, nonce: int) -> dict[str, str]:
    # Per SoDEX Go SDK: empty APIKeyName == master-wallet auth. X-API-Chain is
    # required even though chainId is also in the EIP-712 domain.
    headers = {
        "X-API-Sign": signature,
        "X-API-Nonce": str(nonce),
        "X-API-Chain": str(CHAIN_ID),
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    if SODEX_API_KEY_NAME:
        headers["X-API-Key"] = SODEX_API_KEY_NAME
    return headers


async def submit_action(
    domain_name: str,
    base_url: str,
    path: str,
    action: dict[str, Any],
    method: str = "POST",
    nonce: int | None = None,
) -> dict[str, Any]:
    """Sign + submit a SoDEX exchange action.

    `action` is `{type: str, params: dict}`. The full envelope is hashed for
    the EIP-712 signature; the wire body is just `params` (the URL implies
    the action type to the server).
    """
    n = nonce or int(time.time() * 1000)
    h = _payload_hash(action)
    typed = build_typed_data(domain_name, h, n)
    sig = _sign(typed)
    wire_body = _canonical_json(action["params"])
    async with httpx.AsyncClient(timeout=30) as client:
        res = await client.request(
            method,
            base_url + path,
            content=wire_body,
            headers=_auth_headers(sig, n),
        )
    if res.status_code >= 400:
        raise RuntimeError(f"SoDEX {res.status_code}: {res.text}")
    body = res.json()
    if isinstance(body, dict) and body.get("code", 0) != 0:
        raise RuntimeError(f"SoDEX action error: {body}")
    return body


# ── Symbol / account / price resolvers (cached) ──────────────────────────────

_SYMBOL_CACHE: dict[str, Any] = {"data": None, "ts": 0.0}
_TICKER_CACHE: dict[str, Any] = {"data": None, "ts": 0.0}
_ACCOUNT_ID: dict[str, int | None] = {"id": None}
_SYMBOL_TTL = 600   # 10 min — symbol list rarely changes
_TICKER_TTL = 5     # 5 sec — keep prices fresh


async def _load_spot_symbols() -> dict[str, dict[str, Any]]:
    if time.time() - _SYMBOL_CACHE["ts"] < _SYMBOL_TTL and _SYMBOL_CACHE["data"]:
        return _SYMBOL_CACHE["data"]
    async with httpx.AsyncClient(timeout=10) as client:
        res = await client.get(f"{SPOT_BASE}/markets/symbols")
    res.raise_for_status()
    by_name = {s["name"]: s for s in res.json()["data"]}
    _SYMBOL_CACHE["data"] = by_name
    _SYMBOL_CACHE["ts"] = time.time()
    return by_name


async def _load_spot_tickers() -> dict[str, dict[str, Any]]:
    if time.time() - _TICKER_CACHE["ts"] < _TICKER_TTL and _TICKER_CACHE["data"]:
        return _TICKER_CACHE["data"]
    async with httpx.AsyncClient(timeout=10) as client:
        res = await client.get(f"{SPOT_BASE}/markets/tickers")
    res.raise_for_status()
    by_symbol = {t["symbol"]: t for t in res.json()["data"]}
    _TICKER_CACHE["data"] = by_symbol
    _TICKER_CACHE["ts"] = time.time()
    return by_symbol


def _resolve_pair_name(coin: str) -> list[str]:
    """Candidate SoDEX pair names for an arbitrary coin label.

    The agent passes things like 'BTC', 'filecoin', 'render', 'vMEME.ssi'.
    We try common conventions in order and let the caller pick the first hit.
    """
    c = coin.strip()
    if "_" in c:
        return [c]  # already a full pair
    if c.endswith(".ssi"):
        # SoDEX strips the dot: "vMEME.ssi" -> "vMEMEssi_vUSDC"
        clean = c.replace(".", "")
        return [f"{clean}_vUSDC", f"v{clean}_vUSDC"]
    upper = c.upper()
    return [
        f"v{upper}_vUSDC",
        f"v{c}_vUSDC",
        f"{upper}_vUSDC",
    ]


async def resolve_spot_symbol(coin: str) -> dict[str, Any] | None:
    """Look up the spot symbol metadata for a given coin label, or None."""
    syms = await _load_spot_symbols()
    for cand in _resolve_pair_name(coin):
        if cand in syms:
            return syms[cand]
    # Fallback: match by baseCoin (case-insensitive)
    target = coin.lower().lstrip("v").rstrip(".ssi")
    for s in syms.values():
        bc = s["baseCoin"].lower().lstrip("v")
        if bc == target or bc.replace(".", "") == target.replace(".", ""):
            return s
    return None


async def get_account_id() -> int:
    if _ACCOUNT_ID["id"] is not None:
        return _ACCOUNT_ID["id"]  # type: ignore[return-value]
    if not SODEX_PRIVATE_KEY:
        raise RuntimeError("SODEX_PRIVATE_KEY not set")
    pk = SODEX_PRIVATE_KEY if SODEX_PRIVATE_KEY.startswith("0x") else f"0x{SODEX_PRIVATE_KEY}"
    addr = Account.from_key(pk).address
    async with httpx.AsyncClient(timeout=10) as client:
        res = await client.get(f"{SPOT_BASE}/accounts/{addr}/state")
    res.raise_for_status()
    aid = int(res.json()["data"]["aid"])
    _ACCOUNT_ID["id"] = aid
    return aid


# ── Public trading interface ─────────────────────────────────────────────────

# Default: don't put live orders on chain — places limits 50% below market that
# can't fill. Set SODEX_AUTONOMOUS_TRADE=true to actually trade at market price.
SODEX_AUTONOMOUS_TRADE = os.getenv("SODEX_AUTONOMOUS_TRADE", "false").lower() in {"true", "1", "yes"}


def _quantize(value: float, step: float) -> float:
    """Round to nearest multiple of `step` (truncated toward zero for safety)."""
    if step <= 0:
        return value
    n = int(value / step)
    return n * step


def _decimal_str(value: float, step_str: str) -> str:
    """Format `value` aligned to `step_str` as a tidy decimal string.

    SoDEX expects no trailing zeros and no scientific notation. Using Decimal
    here avoids float-imprecision artifacts like "0.0013000000000000002" and
    produces output that matches what the testnet UI sends.
    """
    step = Decimal(step_str)
    d = (Decimal(str(value)) / step).to_integral_value(rounding=ROUND_DOWN) * step
    s = format(d, "f")
    if "." in s:
        s = s.rstrip("0").rstrip(".")
    return s or "0"


def _explorer_url(pair: str) -> str:
    host = "testnet.sodex.com" if IS_TESTNET else "sodex.com"
    return f"https://{host}/trade/spot/{pair}"


async def execute_trade(
    symbol_in: str,
    symbol_out: str,
    amount_in: float,
    slippage_bps: int = 25,
) -> dict[str, Any]:
    """Buy `symbol_out` with `symbol_in` (USDC-side) on SoDEX spot.

    Resolves the SoDEX pair, sizes the order against current price + symbol
    constraints (tickSize, stepSize, minNotional), and submits as a GTC limit
    via the EIP-712 signed batchNewOrder action. Skips with a structured
    reason when the asset isn't listed or the resulting size is below minNotional.

    By default places a defensive limit 50 % below market (no fill expected) —
    set SODEX_AUTONOMOUS_TRADE=true to use market price instead.
    """
    started = time.time()
    skip_base = {
        "ok": False,
        "skipped": True,
        "symbol_in": symbol_in,
        "symbol_out": symbol_out,
        "amount_in": amount_in,
        "slippage_bps": slippage_bps,
        "gas_val": 0.0,
        "latency_ms": int((time.time() - started) * 1000),
    }

    if symbol_in.upper() not in {"USDC", "VUSDC"}:
        return {**skip_base, "reason": f"only USDC funding supported, got {symbol_in}"}

    sym = await resolve_spot_symbol(symbol_out)
    if sym is None:
        return {**skip_base, "reason": f"no SoDEX spot pair for {symbol_out}"}
    if sym.get("status") != "TRADING":
        return {**skip_base, "reason": f"pair {sym['name']} status={sym.get('status')}"}

    tickers = await _load_spot_tickers()
    last_str = (tickers.get(sym["name"]) or {}).get("lastPx") or "0"
    last_px = float(last_str)
    if last_px <= 0:
        return {**skip_base, "reason": f"no last price for {sym['name']}"}

    # Pricing: defensive 50 % below market by default, market price if autonomous.
    if SODEX_AUTONOMOUS_TRADE:
        target_px = last_px * (1 - slippage_bps / 10_000)
    else:
        target_px = last_px * 0.5

    tick_str = str(sym["tickSize"])
    step_str = str(sym["stepSize"])
    target_px = _quantize(target_px, float(tick_str))
    if target_px <= 0:
        return {**skip_base, "reason": "computed price below tick"}

    quantity = _quantize(amount_in / target_px, float(step_str))
    notional = target_px * quantity
    min_notional = float(sym.get("minNotional") or "0")
    if notional < min_notional:
        return {
            **skip_base,
            "reason": f"notional {notional:.2f} < min {min_notional} on {sym['name']}",
        }

    cl_ord_id = f"agent-{symbol_out[:12]}-{int(time.time() * 1000)}"
    price_s = _decimal_str(target_px, tick_str)
    qty_s = _decimal_str(quantity, step_str)

    # Spot batchNewOrder item field order (Go struct):
    #   symbolID, clOrdID, side, type, timeInForce, price, quantity, funds
    order_item: dict[str, Any] = {
        "symbolID": int(sym["id"]),
        "clOrdID": cl_ord_id,
        "side": 1,            # Buy
        "type": 1,            # Limit
        "timeInForce": 1,     # GTC
        "price": price_s,
        "quantity": qty_s,
    }
    account_id = await get_account_id()
    action = {
        "type": "batchNewOrder",
        "params": {"accountID": account_id, "orders": [order_item]},
    }

    try:
        result = await submit_action(
            "spot", SPOT_BASE, "/trade/orders/batch", action,
        )
    except Exception as exc:  # noqa: BLE001
        return {
            "ok": False,
            "skipped": False,
            "error": str(exc),
            "symbol_in": symbol_in,
            "symbol_out": symbol_out,
            "amount_in": amount_in,
            "pair": sym["name"],
            "limit_price": price_s,
            "quantity": qty_s,
            "gas_val": 0.0,
            "latency_ms": int((time.time() - started) * 1000),
            "external_url": _explorer_url(sym["name"]),
        }

    items = result.get("data") or []
    first = items[0] if items else {}
    order_id = first.get("orderID")
    fee_pct = float(sym.get("takerFee") or "0.001")

    return {
        "ok": True,
        "skipped": False,
        "order_id": order_id,
        "cl_ord_id": cl_ord_id,
        "pair": sym["name"],
        "symbol_in": symbol_in,
        "symbol_out": symbol_out,
        "amount_in": amount_in,
        "limit_price": price_s,
        "last_price": str(last_px),
        "quantity": qty_s,
        "notional": round(notional, 4),
        "gas_val": round(notional * fee_pct, 4),  # estimated taker fee
        "latency_ms": int((time.time() - started) * 1000),
        "external_url": _explorer_url(sym["name"]),
        "status": "resting" if not SODEX_AUTONOMOUS_TRADE else "submitted",
    }


async def cancel_spot_order(symbol_id: int, order_id: int) -> dict[str, Any]:
    """Cancel a single resting spot order.

    BatchCancelOrderItem field order: symbolID, clOrdID (idempotency key for
    THIS cancel request), orderID? (which order to cancel), origClOrdID?
    """
    account_id = await get_account_id()
    cancel_cl_ord_id = f"cancel-{int(time.time() * 1000)}"
    action = {
        "type": "batchCancelOrder",
        "params": {
            "accountID": account_id,
            "cancels": [
                {
                    "symbolID": symbol_id,
                    "clOrdID": cancel_cl_ord_id,
                    "orderID": order_id,
                }
            ],
        },
    }
    return await submit_action(
        "spot", SPOT_BASE, "/trade/orders/batch", action, method="DELETE",
    )


async def list_open_spot_orders(user_address: str | None = None) -> list[dict[str, Any]]:
    addr = user_address
    if not addr:
        if not SODEX_PRIVATE_KEY:
            raise RuntimeError("user_address or SODEX_PRIVATE_KEY required")
        pk = SODEX_PRIVATE_KEY if SODEX_PRIVATE_KEY.startswith("0x") else f"0x{SODEX_PRIVATE_KEY}"
        addr = Account.from_key(pk).address
    async with httpx.AsyncClient(timeout=10) as client:
        res = await client.get(f"{SPOT_BASE}/accounts/{addr}/orders")
    res.raise_for_status()
    data = res.json().get("data") or {}
    return data.get("orders") or []


async def get_balances(user_address: str, account_id: int | None = None) -> dict[str, Any]:
    params = f"?accountID={account_id}" if account_id is not None else ""
    async with httpx.AsyncClient(timeout=15) as client:
        res = await client.get(f"{SPOT_BASE}/accounts/{user_address}/balances{params}")
    res.raise_for_status()
    return res.json()
