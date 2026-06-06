"use client";

// CreatorLeaderboard — ranked table of strategy creators.
// Displayed above the discover card grid on /discover.
// Shows backtest quality + live execution volume to surface the most
// battle-tested creators.

import { Card, Label, Metric, Mono, Tag } from "@/components/ui";
import { tokens } from "@/lib/tokens";
import { creatorLeaderboard } from "@/lib/track-record/aggregate";
import type { PtRebalanceRow } from "@/lib/supabase/types";
import type { PbProposalRow } from "@/lib/supabase/types";
import Link from "next/link";

type Props = {
  proposals: PbProposalRow[];
  rebalances: PtRebalanceRow[];
  isDemo?: boolean;
};

function num(n: number | null | undefined, digits = 2): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

function shortAddr(addr: string): string {
  if (addr.length < 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function CreatorLeaderboard({ proposals, rebalances, isDemo = false }: Props) {
  const rows = creatorLeaderboard(proposals, rebalances);

  if (rows.length === 0) return null;

  return (
    <Card pad={0}>
      <div
        className="flex justify-between items-center"
        style={{
          padding: "12px 16px",
          borderBottom: `1px solid ${tokens.border}`,
        }}
      >
        <div className="flex items-center gap-2">
          <Label>CREATOR LEADERBOARD</Label>
          {isDemo && (
            <Tag small color={tokens.amber}>
              DEMO data
            </Tag>
          )}
        </div>
        <Mono size={10} color={tokens.textFaint}>
          ranked by sharpe + live cycles
        </Mono>
      </div>

      {/* Header row */}
      <div
        className="grid"
        style={{
          gridTemplateColumns: "32px 1fr 80px 80px 72px 72px",
          padding: "6px 16px",
          gap: 8,
          borderBottom: `1px solid ${tokens.borderFaint}`,
        }}
      >
        <Label>#</Label>
        <Label>CREATOR</Label>
        <Label>INDICES</Label>
        <Label>SHARPE</Label>
        <Label>CYCLES</Label>
        <Label>PLACED</Label>
      </div>

      {rows.map((row) => (
        <div
          key={row.creator}
          className="grid items-center"
          style={{
            gridTemplateColumns: "32px 1fr 80px 80px 72px 72px",
            padding: "8px 16px",
            gap: 8,
            borderBottom: `1px solid ${tokens.borderFaint}`,
          }}
        >
          <Mono size={11} color={row.rank <= 3 ? tokens.amber : tokens.textFaint}>
            {row.rank}
          </Mono>

          <Link
            href={`/discover?creator=${row.creator.toLowerCase()}`}
            style={{ fontSize: 12, color: tokens.cyan, fontFamily: "monospace" }}
          >
            {shortAddr(row.creator)}
          </Link>

          <Mono size={12} color={tokens.text}>
            {row.publishedCount}
          </Mono>

          <Mono size={12} color={tokens.cyan}>
            {num(row.avgBacktestSharpe)}
          </Mono>

          <Mono size={12} color={row.cycles > 0 ? tokens.emerald : tokens.textFaint}>
            {row.cycles > 0 ? row.cycles : "—"}
          </Mono>

          <Mono size={12} color={row.placed > 0 ? tokens.text : tokens.textFaint}>
            {row.placed > 0 ? row.placed : "—"}
          </Mono>
        </div>
      ))}

      <div style={{ padding: "8px 16px" }}>
        <Mono size={10} color={tokens.textFaint}>
          score = sharpe × 0.6 + log(1 + cycles) × 0.4 · cycles from live agent execution
        </Mono>
      </div>
    </Card>
  );
}
