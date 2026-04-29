"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
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
      const verifyJson = (await verifyRes.json()) as { ok: boolean; address?: string; error?: string };
      if (!verifyRes.ok || !verifyJson.ok) {
        throw new Error(verifyJson.error ?? "verify failed");
      }
      setSessionAddress(verifyJson.address ?? address.toLowerCase());
      setStatus("signed-in");
      router.push(redirectTo);
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
    }
  }, [isConnected, status]);

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

        // Connected but not yet signed in. Two-click flow (connect → sign)
        // is intentional: auto-triggering signMessage on connect is racy in
        // dev (effect re-runs on status changes can fetch a new nonce while
        // the previous signature is still in flight, causing 401 verify
        // mismatches), and matches Uniswap/OpenSea-style UX.
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
