import type {
  CryptoStockListItem,
  CryptoStockMarketSnapshot,
} from "@/lib/api/sosovalue/crypto-stocks";

import type { StockRow } from "./StocksClient";

// The table renders at most 20 rows, so that's all we fetch snapshots for.
// With a real key `/crypto-stocks` lists ~3.7k tickers; one snapshot request
// per ticker drained the shared SoSoValue token bucket (every other page's
// cold fetches queued behind it) and blocked this render 10+ s, while only
// ~27 requests per render got real data before the queue cap zero-filled
// the rest.
export const STOCK_ROW_LIMIT = 20;

export async function loadStockRows(
  stocks: CryptoStockListItem[],
  getSnapshot: (ticker: string) => Promise<CryptoStockMarketSnapshot | null>,
): Promise<StockRow[]> {
  const listed = stocks.slice(0, STOCK_ROW_LIMIT);
  const snapshots = await Promise.all(
    listed.map((s) => getSnapshot(s.ticker).catch(() => null)),
  );

  return listed.map((s, i) => {
    const snap = snapshots[i];
    return {
      ticker: s.ticker,
      name: s.name,
      sector: s.sector,
      price: snap?.mkt_price ?? 0,
      vol24h: snap?.turnover ?? 0,
      marketcap: snap?.total_marketcap ?? 0,
      pe: snap?.pe_ttm ?? 0,
      pb: snap?.pb ?? 0,
    };
  });
}
