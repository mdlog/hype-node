// Macro economic calendar — wraps the SoSoValue OpenAPI macro endpoints.
// Returns empty arrays when upstream is unreachable so callers can render
// an explicit "data unavailable" state instead of seeded synthetic content.
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

export async function listMacroEvents(): Promise<MacroEventDay[]> {
  return request<MacroEventDay[]>("/macro/events", () => []);
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
  return request<MacroEventHistoryRow[]>(path, () => []);
}
