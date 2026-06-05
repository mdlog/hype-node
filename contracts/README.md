# SSI Registry — deploy guide

Minimal on-chain registry for HypeIndex / SSI publishes. One method, one event,
no upgrade proxy. Source: [SSIRegistry.sol](./src/SSIRegistry.sol).

## Recommended: deploy via Remix (no toolchain setup)

1. Open https://remix.ethereum.org
2. Create a new file `SSIRegistry.sol` and paste the contents of
   [SSIRegistry.sol](./src/SSIRegistry.sol).
3. **Solidity Compiler** tab → compiler version `0.8.24` (or any 0.8.x ≥ 0.8.4)
   → click **Compile SSIRegistry.sol**.
4. **Deploy & Run Transactions** tab:
   - Environment: **Injected Provider — MetaMask**
   - Make sure MetaMask is on **Sepolia** (or whichever chain you want — see
     "Picking a chain" below).
   - Make sure the deployer wallet has gas (Sepolia faucet: https://sepoliafaucet.com).
   - Contract: **SSIRegistry**
   - Click **Deploy**, confirm in MetaMask.
5. Once mined, copy the deployed address from Remix's "Deployed Contracts"
   panel.

## Wire the address into the app

Add to `.env` (and restart `next dev`):

```env
# Server-side publish (agent autonomous flow)
SSI_CHAIN_ID=11155111
SSI_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/<YOUR_KEY>   # optional; falls back to public RPC
SSI_REGISTRY_ADDRESS=0x<deployed_address>
SSI_PRIVATE_KEY=0x<hot_key_with_sepolia_eth>

# Browser publish ("Sign & Publish to SSI" button)
NEXT_PUBLIC_SSI_CHAIN_ID=11155111
NEXT_PUBLIC_SSI_REGISTRY_ADDRESS=0x<deployed_address>
```

The `NEXT_PUBLIC_*` variants are required because Next.js only exposes env
variables prefixed with `NEXT_PUBLIC_` to client components.

## Verify it works

1. `npm run dev` and open a proposal page.
2. Connect wallet (must have Sepolia ETH).
3. Click **✓ Sign & Publish to SSI**.
4. MetaMask pops up with a `registerIndex(...)` call. Confirm.
5. UI shows the real tx hash linked to https://sepolia.etherscan.io.
6. Open the link — the transaction is real and the `IndexRegistered` event
   shows up in the receipt logs.

## Picking a chain

| Chain | id | Use case |
| --- | --- | --- |
| Sepolia | `11155111` | Default. Free testnet ETH. |
| Ethereum mainnet | `1` | Production with real gas. |
| ValueChain mainnet | `286623` | Co-locate with SoDEX execute. |
| ValueChain testnet | `138565` | Co-locate with SoDEX testnet. |

Any chain you pick must be added to `wagmiConfig` (`lib/auth/wagmi.ts`); the
four above are already wired.

## What gets stored on-chain

Per index:
- `creator`, `createdAt`
- `symbol`, `name`, `base` ("USDC")
- `tokens[]` (constituent symbol strings)
- `weightsBps[]` (basis points, sum **must** equal `10000`)
- `mgmtFeeBps`, `perfFeeBps`
- `rebalanceCron` (string, optional)

Indexed event: `IndexRegistered(bytes32 indexed id, address indexed creator, string symbol, string name)`.
The id is `keccak256(symbol)` — re-publishing the same symbol reverts with
`IndexAlreadyExists`.

---

# HypeIndexVault (Foundry)

ERC-4626-style vault that accepts USDC deposits, tracks per-epoch NAV snapshots,
and enforces role-based access for rebalance keepers, signers, and a guardian.
Source: [`src/HypeIndexVault.sol`](./src/HypeIndexVault.sol).

## Prerequisites — install dependencies after clone

`contracts/lib/` is gitignored. After cloning, install from inside the `contracts/`
directory:

```bash
cd contracts
forge install OpenZeppelin/openzeppelin-contracts@v5.1.0
# forge-std is pulled automatically by `forge init` / `forge install`
```

## Build and test

```bash
cd contracts
forge build
forge test -vv
forge coverage --match-contract HypeIndexVault --ir-minimum
```

All 42 tests should pass. The suite covers deposits, withdrawals, NAV snapshots,
fee accounting, rebalance flows, access-control reverts, and guardian pause.

## Deploy to ValueChain testnet (chain ID 138565)

Set the required environment variables, then broadcast:

```bash
export DEPLOYER_PK=0x<your_private_key>
export VAULT_SIGNER=0x<signer_address>
export VAULT_KEEPER=0x<keeper_address>
export VAULT_GUARDIAN=0x<guardian_address>
# USDC_ADDRESS is optional on testnet — omit it and a MockUSDC is auto-deployed
# export USDC_ADDRESS=0x<canonical_usdc>

forge script script/Deploy.s.sol \
  --rpc-url https://testnet-rpc.valuechain.io \
  --broadcast
```

The script prints two addresses on success:

```
MockUSDC: 0x...
HypeIndexVault: 0x...
```

## Wire addresses into `.env`

Add the printed addresses alongside the existing SSI / Next.js vars:

```env
# HypeIndexVault
HYPE_VAULT_ADDRESS=0x<deployed_vault>
USDC_ADDRESS=0x<deployed_or_canonical_usdc>

# (existing SSI vars remain unchanged)
SSI_REGISTRY_ADDRESS=0x<ssi_address>
NEXT_PUBLIC_SSI_REGISTRY_ADDRESS=0x<ssi_address>
```

Restart `next dev` after editing `.env`.

## Mainnet (chain ID 286623) — open items before deploy

Before deploying to ValueChain mainnet, address the following:

- **Canonical USDC address**: verify the correct USDC contract address and
  confirm liquidity on ValueChain mainnet. Set `USDC_ADDRESS` to that address
  (do **not** deploy `MockUSDC` on mainnet).
- **Multisig roles**: use a multisig (e.g. Safe) for `VAULT_SIGNER` and
  `VAULT_GUARDIAN` instead of an EOA.
- **Remove test-only views**: strip all `*Exposed` view functions from
  `HypeIndexVault.sol` before the mainnet build — these exist solely to support
  the Foundry test suite and must not ship to production.
- Use the same `forge script` command above but with the mainnet RPC and the
  `USDC_ADDRESS` env var set.
