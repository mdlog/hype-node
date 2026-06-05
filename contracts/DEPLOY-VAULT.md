# HypeIndexVault — Deploy + Keeper Runbook

Follow these steps to go live on ValueChain Testnet (chainId 138565).
Until step 4 is done the frontend shows an honest "Vault not deployed yet" fallback.

---

## Prerequisites

| Variable | Description |
|---|---|
| `DEPLOYER_PK` | Hex private key of the deployer wallet. Must hold VAL for gas on ValueChain testnet. |
| `VAULT_SIGNER` | Address whose private key signs NAV attestations (price oracle). |
| `VAULT_KEEPER` | Address that will call `openVault`, `settleDeposit`, `settleRedeem`, `pullForDeposit`. |
| `VAULT_GUARDIAN` | Address that can call `pause` in an emergency. |
| `SSI_RPC_URL` | A reachable ValueChain testnet RPC endpoint (`chainId 138565`). Public endpoint: `https://testnet-rpc.valuechain.io`. |

Export them in your shell (or put them in a local `.env` — never commit them):

```bash
export DEPLOYER_PK=<hex, no 0x needed>
export VAULT_SIGNER=<address>
export VAULT_KEEPER=<address>
export VAULT_GUARDIAN=<address>
export SSI_RPC_URL=https://testnet-rpc.valuechain.io
```

---

## Step 1 — Build the contracts

```bash
cd contracts
forge build
```

Expected: compilation succeeds, `out/HypeIndexVault.sol/HypeIndexVault.json` is fresh.

---

## Step 2 — Deploy MockUSDC + HypeIndexVault

```bash
forge script script/Deploy.s.sol \
  --rpc-url "$SSI_RPC_URL" \
  --private-key "$DEPLOYER_PK" \
  --broadcast \
  -vvv
```

The script prints two lines on success:

```
MockUSDC: 0xABC...
HypeIndexVault: 0xDEF...
```

Note both addresses. If you already have a canonical USDC on the chain, set `USDC_ADDRESS=<addr>` before running — the script skips `MockUSDC` deployment and uses it directly.

---

## Step 3 — Configure the frontend

Open root `.env` (gitignored) and fill in the deployed addresses:

```
NEXT_PUBLIC_HYPE_VAULT_ADDRESS=0xDEF...   # HypeIndexVault address
NEXT_PUBLIC_USDC_ADDRESS=0xABC...         # MockUSDC (or canonical USDC) address
```

Redeploy / restart the frontend (`npm run dev` or push to your hosting provider).

Verification: open `/discover/<any-published-id>` — the SUBSCRIBE card should now show the amount input and Subscribe button instead of the fallback.

---

## Step 4 — Open vaults for published indices

Before users can subscribe to a specific index, the keeper must call `openVault(indexId, creatorAddress)`:

```bash
# Using cast (part of Foundry):
cast send \
  --rpc-url "$SSI_RPC_URL" \
  --private-key "$VAULT_KEEPER_PK" \
  "$NEXT_PUBLIC_HYPE_VAULT_ADDRESS" \
  "openVault(bytes32,address)" \
  "<on_chain_index_id from pb_proposals>" \
  "<creator_address>"
```

`indexId` = the `on_chain_index_id` stored in the `pb_proposals` row (a `bytes32` hex string).
`creator` = the `creator_address` from the same row.

Without this call, `requestDeposit` reverts with `VaultInactive()`.

---

## Step 5 — Verify end-to-end

1. Connect a wallet funded with MockUSDC on ValueChain testnet.
2. Open `/discover/<id>` for a published index that has been `openVault`'d.
3. Enter ≥ 100 USDC and click **Subscribe**.
4. The wallet prompts for `approve` (USDC → vault), then `requestDeposit`.
5. On success the page shows "Deposit requested — shares mint after keeper settlement".
6. Check the transaction on [ValueChain Testnet Explorer](https://testnet-explorer.valuechain.io) — you should see a `DepositRequested` event.
7. After the keeper calls `settleDeposit(id, navPerShare, basketValueUsdc, signedAt, sig)`, a `Subscribed` event fires and shares are minted to the user's `positions[indexId][user]`.

---

## Out of scope (keeper / NAV-signer infra)

The keeper and NAV-signer services (`pullForDeposit`, `settleDeposit`, `settleRedeem`, `accrueMgmt`, signed NAV attestations) are part of the Wave 2 backend sprint and are NOT covered here. Until they run, deposits stay in `pendingDeposits` state.
