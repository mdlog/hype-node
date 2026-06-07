import { describe, expect, test } from "vitest";

import { ttlFor } from "@/lib/api/sosovalue";

// Pages render/poll on a ~60s cadence (ISR `revalidate=60`, client polls=60s).
// For the central path-cache to actually absorb that cadence, the high-fan-out
// paths (market-snapshot, klines) must be cached LONGER than the render
// interval — otherwise every ISR/poll cycle is a cold refetch and the SoSoValue
// quota burns for nothing. These browse/benchmark/sparkline views do not need
// sub-minute freshness, so 5 min is the right alignment.
const RENDER_CADENCE_MS = 60_000;
const FIVE_MIN = 5 * 60_000;

describe("SoSoValue per-path cache TTLs are aligned above the page render cadence", () => {
  test("market-snapshot is cached at least 5 min (was 60s == ISR, so never hit)", () => {
    expect(ttlFor("/currencies/abc123/market-snapshot")).toBeGreaterThanOrEqual(FIVE_MIN);
    expect(ttlFor("/etfs/BTC/market-snapshot")).toBeGreaterThanOrEqual(FIVE_MIN);
  });

  test("currency & crypto-stock klines cached at least 5 min (was 30s)", () => {
    expect(ttlFor("/currencies/abc123/klines?range=90d")).toBeGreaterThanOrEqual(FIVE_MIN);
    expect(ttlFor("/crypto-stocks/COIN/klines")).toBeGreaterThanOrEqual(FIVE_MIN);
  });

  test("news cached with headroom above the 60s poll (was 30s < poll)", () => {
    expect(ttlFor("/news")).toBeGreaterThan(RENDER_CADENCE_MS);
    expect(ttlFor("/news/hot")).toBeGreaterThan(RENDER_CADENCE_MS);
    expect(ttlFor("/news/featured")).toBeGreaterThan(RENDER_CADENCE_MS);
  });

  test("every fan-out / polled path is cached at least as long as the render cadence", () => {
    for (const p of [
      "/currencies/x/market-snapshot",
      "/currencies/x/klines",
      "/crypto-stocks/x/klines",
      "/currencies/x/pairs",
      "/news",
      "/news/featured",
    ]) {
      expect(ttlFor(p)).toBeGreaterThanOrEqual(RENDER_CADENCE_MS);
    }
  });

  test("already-generous TTLs are unchanged (regression)", () => {
    expect(ttlFor("/currencies/abc/token-economics")).toBe(300_000);
    expect(ttlFor("/currencies/abc")).toBe(300_000);
  });
});
