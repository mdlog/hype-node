"use client";

import { useAccount, useBalance } from "wagmi";
import { Card, Label, Metric, Mono } from "@/components/ui";
import { tokens } from "@/lib/tokens";

const CHAIN_LABEL: Record<number, string> = {
  1: "Ethereum",
  10: "Optimism",
  42161: "Arbitrum",
  8453: "Base",
  137: "Polygon",
  56: "BNB Smart Chain",
  43114: "Avalanche",
  286623: "ValueChain",
  138565: "ValueChain Testnet",
};

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function fmtBalance(value: bigint, decimals: number, digits = 4): string {
  const whole = value / 10n ** BigInt(decimals);
  const frac = value % 10n ** BigInt(decimals);
  const fracStr = frac.toString().padStart(decimals, "0").slice(0, digits);
  return `${whole}.${fracStr}`;
}

/**
 * Full-card wallet balance view used by the earnings page. Pure on-chain RPC
 * read via wagmi `useBalance` — no fake numbers, no SoSoValue dependency.
 */
export function WalletBalanceCard() {
  const { address, chainId, isConnected } = useAccount();
  const { data, isLoading } = useBalance({ address });

  if (!isConnected || !address) {
    return (
      <Card pad={14}>
        <Label>WALLET</Label>
        <Metric v="—" size={24} color={tokens.textFaint} style={{ marginTop: 6 }} />
        <Mono size={11} className="mt-1 block" color={tokens.textFaint}>
          connect wallet to view native balance
        </Mono>
      </Card>
    );
  }

  const balance =
    data && typeof data.value === "bigint" && typeof data.decimals === "number"
      ? `${fmtBalance(data.value, data.decimals)} ${data.symbol}`
      : isLoading
        ? "loading…"
        : "—";

  return (
    <Card pad={14}>
      <Label>WALLET (ON-CHAIN)</Label>
      <Metric
        v={balance}
        size={24}
        color={data ? tokens.text : tokens.textFaint}
        style={{ marginTop: 6 }}
      />
      <Mono size={11} className="mt-1 block">
        {shortAddr(address)} · {CHAIN_LABEL[chainId ?? 0] ?? `chain ${chainId}`}
      </Mono>
    </Card>
  );
}
