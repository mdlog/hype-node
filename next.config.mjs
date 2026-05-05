/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  env: {
    AGENT_SERVICE_URL: process.env.AGENT_SERVICE_URL ?? "http://localhost:8001",
  },
  // Silence the optional peer-deps that wagmi/@metamask/sdk and pino try to
  // resolve in the browser bundle. We don't run on React Native (no
  // async-storage) and pino-pretty is dev-only on Node — webpack should
  // treat these as resolved-empty rather than emitting a "Module not found"
  // warning on every request.
  webpack: (cfg) => {
    cfg.resolve = cfg.resolve ?? {};
    cfg.resolve.fallback = {
      ...(cfg.resolve.fallback ?? {}),
      "@react-native-async-storage/async-storage": false,
      "pino-pretty": false,
    };
    return cfg;
  },
};

export default config;
