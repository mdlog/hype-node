"""End-to-end anvil test: deploys HypeIndexVault via forge, runs the full keeper lifecycle.

Lifecycle order (to exercise mgmt fee accrual on a live position):
  1. deploy MockUSDC + HypeIndexVault
  2. EIP-712 cross-language check (verifyNavExposed)
  3. keeper.open_vault
  4. subscriber requestDeposit → keeper.poll_once → assert shares minted
  5. time-warp 365 days → keeper.accrue → assert creatorFeeShares > 0
  6. subscriber requestRedeem → pre-fund keeper → keeper.poll_once → assert usdc returned
  7. creator claimFees → assert creator balance increased
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
import time
import sys
import os
import pytest

from web3 import Web3
from eth_account import Account

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
# __file__ is agent-service/tests/test_e2e_anvil.py
# repo root (hypenode-app) is two levels up from agent-service/tests/
_AGENT_SERVICE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
REPO_ROOT = os.path.abspath(os.path.join(_AGENT_SERVICE_DIR, ".."))
CONTRACTS_DIR = os.path.join(REPO_ROOT, "contracts")
ARTIFACT_PATH = os.path.join(CONTRACTS_DIR, "out", "HypeIndexVault.sol", "HypeIndexVault.json")

# ---------------------------------------------------------------------------
# Well-known anvil accounts
# ---------------------------------------------------------------------------
ACCT0_PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
ACCT0    = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
ACCT1_PK = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
ACCT1    = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
ACCT2_PK = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"
ACCT2    = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"

RPC_URL  = "http://127.0.0.1:8545"
CHAIN_ID = 31337


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _send_as(w3: Web3, pk: str, fn) -> dict:
    """Sign and send a tx, assert success, return receipt."""
    acct = Account.from_key(pk)
    tx = fn.build_transaction({
        "from": acct.address,
        "nonce": w3.eth.get_transaction_count(acct.address),
        "gas": 3_000_000,
        "gasPrice": w3.eth.gas_price,
        "chainId": CHAIN_ID,
    })
    signed = acct.sign_transaction(tx)
    tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
    receipt = w3.eth.wait_for_transaction_receipt(tx_hash)
    assert receipt.status == 1, f"tx {tx_hash.hex()} reverted"
    return receipt


def _deploy_contract(cmd: list[str]) -> str:
    """Run a forge create command, return the deployed address."""
    result = subprocess.run(cmd, capture_output=True, text=True, cwd=CONTRACTS_DIR)
    if result.returncode != 0:
        pytest.fail(f"forge create failed:\n{result.stdout}\n{result.stderr}")
    match = re.search(r"Deployed to: (0x[0-9a-fA-F]{40})", result.stdout)
    if not match:
        pytest.fail(f"Could not parse deployed address from:\n{result.stdout}")
    return match.group(1)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def anvil_proc():
    """Start anvil on port 8545, yield, then kill it."""
    if shutil.which("anvil") is None:
        pytest.skip("anvil not found")
    if shutil.which("forge") is None:
        pytest.skip("forge not found")

    proc = subprocess.Popen(
        ["anvil", "--port", "8545", "--silent"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    # Poll until RPC responds
    w3 = Web3(Web3.HTTPProvider(RPC_URL))
    for _ in range(30):
        try:
            if w3.is_connected():
                break
        except Exception:
            pass
        time.sleep(0.5)
    else:
        proc.kill()
        pytest.fail("anvil did not start in time")

    yield proc
    proc.kill()
    proc.wait()


@pytest.fixture(scope="module")
def deployed(anvil_proc):
    """Deploy MockUSDC + HypeIndexVault, return (w3, usdc_addr, vault_addr, vault_abi)."""
    # Deploy MockUSDC
    usdc_addr = _deploy_contract([
        "forge", "create", "src/mocks/MockUSDC.sol:MockUSDC",
        "--broadcast",
        "--rpc-url", RPC_URL,
        "--private-key", ACCT0_PK,
    ])
    print(f"\nMockUSDC deployed: {usdc_addr}")

    # Deploy HypeIndexVault(usdc, signer=acct0, keeper=acct0, guardian=acct0)
    vault_addr = _deploy_contract([
        "forge", "create", "src/HypeIndexVault.sol:HypeIndexVault",
        "--broadcast",
        "--rpc-url", RPC_URL,
        "--private-key", ACCT0_PK,
        "--constructor-args", usdc_addr, ACCT0, ACCT0, ACCT0,
    ])
    print(f"HypeIndexVault deployed: {vault_addr}")

    # Load full ABI from artifact
    with open(ARTIFACT_PATH) as f:
        artifact = json.load(f)
    vault_abi = artifact["abi"]

    w3 = Web3(Web3.HTTPProvider(RPC_URL))
    return w3, usdc_addr, vault_addr, vault_abi


# ---------------------------------------------------------------------------
# Test
# ---------------------------------------------------------------------------

def test_full_e2e_lifecycle(deployed):
    """Full keeper lifecycle: deposit → accrue → redeem → claimFees."""
    from src.vault.config import KeeperConfig
    from src.vault.keeper import Keeper
    from src.vault.nav import NavEngine
    from src.vault.executor import SimulatedExecutor
    from src.vault.abi import ERC20_ABI
    from src.vault.attestation import sign_attestation

    w3, usdc_addr, vault_addr, vault_abi = deployed

    usdc  = w3.eth.contract(address=usdc_addr, abi=ERC20_ABI)
    vault = w3.eth.contract(address=vault_addr, abi=vault_abi)

    # ------------------------------------------------------------------
    # Step 2: EIP-712 cross-language check
    # ------------------------------------------------------------------
    idx = Web3.keccak(text="vMEME.ssi")
    signed_at = w3.eth.get_block("latest")["timestamp"]
    sig_hex = sign_attestation(ACCT0_PK, CHAIN_ID, vault_addr, "0x" + idx.hex(), 1_000_000, signed_at)
    sig_bytes = Web3.to_bytes(hexstr=sig_hex)
    # Must not raise — verifyNavExposed calls _verifyNavSig (sig check only, no deviation guard since lastNav==0)
    try:
        vault.functions.verifyNavExposed(idx, 1_000_000, signed_at, sig_bytes).call()
        print("\nverifyNavExposed: Python EIP-712 == Solidity EIP-712 ✓")
    except Exception as exc:
        pytest.fail(f"verifyNavExposed rejected Python signature: {exc}")

    # ------------------------------------------------------------------
    # Step 3: Build Keeper + open vault
    # ------------------------------------------------------------------
    cfg = KeeperConfig(
        rpc_url=RPC_URL,
        vault_address=vault_addr,
        signer_key=ACCT0_PK,
        keeper_key=ACCT0_PK,
        chain_id=CHAIN_ID,
        usdc_address=usdc_addr,
    )
    nav_engine = NavEngine()
    executor   = SimulatedExecutor()
    keeper     = Keeper(cfg, executor, nav_engine)

    keeper.open_vault(idx, ACCT2)
    vault_state = vault.functions.vaults(idx).call()
    assert vault_state[0] is True, "vault should be active"
    print("open_vault: OK")

    # ------------------------------------------------------------------
    # Step 4: Deposit
    # ------------------------------------------------------------------
    deposit_amount = int(1_000e6)
    _send_as(w3, ACCT0_PK, usdc.functions.mint(ACCT1, deposit_amount))
    _send_as(w3, ACCT1_PK, usdc.functions.approve(vault_addr, deposit_amount))
    _send_as(w3, ACCT1_PK, vault.functions.requestDeposit(idx, deposit_amount, 0))
    print("requestDeposit: OK")

    keeper.poll_once()
    shares, _hwm = vault.functions.positions(idx, ACCT1).call()
    assert shares > 0, f"expected shares > 0 after deposit settle, got {shares}"
    print(f"poll_once (deposit): OK — {shares} shares minted")

    # ------------------------------------------------------------------
    # Step 5: Time-warp 365 days then accrue mgmt fee
    # ------------------------------------------------------------------
    w3.provider.make_request("evm_increaseTime", [365 * 24 * 3600])
    w3.provider.make_request("evm_mine", [])

    keeper.accrue(idx)
    vault_state = vault.functions.vaults(idx).call()
    creator_fee_shares = vault_state[5]
    assert creator_fee_shares > 0, f"expected creatorFeeShares > 0, got {creator_fee_shares}"
    print(f"accrue mgmt fee: OK — creatorFeeShares={creator_fee_shares}")

    # ------------------------------------------------------------------
    # Step 6: Redeem
    # ------------------------------------------------------------------
    # Subscriber redeems all shares
    _send_as(w3, ACCT1_PK, vault.functions.requestRedeem(idx, shares, 0))
    print("requestRedeem: OK")

    usdc_before = usdc.functions.balanceOf(ACCT1).call()
    print(f"subscriber USDC before redeem settle: {usdc_before}")

    # Pre-fund keeper so it can deliver realized USDC (settleRedeem transfers from keeper)
    _send_as(w3, ACCT0_PK, usdc.functions.mint(ACCT0, int(2_000e6)))

    keeper.poll_once()
    usdc_after = usdc.functions.balanceOf(ACCT1).call()
    print(f"subscriber USDC after redeem settle: {usdc_after}")
    assert usdc_after > usdc_before, f"expected subscriber USDC to increase after redeem, before={usdc_before} after={usdc_after}"
    # Should get back approximately the deposit amount (no perf fee since nav=INITIAL_NAV==hwmNav)
    # Tolerance: at least 900 USDC (allowing for sim behaviour)
    assert usdc_after - usdc_before >= int(900e6), f"expected ~1000 USDC returned, got {(usdc_after - usdc_before) / 1e6:.2f} USDC"
    print(f"poll_once (redeem): OK — subscriber received {(usdc_after - usdc_before)/1e6:.2f} USDC")

    # ------------------------------------------------------------------
    # Step 7: Creator claimFees then keeper settles it
    # ------------------------------------------------------------------
    creator_usdc_before = usdc.functions.balanceOf(ACCT2).call()
    # Creator calls claimFees — this creates a redeem request for fee shares
    _send_as(w3, ACCT2_PK, vault.functions.claimFees(idx))
    print("claimFees: OK")

    # Keeper polls the new redeem request for the fee shares
    keeper.poll_once()
    creator_usdc_after = usdc.functions.balanceOf(ACCT2).call()
    print(f"creator USDC before={creator_usdc_before} after={creator_usdc_after}")
    assert creator_usdc_after > creator_usdc_before, (
        f"expected creator USDC to increase after fee claim, "
        f"before={creator_usdc_before} after={creator_usdc_after}"
    )
    print(f"claimFees + settle: OK — creator received {(creator_usdc_after - creator_usdc_before)/1e6:.6f} USDC")
    print("\n=== E2E LIFECYCLE PASSED ===")
