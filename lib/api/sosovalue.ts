// SoSoValue OpenAPI v1 client.
//
// Base: https://openapi.sosovalue.com/openapi/v1
// Auth: header `x-soso-api-key: <YOUR_KEY>` (no signing).
//
// Endpoints used here mirror the public docs at
// https://sosovalue-1.gitbook.io/sosovalue-api-doc — when no key is set every
// method falls back to deterministic synthetic data so the UI works offline.
//
// The agent's "research" loop draws on three modules:
//   - ETF       (/etfs, /etfs/{ticker}/history)        ETF fund-flow signal
//   - Feeds     (/news)                                 news velocity / titles
//   - Currency  (/currencies/sector-spotlight)          sector momentum
//   - Index     (/indices, /indices/{t}/constituents)   SSI reference baskets

import { fakeSeries } from "@/lib/fake-data";

const BASE = process.env.SOSOVALUE_API_BASE ?? "https://openapi.sosovalue.com/openapi/v1";
const KEY = process.env.SOSOVALUE_API_KEY ?? "";

export type Sector =
  | "DePIN"
  | "RWA"
  | "AI"
  | "DeFi"
  | "L2"
  | "Memes"
  | "Gaming"
  | "NFT"
  | string;
export type Window = "1h" | "4h" | "24h" | "7d" | "30d";

// ---------- raw response types (camel-cased copies of the API shapes) ----------

export type EtfListItem = {
  ticker: string;
  name: string;
  exchange: string;
};

export type EtfHistoryRow = {
  date: string;
  ticker: string;
  net_inflow: number;
  cum_inflow: number;
  net_assets: number;
  currency_share: number;
  prem_dsc: number;
  value_traded: number;
  // API quirk: returned as string ("1263693458") even though docs claim number.
  volume: string | number;
};

export type NewsItemRaw = {
  id: string;
  // News titles are nullable on Twitter-sourced rows (the agent should fall
  // back to `content` for those).
  title: string | null;
  content: string | null;
  // Numeric strings ("1777196913000") — parse before using.
  release_time: string | number;
  author: string | null;
  source_link: string | null;
  original_link?: string | null;
  matched_currencies: { id: string; full_name: string; name: string }[] | null;
  tags: string[] | null;
  category?: number;
  impression_count?: string | number;
  like_count?: string | number;
};

export type NewsResponse = {
  page: number;
  page_size: number;
  total: string | number;
  list: NewsItemRaw[];
};

export type SectorSpotlight = {
  // Verified live response shape (2026-04-26): values are decimal fractions
  // (e.g. -0.0357 = −3.57%). The earlier docs showed `24h_change_pct`; the
  // production API actually uses `change_pct_24h`.
  sector: { name: string; change_pct_24h: number; marketcap_dom: number }[];
  spotlight: { name: string; change_pct_24h: number }[];
};

export type IndexConstituent = {
  currency_id: string;
  symbol: string;
  weight: number;
};

export type SsiKline = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

export type SsiSnapshot = {
  price: number;
  "24h_change_pct": number;
  "7day_roi": number;
  "1month_roi": number;
  "3month_roi": number;
  "1year_roi": number;
  ytd: number;
};

export type CurrencySnapshot = {
  price: number;
  change_pct_24h: number;
  turnover_24h: number;
  marketcap: number;
  high_24h: number;
  low_24h: number;
  marketcap_rank: number;
};

export type CurrencyKline = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type EtfSummaryRow = {
  date: string;
  total_net_inflow: number;
  total_value_traded: number;
  total_net_assets: number;
  cum_net_inflow: number;
};

export type EtfMarketSnapshot = {
  date: string;
  ticker: string;
  sponsor_fee: number | string;
  net_inflow: number;
  cum_inflow: number;
  net_assets: number;
  mkt_price: number;
  prem_dsc: number;
  value_traded: number;
  volume: number | string;
};

// Known canonical currency_id values from SSI constituents probe.
// Use these when the path requires the long numeric id format.
export const CURRENCY_ID = {
  btc: "1673723677362319867",
  eth: "1673723677362319868",
  sol: "1673723677362319869",
} as const;

// ---------- adapter shapes consumed by the UI ----------

export type SentimentPoint = {
  asset?: string;
  sector?: Sector;
  score: number;
  delta: number;
  ts: string;
};

export type FundFlowPoint = {
  sector: Sector;
  netInflowUsd: number;
  topAsset: string;
  topAssetFlowUsd: number;
  ts: string;
};

export type NewsItem = {
  id: string;
  title: string;
  source: string;
  sector: Sector;
  sentiment: number;
  importance: "high" | "med" | "low";
  ts: string;
};

// ---------- transport: rate limiter + persistent cache ----------
//
// The Demo tier of the SoSoValue API allows ONE request per minute, total —
// across every endpoint, every caller. Without a coordinator we'd burn the
// quota on the first cold render. This module-level singleton enforces:
//
//   1. Per-path in-memory cache with a long TTL (default 15 min). Once a path
//      is warm, subsequent reads never touch the network until expiry.
//   2. Global token bucket: minimum 60s between any two outbound calls,
//      regardless of which endpoint they hit.
//   3. In-flight dedup: parallel reads for the same path share one promise.
//   4. Stale-on-failure: a 429 / network error returns the previous good
//      payload (if any) rather than collapsing back to synthetic data.
//   5. Error-class backoffs derived from the SoSoValue error envelope (see
//      https://sosovalue-1.gitbook.io/sosovalue-api-doc/error-responses):
//        - 500001 / status>=500          → 5 min  (transient)
//        - 402901 + "monthly" wording    → 6 h    (monthly quota)
//        - 402901 / status=429           → 5 min  (short-window rate limit)
//        - 400101 / 400102 / status=401  → 6 h    (invalid/expired API key,
//                                                  global — no path retries)
//        - 400301 / 400401 / 400402      → 1 h    (per-path negative cache,
//          / status in {403,404}           one path missing ≠ all paths bad)
//
// The state lives in `globalThis` so Next.js HMR + route handler isolation
// don't recreate the limiter on every render.

const MIN_GAP_MS = Number(process.env.SOSOVALUE_MIN_GAP_MS ?? 65_000); // 60s + safety margin
const CACHE_TTL_MS = Number(process.env.SOSOVALUE_CACHE_TTL_MS ?? 15 * 60_000);
// "Monthly quota exceeded" (code 402901, message mentions monthly) → 6h.
const QUOTA_BACKOFF_MS = Number(process.env.SOSOVALUE_QUOTA_BACKOFF_MS ?? 6 * 3600_000);
// Short-window rate limit (402901 without "monthly", or HTTP 429) → 5 min.
const RATE_LIMIT_BACKOFF_MS = Number(process.env.SOSOVALUE_RATE_LIMIT_BACKOFF_MS ?? 5 * 60_000);
// 5xx outages (e.g. 500 code=500001 during a subscription-tier propagation
// delay or temporary degradation): back off 5 min instead of hammering.
const TRANSIENT_BACKOFF_MS = Number(process.env.SOSOVALUE_TRANSIENT_BACKOFF_MS ?? 5 * 60_000);
// Auth errors (400101 invalid key, 400102 expired key, HTTP 401) — won't
// resolve without an env change. Long backoff to avoid log floods.
const AUTH_BACKOFF_MS = Number(process.env.SOSOVALUE_AUTH_BACKOFF_MS ?? 6 * 3600_000);
// 4xx "this path doesn't exist / you can't access it" — cache the negative
// per-path. A missing ticker doesn't mean other endpoints are broken.
const NOT_FOUND_TTL_MS = Number(process.env.SOSOVALUE_NOT_FOUND_TTL_MS ?? 60 * 60_000);

// Per-path TTL overrides matching the upstream refresh frequency documented
// at https://sosovalue-1.gitbook.io/sosovalue-api-doc/endpoint-overview.
// Caching longer than the source refresh is wasteful; caching shorter wastes
// quota. Patterns are checked against the path prefix (case-insensitive).
const PATH_TTL_RULES: Array<[RegExp, number]> = [
  // Real-time refresh upstream → keep cache short (30 s).
  [/\/currencies\/[^/]+\/klines/i, 30_000],
  [/\/crypto-stocks\/[^/]+\/klines/i, 30_000],
  [/\/news(\/(hot|featured|search))?(\?|$)/i, 30_000],
  // 30 s upstream → 60 s client cache (one-tick safety).
  [/\/market-snapshot(\?|$)/i, 60_000],
  [/\/currencies\/[^/]+\/pairs/i, 60_000],
  // 5 min upstream → 5 min client cache.
  [/\/currencies\/[^/]+\/token-economics/i, 300_000],
  // 5 min upstream for currency details (path is /currencies/{id} with no
  // suffix). Keep a generous TTL since these rarely change.
  [/\/currencies\/[^/]+(\?|$)(?!\/)/i, 300_000],
];

function ttlFor(path: string): number {
  for (const [re, ttl] of PATH_TTL_RULES) {
    if (re.test(path)) return ttl;
  }
  return CACHE_TTL_MS;
}

type CacheEntry<T = unknown> = { data: T; expiresAt: number; updatedAt: number };

type RateState = {
  lastRequestAt: number;
  quotaExhaustedUntil: number;
  rateLimitedUntil: number;
  transientErrorUntil: number;
  authInvalidUntil: number;
  cache: Map<string, CacheEntry>;
  notFoundUntil: Map<string, number>;
  inflight: Map<string, Promise<unknown>>;
  seenWarnings: Set<string>;
};

const G = globalThis as unknown as { __sosoState?: RateState };
const state: RateState = (G.__sosoState ??= {
  lastRequestAt: 0,
  quotaExhaustedUntil: 0,
  rateLimitedUntil: 0,
  transientErrorUntil: 0,
  authInvalidUntil: 0,
  cache: new Map(),
  notFoundUntil: new Map(),
  inflight: new Map(),
  seenWarnings: new Set(),
});

// SoSoValue error codes (per gitbook /error-responses).
const ERR_RATE_LIMIT = 402901;
const ERR_INVALID_KEY = 400101;
const ERR_EXPIRED_KEY = 400102;
const ERR_FORBIDDEN = 400301;
const ERR_NOT_FOUND = 400401;
const ERR_ENDPOINT_NOT_FOUND = 400402;

function isMonthlyQuotaError(code: number | undefined, msg: string | undefined): boolean {
  // Treat as monthly quota (long backoff) only when the message wording
  // indicates so. Doc only spec's 402901 generically; SoSoValue uses
  // "Monthly quota exceeded" wording in practice on the Demo tier.
  return /monthly|billing|subscription quota/i.test(msg ?? "");
}

function isRateLimitError(status: number, code: number | undefined): boolean {
  return status === 429 || code === ERR_RATE_LIMIT;
}

function isAuthError(status: number, code: number | undefined): boolean {
  return status === 401 || code === ERR_INVALID_KEY || code === ERR_EXPIRED_KEY;
}

function isPathBlocked(status: number, code: number | undefined): boolean {
  return (
    status === 403 ||
    status === 404 ||
    code === ERR_FORBIDDEN ||
    code === ERR_NOT_FOUND ||
    code === ERR_ENDPOINT_NOT_FOUND
  );
}

function isTransientError(status: number, code?: number): boolean {
  return status >= 500 || (typeof code === "number" && code >= 500000);
}

function warnOnce(key: string, message: string, ...rest: unknown[]): void {
  if (state.seenWarnings.has(key)) return;
  state.seenWarnings.add(key);
  console.warn(message, ...rest);
}

function fresh(entry: CacheEntry | undefined): boolean {
  return !!entry && entry.expiresAt > Date.now();
}

async function request<T>(path: string, fallback: () => T): Promise<T> {
  if (!KEY) return fallback();

  const cached = state.cache.get(path) as CacheEntry<T> | undefined;
  if (fresh(cached)) return cached!.data;

  const now = Date.now();

  // Global hard backoffs: don't touch the network until they expire.
  if (now < state.authInvalidUntil) return cached ? cached.data : fallback();
  if (now < state.quotaExhaustedUntil) return cached ? cached.data : fallback();
  if (now < state.rateLimitedUntil) return cached ? cached.data : fallback();
  if (now < state.transientErrorUntil) return cached ? cached.data : fallback();

  // Per-path negative cache: this endpoint returned 403/404 recently, no point
  // burning a 1-req-per-min slot on it. Other paths still go through.
  const blockedUntil = state.notFoundUntil.get(path);
  if (blockedUntil && now < blockedUntil) {
    return cached ? cached.data : fallback();
  }

  // Dedup parallel cold reads for the same path.
  const existing = state.inflight.get(path) as Promise<T> | undefined;
  if (existing) return existing;

  // Rate-limit gate: if we'd violate the 60s gap, return whatever we have
  // (stale cache → synthetic fallback). Don't queue — that would back up
  // requests indefinitely under traffic.
  const sinceLast = now - state.lastRequestAt;
  if (sinceLast < MIN_GAP_MS) {
    if (cached) return cached.data;
    return fallback();
  }

  const promise = (async (): Promise<T> => {
    state.lastRequestAt = Date.now();
    try {
      const res = await fetch(`${BASE}${path}`, {
        headers: { "x-soso-api-key": KEY, accept: "application/json" },
        cache: "no-store",
      });
      const text = await res.text();
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        throw new Error(`SoSoValue ${path} ${res.status} non-JSON: ${text.slice(0, 80)}`);
      }
      const envelope = body as {
        code?: number;
        message?: string;
        details?: unknown;
        data?: unknown;
      };
      const code = envelope?.code;
      const msg = envelope?.message;

      if (!res.ok || (code !== undefined && code !== 0)) {
        // Surface the `details` field once per (path, code) for 4xx errors
        // so malformed-param bugs (400001/400002/400003) are debuggable
        // without flooding the log on every retry.
        if (typeof code === "number" && code >= 400000 && code < 500000 && envelope.details) {
          warnOnce(
            `details:${path}:${code}`,
            `[sosovalue] ${path} code=${code} details=`,
            envelope.details,
          );
        }

        if (isAuthError(res.status, code)) {
          warnOnce(
            "auth",
            `[sosovalue] AUTH FAILED (${res.status} code=${code} msg=${msg}) · ` +
              `backing off ${Math.round(AUTH_BACKOFF_MS / 3600_000)}h ` +
              `(check SOSOVALUE_API_KEY env)`,
          );
          state.authInvalidUntil = Date.now() + AUTH_BACKOFF_MS;
        } else if (isRateLimitError(res.status, code)) {
          if (isMonthlyQuotaError(code, msg)) {
            if (state.quotaExhaustedUntil < Date.now()) {
              console.warn(
                `[sosovalue] MONTHLY QUOTA EXHAUSTED (code=${code}) · backing off ${Math.round(
                  QUOTA_BACKOFF_MS / 3600_000,
                )}h (serving cached/synthetic data until reset)`,
              );
            }
            state.quotaExhaustedUntil = Date.now() + QUOTA_BACKOFF_MS;
          } else {
            if (state.rateLimitedUntil < Date.now()) {
              console.warn(
                `[sosovalue] RATE LIMITED (${res.status} code=${code}) · ` +
                  `backing off ${Math.round(RATE_LIMIT_BACKOFF_MS / 60_000)}min`,
              );
            }
            state.rateLimitedUntil = Date.now() + RATE_LIMIT_BACKOFF_MS;
          }
        } else if (isPathBlocked(res.status, code)) {
          warnOnce(
            `blocked:${path}:${code}`,
            `[sosovalue] PATH BLOCKED ${path} (${res.status} code=${code} msg=${msg}) · ` +
              `negative-caching ${Math.round(NOT_FOUND_TTL_MS / 60_000)}min`,
          );
          state.notFoundUntil.set(path, Date.now() + NOT_FOUND_TTL_MS);
        } else if (isTransientError(res.status, code)) {
          if (state.transientErrorUntil < Date.now()) {
            console.warn(
              `[sosovalue] 5xx OUTAGE (${res.status} code=${code}) · ` +
                `backing off ${Math.round(TRANSIENT_BACKOFF_MS / 60_000)}min ` +
                `(likely subscription propagation delay or service degradation)`,
            );
          }
          state.transientErrorUntil = Date.now() + TRANSIENT_BACKOFF_MS;
        }
        throw new Error(`SoSoValue ${path} ${res.status} code=${code} msg=${msg}`);
      }
      const data = ("data" in envelope ? envelope.data : body) as T;
      state.cache.set(path, {
        data,
        // Per-path TTL matches upstream refresh frequency from
        // /endpoint-overview (klines real-time → 30s, snapshots 30s → 60s
        // client cache, currency details 5min upstream → 5min, etc).
        expiresAt: Date.now() + ttlFor(path),
        updatedAt: Date.now(),
      });
      return data;
    } catch (err) {
      // Stay quiet on every retry once we're in any backoff window — the
      // root-cause has already been logged once via warnOnce / threshold
      // checks above.
      const message = (err as Error).message;
      const inBackoff =
        / 4\d\d /.test(message) ||
        / 5\d\d /.test(message) ||
        /code=4\d/.test(message) ||
        /code=5\d/.test(message);
      if (!inBackoff) console.warn("[sosovalue]", message);
      if (cached) return cached.data;
      return fallback();
    } finally {
      state.inflight.delete(path);
    }
  })();

  state.inflight.set(path, promise as Promise<unknown>);
  return promise;
}

// ---------- raw endpoints ----------

export async function listEtfs(symbol: string, countryCode = "US"): Promise<EtfListItem[]> {
  return request<EtfListItem[]>(
    `/etfs?symbol=${encodeURIComponent(symbol)}&country_code=${encodeURIComponent(countryCode)}`,
    () => [
      { ticker: "IBIT", name: "iShares Bitcoin Trust", exchange: "NASDAQ" },
      { ticker: "FBTC", name: "Fidelity Wise Origin Bitcoin Fund", exchange: "CBOE" },
      { ticker: "ARKB", name: "ARK 21Shares Bitcoin ETF", exchange: "CBOE" },
    ],
  );
}

export async function getEtfHistory(
  ticker: string,
  opts: { startDate?: string; endDate?: string; limit?: number } = {},
): Promise<EtfHistoryRow[]> {
  const sp = new URLSearchParams();
  if (opts.startDate) sp.set("start_date", opts.startDate);
  if (opts.endDate) sp.set("end_date", opts.endDate);
  sp.set("limit", String(opts.limit ?? 50));
  return request<EtfHistoryRow[]>(`/etfs/${encodeURIComponent(ticker)}/history?${sp}`, () => {
    const today = new Date();
    return Array.from({ length: 30 }, (_, i) => {
      const d = new Date(today);
      d.setDate(d.getDate() - (29 - i));
      return {
        date: d.toISOString().slice(0, 10),
        ticker,
        net_inflow: Math.round((Math.sin(i / 4) * 30 + i) * 1_000_000),
        cum_inflow: Math.round(400_000_000 + i * 12_000_000),
        net_assets: 5_000_000_000,
        currency_share: 0.005,
        prem_dsc: -0.0001,
        value_traded: 4_441_000_000,
        volume: 322_302,
      };
    });
  });
}

export async function getNewsRaw(
  opts: {
    category?: 1 | 2 | 3 | 4 | 7 | 13;
    language?: string;
    currencyId?: string;
    projectId?: string;
    page?: number;
    pageSize?: number;
    startTime?: number;
    endTime?: number;
  } = {},
): Promise<NewsResponse> {
  const sp = new URLSearchParams();
  if (opts.category) sp.set("category", String(opts.category));
  sp.set("language", opts.language ?? "en");
  if (opts.currencyId) sp.set("currency_id", opts.currencyId);
  if (opts.projectId) sp.set("project_id", opts.projectId);
  sp.set("page", String(opts.page ?? 1));
  sp.set("page_size", String(opts.pageSize ?? 20));
  if (opts.startTime) sp.set("start_time", String(opts.startTime));
  if (opts.endTime) sp.set("end_time", String(opts.endTime));
  return request<NewsResponse>(`/news?${sp}`, () => ({
    page: 1,
    page_size: 20,
    total: 2,
    list: [
      {
        id: "n1",
        title: "Filecoin storage demand jumps 38% QoQ, enterprise contracts expand",
        content: "",
        release_time: Date.now() - 2 * 60_000,
        author: "Messari",
        source_link: "https://messari.io",
        matched_currencies: [{ id: "fil", full_name: "Filecoin", name: "FIL" }],
        tags: ["DePIN", "storage"],
      },
      {
        id: "n2",
        title: "Helium network passes 1M devices",
        content: "",
        release_time: Date.now() - 8 * 60_000,
        author: "The Block",
        source_link: "https://theblock.co",
        matched_currencies: [{ id: "hnt", full_name: "Helium", name: "HNT" }],
        tags: ["DePIN"],
      },
    ],
  }));
}

export async function getSectorSpotlight(): Promise<SectorSpotlight> {
  return request<SectorSpotlight>("/currencies/sector-spotlight", () => ({
    // Synthetic shape matches live response (decimal fractions) — sector list
    // intentionally uses the API's real categories (Layer1/Layer2/DeFi/NFT/
    // GameFi/StableCoin/Others) rather than the narrative labels in the
    // mockups.
    sector: [
      { name: "Layer1", change_pct_24h: -0.0046, marketcap_dom: 0.0797 },
      { name: "DeFi", change_pct_24h: 0.0034, marketcap_dom: 0.0138 },
      { name: "Layer2", change_pct_24h: -0.0067, marketcap_dom: 0.0022 },
      { name: "GameFi", change_pct_24h: -0.0357, marketcap_dom: 0.0009 },
      { name: "NFT", change_pct_24h: -0.0133, marketcap_dom: 0.0006 },
      { name: "StableCoin", change_pct_24h: 0.0, marketcap_dom: 0.05 },
      { name: "Others", change_pct_24h: -0.0049, marketcap_dom: 0.0052 },
    ],
    spotlight: [
      { name: "perpdex", change_pct_24h: 0.112 },
      { name: "btc-l2", change_pct_24h: 0.063 },
    ],
  }));
}

export async function listSsiTickers(): Promise<string[]> {
  return request<string[]>("/indices", () => ["ssimag7", "ssilayer1", "ssidepin", "ssirwa"]);
}

export async function getSsiConstituents(ticker: string): Promise<IndexConstituent[]> {
  return request<IndexConstituent[]>(`/indices/${encodeURIComponent(ticker)}/constituents`, () => [
    { currency_id: "1673723677362319867", symbol: "btc", weight: 0.31 },
    { currency_id: "1673723677362319868", symbol: "eth", weight: 0.22 },
    { currency_id: "1673723677362319869", symbol: "sol", weight: 0.12 },
  ]);
}

export async function getSsiSnapshot(ticker: string): Promise<SsiSnapshot> {
  return request<SsiSnapshot>(
    `/indices/${encodeURIComponent(ticker)}/market-snapshot`,
    () => ({
      price: 1.182,
      "24h_change_pct": 0.0524,
      "7day_roi": 0.082,
      "1month_roi": 0.182,
      "3month_roi": 0.341,
      "1year_roi": 1.84,
      ytd: 0.42,
    }),
  );
}

export async function getSsiKlines(
  ticker: string,
  opts: { interval?: "1d"; limit?: number; startTime?: number; endTime?: number } = {},
): Promise<SsiKline[]> {
  const sp = new URLSearchParams();
  sp.set("interval", opts.interval ?? "1d");
  sp.set("limit", String(opts.limit ?? 90));
  if (opts.startTime) sp.set("start_time", String(opts.startTime));
  if (opts.endTime) sp.set("end_time", String(opts.endTime));
  return request<SsiKline[]>(`/indices/${encodeURIComponent(ticker)}/klines?${sp}`, () => {
    // Synthetic 90-day klines shaped exactly like the live response.
    const now = Date.now();
    let p = 0.95;
    return Array.from({ length: 90 }, (_, i) => {
      const drift = Math.sin(i / 8) * 0.03 + 0.0024;
      const open = p;
      const close = open * (1 + drift);
      const high = Math.max(open, close) * (1 + Math.abs(drift) * 0.4);
      const low = Math.min(open, close) * (1 - Math.abs(drift) * 0.4);
      p = close;
      return {
        timestamp: now - (89 - i) * 86_400_000,
        open: Number(open.toFixed(4)),
        high: Number(high.toFixed(4)),
        low: Number(low.toFixed(4)),
        close: Number(close.toFixed(4)),
      };
    });
  });
}

export async function getCurrencySnapshot(currencyId: string): Promise<CurrencySnapshot> {
  return request<CurrencySnapshot>(
    `/currencies/${encodeURIComponent(currencyId)}/market-snapshot`,
    () => ({
      price: 0,
      change_pct_24h: 0,
      turnover_24h: 0,
      marketcap: 0,
      high_24h: 0,
      low_24h: 0,
      marketcap_rank: 0,
    }),
  );
}

export async function getCurrencyKlines(
  currencyId: string,
  opts: { limit?: number; startTime?: number; endTime?: number } = {},
): Promise<CurrencyKline[]> {
  const sp = new URLSearchParams();
  sp.set("interval", "1d");
  sp.set("limit", String(opts.limit ?? 90));
  if (opts.startTime) sp.set("start_time", String(opts.startTime));
  if (opts.endTime) sp.set("end_time", String(opts.endTime));
  return request<CurrencyKline[]>(
    `/currencies/${encodeURIComponent(currencyId)}/klines?${sp}`,
    () => {
      // Synthetic 90-day kline series matching the live response shape.
      const now = Date.now();
      let p = 60_000; // approx BTC scale; adjusted by caller per asset
      return Array.from({ length: opts.limit ?? 90 }, (_, i) => {
        const drift = Math.sin(i / 10) * 0.025 + 0.0018;
        const open = p;
        const close = open * (1 + drift);
        const high = Math.max(open, close) * (1 + Math.abs(drift) * 0.4);
        const low = Math.min(open, close) * (1 - Math.abs(drift) * 0.4);
        p = close;
        return {
          timestamp: now - ((opts.limit ?? 90) - 1 - i) * 86_400_000,
          open: Number(open.toFixed(2)),
          high: Number(high.toFixed(2)),
          low: Number(low.toFixed(2)),
          close: Number(close.toFixed(2)),
          volume: Math.round(20_000_000_000 + Math.random() * 5_000_000_000),
        };
      });
    },
  );
}

export async function getEtfSummaryHistory(
  symbol: string,
  countryCode = "US",
  opts: { startDate?: string; endDate?: string; limit?: number } = {},
): Promise<EtfSummaryRow[]> {
  const sp = new URLSearchParams();
  sp.set("symbol", symbol);
  sp.set("country_code", countryCode);
  if (opts.startDate) sp.set("start_date", opts.startDate);
  if (opts.endDate) sp.set("end_date", opts.endDate);
  sp.set("limit", String(opts.limit ?? 30));
  return request<EtfSummaryRow[]>(`/etfs/summary-history?${sp}`, () => {
    const today = new Date();
    return Array.from({ length: opts.limit ?? 30 }, (_, i) => {
      const d = new Date(today);
      d.setUTCDate(d.getUTCDate() - i);
      const cumBase = 50_000_000_000;
      const flow = Math.round((Math.sin(i / 3) * 100 + (15 - i)) * 1_000_000);
      return {
        date: d.toISOString().slice(0, 10),
        total_net_inflow: flow,
        total_value_traded: 4_400_000_000 + i * 100_000_000,
        total_net_assets: 130_000_000_000 - i * 200_000_000,
        cum_net_inflow: cumBase - i * 100_000_000,
      };
    });
  });
}

export async function getEtfMarketSnapshot(ticker: string): Promise<EtfMarketSnapshot> {
  return request<EtfMarketSnapshot>(
    `/etfs/${encodeURIComponent(ticker)}/market-snapshot`,
    () => ({
      date: new Date().toISOString().slice(0, 10),
      ticker,
      sponsor_fee: "0.0025",
      net_inflow: 22_879_600,
      cum_inflow: 65_175_243_000,
      net_assets: 63_054_413_760,
      mkt_price: 44.0,
      prem_dsc: 0.0005,
      value_traded: 1_263_693_458,
      volume: "1263693458",
    }),
  );
}

// ---------- adapters used by the UI / API routes ----------

export async function getSentiment(opts: { sector?: Sector; window?: Window } = {}) {
  const { sector = "DePIN", window = "1h" } = opts;
  const news = await getNewsRaw({ language: "en", pageSize: 50 });
  const matching = news.list.filter((n) => (n.tags ?? []).some((t) => t.toLowerCase() === sector.toLowerCase()));
  // Until SoSoValue exposes a first-class sentiment metric, derive a proxy
  // score from news velocity + spotlight movement. Replace this with the real
  // sentiment endpoint when it ships.
  const score = Math.min(100, Math.round(40 + matching.length * 8));
  const series = fakeSeries(40, 60, 0.08, 2);
  return {
    sector,
    window,
    series,
    current: {
      sector,
      score,
      delta: matching.length >= 3 ? 15 : 0,
      ts: new Date().toISOString(),
    } satisfies SentimentPoint,
  };
}

export async function getFundFlow(opts: { sector?: Sector; window?: Window } = {}): Promise<FundFlowPoint> {
  // For BTC/ETH-tracked sectors we expose ETF flow as the canonical signal.
  // For other sectors we currently fall back to synthetic until SoSoValue
  // exposes a sector-level fund-flow endpoint.
  const { sector = "DePIN" } = opts;
  if (sector.toLowerCase() === "btc") {
    const rows = await getEtfHistory("IBIT", { limit: 1 });
    const last = rows[0];
    return {
      sector,
      netInflowUsd: last.net_inflow,
      topAsset: "BTC",
      topAssetFlowUsd: last.net_inflow,
      ts: last.date,
    };
  }
  return {
    sector,
    netInflowUsd: 24_600_000,
    topAsset: "FIL",
    topAssetFlowUsd: 8_100_000,
    ts: new Date().toISOString(),
  };
}

export async function getNews(opts: { sector?: Sector; limit?: number } = {}): Promise<NewsItem[]> {
  const { sector = "DePIN", limit = 20 } = opts;
  const raw = await getNewsRaw({ language: "en", pageSize: Math.min(limit, 100) });
  return raw.list.slice(0, limit).map((n) => {
    const titleOrContent = n.title?.trim() || (n.content ?? "").slice(0, 140);
    const ts = Number(n.release_time);
    return {
      id: n.id,
      title: titleOrContent,
      source: n.author ?? "—",
      sector: (n.tags ?? [])[0] ?? sector,
      sentiment: scoreFromTitle(titleOrContent),
      importance: classifyImportance(titleOrContent),
      ts: Number.isFinite(ts) ? new Date(ts).toISOString() : new Date().toISOString(),
    };
  });
}

export async function getSectorScores() {
  // change_pct_24h is a decimal fraction (e.g. -0.0357 = −3.57%). Convert to
  // percentage for the UI scoring math: 5% gain → score 75, −5% → score 25.
  const ss = await getSectorSpotlight();
  return ss.sector.map((s) => {
    const pct = s.change_pct_24h * 100;
    const score = Math.max(0, Math.min(100, Math.round(50 + pct * 5)));
    return {
      sector: s.name,
      score,
      delta: Math.round(pct * 2),
      news: Math.round(50 + Math.abs(pct) * 10),
    };
  });
}

// ---------- sector ↔ SSI ticker mapping ----------

// SoSoValue's `sector-spotlight` uses macro categories (Layer1/Layer2/DeFi/
// NFT/GameFi/StableCoin/Others) but the SSI `/indices` endpoint exposes
// narrative indices that match the design mockups: ssiRWA, ssiAI, ssiDePIN,
// ssiMeme, ssiGameFi, ssiLayer1, ssiLayer2, ssiPayFi, ssiCeFi, ssiSocialFi,
// ssiDeFi, ssiNFT, ssiMAG7. Use that as the source of truth for "what's in
// the basket" — fetch constituents via getSsiConstituents().
export const SECTOR_TO_SSI: Record<string, string> = {
  DePIN: "ssiDePIN",
  RWA: "ssiRWA",
  AI: "ssiAI",
  Memes: "ssiMeme",
  Meme: "ssiMeme",
  Gaming: "ssiGameFi",
  GameFi: "ssiGameFi",
  DeFi: "ssiDeFi",
  L2: "ssiLayer2",
  Layer2: "ssiLayer2",
  L1: "ssiLayer1",
  Layer1: "ssiLayer1",
  NFT: "ssiNFT",
  CeFi: "ssiCeFi",
  PayFi: "ssiPayFi",
  SocialFi: "ssiSocialFi",
  MAG7: "ssiMAG7",
};

export function sectorToSsi(sector: string): string | undefined {
  return SECTOR_TO_SSI[sector] ?? SECTOR_TO_SSI[sector.replace(/\s+/g, "")];
}

// ---------- helpers ----------

function scoreFromTitle(title: string): number {
  // Cheap NLP placeholder. Once SoSoValue exposes per-article sentiment,
  // wire it in here instead of this keyword heuristic.
  const t = title.toLowerCase();
  let s = 50;
  if (/jump|surge|breakout|record|grant|launch/.test(t)) s += 30;
  if (/down|drop|fall|outflow|hack|exploit|sell/.test(t)) s -= 35;
  return Math.max(-50, Math.min(100, s));
}

function classifyImportance(title: string): "high" | "med" | "low" {
  const t = title.toLowerCase();
  if (/blackrock|sec|hack|exploit|partnership|milestone/.test(t)) return "high";
  if (/launch|release|growth|expand/.test(t)) return "med";
  return "low";
}
