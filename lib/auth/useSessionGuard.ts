"use client";

import { useCallback, useEffect, useState } from "react";
import { SiweMessage } from "siwe";
import { useAccount, useSignMessage } from "wagmi";

// Reconciles two sources of wallet identity:
//   1. Session cookie (SIWE-signed, server-side authoritative)  — /api/auth/me
//   2. Wagmi useAccount()                                       — what's CURRENTLY
//                                                                 selected in MetaMask
//
// Returns a `status` enum the UI can switch on:
//   - loading      → fetching /me; UI should show splash
//   - no-wallet    → wagmi not connected; user is browsing pre-auth
//   - no-session   → wagmi connected but cookie missing (rare; logout race)
//   - mismatch     → wagmi address ≠ session address. SENSITIVE ACTIONS
//                    SHOULD BLOCK. Banner prompts re-sign-in.
//   - signing      → re-sign in flight after user clicks the banner CTA
//   - ok           → addresses match, app proceeds normally
//   - error        → re-sign attempt failed; user can retry
//
// Sensitive actions (deploy on-chain, trade, transfer) MUST gate on
// `status === "ok"`. Read-only views can use `effectiveAddress` to render
// for the authenticated identity even during `mismatch` so the user keeps
// seeing their actual portfolio (the banner explains the switch).

export type SessionStatus =
  | "loading"
  | "no-wallet"
  | "no-session"
  | "mismatch"
  | "signing"
  | "ok"
  | "error";

export type SessionGuard = {
  walletAddress: `0x${string}` | null;
  sessionAddress: `0x${string}` | null;
  /** Address to use for read-only data fetch — always the authenticated one. */
  effectiveAddress: `0x${string}` | null;
  isConnected: boolean;
  status: SessionStatus;
  error: string | null;
  /** Trigger SIWE re-auth using the currently connected wagmi wallet. */
  signIn: () => Promise<void>;
  refreshSession: () => Promise<void>;
};

const lower = (s: string | null | undefined): string | null =>
  s ? s.toLowerCase() : null;

// Cross-component event so a successful re-sign in one component (e.g. the
// builder's mismatch banner) triggers session re-fetch in every other
// component that reads /api/auth/me — most importantly the WalletBadge in
// the topbar, which would otherwise stay stuck on the previous address
// until the user navigates or hard-refreshes.
const SESSION_EVENT = "hypenode:session-changed";

function emitSessionChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(SESSION_EVENT));
}

export function notifySessionChanged() {
  // Public re-export so non-hook callers (e.g. WalletBadge.handleSignOut)
  // can invalidate every cached session readout in one shot.
  emitSessionChanged();
}

export function useSessionGuard(): SessionGuard {
  const { address: wagmiAddr, chainId, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();

  const [sessionAddress, setSessionAddress] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshSession = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      const data = (await res.json()) as { address: string | null };
      setSessionAddress(data.address);
    } catch {
      setSessionAddress(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshSession();
    if (typeof window === "undefined") return;
    // Other components that re-sign or sign-out fire this event so every
    // hook instance pulls a fresh /me — keeping the topbar badge, portfolio
    // header, and builder gate in sync without page reload.
    const onChanged = () => {
      void refreshSession();
    };
    window.addEventListener(SESSION_EVENT, onChanged);
    return () => window.removeEventListener(SESSION_EVENT, onChanged);
  }, [refreshSession]);

  const signIn = useCallback(async () => {
    if (!wagmiAddr || !chainId) {
      setError("Wallet not connected — open the connect modal first.");
      return;
    }
    setSigning(true);
    setError(null);
    try {
      const nonceRes = await fetch("/api/auth/nonce", { cache: "no-store" });
      if (!nonceRes.ok) throw new Error(`nonce HTTP ${nonceRes.status}`);
      const { nonce } = (await nonceRes.json()) as { nonce: string };

      const message = new SiweMessage({
        domain: window.location.host,
        address: wagmiAddr,
        statement: "Sign in to HypeNode.",
        uri: window.location.origin,
        version: "1",
        chainId,
        nonce,
      }).prepareMessage();

      const signature = await signMessageAsync({ message });

      const verifyRes = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, signature }),
      });
      const result = (await verifyRes.json()) as {
        ok: boolean;
        address?: string;
        error?: string;
      };
      if (!verifyRes.ok || !result.ok) {
        throw new Error(result.error ?? `verify HTTP ${verifyRes.status}`);
      }
      setSessionAddress(result.address ?? wagmiAddr.toLowerCase());
      // Fan out to other tabs / components so the WalletBadge & co. drop
      // their cached pre-resign address.
      emitSessionChanged();
    } catch (e) {
      setError((e as Error).message ?? "sign-in failed");
    } finally {
      setSigning(false);
    }
  }, [wagmiAddr, chainId, signMessageAsync]);

  // Status priority: loading > signing > error > shape checks > equality.
  let status: SessionStatus;
  if (loading) status = "loading";
  else if (signing) status = "signing";
  else if (error) status = "error";
  else if (!isConnected || !wagmiAddr) status = "no-wallet";
  else if (!sessionAddress) status = "no-session";
  else if (lower(sessionAddress) === lower(wagmiAddr)) status = "ok";
  else status = "mismatch";

  // Read-only views use the authenticated session identity (rather than the
  // arbitrary wallet currently picked in MetaMask) so a user who switches
  // accounts mid-session doesn't accidentally see "another wallet's" data
  // before re-authenticating.
  const effectiveAddress = (sessionAddress as `0x${string}` | null) ?? null;

  return {
    walletAddress: (wagmiAddr ?? null) as `0x${string}` | null,
    sessionAddress: (sessionAddress as `0x${string}` | null) ?? null,
    effectiveAddress,
    isConnected,
    status,
    error,
    signIn,
    refreshSession,
  };
}
