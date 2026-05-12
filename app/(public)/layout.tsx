// Layout shared by static info routes — /docs, /privacy, /status. Mirrors
// the discover surface chrome (slim brand bar + "Open app" CTA) so these
// pages are reachable from the footer regardless of auth state.

import Link from "next/link";

import { Mono } from "@/components/ui";
import { tokens } from "@/lib/tokens";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="min-h-screen relative"
      style={{ background: tokens.bg, color: tokens.text }}
    >
      <div
        className="sticky top-0 z-10"
        style={{
          height: 52,
          borderBottom: `1px solid ${tokens.border}`,
          background: tokens.bg,
        }}
      >
        <div
          className="mx-auto flex items-center h-full"
          style={{ maxWidth: 1440, padding: "0 20px", gap: 16 }}
        >
        <Link href="/" className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo-hypenode.png"
            alt="HypeNode"
            width={32}
            height={32}
            style={{ display: "block" }}
          />
          <div>
            <div
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: tokens.text,
                letterSpacing: "-0.02em",
                lineHeight: 1,
              }}
            >
              HypeNode
            </div>
            <Mono size={9} color={tokens.textFaint} style={{ marginTop: 2, letterSpacing: "0.14em" }}>
              autonomous indexer
            </Mono>
          </div>
        </Link>
        <div className="flex-1 flex items-center" style={{ gap: 4, marginLeft: 12 }}>
          <PublicNavLink href="/docs" label="Docs" />
          <PublicNavLink href="/status" label="Status" />
          <PublicNavLink href="/privacy" label="Privacy" />
        </div>
        <Link
          href="/"
          style={{
            color: tokens.bg,
            background: tokens.emerald,
            padding: "7px 14px",
            borderRadius: 6,
            fontSize: 13,
            fontWeight: 600,
            textDecoration: "none",
          }}
        >
          Open app →
        </Link>
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          top: -200,
          left: -200,
          width: 500,
          height: 500,
          background: `radial-gradient(circle, ${tokens.emerald}08 0%, transparent 70%)`,
          pointerEvents: "none",
          zIndex: 0,
        }}
      />
      <main className="relative">{children}</main>
    </div>
  );
}

function PublicNavLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      style={{
        padding: "6px 10px",
        borderRadius: 5,
        color: tokens.textDim,
        fontSize: 12,
        fontWeight: 500,
        letterSpacing: "-0.01em",
        textDecoration: "none",
      }}
    >
      {label}
    </Link>
  );
}
