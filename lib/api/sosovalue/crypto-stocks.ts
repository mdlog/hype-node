// Crypto Stocks endpoints layered over the SoSoValue OpenAPI v1 client.
//
// Covers public companies with crypto exposure: BTC treasuries (MSTR, TSLA),
// miners (RIOT, MARA, CLSK, HUT, BITF), exchanges (COIN), plus a sector index
// that overlays a sector basket against BTC and the NASDAQ-100.
//
// All six methods reuse the canonical `request<T>` helper from the parent
// module so they inherit rate-limit, auth-error, and per-path negative-cache
// behaviour for free. When SOSOVALUE_API_KEY is unset (or any backoff window
// is active), each function falls back to a deterministic synthetic payload
// so the UI renders identically offline.
//
// Endpoints (base = https://openapi.sosovalue.com/openapi/v1):
//   GET /crypto-stocks
//   GET /crypto-stocks/{stock_ticker}/market-snapshot
//   GET /crypto-stocks/{stock_ticker}/market-cap     · 100 row max
//   GET /crypto-stocks/{stock_ticker}/klines         · 1d only, 3-month window
//   GET /crypto-stocks/sector
//   GET /crypto-stocks/sector/{sector_name}/index    · 200 row max

import { request } from "@/lib/api/sosovalue";

// ---------- types ----------

export type CryptoStockListItem = {
  ticker: string;
  name: string;
  exchange: string;
  sector: string;
  introduction: string;
  social_media: { website: string; twitter: string };
  /** Milliseconds since epoch. */
  listing_time: number | string;
};

export type CryptoStockMarketSnapshot = {
  /** Milliseconds since epoch. */
  timestamp: number | string;
  ticker: string;
  mkt_price: number;
  mkt_status: "open" | "close";
  volume: number;
  turnover: number;
  circulating_marketcap: number;
  total_marketcap: number;
  total_shares: number;
  circulating_shares: number;
  pe_ttm: number;
  pb: number;
};

/**
 * NOTE: API field name uses a hyphen (`market-cap`), not snake_case. Access
 * via bracket notation: `row["market-cap"]`.
 */
export type CryptoStockMarketCapRow = {
  /** YYYY-MM-DD. */
  date: string;
  "market-cap": number;
};

export type CryptoStockKline = {
  /** Milliseconds since epoch. */
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type CryptoStockSector = {
  sector_name: string;
  total_marketcap: number;
  /** Decimal fraction (e.g. -0.0357 = −3.57%). */
  change_pct_24h: number;
};

export type CryptoStockSectorIndexRow = {
  /** YYYY-MM-DD. */
  date: string;
  /** Sector index price (USD). */
  price: number;
  /** BTC reference price (USD). */
  btc_price: number;
  /** NASDAQ-100 reference index level. */
  nasdaq100_index: number;
};

// ---------- options ----------

export type GetCryptoStockMarketCapOpts = {
  /** YYYY-MM-DD. */
  startDate?: string;
  /** YYYY-MM-DD. */
  endDate?: string;
  /** Default 50, max 100. */
  limit?: number;
};

export type GetCryptoStockKlinesOpts = {
  /** Only "1d" is supported by the API. */
  interval?: "1d";
  /** Milliseconds since epoch. */
  startTime?: number;
  /** Milliseconds since epoch. */
  endTime?: number;
  /** Default 100, max 500. The API also caps the query window to 3 months. */
  limit?: number;
};

export type GetCryptoStockSectorIndexOpts = {
  /** YYYY-MM-DD. */
  startDate?: string;
  /** YYYY-MM-DD. */
  endDate?: string;
  /** Default 100, max 200. */
  limit?: number;
};

// ---------- synthetic fallbacks ----------

const DAY_MS = 86_400_000;

// Deterministic LCG so synthetic payloads are stable across renders.
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

type StockSeed = {
  ticker: string;
  name: string;
  exchange: string;
  sector: string;
  introduction: string;
  website: string;
  twitter: string;
  basePrice: number;
  shares: number; // total shares (used for marketcap)
  pe: number;
  pb: number;
  listingYearsAgo: number;
};

const STOCK_SEEDS: StockSeed[] = [
  {
    ticker: "MSTR",
    name: "MicroStrategy Incorporated",
    exchange: "NASDAQ",
    sector: "BTC Treasury",
    introduction: "Enterprise analytics company holding Bitcoin as its primary treasury reserve.",
    website: "https://www.microstrategy.com",
    twitter: "https://twitter.com/MicroStrategy",
    basePrice: 1450,
    shares: 19_400_000_000 / 1450, // ~13.4M
    pe: 0,
    pb: 12.4,
    listingYearsAgo: 27,
  },
  {
    ticker: "TSLA",
    name: "Tesla, Inc.",
    exchange: "NASDAQ",
    sector: "BTC Treasury",
    introduction: "Electric vehicle and energy company with a long-term Bitcoin balance sheet allocation.",
    website: "https://www.tesla.com",
    twitter: "https://twitter.com/Tesla",
    basePrice: 248,
    shares: 3_180_000_000,
    pe: 71.3,
    pb: 12.1,
    listingYearsAgo: 16,
  },
  {
    ticker: "COIN",
    name: "Coinbase Global, Inc.",
    exchange: "NASDAQ",
    sector: "Exchange",
    introduction: "Largest US-regulated crypto exchange and primary spot-ETF custodian.",
    website: "https://www.coinbase.com",
    twitter: "https://twitter.com/coinbase",
    basePrice: 215,
    shares: 252_000_000,
    pe: 38.7,
    pb: 6.4,
    listingYearsAgo: 5,
  },
  {
    ticker: "RIOT",
    name: "Riot Platforms, Inc.",
    exchange: "NASDAQ",
    sector: "Mining",
    introduction: "Vertically integrated Bitcoin mining and infrastructure operator in Texas.",
    website: "https://www.riotplatforms.com",
    twitter: "https://twitter.com/RiotPlatforms",
    basePrice: 11.4,
    shares: 333_000_000,
    pe: 0,
    pb: 1.6,
    listingYearsAgo: 7,
  },
  {
    ticker: "MARA",
    name: "Marathon Digital Holdings",
    exchange: "NASDAQ",
    sector: "Mining",
    introduction: "Pure-play Bitcoin miner running large-scale ASIC fleets across North America.",
    website: "https://www.mara.com",
    twitter: "https://twitter.com/MarathonDH",
    basePrice: 16.8,
    shares: 339_000_000,
    pe: 0,
    pb: 1.9,
    listingYearsAgo: 13,
  },
  {
    ticker: "CLSK",
    name: "CleanSpark, Inc.",
    exchange: "NASDAQ",
    sector: "Mining",
    introduction: "Bitcoin miner focused on renewable-energy-powered data centers in the US.",
    website: "https://www.cleanspark.com",
    twitter: "https://twitter.com/CleanSpark_Inc",
    basePrice: 9.2,
    shares: 286_000_000,
    pe: 0,
    pb: 1.4,
    listingYearsAgo: 4,
  },
  {
    ticker: "HUT",
    name: "Hut 8 Corp.",
    exchange: "NASDAQ",
    sector: "Mining",
    introduction: "North American digital asset infrastructure and high-performance compute operator.",
    website: "https://hut8.com",
    twitter: "https://twitter.com/Hut8Corp",
    basePrice: 13.6,
    shares: 95_000_000,
    pe: 0,
    pb: 1.2,
    listingYearsAgo: 6,
  },
  {
    ticker: "BITF",
    name: "Bitfarms Ltd.",
    exchange: "NASDAQ",
    sector: "Other",
    introduction: "Globally distributed Bitcoin self-mining company with hydroelectric-powered sites.",
    website: "https://www.bitfarms.com",
    twitter: "https://twitter.com/Bitfarms_io",
    basePrice: 2.1,
    shares: 459_000_000,
    pe: 0,
    pb: 0.9,
    listingYearsAgo: 4,
  },
];

const SECTOR_SEEDS: Array<{ name: string; baseMcap: number; change24h: number }> = [
  { name: "BTC Treasury", baseMcap: 38_500_000_000, change24h: 0.0214 },
  { name: "Mining", baseMcap: 14_200_000_000, change24h: -0.0163 },
  { name: "Exchange", baseMcap: 56_300_000_000, change24h: 0.0091 },
  { name: "Other", baseMcap: 4_900_000_000, change24h: -0.0042 },
];

function syntheticStockList(): CryptoStockListItem[] {
  const now = Date.now();
  return STOCK_SEEDS.map((s) => ({
    ticker: s.ticker,
    name: s.name,
    exchange: s.exchange,
    sector: s.sector,
    introduction: s.introduction,
    social_media: { website: s.website, twitter: s.twitter },
    listing_time: now - s.listingYearsAgo * 365 * DAY_MS,
  }));
}

function findSeed(ticker: string): StockSeed {
  const t = ticker.toUpperCase();
  return STOCK_SEEDS.find((s) => s.ticker === t) ?? STOCK_SEEDS[0];
}

function syntheticSnapshot(ticker: string): CryptoStockMarketSnapshot {
  const seed = findSeed(ticker);
  // Hour of day picks a stable price oscillation around base.
  const h = new Date().getUTCHours();
  const drift = Math.sin(h / 3) * 0.03;
  const price = seed.basePrice * (1 + drift);
  const totalMcap = price * seed.shares;
  // Rough 92% float assumption for synthetic data.
  const circShares = seed.shares * 0.92;
  const circMcap = price * circShares;
  return {
    timestamp: Date.now(),
    ticker: seed.ticker,
    mkt_price: Number(price.toFixed(2)),
    mkt_status: h >= 13 && h < 20 ? "open" : "close",
    volume: Math.round(seed.shares * 0.012),
    turnover: Math.round(price * seed.shares * 0.012),
    circulating_marketcap: Math.round(circMcap),
    total_marketcap: Math.round(totalMcap),
    total_shares: Math.round(seed.shares),
    circulating_shares: Math.round(circShares),
    pe_ttm: seed.pe,
    pb: seed.pb,
  };
}

function syntheticMarketCap(ticker: string, limit: number): CryptoStockMarketCapRow[] {
  const seed = findSeed(ticker);
  const rng = lcg(hashSeed(seed.ticker, "mcap"));
  const n = Math.min(Math.max(1, limit), 100);
  const out: CryptoStockMarketCapRow[] = [];
  let v = seed.basePrice * seed.shares;
  const today = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * DAY_MS);
    v = v * (1 + (rng() - 0.5) * 0.04);
    out.push({
      date: d.toISOString().slice(0, 10),
      "market-cap": Math.round(v),
    });
  }
  return out;
}

function syntheticKlines(ticker: string, limit: number): CryptoStockKline[] {
  const seed = findSeed(ticker);
  const rng = lcg(hashSeed(seed.ticker, "kl"));
  // 90-day window cap matches the API's 3-month constraint.
  const n = Math.min(Math.max(1, limit), 500, 90);
  const out: CryptoStockKline[] = [];
  let close = seed.basePrice;
  const today = Date.UTC(
    new Date().getUTCFullYear(),
    new Date().getUTCMonth(),
    new Date().getUTCDate(),
  );
  for (let i = n - 1; i >= 0; i--) {
    const ts = today - i * DAY_MS;
    const open = close;
    const change = (rng() - 0.48) * 0.05;
    close = Math.max(0.01, open * (1 + change));
    const wick = Math.abs(rng()) * 0.015;
    const high = Math.max(open, close) * (1 + wick);
    const low = Math.min(open, close) * (1 - wick);
    out.push({
      timestamp: ts,
      open: Number(open.toFixed(2)),
      high: Number(high.toFixed(2)),
      low: Number(low.toFixed(2)),
      close: Number(close.toFixed(2)),
      volume: Math.round(seed.shares * (0.008 + rng() * 0.012)),
    });
  }
  return out;
}

function syntheticSectorList(): CryptoStockSector[] {
  return SECTOR_SEEDS.map((s) => ({
    sector_name: s.name,
    total_marketcap: s.baseMcap,
    change_pct_24h: s.change24h,
  }));
}

function syntheticSectorIndex(sector: string, limit: number): CryptoStockSectorIndexRow[] {
  const seed = SECTOR_SEEDS.find((s) => s.name.toLowerCase() === sector.toLowerCase()) ??
    SECTOR_SEEDS[0];
  const rng = lcg(hashSeed(seed.name, "idx"));
  const n = Math.min(Math.max(1, limit), 200);
  const out: CryptoStockSectorIndexRow[] = [];
  // Index level normalised to 100 at the start of the window.
  let price = 100;
  let btc = 65_000;
  let ndx = 21_000;
  const today = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * DAY_MS);
    price = price * (1 + (rng() - 0.49) * 0.035);
    btc = btc * (1 + (rng() - 0.49) * 0.022);
    ndx = ndx * (1 + (rng() - 0.5) * 0.012);
    out.push({
      date: d.toISOString().slice(0, 10),
      price: Number(price.toFixed(2)),
      btc_price: Number(btc.toFixed(2)),
      nasdaq100_index: Number(ndx.toFixed(2)),
    });
  }
  return out;
}

function hashSeed(...parts: string[]): number {
  let h = 2166136261;
  for (const p of parts) {
    for (let i = 0; i < p.length; i++) {
      h ^= p.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
  }
  return h >>> 0;
}

// ---------- public API ----------

export async function listCryptoStocks(): Promise<CryptoStockListItem[]> {
  return request<CryptoStockListItem[]>("/crypto-stocks", syntheticStockList);
}

export async function getCryptoStockMarketSnapshot(
  ticker: string,
): Promise<CryptoStockMarketSnapshot> {
  return request<CryptoStockMarketSnapshot>(
    `/crypto-stocks/${encodeURIComponent(ticker)}/market-snapshot`,
    () => syntheticSnapshot(ticker),
  );
}

export async function getCryptoStockMarketCap(
  ticker: string,
  opts: GetCryptoStockMarketCapOpts = {},
): Promise<CryptoStockMarketCapRow[]> {
  const sp = new URLSearchParams();
  if (opts.startDate) sp.set("start_date", opts.startDate);
  if (opts.endDate) sp.set("end_date", opts.endDate);
  // API hard-caps `limit` at 100; default 50.
  const limit = Math.min(100, Math.max(1, opts.limit ?? 50));
  sp.set("limit", String(limit));
  return request<CryptoStockMarketCapRow[]>(
    `/crypto-stocks/${encodeURIComponent(ticker)}/market-cap?${sp}`,
    () => syntheticMarketCap(ticker, limit),
  );
}

export async function getCryptoStockKlines(
  ticker: string,
  opts: GetCryptoStockKlinesOpts = {},
): Promise<CryptoStockKline[]> {
  const sp = new URLSearchParams();
  // API only supports "1d" today — emit it always so callers can't accidentally
  // omit a required parameter.
  sp.set("interval", opts.interval ?? "1d");
  if (opts.startTime) sp.set("start_time", String(opts.startTime));
  if (opts.endTime) sp.set("end_time", String(opts.endTime));
  // API hard-caps `limit` at 500; default 100. Window also capped at 3 months
  // upstream — caller is responsible for staying within that range.
  const limit = Math.min(500, Math.max(1, opts.limit ?? 100));
  sp.set("limit", String(limit));
  return request<CryptoStockKline[]>(
    `/crypto-stocks/${encodeURIComponent(ticker)}/klines?${sp}`,
    () => syntheticKlines(ticker, limit),
  );
}

export async function listCryptoStockSectors(): Promise<CryptoStockSector[]> {
  return request<CryptoStockSector[]>("/crypto-stocks/sector", syntheticSectorList);
}

export async function getCryptoStockSectorIndex(
  sectorName: string,
  opts: GetCryptoStockSectorIndexOpts = {},
): Promise<CryptoStockSectorIndexRow[]> {
  const sp = new URLSearchParams();
  if (opts.startDate) sp.set("start_date", opts.startDate);
  if (opts.endDate) sp.set("end_date", opts.endDate);
  // API hard-caps `limit` at 200; default 100.
  const limit = Math.min(200, Math.max(1, opts.limit ?? 100));
  sp.set("limit", String(limit));
  return request<CryptoStockSectorIndexRow[]>(
    `/crypto-stocks/sector/${encodeURIComponent(sectorName)}/index?${sp}`,
    () => syntheticSectorIndex(sectorName, limit),
  );
}
