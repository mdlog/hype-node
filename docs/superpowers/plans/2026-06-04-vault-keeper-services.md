# Vault Keeper + Price-Signer Services (sub-project 1b) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or executing-plans. Steps use `- [ ]` checkboxes.

**Goal:** Build the off-chain **price-signer** + **keeper/relayer** services (Python, in `agent-service`) that drive the deployed `HypeIndexVault` through its async lifecycle, with **simulated** SoDEX execution behind a swappable seam. Verified end-to-end on a local **anvil** node (pointing at ValueChain testnet later is an env change).

**Architecture (approved 2026-06-04):** Spike resolved that SoDEX is off-chain only (no on-chain router, no EIP-1271) → an **EOA keeper** holds funds in-flight and relays. For this testnet MVP the SoDEX trading leg is a `SimulatedExecutor` (realized values from a NAV engine); the live `sodex.py` executor is a stubbed seam, deferred until SoDEX-team info. The **price-signer** computes `navPerShare` and signs the vault's EIP-712 `PriceAttestation`. The **keeper** polls vault events, calls `pullForDeposit`/`settleDeposit`/`cancelDeposit`/`settleRedeem`/`accrueMgmt`.

**Tech:** Python 3.12, `web3` 7.16, `eth-account` 0.13 (`encode_typed_data` — same as `sodex.py`), Foundry/anvil for the local chain, pytest.

**Source spec:** vault design `docs/superpowers/specs/2026-06-04-hypeindexvault-design.md` (§13 spike). Contract on branch `feat/wave2-hypeindexvault`.

**Boundary / deferred (need SoDEX-team info):** the real `LiveSodexExecutor` (uses `sodex.py`), the `EVM_DEPOSIT`/`EVM_WITHDRAW` bridge legs, mainnet chain + canonical USDC, multisig signer, custody hardening (MPC/HSM).

---

## File Structure

| File | Responsibility |
|---|---|
| `agent-service/src/vault/__init__.py` | package marker |
| `agent-service/src/vault/attestation.py` | EIP-712 `PriceAttestation` build + sign (matches the vault domain/typehash) |
| `agent-service/src/vault/nav.py` | `NavEngine` — simulated per-index basket NAV ledger + `navPerShare` math |
| `agent-service/src/vault/executor.py` | `SodexExecutor` protocol + `SimulatedExecutor` + `LiveSodexExecutor` (stub) |
| `agent-service/src/vault/abi.py` | minimal `HypeIndexVault` + ERC20 ABIs (event + function fragments the keeper needs) |
| `agent-service/src/vault/keeper.py` | `Keeper` — web3 client, event poll, settle orchestration, accrue, idempotency |
| `agent-service/src/vault/config.py` | env config (RPC, vault addr, signer/keeper keys, chain id) |
| `agent-service/tests/test_attestation.py` | unit: signing + recover round-trip; digest matches |
| `agent-service/tests/test_nav.py` | unit: NAV math (first deposit, subsequent, redeem, mark) |
| `agent-service/tests/test_e2e_anvil.py` | integration: anvil + forge-deployed vault, full lifecycle through the keeper, **+ Python-sig accepted by `verifyNavExposed`** |
| `agent-service/scripts/run_vault_demo.py` | scripted deposit→settle→redeem→claim demo against a running node |

---

## Task A: NAV engine (`nav.py`) — pure math, TDD

**Files:** Create `agent-service/src/vault/__init__.py` (empty), `agent-service/src/vault/nav.py`, `agent-service/tests/test_nav.py`.

NAV convention (from the contract): `navPerShare` = USDC(6dp) value of `WAD=1e18` shares; `shares = basketValueUsdc * WAD / navPerShare`. The engine tracks a per-index basket USDC value off-chain (simulated custody) and prices against on-chain `totalShares`.

- [ ] **Step 1: failing tests** `agent-service/tests/test_nav.py`:
```python
from src.vault.nav import NavEngine, WAD, INITIAL_NAV

def test_first_deposit_uses_initial_nav():
    eng = NavEngine()
    nav, bval = eng.quote_deposit("idx", usdc_in=100_000_000, total_shares_onchain=0)
    assert nav == INITIAL_NAV            # 1e6
    assert bval == 100_000_000           # 1:1 sim
    shares = bval * WAD // nav
    eng.on_deposit_settled("idx", usdc_in=100_000_000, minted_shares=shares)
    assert eng.basket_usd("idx") == 100_000_000

def test_subsequent_deposit_prices_against_basket():
    eng = NavEngine()
    eng.quote_deposit("idx", 100_000_000, 0); eng.on_deposit_settled("idx", 100_000_000, 100*10**18)
    # basket=100e6, shares=100e18 → nav = 100e6*WAD/100e18 = 1e6
    nav, bval = eng.quote_deposit("idx", 50_000_000, total_shares_onchain=100*10**18)
    assert nav == 1_000_000
    assert bval == 50_000_000

def test_mark_changes_nav():
    eng = NavEngine()
    eng.quote_deposit("idx", 100_000_000, 0); eng.on_deposit_settled("idx", 100_000_000, 100*10**18)
    eng.mark("idx", 2.0)                  # basket doubles
    nav, _ = eng.quote_deposit("idx", 1_000_000, total_shares_onchain=100*10**18)
    assert nav == 2_000_000              # 200e6*WAD/100e18

def test_redeem_pro_rata():
    eng = NavEngine()
    eng.quote_deposit("idx", 100_000_000, 0); eng.on_deposit_settled("idx", 100_000_000, 100*10**18)
    # redeem half the shares (MIN_SHARES ignored in sim ledger; use on-chain total incl. dead = 100e18+1000)
    nav, usdc_out = eng.quote_redeem("idx", shares=50*10**18, total_shares_onchain=100*10**18 + 1000)
    # pro-rata of basket: 100e6 * 50e18/(100e18+1000) ≈ 49999999 (rounds down)
    assert 49_900_000 <= usdc_out <= 50_000_000
    eng.on_redeem_settled("idx", usdc_out)
    assert eng.basket_usd("idx") == 100_000_000 - usdc_out
```

- [ ] **Step 2: run, confirm fail** — `cd agent-service && python -m pytest tests/test_nav.py -q` → ImportError/fail.

- [ ] **Step 3: implement** `agent-service/src/vault/nav.py`:
```python
"""Simulated per-index NAV ledger for the vault keeper (testnet MVP).

navPerShare = USDC(6dp) value of WAD shares. Tracks an off-chain basket USDC
value per index (the simulated custody) and prices against on-chain totalShares.
Swap this out for real SoDEX mark-to-market when the live executor lands.
"""
WAD = 10**18
INITIAL_NAV = 1_000_000        # opening navPerShare (1 USDC per WAD shares), matches contract test convention

class NavEngine:
    def __init__(self) -> None:
        self._basket: dict[str, int] = {}     # indexId -> basket value in USDC (6dp)

    def basket_usd(self, index_id: str) -> int:
        return self._basket.get(index_id, 0)

    def quote_deposit(self, index_id: str, usdc_in: int, total_shares_onchain: int) -> tuple[int, int]:
        """Return (navPerShare, basketValueUsdc) for settleDeposit. 1:1 simulated fill."""
        basket = self._basket.get(index_id, 0)
        if total_shares_onchain == 0 or basket == 0:
            nav = INITIAL_NAV
        else:
            nav = basket * WAD // total_shares_onchain
        return nav, usdc_in

    def on_deposit_settled(self, index_id: str, usdc_in: int, minted_shares: int) -> None:
        self._basket[index_id] = self._basket.get(index_id, 0) + usdc_in

    def quote_redeem(self, index_id: str, shares: int, total_shares_onchain: int) -> tuple[int, int]:
        """Return (navPerShare, usdcReceived) for settleRedeem. Pro-rata of the basket."""
        basket = self._basket.get(index_id, 0)
        if total_shares_onchain == 0:
            return INITIAL_NAV, 0
        nav = basket * WAD // total_shares_onchain
        usdc_out = basket * shares // total_shares_onchain
        return nav, usdc_out

    def on_redeem_settled(self, index_id: str, usdc_out: int) -> None:
        self._basket[index_id] = max(0, self._basket.get(index_id, 0) - usdc_out)

    def mark(self, index_id: str, multiplier: float) -> None:
        """Simulate mark-to-market P/L (demo/testing). Real impl marks from SoSoValue."""
        self._basket[index_id] = int(self._basket.get(index_id, 0) * multiplier)
```

- [ ] **Step 4: run, confirm pass** — `python -m pytest tests/test_nav.py -q` → all pass.
- [ ] **Step 5: commit** — `git add agent-service/src/vault/__init__.py agent-service/src/vault/nav.py agent-service/tests/test_nav.py && git commit -m "feat(vault-keeper): simulated NAV engine"`

---

## Task B: EIP-712 attestation signer (`attestation.py`) — TDD

**Files:** Create `agent-service/src/vault/attestation.py`, `agent-service/tests/test_attestation.py`.

Must match the contract's `EIP712("HypeIndexVault","1")` domain + `PriceAttestation(bytes32 indexId,uint256 navPerShare,uint256 signedAt)` typehash, producing a 65-byte `r||s||v` signature that `ECDSA.recover` accepts.

- [ ] **Step 1: failing test** `agent-service/tests/test_attestation.py`:
```python
from eth_account import Account
from src.vault.attestation import build_typed_data, sign_attestation

VAULT = "0x000000000000000000000000000000000000dEaD"
CHAIN = 31337
IDX = "0x" + "11"*32

def test_sign_and_recover_roundtrip():
    acct = Account.create()
    sig = sign_attestation(acct.key.hex(), CHAIN, VAULT, IDX, nav=1_000_000, signed_at=1_700_000_000)
    assert isinstance(sig, str) and sig.startswith("0x") and len(sig) == 132  # 65 bytes hex
    # recover via the same typed data
    from eth_account.messages import encode_typed_data
    typed = build_typed_data(CHAIN, VAULT, IDX, 1_000_000, 1_700_000_000)
    recovered = Account.recover_message(encode_typed_data(full_message=typed), signature=sig)
    assert recovered.lower() == acct.address.lower()

def test_domain_and_types_shape():
    typed = build_typed_data(CHAIN, VAULT, IDX, 1_000_000, 1_700_000_000)
    assert typed["domain"]["name"] == "HypeIndexVault"
    assert typed["domain"]["version"] == "1"
    assert typed["domain"]["chainId"] == CHAIN
    assert typed["domain"]["verifyingContract"].lower() == VAULT.lower()
    assert typed["primaryType"] == "PriceAttestation"
    names = [f["name"] for f in typed["types"]["PriceAttestation"]]
    assert names == ["indexId", "navPerShare", "signedAt"]
```

- [ ] **Step 2: confirm fail** — `python -m pytest tests/test_attestation.py -q`.

- [ ] **Step 3: implement** `agent-service/src/vault/attestation.py`:
```python
"""EIP-712 PriceAttestation signer — matches HypeIndexVault's domain + typehash.
Mirrors the contract: EIP712("HypeIndexVault","1"); PriceAttestation(bytes32 indexId,uint256 navPerShare,uint256 signedAt).
"""
from eth_account import Account
from eth_account.messages import encode_typed_data

def build_typed_data(chain_id: int, vault: str, index_id: str, nav: int, signed_at: int) -> dict:
    return {
        "types": {
            "EIP712Domain": [
                {"name": "name", "type": "string"},
                {"name": "version", "type": "string"},
                {"name": "chainId", "type": "uint256"},
                {"name": "verifyingContract", "type": "address"},
            ],
            "PriceAttestation": [
                {"name": "indexId", "type": "bytes32"},
                {"name": "navPerShare", "type": "uint256"},
                {"name": "signedAt", "type": "uint256"},
            ],
        },
        "primaryType": "PriceAttestation",
        "domain": {"name": "HypeIndexVault", "version": "1", "chainId": chain_id, "verifyingContract": vault},
        "message": {"indexId": index_id, "navPerShare": nav, "signedAt": signed_at},
    }

def sign_attestation(signer_key: str, chain_id: int, vault: str, index_id: str, nav: int, signed_at: int) -> str:
    typed = build_typed_data(chain_id, vault, index_id, nav, signed_at)
    signed = Account.sign_message(encode_typed_data(full_message=typed), private_key=signer_key)
    return signed.signature.to_0x_hex() if hasattr(signed.signature, "to_0x_hex") else "0x" + signed.signature.hex().removeprefix("0x")
```
> If `index_id` as a `0x..` string isn't accepted by `encode_typed_data` for a `bytes32`, pass `bytes.fromhex(index_id[2:])`. The implementer must confirm the exact form eth-account 0.13 wants and make the round-trip test pass.

- [ ] **Step 4: confirm pass.** - [ ] **Step 5: commit** `feat(vault-keeper): EIP-712 PriceAttestation signer`.

---

## Task C: ABIs + executor seam (`abi.py`, `executor.py`)

**Files:** Create `agent-service/src/vault/abi.py`, `agent-service/src/vault/executor.py`.

- [ ] **Step 1:** `abi.py` — export `VAULT_ABI` (a JSON list with the fragments the keeper uses: events `DepositRequested(uint256,bytes32,address,uint256)`, `RedeemRequested(uint256,bytes32,address,uint256)`; functions `openVault`, `pullForDeposit`, `settleDeposit`, `cancelDeposit`, `settleRedeem`, `accrueMgmt`, `claimFees`, `vaults`, `positions`, `nextRequestId`, `pendingDeposits`, `pendingRedeems`, `verifyNavExposed`) and `ERC20_ABI` (`approve`, `balanceOf`, `mint`, `transfer`). Derive the exact fragments by reading `contracts/src/HypeIndexVault.sol` + `contracts/out/HypeIndexVault.sol/HypeIndexVault.json` (the Foundry artifact has the full ABI — copy the needed entries).
- [ ] **Step 2:** `executor.py`:
```python
from typing import Protocol

class SodexExecutor(Protocol):
    def execute_deposit_swap(self, index_id: str, usdc_in: int) -> int:
        """Deploy usdc_in into the index basket; return realized basketValueUsdc."""
    def execute_redeem_swap(self, index_id: str, usdc_target: int) -> int:
        """Sell basket for ~usdc_target; return realized usdcReceived."""

class SimulatedExecutor:
    """Testnet MVP: 1:1 fills (optional fixed slippage bps). No real SoDEX calls."""
    def __init__(self, slippage_bps: int = 0) -> None:
        self.slippage_bps = slippage_bps
    def execute_deposit_swap(self, index_id: str, usdc_in: int) -> int:
        return usdc_in - usdc_in * self.slippage_bps // 10_000
    def execute_redeem_swap(self, index_id: str, usdc_target: int) -> int:
        return usdc_target - usdc_target * self.slippage_bps // 10_000

class LiveSodexExecutor:
    """DEFERRED — wraps agent-service/src/tools/sodex.py once the bridge legs + SoDEX-team
    info land. Raises NotImplementedError so it can't be used by accident."""
    def execute_deposit_swap(self, index_id: str, usdc_in: int) -> int:
        raise NotImplementedError("LiveSodexExecutor: pending SoDEX bridge legs (1b deferred)")
    def execute_redeem_swap(self, index_id: str, usdc_target: int) -> int:
        raise NotImplementedError("LiveSodexExecutor: pending SoDEX bridge legs (1b deferred)")
```
- [ ] **Step 3:** commit `feat(vault-keeper): vault ABIs + SodexExecutor seam (simulated + live stub)`.

---

## Task D: Keeper (`config.py`, `keeper.py`)

**Files:** Create `agent-service/src/vault/config.py`, `agent-service/src/vault/keeper.py`.

- [ ] **Step 1:** `config.py` — read env: `VAULT_RPC_URL` (default `http://127.0.0.1:8545`), `VAULT_ADDRESS`, `VAULT_SIGNER_PRIVATE_KEY`, `VAULT_KEEPER_PRIVATE_KEY`, `VAULT_CHAIN_ID` (int), `VAULT_USDC_ADDRESS`. Provide a `KeeperConfig` dataclass + `from_env()`.

- [ ] **Step 2:** `keeper.py` — `Keeper` class:
  - `__init__(self, cfg, executor, nav_engine, web3=None)` — build `Web3(HTTPProvider(cfg.rpc_url))`, load vault + usdc contracts, keeper + signer accounts, `self._seen: set[int]` for idempotency, `self._last_block`.
  - `_send(self, fn)` — build/sign/send a tx from the keeper account, wait for receipt, raise on status 0.
  - `process_deposit(self, request_id)` — read `pendingDeposits(id)`; `pullForDeposit(id)`; `bval = executor.execute_deposit_swap(idx, usdcIn)`; `total = vaults(idx).totalShares`; `nav, bval2 = nav_engine.quote_deposit(idx, bval, total)`; `signed_at = web3.eth.get_block('latest').timestamp`; `sig = sign_attestation(signer_key, chain, vault, idx, nav, signed_at)`; `settleDeposit(id, nav, bval, signed_at, sig)`; on revert → `cancelDeposit(id, returnedUsdc)`; `nav_engine.on_deposit_settled(...)`.
  - `process_redeem(self, request_id)` — read `pendingRedeems(id)`; `total = vaults(idx).totalShares`; `nav, usdc_out = nav_engine.quote_redeem(idx, shares, total)`; `realized = executor.execute_redeem_swap(idx, usdc_out)`; ensure keeper USDC balance ≥ realized (mint via MockUSDC if test, else require pre-funded); `usdc.approve(vault, realized)`; sign nav; `settleRedeem(id, realized, nav, signed_at, sig)`; `nav_engine.on_redeem_settled(...)`.
  - `poll_once(self)` — scan `DepositRequested`/`RedeemRequested` logs from `_last_block+1` to `latest`, dispatch unseen ids to process_deposit/process_redeem, advance `_last_block`.
  - `accrue(self, index_id)` — `accrueMgmt(idx)`.
- [ ] **Step 3:** commit `feat(vault-keeper): Keeper event-poll + settle orchestration`.

> No standalone unit test for the keeper — it is exercised by the Task E end-to-end test against a real (anvil) chain, which is far more meaningful than mocking web3.

---

## Task E: End-to-end on anvil (`tests/test_e2e_anvil.py`, `scripts/run_vault_demo.py`)

**Files:** Create `agent-service/tests/test_e2e_anvil.py`, `agent-service/scripts/run_vault_demo.py`.

- [ ] **Step 1:** the e2e test (pytest, skipped if `anvil`/`forge` absent):
  - Fixture: start `anvil` (subprocess, `--port 8545 --silent`), wait for RPC; on teardown kill it.
  - Deploy: run `forge create` (or `forge script Deploy.s.sol`) against anvil to deploy `MockUSDC` + `HypeIndexVault` with signer=keeper=guardian=deployer-derived test accounts (use anvil's well-known keys). Capture addresses. (Use the **deployer** anvil account; set `VAULT_SIGNER`/`VAULT_KEEPER` to anvil keys.)
  - Build `Keeper(cfg, SimulatedExecutor(), NavEngine())`.
  - **Cross-language sig check (critical):** sign an attestation in Python and call `vault.functions.verifyNavExposed(idx, nav, signed_at, sig).call()` — must NOT revert (proves the Solidity contract accepts the Python signature).
  - Lifecycle: `openVault(idx, creator)` (as keeper); mint MockUSDC to a subscriber acct; subscriber `approve` + `requestDeposit(idx, 1_000e6, 0)`; `keeper.poll_once()` → assert `positions(idx, subscriber).shares > 0`; subscriber `requestRedeem(idx, shares, 0)`; mint MockUSDC to keeper to fund payout; `keeper.poll_once()` → assert subscriber USDC increased; `keeper.accrue(idx)` after time-warp (`anvil_setTime`/`evm_increaseTime`) → assert `creatorFeeShares > 0`; creator `claimFees(idx)` then `keeper.poll_once()` → creator USDC increased.
- [ ] **Step 2:** run `cd agent-service && python -m pytest tests/test_e2e_anvil.py -q -s` → passes (or skips cleanly if anvil/forge missing — but here they're present, so it must PASS).
- [ ] **Step 3:** `scripts/run_vault_demo.py` — a non-test script that does the same happy path against `VAULT_RPC_URL`, printing each step (for manual/testnet demo).
- [ ] **Step 4:** commit `test(vault-keeper): end-to-end anvil lifecycle + cross-language sig acceptance`.

---

## Task F: Docs + wiring

- [ ] Update `agent-service/README.md` (or create a `agent-service/src/vault/README.md`) documenting: the EOA-keeper model + spike outcome reference, the env vars, how to run the e2e test + demo script, and the DEFERRED items (live SoDEX executor, bridge legs, mainnet). Commit `docs(vault-keeper): run + env docs`.

---

## Self-Review (plan author)
- **Spec coverage:** price-signer (Task B), keeper (Tasks C/D), simulated executor seam (Task C), NAV (Task A), end-to-end + the critical cross-language sig acceptance (Task E). Deferred items explicitly fenced.
- **Verifiability:** the e2e test deploys the REAL contract to anvil and drives it through the REAL keeper — no mocked web3. The Python↔Solidity EIP-712 compatibility (the #1 integration risk) is pinned by `verifyNavExposed`.
- **No placeholders:** NAV + attestation are complete code; ABI/keeper give exact interfaces + the e2e test pins behavior. The one flagged unknown (eth-account 0.13 bytes32 encoding form) is called out with the fix in Task B.
- **Type consistency:** `navPerShare`/`basketValueUsdc` units match the contract (USDC 6dp per WAD shares); `NavEngine` method names used consistently across Tasks A/D/E.
