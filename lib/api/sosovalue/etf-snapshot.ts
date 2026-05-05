// ETF single-ticker market snapshot.
//
// Endpoint (base = https://openapi.sosovalue.com/openapi/v1):
//   GET /etfs/{ticker}/market-snapshot
//
// Response shape (verified per docs at sosovalue-1.gitbook.io/sosovalue-api-doc):
//   { date, ticker, sponsor_fee, net_inflow, cum_inflow, net_assets,
//     mkt_price, prem_dsc, value_traded, volume }
//
// Notes:
//   - `sponsor_fee` and `prem_dsc` are decimal fractions (0.0025 = 0.25%,
//     -0.0001 = -0.01%). The parent module's existing
//     `getEtfMarketSnapshot` returns the same wire type as `EtfMarketSnapshot`;
//     this thin wrapper exposes the canonical name (`getEtfSnapshot`) used by
//     the EtfSnapshotPanel widget and lets us tune the IBIT-shaped synthetic
//     fallback independently from the broader ETF history fallback.
//   - `volume` is returned as a numeric string by the live API but typed as
//     `number | string` to match the wire contract.
//   - All transport (rate-limit gate, per-path TTL, auth/quota backoffs,
//     stale-on-failure) is inherited from the shared `request<T>` in
//     `@/lib/api/sosovalue`.

import { request, type EtfMarketSnapshot } from "@/lib/api/sosovalue";

export type EtfSnapshot = EtfMarketSnapshot;

// IBIT-shaped synthetic numbers. Tuned per spec:
//   mkt_price ~58, sponsor_fee 0.0025, prem_dsc -0.0001,
//   net_inflow $50M, cum_inflow $35B, net_assets $50B.
// Per-ticker minor variation keeps a multi-card carousel from looking like
// five identical clones in offline / no-key dev.
function syntheticSnapshot(ticker: string): EtfSnapshot {
  const t = ticker.toUpperCase();
  // Cheap deterministic per-ticker seed so each card is slightly different
  // but the values are stable across renders.
  let seed = 0;
  for (let i = 0; i < t.length; i++) seed = (seed * 31 + t.charCodeAt(i)) >>> 0;
  const jitter = ((seed % 1000) / 1000) * 2 - 1; // [-1, 1]

  const mkt_price = +(58 + jitter * 6).toFixed(2); // ~52-64
  const sponsor_fee = 0.0025; // 0.25% — IBIT canonical
  const prem_dsc = +(-0.0001 + jitter * 0.0002).toFixed(5); // tiny ±
  const net_inflow = Math.round(50_000_000 + jitter * 30_000_000); // ~$20M-$80M
  const cum_inflow = Math.round(35_000_000_000 + jitter * 5_000_000_000); // ~$30B-$40B
  const net_assets = Math.round(50_000_000_000 + jitter * 8_000_000_000); // ~$42B-$58B
  const value_traded = Math.round(1_200_000_000 + Math.abs(jitter) * 400_000_000);
  const volume = String(Math.round(20_000_000 + Math.abs(jitter) * 8_000_000));

  return {
    date: new Date().toISOString().slice(0, 10),
    ticker: t,
    sponsor_fee,
    net_inflow,
    cum_inflow,
    net_assets,
    mkt_price,
    prem_dsc,
    value_traded,
    volume,
  };
}

export async function getEtfSnapshot(ticker: string): Promise<EtfSnapshot> {
  return request<EtfSnapshot>(
    `/etfs/${encodeURIComponent(ticker)}/market-snapshot`,
    () => syntheticSnapshot(ticker),
  );
}
