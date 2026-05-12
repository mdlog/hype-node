// Snapshot serialization helpers — pure transforms over UserPortfolio.
//
// Keeps `lib/api/portfolio.ts` (the source-of-truth fetcher) free of any
// snapshot-specific shape so other surfaces (live view, agent context,
// chat) can keep consuming UserPortfolio unchanged. We only need a small
// projection for snapshot rows: the on-chain registry is high-cardinality
// and we don't want every change in the hot fetch path to invalidate the
// historical row schema.

import type {
  PublishedIndex,
  SpotBalance,
  UserPortfolio,
} from "@/lib/api/portfolio";

/**
 * Single positional row inside a `pf_snapshots.positions` JSONB blob. Two
 * disjoint kinds — spot balances live next to published indices because
 * UI consumers want a single chronological list per snapshot. The `kind`
 * tag is what lets the renderer pick a row template.
 */
export type SnapshotPosition =
  | {
      kind: "spot";
      asset: string;
      free: string;
      locked: string;
      total: string;
      /** USD value if priced — null until per-asset pricing lands (v2). */
      usd_value: number | null;
    }
  | {
      kind: "index";
      index_id: string;
      symbol: string;
      name: string;
      base: string;
      tokens: string[];
      weights_bps: number[];
      mgmt_fee_bps: number;
      perf_fee_bps: number;
      created_at: number;
      /** USD value if priced — null until on-chain NAV indexing lands. */
      usd_value: number | null;
    };

/**
 * Project a UserPortfolio into the flat positions list we persist. Order:
 * spot balances first (sorted by asset), then published indices (in their
 * registry order). Stable ordering matters for diffing across snapshots.
 */
export function buildSnapshotPositions(p: UserPortfolio): SnapshotPosition[] {
  const spots: SnapshotPosition[] = (p.sodex.balances ?? [])
    .slice()
    .sort((a, b) => a.asset.localeCompare(b.asset))
    .map((b: SpotBalance) => ({
      kind: "spot" as const,
      asset: b.asset,
      free: b.free,
      locked: b.locked,
      total: b.total,
      usd_value: null,
    }));

  const indices: SnapshotPosition[] = (p.registry.indices ?? []).map(
    (ix: PublishedIndex) => ({
      kind: "index" as const,
      index_id: ix.id,
      symbol: ix.symbol,
      name: ix.name,
      base: ix.base,
      tokens: ix.tokens,
      weights_bps: ix.weightsBps,
      mgmt_fee_bps: ix.mgmtFeeBps,
      perf_fee_bps: ix.perfFeeBps,
      created_at: ix.createdAt,
      usd_value: null,
    }),
  );

  return [...spots, ...indices];
}

/**
 * Sum priced USD across positions. Returns null when no position is priced
 * yet (rather than 0) so the UI can distinguish "no data" from "empty".
 */
export function computeAumUsd(positions: SnapshotPosition[]): number | null {
  let acc = 0;
  let anyPriced = false;
  for (const p of positions) {
    if (typeof p.usd_value === "number" && Number.isFinite(p.usd_value)) {
      acc += p.usd_value;
      anyPriced = true;
    }
  }
  return anyPriced ? acc : null;
}
