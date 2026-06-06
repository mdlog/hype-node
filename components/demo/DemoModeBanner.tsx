"use client";

import { tokens } from "@/lib/tokens";

/**
 * Slim amber strip shown when the user is in demo mode.
 * The parent layout only renders this when `user?.demo` is true — the
 * conditional here is a defensive guard only.
 */
export function DemoModeBanner({ isDemo }: { isDemo: boolean }) {
  if (!isDemo) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "sticky",
        top: 0,
        zIndex: 60,
        background: tokens.amber + "18",
        borderBottom: `1px solid ${tokens.amber}40`,
        padding: "7px 20px",
        display: "flex",
        alignItems: "center",
        gap: 14,
        fontSize: 12.5,
        fontFamily: '"JetBrains Mono", monospace',
        color: tokens.amber,
      }}
    >
      <span style={{ letterSpacing: "0.04em" }}>
        🧪 Demo mode — sample data, no wallet.
      </span>
      <span style={{ color: `${tokens.amber}80` }}>·</span>
      <a
        href="/"
        style={{
          color: tokens.amber,
          textDecoration: "underline",
          textUnderlineOffset: 3,
          fontWeight: 600,
        }}
      >
        Connect a wallet
      </a>
      <span style={{ color: `${tokens.amber}80` }}>·</span>
      <a
        href="/api/demo/exit"
        style={{
          color: tokens.amber,
          textDecoration: "underline",
          textUnderlineOffset: 3,
        }}
      >
        Exit demo
      </a>
    </div>
  );
}
