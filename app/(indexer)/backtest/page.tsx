import { Card, Label, Metric, Mono, Btn, LineChart, Toggle } from "@/components/ui";
import { tokens } from "@/lib/tokens";
import { fakeSeries } from "@/lib/fake-data";

export default function BacktestPage() {
  return (
    <div className="px-6 py-5 flex flex-col gap-3.5 h-[calc(100vh-48px)]">
      <div className="flex justify-between items-end">
        <div>
          <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>Backtesting Lab</div>
          <Mono size={11}>validate strategies against historical sentiment + flow</Mono>
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
            <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 8 }}>Strategy</div>
            {[
              ["HDP8 sentiment-weighted", true],
              ["RWA7 flow-tilted", false],
              ["AIM3 narrative momentum", false],
              ["+ New from scratch", false],
            ].map(([l, on], i) => (
              <div
                key={i}
                style={{
                  padding: "6px 8px",
                  background: on ? tokens.emerald + "12" : "transparent",
                  border: `1px solid ${on ? tokens.emerald + "40" : tokens.border}`,
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
                    border: `1.5px solid ${on ? tokens.emerald : tokens.borderStrong}`,
                  }}
                >
                  {on && (
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
                <div style={{ fontSize: 11.5, color: on ? tokens.text : tokens.textDim }}>{l}</div>
              </div>
            ))}
          </Card>

          <Card pad={12}>
            <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 8 }}>Parameters</div>
            {[
              ["Period", "90 days"],
              ["Rebalance", "every 6h"],
              ["N assets", "8"],
              ["Min sentiment", "60"],
              ["Gas model", "ValueChain avg"],
              ["Slippage", "0.25%"],
            ].map(([k, v]) => (
              <div
                key={k}
                className="flex justify-between"
                style={{ padding: "5px 0", borderBottom: `1px solid ${tokens.borderFaint}` }}
              >
                <Mono size={10}>{k}</Mono>
                <Mono size={10.5} color={tokens.text}>{v}</Mono>
              </div>
            ))}
          </Card>

          <Card pad={12}>
            <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 8 }}>Benchmarks</div>
            {[
              ["BTC", true, tokens.amber],
              ["ETH", true, "#a78bfa"],
              ["Sector basket (eq wt)", true, tokens.cyan],
              ["S&P 500", false, tokens.textDim],
            ].map(([l, on, c], i) => (
              <div
                key={i}
                className="flex justify-between items-center"
                style={{ padding: "4px 0" }}
              >
                <div className="flex items-center gap-1.5">
                  <div style={{ width: 12, height: 2, background: on ? (c as string) : tokens.borderStrong }} />
                  <div style={{ fontSize: 11.5, color: on ? tokens.text : tokens.textDim }}>{l}</div>
                </div>
                <Toggle on={!!on} />
              </div>
            ))}
          </Card>
        </div>

        <div className="flex flex-col gap-2.5 min-h-0">
          <div className="grid grid-cols-5 gap-2.5">
            {[
              ["RETURN", "+34.1%", tokens.emerald],
              ["SHARPE", "1.82", tokens.text],
              ["SORTINO", "2.41", tokens.text],
              ["MAX DD", "−8.1%", tokens.red],
              ["WIN RATE", "61%", tokens.text],
            ].map(([k, v, c], i) => (
              <Card key={i} pad={12}>
                <Label>{k}</Label>
                <Metric v={v} color={c as string} size={22} style={{ marginTop: 3 }} />
              </Card>
            ))}
          </div>

          <Card pad={14} className="flex-1">
            <div className="flex justify-between mb-2">
              <div style={{ fontSize: 13, fontWeight: 600 }}>Equity curve vs benchmarks</div>
              <div className="flex gap-3">
                {[
                  ["HDP8", tokens.emerald],
                  ["BTC", tokens.amber],
                  ["ETH", "#a78bfa"],
                  ["Sector", tokens.cyan],
                ].map(([l, c]) => (
                  <div key={l} className="flex items-center gap-1.5">
                    <div style={{ width: 12, height: 2, background: c }} />
                    <Mono size={10} color={tokens.text}>{l}</Mono>
                  </div>
                ))}
              </div>
            </div>
            <LineChart
              w={860}
              h={240}
              series={[
                { data: fakeSeries(60, 100, 0.025, 1).map((v, i) => v + i * 0.6), color: tokens.emerald, thick: true, fill: true },
                { data: fakeSeries(60, 100, 0.03, 9).map((v, i) => v + i * 0.3), color: tokens.amber },
                { data: fakeSeries(60, 100, 0.035, 7).map((v, i) => v + i * 0.2), color: "#a78bfa" },
                { data: fakeSeries(60, 100, 0.02, 11).map((v, i) => v + i * 0.15), color: tokens.cyan, dashed: true },
              ]}
            />
          </Card>

          <div className="grid grid-cols-2 gap-2.5">
            <Card pad={12}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Drawdown distribution</div>
              <svg width="100%" height={90} viewBox="0 0 400 90" preserveAspectRatio="none">
                {Array.from({ length: 20 }).map((_, i) => {
                  const h = 20 + Math.abs(Math.sin(i * 0.7)) * 60;
                  return (
                    <rect
                      key={i}
                      x={i * 20 + 2}
                      y={90 - h}
                      width={16}
                      height={h}
                      fill={i < 3 ? tokens.red : i < 8 ? tokens.amber : tokens.emerald}
                      opacity={0.8}
                    />
                  );
                })}
              </svg>
            </Card>
            <Card pad={12}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
                Rebalance heatmap · day × hour
              </div>
              <div className="grid gap-0.5" style={{ gridTemplateColumns: "repeat(24, 1fr)" }}>
                {Array.from({ length: 7 * 24 }).map((_, i) => {
                  const v = Math.abs(Math.sin(i * 0.3) * Math.cos(i * 0.1));
                  return (
                    <div
                      key={i}
                      style={{
                        aspectRatio: "1 / 1",
                        background: tokens.emerald,
                        opacity: 0.1 + v * 0.9,
                        borderRadius: 1,
                      }}
                    />
                  );
                })}
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
