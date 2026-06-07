"use client";

// Subscriber exit. Reads the caller's vault position and lets them request a
// redeem of 25/50/100% of their shares. Shares are internal + non-transferable,
// so no ERC-20 approval is needed — just requestRedeem on the vault. USDC is
// returned after the keeper settles the redeem (async, like deposits).
//
// Self-hides (renders nothing) for non-holders, demo sessions, or when the
// vault/index isn't on-chain yet — so it only appears for real holders.

import { useCallback, useState } from "react";
import { formatUnits } from "viem";
import {
  useAccount,
  useChainId,
  useReadContract,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";

import { Card, Label, Mono, Btn } from "@/components/ui";
import { tokens } from "@/lib/tokens";
import { HYPE_INDEX_VAULT_ABI } from "@/lib/contracts/hypeIndexVaultAbi";

const VAULT_ADDRESS = process.env.NEXT_PUBLIC_HYPE_VAULT_ADDRESS as
  | `0x${string}`
  | undefined;
const VAULT_CHAIN_ID = 138565;

export function RedeemPanel({
  indexId,
  ticker,
  isDemo = false,
}: {
  indexId: string | null;
  ticker: string;
  isDemo?: boolean;
}) {
  // Nothing to redeem in demo / before the vault+index exist on-chain.
  if (isDemo || !VAULT_ADDRESS || !indexId) return null;
  return (
    <RedeemPanelLive
      indexId={indexId as `0x${string}`}
      ticker={ticker}
      vaultAddress={VAULT_ADDRESS}
    />
  );
}

function RedeemPanelLive({
  indexId,
  ticker,
  vaultAddress,
}: {
  indexId: `0x${string}`;
  ticker: string;
  vaultAddress: `0x${string}`;
}) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync, isPending: switching } = useSwitchChain();

  const { data: position, refetch } = useReadContract({
    address: vaultAddress,
    abi: HYPE_INDEX_VAULT_ABI,
    functionName: "positions",
    args: address ? [indexId, address] : undefined,
    chainId: VAULT_CHAIN_ID,
    query: { enabled: !!address },
  });

  const shares = (position?.[0] ?? 0n) as bigint;

  const {
    writeContractAsync,
    data: txHash,
    isPending: signing,
    error: writeError,
    reset,
  } = useWriteContract();
  const {
    isLoading: confirming,
    data: receipt,
    error: receiptError,
  } = useWaitForTransactionReceipt({ hash: txHash });

  const [localError, setLocalError] = useState<string | null>(null);

  const wrongChain = isConnected && chainId !== VAULT_CHAIN_ID;
  const pending = signing || switching || confirming;
  const succeeded = receipt?.status === "success";
  const failed =
    receipt?.status === "reverted" || !!writeError || !!receiptError || !!localError;
  const errorMsg =
    localError ??
    (writeError as { shortMessage?: string } | null)?.shortMessage ??
    writeError?.message ??
    (receiptError as { shortMessage?: string } | null)?.shortMessage ??
    receiptError?.message ??
    null;

  const redeem = useCallback(
    async (pctBps: number) => {
      setLocalError(null);
      reset();
      // shares * pctBps / 10000, with full-redeem using the exact balance to
      // avoid leaving dust from integer division.
      const portion = pctBps >= 10_000 ? shares : (shares * BigInt(pctBps)) / 10_000n;
      if (portion <= 0n) {
        setLocalError("Nothing to redeem.");
        return;
      }
      try {
        if (wrongChain) await switchChainAsync({ chainId: VAULT_CHAIN_ID });
        // minUsdcOut = 0: NAV is signed off-chain at settlement so the client
        // can't price a slippage floor here (testnet). Keeper enforces a sane NAV.
        await writeContractAsync({
          address: vaultAddress,
          abi: HYPE_INDEX_VAULT_ABI,
          functionName: "requestRedeem",
          args: [indexId, portion, 0n],
          chainId: VAULT_CHAIN_ID,
        });
        void refetch();
      } catch (err) {
        const e = err as { shortMessage?: string; message?: string };
        setLocalError(e.shortMessage ?? e.message ?? String(err));
      }
    },
    [shares, wrongChain, switchChainAsync, writeContractAsync, vaultAddress, indexId, reset, refetch],
  );

  // Hide entirely for non-holders.
  if (!isConnected || shares <= 0n) return null;

  // Plain const (not a hook) — must stay below the early return above.
  const sharesLabel = Number(formatUnits(shares, 18)).toLocaleString(undefined, {
    maximumFractionDigits: 4,
  });

  return (
    <Card pad={14}>
      <Label>YOUR POSITION</Label>
      <div style={{ fontSize: 13, fontWeight: 600, marginTop: 6 }}>
        Redeem HYPE-{ticker}
      </div>
      <Mono size={10} color={tokens.textDim} className="block mt-1">
        {sharesLabel} shares · USDC returns after keeper settlement.
      </Mono>

      {succeeded ? (
        <div
          style={{
            marginTop: 10,
            padding: "10px 14px",
            background: tokens.bgElev2,
            border: `1px solid ${tokens.emerald}`,
            borderRadius: 6,
          }}
        >
          <Mono size={11} color={tokens.emerald}>
            Redeem requested — USDC pays out after keeper settlement.
          </Mono>
        </div>
      ) : (
        <>
          <div className="flex gap-1.5 mt-2.5">
            {[
              { label: "25%", bps: 2_500 },
              { label: "50%", bps: 5_000 },
              { label: "Max", bps: 10_000 },
            ].map((o) => (
              <Btn
                key={o.bps}
                small
                onClick={() => (wrongChain ? void switchChainAsync({ chainId: VAULT_CHAIN_ID }) : void redeem(o.bps))}
                disabled={pending}
                style={{ flex: 1, justifyContent: "center" }}
              >
                {o.label}
              </Btn>
            ))}
          </div>
          <Mono size={10} color={tokens.textFaint} className="block mt-2">
            {switching
              ? "Switching chain…"
              : signing
                ? "Confirm in wallet…"
                : confirming
                  ? "Confirming…"
                  : wrongChain
                    ? "Switch to ValueChain Testnet to redeem"
                    : "Choose how much to redeem"}
          </Mono>
          {failed && errorMsg && (
            <Mono
              size={10}
              color={tokens.red}
              className="block mt-1"
              style={{ wordBreak: "break-word" }}
            >
              {errorMsg}
            </Mono>
          )}
        </>
      )}
    </Card>
  );
}
