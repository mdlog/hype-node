"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useDisconnect } from "wagmi";

import { tokens } from "@/lib/tokens";

// Compact pill rendered inside the protected-route topbars. Middleware
// guarantees a session is present here, so the un-signed state is purely
// defensive — if it ever shows, something is wrong with the session round-trip.
export function WalletBadge() {
  const router = useRouter();
  const { disconnect } = useDisconnect();
  const [address, setAddress] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { address: string | null }) => {
        if (!cancelled) setAddress(d.address);
      })
      .catch(() => {
        // Silent: on a protected route this shouldn't happen, but if it
        // does the dropdown just stays in its empty state.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Close menu on outside click.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  async function handleSignOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    disconnect();
    setAddress(null);
    setOpen(false);
    router.push("/");
    router.refresh();
  }

  async function handleCopy() {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
    } catch {
      // Clipboard blocked (insecure context, etc.) — fail quietly.
    }
    setOpen(false);
  }

  if (!address) {
    return (
      <a
        href="/"
        style={{
          fontSize: 11,
          padding: "5px 10px",
          border: `1px solid ${tokens.border}`,
          borderRadius: 6,
          color: tokens.textDim,
          fontFamily: '"JetBrains Mono", monospace',
        }}
      >
        Connect →
      </a>
    );
  }

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "5px 10px 5px 6px",
          background: tokens.bgElev2,
          border: `1px solid ${tokens.border}`,
          borderRadius: 6,
          cursor: "pointer",
          color: tokens.text,
          fontFamily: "inherit",
        }}
      >
        <span
          style={{
            width: 18,
            height: 18,
            borderRadius: "50%",
            background: `linear-gradient(135deg, ${tokens.emerald}, ${tokens.cyan})`,
            display: "inline-block",
          }}
        />
        <span
          style={{
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: 11,
            letterSpacing: "0.02em",
          }}
        >
          {short(address)}
        </span>
        <span style={{ color: tokens.textFaint, fontSize: 9 }}>▾</span>
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            minWidth: 200,
            background: tokens.bgElev,
            border: `1px solid ${tokens.border}`,
            borderRadius: 8,
            boxShadow: "0 12px 40px -10px rgba(0,0,0,0.6)",
            padding: 6,
            zIndex: 50,
          }}
        >
          <div
            style={{
              padding: "8px 10px",
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: 10.5,
              color: tokens.textDim,
              borderBottom: `1px solid ${tokens.border}`,
              wordBreak: "break-all",
              lineHeight: 1.4,
            }}
          >
            {address}
          </div>
          <MenuItem onClick={handleCopy}>Copy address</MenuItem>
          <MenuItem onClick={handleSignOut} danger>
            Sign out
          </MenuItem>
        </div>
      )}
    </div>
  );
}

function MenuItem({
  children,
  onClick,
  danger = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: "100%",
        textAlign: "left",
        padding: "8px 10px",
        background: "transparent",
        border: "none",
        color: danger ? tokens.red : tokens.text,
        fontSize: 12.5,
        cursor: "pointer",
        borderRadius: 4,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = tokens.bgHover;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      {children}
    </button>
  );
}

function short(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
