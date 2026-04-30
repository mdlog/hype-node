"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { tokens } from "@/lib/tokens";
import { Mono } from "@/components/ui/Mono";
import { WalletBadge } from "@/components/auth/WalletBadge";

const items = [
  { k: "dashboard", l: "Dashboard" },
  { k: "research", l: "Research" },
  { k: "builder", l: "Builder" },
  { k: "agent", l: "Agent" },
  { k: "portfolio", l: "Portfolio" },
  { k: "risk", l: "Risk" },
  { k: "history", l: "History" },
  { k: "chat", l: "Chat" },
  { k: "backtest", l: "Backtest" },
  { k: "settings", l: "Settings" },
];

export function IndexerTopBar() {
  const pathname = usePathname();
  const active = pathname?.split("/")[1] ?? "dashboard";
  return (
    <div
      className="sticky top-0 z-10 flex items-center"
      style={{
        height: 48,
        borderBottom: `1px solid ${tokens.border}`,
        padding: "0 16px",
        gap: 16,
        background: tokens.bg,
      }}
    >
      <Link href="/dashboard" className="flex items-center gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo-hypenode.png"
          alt="HypeNode"
          width={36}
          height={36}
          style={{ display: "block" }}
        />
        <span
          className="font-sans"
          style={{
            fontSize: 14,
            fontWeight: 600,
            letterSpacing: "-0.01em",
            color: tokens.text,
          }}
        >
          HypeNode
        </span>
        <span
          className="font-mono uppercase"
          style={{
            fontSize: 10,
            color: tokens.textFaint,
            letterSpacing: "0.12em",
          }}
        >
          / indexer
        </span>
      </Link>
      <div className="flex-1 flex gap-0.5 ml-6">
        {items.map((i) => {
          const on = active === i.k;
          return (
            <Link
              key={i.k}
              href={`/${i.k}`}
              style={{
                padding: "6px 10px",
                borderRadius: 5,
                background: on ? tokens.bgElev : "transparent",
                color: on ? tokens.text : tokens.textDim,
                fontSize: 12,
                fontWeight: 500,
                letterSpacing: "-0.01em",
              }}
            >
              {i.l}
            </Link>
          );
        })}
      </div>
      <div className="flex items-center gap-2.5">
        <div
          className="flex items-center"
          style={{
            gap: 6,
            padding: "4px 10px",
            border: `1px solid ${tokens.border}`,
            borderRadius: 5,
          }}
        >
          <div
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: tokens.emerald,
              boxShadow: `0 0 8px ${tokens.emerald}`,
            }}
          />
          <Mono size={10} color={tokens.textDim}>
            AGENT · LIVE
          </Mono>
        </div>
        <Mono size={10}>⌘K</Mono>
        <WalletBadge />
        <Link
          href="/publisher/radar"
          style={{
            fontSize: 11,
            color: tokens.cyan,
            border: `1px solid ${tokens.cyan}40`,
            padding: "3px 8px",
            borderRadius: 4,
          }}
        >
          → Publisher
        </Link>
      </div>
    </div>
  );
}
