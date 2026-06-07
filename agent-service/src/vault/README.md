# Vault keeper + price-signer services (Wave 2, sub-project 1b)

Off-chain services that drive the on-chain `HypeIndexVault` (see
`contracts/src/HypeIndexVault.sol` + `docs/superpowers/specs/2026-06-04-hypeindexvault-design.md`).

## Why off-chain (the SoDEX spike, spec §13)

SoDEX exposes **no on-chain router** and **no EIP-1271** path — a smart contract cannot be
the SoDEX signer/counterparty, and traded assets are custodian-backed mirror tokens inside a
SoDEX exchange account keyed to an EOA. So the vault keeps on-chain USDC custody + settlement
accounting, but the trading leg is an **EOA keeper** that executes and reports realized values
back. This is *vault-accounting + trusted-keeper execution*, not trustless custody.

## Modules

| File | Role |
|---|---|
| `attestation.py` | Signs the vault's EIP-712 `PriceAttestation(indexId, navPerShare, signedAt)` — verified accepted by the deployed contract's `verifyNavExposed` in the e2e test. |
| `nav.py` | `NavEngine` — simulated per-index basket NAV ledger (`navPerShare` = USDC-6dp per 1e18 shares). Swap for real SoDEX mark-to-market when the live executor lands. |
| `executor.py` | `SodexExecutor` seam: `SimulatedExecutor` (testnet MVP, 1:1 fills ± slippage bps) and `LiveSodexExecutor` (deferred stub — raises). |
| `abi.py` | `VAULT_ABI` (from the Foundry artifact) + minimal `ERC20_ABI`. |
| `keeper.py` | `Keeper` — polls the vault for pending requests and calls `pullForDeposit`/`settleDeposit`/`cancelDeposit`/`settleRedeem`/`accrueMgmt`; signs NAV via `attestation.py`. |
| `config.py` | `KeeperConfig.from_env()`. |

## Environment

| Var | Default | Purpose |
|---|---|---|
| `VAULT_RPC_URL` | `http://127.0.0.1:8545` | chain RPC (anvil / ValueChain testnet 138565) |
| `VAULT_ADDRESS` | — | deployed `HypeIndexVault` address |
| `VAULT_USDC_ADDRESS` | — | USDC/MockUSDC address |
| `VAULT_CHAIN_ID` | — | EIP-712 domain chainId (must match the deployment) |
| `VAULT_SIGNER_PRIVATE_KEY` | — | NAV price-signer hot key (the address set as the vault `signer`) |
| `VAULT_KEEPER_PRIVATE_KEY` | — | keeper hot key (the vault `keeper`); custodies in-flight USDC + basket. **Keep isolated from the deployer/owner key; HSM/MPC before mainnet.** |
| `SUPABASE_URL` | — | (daemon) PostgREST base for the earnings indexer |
| `SUPABASE_SERVICE_ROLE_KEY` | — | (daemon) service-role key — writes pb_earnings / pb_subscriptions |
| `VAULT_DEPLOY_BLOCK` | `0` | (daemon) block the vault was deployed at — indexer start point |
| `VAULT_CONFIRMATIONS` | `2` | (daemon) blocks behind head before ingesting events |
| `VAULT_POLL_INTERVAL` | `30` | (daemon) seconds between ticks |

## Run

```bash
cd agent-service
.venv/bin/python -m pytest tests/ -q                 # unit + e2e (needs forge/anvil)
.venv/bin/python -m pytest tests/test_e2e_anvil.py -q -s   # full lifecycle on a throwaway anvil
.venv/bin/python scripts/run_vault_demo.py           # one-shot scripted demo vs VAULT_RPC_URL
.venv/bin/python scripts/run_keeper.py               # ALWAYS-ON daemon (the production loop)
```

### `run_keeper.py` — the always-on daemon (`src/vault/daemon.py`)

Each tick: **reconcile vaults** (open a vault for every published index that
isn't active — `openVault` is keeper-only) → **settle** pending deposits/redeems
(`keeper.poll_once`) → **accrue** the daily mgmt fee → **index earnings** from a
persisted block checkpoint into `pb_earnings`/`pb_subscriptions` (idempotent on
`(tx_hash,event_type,proposal_id)`). This is what turns "contract + keeper exist"
into "a deposit actually mints shares and a creator actually earns". Run it as a
long-lived process (systemd / container / PaaS worker) next to a deployed vault.

The e2e test spins up anvil, `forge create`s `MockUSDC` + `HypeIndexVault`, and drives
`openVault → deposit → settle → accrueMgmt → redeem → claimFees` through the real keeper,
asserting the Python signature is accepted on-chain and the fee math reconciles
(1000 USDC → 990.10 subscriber + 9.90 creator after a 1-year 1% mgmt fee).

## Deferred (need SoDEX-team info — spec §13)

- `LiveSodexExecutor` wrapping `src/tools/sodex.py` (real fills).
- `EVM_DEPOSIT`/`EVM_WITHDRAW` bridge legs (move real USDC ↔ SoDEX Spot Account).
- Mainnet chain + canonical USDC, multisig signer, custody hardening (MPC/HSM, per-window caps).
- Keeper robustness: persistent processed-id checkpoint (survives restart), `cancelDeposit`
  failure-path coverage, and event `get_logs` (the MVP scans `nextRequestId` for simplicity).
