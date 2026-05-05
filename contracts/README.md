# SSI Registry — deploy guide

Minimal on-chain registry for HypeIndex / SSI publishes. One method, one event,
no upgrade proxy. Source: [SSIRegistry.sol](./SSIRegistry.sol).

## Recommended: deploy via Remix (no toolchain setup)

1. Open https://remix.ethereum.org
2. Create a new file `SSIRegistry.sol` and paste the contents of
   [SSIRegistry.sol](./SSIRegistry.sol).
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
