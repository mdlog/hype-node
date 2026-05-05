"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { SiweMessage } from "siwe";
import { useAccount, useDisconnect, useSignMessage } from "wagmi";

type Props = {
  // CSS class applied to the outer button when not connected. Lets us reuse
  // the .hype-btn styles from globals.css for a single canonical look.
  className?: string;
  // After successful sign-in, push the router here. Default '/dashboard'.
  redirectTo?: string;
  // Label shown on the button when the user is not yet connected. Other
  // states (signing, error, signed-in) keep their canonical text so the
  // user always knows what action will happen next.
  label?: string;
};

type Status = "idle" | "loading" | "signed-in" | "error";

export function SignInButton({
  className = "hype-btn primary",
  redirectTo = "/dashboard",
  label = "Get access →",
}: Props) {
  const router = useRouter();
  const { address, chainId, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const { disconnect } = useDisconnect();

  const [status, setStatus] = useState<Status>("idle");
  const [sessionAddress, setSessionAddress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Per-address attempt guard. Auto-triggering signIn() on the connect
  // event is the obvious UX win, but a naive `useEffect([isConnected,
  // address])` re-fires on every status change too — which means after a
  // failed verify (status → "error"), the effect re-runs, fetches a new
  // nonce (overwriting the session.nonce), and races the next signMessage
  // → 401 forever. The fix is to remember which address we've already
  // tried for in this tab, and only auto-trigger ONCE per connection.
  // Cleared when the wallet disconnects.
  const handledAddressRef = useRef<string | null>(null);

  // Hydrate session state on mount so a returning visitor sees their
  // logged-in status without having to reconnect.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { address: string | null }) => {
        if (cancelled) return;
        if (d.address) {
          setSessionAddress(d.address);
          setStatus("signed-in");
        }
      })
      .catch(() => {
        // Silent: missing/invalid session just leaves status at 'idle'.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async () => {
    if (!address || !chainId) return;
    if (status === "loading") return;
    setStatus("loading");
    setError(null);
    try {
      const nonceRes = await fetch("/api/auth/nonce", { cache: "no-store" });
      const { nonce } = (await nonceRes.json()) as { nonce: string };

      const message = new SiweMessage({
        domain: window.location.host,
        address,
        statement: "Sign in to HypeNode.",
        uri: window.location.origin,
        version: "1",
        chainId,
        nonce,
      });
      const prepared = message.prepareMessage();
      const signature = await signMessageAsync({ message: prepared });

      const verifyRes = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: prepared, signature }),
      });
      const verifyJson = (await verifyRes.json()) as {
        ok: boolean;
        address?: string;
        role?: "indexer" | "publisher" | null;
        error?: string;
      };
      if (!verifyRes.ok || !verifyJson.ok) {
        throw new Error(verifyJson.error ?? "verify failed");
      }
      setSessionAddress(verifyJson.address ?? address.toLowerCase());
      setStatus("signed-in");
      // Routing decision:
      //  - Caller passed an explicit (non-default) redirectTo → honour it.
      //  - User has a saved role → land on that role's home.
      //  - First-time user with no saved role → onboarding picker.
      let dest = redirectTo;
      if (redirectTo === "/dashboard") {
        if (verifyJson.role === "publisher") dest = "/publisher/radar";
        else if (verifyJson.role === "indexer") dest = "/dashboard";
        else dest = "/onboarding/role";
      }
      router.push(dest);
      router.refresh();
    } catch (err) {
      setStatus("error");
      setError((err as Error).message);
    }
  }, [address, chainId, status, signMessageAsync, router, redirectTo]);

  // Reset transient sign-in state when the wallet disconnects so the next
  // connection starts from a clean slate (otherwise an old "error" sticks
  // around and the user sees a Retry button on a fresh wallet).
  useEffect(() => {
    if (!isConnected && status !== "signed-in") {
      setStatus("idle");
      setError(null);
      handledAddressRef.current = null;
    }
  }, [isConnected, status]);

  // Auto-trigger SIWE the moment the wallet finishes connecting — so the
  // user only has to click "Get access" once. The handledAddressRef +
  // status guards together prevent the retry-loop bug: we only fire when
  // status is exactly "idle" AND we haven't already tried this address.
  // After a failure (status → "error"), the user explicitly retries via
  // the Retry button; the auto-trigger does NOT fire on error states.
  useEffect(() => {
    if (!isConnected || !address) return;
    if (status !== "idle") return;
    if (handledAddressRef.current === address) return;
    handledAddressRef.current = address;
    signIn();
  }, [isConnected, address, status, signIn]);

  const signOut = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setSessionAddress(null);
    setStatus("idle");
    disconnect();
    router.refresh();
  }, [disconnect, router]);

  return (
    <ConnectButton.Custom>
      {({ account, chain, openConnectModal, mounted }) => {
        const ready = mounted;
        const connected = ready && account && chain;

        if (!connected) {
          return (
            <button
              type="button"
              className={className}
              onClick={openConnectModal}
              disabled={!ready}
            >
              {label}
            </button>
          );
        }

        if (status === "loading") {
          return (
            <button type="button" className={className} disabled>
              Signing in…
            </button>
          );
        }

        if (status === "error") {
          return (
            <button
              type="button"
              className={className}
              onClick={signIn}
              title={error ?? undefined}
            >
              Retry sign-in →
            </button>
          );
        }

        if (status === "signed-in" && sessionAddress) {
          return (
            <div style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
              <a className="hype-btn" href={redirectTo}>
                {short(sessionAddress)}
              </a>
              <button type="button" className="hype-btn ghost" onClick={signOut}>
                Sign out
              </button>
            </div>
          );
        }

        // Connected but not yet signed in. With auto-trigger this state is
        // brief (just the moment between wallet-connect and the first
        // setStatus("loading")), but we render a manual button as fallback
        // — for example if the auto-trigger handler errored before even
        // setting status, or if the user dismissed the wallet's signature
        // prompt and we want them to be able to retry without disconnecting.
        return (
          <button type="button" className={className} onClick={signIn}>
            Sign message →
          </button>
        );
      }}
    </ConnectButton.Custom>
  );
}

function short(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
