"""SSI Registry tool — registers HypeIndex baskets on-chain.

Calls SSIRegistry.registerIndex(...) on the configured chain (default
Sepolia) using SSI_PRIVATE_KEY. Returns the real transaction hash and
receipt fields so the agent's reasoning log can link to a block explorer.

The matching contract source lives at
hypenode-app/contracts/SSIRegistry.sol and the ABI is mirrored at
hypenode-app/lib/contracts/ssiRegistryAbi.ts.
"""

from __future__ import annotations

import asyncio
import os
from typing import Any

from eth_account import Account
from web3 import Web3

# ── Config ───────────────────────────────────────────────────────────────────

CHAIN_ID = int(os.getenv("SSI_CHAIN_ID", "11155111"))  # Sepolia by default

_DEFAULT_RPCS: dict[int, str] = {
    1: "https://eth.llamarpc.com",
    11155111: "https://1rpc.io/sepolia",
    286623: "https://rpc.valuechain.io",
    138565: "https://testnet-rpc.valuechain.io",
}
RPC = os.getenv("SSI_RPC_URL") or _DEFAULT_RPCS.get(CHAIN_ID, "https://1rpc.io/sepolia")
REGISTRY = os.getenv("SSI_REGISTRY_ADDRESS", "")
PRIVATE_KEY = os.getenv("SSI_PRIVATE_KEY", "")

REGISTRY_ABI: list[dict[str, Any]] = [
    {
        "type": "function",
        "name": "registerIndex",
        "stateMutability": "nonpayable",
        "inputs": [
            {"name": "symbol", "type": "string"},
            {"name": "name", "type": "string"},
            {"name": "base", "type": "string"},
            {"name": "tokens", "type": "string[]"},
            {"name": "weightsBps", "type": "uint16[]"},
            {"name": "mgmtFeeBps", "type": "uint16"},
            {"name": "perfFeeBps", "type": "uint16"},
            {"name": "rebalanceCron", "type": "string"},
        ],
        "outputs": [{"name": "id", "type": "bytes32"}],
    },
    {
        "type": "function",
        "name": "exists",
        "stateMutability": "view",
        "inputs": [{"name": "id", "type": "bytes32"}],
        "outputs": [{"type": "bool"}],
    },
]


def _explorer_tx_url(chain_id: int, tx_hash: str) -> str:
    if chain_id == 11155111:
        return f"https://sepolia.etherscan.io/tx/{tx_hash}"
    if chain_id == 1:
        return f"https://etherscan.io/tx/{tx_hash}"
    if chain_id == 286623:
        return f"https://explorer.valuechain.io/tx/{tx_hash}"
    if chain_id == 138565:
        return f"https://testnet-explorer.valuechain.io/tx/{tx_hash}"
    return ""


def _to_contract_args(symbol: str, weights: dict[str, float]) -> tuple[Any, ...]:
    """Convert (symbol, name->weight) into the registerIndex argument tuple.

    Weights at this layer are 0..1; we multiply by 10000 (basis points) and
    absorb any rounding drift into the largest weight so the on-chain
    `sum == 10_000` check always passes.
    """
    items = list(weights.items())
    tokens = [k for k, _ in items]
    bps = [round(v * 10_000) for _, v in items]
    drift = 10_000 - sum(bps)
    if drift != 0 and bps:
        i = bps.index(max(bps))
        bps[i] += drift
    return (
        symbol,
        symbol,                      # name (caller doesn't pass — reuse symbol)
        "USDC",                      # base
        tokens,
        bps,
        0,                           # mgmtFeeBps — default 0; override at higher layer
        0,                           # perfFeeBps
        "",                          # rebalanceCron
    )


def _assert_configured() -> tuple[Web3, Any, str]:
    if not REGISTRY:
        raise RuntimeError(
            "SSI_REGISTRY_ADDRESS not set — deploy contracts/SSIRegistry.sol first"
        )
    if not PRIVATE_KEY:
        raise RuntimeError("SSI_PRIVATE_KEY not set — needed for autonomous publish")
    pk = PRIVATE_KEY if PRIVATE_KEY.startswith("0x") else f"0x{PRIVATE_KEY}"
    w3 = Web3(Web3.HTTPProvider(RPC, request_kwargs={"timeout": 30}))
    if not w3.is_connected():
        raise RuntimeError(f"SSI RPC unreachable: {RPC}")
    addr = Web3.to_checksum_address(REGISTRY)
    contract = w3.eth.contract(address=addr, abi=REGISTRY_ABI)
    return w3, contract, pk


async def wrap(symbol: str, weights: dict[str, float]) -> dict[str, Any]:
    """Register a new index on-chain. Idempotent on `symbol` — if a basket
    with the same symbol was already registered, we return its existing
    state instead of letting the contract revert with IndexAlreadyExists."""
    if not weights:
        raise ValueError("weights cannot be empty")
    total = sum(weights.values())
    if abs(total - 1.0) > 0.01 and abs(total - 100.0) > 0.5:
        raise ValueError(f"weights must sum to 1.0 (or 100), got {total}")
    if abs(total - 100.0) <= 0.5:
        weights = {k: v / 100.0 for k, v in weights.items()}

    args = _to_contract_args(symbol, weights)

    def _send() -> dict[str, Any]:
        w3, contract, pk = _assert_configured()
        acct = Account.from_key(pk)

        # Idempotency: skip the write if this symbol already exists.
        index_id = w3.keccak(text=symbol)
        try:
            already = contract.functions.exists(index_id).call()
        except Exception:
            already = False
        if already:
            return {
                "tx_hash": None,
                "registry": REGISTRY,
                "symbol": symbol,
                "status": "already_registered",
                "chain_id": CHAIN_ID,
                "external_url": "",
            }

        # Sepolia gas_price can be sub-gwei, so just doubling it might leave
        # maxFeePerGas < maxPriorityFeePerGas (which the node rejects). Floor
        # both at sensible minimums and keep maxFee ≥ priority * 2.
        priority = w3.to_wei(1, "gwei")
        base = max(int(w3.eth.gas_price), priority)
        max_fee = base * 2
        tx = contract.functions.registerIndex(*args).build_transaction({
            "from": acct.address,
            "nonce": w3.eth.get_transaction_count(acct.address),
            "chainId": CHAIN_ID,
            "gas": 800_000,
            "maxFeePerGas": max_fee,
            "maxPriorityFeePerGas": priority,
        })
        signed = acct.sign_transaction(tx)
        raw = getattr(signed, "raw_transaction", None) or signed.rawTransaction
        tx_hash_bytes = w3.eth.send_raw_transaction(raw)
        # web3.py 7.x .hex() omits the 0x prefix; normalize so callers always
        # see canonical 0x-prefixed hex.
        tx_hash_hex = tx_hash_bytes.hex() if not isinstance(tx_hash_bytes, str) else tx_hash_bytes
        if not tx_hash_hex.startswith("0x"):
            tx_hash_hex = "0x" + tx_hash_hex
        receipt = w3.eth.wait_for_transaction_receipt(tx_hash_bytes, timeout=180)
        return {
            "tx_hash": tx_hash_hex,
            "registry": REGISTRY,
            "symbol": symbol,
            "status": "confirmed" if receipt.status == 1 else "reverted",
            "block_number": receipt.blockNumber,
            "gas_used": receipt.gasUsed,
            "chain_id": CHAIN_ID,
            "external_url": _explorer_tx_url(CHAIN_ID, tx_hash_hex),
        }

    # Web3.py's HTTP provider is synchronous; offload to a worker thread so
    # we don't block the asyncio event loop while the tx confirms.
    return await asyncio.to_thread(_send)


async def unwrap(symbol: str, amount: float) -> dict[str, Any]:
    """SSIRegistry.sol has no burn / deregister method yet. Surface a loud
    error so callers can decide whether to swap to a USDC hedge another way."""
    raise NotImplementedError(
        "unwrap not implemented: SSIRegistry.sol has no burn method yet"
    )
