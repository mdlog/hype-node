"use client";

// Creator fee withdrawal. Reads the index vault and, when the connected wallet
// is the creator and has accrued fee shares (mgmt + crystallized perf), lets
// them claimFees(indexId) — which queues a redeem of those shares. USDC is paid
// out after the keeper settles, same as a subscriber redeem.
//
// Self-hides for non-creators or when nothing is claimable.

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

export function ClaimFeesPanel({
  indexId,
  ticker,
}: {
  indexId: string | null;
  ticker: string;
}) {
  if (!VAULT_ADDRESS || !indexId) return null;
  return (
    <ClaimFeesPanelLive
      indexId={indexId as `0x${string}`}
      ticker={ticker}
      vaultAddress={VAULT_ADDRESS}
    />
  );
}

function ClaimFeesPanelLive({
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

  const { data: vault, refetch } = useReadContract({
    address: vaultAddress,
    abi: HYPE_INDEX_VAULT_ABI,
    functionName: "vaults",
    args: [indexId],
    chainId: VAULT_CHAIN_ID,
  });

  const creator = (vault?.[1] ?? "0x0000000000000000000000000000000000000000") as string;
  const feeShares = (vault?.[5] ?? 0n) as bigint;

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

  const claim = useCallback(async () => {
    setLocalError(null);
    reset();
    try {
      if (wrongChain) await switchChainAsync({ chainId: VAULT_CHAIN_ID });
      await writeContractAsync({
        address: vaultAddress,
        abi: HYPE_INDEX_VAULT_ABI,
        functionName: "claimFees",
        args: [indexId],
        chainId: VAULT_CHAIN_ID,
      });
      void refetch();
    } catch (err) {
      const e = err as { shortMessage?: string; message?: string };
      setLocalError(e.shortMessage ?? e.message ?? String(err));
    }
  }, [wrongChain, switchChainAsync, writeContractAsync, vaultAddress, indexId, reset, refetch]);

  const isCreator =
    isConnected &&
    !!address &&
    creator.toLowerCase() === address.toLowerCase();

  // Hide unless the connected wallet is the creator with claimable fees.
  if (!isCreator || feeShares <= 0n) return null;

  const feeLabel = Number(formatUnits(feeShares, 18)).toLocaleString(undefined, {
    maximumFractionDigits: 4,
  });

  return (
    <Card pad={14}>
      <Label>CLAIM FEES</Label>
      <div style={{ fontSize: 13, fontWeight: 600, marginTop: 6 }}>
        {ticker} creator fees
      </div>
      <Mono size={10} color={tokens.textDim} className="block mt-1">
        {feeLabel} fee shares accrued · claim converts them to a USDC payout.
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
            Fees claimed — USDC pays out after keeper settlement.
          </Mono>
        </div>
      ) : (
        <>
          <Btn
            small
            primary
            onClick={() =>
              wrongChain ? void switchChainAsync({ chainId: VAULT_CHAIN_ID }) : void claim()
            }
            disabled={pending}
            style={{ marginTop: 10, width: "100%", justifyContent: "center" }}
          >
            {switching
              ? "Switching chain…"
              : signing
                ? "Confirm in wallet…"
                : confirming
                  ? "Confirming…"
                  : wrongChain
                    ? "Switch to ValueChain Testnet"
                    : "Claim fees"}
          </Btn>
          {failed && errorMsg && (
            <Mono
              size={10}
              color={tokens.red}
              className="block mt-2"
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
