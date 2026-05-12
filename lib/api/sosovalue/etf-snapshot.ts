// ETF single-ticker market snapshot.
//
// Endpoint (base = https://openapi.sosovalue.com/openapi/v1):
//   GET /etfs/{ticker}/market-snapshot
//
// Returns null when upstream is unreachable so the EtfSnapshotPanel can
// render an explicit "data unavailable" badge instead of seeded fake
// numbers that look indistinguishable from live IBIT data.

import { request, type EtfMarketSnapshot } from "@/lib/api/sosovalue";

export type EtfSnapshot = EtfMarketSnapshot;

export async function getEtfSnapshot(
  ticker: string,
): Promise<EtfSnapshot | null> {
  return request<EtfSnapshot | null>(
    `/etfs/${encodeURIComponent(ticker)}/market-snapshot`,
    () => null,
  );
}
