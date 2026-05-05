import { defineChain } from "viem";

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
