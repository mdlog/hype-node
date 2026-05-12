// Snapshot serialization helpers — pure transforms over UserPortfolio.
//
// Keeps `lib/api/portfolio.ts` (the source-of-truth fetcher) free of any
// snapshot-specific shape so other surfaces (live view, agent context,
// chat) can keep consuming UserPortfolio unchanged. We only need a small
// projection for snapshot rows: the on-chain registry is high-cardinality
// and we don't want every change in the hot fetch path to invalidate the
// historical row schema.

import { getCurrencySnapshot } from "@/lib/api/sosovalue";
import { listAllCurrencies } from "@/lib/api/sosovalue/tokens";
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
 * Map of `symbol.toUpperCase()` → current USD price. Used to price spot
 * balances inside `buildSnapshotPositions`. Built via `buildPriceLookup`
 * once per snapshot batch — callers pass a single lookup across many
 * wallets so we avoid N×M SoSoValue calls.
 */
export type PriceLookup = Map<string, number>;

/**
 * Resolve symbol → USD price for the given list of symbols. Walks the
 * SoSoValue `/currencies` universe once to find currency_ids, then fetches
 * `/currencies/{id}/market-snapshot` per matched id in parallel. Both calls
 * share the singleton request cache + token bucket, so a repeated call
 * within `SOSOVALUE_CACHE_TTL_MS` is effectively free.
 *
 * Returns a `Map` keyed by uppercased symbol. Missing or unpriced symbols
 * simply don't appear in the map — `buildSnapshotPositions` then leaves
 * those positions at `usd_value: null` ("unpriced" in the UI).
 */
export async function buildPriceLookup(
  symbols: readonly string[],
): Promise<PriceLookup> {
  const out: PriceLookup = new Map();
  if (symbols.length === 0) return out;

  // Dedup + uppercase. Reasoning about prices is always case-insensitive,
  // and SoSoValue's symbol field is canonical-upper for nearly every token
  // (rare exceptions are still uniquely matched once we uppercase both sides).
  const wanted = new Set<string>();
  for (const s of symbols) {
    const upper = (s ?? "").trim().toUpperCase();
    if (upper) wanted.add(upper);
  }
  if (wanted.size === 0) return out;

  let universe: Awaited<ReturnType<typeof listAllCurrencies>>;
  try {
    universe = await listAllCurrencies();
  } catch {
    // Universe fetch failed — degrade to "no prices". Callers already
    // tolerate null usd_values, so we return an empty map rather than
    // throw and abort the whole snapshot.
    return out;
  }

  const idBySymbol = new Map<string, string>();
  for (const c of universe) {
    if (c.symbol && c.currency_id) {
      const upper = c.symbol.toUpperCase();
      // First match wins — universe is roughly mcap-sorted, so the major
      // listing for an ambiguous symbol (e.g. "USDC" → Circle's USDC, not
      // a bridged variant) lands first.
      if (!idBySymbol.has(upper)) idBySymbol.set(upper, c.currency_id);
    }
  }

  const targets: Array<{ symbol: string; id: string }> = [];
  for (const sym of wanted) {
    const id = idBySymbol.get(sym);
    if (id) targets.push({ symbol: sym, id });
  }

  const results = await Promise.allSettled(
    targets.map(async (t) => ({
      symbol: t.symbol,
      price: (await getCurrencySnapshot(t.id)).price,
    })),
  );
  for (const r of results) {
    if (r.status === "fulfilled" && Number.isFinite(r.value.price)) {
      out.set(r.value.symbol, r.value.price);
    }
  }
  return out;
}

/**
 * Collect every spot-balance symbol across a batch of portfolios. The cron
 * route uses this to pre-aggregate the price-lookup target set in one pass,
 * then build one shared `PriceLookup` for the whole batch (vs N lookups,
 * one per wallet).
 */
export function collectSpotSymbols(portfolios: readonly UserPortfolio[]): string[] {
  const set = new Set<string>();
  for (const p of portfolios) {
    for (const b of p.sodex.balances ?? []) {
      if (b.asset) set.add(b.asset);
    }
  }
  return Array.from(set);
}

/**
 * Project a UserPortfolio into the flat positions list we persist. Order:
 * spot balances first (sorted by asset), then published indices (in their
 * registry order). Stable ordering matters for diffing across snapshots.
 *
 * Pass a `PriceLookup` (built via `buildPriceLookup`) to attach USD values
 * to each spot balance. Indices still resolve to `usd_value: null` because
 * on-chain NAV indexing lands in Wave 2 with the vault contract.
 */
export function buildSnapshotPositions(
  p: UserPortfolio,
  prices?: PriceLookup,
): SnapshotPosition[] {
  const spots: SnapshotPosition[] = (p.sodex.balances ?? [])
    .slice()
    .sort((a, b) => a.asset.localeCompare(b.asset))
    .map((b: SpotBalance) => {
      const total = parseFloat(b.total);
      const price = prices?.get(b.asset.toUpperCase());
      const usd_value =
        price !== undefined && Number.isFinite(total) && Number.isFinite(price)
          ? total * price
          : null;
      return {
        kind: "spot" as const,
        asset: b.asset,
        free: b.free,
        locked: b.locked,
        total: b.total,
        usd_value,
      };
    });

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
