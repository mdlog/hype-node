// Crypto Stocks endpoints layered over the SoSoValue OpenAPI v1 client.
//
// Covers public companies with crypto exposure: BTC treasuries (MSTR, TSLA),
// miners (RIOT, MARA, CLSK, HUT, BITF), exchanges (COIN), plus a sector index
// that overlays a sector basket against BTC and the NASDAQ-100.
//
// All six methods reuse the canonical `request<T>` helper from the parent
// module so they inherit rate-limit, auth-error, and per-path negative-cache
// behaviour for free. When SOSOVALUE_API_KEY is unset (or any backoff window
// When upstream is unreachable each function returns the empty/null shape —
// pages render explicit "data unavailable" state instead of synthetic.
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

// ---------- public API ----------

export async function listCryptoStocks(): Promise<CryptoStockListItem[]> {
  return request<CryptoStockListItem[]>("/crypto-stocks", () => []);
}

export async function getCryptoStockMarketSnapshot(
  ticker: string,
): Promise<CryptoStockMarketSnapshot | null> {
  return request<CryptoStockMarketSnapshot | null>(
    `/crypto-stocks/${encodeURIComponent(ticker)}/market-snapshot`,
    () => null,
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
    () => [],
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
    () => [],
  );
}

export async function listCryptoStockSectors(): Promise<CryptoStockSector[]> {
  return request<CryptoStockSector[]>("/crypto-stocks/sector", () => []);
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
    () => [],
  );
}
