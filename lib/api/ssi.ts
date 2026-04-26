// SSI Protocol client (ValueChain L1).
// Stub for now — real implementation will call the SSI registry contract via
// viem/ethers. Returns canned tx hashes so the UI can show realistic state.

const RPC = process.env.SSI_RPC_URL ?? "https://rpc.valuechain.io";
const REGISTRY = process.env.SSI_REGISTRY_ADDRESS ?? "0x0000000000000000000000000000000000000000";

export type IndexSpec = {
  symbol: string;
  name: string;
  base: "USDC";
  weights: Record<string, number>;
  rebalanceCron?: string;
  managementFeeBps?: number;
  performanceFeeBps?: number;
};

export type WrapResult = {
  txHash: string;
  rpc: string;
  registry: string;
  symbol: string;
  status: "broadcast" | "confirmed";
};

function fakeTx(): string {
  const hex = Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  return `0x${hex}`;
}

export async function wrapIndex(spec: IndexSpec): Promise<WrapResult> {
  const total = Object.values(spec.weights).reduce((a, b) => a + b, 0);
  if (Math.abs(total - 1) > 0.01) {
    throw new Error(`SSI weights must sum to 1.0, got ${total.toFixed(3)}`);
  }
  return {
    txHash: fakeTx(),
    rpc: RPC,
    registry: REGISTRY,
    symbol: spec.symbol,
    status: "confirmed",
  };
}

export async function unwrapIndex(symbol: string, amount: number): Promise<WrapResult> {
  return {
    txHash: fakeTx(),
    rpc: RPC,
    registry: REGISTRY,
    symbol,
    status: "confirmed",
  };
}

export async function publishProposal(spec: IndexSpec & { creator: string }): Promise<WrapResult> {
  return wrapIndex(spec);
}
