// SoSoValue BTC Treasury endpoints — public companies that hold BTC on
// their balance sheet (MSTR, TSLA, MARA, RIOT, CLSK, etc.). Used by the
// dashboard's Smart Money widget to surface "who's stacking sats" signals
// without scraping 10-Q filings.
//
// Base: https://openapi.sosovalue.com/openapi/v1
//   GET /btc-treasuries                                list of companies
//   GET /btc-treasuries/{ticker}/purchase-history      daily holdings ladder
//
// Synthetic fallback returns deterministic data when no API key is set so
// the widget renders end-to-end in dev / on the demo deploy.

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

// Five household names that publicly disclose BTC treasury positions —
// kept hard-coded for the offline fallback. Order matches roughly the
// 2026-Q1 holdings ranking so the widget looks plausible without a key.
const SYNTH_LIST: TreasuryListItem[] = [
  { ticker: "MSTR", name: "MicroStrategy", list_location: "NASDAQ" },
  { ticker: "TSLA", name: "Tesla", list_location: "NASDAQ" },
  { ticker: "MARA", name: "Marathon Digital", list_location: "NASDAQ" },
  { ticker: "RIOT", name: "Riot Platforms", list_location: "NASDAQ" },
  { ticker: "CLSK", name: "CleanSpark", list_location: "NASDAQ" },
];

// Per-ticker base holdings used to seed the synthetic history series.
// Numbers are loosely calibrated to public 2025-2026 disclosures so the
// "12,345 BTC" formatting in the widget reads like real treasury data
// rather than a placeholder shape.
const SYNTH_BASE: Record<string, number> = {
  MSTR: 252_000,
  TSLA: 11_500,
  MARA: 28_500,
  RIOT: 14_900,
  CLSK: 9_800,
};

export async function listTreasuries(): Promise<TreasuryListItem[]> {
  return request<TreasuryListItem[]>(`/btc-treasuries`, () => SYNTH_LIST);
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
  return request<TreasuryPurchaseRow[]>(path, () => synthHistory(ticker, opts.limit ?? 8));
}

// Deterministic synthetic history with monotonic-increasing btc_holding so
// the widget's "30d delta = latest − oldest" computation always yields a
// non-negative buy. Spreads acquisitions roughly every 11 days.
function synthHistory(ticker: string, limit: number): TreasuryPurchaseRow[] {
  const base = SYNTH_BASE[ticker.toUpperCase()] ?? 5_000;
  const rows: TreasuryPurchaseRow[] = [];
  // 8-row default keeps fallback compact but covers a 30-day window with
  // ~11d gaps between purchases — close to the cadence MSTR has been
  // running on its quarterly capital-raise treadmill.
  const count = Math.max(2, Math.min(limit, 100));
  let holding = base;
  for (let i = 0; i < count; i++) {
    // Step backward from today so row[0] is the most recent purchase, the
    // shape the API returns (newest-first).
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i * 11);
    // Acquisitions shrink as we go further back so the latest entry is
    // the biggest — easier to eyeball "biggest buyer of the period".
    const acq = Math.round(150 + ((count - i) ** 1.4) * 18);
    // BTC price drift: ~$95k now, ~$72k 80 days ago. Linear interpolation.
    const px = 95_000 - (i / count) * 23_000;
    rows.push({
      date: d.toISOString().slice(0, 10),
      ticker: ticker.toUpperCase(),
      btc_holding: holding,
      btc_acq: acq,
      acq_cost: Math.round(acq * px),
      avg_btc_cost: Math.round(px),
    });
    // Subtract the acquisition so older rows have smaller holdings — the
    // monotonic-increasing-by-recency invariant the widget relies on.
    holding = Math.max(0, holding - acq);
  }
  return rows;
}
