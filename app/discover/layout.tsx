// Public marketplace layout — no auth gate, no role-specific top bar. The
// /discover surface is reachable by anyone (logged in or not) so subscribers
// can browse published indices before connecting a wallet. Keep the chrome
// minimal: a tiny brand mark + a sign-in CTA that bounces to the landing
// page so the connect-wallet flow lives in exactly one place.

import Link from "next/link";

import { tokens } from "@/lib/tokens";
import { Mono } from "@/components/ui";

export default function DiscoverLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="min-h-screen relative overflow-hidden"
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
          style={{ maxWidth: 1440, padding: "0 20px", gap: 20 }}
        >
        <Link href="/" className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo-hypenode.png"
            alt="HypeNode"
            width={36}
            height={36}
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
              HypeIndex
            </div>
            <div
              className="font-mono uppercase"
              style={{
                fontSize: 8.5,
                color: tokens.textFaint,
                letterSpacing: "0.14em",
                marginTop: 2,
              }}
            >
              discover · public marketplace
            </div>
          </div>
        </Link>
        <div className="flex-1 flex items-center gap-3 ml-5">
          <Link
            href="/discover"
            style={{
              padding: "7px 12px",
              borderRadius: 6,
              background: tokens.bgElev,
              color: tokens.text,
              fontSize: 12.5,
              fontWeight: 500,
              letterSpacing: "-0.01em",
            }}
          >
            Discover
          </Link>
          <Mono size={10} color={tokens.textFaint}>
            browse community-published SSI indices · no sign-in required
          </Mono>
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
          Connect wallet →
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
      <main className="relative mx-auto" style={{ maxWidth: 1440 }}>
        {children}
      </main>
    </div>
  );
}
