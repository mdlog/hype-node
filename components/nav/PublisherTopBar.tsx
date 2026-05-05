"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { tokens } from "@/lib/tokens";
import { Mono } from "@/components/ui/Mono";
import { WalletBadge } from "@/components/auth/WalletBadge";
import { RoleSwitcher } from "@/components/nav/RoleSwitcher";

const items = [
  { k: "radar", l: "Hype Radar" },
  { k: "proposals", l: "Proposals", badge: 3 },
  { k: "published", l: "My Indices" },
  { k: "earnings", l: "Earnings" },
  { k: "config", l: "Agent Config" },
];

export function PublisherTopBar() {
  const pathname = usePathname();
  const active = pathname?.split("/")[2] ?? "radar";
  return (
    <div
      className="sticky top-0 z-10 flex items-center"
      style={{
        height: 52,
        borderBottom: `1px solid ${tokens.border}`,
        padding: "0 20px",
        gap: 20,
        background: tokens.bg,
      }}
    >
      <Link href="/publisher/radar" className="flex items-center gap-2.5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo-hypenode.png"
          alt="HypeNode"
          width={40}
          height={40}
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
            for creators
          </div>
        </div>
      </Link>
      <div className="flex-1 flex gap-0.5 ml-5">
        {items.map((i) => {
          const on = active === i.k;
          return (
            <Link
              key={i.k}
              href={`/publisher/${i.k}`}
              className="flex items-center gap-1.5"
              style={{
                padding: "7px 12px",
                borderRadius: 6,
                background: on ? tokens.bgElev : "transparent",
                color: on ? tokens.text : tokens.textDim,
                fontSize: 12.5,
                fontWeight: 500,
                letterSpacing: "-0.01em",
              }}
            >
              {i.l}
              {i.badge && (
                <span
                  className="font-mono"
                  style={{
                    padding: "1px 6px",
                    background: tokens.amber,
                    color: tokens.bg,
                    fontSize: 9,
                    fontWeight: 700,
                    borderRadius: 8,
                  }}
                >
                  {i.badge}
                </span>
              )}
            </Link>
          );
        })}
      </div>
      <div className="flex items-center gap-3">
        <div
          className="flex items-center gap-1.5"
          style={{
            padding: "5px 10px",
            background: tokens.emerald + "10",
            border: `1px solid ${tokens.emerald}30`,
            borderRadius: 6,
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
          <Mono size={10} color={tokens.emerald}>
            AGENT ON
          </Mono>
        </div>
        {/* The fake "$847.22 · 30d earnings" line was removed: we don't have
            an on-chain earnings indexer yet, so the real number is "—".
            WalletBadge below shows the actual wallet identity, and the
            earnings page surfaces the honest empty state. */}
        <WalletBadge />
        <RoleSwitcher current="publisher" />
      </div>
    </div>
  );
}
