import {
  Card,
  Label,
  Metric,
  Mono,
  Tag,
  Btn,
  Spark,
  Meter,
} from "@/components/ui";
import { tokens } from "@/lib/tokens";
import {
  listSsiTickers,
  getSsiSnapshot,
  getSsiKlines,
  type SsiKline,
  type SsiSnapshot,
} from "@/lib/api/sosovalue";
import { MyPublishedClient } from "./MyPublishedClient";

export const revalidate = 60;

const SSI_DISPLAY: Record<string, { name: string; symbol: string; sector: string }> = {
  ssiDePIN: { name: "DePIN Index", symbol: "DEPIN", sector: "DePIN" },
  ssiRWA: { name: "RWA Index", symbol: "RWA", sector: "RWA" },
  ssiAI: { name: "AI Agents", symbol: "AI", sector: "AI" },
  ssiMeme: { name: "Meme Index", symbol: "MEME", sector: "Meme" },
  ssiGameFi: { name: "GameFi Index", symbol: "GFI", sector: "Gaming" },
  ssiLayer1: { name: "Layer 1 Majors", symbol: "L1", sector: "Layer 1" },
  ssiLayer2: { name: "Layer 2 Index", symbol: "L2", sector: "Layer 2" },
  ssiMAG7: { name: "Crypto MAG7", symbol: "MAG7", sector: "Macro" },
  ssiPayFi: { name: "PayFi Index", symbol: "PAYFI", sector: "PayFi" },
  ssiDeFi: { name: "DeFi Blue-chip", symbol: "DEFI", sector: "DeFi" },
  ssiSocialFi: { name: "SocialFi", symbol: "SOC", sector: "SocialFi" },
  ssiCeFi: { name: "CeFi Index", symbol: "CEFI", sector: "CeFi" },
  ssiNFT: { name: "NFT Index", symbol: "NFT", sector: "NFT" },
};

function pct(n: number, digits = 2): string {
  return `${n >= 0 ? "+" : ""}${(n * 100).toFixed(digits)}%`;
}

function fmtPrice(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "—";
  if (n < 1) return `$${n.toFixed(4)}`;
  if (n < 100) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

export default async function PublishedPage() {
  // List all SSI indices and pull their snapshots in parallel. With 100 req/min
  // (paid tier) this is comfortable. Klines too for sparkline.
  const tickers = await listSsiTickers();

  const enriched = await Promise.all(
    tickers.map(async (t) => {
      const [snap, klines] = await Promise.all([
        getSsiSnapshot(t).catch<SsiSnapshot | null>(() => null),
        getSsiKlines(t, { limit: 30 }).catch<SsiKline[]>(() => []),
      ]);
      return { ticker: t, snap, klines };
    }),
  );

  type Row = {
    ticker: string;
    name: string;
    symbol: string;
    sector: string;
    nav: number;
    chg24h: number;
    roi30d: number;
    ytd: number;
    spark: number[];
    sparkColor: string;
    hot: boolean;
  };

  const rows: Row[] = enriched.map(({ ticker, snap, klines }) => {
    const display = SSI_DISPLAY[ticker] ?? {
      name: ticker,
      symbol: ticker.slice(3, 7).toUpperCase(),
      sector: "—",
    };
    const closes = klines.map((k) => k.close);
    const chg = snap?.change_pct_24h ?? 0;
    return {
      ticker,
      name: display.name,
      symbol: display.symbol,
      sector: display.sector,
      nav: snap?.price ?? 0,
      chg24h: chg,
      roi30d: snap?.roi_1m ?? 0,
      ytd: snap?.ytd ?? 0,
      spark: closes,
      sparkColor: chg >= 0 ? tokens.emerald : tokens.red,
      hot: chg > 0.05,
    };
  });

  const sorted = [...rows].sort((a, b) => b.roi30d - a.roi30d);

  // Aggregate KPIs from the per-ticker snapshots.
  const totalIndices = rows.length;
  const positive = rows.filter((r) => r.chg24h > 0).length;
  const avgYtd = rows.reduce((a, b) => a + b.ytd, 0) / Math.max(1, rows.length);
  const topPerformer = sorted[0];

  const live = totalIndices >= 13;

  return (
    <div className="px-6 py-5 flex flex-col gap-3.5 h-[calc(100vh-52px)]">
      <div className="flex justify-between items-end">
        <div>
          <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>
            SSI Indices · live snapshot
          </div>
          <Mono size={11}>
            {totalIndices} indices · {positive} positive (24h) · GET /indices · per-ticker
            /market-snapshot + /klines
          </Mono>
        </div>
        <div className="flex gap-1.5">
          <Tag small color={live ? tokens.emerald : tokens.textFaint} dot>
            {live ? "live · paid tier" : "fallback"}
          </Tag>
          <Btn small>Filter</Btn>
          <Btn small>Sort: 30d ROI ↓</Btn>
        </div>
      </div>

      <MyPublishedClient />

      <div className="grid grid-cols-4 gap-3">
        <Card pad={14}>
          <Label>SSI INDICES TRACKED</Label>
          <Metric v={String(totalIndices).padStart(2, "0")} size={26} style={{ marginTop: 6 }} />
          <Mono
            size={11}
            color={tokens.text}
            className="mt-1 block"
          >
            from /indices endpoint
          </Mono>
        </Card>
        <Card pad={14}>
          <Label>POSITIVE (24H)</Label>
          <Metric
            v={`${positive}/${totalIndices}`}
            size={26}
            color={positive >= totalIndices / 2 ? tokens.emerald : tokens.amber}
            style={{ marginTop: 6 }}
          />
          <Mono size={11} className="mt-1 block">
            from per-ticker snapshot
          </Mono>
        </Card>
        <Card pad={14}>
          <Label>AVG YTD</Label>
          <Metric
            v={pct(avgYtd, 1)}
            size={26}
            color={avgYtd >= 0 ? tokens.emerald : tokens.red}
            style={{ marginTop: 6 }}
          />
          <Mono size={11} className="mt-1 block">
            mean across {totalIndices} indices
          </Mono>
        </Card>
        <Card pad={14}>
          <Label>TOP 30D</Label>
          <Metric
            v={topPerformer ? topPerformer.symbol : "—"}
            size={26}
            color={tokens.amber}
            style={{ marginTop: 6 }}
          />
          <Mono size={11} color={tokens.emerald} className="mt-1 block">
            {topPerformer ? pct(topPerformer.roi30d, 1) : "—"} (1m ROI)
          </Mono>
        </Card>
      </div>

      <Card pad={0} className="flex-1 overflow-hidden flex flex-col">
        <div
          className="grid"
          style={{
            gridTemplateColumns: "2fr 1fr 1.1fr 1fr 1fr 1fr 0.8fr",
            padding: "10px 16px",
            gap: 10,
            borderBottom: `1px solid ${tokens.border}`,
            background: tokens.bgElev2,
          }}
        >
          {["INDEX", "SECTOR", "NAV", "24H", "30D ROI", "YTD", ""].map((k) => (
            <Label key={k}>{k}</Label>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto">
          {sorted.map((r) => {
            const chgColor = r.chg24h >= 0 ? tokens.emerald : tokens.red;
            const ytdColor = r.ytd >= 0 ? tokens.emerald : tokens.red;
            const roiColor = r.roi30d >= 0 ? tokens.emerald : tokens.red;
            return (
              <div
                key={r.ticker}
                className="grid items-center"
                style={{
                  gridTemplateColumns: "2fr 1fr 1.1fr 1fr 1fr 1fr 0.8fr",
                  padding: "12px 16px",
                  gap: 10,
                  borderBottom: `1px solid ${tokens.borderFaint}`,
                }}
              >
                <div className="flex items-center gap-2.5">
                  <div
                    className="flex items-center justify-center font-mono"
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 6,
                      background: tokens.bgElev2,
                      border: `1px solid ${tokens.border}`,
                      fontSize: 9.5,
                      color: r.hot ? tokens.amber : tokens.emerald,
                      fontWeight: 700,
                    }}
                  >
                    {r.symbol.slice(0, 4)}
                  </div>
                  <div>
                    <div className="flex items-center gap-1">
                      <div style={{ fontSize: 12.5, fontWeight: 600 }}>{r.name}</div>
                      {r.hot && (
                        <Tag small color={tokens.amber} dot>
                          hot
                        </Tag>
                      )}
                    </div>
                    <Mono size={9.5}>{r.ticker}</Mono>
                  </div>
                </div>
                <Tag small color={tokens.cyan}>
                  {r.sector}
                </Tag>
                <div className="flex items-center gap-2">
                  <Mono size={11} color={tokens.text}>
                    {fmtPrice(r.nav)}
                  </Mono>
                  {r.spark.length > 0 && (
                    <Spark data={r.spark} w={50} h={20} color={r.sparkColor} fill={false} />
                  )}
                </div>
                <Mono size={12} color={chgColor}>
                  {pct(r.chg24h)}
                </Mono>
                <div className="flex items-center gap-1.5">
                  <Mono size={11} color={roiColor}>
                    {pct(r.roi30d, 1)}
                  </Mono>
                  <Meter
                    v={Math.min(1, Math.max(0, (r.roi30d + 0.5) / 1))}
                    color={roiColor}
                    h={3}
                  />
                </div>
                <Mono size={11} color={ytdColor}>
                  {pct(r.ytd, 1)}
                </Mono>
                <Tag small color={tokens.emerald} dot>
                  LIVE
                </Tag>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
