/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  env: {
    AGENT_SERVICE_URL: process.env.AGENT_SERVICE_URL ?? "http://localhost:8001",
  },
  // Don't fail production builds on lint warnings/errors. After the Privy
  // migration the @typescript-eslint plugin was pruned from the parent
  // node_modules, which made all `eslint-disable @typescript-eslint/...`
  // comments fail with "rule definition not found". Lint is still
  // available manually via `npm run lint` — the build just doesn't gate
  // on it. Re-enable once @typescript-eslint is restored as a real dev
  // dep on the Sosovalue/ root package.json.
  eslint: {
    ignoreDuringBuilds: true,
  },
  // Silence optional peer-deps that wagmi/@metamask/sdk, pino, and Privy
  // try to resolve in the browser bundle. We don't run on React Native
  // (no async-storage), don't ship Solana / Farcaster mini-app surfaces,
  // and pino-pretty is dev-only on Node — webpack should treat these as
  // resolved-empty rather than emitting a "Module not found" error.
  // Privy's bundle imports ~10 such optional adapters under conditional
  // code paths; listing them here keeps the compiled bundle clean.
  webpack: (cfg) => {
    cfg.resolve = cfg.resolve ?? {};
    cfg.resolve.fallback = {
      ...(cfg.resolve.fallback ?? {}),
      "@react-native-async-storage/async-storage": false,
      "pino-pretty": false,
      // Privy optional adapters — declared as `import()` inside the
      // bundle so webpack tries to resolve them even though our login
      // methods (email / google / twitter / wallet) never reach them.
      "@farcaster/mini-app-solana": false,
      "@farcaster/miniapp-wagmi-connector": false,
      "@solana/web3.js": false,
      "@solana/wallet-adapter-base": false,
      "@solana/wallet-adapter-wallets": false,
      "@solana-mobile/mobile-wallet-adapter-protocol": false,
      "@solana-mobile/wallet-adapter-mobile": false,
      "@particle-network/aa": false,
      "@coinbase/wallet-mobile-sdk": false,
      "@coinbase/wallet-sdk": false,
      // Privy ships an isows webcompat shim that has its own optional
      // ws import on the Node side.
      bufferutil: false,
      "utf-8-validate": false,
    };
    return cfg;
  },
};

export default config;
