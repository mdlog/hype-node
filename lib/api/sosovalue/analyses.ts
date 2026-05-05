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
// When the API key is missing or every backoff window is active, fallbacks
// produce deterministic synthetic data so the page still renders offline.

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

// ---------- synthetic fallbacks ----------

const DAY_MS = 86_400_000;

// Deterministic-ish wave generator so synthetic data isn't identical across
// fields but is still stable across renders within a single session.
function wave(seed: number, day: number, base: number, amp: number): number {
  const x = (seed * 1.7 + day * 0.21) % (Math.PI * 2);
  const drift = day * (seed % 5 === 0 ? 0.0008 : 0.0012);
  return base * (1 + drift) + Math.sin(x) * amp + Math.cos(x * 0.5) * (amp * 0.4);
}

function syntheticMetadataList(): ChartMetadata[] {
  return [
    {
      chart_name: "stablecoin_total_market_cap",
      time_field: "timestamp",
      fields: [
        { name: "mcap", type: "number" },
        { name: "usdt", type: "number" },
        { name: "usdc", type: "number" },
        { name: "usds", type: "number" },
        { name: "usde", type: "number" },
        { name: "pyusd", type: "number" },
        { name: "usdd", type: "number" },
      ],
    },
    {
      chart_name: "btc_etf_net_flow",
      time_field: "timestamp",
      fields: [
        { name: "daily_total_net_inflow", type: "number" },
        { name: "total_net_assets", type: "number" },
        { name: "btc_price", type: "number" },
      ],
    },
    {
      chart_name: "eth_etf_net_flow",
      time_field: "timestamp",
      fields: [
        { name: "daily_total_net_inflow", type: "number" },
        { name: "total_net_assets", type: "number" },
        { name: "eth_price", type: "number" },
      ],
    },
    {
      chart_name: "defi_tvl",
      time_field: "timestamp",
      fields: [
        { name: "tvl", type: "number" },
        { name: "lending_tvl", type: "number" },
        { name: "dex_tvl", type: "number" },
        { name: "yield_tvl", type: "number" },
      ],
    },
  ];
}

function syntheticChartData(chartName: string, days = 90): ChartRow[] {
  const now = Date.now();
  // Snap to UTC midnight so timestamps look like daily samples.
  const today = now - (now % DAY_MS);

  const rows: ChartRow[] = [];

  for (let i = days - 1; i >= 0; i--) {
    const timestamp = today - i * DAY_MS;
    const day = days - 1 - i; // monotonic 0..days-1 for drift math

    if (chartName === "stablecoin_total_market_cap") {
      // Realistic 2025-ish stablecoin caps in USD. USDT dominates, USDC
      // ~half, then a long tail. Drift up over the window.
      const usdt = wave(1, day, 119_000_000_000, 1_400_000_000);
      const usdc = wave(2, day, 41_000_000_000, 600_000_000);
      const usds = wave(3, day, 9_500_000_000, 220_000_000);
      const usde = wave(4, day, 6_800_000_000, 180_000_000);
      const pyusd = wave(5, day, 1_350_000_000, 60_000_000);
      const usdd = wave(6, day, 720_000_000, 30_000_000);
      const mcap = usdt + usdc + usds + usde + pyusd + usdd;
      rows.push({ timestamp, mcap, usdt, usdc, usds, usde, pyusd, usdd });
      continue;
    }

    if (chartName === "btc_etf_net_flow") {
      // Daily net inflow oscillates +/- $400M, AUM grows, BTC price drifts.
      const daily_total_net_inflow = wave(7, day, 0, 380_000_000);
      const total_net_assets = wave(8, day, 78_000_000_000, 900_000_000);
      const btc_price = wave(9, day, 96_500, 1_400);
      rows.push({ timestamp, daily_total_net_inflow, total_net_assets, btc_price });
      continue;
    }

    if (chartName === "eth_etf_net_flow") {
      const daily_total_net_inflow = wave(10, day, 0, 65_000_000);
      const total_net_assets = wave(11, day, 11_500_000_000, 240_000_000);
      const eth_price = wave(12, day, 3_350, 80);
      rows.push({ timestamp, daily_total_net_inflow, total_net_assets, eth_price });
      continue;
    }

    if (chartName === "defi_tvl") {
      const lending_tvl = wave(13, day, 48_000_000_000, 800_000_000);
      const dex_tvl = wave(14, day, 32_000_000_000, 600_000_000);
      const yield_tvl = wave(15, day, 18_000_000_000, 400_000_000);
      const tvl = lending_tvl + dex_tvl + yield_tvl;
      rows.push({ timestamp, tvl, lending_tvl, dex_tvl, yield_tvl });
      continue;
    }

    // Unknown chart_name → single generic numeric field so callers don't
    // crash on an empty row. Caller is responsible for handling the case
    // where the field they expect isn't present.
    const value = wave(99, day, 100, 5);
    rows.push({ timestamp, value });
  }

  return rows;
}

// ---------- public API ----------

export async function listChartMetadata(): Promise<ChartMetadata[]> {
  return request<ChartMetadata[]>(`/analyses`, syntheticMetadataList);
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
  return request<ChartRow[]>(path, () => syntheticChartData(chartName, limit));
}
