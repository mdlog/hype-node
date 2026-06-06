// Pure aggregation helpers for strategy track-record — no I/O, no side effects.
// All inputs are plain row objects; outputs are plain value objects.
//
// Score formula (for leaderboard ranking):
//   score = avgBacktestSharpe * 0.6 + log1p(cycles) * 0.4
// A creator with a higher sharpe AND more live cycles ranks first. The weights
// are intentionally transparent and documented here so the UI can note them.

import type { PtRebalanceRow } from "@/lib/supabase/types";
import type { PbProposalRow } from "@/lib/supabase/types";

export type RealizedStats = {
  /** Number of rebalance cycles on record. */
  cycles: number;
  /** Total SoDEX orders placed across all cycles. */
  placed: number;
  /** Total SoDEX orders skipped across all cycles. */
  skipped: number;
  /** Total SoDEX orders errored across all cycles. */
  errors: number;
  /** Number of cycles that triggered an emergency exit. */
  emergencies: number;
};

/**
 * Aggregate pt_rebalances rows into realized execution stats.
 * Returns zeros for empty input — callers should show the honest empty-state
 * ("awaiting live execution data") when cycles === 0.
 */
export function realizedFromRebalances(rebalances: PtRebalanceRow[]): RealizedStats {
  let placed = 0;
  let skipped = 0;
  let errors = 0;
  let emergencies = 0;

  for (const r of rebalances) {
    placed += r.sodex_placed;
    skipped += r.sodex_skipped;
    errors += r.sodex_errors;
    if (r.emergency) emergencies += 1;
  }

  return {
    cycles: rebalances.length,
    placed,
    skipped,
    errors,
    emergencies,
  };
}

export type LeaderboardRow = {
  /** 1-based rank. */
  rank: number;
  creator: string;
  /** Number of published proposals by this creator. */
  publishedCount: number;
  /** Average backtest Sharpe across all proposals (null-safe). */
  avgBacktestSharpe: number | null;
  /** Number of live rebalance cycles attributed to this creator. */
  cycles: number;
  /** Total SoDEX orders placed across all cycles. */
  placed: number;
  /** Internal ranking score — documented in module header. */
  score: number;
};

/**
 * Rank creators by backtest quality and live execution volume.
 *
 * Score = avgBacktestSharpe * 0.6 + log1p(cycles) * 0.4
 *
 * Proposals without a Sharpe are excluded from the average. Creators with no
 * proposals are excluded from the leaderboard entirely.
 */
export function creatorLeaderboard(
  proposals: PbProposalRow[],
  rebalances: PtRebalanceRow[],
): LeaderboardRow[] {
  // Build a map of creator → proposals.
  const byCreator = new Map<string, PbProposalRow[]>();
  for (const p of proposals) {
    const key = p.creator_address;
    if (!byCreator.has(key)) byCreator.set(key, []);
    byCreator.get(key)!.push(p);
  }

  // Build a map of creator → rebalances.
  const rebalancesByCreator = new Map<string, PtRebalanceRow[]>();
  for (const r of rebalances) {
    const key = r.creator_address ?? "";
    if (!key) continue;
    if (!rebalancesByCreator.has(key)) rebalancesByCreator.set(key, []);
    rebalancesByCreator.get(key)!.push(r);
  }

  // Build rows.
  const rows: Omit<LeaderboardRow, "rank">[] = [];
  for (const [creator, props] of byCreator.entries()) {
    const sharpes = props
      .map((p) => p.backtest_sharpe)
      .filter((s): s is number => typeof s === "number" && Number.isFinite(s));
    const avgBacktestSharpe =
      sharpes.length > 0
        ? sharpes.reduce((a, b) => a + b, 0) / sharpes.length
        : null;

    const creatorRebalances = rebalancesByCreator.get(creator) ?? [];
    const cycles = creatorRebalances.length;
    const placed = creatorRebalances.reduce((s, r) => s + r.sodex_placed, 0);

    const score =
      (avgBacktestSharpe ?? 0) * 0.6 + Math.log1p(cycles) * 0.4;

    rows.push({
      creator,
      publishedCount: props.length,
      avgBacktestSharpe,
      cycles,
      placed,
      score,
    });
  }

  // Sort descending by score; break ties alphabetically by creator address.
  rows.sort((a, b) => {
    const scoreDiff = b.score - a.score;
    if (scoreDiff !== 0) return scoreDiff;
    return a.creator < b.creator ? -1 : a.creator > b.creator ? 1 : 0;
  });

  // Attach 1-based rank.
  return rows.map((r, i) => ({ ...r, rank: i + 1 }));
}
