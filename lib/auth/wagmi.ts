import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { mainnet, sepolia } from "wagmi/chains";

// Identity-only config: we use the wallet to sign SIWE messages, the
// chain choice here only affects which network shows up in RainbowKit's
// modal. On-chain trades (SSI Protocol / SoDEX) target ValueChain L1 and
// will be wired into a separate transactor when that contract layer
// lands — keeping the auth surface narrow until then.

const projectId =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "YOUR_WALLETCONNECT_PROJECT_ID";

export const wagmiConfig = getDefaultConfig({
  appName: "HypeNode",
  projectId,
  chains: [mainnet, sepolia],
  ssr: true,
});
