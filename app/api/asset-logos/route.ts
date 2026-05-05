import { NextResponse, type NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = false;

/**
 * Asset-logo lookup, batched + cached.
 *
 * GET /api/asset-logos?ids=filecoin,render,akash-network
 *   → { filecoin: "https://...", render: "https://...", "akash-network": null }
 *
 * Pulls from CoinGecko's `/coins/markets` endpoint (free tier, ~30 req/min)
 * and caches each `id → url` for 24h in a process-global map. Misses (ids
 * CoinGecko doesn't recognize) are negative-cached for 1h to avoid retry
 * storms on typoed slugs. Fan-out to 8 constituents costs one upstream
 * request after the first warm-up.
 *
 * The cache lives on `globalThis` so Next.js HMR + route-handler isolation
 * don't recreate it on every render in dev.
 */

type CacheEntry = { url: string | null; expiresAt: number };
type DirState = {
  // Lowercased name → canonical CoinGecko id (e.g., "bitcoin" → "bitcoin",
  // "the sandbox" → "the-sandbox", "bittorrent" → "bittorrent-2").
  byName: Map<string, string>;
  // Lowercased symbol → id (last resort; symbols collide so first-wins).
  bySymbol: Map<string, string>;
  // All known canonical ids — used to confirm a passed slug really exists.
  ids: Set<string>;
  expiresAt: number;
  loading: Promise<void> | null;
};
type State = { cache: Map<string, CacheEntry>; dir: DirState };

const G = globalThis as unknown as { __assetLogos?: State };
const state: State = (G.__assetLogos ??= {
  cache: new Map(),
  dir: {
    byName: new Map(),
    bySymbol: new Map(),
    ids: new Set(),
    expiresAt: 0,
    loading: null,
  },
});

const HIT_TTL_MS = 24 * 60 * 60 * 1000; // 24h — logos basically never change
const MISS_TTL_MS = 30 * 60 * 1000; // 30min — short enough to retry after a
                                    // bad slug derivation gets fixed in the
                                    // remap table or the directory refreshes.
const DIR_TTL_MS = 24 * 60 * 60 * 1000; // 24h — CG's coin list is stable.

// Hand-curated remaps for the small set of cases that don't resolve via the
// directory (e.g., common symbol-only slugs). The directory does most of the
// work now; this stays for symbol-style aliases the directory wouldn't
// catch via name match.
const SLUG_REMAP: Record<string, string> = {
  render: "render-token",
  rndr: "render-token",
  "theta-network": "theta-token",
  ssv: "ssv-network",
  creditcoin: "creditcoin-2",
};

/**
 * Lazily fetch CoinGecko's full coin list (~12k entries) so we can resolve
 * project names to canonical CG ids. Without this the route was sending
 * `bittorrent` (auto-derived slug) to /coins/markets and getting silently
 * dropped because the canonical id is `bittorrent-2`. With the directory
 * we look up by name first and pick the right id.
 *
 * Cached for 24h server-side; concurrent callers share the in-flight load.
 */
async function ensureDirectory(): Promise<void> {
  const dir = state.dir;
  if (dir.expiresAt > Date.now() && dir.ids.size > 0) return;
  if (dir.loading) return dir.loading;
  dir.loading = (async () => {
    try {
      const res = await fetch("https://api.coingecko.com/api/v3/coins/list", {
        cache: "no-store",
        headers: { accept: "application/json" },
      });
      if (!res.ok) {
        console.warn(`[asset-logos] coin-list ${res.status}`);
        return;
      }
      const list = (await res.json()) as Array<{
        id: string;
        symbol: string;
        name: string;
      }>;
      const byName = new Map<string, string>();
      const bySymbol = new Map<string, string>();
      const ids = new Set<string>();
      for (const coin of list) {
        ids.add(coin.id);
        // First occurrence wins — CG returns roughly market-cap order so the
        // canonical "Bitcoin" beats forks like "BitcoinX".
        const nameKey = coin.name.toLowerCase();
        if (!byName.has(nameKey)) byName.set(nameKey, coin.id);
        const symKey = coin.symbol.toLowerCase();
        if (!bySymbol.has(symKey)) bySymbol.set(symKey, coin.id);
      }
      dir.byName = byName;
      dir.bySymbol = bySymbol;
      dir.ids = ids;
      dir.expiresAt = Date.now() + DIR_TTL_MS;
    } catch (err) {
      console.warn("[asset-logos] coin-list fetch failed", err);
    } finally {
      dir.loading = null;
    }
  })();
  return dir.loading;
}

/**
 * Resolve a SoSoValue-style slug ("the-sandbox", "bittorrent") to the
 * canonical CoinGecko id ("the-sandbox", "bittorrent-2"). Tries in order:
 *   1. SLUG_REMAP — explicit overrides
 *   2. Direct id match in the directory — slug is already canonical
 *   3. Hyphen→space → name match in the directory
 *   4. Symbol match — last resort, may collide
 *   5. Return slug as-is — let /coins/markets confirm or omit
 */
function toCoinGeckoSlug(slug: string): string {
  const remapped = SLUG_REMAP[slug];
  if (remapped) return remapped;
  const dir = state.dir;
  if (dir.ids.has(slug)) return slug;
  const nameGuess = slug.replace(/-/g, " ");
  const byName = dir.byName.get(nameGuess);
  if (byName) return byName;
  const bySymbol = dir.bySymbol.get(slug);
  if (bySymbol) return bySymbol;
  return slug;
}

function fresh(entry: CacheEntry | undefined): boolean {
  return !!entry && entry.expiresAt > Date.now();
}

export async function GET(req: NextRequest) {
  const idsParam = req.nextUrl.searchParams.get("ids");
  if (!idsParam) {
    return NextResponse.json({}, { status: 200 });
  }

  // Warm the CoinGecko coin directory so name-based slug resolution can run
  // (`bittorrent` → `bittorrent-2`, etc). Awaited so cold first hit gets the
  // benefit too — the load takes ~300ms but only fires once per 24h.
  await ensureDirectory();

  // CoinGecko ids are lowercase slugs. Normalize + dedup.
  const ids = Array.from(
    new Set(
      idsParam
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    ),
  );

  // Always key the response by the *requested* (SoSoValue) slug, but
  // dispatch the upstream request using the CoinGecko-canonical slug.
  // Cache entries are keyed by the SoSoValue slug so subsequent reads
  // resolve without re-applying the remap.
  const result: Record<string, string | null> = {};
  const missingSosoSlugs: string[] = [];
  const sosoToCg: Record<string, string> = {};
  for (const id of ids) {
    const cached = state.cache.get(id);
    // If we have a fresh negative hit (cached null) BUT the slug now has
    // a remap entry it didn't have when we cached, treat as a miss so the
    // remap can take effect immediately. Otherwise users would see
    // missing logos for an hour after a remap edit.
    const remapped = SLUG_REMAP[id];
    const staleNegativeWithNewRemap =
      fresh(cached) && cached!.url === null && remapped !== undefined;
    if (fresh(cached) && !staleNegativeWithNewRemap) {
      result[id] = cached!.url;
    } else {
      missingSosoSlugs.push(id);
      sosoToCg[id] = toCoinGeckoSlug(id);
    }
  }

  if (missingSosoSlugs.length > 0) {
    const cgIds = Array.from(new Set(Object.values(sosoToCg)));
    try {
      const url =
        `https://api.coingecko.com/api/v3/coins/markets` +
        `?vs_currency=usd&ids=${cgIds.join(",")}&per_page=250&page=1&sparkline=false`;
      const res = await fetch(url, {
        cache: "no-store",
        headers: { accept: "application/json" },
      });
      if (res.ok) {
        const data = (await res.json()) as Array<{ id: string; image: string }>;
        // Index CoinGecko's response by its canonical id, then map back
        // to our SoSoValue-keyed result.
        const byCg: Record<string, string> = {};
        for (const coin of data) byCg[coin.id] = coin.image;
        const expiresAt = Date.now() + HIT_TTL_MS;
        for (const sosoId of missingSosoSlugs) {
          const cgId = sosoToCg[sosoId];
          const url = byCg[cgId] ?? null;
          state.cache.set(sosoId, {
            url,
            expiresAt: url ? expiresAt : Date.now() + MISS_TTL_MS,
          });
          result[sosoId] = url;
        }
      } else {
        // Upstream failure (most often a 429 rate-limit on free tier). Don't
        // poison the cache — return null for this round so the next request
        // retries, but log a warn so it's traceable.
        console.warn(`[asset-logos] CoinGecko ${res.status}`);
        for (const id of missingSosoSlugs) {
          if (!(id in result)) result[id] = null;
        }
      }
    } catch (err) {
      console.warn("[asset-logos] fetch failed", err);
      for (const id of missingSosoSlugs) {
        if (!(id in result)) result[id] = null;
      }
    }
  }

  return NextResponse.json(result, {
    headers: {
      // Encourage browser/edge caches to hold the JSON for an hour. The
      // server cache holds longer (24h on hits) so even if the browser
      // discards we don't re-hit CoinGecko.
      "cache-control": "public, max-age=3600, stale-while-revalidate=86400",
    },
  });
}
