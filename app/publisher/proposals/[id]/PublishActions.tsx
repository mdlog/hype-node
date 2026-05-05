"use client";

import { useEffect, useMemo, useState } from "react";
import {
  useAccount,
  useChainId,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { sepolia } from "wagmi/chains";
import { Btn, Mono, Tag } from "@/components/ui";
import { tokens } from "@/lib/tokens";
import type { IndexSpec } from "@/lib/api/ssi";
import { SSI_REGISTRY_ABI } from "@/lib/contracts/ssiRegistryAbi";

type Props = {
  spec: IndexSpec;
};

const REGISTRY_ADDRESS = process.env.NEXT_PUBLIC_SSI_REGISTRY_ADDRESS as
  | `0x${string}`
  | undefined;
const TARGET_CHAIN_ID = Number(
  process.env.NEXT_PUBLIC_SSI_CHAIN_ID ?? sepolia.id,
);

// Convert the IndexSpec.weights map (symbol -> 0..1) into the parallel
// arrays the contract expects. We round to basis points and absorb any
// rounding drift into the largest weight so the on-chain check
// (sum == 10_000) always passes.
function toContractArgs(spec: IndexSpec): readonly [
  string,
  string,
  string,
  readonly string[],
  readonly number[],
  number,
  number,
  string,
] {
  const entries = Object.entries(spec.weights);
  const tokens_ = entries.map(([sym]) => sym);
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
    tokens_,
    weightsBps,
    spec.managementFeeBps ?? 0,
    spec.performanceFeeBps ?? 0,
    spec.rebalanceCron ?? "",
  ] as const;
}

function explorerTxUrl(chainId: number, hash: string): string | null {
  if (chainId === sepolia.id) return `https://sepolia.etherscan.io/tx/${hash}`;
  if (chainId === 1) return `https://etherscan.io/tx/${hash}`;
  if (chainId === 286623) return `https://explorer.valuechain.io/tx/${hash}`;
  if (chainId === 138565) return `https://testnet-explorer.valuechain.io/tx/${hash}`;
  return null;
}

export function PublishActions({ spec }: Props) {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync, isPending: switching } = useSwitchChain();
  const {
    writeContractAsync,
    data: txHash,
    isPending: signing,
    error: writeError,
    reset,
  } = useWriteContract();
  const {
    data: receipt,
    isLoading: confirming,
    error: receiptError,
  } = useWaitForTransactionReceipt({ hash: txHash });

  const [localError, setLocalError] = useState<string | null>(null);

  const args = useMemo(() => {
    try {
      return toContractArgs(spec);
    } catch (err) {
      return (err as Error).message;
    }
  }, [spec]);

  const argsValid = Array.isArray(args);
  const wrongChain = isConnected && chainId !== TARGET_CHAIN_ID;
  const configured = !!REGISTRY_ADDRESS;

  async function publish() {
    setLocalError(null);
    reset();
    if (!configured) {
      setLocalError(
        "SSI registry not configured. Set NEXT_PUBLIC_SSI_REGISTRY_ADDRESS in .env.",
      );
      return;
    }
    if (!argsValid) {
      setLocalError(args as string);
      return;
    }
    try {
      if (wrongChain) {
        await switchChainAsync({ chainId: TARGET_CHAIN_ID });
      }
      await writeContractAsync({
        address: REGISTRY_ADDRESS as `0x${string}`,
        abi: SSI_REGISTRY_ABI,
        functionName: "registerIndex",
        args: args as ReturnType<typeof toContractArgs>,
        chainId: TARGET_CHAIN_ID,
      });
    } catch (err) {
      const e = err as { shortMessage?: string; message?: string };
      setLocalError(e.shortMessage ?? e.message ?? String(err));
    }
  }

  // Clear local validation errors when spec changes
  useEffect(() => setLocalError(null), [spec]);

  const submitting = signing || switching || confirming;
  const confirmed = receipt?.status === "success";
  const failed =
    receipt?.status === "reverted" ||
    !!writeError ||
    !!receiptError ||
    !!localError;
  const locked = submitting || confirmed;
  const explorer = txHash ? explorerTxUrl(TARGET_CHAIN_ID, txHash) : null;

  const buttonLabel = !isConnected
    ? "Connect wallet to publish"
    : !configured
      ? "Registry not configured"
      : confirmed
        ? "✓ Published on-chain"
        : confirming
          ? "Waiting for confirmation…"
          : signing
            ? "Confirm in wallet…"
            : switching
              ? "Switching chain…"
              : wrongChain
                ? "Switch chain & publish"
                : "✓ Sign & Publish to SSI";

  return (
    <div className="flex flex-col gap-1.5">
      <Btn
        primary
        onClick={publish}
        disabled={locked || !isConnected || !configured || !argsValid}
        style={{
          justifyContent: "center",
          padding: "10px 16px",
          fontSize: 13,
          opacity: locked ? 0.7 : 1,
          cursor: locked ? "default" : "pointer",
        }}
      >
        {buttonLabel}
      </Btn>
      <Btn small style={{ justifyContent: "center" }} disabled={locked}>
        Edit weights
      </Btn>
      <Btn
        small
        style={{ justifyContent: "center", color: tokens.textDim }}
        disabled={locked}
      >
        Reject proposal
      </Btn>

      {(txHash || confirmed) && (
        <div
          style={{
            marginTop: 6,
            padding: 10,
            background: tokens.emerald + "10",
            border: `1px solid ${tokens.emerald}40`,
            borderRadius: 6,
          }}
        >
          <Tag small color={tokens.emerald} dot>
            {confirmed ? "confirmed" : confirming ? "pending" : "broadcast"}
          </Tag>
          <Mono size={10} color={tokens.textFaint} className="mt-1.5 block">
            tx
          </Mono>
          {explorer ? (
            <a
              href={explorer}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: tokens.cyan, wordBreak: "break-all" }}
            >
              <Mono size={10.5}>{txHash}</Mono>
            </a>
          ) : (
            <Mono
              size={10.5}
              color={tokens.text}
              style={{ wordBreak: "break-all" }}
            >
              {txHash}
            </Mono>
          )}
          {confirmed && receipt && (
            <Mono size={9.5} color={tokens.textFaint} className="mt-1.5 block">
              block #{receipt.blockNumber.toString()} · gas{" "}
              {receipt.gasUsed.toString()}
            </Mono>
          )}
          {REGISTRY_ADDRESS && (
            <Mono size={9.5} color={tokens.textFaint} className="mt-1.5 block">
              registry {REGISTRY_ADDRESS.slice(0, 10)}…
              {REGISTRY_ADDRESS.slice(-6)}
            </Mono>
          )}
        </div>
      )}

      {failed && (
        <div
          style={{
            marginTop: 6,
            padding: 10,
            background: tokens.red + "10",
            border: `1px solid ${tokens.red}40`,
            borderRadius: 6,
          }}
        >
          <Tag small color={tokens.red} dot>
            publish failed
          </Tag>
          <Mono
            size={10.5}
            color={tokens.text}
            className="mt-1.5 block"
            style={{ wordBreak: "break-word" }}
          >
            {localError ??
              (writeError as Error | undefined)?.message ??
              (receiptError as Error | undefined)?.message ??
              "transaction reverted"}
          </Mono>
        </div>
      )}
    </div>
  );
}
