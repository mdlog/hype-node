import { describe, expect, it } from "vitest";

import type {
  CryptoStockListItem,
  CryptoStockMarketSnapshot,
} from "@/lib/api/sosovalue/crypto-stocks";

import { loadStockRows } from "./loadStockRows";

// Regression guard for "/stocks takes 10+ s even with a warm cache": with a
// real key `/crypto-stocks` lists ~3.7k tickers, and the page requested a
// market snapshot for every one of them. That drained the shared SoSoValue
// token bucket (slowing every other page's cold fetches) while only ~27
// requests per render got real data — the rest timed out of the queue into
// zero-filled rows.

function listItem(ticker: string, name = `${ticker} Corp`, sector = "Technology"): CryptoStockListItem {
  return {
    ticker,
    name,
    exchange: "NASDAQ",
    sector,
    introduction: `${name} introduction`,
    social_media: { website: "https://example.com", twitter: "" },
    listing_time: 1_700_000_000_000,
  };
}

function snapshot(ticker: string, overrides: Partial<CryptoStockMarketSnapshot> = {}): CryptoStockMarketSnapshot {
  return {
    timestamp: 1_760_000_000_000,
    ticker,
    mkt_price: 1,
    mkt_status: "open",
    volume: 1,
    turnover: 1,
    circulating_marketcap: 1,
    total_marketcap: 1,
    total_shares: 1,
    circulating_shares: 1,
    pe_ttm: 1,
    pb: 1,
    ...overrides,
  };
}

describe("loadStockRows", () => {
  it("requests snapshots for the first 20 listed stocks only, not the whole list", async () => {
    // Same size as the live /crypto-stocks list (3,695 tickers).
    const stocks = Array.from({ length: 3695 }, (_, i) => listItem(`T${String(i).padStart(4, "0")}`));
    const requested: string[] = [];

    const rows = await loadStockRows(stocks, async (ticker) => {
      requested.push(ticker);
      return snapshot(ticker);
    });

    expect(requested).toHaveLength(20);
    expect(requested[0]).toBe("T0000");
    expect(requested[19]).toBe("T0019");
    expect(requested).not.toContain("T0020");
    expect(rows.map((r) => r.ticker)).toEqual(requested);
  });

  it("maps list + snapshot fields into a table row", async () => {
    const rows = await loadStockRows([listItem("MSTR", "Strategy", "BTC Treasury")], async (ticker) =>
      snapshot(ticker, {
        mkt_price: 412.5,
        turnover: 3_100_000_000,
        total_marketcap: 98_000_000_000,
        pe_ttm: 31.2,
        pb: 2.4,
      }),
    );

    expect(rows).toEqual([
      {
        ticker: "MSTR",
        name: "Strategy",
        sector: "BTC Treasury",
        price: 412.5,
        vol24h: 3_100_000_000,
        marketcap: 98_000_000_000,
        pe: 31.2,
        pb: 2.4,
      },
    ]);
  });

  it("zero-fills a row whose snapshot is missing or failed instead of failing the page", async () => {
    const rows = await loadStockRows([listItem("GONE"), listItem("FAIL")], async (ticker) => {
      if (ticker === "FAIL") throw new Error("upstream 500");
      return null;
    });

    expect(rows).toEqual([
      { ticker: "GONE", name: "GONE Corp", sector: "Technology", price: 0, vol24h: 0, marketcap: 0, pe: 0, pb: 0 },
      { ticker: "FAIL", name: "FAIL Corp", sector: "Technology", price: 0, vol24h: 0, marketcap: 0, pe: 0, pb: 0 },
    ]);
  });
});
