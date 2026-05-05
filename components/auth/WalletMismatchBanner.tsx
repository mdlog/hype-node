"use client";

import { Btn, Card, Mono, Tag } from "@/components/ui";
import { tokens } from "@/lib/tokens";
import type { SessionGuard } from "@/lib/auth/useSessionGuard";

// Renders only when the wallet currently selected in MetaMask differs from
// the address baked into the session cookie. Two CTAs:
//   1. Re-sign with this wallet → triggers SIWE flow (popup) for the new
//      wagmi address. Server issues a fresh session cookie + refreshSession()
//      pulls it back into the hook state. After this, status → "ok".
//   2. Switch back → user-only action; we tell them which address to pick
//      in MetaMask. App can't programmatically switch a user's MetaMask
//      account selection.
//
// The banner is intentionally LOUD (amber border, ⚠ icon) because it
// signals an auth/identity inconsistency that users routinely miss until
// a tx fails or they see "wrong" data.

function shortAddr(s: string | null): string {
  if (!s) return "—";
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}

export function WalletMismatchBanner({ guard }: { guard: SessionGuard }) {
  if (guard.status !== "mismatch" && guard.status !== "signing" && guard.status !== "error") {
    return null;
  }

  const isMismatch = guard.status === "mismatch";
  const isSigning = guard.status === "signing";
  const hasError = guard.status === "error";

  if (!isMismatch && !isSigning && !hasError) return null;
  // Only show error/signing while there's actually a mismatch context to
  // act on — bare "error" without a connected wallet is handled elsewhere.
  if ((isSigning || hasError) && !guard.walletAddress) return null;

  return (
    <Card pad={14}>
      <div className="flex items-start gap-3 flex-wrap">
        <div
          style={{
            fontSize: 22,
            color: tokens.amber,
            lineHeight: 1,
            paddingTop: 2,
          }}
        >
          ⚠
        </div>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div className="flex items-center gap-2 flex-wrap">
            <div
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: tokens.text,
                letterSpacing: "-0.01em",
              }}
            >
              Wallet identity mismatch
            </div>
            <Tag small color={tokens.amber} dot>
              auth blocked
            </Tag>
          </div>
          <div
            style={{
              fontSize: 12,
              color: tokens.textDim,
              marginTop: 4,
              lineHeight: 1.55,
            }}
          >
            Your session was signed with{" "}
            <span
              className="font-mono"
              style={{ color: tokens.text, fontWeight: 600 }}
            >
              {shortAddr(guard.sessionAddress)}
            </span>
            , but MetaMask is currently set to{" "}
            <span
              className="font-mono"
              style={{ color: tokens.text, fontWeight: 600 }}
            >
              {shortAddr(guard.walletAddress)}
            </span>
            . Sensitive actions (deploy, trade, transfer) are blocked until the
            two match. Either re-sign with the new wallet, or switch back in
            MetaMask.
          </div>
          {hasError && guard.error && (
            <Mono size={11} color={tokens.red} style={{ marginTop: 6, display: "block" }}>
              re-sign failed: {guard.error}
            </Mono>
          )}
          <div className="flex gap-2 flex-wrap" style={{ marginTop: 10 }}>
            <Btn
              small
              primary
              onClick={() => {
                void guard.signIn();
              }}
              disabled={isSigning || !guard.walletAddress}
            >
              {isSigning
                ? "Waiting for signature…"
                : `Re-sign with ${shortAddr(guard.walletAddress)}`}
            </Btn>
            <Btn small onClick={() => void guard.refreshSession()}>
              Recheck session
            </Btn>
          </div>
          <Mono size={10} color={tokens.textFaint} style={{ marginTop: 8, display: "block" }}>
            tip: to switch back without re-signing, open MetaMask → account
            picker → choose {shortAddr(guard.sessionAddress)}.
          </Mono>
        </div>
      </div>
    </Card>
  );
}
