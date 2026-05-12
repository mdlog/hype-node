"use client";

// Provider stack — Privy on the outside, wagmi inside via Privy's adapter.
//
// Order matters: PrivyProvider needs to mount before WagmiProvider so the
// wagmi connector list (including the embedded-wallet connector) can read
// Privy's session on first render. QueryClient sits between them — wagmi
// hooks consume it for its built-in cache (e.g. useBalance).
//
// Login methods are configured here once and surface in the modal that
// usePrivy().login() opens. Email / Google / Twitter logins automatically
// create an embedded EOA so SIWE signing still works the same way it
// does for users with MetaMask / Rabby / WalletConnect.

import { PrivyProvider } from "@privy-io/react-auth";
import { WagmiProvider } from "@privy-io/wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { mainnet, sepolia } from "wagmi/chains";

import { wagmiConfig, valueChainMainnet, valueChainTestnet } from "@/lib/auth/wagmi";

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  if (!PRIVY_APP_ID && typeof window !== "undefined") {
    // Surface a single warning so missing env doesn't manifest as a
    // confusing "PrivyProvider failed to initialise" runtime error.
    if (!(globalThis as { __hypePrivyWarned?: boolean }).__hypePrivyWarned) {
      (globalThis as { __hypePrivyWarned?: boolean }).__hypePrivyWarned = true;
      // eslint-disable-next-line no-console
      console.warn(
        "[privy] NEXT_PUBLIC_PRIVY_APP_ID is not set. Login UI will not " +
          "render. Get an app id at https://dashboard.privy.io and put it in " +
          ".env.local.",
      );
    }
  }

  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ["email", "wallet", "google", "twitter"],
        // Auto-create an embedded EOA for users who log in via email /
        // Google / Twitter so the SIWE signing flow has an address to
        // work with. Existing wallet users (MetaMask, etc.) get nothing
        // extra. The embeddedWallets config is nested per chain family
        // (Privy v3 split EVM ↔ Solana so the EVM-only setting lives
        // under `ethereum`).
        embeddedWallets: {
          ethereum: {
            createOnLogin: "users-without-wallets",
          },
        },
        appearance: {
          theme: "dark",
          accentColor: "#10B981",
          logo: "/logo-hypenode.png",
          showWalletLoginFirst: false,
        },
        defaultChain: mainnet,
        supportedChains: [
          mainnet,
          sepolia,
          valueChainMainnet,
          valueChainTestnet,
        ],
      }}
    >
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={wagmiConfig}>{children}</WagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  );
}
