"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { tokens } from "@/lib/tokens";
import { Mono } from "@/components/ui/Mono";
import { WalletBadge } from "@/components/auth/WalletBadge";

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
        <div
          className="flex items-center justify-center"
          style={{
            width: 26,
            height: 26,
            borderRadius: 6,
            background: `linear-gradient(135deg, ${tokens.emerald}, ${tokens.emeraldDim})`,
            boxShadow: `0 0 16px ${tokens.emerald}50`,
          }}
        >
          <svg width={14} height={14} viewBox="0 0 12 12">
            <path
              d="M 1 10 L 4 4 L 7 7 L 11 2"
              fill="none"
              stroke={tokens.bg}
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
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
        <div className="text-right">
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: tokens.text,
              lineHeight: 1,
            }}
          >
            $847.22
          </div>
          <Mono size={9}>30d earnings</Mono>
        </div>
        <WalletBadge />
        <Link
          href="/dashboard"
          style={{
            fontSize: 11,
            color: tokens.emerald,
            border: `1px solid ${tokens.emerald}40`,
            padding: "3px 8px",
            borderRadius: 4,
          }}
        >
          → Indexer
        </Link>
      </div>
    </div>
  );
}
