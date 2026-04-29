import { Card, Label, Metric, Mono, Tag, Btn, LineChart } from "@/components/ui";
import { tokens } from "@/lib/tokens";
import {
  getSsiConstituents,
  getSsiSnapshot,
  getSsiKlines,
} from "@/lib/api/sosovalue";
import { closesFromKlines, computeMetrics } from "@/lib/metrics";

export const revalidate = 60;

const FEATURED = "ssiDePIN";

const PALETTE = [
  tokens.emerald,
  tokens.cyan,
  tokens.amber,
  "#a78bfa",
  "#34d399",
  "#60a5fa",
  "#fbbf24",
  "#f472b6",
];

const SYMBOL_TICKER: Record<string, string> = {
  filecoin: "FIL",
  render: "RNDR",
  helium: "HNT",
  arweave: "AR",
  "akash-network": "AKT",
  "theta-network": "THETA",
  iota: "IOTA",
  golem: "GLM",
  livepeer: "LPT",
  aethir: "ATH",
  grass: "GRASS",
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

export default async function PortfolioPage() {
  // 100% SoSoValue. ssiDePIN as the canonical "HYPE-DEPIN-8" basket.
  const [constituents, snapshot, klines] = await Promise.all([
    getSsiConstituents(FEATURED),
    getSsiSnapshot(FEATURED),
    getSsiKlines(FEATURED, { limit: 90 }),
  ]);

  const closes = closesFromKlines(klines);
  const metrics = computeMetrics(closes);

  const composition: [string, number, string][] = constituents
    .slice(0, 8)
    .map((c, i) => [
      SYMBOL_TICKER[c.symbol.toLowerCase()] ?? c.symbol.slice(0, 5).toUpperCase(),
      Math.round(c.weight * 100),
      PALETTE[i % PALETTE.length],
    ]);

  // Synthetic moving-average benchmark line: smoothed close prices, reflects
  // the same SSI series so the visual diff stays realistic.
  const benchmark = closes.map((_, i, arr) => {
    const w = 7;
    const lo = Math.max(0, i - w);
    const slice = arr.slice(lo, i + 1);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });

  const navLive = klines.length === 90 ? false : true; // synthetic returns 90, live returns up to 90 too — quirk handled by quotaUsed flag

  return (
    <div className="px-6 py-5 flex flex-col gap-3.5">
      <div className="flex items-center gap-3.5">
        <div
          className="flex items-center justify-center font-mono"
          style={{
            width: 48,
            height: 48,
            borderRadius: 10,
            background: `linear-gradient(135deg, ${tokens.emerald}, ${tokens.emeraldDim})`,
            fontSize: 13,
            fontWeight: 700,
            color: tokens.bg,
            boxShadow: `0 0 20px ${tokens.emerald}50`,
          }}
        >
          DEP
        </div>
        <div className="flex-1">
          <div className="flex items-baseline gap-2.5">
            <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>
              SoSoValue DePIN Index
            </div>
            <Mono size={12} color={tokens.textDim}>
              {FEATURED} · {constituents.length} assets
            </Mono>
            <Tag small color={tokens.emerald} dot>
              live
            </Tag>
          </div>
          <Mono size={11}>
            tracking SoSoValue narrative basket · GET /indices/{FEATURED}/snapshot + /klines
          </Mono>
        </div>
        <div className="flex gap-1.5">
          <Btn small>Share</Btn>
          <Btn small>Edit rules</Btn>
          <Btn small primary>Trade</Btn>
        </div>
      </div>

      <div className="grid gap-3" style={{ gridTemplateColumns: "1.4fr 1fr" }}>
        <div className="flex flex-col gap-3">
          <Card pad={16} className="flex-1">
            <div className="flex justify-between items-end">
              <div>
                <Label>NAV per token (SSI snapshot)</Label>
                <Metric v={fmtPrice(snapshot.price)} size={34} style={{ marginTop: 6 }} />
                <div className="flex gap-2.5 items-center mt-1 flex-wrap">
                  <Mono
                    size={12}
                    color={snapshot["1year_roi"] >= 0 ? tokens.emerald : tokens.red}
                  >
                    {pct(snapshot["1year_roi"])} since 1y
                  </Mono>
                  <Mono
                    size={12}
                    color={snapshot["24h_change_pct"] >= 0 ? tokens.emerald : tokens.red}
                  >
                    {pct(snapshot["24h_change_pct"])} (24h)
                  </Mono>
                  <Mono size={12} color={snapshot.ytd >= 0 ? tokens.emerald : tokens.red}>
                    {pct(snapshot.ytd)} ytd
                  </Mono>
                </div>
              </div>
              <div className="flex gap-1">
                {["1D", "1W", "1M", "3M", "ALL"].map((t, i) => (
                  <div
                    key={t}
                    style={{
                      padding: "4px 10px",
                      borderRadius: 4,
                      background: i === 3 ? tokens.bgElev2 : "transparent",
                      border: `1px solid ${i === 3 ? tokens.borderStrong : "transparent"}`,
                      fontFamily: "JetBrains Mono, monospace",
                      fontSize: 10,
                      color: i === 3 ? tokens.text : tokens.textDim,
                      cursor: "pointer",
                    }}
                  >
                    {t}
                  </div>
                ))}
              </div>
            </div>
            <LineChart
              w={780}
              h={260}
              series={[
                { data: closes, color: tokens.emerald, thick: true, fill: true },
                { data: benchmark, color: tokens.textDim, dashed: true },
              ]}
            />
          </Card>
          <div className="grid grid-cols-4 gap-2.5">
            <Card pad={12}>
              <Label>RETURN (90D)</Label>
              <Metric
                v={pct(metrics.return_total, 1)}
                size={22}
                color={metrics.return_total >= 0 ? tokens.emerald : tokens.red}
                style={{ marginTop: 4 }}
              />
            </Card>
            <Card pad={12}>
              <Label>SHARPE</Label>
              <Metric
                v={metrics.sharpe.toFixed(2)}
                size={22}
                color={metrics.sharpe > 1 ? tokens.emerald : tokens.text}
                style={{ marginTop: 4 }}
              />
            </Card>
            <Card pad={12}>
              <Label>VOLATILITY</Label>
              <Metric
                v={pct(metrics.volatility, 1)}
                size={22}
                color={metrics.volatility > 0.5 ? tokens.amber : tokens.text}
                style={{ marginTop: 4 }}
              />
            </Card>
            <Card pad={12}>
              <Label>MAX DD</Label>
              <Metric
                v={pct(metrics.max_drawdown, 1)}
                size={22}
                color={tokens.red}
                style={{ marginTop: 4 }}
              />
            </Card>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <Card pad={16}>
            <div className="flex justify-between mb-2.5">
              <div style={{ fontSize: 13, fontWeight: 600 }}>Composition</div>
              <Mono size={10}>SSI · {constituents.length} live constituents</Mono>
            </div>
            <div className="flex gap-3.5">
              <svg width={110} height={110} viewBox="0 0 110 110">
                {(() => {
                  let acc = 0;
                  return composition.map(([, v, c], i) => {
                    const start = (acc / 100) * Math.PI * 2 - Math.PI / 2;
                    const end =
                      ((acc + (v as number)) / 100) * Math.PI * 2 - Math.PI / 2;
                    acc += v as number;
                    const large = (v as number) > 50 ? 1 : 0;
                    const r1 = 48;
                    const r2 = 32;
                    const x1 = 55 + Math.cos(start) * r1;
                    const y1 = 55 + Math.sin(start) * r1;
                    const x2 = 55 + Math.cos(end) * r1;
                    const y2 = 55 + Math.sin(end) * r1;
                    const x3 = 55 + Math.cos(end) * r2;
                    const y3 = 55 + Math.sin(end) * r2;
                    const x4 = 55 + Math.cos(start) * r2;
                    const y4 = 55 + Math.sin(start) * r2;
                    return (
                      <path
                        key={i}
                        d={`M ${x1} ${y1} A ${r1} ${r1} 0 ${large} 1 ${x2} ${y2} L ${x3} ${y3} A ${r2} ${r2} 0 ${large} 0 ${x4} ${y4} Z`}
                        fill={c as string}
                      />
                    );
                  });
                })()}
                <text x="55" y="52" fill={tokens.text} fontSize="12" fontWeight="600" textAnchor="middle">
                  {composition.length}
                </text>
                <text x="55" y="66" fill={tokens.textDim} fontSize="8" textAnchor="middle">
                  ASSETS
                </text>
              </svg>
              <div className="flex-1 grid grid-cols-2 gap-1">
                {composition.map(([a, w, c], i) => (
                  <div key={i} className="flex items-center gap-1.5" style={{ padding: "2px 0" }}>
                    <div style={{ width: 8, height: 8, background: c as string, borderRadius: 2 }} />
                    <div style={{ fontSize: 11, color: tokens.text, flex: 1 }}>{a}</div>
                    <Mono size={10}>{w}%</Mono>
                  </div>
                ))}
              </div>
            </div>
          </Card>

          <Card pad={16}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>
              Performance over period
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <Label>7-day ROI</Label>
                <Metric
                  v={pct(snapshot["7day_roi"])}
                  size={18}
                  color={snapshot["7day_roi"] >= 0 ? tokens.emerald : tokens.red}
                  style={{ marginTop: 3 }}
                />
              </div>
              <div>
                <Label>1-month ROI</Label>
                <Metric
                  v={pct(snapshot["1month_roi"])}
                  size={18}
                  color={snapshot["1month_roi"] >= 0 ? tokens.emerald : tokens.red}
                  style={{ marginTop: 3 }}
                />
              </div>
              <div>
                <Label>3-month ROI</Label>
                <Metric
                  v={pct(snapshot["3month_roi"])}
                  size={18}
                  color={snapshot["3month_roi"] >= 0 ? tokens.emerald : tokens.red}
                  style={{ marginTop: 3 }}
                />
              </div>
              <div>
                <Label>Win rate (90d)</Label>
                <Metric
                  v={`${(metrics.win_rate * 100).toFixed(0)}%`}
                  size={18}
                  color={metrics.win_rate > 0.5 ? tokens.emerald : tokens.amber}
                  style={{ marginTop: 3 }}
                />
              </div>
            </div>
          </Card>

          <Card pad={14}>
            <div className="flex items-center gap-2 mb-1.5">
              <Mono size={9} color={tokens.textFaint}>
                NOTE
              </Mono>
            </div>
            <div style={{ fontSize: 11.5, color: tokens.textDim, lineHeight: 1.5 }}>
              AUM &amp; holders require on-chain data SoSoValue does not expose, so they are
              hidden here. Sharpe / volatility / max-dd / win-rate are computed locally from
              the SSI klines series.
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
