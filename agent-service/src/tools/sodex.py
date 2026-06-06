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

    The agent passes things like 'BTC', 'filecoin', 'render', 'vMEME.ssi',
    'SOSO'. SoDEX uses two prefix conventions:
      - `v` — virtual / synthetic testnet asset (vBTC, vETH, vSOL, …)
      - `W` — wrapped real-asset bridge (WSOSO, WBTC where applicable)
    We try both. The caller picks the first hit against the live symbol map.
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
        f"W{upper}_vUSDC",  # wrapped-asset prefix (e.g. WSOSO_vUSDC)
        f"w{upper}_vUSDC",
    ]


async def resolve_spot_symbol(coin: str) -> dict[str, Any] | None:
    """Look up the spot symbol metadata for a given coin label, or None."""
    syms = await _load_spot_symbols()
    for cand in _resolve_pair_name(coin):
        if cand in syms:
            return syms[cand]
    # Fallback: match by baseCoin (case-insensitive). Strip both v/w prefixes
    # on each side so "soso" matches "WSOSO" (wrapped) or "vSOSO" (virtual)
    # without us needing to enumerate every wrapping convention.
    def _strip_prefix(s: str) -> str:
        s = s.lower()
        if s.startswith("v"):
            s = s[1:]
        elif s.startswith("w"):
            s = s[1:]
        return s.replace(".", "")

    target = _strip_prefix(coin).rstrip("ssi") if coin.lower().endswith("ssi") else _strip_prefix(coin)
    for s in syms.values():
        bc = s["baseCoin"]
        if not bc:
            continue
        if _strip_prefix(bc) == target:
            return s
    return None


# ── Perps symbol / ticker resolvers ──────────────────────────────────────────
# Perps markets use a different namespace from spot:
#   spot:  vBTC_vUSDC, vETH_vUSDC, vSOL_vUSDC, …   (testnet "v" prefix)
#   perps: BTC-USD, ETH-USD, SOL-USD, …            (plain ticker, USD-quoted)
# Liquidity on the testnet skews heavily toward perps — spot pairs often go
# stale or flip to cancel-only mode when no market maker is around.

_PERPS_SYMBOL_CACHE: dict[str, Any] = {"data": None, "ts": 0.0}
_PERPS_TICKER_CACHE: dict[str, Any] = {"data": None, "ts": 0.0}


async def _load_perps_symbols() -> dict[str, dict[str, Any]]:
    if time.time() - _PERPS_SYMBOL_CACHE["ts"] < _SYMBOL_TTL and _PERPS_SYMBOL_CACHE["data"]:
        return _PERPS_SYMBOL_CACHE["data"]
    async with httpx.AsyncClient(timeout=10) as client:
        res = await client.get(f"{PERPS_BASE}/markets/symbols")
    res.raise_for_status()
    by_name = {s["name"]: s for s in res.json()["data"]}
    _PERPS_SYMBOL_CACHE["data"] = by_name
    _PERPS_SYMBOL_CACHE["ts"] = time.time()
    return by_name


async def _load_perps_tickers() -> dict[str, dict[str, Any]]:
    if time.time() - _PERPS_TICKER_CACHE["ts"] < _TICKER_TTL and _PERPS_TICKER_CACHE["data"]:
        return _PERPS_TICKER_CACHE["data"]
    async with httpx.AsyncClient(timeout=10) as client:
        res = await client.get(f"{PERPS_BASE}/markets/tickers")
    res.raise_for_status()
    by_symbol = {t["symbol"]: t for t in res.json()["data"]}
    _PERPS_TICKER_CACHE["data"] = by_symbol
    _PERPS_TICKER_CACHE["ts"] = time.time()
    return by_symbol


async def resolve_perps_symbol(coin: str) -> dict[str, Any] | None:
    """Look up the perps symbol metadata for a given coin label, or None.

    Accepts both bare tickers ("SOL", "btc") and full pair names
    ("SOL-USD"). Falls back to baseCoin match so testnet-only symbols like
    "TESTDOGE-USD" (base=DOGE) still resolve when the user types "DOGE".
    """
    syms = await _load_perps_symbols()
    c = coin.strip()
    upper = c.upper()
    candidates = [c, upper, f"{upper}-USD"]
    for cand in candidates:
        if cand in syms:
            return syms[cand]
    target = upper.removesuffix("-USD")
    for s in syms.values():
        bc = (s.get("baseCoin") or "").upper()
        if bc == target and s.get("status") == "TRADING":
            return s
    return None


async def get_account_id() -> int:
    """Account id of the server signer (SODEX_PRIVATE_KEY). Used by the
    autonomous LangGraph rebalance loop. Browser-signed flows should use
    get_account_id_for(address) instead."""
    if _ACCOUNT_ID["id"] is not None:
        return _ACCOUNT_ID["id"]  # type: ignore[return-value]
    if not SODEX_PRIVATE_KEY:
        raise RuntimeError("SODEX_PRIVATE_KEY not set")
    pk = SODEX_PRIVATE_KEY if SODEX_PRIVATE_KEY.startswith("0x") else f"0x{SODEX_PRIVATE_KEY}"
    addr = Account.from_key(pk).address
    aid = await get_account_id_for(addr)
    _ACCOUNT_ID["id"] = aid
    return aid


# Per-address account_id caches. Spot and perps each have their own `aid`
# even for the same wallet — perps maintains a separate margin account.
_ACCOUNT_ID_BY_ADDR: dict[str, int] = {}
_PERPS_ACCOUNT_ID_BY_ADDR: dict[str, int] = {}


async def get_account_id_for(address: str) -> int:
    """Resolve SoDEX SPOT account_id for an arbitrary EVM address. Cached per addr.

    Raises RuntimeError with a chat-friendly message when SoDEX hasn't seen
    this address yet (no account_id assigned) — e.g. fresh wallet that needs
    to fund its first deposit before it can place orders.
    """
    addr = address.strip()
    cached = _ACCOUNT_ID_BY_ADDR.get(addr.lower())
    if cached is not None:
        return cached
    async with httpx.AsyncClient(timeout=10) as client:
        res = await client.get(f"{SPOT_BASE}/accounts/{addr}/state")
    if res.status_code >= 400:
        raise RuntimeError(
            f"SoDEX has no spot account for {addr} yet. Fund the wallet at "
            f"https://testnet.sodex.com (testnet faucet) before trading."
        )
    body = res.json()
    data = body.get("data") if isinstance(body, dict) else None
    if not isinstance(data, dict) or "aid" not in data:
        raise RuntimeError(
            f"SoDEX spot account state empty for {addr}. The wallet hasn't "
            "deposited / registered yet — visit testnet.sodex.com to "
            "create the account, then retry."
        )
    aid = int(data["aid"])
    if aid == 0:
        # SoDEX returns aid=0 for unregistered addresses (and 0 is a valid aid
        # for the system account, never a user). Treat as not-yet-registered.
        raise RuntimeError(
            f"SoDEX hasn't assigned a spot account_id to {addr} yet. Visit "
            "testnet.sodex.com, connect this wallet, and complete the first "
            "deposit / faucet step to create the account, then retry."
        )
    _ACCOUNT_ID_BY_ADDR[addr.lower()] = aid
    return aid


async def get_perps_account_id_for(address: str) -> int:
    """Resolve SoDEX PERPS account_id for an arbitrary EVM address.

    Perps maintains a separate margin account from spot — different aid even
    for the same wallet. Required for cross-product transferAsset (the
    From/To accountIDs span both products) and for perps newOrder.
    """
    addr = address.strip()
    cached = _PERPS_ACCOUNT_ID_BY_ADDR.get(addr.lower())
    if cached is not None:
        return cached
    async with httpx.AsyncClient(timeout=10) as client:
        res = await client.get(f"{PERPS_BASE}/accounts/{addr}/state")
    if res.status_code >= 400:
        raise RuntimeError(
            f"SoDEX has no perps margin account for {addr} yet. Make a first "
            "transfer (or trade) on testnet.sodex.com to initialize the "
            "margin account, then retry."
        )
    body = res.json()
    data = body.get("data") if isinstance(body, dict) else None
    if not isinstance(data, dict) or "aid" not in data:
        raise RuntimeError(
            f"SoDEX perps account state empty for {addr}. Initialize the "
            "perps margin account on testnet.sodex.com first."
        )
    aid = int(data["aid"])
    if aid == 0:
        raise RuntimeError(
            f"SoDEX hasn't assigned a perps account_id to {addr} yet. Visit "
            "testnet.sodex.com → Futures, connect this wallet, and complete "
            "the first deposit to initialize the margin account, then retry."
        )
    _PERPS_ACCOUNT_ID_BY_ADDR[addr.lower()] = aid
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
    mode: str | None = None,
) -> dict[str, Any]:
    """Buy `symbol_out` with `symbol_in` (USDC-side) on SoDEX spot.

    Resolves the SoDEX pair, sizes the order against current price + symbol
    constraints (tickSize, stepSize, minNotional), and submits as a GTC limit
    via the EIP-712 signed batchNewOrder action. Skips with a structured
    reason when the asset isn't listed or the resulting size is below minNotional.

    Pricing modes:
      - "market"     — limit price = last × (1 − slippage_bps/10000). Real fill.
      - "defensive"  — limit price = last × 0.5. Order rests, won't fill.
      - None (default)— follow `SODEX_AUTONOMOUS_TRADE` env (true=market, else=defensive).

    Chat-agent callers should pass mode="market" explicitly when the user
    confirms they want a live testnet fill, or "defensive" for a dry-run.
    The autonomous rebalance loop in graph.py keeps the env-driven default.
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

    # Pricing: explicit mode wins, else fall back to env-driven default.
    if mode == "market":
        use_market = True
    elif mode == "defensive":
        use_market = False
    else:
        use_market = SODEX_AUTONOMOUS_TRADE
    # Side is hardcoded BUY below ("side": 1). For a BUY limit to fill against
    # the existing ask book within slippage, the limit must sit ABOVE the last
    # trade. The previous formula `last × (1 − slip)` placed the limit BELOW
    # the ask (sell-side semantics) — orders went on the book as resting bids
    # and never filled, which is why "buy $20 of ETH" returned Submitted but
    # the asset never showed up in balances.
    if use_market:
        target_px = last_px * (1 + slippage_bps / 10_000)
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

    # Detect per-item silent rejects: SoDEX may return HTTP 200 with an item
    # whose status is "REJECTED" or a non-zero per-item error code — previously
    # these were silently counted as success because only orderID was checked.
    item_status = first.get("status") or ""
    item_code = first.get("code")
    try:
        code_nonzero = item_code is not None and int(item_code) != 0
    except (TypeError, ValueError):
        code_nonzero = True  # unparseable code => treat as rejection
    if item_status.upper() == "REJECTED" or code_nonzero:
        return {
            "ok": False,
            "skipped": False,
            "error": f"SoDEX item reject: {item_status}/{item_code}",
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
        "status": "submitted" if use_market else "resting",
        "mode": "market" if use_market else "defensive",
    }


async def execute_perps_trade(
    symbol_out: str,
    amount_in_usdc: float,
    leverage: int = 1,
    slippage_bps: int = 50,
) -> dict[str, Any]:
    """Server-signed perps BUY order for the autonomous rebalance loop.

    Degrades safely (returns a structured skip) when either:
      - SODEX_PRIVATE_KEY is not set, or
      - SODEX_AUTONOMOUS_TRADE is not truthy
    so the agent never blocks on missing credentials.

    Mirrors execute_trade's return envelope so exec_node can treat both
    uniformly. Uses the perps gateway (PERPS_BASE, domain "futures", flat
    newOrder params — NOT the spot batchNewOrder shape).
    """
    started = time.time()
    skip_base = {
        "ok": False,
        "skipped": True,
        "symbol_in": "USDC",
        "symbol_out": symbol_out,
        "amount_in": amount_in_usdc,
        "slippage_bps": slippage_bps,
        "gas_val": 0.0,
        "mode": "perps",
        "latency_ms": int((time.time() - started) * 1000),
    }

    # Guard: require both the signing key and the autonomous-trade flag.
    if not SODEX_PRIVATE_KEY or not SODEX_AUTONOMOUS_TRADE:
        return {**skip_base, "reason": "perps autonomous trading disabled"}

    sym = await resolve_perps_symbol(symbol_out)
    if sym is None:
        return {**skip_base, "reason": f"no SoDEX perps pair for {symbol_out}"}
    if sym.get("status") != "TRADING":
        return {**skip_base, "reason": f"perps pair {sym['name']} status={sym.get('status')}"}

    tickers = await _load_perps_tickers()
    tk = tickers.get(sym["name"]) or {}
    ref_px_str = tk.get("markPrice") or tk.get("lastPx") or "0"
    ref_px = float(ref_px_str)
    if ref_px <= 0:
        return {**skip_base, "reason": f"no reference price for perps {sym['name']}"}

    # BUY: limit sits above mark to cross asks (same as execute_trade's market logic).
    target_px = ref_px * (1 + slippage_bps / 10_000)
    tick_str = str(sym["tickSize"])
    step_str = str(sym["stepSize"])
    target_px = _quantize(target_px, float(tick_str))
    if target_px <= 0:
        return {**skip_base, "reason": "computed perps price below tick"}

    # Convert USDC notional → contract quantity (accounting for leverage).
    quantity = _quantize((amount_in_usdc * leverage) / target_px, float(step_str))
    min_qty = float(sym.get("minQuantity") or "0")
    if quantity < min_qty:
        return {
            **skip_base,
            "reason": f"perps quantity {quantity} below minQuantity {min_qty} on {sym['name']}",
        }
    notional = target_px * quantity
    min_notional = float(sym.get("minNotional") or "0")
    if notional < min_notional:
        return {
            **skip_base,
            "reason": f"perps notional {notional:.2f} < min {min_notional} on {sym['name']}",
        }

    chosen_leverage = leverage or int(sym.get("initLeverage") or 1)
    max_lev = int(sym.get("maxLeverage") or chosen_leverage)
    if chosen_leverage > max_lev:
        chosen_leverage = max_lev

    cl_ord_id = f"agent-p-{symbol_out[:10]}-{int(time.time() * 1000)}"
    price_s = _decimal_str(target_px, tick_str)
    qty_s = _decimal_str(quantity, step_str)

    try:
        account_id = await get_account_id()
    except RuntimeError as exc:
        return {**skip_base, "skipped": False, "ok": False, "error": str(exc)}

    # Perps newOrder params: flat (not wrapped in `orders: [...]`).
    # Key order must match SoDEX Go SDK PerpsNewOrderRequest struct field order.
    order_params: dict[str, Any] = {
        "accountID": account_id,
        "symbolID": int(sym["id"]),
        "clOrdID": cl_ord_id,
        "side": 1,              # Buy
        "type": 1,              # Limit
        "timeInForce": 1,       # GTC
        "price": price_s,
        "quantity": qty_s,
        "reduceOnly": False,
        "leverage": chosen_leverage,
    }
    action = {"type": "newOrder", "params": order_params}

    try:
        result = await submit_action(
            "futures", PERPS_BASE, "/trade/orders", action,
        )
    except Exception as exc:  # noqa: BLE001
        return {
            "ok": False,
            "skipped": False,
            "error": str(exc),
            "symbol_in": "USDC",
            "symbol_out": symbol_out,
            "amount_in": amount_in_usdc,
            "pair": sym["name"],
            "limit_price": price_s,
            "quantity": qty_s,
            "gas_val": 0.0,
            "mode": "perps",
            "latency_ms": int((time.time() - started) * 1000),
            "external_url": _perps_explorer_url(sym["name"]),
        }

    # Perps newOrder returns a single object (not a list) under "data".
    data = result.get("data") or {}
    order_id = data.get("orderID") or data.get("id")

    # Check for per-item reject in the perps response.
    item_status = (data.get("status") or "").upper()
    item_code = data.get("code")
    try:
        code_nonzero = item_code is not None and int(item_code) != 0
    except (TypeError, ValueError):
        code_nonzero = True  # unparseable code => treat as rejection
    if item_status == "REJECTED" or code_nonzero:
        return {
            "ok": False,
            "skipped": False,
            "error": f"SoDEX perps item reject: {item_status}/{item_code}",
            "symbol_in": "USDC",
            "symbol_out": symbol_out,
            "amount_in": amount_in_usdc,
            "pair": sym["name"],
            "limit_price": price_s,
            "quantity": qty_s,
            "gas_val": 0.0,
            "mode": "perps",
            "latency_ms": int((time.time() - started) * 1000),
            "external_url": _perps_explorer_url(sym["name"]),
        }

    fee_pct = float(sym.get("takerFee") or "0.0004")
    return {
        "ok": True,
        "skipped": False,
        "order_id": order_id,
        "cl_ord_id": cl_ord_id,
        "pair": sym["name"],
        "symbol_in": "USDC",
        "symbol_out": symbol_out,
        "amount_in": amount_in_usdc,
        "limit_price": price_s,
        "last_price": str(ref_px),
        "quantity": qty_s,
        "notional": round(notional, 4),
        "gas_val": round(notional * fee_pct, 4),
        "mode": "perps",
        "latency_ms": int((time.time() - started) * 1000),
        "external_url": _perps_explorer_url(sym["name"]),
        "status": "submitted",
    }


async def poll_spot_fill(cl_ord_id: str, pair: str) -> dict[str, Any]:
    """Best-effort check on a resting spot order's fill status.

    Calls list_open_spot_orders and looks for the order by clOrdID.
    Returns:
      {"resting": True/False, "cum_qty": float, "quantity": float, "filled_pct": float}
    when found, or {"resting": None} on any error / missing key.
    """
    try:
        orders = await list_open_spot_orders()
        for o in orders:
            if o.get("clOrdID") == cl_ord_id or o.get("origClOrdID") == cl_ord_id:
                cum_qty = float(o.get("cumQty") or o.get("cumQuantity") or 0)
                qty = float(o.get("quantity") or o.get("qty") or 0)
                filled_pct = (cum_qty / qty * 100) if qty > 0 else 0.0
                return {
                    "resting": True,
                    "cum_qty": cum_qty,
                    "quantity": qty,
                    "filled_pct": round(filled_pct, 2),
                }
        # Order not in open book — either fully filled or cancelled.
        return {"resting": False, "cum_qty": None, "quantity": None, "filled_pct": None}
    except Exception:  # noqa: BLE001
        return {"resting": None}


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
    """Combined SoDEX account snapshot — spot balances + perps balances + positions.

    The website's "Balances" view aggregates all three; the previous version
    of this helper only hit /spot/.../balances and missed funds parked in the
    perps margin account. We now fan out to:
      - GET /spot/accounts/{addr}/balances
      - GET /perps/accounts/{addr}/balances
      - GET /perps/accounts/{addr}/positions
    in parallel and return them under namespaced keys. Errors on any one
    endpoint are surfaced inline (`{error: ...}`) so the others still render.
    """
    params = f"?accountID={account_id}" if account_id is not None else ""

    async def _safe_get(client: httpx.AsyncClient, url: str) -> dict[str, Any]:
        try:
            res = await client.get(url)
            res.raise_for_status()
            payload = res.json()
            return payload.get("data") or payload
        except httpx.HTTPStatusError as e:
            return {"error": f"HTTP {e.response.status_code}", "url": url}
        except Exception as e:
            return {"error": f"{type(e).__name__}: {e}", "url": url}

    async with httpx.AsyncClient(timeout=15) as client:
        import asyncio as _asyncio
        spot, perps, positions = await _asyncio.gather(
            _safe_get(client, f"{SPOT_BASE}/accounts/{user_address}/balances{params}"),
            _safe_get(client, f"{PERPS_BASE}/accounts/{user_address}/balances{params}"),
            _safe_get(client, f"{PERPS_BASE}/accounts/{user_address}/positions{params}"),
        )

    return {
        "spot": spot.get("balances") if isinstance(spot, dict) else spot,
        "perps": perps.get("balances") if isinstance(perps, dict) else perps,
        "positions": positions.get("positions") if isinstance(positions, dict) else positions,
        "spot_meta": (
            {k: spot[k] for k in ("blockTime", "blockHeight") if isinstance(spot, dict) and k in spot}
            if isinstance(spot, dict)
            else None
        ),
        "perps_meta": (
            {k: perps[k] for k in ("blockTime", "blockHeight") if isinstance(perps, dict) and k in perps}
            if isinstance(perps, dict)
            else None
        ),
    }


# ── Browser-signed flow ──────────────────────────────────────────────────────
# The chat agent calls prepare_trade() to size + price a buy and return an
# unsigned EIP-712 typed-data envelope. The browser signs via wagmi
# `signTypedDataAsync`, then POSTs the signature back to /sodex/submit which
# calls submit_signed_envelope() to forward the signed payload to SoDEX.
# This keeps the user's private key in their wallet — server never sees it.


def _typed_data_for_wagmi(
    domain_name: str,
    payload_hash: bytes,
    nonce: int,
) -> dict[str, Any]:
    """Same EIP-712 doc as build_typed_data() but with bytes/numbers serialized
    to hex/strings so it survives a JSON round-trip to the browser. wagmi's
    signTypedDataAsync expects everything JSON-safe."""
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
            "payloadHash": "0x" + payload_hash.hex(),
            "nonce": str(nonce),  # uint64 — string is safest in wagmi
        },
    }


async def prepare_trade(
    side: str,
    asset_symbol: str,
    amount: float,
    signer_address: str,
    slippage_bps: int = 25,
    mode: str = "market",
) -> dict[str, Any]:
    """Build an unsigned SoDEX spot order envelope for browser-side signing.

    Parameters
    ----------
    side
        "buy" or "sell". Buys spend USDC to receive `asset_symbol`; sells
        liquidate `asset_symbol` for USDC.
    asset_symbol
        The non-USDC side of the pair, e.g. "ETH", "AVAX", "SOSO".
    amount
        For BUY: USDC notional to spend. For SELL: quantity of `asset_symbol`
        to sell. Semantics flip because that's what the user naturally specifies.
    signer_address
        The SIWE-connected navbar wallet. Server never holds this wallet's key.
    slippage_bps
        Tolerance from last price for market mode. 25 = 0.25%.
    mode
        "market" — limit price tight enough to fill (above last for buy,
        below last for sell, by `slippage_bps`).
        "defensive" — limit far from market so order rests without filling
        (50% below market for buy bid; 100% above market for sell ask).
    """
    started = time.time()
    side_lower = (side or "").strip().lower()
    skip_base = {
        "ok": False,
        "skipped": True,
        "ready_to_sign": False,
        "side": side_lower,
        "asset_symbol": asset_symbol,
        "amount": amount,
        "slippage_bps": slippage_bps,
    }

    if side_lower not in ("buy", "sell"):
        return {**skip_base, "reason": f"side must be 'buy' or 'sell', got {side!r}"}
    is_buy = side_lower == "buy"
    side_int = 1 if is_buy else 2

    if not signer_address:
        return {**skip_base, "reason": "signer_address required (connected wallet)"}

    sym = await resolve_spot_symbol(asset_symbol)
    if sym is None:
        return {**skip_base, "reason": f"no SoDEX spot pair for {asset_symbol}"}
    if sym.get("status") != "TRADING":
        return {**skip_base, "reason": f"pair {sym['name']} status={sym.get('status')}"}

    tickers = await _load_spot_tickers()
    last_str = (tickers.get(sym["name"]) or {}).get("lastPx") or "0"
    last_px = float(last_str)
    if last_px <= 0:
        return {**skip_base, "reason": f"no last price for {sym['name']}"}

    use_market = mode == "market" or (mode is None and SODEX_AUTONOMOUS_TRADE)
    if use_market:
        # Marketable limit: above last for buy (cross asks), below last for sell
        # (cross bids). slippage_bps caps how far we tolerate.
        target_px = (
            last_px * (1 + slippage_bps / 10_000)
            if is_buy
            else last_px * (1 - slippage_bps / 10_000)
        )
    else:
        # Defensive: park far enough that the order rests without filling.
        # Buy → bid far below market; sell → ask far above market.
        target_px = last_px * (0.5 if is_buy else 2.0)

    tick_str = str(sym["tickSize"])
    step_str = str(sym["stepSize"])
    target_px = _quantize(target_px, float(tick_str))
    if target_px <= 0:
        return {**skip_base, "reason": "computed price below tick"}

    if is_buy:
        # `amount` is USDC notional → derive asset quantity.
        quantity = _quantize(amount / target_px, float(step_str))
    else:
        # `amount` is asset quantity directly.
        quantity = _quantize(amount, float(step_str))
    if quantity <= 0:
        return {**skip_base, "reason": "computed quantity below step size"}
    notional = target_px * quantity
    min_notional = float(sym.get("minNotional") or "0")
    if notional < min_notional:
        return {
            **skip_base,
            "reason": f"notional {notional:.2f} < min {min_notional} on {sym['name']}",
        }

    cl_ord_id = f"agent-{asset_symbol[:12]}-{int(time.time() * 1000)}"
    price_s = _decimal_str(target_px, tick_str)
    qty_s = _decimal_str(quantity, step_str)

    account_id = await get_account_id_for(signer_address)
    order_item: dict[str, Any] = {
        "symbolID": int(sym["id"]),
        "clOrdID": cl_ord_id,
        "side": side_int,
        "type": 1,            # Limit
        "timeInForce": 1,     # GTC
        "price": price_s,
        "quantity": qty_s,
    }
    action = {
        "type": "batchNewOrder",
        "params": {"accountID": account_id, "orders": [order_item]},
    }
    nonce = int(time.time() * 1000)
    payload_hash = _payload_hash(action)
    typed_data = _typed_data_for_wagmi("spot", payload_hash, nonce)
    wire_body = _canonical_json(action["params"])

    fee_pct = float(sym.get("takerFee") or "0.001")
    summary_in = "USDC" if is_buy else asset_symbol.upper()
    summary_out = asset_symbol.upper() if is_buy else "USDC"
    return {
        "ok": True,
        "skipped": False,
        "ready_to_sign": True,
        "summary": {
            "pair": sym["name"],
            "symbol_in": summary_in,    # what the user sends
            "symbol_out": summary_out,   # what the user receives
            "side": "BUY" if is_buy else "SELL",
            "type": "Limit (market-emulated)" if use_market else "Limit (defensive)",
            "mode": "market" if use_market else "defensive",
            "amount_in": amount,
            "limit_price": price_s,
            "last_price": str(last_px),
            "quantity": qty_s,
            "notional": round(notional, 4),
            "estimated_fee": round(notional * fee_pct, 4),
            "external_url": _explorer_url(sym["name"]),
            "signer_address": signer_address,
        },
        "typed_data": typed_data,
        "submit_payload": {
            "domain_name": "spot",
            "base_url": SPOT_BASE,
            "path": "/trade/orders/batch",
            "method": "POST",
            "wire_body": wire_body,
            "nonce": nonce,
            "signer_address": signer_address,
        },
        "latency_ms": int((time.time() - started) * 1000),
    }


async def prepare_perps_trade(
    side: str,
    asset_symbol: str,
    quantity: float,
    signer_address: str,
    leverage: int | None = None,
    slippage_bps: int = 25,
    mode: str = "market",
    reduce_only: bool = False,
) -> dict[str, Any]:
    """Build an unsigned SoDEX perps order envelope for browser-side signing.

    Perps differs from spot in three meaningful ways:
      - Symbol namespace: plain "SOL-USD" / "BTC-USD" instead of "vSOL_vUSDC".
        See resolve_perps_symbol — testnet perps almost always carries the
        live liquidity that spot lacks.
      - Sizing: caller passes asset `quantity` directly (e.g. 0.5 SOL). For
        perps the user thinks in contract size, not USDC notional.
      - Action shape: `newOrder` (singular) at `/trade/orders` — NOT the
        spot's `batchNewOrder` at `/trade/orders/batch`. Params are flat,
        not wrapped in `{orders: [...]}`.

    EIP-712 domain `name` is the literal string "futures" (not "perps") —
    see lib/api/sodex/typedData.ts:44.

    Parameters
    ----------
    side
        "buy" (open / increase LONG) or "sell" (open SHORT / close LONG).
        Set `reduce_only=True` when closing a position so SoDEX won't open
        a new opposite-side exposure if the position is gone.
    asset_symbol
        Either "SOL" or "SOL-USD" — resolver handles both.
    quantity
        Number of contracts (asset units). Sized against the pair's
        stepSize / minQuantity / minNotional before signing.
    leverage
        Initial leverage for the position. Defaults to the pair's
        `initLeverage` when omitted. Honored only when SoDEX margin mode
        for this symbol is ISOLATED; for cross margin the account-level
        leverage applies.
    mode
        "market" — marketable limit price (above last for buy, below for
        sell) by `slippage_bps` so the order crosses the book.
        "defensive" — limit far from market so the order rests; use this
        for dry-runs that won't fill.
    reduce_only
        When True, SoDEX rejects the order if it would flip / increase the
        position. Use when closing.
    """
    started = time.time()
    side_lower = (side or "").strip().lower()
    skip_base = {
        "ok": False,
        "skipped": True,
        "ready_to_sign": False,
        "product": "perps",
        "side": side_lower,
        "asset_symbol": asset_symbol,
        "quantity": quantity,
        "leverage": leverage,
        "slippage_bps": slippage_bps,
        "reduce_only": reduce_only,
    }

    if side_lower not in ("buy", "sell"):
        return {**skip_base, "reason": f"side must be 'buy' or 'sell', got {side!r}"}
    is_buy = side_lower == "buy"
    side_int = 1 if is_buy else 2

    if not signer_address:
        return {**skip_base, "reason": "signer_address required (connected wallet)"}

    sym = await resolve_perps_symbol(asset_symbol)
    if sym is None:
        return {**skip_base, "reason": f"no SoDEX perps pair for {asset_symbol}"}
    if sym.get("status") != "TRADING":
        return {**skip_base, "reason": f"pair {sym['name']} status={sym.get('status')}"}

    tickers = await _load_perps_tickers()
    tk = tickers.get(sym["name"]) or {}
    # markPrice is the fairer reference for perps (spot index ± funding) but
    # falls back to lastPx when an empty book leaves markPrice unset.
    ref_px_str = tk.get("markPrice") or tk.get("lastPx") or "0"
    ref_px = float(ref_px_str)
    if ref_px <= 0:
        return {**skip_base, "reason": f"no reference price for {sym['name']}"}

    use_market = mode == "market"
    if use_market:
        target_px = (
            ref_px * (1 + slippage_bps / 10_000)
            if is_buy
            else ref_px * (1 - slippage_bps / 10_000)
        )
    else:
        target_px = ref_px * (0.5 if is_buy else 2.0)

    tick_str = str(sym["tickSize"])
    step_str = str(sym["stepSize"])
    target_px = _quantize(target_px, float(tick_str))
    if target_px <= 0:
        return {**skip_base, "reason": "computed price below tick"}

    qty = _quantize(quantity, float(step_str))
    min_qty = float(sym.get("minQuantity") or "0")
    if qty < min_qty:
        return {
            **skip_base,
            "reason": f"quantity {qty} below minQuantity {min_qty} on {sym['name']}",
        }
    notional = target_px * qty
    min_notional = float(sym.get("minNotional") or "0")
    if notional < min_notional:
        return {
            **skip_base,
            "reason": f"notional {notional:.2f} < min {min_notional} on {sym['name']}",
        }

    cl_ord_id = f"agent-p-{sym['name'][:10]}-{int(time.time() * 1000)}"
    price_s = _decimal_str(target_px, tick_str)
    qty_s = _decimal_str(qty, step_str)

    chosen_leverage = int(leverage) if leverage else int(sym.get("initLeverage") or 1)
    max_lev = int(sym.get("maxLeverage") or chosen_leverage)
    if chosen_leverage > max_lev:
        return {**skip_base, "reason": f"leverage {chosen_leverage}x > pair max {max_lev}x"}

    account_id = await get_account_id_for(signer_address)
    # Perps newOrder params (flat, not wrapped in `orders: [...]`). Key order
    # must match SoDEX Go SDK's PerpsNewOrderRequest struct field order — the
    # server reproduces payloadHash by json.Marshal which preserves field order.
    order_params: dict[str, Any] = {
        "accountID": account_id,
        "symbolID": int(sym["id"]),
        "clOrdID": cl_ord_id,
        "side": side_int,
        "type": 1,            # Limit
        "timeInForce": 1,     # GTC
        "price": price_s,
        "quantity": qty_s,
        "reduceOnly": bool(reduce_only),
        "leverage": chosen_leverage,
    }
    action = {"type": "newOrder", "params": order_params}
    nonce = int(time.time() * 1000)
    payload_hash = _payload_hash(action)
    typed_data = _typed_data_for_wagmi("futures", payload_hash, nonce)
    wire_body = _canonical_json(action["params"])

    fee_pct = float(sym.get("takerFee") or "0.0004")
    return {
        "ok": True,
        "skipped": False,
        "ready_to_sign": True,
        "product": "perps",
        "summary": {
            "pair": sym["name"],
            "side": "BUY" if is_buy else "SELL",
            "type": "Limit (market-emulated)" if use_market else "Limit (defensive)",
            "mode": "market" if use_market else "defensive",
            "quantity": qty_s,
            "limit_price": price_s,
            "mark_price": str(ref_px),
            "notional": round(notional, 4),
            "leverage": chosen_leverage,
            "reduce_only": bool(reduce_only),
            "estimated_fee": round(notional * fee_pct, 4),
            "external_url": _perps_explorer_url(sym["name"]),
            "signer_address": signer_address,
        },
        "typed_data": typed_data,
        "submit_payload": {
            "domain_name": "futures",
            "base_url": PERPS_BASE,
            "path": "/trade/orders",
            "method": "POST",
            "wire_body": wire_body,
            "nonce": nonce,
            "signer_address": signer_address,
        },
        "latency_ms": int((time.time() - started) * 1000),
    }


def _perps_explorer_url(pair: str) -> str:
    host = "testnet.sodex.com" if IS_TESTNET else "sodex.com"
    return f"https://{host}/trade/futures/{pair}"


# ── Spot ↔ perps transfer ────────────────────────────────────────────────────
# transferAsset action — schema reverse-engineered from the SoDEX REST v1 docs
# (https://sodex.com/documentation/api/rest-v1/sodex-rest-perps-api) and a
# series of live validation errors. Authoritative Go struct:
#
#   type TransferAssetRequest struct {
#       ID            uint64  `json:"id"`             // client-minted; ms-ts works
#       FromAccountID uint64  `json:"fromAccountID"`
#       ToAccountID   uint64  `json:"toAccountID"`
#       CoinID        uint64  `json:"coinID"`         // 0 = vUSDC (testnet)
#       Amount        string  `json:"amount"`         // DecimalString
#       Type          int32   `json:"type"`           // TransferAssetTypeEnum
#   }
#
# TransferAssetTypeEnum:
#   0 EVM_DEPOSIT     · 1 PERPS_DEPOSIT  · 2 EVM_WITHDRAW
#   3 PERPS_WITHDRAW  · 4 INTERNAL        · 5 SPOT_WITHDRAW
#   6 SPOT_DEPOSIT
#
# spot→perps direction: call the SPOT gateway, sign under "spot", and use
# PERPS_WITHDRAW (3) with toAccountID=999 (the spot chain route account).
# perps→spot direction: call the PERPS gateway, sign under "futures", and use
# SPOT_WITHDRAW (5) with toAccountID=999 (the perps chain route account).

_COIN_CACHE: dict[str, Any] = {"data": None, "ts": 0.0}
_PERPS_COIN_CACHE: dict[str, Any] = {"data": None, "ts": 0.0}
_COIN_TTL = 3600  # 1 h — coin list almost never changes


async def _load_spot_coins() -> dict[str, dict[str, Any]]:
    """Coin metadata indexed by name (case-insensitive). Returns {name_upper:
    {id, name, precision}}."""
    if time.time() - _COIN_CACHE["ts"] < _COIN_TTL and _COIN_CACHE["data"]:
        return _COIN_CACHE["data"]
    async with httpx.AsyncClient(timeout=10) as client:
        res = await client.get(f"{SPOT_BASE}/markets/coins")
    res.raise_for_status()
    by_name = {c["name"].upper(): c for c in res.json()["data"]}
    _COIN_CACHE["data"] = by_name
    _COIN_CACHE["ts"] = time.time()
    return by_name


async def _load_perps_coins() -> dict[str, dict[str, Any]]:
    """Perps coin metadata indexed by name (case-insensitive)."""
    if time.time() - _PERPS_COIN_CACHE["ts"] < _COIN_TTL and _PERPS_COIN_CACHE["data"]:
        return _PERPS_COIN_CACHE["data"]
    async with httpx.AsyncClient(timeout=10) as client:
        res = await client.get(f"{PERPS_BASE}/markets/coins")
    res.raise_for_status()
    by_name = {c["name"].upper(): c for c in res.json()["data"]}
    _PERPS_COIN_CACHE["data"] = by_name
    _PERPS_COIN_CACHE["ts"] = time.time()
    return by_name


async def resolve_coin(name: str, product: str = "spot") -> dict[str, Any] | None:
    """Look up gateway-local coin metadata by friendly name.

    Defaults bare "USDC" to the testnet's vUSDC since that's the universal
    quote / margin asset there. Coin IDs are gateway-local, so transfer
    envelopes must resolve against the endpoint that will receive the submit.
    """
    coins = await (_load_perps_coins() if product == "perps" else _load_spot_coins())
    upper = name.strip().upper()
    if upper == "USDC" and IS_TESTNET:
        # Prefer vUSDC over tUSDC since vUSDC is the quote currency for all
        # perps and spot pairs on testnet — funds in tUSDC can't open positions.
        for cand in ("VUSDC", "USDC"):
            if cand in coins:
                return coins[cand]
        return None
    return coins.get(upper)


async def prepare_transfer(
    direction: str,
    amount: float,
    signer_address: str,
    coin: str = "vUSDC",
) -> dict[str, Any]:
    """Build an unsigned SoDEX cross-product transferAsset envelope.

    Parameters
    ----------
    direction
        "spot_to_perps" (move USDC into the futures margin account so you can
        open a perps position) or "perps_to_spot" (pull margin back to spot
        for withdrawal / spot trading).
    amount
        Amount of `coin` to move. Quantized to the coin's precision before
        signing — SoDEX rejects sub-precision values.
    signer_address
        SIWE-connected wallet. The agent never holds this key.
    coin
        Coin name (e.g. "vUSDC", "tUSDC"). Default vUSDC because that's the
        margin currency for perps positions on testnet.
    """
    started = time.time()
    direction_norm = (direction or "").strip().lower().replace("-", "_")
    skip_base = {
        "ok": False,
        "skipped": True,
        "ready_to_sign": False,
        "direction": direction_norm,
        "amount": amount,
        "coin": coin,
    }

    if direction_norm not in ("spot_to_perps", "perps_to_spot"):
        return {
            **skip_base,
            "reason": "direction must be 'spot_to_perps' or 'perps_to_spot'",
        }
    if amount <= 0:
        return {**skip_base, "reason": "amount must be > 0"}
    if not signer_address:
        return {**skip_base, "reason": "signer_address required (connected wallet)"}

    is_to_perps = direction_norm == "spot_to_perps"
    domain_name = "spot" if is_to_perps else "futures"
    base_url = SPOT_BASE if is_to_perps else PERPS_BASE
    source_product = "spot" if is_to_perps else "perps"

    coin_meta = await resolve_coin(coin, source_product)
    if coin_meta is None:
        return {**skip_base, "reason": f"unknown SoDEX {source_product} coin: {coin}"}

    # Quantize amount to coin precision. SoDEX's Go decimal type rejects values
    # that have more fractional digits than precision allows.
    precision = int(coin_meta.get("precision") or 6)
    step = Decimal(1).scaleb(-precision)  # 10^-precision
    amount_q = (Decimal(str(amount)) / step).to_integral_value(
        rounding=ROUND_DOWN
    ) * step
    if amount_q <= 0:
        return {
            **skip_base,
            "reason": f"amount below coin precision (1e-{precision} {coin_meta['name']})",
        }
    amount_s = format(amount_q, "f")
    if "." in amount_s:
        amount_s = amount_s.rstrip("0").rstrip(".")

    # SoDEX models cross-engine transfers as withdrawals from the source
    # engine into a reserved route account (999). The EIP-712 signer tells the
    # destination engine which wallet to credit.
    ROUTE_AID = 999
    if is_to_perps:
        from_aid = await get_account_id_for(signer_address)
        to_aid = ROUTE_AID
    else:
        from_aid = await get_perps_account_id_for(signer_address)
        to_aid = ROUTE_AID

    # Idempotency / transfer identifier — uint64. Millisecond timestamp gives
    # us a monotonically-increasing value unique per call. Distinct from
    # `nonce`: nonce binds the EIP-712 envelope, `id` is the transfer's own
    # server-side primary key.
    transfer_id = int(time.time() * 1000)

    # TransferAssetTypeEnum values per SoDEX REST v1:
    #   3 = PERPS_WITHDRAW (withdrawal TO perps chain → spot→perps)
    #   5 = SPOT_WITHDRAW  (withdrawal TO spot chain  → perps→spot)
    type_int = 3 if is_to_perps else 5

    # Field order matches the Go TransferAssetRequest struct exactly:
    # id, fromAccountID, toAccountID, coinID, amount, type. payloadHash hashes
    # the canonical JSON in struct field order — reordering breaks signing.
    params: dict[str, Any] = {
        "id": transfer_id,
        "fromAccountID": from_aid,
        "toAccountID": to_aid,
        "coinID": int(coin_meta["id"]),
        "amount": amount_s,
        "type": type_int,
    }
    action = {"type": "transferAsset", "params": params}
    nonce = int(time.time() * 1000)
    payload_hash = _payload_hash(action)
    typed_data = _typed_data_for_wagmi(domain_name, payload_hash, nonce)
    wire_body = _canonical_json(action["params"])

    from_label = "spot" if is_to_perps else "perps"
    to_label = "perps" if is_to_perps else "spot"
    return {
        "ok": True,
        "skipped": False,
        "ready_to_sign": True,
        "product": "transfer",
        "summary": {
            "action": "transferAsset",
            "from_account": from_label,
            "to_account": to_label,
            "from_account_id": from_aid,
            "to_account_id": to_aid,
            "coin": coin_meta["name"],
            "amount": amount_s,
            "transfer_id": transfer_id,
            "signer_address": signer_address,
        },
        "typed_data": typed_data,
        "submit_payload": {
            "domain_name": domain_name,
            "base_url": base_url,
            "path": "/accounts/transfers",
            "method": "POST",
            "wire_body": wire_body,
            "nonce": nonce,
            "signer_address": signer_address,
            "action_kind": "transfer",  # hint to /sodex/submit response parser
        },
        "latency_ms": int((time.time() - started) * 1000),
    }


def _normalize_signature(sig_hex: str) -> str:
    """Turn a wagmi-signed hex (0x..130 hex) into SoDEX's `0x01 || raw` format.

    wagmi returns 65-byte ECDSA with v ∈ {27, 28}. SoDEX expects v ∈ {0, 1}.
    """
    s = sig_hex.lower()
    if s.startswith("0x"):
        s = s[2:]
    raw = bytes.fromhex(s)
    if len(raw) != 65:
        raise RuntimeError(f"signature must be 65 bytes, got {len(raw)}")
    v = raw[-1]
    if v >= 27:
        v -= 27
    return "0x01" + raw[:-1].hex() + bytes([v]).hex()


async def submit_signed_envelope(
    submit_payload: dict[str, Any],
    signature_hex: str,
) -> dict[str, Any]:
    """Forward a browser-signed action to SoDEX. Server doesn't sign — it only
    re-shapes the wagmi signature into SoDEX's wire format and adds the auth
    headers."""
    sig = _normalize_signature(signature_hex)
    headers = {
        "X-API-Sign": sig,
        "X-API-Nonce": str(submit_payload["nonce"]),
        "X-API-Chain": str(CHAIN_ID),
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    if SODEX_API_KEY_NAME:
        headers["X-API-Key"] = SODEX_API_KEY_NAME
    async with httpx.AsyncClient(timeout=30) as client:
        res = await client.request(
            submit_payload.get("method", "POST"),
            submit_payload["base_url"] + submit_payload["path"],
            content=submit_payload["wire_body"],
            headers=headers,
        )
    if res.status_code >= 400:
        raise RuntimeError(f"SoDEX {res.status_code}: {res.text}")
    body = res.json()
    if isinstance(body, dict) and body.get("code", 0) != 0:
        raise RuntimeError(f"SoDEX action error: {body}")
    return body
