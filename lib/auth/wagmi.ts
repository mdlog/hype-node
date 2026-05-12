// Wagmi config — wired through Privy's wagmi adapter so embedded wallets
// (created on email / Google / Twitter login) and externally-injected
// wallets (MetaMask, Rabby, WalletConnect) both surface through the same
// wagmi hooks (`useAccount`, `useSignMessage`, `useWriteContract`, …).
//
// Migration note: previously this file used RainbowKit's `getDefaultConfig`
// which bundled wallet UI + WalletConnect + transports in one call. Privy
// provides the connect UI itself, so we use plain wagmi `createConfig`
// (re-exported by `@privy-io/wagmi` so the connector list matches the
// adapter) and explicit `http()` transports per chain.

import { createConfig } from "@privy-io/wagmi";
import { http } from "wagmi";
import { mainnet, sepolia } from "wagmi/chains";

import { valueChainMainnet, valueChainTestnet } from "@/lib/chains";

export { valueChainMainnet, valueChainTestnet };

// Globalthis memoization. Without this, Next.js dev HMR + React Strict
// Mode + the route-group layout's <Providers> mounting twice causes
// `createConfig` to fire on every re-import → registers a new wagmi
// connector core every time. Persisting on globalThis keeps the SAME
// instance across HMR boundaries so re-imports reuse it.
type StashedConfig = {
  config: ReturnType<typeof buildConfig>;
};
const G = globalThis as unknown as { __hypeWagmi?: StashedConfig };

function buildConfig() {
  return createConfig({
    chains: [mainnet, sepolia, valueChainMainnet, valueChainTestnet],
    transports: {
      [mainnet.id]: http(),
      [sepolia.id]: http(),
      [valueChainMainnet.id]: http(),
      [valueChainTestnet.id]: http(),
    },
    ssr: true,
  });
}

if (!G.__hypeWagmi) {
  G.__hypeWagmi = { config: buildConfig() };
}

// SSI publish lands on Sepolia by default (see contracts/SSIRegistry.sol +
// NEXT_PUBLIC_SSI_CHAIN_ID). SoDEX execute targets ValueChain. Both are
// reachable from the same wagmi config; PublishActions / SoDEX clients pick
// the chain explicitly via `chainId` on the write call.
export const wagmiConfig = G.__hypeWagmi.config;
