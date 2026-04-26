import { Card, Label, Metric, Mono, Tag, Btn, LineChart } from "@/components/ui";
import { tokens } from "@/lib/tokens";
import { fakeSeries } from "@/lib/fake-data";

const composition: [string, number, string][] = [
  ["FIL", 22, tokens.emerald],
  ["RNDR", 18, tokens.cyan],
  ["HNT", 15, tokens.amber],
  ["AR", 12, "#a78bfa"],
  ["AKT", 11, "#34d399"],
  ["IOTX", 9, "#60a5fa"],
  ["DIMO", 8, "#fbbf24"],
  ["ATH", 5, "#f472b6"],
];

const moves = [
  { t: "09:38", a: "+2.1% FIL / −1.4% RNDR", r: "sentiment shift", c: tokens.cyan },
  { t: "04:12", a: "+0.8% AKT / −0.8% IOTX", r: "flow delta", c: tokens.cyan },
  { t: "00:06", a: "Rebalance skipped", r: "drift < 1%", c: tokens.textFaint },
  { t: "yest 18:40", a: "Added DIMO @ 8%", r: "new constituent", c: tokens.emerald },
  { t: "yest 12:22", a: "−3.0% AR exposure", r: "volatility guard", c: tokens.amber },
  { t: "yest 06:00", a: "Scheduled rebalance", r: "cron 6h", c: tokens.textDim },
];

export default function PortfolioPage() {
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
          H8
        </div>
        <div className="flex-1">
          <div className="flex items-baseline gap-2.5">
            <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>HYPE-DEPIN-8</div>
            <Mono size={12} color={tokens.textDim}>HDP8 · ValueChain L1 · 0x8a4f…bc21</Mono>
            <Tag small color={tokens.emerald} dot>live</Tag>
          </div>
          <Mono size={11}>sentiment-weighted DePIN basket · 8 assets · agent-managed</Mono>
        </div>
        <div className="flex gap-1.5">
          <Btn small>Share</Btn>
          <Btn small>Edit rules</Btn>
          <Btn small primary>Trade HDP8</Btn>
        </div>
      </div>

      <div className="grid gap-3" style={{ gridTemplateColumns: "1.4fr 1fr" }}>
        <div className="flex flex-col gap-3">
          <Card pad={16} className="flex-1">
            <div className="flex justify-between items-end">
              <div>
                <Label>NAV per token</Label>
                <Metric v="$1.182" size={34} style={{ marginTop: 6 }} />
                <div className="flex gap-2.5 items-center mt-1">
                  <Mono size={12} color={tokens.emerald}>+18.2% since launch</Mono>
                  <Mono size={12} color={tokens.emerald}>+5.24% (24h)</Mono>
                </div>
              </div>
              <div className="flex gap-1">
                {["1D", "1W", "1M", "3M", "ALL"].map((t, i) => (
                  <div
                    key={t}
                    style={{
                      padding: "4px 10px",
                      borderRadius: 4,
                      background: i === 2 ? tokens.bgElev2 : "transparent",
                      border: `1px solid ${i === 2 ? tokens.borderStrong : "transparent"}`,
                      fontFamily: "JetBrains Mono, monospace",
                      fontSize: 10,
                      color: i === 2 ? tokens.text : tokens.textDim,
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
                { data: fakeSeries(60, 1, 0.03, 5).map((v, i) => v + i * 0.005), color: tokens.emerald, thick: true, fill: true },
                { data: fakeSeries(60, 1, 0.02, 13), color: tokens.textDim, dashed: true },
              ]}
            />
          </Card>
          <div className="grid grid-cols-4 gap-2.5">
            {[
              ["AUM", "$1.10M", tokens.text],
              ["HOLDERS", "127", tokens.text],
              ["SHARPE", "1.82", tokens.emerald],
              ["MAX DD", "−8.1%", tokens.red],
            ].map(([k, v, c], i) => (
              <Card key={i} pad={12}>
                <Label>{k}</Label>
                <Metric v={v} size={22} color={c as string} style={{ marginTop: 4 }} />
              </Card>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <Card pad={16}>
            <div className="flex justify-between mb-2.5">
              <div style={{ fontSize: 13, fontWeight: 600 }}>Composition</div>
              <Mono size={10}>last rebalance 09:38</Mono>
            </div>
            <div className="flex gap-3.5">
              <svg width={110} height={110} viewBox="0 0 110 110">
                {(() => {
                  let acc = 0;
                  return composition.map(([, v, c], i) => {
                    const start = (acc / 100) * Math.PI * 2 - Math.PI / 2;
                    const end = ((acc + (v as number)) / 100) * Math.PI * 2 - Math.PI / 2;
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
                  8
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

          <Card pad={0} className="flex-1 overflow-hidden flex flex-col">
            <div
              style={{
                padding: "12px 16px",
                borderBottom: `1px solid ${tokens.border}`,
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              Recent agent moves
            </div>
            <div className="flex-1 overflow-y-auto">
              {moves.map((e, i) => (
                <div
                  key={i}
                  style={{ padding: "9px 16px", borderBottom: `1px solid ${tokens.borderFaint}` }}
                >
                  <div className="flex justify-between mb-0.5">
                    <Mono size={10}>{e.t}</Mono>
                    <Tag small color={e.c}>{e.r}</Tag>
                  </div>
                  <div className="font-mono" style={{ fontSize: 12, color: tokens.text }}>
                    {e.a}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
