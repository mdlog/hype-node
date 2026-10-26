import { Card, Label, Mono, Tag, Btn } from "@/components/ui";
import { tokens } from "@/lib/tokens";
import {
  listCryptoStocks,
  listCryptoStockSectors,
  getCryptoStockMarketSnapshot,
  getCryptoStockSectorIndex,
} from "@/lib/api/sosovalue/crypto-stocks";
import { loadStockRows } from "./loadStockRows";
import { StocksClient, type SectorIndexSeries } from "./StocksClient";

export const revalidate = 60;

// ---------- inline number formatters (mirror StocksClient) ----------

function fmtMcap(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000_000) return `$${(n / 1_000_000_000_000).toFixed(2)}T`;
  if (abs >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function fmtPct(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const v = n * 100;
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

// ---------- inline mini bar SVG ----------

function SectorMiniBar({
  value,
  max,
  color,
}: {
  value: number;
  max: number;
  color: string;
}) {
  const W = 160;
  const H = 18;
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const w = ratio * W;
  return (
    <svg width={W} height={H} style={{ display: "block" }}>
      <rect x={0} y={H / 2 - 2} width={W} height={4} fill={tokens.borderFaint} rx={2} />
      <rect x={0} y={H / 2 - 2} width={w} height={4} fill={color} rx={2} />
    </svg>
  );
}

export default async function StocksPage() {
  // Pull stock list + sector aggregates in parallel. Per-stock snapshots are
  // capped to the rows the table can show — the live list is ~3.7k tickers,
  // not the 8 of synthetic mode (see loadStockRows).
  const [stocks, sectors] = await Promise.all([
    listCryptoStocks(),
    listCryptoStockSectors(),
  ]);

  const rows = await loadStockRows(stocks, getCryptoStockMarketSnapshot);

  // Pre-fetch the sector-index series for each known sector so the client can
  // toggle between them without a round-trip. Each series is independent and
  // hits a different path → safe to fan out. The sector-index endpoint keys
  // by slug (`btc-treasury`), not the display name — see crypto-stocks.ts.
  const sectorNames = sectors.map((s) => s.sector_name);
  const sectorIndexEntries = await Promise.all(
    sectors.map(async (s) => {
      const rowsRaw = await getCryptoStockSectorIndex(s.sector_slug, { limit: 90 }).catch(
        () => [],
      );
      const series: SectorIndexSeries = {
        sector: s.sector_name,
        rows: rowsRaw.map((r) => ({
          date: r.date,
          price: r.price,
          btc: r.btc_price,
          ndx: r.nasdaq100_index,
        })),
      };
      return [s.sector_name, series] as const;
    }),
  );
  const sectorIndex: Record<string, SectorIndexSeries> = Object.fromEntries(sectorIndexEntries);

  // Status pill: live if any of the sectors look non-default. Synthetic seed
  // mcap for "BTC Treasury" is exactly 38_500_000_000.
  const live =
    sectors.length !== 4 ||
    sectors.some((s) => s.sector_name === "BTC Treasury" && s.total_marketcap !== 38_500_000_000);

  const maxMcap = sectors.reduce((m, s) => Math.max(m, s.total_marketcap), 0);

  return (
    <div className="px-6 py-5 flex flex-col gap-3 h-[calc(100vh-48px)]">
      {/* ----- header ----- */}
      <div className="flex justify-between items-end">
        <div>
          <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>
            Crypto Stocks
          </div>
          <Mono size={11}>
            Public companies with crypto exposure · {stocks.length} listed · GET /crypto-stocks +
            /sector
          </Mono>
        </div>
        <div className="flex gap-1.5">
          <Tag small color={live ? tokens.emerald : tokens.textFaint} dot>
            {live ? "live" : "fallback"}
          </Tag>
          <Btn small>Filter</Btn>
          <Btn small>Export CSV</Btn>
          <Btn small>Explorer ↗</Btn>
        </div>
      </div>

      {/* ----- 4 sector cards ----- */}
      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}
      >
        {sectors.slice(0, 4).map((s) => {
          const positive = s.change_pct_24h >= 0;
          const color = positive ? tokens.emerald : tokens.red;
          return (
            <Card key={s.sector_name} pad={14}>
              <div className="flex justify-between items-start" style={{ marginBottom: 10 }}>
                <div>
                  <Label>{s.sector_name}</Label>
                  <div
                    style={{
                      fontSize: 18,
                      fontWeight: 600,
                      color: tokens.text,
                      letterSpacing: "-0.02em",
                      marginTop: 2,
                    }}
                  >
                    {fmtMcap(s.total_marketcap)}
                  </div>
                </div>
                <Mono size={11} color={color}>
                  {fmtPct(s.change_pct_24h)}
                </Mono>
              </div>
              <SectorMiniBar value={s.total_marketcap} max={maxMcap} color={color} />
              <Mono size={9} color={tokens.textFaint} style={{ marginTop: 6 }}>
                {((s.total_marketcap / (maxMcap || 1)) * 100).toFixed(0)}% of largest sector
              </Mono>
            </Card>
          );
        })}
      </div>

      {/* ----- table + sidebar ----- */}
      <StocksClient rows={rows} sectorIndex={sectorIndex} availableSectors={sectorNames} />
    </div>
  );
}
