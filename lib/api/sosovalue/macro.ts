// Macro economic calendar — wraps the SoSoValue OpenAPI macro endpoints
// and provides deterministic synthetic fallbacks for offline / no-key dev.
//
// Endpoints (base: https://openapi.sosovalue.com/openapi/v1):
//   GET /macro/events                          → upcoming events grouped by date
//   GET /macro/events/{event}/history          → historical actual/forecast/previous
//
// Both go through the shared `request<T>` transport in `@/lib/api/sosovalue`,
// so they inherit the rate-limit gate, per-path TTL, auth/quota backoffs and
// cache-on-failure behaviour without re-implementing any of it.

import { request } from "@/lib/api/sosovalue";

export type MacroEventDay = {
  date: string; // YYYY-MM-DD
  events: string[];
};

export type MacroEventHistoryRow = {
  date: string; // YYYY-MM-DD
  actual: number;
  forecast: number;
  previous: number;
};

// Default catalog used by the synthetic fallback when SOSOVALUE_API_KEY is
// missing. The agenda is intentionally short (FOMC / CPI / NFP) so the UI
// can render meaningful empty + populated states without leaning on long
// fictional schedules.
const FALLBACK_EVENTS = ["FOMC", "CPI", "NFP"] as const;

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function syntheticUpcoming(days = 7): MacroEventDay[] {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() + i);
    // Stagger which events land on which day so the calendar isn't a wall of
    // identical chips: day 0 → FOMC, day 1 → CPI, day 2 → NFP, etc.
    const pick = FALLBACK_EVENTS[i % FALLBACK_EVENTS.length];
    return { date: toIsoDate(d), events: [pick] };
  });
}

function syntheticHistory(event: string, months = 12): MacroEventHistoryRow[] {
  // Per-event base/scale tuned to give realistic-looking magnitudes:
  //   NFP    → ~150-220k jobs added
  //   CPI    → ~3.0-3.5% YoY
  //   FOMC   → ~5.25-5.50% target rate
  //   PPI    → ~2.0-2.7% YoY
  //   GDP    → ~2.0-2.8% QoQ
  //   default → mid-single-digit forecast for unknown events
  const e = event.toLowerCase();
  let base = 3.2;
  let scale = 0.3;
  if (e.includes("nonfarm") || e.includes("nfp") || e.includes("payroll")) {
    base = 185;
    scale = 35;
  } else if (e.includes("cpi") || e.includes("inflation")) {
    base = 3.2;
    scale = 0.3;
  } else if (e.includes("fomc") || e.includes("fed funds") || e.includes("rate")) {
    base = 5.375;
    scale = 0.0625;
  } else if (e.includes("ppi")) {
    base = 2.4;
    scale = 0.4;
  } else if (e.includes("gdp")) {
    base = 2.5;
    scale = 0.5;
  } else if (e.includes("unemployment")) {
    base = 3.9;
    scale = 0.2;
  }
  const today = new Date();
  return Array.from({ length: months }, (_, i) => {
    const d = new Date(today);
    d.setUTCMonth(d.getUTCMonth() - (months - 1 - i));
    d.setUTCDate(1);
    const phase = (i / months) * Math.PI * 2;
    const forecast = +(base + Math.sin(phase) * scale * 0.6).toFixed(3);
    const actual = +(forecast + (Math.cos(phase * 1.7) * scale * 0.5)).toFixed(3);
    const previous = +(base + Math.sin(phase - 0.5) * scale * 0.6).toFixed(3);
    return { date: toIsoDate(d), actual, forecast, previous };
  });
}

export async function listMacroEvents(): Promise<MacroEventDay[]> {
  return request<MacroEventDay[]>("/macro/events", () => syntheticUpcoming(7));
}

export async function getEventHistory(
  event: string,
  opts: { startDate?: string; endDate?: string; limit?: number } = {},
): Promise<MacroEventHistoryRow[]> {
  const sp = new URLSearchParams();
  if (opts.startDate) sp.set("start_date", opts.startDate);
  if (opts.endDate) sp.set("end_date", opts.endDate);
  // Cap at 100 per upstream contract; default 50 matches /etfs/{ticker}/history.
  sp.set("limit", String(Math.min(opts.limit ?? 50, 100)));
  const qs = sp.toString();
  const path = `/macro/events/${encodeURIComponent(event)}/history${qs ? `?${qs}` : ""}`;
  return request<MacroEventHistoryRow[]>(path, () => syntheticHistory(event, 12));
}
