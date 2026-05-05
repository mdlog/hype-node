import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { mainnet, sepolia } from "wagmi/chains";
import { defineChain } from "viem";

// SoDEX runs on ValueChain L1. We define both nets so wagmi can prompt the
// user to switch when the SoDEX execute path triggers a typed-data signature.
export const valueChainMainnet = defineChain({
  id: 286623,
  name: "ValueChain",
  nativeCurrency: { name: "VAL", symbol: "VAL", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.valuechain.io"] },
  },
  blockExplorers: {
    default: { name: "ValueChain Explorer", url: "https://explorer.valuechain.io" },
  },
});

export const valueChainTestnet = defineChain({
  id: 138565,
  name: "ValueChain Testnet",
  nativeCurrency: { name: "VAL", symbol: "VAL", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://testnet-rpc.valuechain.io"] },
  },
  blockExplorers: {
    default: { name: "ValueChain Testnet Explorer", url: "https://testnet-explorer.valuechain.io" },
  },
  testnet: true,
});

const PLACEHOLDER_PROJECT_ID = "YOUR_WALLETCONNECT_PROJECT_ID";
const projectId =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? PLACEHOLDER_PROJECT_ID;

// Globalthis memoization. Without this, Next.js dev HMR + React Strict Mode
// + the route-group layout's <Providers> mounting twice causes
// `getDefaultConfig` to fire on every re-import → registers a new
// WalletConnect Core instance every time → "Init() called N times" warning
// where N grows unboundedly across edits. Persisting on globalThis keeps the
// SAME instance across HMR boundaries so re-imports reuse it.
//
// We also stash the projectId we built with so an env change after first
// load forces a fresh config (instead of silently sticking with the stale
// placeholder).
type StashedConfig = {
  projectId: string;
  config: ReturnType<typeof getDefaultConfig>;
};
const G = globalThis as unknown as { __hypeWagmi?: StashedConfig };

function buildConfig(): ReturnType<typeof getDefaultConfig> {
  if (
    typeof window !== "undefined" &&
    projectId === PLACEHOLDER_PROJECT_ID &&
    !(globalThis as { __hypeWagmiWarned?: boolean }).__hypeWagmiWarned
  ) {
    // One-shot warning per page load. WalletConnect / Reown will return 403
    // on every connector init with this placeholder id — surface it here so
    // the developer knows the cause without having to grep the console.
    (globalThis as { __hypeWagmiWarned?: boolean }).__hypeWagmiWarned = true;
    // eslint-disable-next-line no-console
    console.warn(
      "[wagmi] NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is still the placeholder " +
        "value. WalletConnect / mobile pairing will not work; browser-injected " +
        "wallets (MetaMask, Rabby) will still connect normally. " +
        "Get a free project id at https://cloud.reown.com to silence the 403s.",
    );
  }
  return getDefaultConfig({
    appName: "HypeNode",
    projectId,
    chains: [mainnet, sepolia, valueChainMainnet, valueChainTestnet],
    ssr: true,
  });
}

if (!G.__hypeWagmi || G.__hypeWagmi.projectId !== projectId) {
  G.__hypeWagmi = { projectId, config: buildConfig() };
}

// SSI publish lands on Sepolia by default (see contracts/SSIRegistry.sol +
// NEXT_PUBLIC_SSI_CHAIN_ID). SoDEX execute targets ValueChain. Both are
// reachable from the same wagmi config; PublishActions / SoDEX clients pick
// the chain explicitly via `chainId` on the write call.
export const wagmiConfig = G.__hypeWagmi.config;
