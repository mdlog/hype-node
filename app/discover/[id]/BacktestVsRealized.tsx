"use client";

// BacktestVsRealized — two-column card comparing backtest "promise" (at publish)
// vs realized execution stats (from pt_rebalances since going live).
//
// Honesty rule: when there are no rebalances, we MUST show the empty-state
// message — we never fabricate realized numbers.

import { Label, Metric, Card, Mono, Tag } from "@/components/ui";
import { tokens } from "@/lib/tokens";
import { realizedFromRebalances } from "@/lib/track-record/aggregate";
import type { PtRebalanceRow } from "@/lib/supabase/types";

type Props = {
  /** Backtest snapshot stored at publish time (the "promise"). */
  backtestReturn: number | null;
  backtestSharpe: number | null;
  backtestMaxDd: number | null;
  /** Live rebalance rows for this ticker (may be empty). */
  rebalances: PtRebalanceRow[];
  /** Whether this is demo seed data. */
  isDemo?: boolean;
};

function pct(n: number | null | undefined, digits = 2): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${(n * 100).toFixed(digits)}%`;
}

function num(n: number | null | undefined, digits = 2): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

function KpiCol({ k, v, c }: { k: string; v: string; c: string }) {
  return (
    <div
      style={{
        flex: 1,
        padding: "10px 12px",
        background: tokens.bgElev2,
        border: `1px solid ${tokens.border}`,
        borderRadius: 6,
      }}
    >
      <Label>{k}</Label>
      <Metric v={v} color={c} size={18} style={{ marginTop: 4 }} />
    </div>
  );
}

export function BacktestVsRealized({
  backtestReturn,
  backtestSharpe,
  backtestMaxDd,
  rebalances,
  isDemo = false,
}: Props) {
  const realized = realizedFromRebalances(rebalances);
  const hasData = realized.cycles > 0;

  return (
    <Card pad={16}>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <Label>PROMISE vs REALIZED</Label>
        {isDemo && (
          <Tag small color={tokens.amber}>
            DEMO data
          </Tag>
        )}
      </div>

      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: "1fr 1fr" }}
      >
        {/* Column 1: At Publish (backtest snapshot) */}
        <div className="flex flex-col gap-2">
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.08em",
              color: tokens.textFaint,
              textTransform: "uppercase",
              marginBottom: 2,
            }}
          >
            At Publish
          </div>
          <div className="flex gap-2">
            <KpiCol
              k="RETURN"
              v={pct(backtestReturn)}
              c={(backtestReturn ?? 0) >= 0 ? tokens.emerald : tokens.red}
            />
          </div>
          <div className="flex gap-2">
            <KpiCol k="SHARPE" v={num(backtestSharpe)} c={tokens.cyan} />
            <KpiCol k="MAX DD" v={pct(backtestMaxDd)} c={tokens.amber} />
          </div>
          <Mono size={10} color={tokens.textFaint} className="block mt-1">
            backtest snapshot · at publish
          </Mono>
        </div>

        {/* Column 2: Since Live (realized) */}
        <div className="flex flex-col gap-2">
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.08em",
              color: tokens.textFaint,
              textTransform: "uppercase",
              marginBottom: 2,
            }}
          >
            Since Live
          </div>

          {hasData ? (
            <>
              <div className="flex gap-2">
                <KpiCol
                  k="CYCLES"
                  v={realized.cycles.toString()}
                  c={tokens.cyan}
                />
              </div>
              <div className="flex gap-2">
                <KpiCol
                  k="PLACED"
                  v={realized.placed.toString()}
                  c={tokens.emerald}
                />
                <KpiCol
                  k="SKIPPED"
                  v={realized.skipped.toString()}
                  c={tokens.amber}
                />
              </div>
              {realized.emergencies > 0 && (
                <Mono size={10} color={tokens.red} className="block">
                  {realized.emergencies} emergency exit
                  {realized.emergencies > 1 ? "s" : ""}
                </Mono>
              )}
              <Mono size={10} color={tokens.textFaint} className="block mt-1">
                {realized.errors > 0 ? `${realized.errors} error${realized.errors > 1 ? "s" : ""} · ` : ""}
                live execution data
              </Mono>
            </>
          ) : (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                flex: 1,
                padding: "16px 4px",
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: tokens.textDim,
                  marginBottom: 4,
                }}
              >
                Awaiting live execution data
              </div>
              <Mono size={10} color={tokens.textFaint} className="block">
                this index has not run live yet — realized stats will appear once
                the agent executes its first rebalance cycle
              </Mono>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
