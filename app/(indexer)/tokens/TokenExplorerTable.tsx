"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { Card, Label, Mono, Btn, ProjectLogo } from "@/components/ui";
import { tokens } from "@/lib/tokens";
import { getCurrencySnapshot, type CurrencySnapshot } from "@/lib/api/sosovalue";
import type { CurrencyListItem } from "@/lib/api/sosovalue/tokens";

// Page size capped at 20 so each table-page render fans out at most 20
// snapshot calls to /api/sosovalue. The previous 50 saturated SoSoValue's
// 100 req/min HF tier in one render and the resulting 5xx put the proxy in
// a 5min transient backoff — every subsequent snapshot served 502 until the
// window cleared. 20 keeps a comfortable margin under the per-minute cap.
const PAGE_SIZE = 20;
const CHUNK = 50;

// Snapshots barely change minute-to-minute (price moves are ≤ 2% intraday
// for the typical token). Caching successful snapshots in localStorage for
// 5min cuts repeat-load fan-out to zero across page refreshes and tab
// re-opens. Failed snapshots are NOT cached so a transient 5xx doesn't
// stick to the user's browser.
const SNAPSHOT_CACHE_TTL_MS = 5 * 60_000;
const SNAPSHOT_CACHE_PREFIX = "soso_snap:";

type CachedSnapshot = { data: CurrencySnapshot; exp: number };

function readCachedSnapshot(id: string): CurrencySnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SNAPSHOT_CACHE_PREFIX + id);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CachedSnapshot;
    if (!entry || typeof entry.exp !== "number" || entry.exp < Date.now()) {
      window.localStorage.removeItem(SNAPSHOT_CACHE_PREFIX + id);
      return null;
    }
    return entry.data;
  } catch {
    return null;
  }
}

function writeCachedSnapshot(id: string, data: CurrencySnapshot): void {
  if (typeof window === "undefined") return;
  try {
    const entry: CachedSnapshot = { data, exp: Date.now() + SNAPSHOT_CACHE_TTL_MS };
    window.localStorage.setItem(SNAPSHOT_CACHE_PREFIX + id, JSON.stringify(entry));
  } catch {
    // localStorage may throw on quota exceeded / private mode — silently drop
    // the cache write rather than break the UI for it.
  }
}

type Snap = CurrencySnapshot | "loading" | "error" | undefined;

type SortKey = "default" | "rank" | "mcap" | "vol" | "change" | "symbol";

const SORT_LABELS: Record<SortKey, string> = {
  default: "Default",
  rank: "Rank ↓",
  mcap: "Mcap ↓",
  vol: "Volume ↓",
  change: "24h ↓",
  symbol: "Symbol A-Z",
};

// Compact USD formatter — "$1.62T", "$234B", "$8.4M". Mirrors the convention
// used elsewhere in the dashboard so cell widths stay predictable.
function fmtUsdCompact(n: number | undefined): string {
  if (!Number.isFinite(n) || n === undefined || n === 0) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(2)}K`;
  return `$${n.toFixed(2)}`;
}

// Per-magnitude precision so $0.000023 renders without losing significant
// digits and $80,928.7 doesn't carry pointless decimals.
function fmtPrice(n: number | undefined): string {
  if (!Number.isFinite(n) || n === undefined || n === 0) return "—";
  if (n < 0.0001) return `$${n.toFixed(8)}`;
  if (n < 0.01) return `$${n.toFixed(6)}`;
  if (n < 1) return `$${n.toFixed(4)}`;
  if (n < 100) return `$${n.toFixed(3)}`;
  if (n < 1000) return `$${n.toFixed(2)}`;
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function fmtPct(n: number | undefined): string {
  if (!Number.isFinite(n) || n === undefined) return "—";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${(n * 100).toFixed(2)}%`;
}

export function TokenExplorerTable({
  rows,
  initialSnapshots = {},
}: {
  rows: CurrencyListItem[];
  // Server-rendered snapshots for the default first page (see tokens/page.tsx).
  // Seeding these means the default view fetches nothing client-side — the
  // snapshot fan-out below only runs for ids still `undefined` (pages 2+ / sorts).
  initialSnapshots?: Record<string, CurrencySnapshot>;
}) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortKey>("default");
  const [snapshots, setSnapshots] = useState<Record<string, Snap>>(
    () => ({ ...initialSnapshots }),
  );

  // Search filter first — same behavior as before.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.symbol.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q) ||
        r.currency_id.toLowerCase().includes(q),
    );
  }, [rows, query]);

  // Sort using whatever snapshot fields are loaded. Tokens missing the
  // sorted field sink to the bottom (sort key falls back to +Infinity for
  // ascending-style "missing data last" behavior).
  const sorted = useMemo(() => {
    if (sort === "default") return filtered;
    const arr = [...filtered];
    if (sort === "symbol") {
      arr.sort((a, b) => a.symbol.localeCompare(b.symbol));
      return arr;
    }
    arr.sort((a, b) => {
      const sa = snapshots[a.currency_id];
      const sb = snapshots[b.currency_id];
      const va = typeof sa === "object" ? extractSortValue(sa, sort) : undefined;
      const vb = typeof sb === "object" ? extractSortValue(sb, sort) : undefined;
      // For "rank" smaller is better (rank #1 first); everything else is
      // bigger-is-first (mcap/vol/24h descending).
      if (sort === "rank") {
        return (va ?? Number.POSITIVE_INFINITY) - (vb ?? Number.POSITIVE_INFINITY);
      }
      return (vb ?? Number.NEGATIVE_INFINITY) - (va ?? Number.NEGATIVE_INFINITY);
    });
    return arr;
  }, [filtered, sort, snapshots]);

  useEffect(() => {
    setPage(1);
  }, [query, sort]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const start = (safePage - 1) * PAGE_SIZE;
  const slice = sorted.slice(start, start + PAGE_SIZE);

  // ---- Snapshot fan-out for the visible page ----
  // For each visible row we first try the localStorage cache (5min TTL),
  // and only fall back to /api/sosovalue for rows that are missing or
  // expired. This cuts the fan-out to zero across page refreshes when the
  // cache is warm, and matches the in-memory state shape so the rest of
  // the table renders identically regardless of cache hits.
  useEffect(() => {
    const visibleIds = slice
      .map((r) => r.currency_id)
      .filter((id) => snapshots[id] === undefined);
    if (visibleIds.length === 0) return;

    const fromCache: Record<string, CurrencySnapshot> = {};
    const toFetch: string[] = [];
    for (const id of visibleIds) {
      const cached = readCachedSnapshot(id);
      if (cached) fromCache[id] = cached;
      else toFetch.push(id);
    }

    setSnapshots((prev) => {
      const next = { ...prev };
      for (const [id, snap] of Object.entries(fromCache)) next[id] = snap;
      for (const id of toFetch) next[id] = "loading";
      return next;
    });

    if (toFetch.length === 0) return;

    let cancelled = false;
    void Promise.allSettled(
      toFetch.map(async (id) => {
        try {
          const snap = await getCurrencySnapshot(id);
          return { id, snap };
        } catch {
          return { id, snap: null };
        }
      }),
    ).then((results) => {
      if (cancelled) return;
      setSnapshots((prev) => {
        const next = { ...prev };
        for (const r of results) {
          if (r.status !== "fulfilled") continue;
          const { id, snap } = r.value;
          // Treat all-zero snapshot as an error / empty so synthetic fallbacks
          // (which return all zeros when SoSoValue has no row for an id)
          // don't pollute the table with $0.00 cells. Real tokens always have
          // marketcap_rank ≥ 1.
          if (!snap || snap.marketcap_rank === 0) {
            next[id] = "error";
          } else {
            next[id] = snap;
            writeCachedSnapshot(id, snap);
          }
        }
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safePage, sorted]);

  // Logo lookup — unchanged from previous version.
  const [logos, setLogos] = useState<Record<string, string | null>>({});
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      const symbols = Array.from(
        new Set(slice.map((r) => r.symbol.toLowerCase()).filter(Boolean)),
      );
      if (symbols.length === 0) return;
      const chunks: string[][] = [];
      for (let i = 0; i < symbols.length; i += CHUNK) {
        chunks.push(symbols.slice(i, i + CHUNK));
      }
      Promise.all(
        chunks.map((c) =>
          fetch(`/api/asset-logos?ids=${encodeURIComponent(c.join(","))}`, {
            cache: "force-cache",
          })
            .then((r) => r.json() as Promise<Record<string, string | null>>)
            .catch(() => ({}) as Record<string, string | null>),
        ),
      ).then((results) => {
        if (cancelled) return;
        const merged: Record<string, string | null> = Object.assign({}, ...results);
        setLogos((prev) => ({ ...prev, ...merged }));
      });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safePage, sorted]);

  const GRID = "44px 48px 1.4fr 1.1fr 0.9fr 1.1fr 1.1fr 60px";

  return (
    <Card pad={0} className="flex-1 overflow-hidden flex flex-col">
      {/* Toolbar */}
      <div
        className="flex items-center gap-3"
        style={{
          padding: "10px 16px",
          borderBottom: `1px solid ${tokens.border}`,
          background: tokens.bgElev2,
        }}
      >
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(1);
          }}
          placeholder="Search by symbol, name, or id"
          className="font-mono"
          style={{
            flex: 1,
            height: 30,
            background: tokens.bgElev,
            border: `1px solid ${tokens.border}`,
            borderRadius: 5,
            padding: "0 10px",
            fontSize: 12,
            color: tokens.text,
            outline: "none",
            letterSpacing: "-0.01em",
          }}
        />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="font-mono"
          style={{
            height: 30,
            background: tokens.bgElev,
            border: `1px solid ${tokens.border}`,
            borderRadius: 5,
            padding: "0 8px",
            fontSize: 11,
            color: tokens.text,
            outline: "none",
            cursor: "pointer",
          }}
        >
          {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
            <option key={k} value={k}>
              {SORT_LABELS[k]}
            </option>
          ))}
        </select>
        <Mono size={10}>
          {sorted.length} of {rows.length}
        </Mono>
      </div>

      {/* Header row */}
      <div
        className="grid"
        style={{
          gridTemplateColumns: GRID,
          padding: "10px 16px",
          gap: 12,
          borderBottom: `1px solid ${tokens.border}`,
          background: tokens.bgElev2,
        }}
      >
        <Label>#</Label>
        <Label>{" "}</Label>
        <Label>NAME</Label>
        <Label>PRICE</Label>
        <Label>24H</Label>
        <Label>MCAP</Label>
        <Label>VOLUME 24H</Label>
        <Label>{" "}</Label>
      </div>

      {/* Rows */}
      <div className="flex-1 overflow-y-auto">
        {slice.map((r) => {
          const snap = snapshots[r.currency_id];
          const isObj = typeof snap === "object" && snap !== null;
          const rank = isObj ? snap.marketcap_rank : undefined;
          const price = isObj ? snap.price : undefined;
          const change = isObj ? snap.change_pct_24h : undefined;
          const mcap = isObj ? snap.marketcap : undefined;
          const vol = isObj ? snap.turnover_24h : undefined;
          const changeColor =
            change === undefined
              ? tokens.textFaint
              : change > 0
                ? tokens.emerald
                : change < 0
                  ? tokens.rose
                  : tokens.textDim;

          return (
            <Link
              key={r.currency_id}
              href={`/tokens/${r.currency_id}`}
              className="grid items-center"
              style={{
                gridTemplateColumns: GRID,
                padding: "10px 16px",
                gap: 12,
                borderBottom: `1px solid ${tokens.borderFaint}`,
                textDecoration: "none",
              }}
            >
              <Mono size={11} color={tokens.textFaint}>
                {rank ? `#${rank}` : snap === "loading" ? "…" : "—"}
              </Mono>
              <ProjectLogo
                name={r.name || r.symbol}
                size={22}
                logoUrl={logos[r.symbol.toLowerCase()] ?? null}
              />
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 13,
                    color: tokens.text,
                    fontWeight: 500,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {r.name}
                </div>
                <Mono size={10} color={tokens.textDim}>
                  {r.symbol.toUpperCase()}
                </Mono>
              </div>
              <Mono size={12} color={tokens.text}>
                {fmtPrice(price)}
              </Mono>
              <Mono size={11.5} color={changeColor}>
                {fmtPct(change)}
              </Mono>
              <Mono size={11.5} color={tokens.text}>
                {fmtUsdCompact(mcap)}
              </Mono>
              <Mono size={11.5} color={tokens.textDim}>
                {fmtUsdCompact(vol)}
              </Mono>
              <div style={{ textAlign: "right" }}>
                <Mono size={11} color={tokens.textFaint}>
                  →
                </Mono>
              </div>
            </Link>
          );
        })}
        {slice.length === 0 && (
          <div style={{ padding: 24, textAlign: "center" }}>
            <Mono size={11}>No matches for &ldquo;{query}&rdquo;</Mono>
          </div>
        )}
      </div>

      {/* Footer */}
      <div
        className="flex justify-between items-center"
        style={{
          padding: "10px 16px",
          borderTop: `1px solid ${tokens.border}`,
          background: tokens.bgElev2,
        }}
      >
        <Mono size={10}>
          page {safePage} of {pageCount} · {PAGE_SIZE} per page
        </Mono>
        <div className="flex gap-1">
          <Btn small onClick={() => setPage((p) => Math.max(1, p - 1))}>
            ← Prev
          </Btn>
          <Btn small onClick={() => setPage((p) => Math.min(pageCount, p + 1))}>
            Next →
          </Btn>
        </div>
      </div>
    </Card>
  );
}

// Pull the field corresponding to the active sort key, returning undefined
// when the snapshot is missing (so it sinks to the bottom in the comparator).
function extractSortValue(snap: CurrencySnapshot, sort: SortKey): number | undefined {
  switch (sort) {
    case "rank":
      return snap.marketcap_rank > 0 ? snap.marketcap_rank : undefined;
    case "mcap":
      return snap.marketcap;
    case "vol":
      return snap.turnover_24h;
    case "change":
      return snap.change_pct_24h;
    default:
      return undefined;
  }
}
