#!/usr/bin/env python3
"""Happy-path vault demo: deposit → settle → redeem → claim fees.

Configure via environment variables before running:

  VAULT_RPC_URL              (default: http://127.0.0.1:8545)
  VAULT_ADDRESS              (required) deployed HypeIndexVault address
  VAULT_SIGNER_PRIVATE_KEY   (required) EIP-712 NAV attester key
  VAULT_KEEPER_PRIVATE_KEY   (required) keeper tx signer key
  VAULT_CHAIN_ID             (required) e.g. 31337 for anvil
  VAULT_USDC_ADDRESS         (required) deployed MockUSDC / USDC address

  DEMO_SUBSCRIBER_KEY        subscriber private key (must hold USDC)
  DEMO_CREATOR_ADDRESS       creator address for the vault
  DEMO_INDEX_ID              keccak hex of the index name (default: keccak("vMEME.ssi"))
  DEMO_DEPOSIT_AMOUNT        USDC amount (6dp integer, default 1_000_000_000 = 1000 USDC)

Usage (against a running anvil + deployed contracts):
  cd agent-service
  VAULT_ADDRESS=0x... VAULT_SIGNER_PRIVATE_KEY=0x... ... .venv/bin/python scripts/run_vault_demo.py
"""
from __future__ import annotations

import os
import sys
import json
import time

# Allow running from agent-service/scripts/ — add agent-service/ to sys.path
# so that "src.vault.*" imports (used internally by keeper.py) resolve correctly.
_AGENT_SERVICE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _AGENT_SERVICE_DIR not in sys.path:
    sys.path.insert(0, _AGENT_SERVICE_DIR)

from web3 import Web3
from eth_account import Account

from src.vault.config import KeeperConfig
from src.vault.keeper import Keeper
from src.vault.nav import NavEngine
from src.vault.executor import SimulatedExecutor
from src.vault.abi import VAULT_ABI, ERC20_ABI


def _send_as(w3: Web3, pk: str, fn, chain_id: int) -> dict:
    acct = Account.from_key(pk)
    tx = fn.build_transaction({
        "from": acct.address,
        "nonce": w3.eth.get_transaction_count(acct.address),
        "gas": 3_000_000,
        "gasPrice": w3.eth.gas_price,
        "chainId": chain_id,
    })
    signed = acct.sign_transaction(tx)
    tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
    receipt = w3.eth.wait_for_transaction_receipt(tx_hash)
    if receipt.status != 1:
        raise RuntimeError(f"Transaction {tx_hash.hex()} reverted")
    return receipt


def main() -> None:
    # ------------------------------------------------------------------
    # Config
    # ------------------------------------------------------------------
    cfg = KeeperConfig.from_env()

    subscriber_pk = os.environ.get("DEMO_SUBSCRIBER_KEY", cfg.keeper_key)
    creator_addr  = os.environ.get("DEMO_CREATOR_ADDRESS", Account.from_key(cfg.keeper_key).address)
    raw_idx       = os.environ.get("DEMO_INDEX_ID")
    deposit_amt   = int(os.environ.get("DEMO_DEPOSIT_AMOUNT", str(int(1_000e6))))

    w3 = Web3(Web3.HTTPProvider(cfg.rpc_url))
    if not w3.is_connected():
        sys.exit(f"Cannot connect to RPC: {cfg.rpc_url}")

    if raw_idx:
        idx = Web3.to_bytes(hexstr=raw_idx)
    else:
        idx = Web3.keccak(text="vMEME.ssi")

    print(f"RPC:         {cfg.rpc_url}")
    print(f"Vault:       {cfg.vault_address}")
    print(f"USDC:        {cfg.usdc_address}")
    print(f"Index:       0x{idx.hex()}")
    print(f"Keeper:      {Account.from_key(cfg.keeper_key).address}")
    print(f"Subscriber:  {Account.from_key(subscriber_pk).address}")
    print(f"Creator:     {creator_addr}")
    print(f"Deposit:     {deposit_amt / 1e6:.2f} USDC")
    print()

    vault = w3.eth.contract(address=Web3.to_checksum_address(cfg.vault_address), abi=VAULT_ABI)
    usdc  = w3.eth.contract(address=Web3.to_checksum_address(cfg.usdc_address),  abi=ERC20_ABI)

    nav_engine = NavEngine()
    executor   = SimulatedExecutor()
    keeper     = Keeper(cfg, executor, nav_engine)
    sub_addr   = Account.from_key(subscriber_pk).address

    # ------------------------------------------------------------------
    # 1. Open vault (idempotent — skip if already active)
    # ------------------------------------------------------------------
    vault_state = vault.functions.vaults(idx).call()
    if not vault_state[0]:
        print("[1/5] Opening vault...")
        keeper.open_vault(idx, Web3.to_checksum_address(creator_addr))
        print("      Vault opened.")
    else:
        print("[1/5] Vault already open — skipping openVault.")

    # ------------------------------------------------------------------
    # 2. Subscriber requests deposit
    # ------------------------------------------------------------------
    print(f"[2/5] Requesting deposit of {deposit_amt / 1e6:.2f} USDC...")
    bal = usdc.functions.balanceOf(sub_addr).call()
    if bal < deposit_amt:
        sys.exit(f"Subscriber USDC balance ({bal / 1e6:.2f}) < deposit ({deposit_amt / 1e6:.2f}). Mint first.")

    _send_as(w3, subscriber_pk, usdc.functions.approve(cfg.vault_address, deposit_amt), cfg.chain_id)
    _send_as(w3, subscriber_pk, vault.functions.requestDeposit(idx, deposit_amt, 0), cfg.chain_id)
    print("      Deposit requested.")

    # ------------------------------------------------------------------
    # 3. Keeper settles the deposit
    # ------------------------------------------------------------------
    print("[3/5] Keeper settling deposit (poll_once)...")
    keeper.poll_once()
    shares, hwm = vault.functions.positions(idx, sub_addr).call()
    print(f"      Shares minted: {shares} (hwmNav={hwm})")
    assert shares > 0, "No shares minted — settle failed."

    # ------------------------------------------------------------------
    # 4. Subscriber redeems all shares
    # ------------------------------------------------------------------
    print(f"[4/5] Subscriber requesting redeem of {shares} shares...")
    _send_as(w3, subscriber_pk, vault.functions.requestRedeem(idx, shares, 0), cfg.chain_id)

    usdc_before = usdc.functions.balanceOf(sub_addr).call()
    print(f"      USDC before settle: {usdc_before / 1e6:.6f}")

    keeper.poll_once()
    usdc_after = usdc.functions.balanceOf(sub_addr).call()
    received = usdc_after - usdc_before
    print(f"      USDC after settle:  {usdc_after / 1e6:.6f}")
    print(f"      Subscriber received {received / 1e6:.6f} USDC")

    # ------------------------------------------------------------------
    # 5. Creator claims fees (if any)
    # ------------------------------------------------------------------
    vault_state = vault.functions.vaults(idx).call()
    fee_shares = vault_state[5]
    if fee_shares > 0:
        print(f"[5/5] Creator claiming {fee_shares} fee shares...")
        creator_pk = os.environ.get("DEMO_CREATOR_KEY", cfg.keeper_key)
        creator_usdc_before = usdc.functions.balanceOf(Web3.to_checksum_address(creator_addr)).call()
        _send_as(w3, creator_pk, vault.functions.claimFees(idx), cfg.chain_id)
        keeper.poll_once()
        creator_usdc_after = usdc.functions.balanceOf(Web3.to_checksum_address(creator_addr)).call()
        print(f"      Creator received {(creator_usdc_after - creator_usdc_before) / 1e6:.6f} USDC")
    else:
        print("[5/5] No fee shares to claim.")

    print("\nDemo complete.")


if __name__ == "__main__":
    main()
