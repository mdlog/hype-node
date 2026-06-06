"use client";

import { useState, useCallback } from "react";
import {
  useAccount,
  useChainId,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { Card, Label, Mono, Btn } from "@/components/ui";
import { tokens } from "@/lib/tokens";
import { HYPE_INDEX_VAULT_ABI } from "@/lib/contracts/hypeIndexVaultAbi";
import { ERC20_ABI } from "@/lib/contracts/erc20Abi";
import { parseUsdcAmount, MIN_DEPOSIT_USDC } from "@/lib/vault/usdcAmount";

const VAULT_ADDRESS = process.env.NEXT_PUBLIC_HYPE_VAULT_ADDRESS as
  | `0x${string}`
  | undefined;
const USDC_ADDRESS = process.env.NEXT_PUBLIC_USDC_ADDRESS as
  | `0x${string}`
  | undefined;
const VAULT_CHAIN_ID = 138565;

export function SubscribePanel({
  indexId,
  ticker,
  isDemo = false,
}: {
  indexId: string | null;
  ticker: string;
  /** When true (demo session), show a connect-wallet prompt instead of the live CTA. */
  isDemo?: boolean;
}) {
  // Demo mode: no live wallet — show a connect-wallet notice instead.
  if (isDemo) {
    return (
      <Card pad={14}>
        <Label>SUBSCRIBE</Label>
        <div style={{ fontSize: 13, fontWeight: 600, marginTop: 6 }}>
          Mint into this index
        </div>
        <Mono size={10} color={tokens.textDim} className="block mt-1">
          Deposit USDC → receive HYPE-{ticker} shares.
        </Mono>
        <div
          style={{
            marginTop: 10,
            padding: "10px 14px",
            background: `${tokens.amber}10`,
            border: `1px dashed ${tokens.amber}60`,
            borderRadius: 6,
            textAlign: "center",
          }}
        >
          <Mono size={11} color={tokens.amber}>
            Demo mode — connect a wallet to subscribe for real
          </Mono>
        </div>
        <Btn
          small
          disabled
          style={{
            marginTop: 8,
            width: "100%",
            justifyContent: "center",
            opacity: 0.45,
          }}
        >
          Subscribe (demo — read-only)
        </Btn>
        <Mono size={10} color={tokens.textFaint} className="block mt-2">
          <a href="/" style={{ color: tokens.cyan, textDecoration: "underline" }}>
            Connect a wallet
          </a>{" "}
          to subscribe with real USDC.
        </Mono>
      </Card>
    );
  }

  // Fallback: env not set → honest "not deployed" card
  if (!VAULT_ADDRESS || !USDC_ADDRESS) {
    return (
      <Card pad={14}>
        <Label>SUBSCRIBE</Label>
        <div style={{ fontSize: 13, fontWeight: 600, marginTop: 6 }}>
          Mint into this index
        </div>
        <Mono size={10} color={tokens.textDim} className="block mt-1">
          Deposit USDC → receive HYPE-{ticker} shares.
        </Mono>
        <div
          style={{
            marginTop: 10,
            padding: "10px 14px",
            background: tokens.bgElev2,
            border: `1px dashed ${tokens.border}`,
            borderRadius: 6,
            textAlign: "center",
          }}
        >
          <Mono size={11} color={tokens.textFaint}>
            Vault not deployed yet
          </Mono>
        </div>
        <Mono size={10} color={tokens.textFaint} className="block mt-2">
          HypeIndexVault deploys in Wave 2 — subscribe button will mint
          ERC-20 shares against this constituent set.
        </Mono>
      </Card>
    );
  }

  // Index not on-chain yet
  if (!indexId) {
    return (
      <Card pad={14}>
        <Label>SUBSCRIBE</Label>
        <div style={{ fontSize: 13, fontWeight: 600, marginTop: 6 }}>
          Mint into this index
        </div>
        <div
          style={{
            marginTop: 10,
            padding: "10px 14px",
            background: tokens.bgElev2,
            border: `1px dashed ${tokens.border}`,
            borderRadius: 6,
            textAlign: "center",
          }}
        >
          <Mono size={11} color={tokens.textFaint}>
            This index isn&apos;t on-chain yet
          </Mono>
        </div>
      </Card>
    );
  }

  return (
    <SubscribePanelLive
      indexId={indexId as `0x${string}`}
      ticker={ticker}
      vaultAddress={VAULT_ADDRESS}
      usdcAddress={USDC_ADDRESS}
    />
  );
}

function SubscribePanelLive({
  indexId,
  ticker,
  vaultAddress,
  usdcAddress,
}: {
  indexId: `0x${string}`;
  ticker: string;
  vaultAddress: `0x${string}`;
  usdcAddress: `0x${string}`;
}) {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync, isPending: switching } = useSwitchChain();

  const {
    writeContractAsync: approveAsync,
    isPending: approving,
    error: approveError,
    reset: resetApprove,
  } = useWriteContract();

  const {
    writeContractAsync,
    data: depositTxHash,
    isPending: signing,
    error: writeError,
    reset: resetWrite,
  } = useWriteContract();

  const { isLoading: confirming, data: receipt, error: receiptError } =
    useWaitForTransactionReceipt({ hash: depositTxHash });

  const [amount, setAmount] = useState("100");
  const [localError, setLocalError] = useState<string | null>(null);

  const wrongChain = isConnected && chainId !== VAULT_CHAIN_ID;
  const pending = approving || signing || switching || confirming;
  const succeeded = receipt?.status === "success";
  const failed = receipt?.status === "reverted" || !!writeError || !!approveError || !!receiptError;

  const errorMsg =
    localError ??
    (writeError as { shortMessage?: string } | null)?.shortMessage ??
    writeError?.message ??
    (approveError as { shortMessage?: string } | null)?.shortMessage ??
    approveError?.message ??
    (receiptError as { shortMessage?: string } | null)?.shortMessage ??
    receiptError?.message ??
    null;

  const handleSubscribe = useCallback(async () => {
    setLocalError(null);
    resetApprove();
    resetWrite();

    const parsed = parseUsdcAmount(amount);
    if ("error" in parsed) {
      setLocalError(parsed.error);
      return;
    }
    const { value } = parsed;

    try {
      if (wrongChain) {
        await switchChainAsync({ chainId: VAULT_CHAIN_ID });
      }
      // Step 1: approve USDC spend
      await approveAsync({
        address: usdcAddress,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [vaultAddress, value],
        chainId: VAULT_CHAIN_ID,
      });
      // Step 2: requestDeposit on vault
      await writeContractAsync({
        address: vaultAddress,
        abi: HYPE_INDEX_VAULT_ABI,
        functionName: "requestDeposit",
        args: [indexId, value, 0n],
        chainId: VAULT_CHAIN_ID,
      });
    } catch (err) {
      const e = err as { shortMessage?: string; message?: string };
      setLocalError(e.shortMessage ?? e.message ?? String(err));
    }
  }, [
    amount,
    wrongChain,
    switchChainAsync,
    approveAsync,
    writeContractAsync,
    resetApprove,
    resetWrite,
    vaultAddress,
    usdcAddress,
    indexId,
  ]);

  return (
    <Card pad={14}>
      <Label>SUBSCRIBE</Label>
      <div style={{ fontSize: 13, fontWeight: 600, marginTop: 6 }}>
        Mint into this index
      </div>
      <Mono size={10} color={tokens.textDim} className="block mt-1">
        Deposit USDC → receive HYPE-{ticker} shares.
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
            Deposit requested — shares mint after keeper settlement.
          </Mono>
        </div>
      ) : (
        <>
          <div style={{ marginTop: 10 }}>
            <input
              type="number"
              inputMode="decimal"
              aria-label="Deposit amount in USDC"
              min={MIN_DEPOSIT_USDC}
              step="any"
              value={amount}
              onChange={(e) => {
                setLocalError(null);
                setAmount(e.target.value);
              }}
              disabled={pending}
              placeholder={`Min ${MIN_DEPOSIT_USDC} USDC`}
              style={{
                width: "100%",
                padding: "8px 10px",
                fontSize: 13,
                background: tokens.bgElev2,
                color: tokens.text,
                border: `1px solid ${tokens.border}`,
                borderRadius: 6,
                outline: "none",
                boxSizing: "border-box",
              }}
            />
            <Mono size={10} color={tokens.textFaint} className="block mt-1">
              Minimum {MIN_DEPOSIT_USDC} USDC · 6 decimal places max
            </Mono>
          </div>

          {!isConnected ? (
            <div
              style={{
                marginTop: 8,
                padding: "8px 10px",
                background: tokens.bgElev2,
                border: `1px dashed ${tokens.border}`,
                borderRadius: 6,
                textAlign: "center",
              }}
            >
              <Mono size={11} color={tokens.textFaint}>
                Connect your wallet to subscribe
              </Mono>
            </div>
          ) : wrongChain ? (
            <Btn
              small
              onClick={() => switchChainAsync({ chainId: VAULT_CHAIN_ID })}
              disabled={switching}
              style={{ marginTop: 8, width: "100%", justifyContent: "center" }}
            >
              {switching ? "Switching…" : "Switch to ValueChain Testnet"}
            </Btn>
          ) : (
            <Btn
              small
              onClick={handleSubscribe}
              disabled={pending}
              style={{ marginTop: 8, width: "100%", justifyContent: "center" }}
            >
              {switching
                ? "Switching chain…"
                : approving
                  ? "Approving USDC…"
                  : signing
                    ? "Requesting deposit…"
                    : confirming
                      ? "Confirming…"
                      : "Subscribe"}
            </Btn>
          )}

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
