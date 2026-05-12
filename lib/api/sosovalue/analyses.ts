// SoSoValue OpenAPI v1 — `GET /analyses` + `GET /analyses/{chart_name}`.
//
// The analyses surface exposes structured time-series datasets (stablecoin
// market cap stack, ETF aggregate flow series, DeFi TVL, etc.) keyed by a
// canonical `chart_name`. The metadata endpoint enumerates which charts are
// available + their field schema; the data endpoint returns rows of
// {timestamp, ...dynamicFields} where the available numeric fields differ
// per chart_name.
//
// Endpoints (base = https://openapi.sosovalue.com/openapi/v1):
//   GET /analyses                  — no params; metadata for every chart
//   GET /analyses/{chart_name}     — start_time, end_time (ms), limit (≤500)
//
// Both helpers reuse the canonical `request<T>` from `lib/api/sosovalue.ts`
// so we inherit the global rate-limit / backoff / per-path negative cache.
// When upstream is unreachable both helpers return empty arrays — pages
// render an explicit "data unavailable" state rather than seeded synthetic
// numbers that look indistinguishable from live SoSoValue data.

import { request } from "@/lib/api/sosovalue";

// ---------- types ----------

export type ChartFieldType = "number" | "integer" | "string" | string;

export type ChartField = {
  name: string;
  type: ChartFieldType;
};

export type ChartMetadata = {
  chart_name: string;
  time_field: string;
  fields: ChartField[];
};

export type ChartRow = {
  timestamp: number;
  // Dynamic numeric fields — vary by chart_name. Strings allowed for safety
  // because some upstream rows leak stringified numbers (e.g. "182400000000").
  [field: string]: number | string;
};

export type GetChartDataOpts = {
  /** Milliseconds since epoch. */
  startTime?: number;
  /** Milliseconds since epoch. */
  endTime?: number;
  /** API max 500, default 100. */
  limit?: number;
};

// ---------- public API ----------

export async function listChartMetadata(): Promise<ChartMetadata[]> {
  return request<ChartMetadata[]>(`/analyses`, () => []);
}

export async function getChartData(
  chartName: string,
  opts: GetChartDataOpts = {},
): Promise<ChartRow[]> {
  const sp = new URLSearchParams();
  if (opts.startTime !== undefined) sp.set("start_time", String(opts.startTime));
  if (opts.endTime !== undefined) sp.set("end_time", String(opts.endTime));
  // API max is 500 with a default of 100; we ask for 90 by default to match
  // the 90-day window the UI visualises.
  const limit = Math.min(500, Math.max(1, opts.limit ?? 90));
  sp.set("limit", String(limit));
  const qs = sp.toString();
  const path = qs
    ? `/analyses/${encodeURIComponent(chartName)}?${qs}`
    : `/analyses/${encodeURIComponent(chartName)}`;
  return request<ChartRow[]>(path, () => []);
}
