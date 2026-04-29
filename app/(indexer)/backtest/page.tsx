import { Card, Label, Metric, Mono, Btn, LineChart, Toggle } from "@/components/ui";
import { tokens } from "@/lib/tokens";
import { listSsiTickers, getSsiKlines } from "@/lib/api/sosovalue";
import { closesFromKlines, computeMetrics } from "@/lib/metrics";

export const revalidate = 60;

const STRATEGY = "ssiDePIN";
const BENCHMARK_TICKERS = ["ssiMAG7", "ssiLayer1", "ssiAI"] as const;

const SSI_LABELS: Record<string, string> = {
  ssiDePIN: "DePIN sentiment-weighted",
  ssiRWA: "RWA momentum",
  ssiAI: "AI agents narrative",
  ssiMeme: "Meme rotation",
  ssiGameFi: "GameFi rebound",
  ssiLayer1: "L1 majors",
  ssiLayer2: "L2 rollups",
  ssiMAG7: "Crypto MAG7",
  ssiPayFi: "PayFi yield",
  ssiDeFi: "DeFi blue-chip",
  ssiSocialFi: "SocialFi narrative",
  ssiCeFi: "CeFi exposure",
  ssiNFT: "NFT recovery",
};

function pct(n: number, digits = 1): string {
  return `${n >= 0 ? "+" : ""}${(n * 100).toFixed(digits)}%`;
}

// Normalize a closing price series so the first day = 100. Makes equity
// curves directly comparable on the same chart.
function normalize(closes: number[]): number[] {
  if (closes.length === 0 || closes[0] === 0) return closes;
  return closes.map((c) => (c / closes[0]) * 100);
}

export default async function BacktestPage() {
  // Strategy = ssiDePIN. Benchmarks = other SSI tickers (all from SoSoValue).
  // The 65s rate gate caps each fetch; first cold render takes <1s if quota
  // ok, otherwise serves cached/synthetic.
  const tickers = await listSsiTickers();
  const [strategyKlines, ...benchmarkKlines] = await Promise.all([
    getSsiKlines(STRATEGY, { limit: 90 }),
    ...BENCHMARK_TICKERS.map((t) => getSsiKlines(t, { limit: 90 })),
  ]);

  const strategyCloses = closesFromKlines(strategyKlines);
  const metrics = computeMetrics(strategyCloses);
  const equity = normalize(strategyCloses);
  const benchmarks = BENCHMARK_TICKERS.map((t, i) => ({
    label: t,
    name: SSI_LABELS[t] ?? t,
    series: normalize(closesFromKlines(benchmarkKlines[i] ?? [])),
  }));

  const benchmarkColors = [tokens.amber, "#a78bfa", tokens.cyan];

  // Strategy radio list — top 6 SSI tickers (with the featured one selected).
  const strategyOptions = tickers.slice(0, 6).map((t) => ({
    ticker: t,
    label: SSI_LABELS[t] ?? t,
    on: t === STRATEGY,
  }));

  // Drawdown distribution — bucket the running drawdown values into 20 bins.
  const ddSeries: number[] = [];
  let peak = strategyCloses[0] ?? 0;
  for (const c of strategyCloses) {
    if (c > peak) peak = c;
    ddSeries.push(peak > 0 ? (c - peak) / peak : 0);
  }
  const minDd = Math.min(...ddSeries);
  const buckets = 20;
  const bucketHeights = new Array(buckets).fill(0);
  for (const dd of ddSeries) {
    const idx = minDd === 0 ? 0 : Math.min(buckets - 1, Math.floor((dd / minDd) * buckets));
    bucketHeights[idx] += 1;
  }
  const maxH = Math.max(...bucketHeights, 1);

  // Day-of-week × log-return heatmap. Surfaces which day-bucket has the most
  // movement in the past 90 days (helps schedule rebalances).
  const heatmap: number[] = new Array(7 * 24).fill(0);
  for (let i = 1; i < strategyCloses.length; i++) {
    const r = Math.abs(Math.log((strategyCloses[i] || 1) / (strategyCloses[i - 1] || 1)));
    const ts = strategyKlines[i]?.timestamp ?? Date.now();
    const dow = new Date(ts).getUTCDay();
    const hour = new Date(ts).getUTCHours();
    heatmap[dow * 24 + hour] += r;
  }
  const heatMax = Math.max(...heatmap, 0.0001);

  return (
    <div className="px-6 py-5 flex flex-col gap-3.5 h-[calc(100vh-48px)]">
      <div className="flex justify-between items-end">
        <div>
          <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>
            Backtesting Lab
          </div>
          <Mono size={11}>
            equity curves derived from SSI klines · GET /indices/{STRATEGY}/klines + benchmarks
          </Mono>
        </div>
        <div className="flex gap-1.5">
          <Btn small>Load strategy</Btn>
          <Btn small>Compare runs</Btn>
          <Btn small primary>▶ Run backtest</Btn>
        </div>
      </div>

      <div className="grid gap-3 flex-1 min-h-0" style={{ gridTemplateColumns: "280px 1fr" }}>
        <div className="flex flex-col gap-2.5 overflow-y-auto">
          <Card pad={12}>
            <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 8 }}>
              Strategy ({tickers.length} SSI tickers)
            </div>
            {strategyOptions.map((opt, i) => (
              <div
                key={i}
                style={{
                  padding: "6px 8px",
                  background: opt.on ? tokens.emerald + "12" : "transparent",
                  border: `1px solid ${opt.on ? tokens.emerald + "40" : tokens.border}`,
                  borderRadius: 5,
                  marginBottom: 4,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  cursor: "pointer",
                }}
              >
                <div
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: "50%",
                    border: `1.5px solid ${opt.on ? tokens.emerald : tokens.borderStrong}`,
                  }}
                >
                  {opt.on && (
                    <div
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: tokens.emerald,
                        margin: 2,
                      }}
                    />
                  )}
                </div>
                <div className="flex-1">
                  <div style={{ fontSize: 11.5, color: opt.on ? tokens.text : tokens.textDim }}>
                    {opt.label}
                  </div>
                  <Mono size={9}>{opt.ticker}</Mono>
                </div>
              </div>
            ))}
          </Card>

          <Card pad={12}>
            <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 8 }}>Parameters</div>
            {[
              ["Period", `${strategyCloses.length} days`],
              ["Interval", "1d (SSI klines)"],
              ["N constituents", "live · /constituents"],
              ["Source", "SoSoValue OpenAPI"],
            ].map(([k, v]) => (
              <div
                key={k}
                className="flex justify-between"
                style={{ padding: "5px 0", borderBottom: `1px solid ${tokens.borderFaint}` }}
              >
                <Mono size={10}>{k}</Mono>
                <Mono size={10.5} color={tokens.text}>
                  {v}
                </Mono>
              </div>
            ))}
          </Card>

          <Card pad={12}>
            <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 8 }}>Benchmarks (SSI)</div>
            {benchmarks.map((b, i) => (
              <div
                key={i}
                className="flex justify-between items-center"
                style={{ padding: "4px 0" }}
              >
                <div className="flex items-center gap-1.5">
                  <div style={{ width: 12, height: 2, background: benchmarkColors[i] }} />
                  <div style={{ fontSize: 11.5, color: tokens.text }}>{b.label}</div>
                </div>
                <Toggle on={true} />
              </div>
            ))}
          </Card>
        </div>

        <div className="flex flex-col gap-2.5 min-h-0">
          <div className="grid grid-cols-5 gap-2.5">
            <Card pad={12}>
              <Label>RETURN (90D)</Label>
              <Metric
                v={pct(metrics.return_total, 1)}
                color={metrics.return_total >= 0 ? tokens.emerald : tokens.red}
                size={22}
                style={{ marginTop: 3 }}
              />
            </Card>
            <Card pad={12}>
              <Label>SHARPE</Label>
              <Metric
                v={metrics.sharpe.toFixed(2)}
                color={metrics.sharpe > 1 ? tokens.emerald : tokens.text}
                size={22}
                style={{ marginTop: 3 }}
              />
            </Card>
            <Card pad={12}>
              <Label>SORTINO</Label>
              <Metric
                v={metrics.sortino.toFixed(2)}
                color={tokens.text}
                size={22}
                style={{ marginTop: 3 }}
              />
            </Card>
            <Card pad={12}>
              <Label>MAX DD</Label>
              <Metric
                v={pct(metrics.max_drawdown, 1)}
                color={tokens.red}
                size={22}
                style={{ marginTop: 3 }}
              />
            </Card>
            <Card pad={12}>
              <Label>WIN RATE</Label>
              <Metric
                v={`${(metrics.win_rate * 100).toFixed(0)}%`}
                color={metrics.win_rate > 0.5 ? tokens.emerald : tokens.amber}
                size={22}
                style={{ marginTop: 3 }}
              />
            </Card>
          </div>

          <Card pad={14} className="flex-1">
            <div className="flex justify-between mb-2">
              <div style={{ fontSize: 13, fontWeight: 600 }}>
                Equity curve · base 100
              </div>
              <div className="flex gap-3">
                <div className="flex items-center gap-1.5">
                  <div style={{ width: 12, height: 2, background: tokens.emerald }} />
                  <Mono size={10} color={tokens.text}>
                    {STRATEGY}
                  </Mono>
                </div>
                {benchmarks.map((b, i) => (
                  <div key={b.label} className="flex items-center gap-1.5">
                    <div style={{ width: 12, height: 2, background: benchmarkColors[i] }} />
                    <Mono size={10} color={tokens.text}>
                      {b.label}
                    </Mono>
                  </div>
                ))}
              </div>
            </div>
            <LineChart
              w={860}
              h={240}
              series={[
                { data: equity, color: tokens.emerald, thick: true, fill: true },
                ...benchmarks.map((b, i) => ({
                  data: b.series,
                  color: benchmarkColors[i],
                  dashed: i === 2,
                })),
              ]}
            />
          </Card>

          <div className="grid grid-cols-2 gap-2.5">
            <Card pad={12}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
                Drawdown distribution (90d)
              </div>
              <svg width="100%" height={90} viewBox={`0 0 ${buckets * 20} 90`} preserveAspectRatio="none">
                {bucketHeights.map((h, i) => {
                  const norm = (h / maxH) * 80;
                  return (
                    <rect
                      key={i}
                      x={i * 20 + 2}
                      y={90 - norm}
                      width={16}
                      height={Math.max(2, norm)}
                      fill={i < 3 ? tokens.red : i < 8 ? tokens.amber : tokens.emerald}
                      opacity={0.85}
                    />
                  );
                })}
              </svg>
            </Card>
            <Card pad={12}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
                Volatility heatmap · day × hour
              </div>
              <div className="grid gap-0.5" style={{ gridTemplateColumns: "repeat(24, 1fr)" }}>
                {heatmap.map((v, i) => (
                  <div
                    key={i}
                    style={{
                      aspectRatio: "1 / 1",
                      background: tokens.emerald,
                      opacity: 0.05 + (v / heatMax) * 0.95,
                      borderRadius: 1,
                    }}
                  />
                ))}
              </div>
            </Card>
          </div>

          <div className="flex gap-2 justify-end">
            <Btn small>Save as preset</Btn>
            <Btn small>Export PDF</Btn>
            <Btn small primary>Publish to SSI →</Btn>
          </div>
        </div>
      </div>
    </div>
  );
}
