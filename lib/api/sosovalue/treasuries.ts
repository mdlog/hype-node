// SoSoValue BTC Treasury endpoints — public companies that hold BTC on
// their balance sheet (MSTR, TSLA, MARA, RIOT, CLSK, etc.).
//
// Base: https://openapi.sosovalue.com/openapi/v1
//   GET /btc-treasuries                                list of companies
//   GET /btc-treasuries/{ticker}/purchase-history      daily holdings ladder
//
// Returns empty arrays when upstream is unreachable so the Smart Money
// widget renders an explicit empty state instead of seeded synthetic data.

import { request } from "@/lib/api/sosovalue";

export type TreasuryListItem = {
  ticker: string;
  name: string;
  list_location: string;
};

export type TreasuryPurchaseRow = {
  /** YYYY-MM-DD. */
  date: string;
  ticker: string;
  /** Total BTC held on this date (cumulative position). */
  btc_holding: number;
  /** BTC bought on this row's date (delta vs prior row). */
  btc_acq: number;
  /** USD spent on this row's acquisition. */
  acq_cost: number;
  /** Average USD cost per BTC for the row's purchase. */
  avg_btc_cost: number;
};

export async function listTreasuries(): Promise<TreasuryListItem[]> {
  return request<TreasuryListItem[]>(`/btc-treasuries`, () => []);
}

export async function getPurchaseHistory(
  ticker: string,
  opts: { startDate?: string; endDate?: string; limit?: number } = {},
): Promise<TreasuryPurchaseRow[]> {
  const sp = new URLSearchParams();
  if (opts.startDate) sp.set("start_date", opts.startDate);
  if (opts.endDate) sp.set("end_date", opts.endDate);
  // API caps `limit` at 100; default to 50 per the docs.
  sp.set("limit", String(Math.min(opts.limit ?? 50, 100)));
  const path = `/btc-treasuries/${encodeURIComponent(ticker)}/purchase-history?${sp}`;
  return request<TreasuryPurchaseRow[]>(path, () => []);
}
