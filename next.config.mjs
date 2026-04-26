/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  env: {
    AGENT_SERVICE_URL: process.env.AGENT_SERVICE_URL ?? "http://localhost:8001",
  },
};

export default config;
