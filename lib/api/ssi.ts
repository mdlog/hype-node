// SSI Protocol client.
//
// Two paths:
//   - Browser / user-signed publish: handled by `PublishActions.tsx` via
//     wagmi `useWriteContract` directly. This file is NOT used for that.
//   - Server-side autonomous publish (agent rebalance, server actions): uses
//     the hot key in `SSI_PRIVATE_KEY` + viem to broadcast a real tx.
//
// Default chain is Sepolia (id 11155111). Override via SSI_CHAIN_ID.

import {
  createPublicClient,
  createWalletClient,
  http,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia, mainnet } from "viem/chains";
import { valueChainMainnet, valueChainTestnet } from "@/lib/auth/wagmi";
import { SSI_REGISTRY_ABI } from "@/lib/contracts/ssiRegistryAbi";

const RPC = process.env.SSI_RPC_URL ?? "";
const REGISTRY = (process.env.SSI_REGISTRY_ADDRESS ?? "") as `0x${string}` | "";
const PK = process.env.SSI_PRIVATE_KEY ?? "";
const CHAIN_ID = Number(process.env.SSI_CHAIN_ID ?? sepolia.id);

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
  status: "broadcast" | "confirmed" | "reverted";
  blockNumber?: string;
  gasUsed?: string;
};

function pickChain(id: number) {
  switch (id) {
    case mainnet.id:
      return mainnet;
    case sepolia.id:
      return sepolia;
    case valueChainMainnet.id:
      return valueChainMainnet;
    case valueChainTestnet.id:
      return valueChainTestnet;
    default:
      return { ...sepolia, id };
  }
}

function assertConfigured(): {
  registry: `0x${string}`;
  pk: Hex;
} {
  if (!REGISTRY) {
    throw new Error(
      "SSI_REGISTRY_ADDRESS not set. Deploy contracts/SSIRegistry.sol and set the address in .env",
    );
  }
  if (!PK) {
    throw new Error(
      "SSI_PRIVATE_KEY not set. Server-side publish needs a hot key with funds on the target chain.",
    );
  }
  const pk = (PK.startsWith("0x") ? PK : `0x${PK}`) as Hex;
  return { registry: REGISTRY as `0x${string}`, pk };
}

function toContractArgs(spec: IndexSpec) {
  const total = Object.values(spec.weights).reduce((a, b) => a + b, 0);
  if (Math.abs(total - 1) > 0.01) {
    throw new Error(`SSI weights must sum to 1.0, got ${total.toFixed(3)}`);
  }
  const entries = Object.entries(spec.weights);
  const tokens = entries.map(([sym]) => sym);
  const weightsBps = entries.map(([, w]) => Math.round(w * 10_000));
  let sum = weightsBps.reduce((a, b) => a + b, 0);
  if (sum !== 10_000 && weightsBps.length > 0) {
    let maxIdx = 0;
    for (let i = 1; i < weightsBps.length; i++) {
      if (weightsBps[i] > weightsBps[maxIdx]) maxIdx = i;
    }
    weightsBps[maxIdx] += 10_000 - sum;
  }
  return [
    spec.symbol,
    spec.name,
    spec.base,
    tokens,
    weightsBps,
    spec.managementFeeBps ?? 0,
    spec.performanceFeeBps ?? 0,
    spec.rebalanceCron ?? "",
  ] as const;
}

export async function wrapIndex(spec: IndexSpec): Promise<WrapResult> {
  const { registry, pk } = assertConfigured();
  const chain = pickChain(CHAIN_ID);
  const account = privateKeyToAccount(pk);
  const transport = RPC ? http(RPC) : http();

  const wallet = createWalletClient({ account, chain, transport });
  const publicClient = createPublicClient({ chain, transport });

  const args = toContractArgs(spec);
  const txHash = await wallet.writeContract({
    address: registry,
    abi: SSI_REGISTRY_ABI,
    functionName: "registerIndex",
    args,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

  return {
    txHash,
    rpc: RPC || (chain.rpcUrls.default.http[0] ?? ""),
    registry,
    symbol: spec.symbol,
    status: receipt.status === "success" ? "confirmed" : "reverted",
    blockNumber: receipt.blockNumber.toString(),
    gasUsed: receipt.gasUsed.toString(),
  };
}

export async function publishProposal(
  spec: IndexSpec & { creator: string },
): Promise<WrapResult> {
  return wrapIndex(spec);
}

// Unwrap is not implemented on-chain in the minimal registry. Surface a
// loud error rather than a silent fake — wire this when the registry adds a
// burn / deregister method.
export async function unwrapIndex(_symbol: string, _amount: number): Promise<WrapResult> {
  throw new Error(
    "unwrapIndex not implemented: SSIRegistry.sol has no burn method yet",
  );
}
