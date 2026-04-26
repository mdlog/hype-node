import { Card, Label, Metric, Mono, Tag, Btn, Spark, LineChart } from "@/components/ui";
import { tokens } from "@/lib/tokens";
import { fakeSeries } from "@/lib/fake-data";

export default function DashboardPage() {
  const navData = fakeSeries(60, 100, 0.03, 7).map((v, i) => v + i * 0.3);

  const kpis = [
    { k: "TOTAL AUM", v: "$2.142M", d: "+4.24%", c: tokens.emerald, data: fakeSeries(30, 100, 0.04, 3) },
    { k: "ACTIVE INDICES", v: "03", d: "HDP8 · RWA7 · AIM3", c: tokens.textDim, data: null as number[] | null },
    { k: "REBALANCES (24H)", v: "11", d: "avg 4.2s latency", c: tokens.cyan, data: fakeSeries(30, 50, 0.15, 5) },
    { k: "RISK SCORE", v: "LOW", d: "σ 0.18 · 0 alerts", c: tokens.emerald, data: null as number[] | null },
  ];

  const events = [
    { t: "09:42:18", a: "Detected sentiment spike", d: "DePIN +15σ · 11 assets", c: tokens.emerald, lbl: "SIGNAL" },
    { t: "09:41:52", a: "Fetched fund flow", d: "Terminal API · 24h window", c: tokens.cyan, lbl: "TOOL" },
    { t: "09:38:04", a: "Rebalanced HDP8", d: "+2.1% FIL · −1.4% RNDR", c: tokens.emerald, lbl: "EXEC" },
    { t: "09:35:11", a: "Backtest complete", d: "strategy #14 · Sharpe 1.82", c: tokens.textDim, lbl: "INFO" },
    { t: "09:30:00", a: "Risk gate pass", d: "all thresholds within bounds", c: tokens.emerald, lbl: "OK" },
    { t: "09:22:44", a: "MCP query received", d: '"show RWA opportunities"', c: tokens.cyan, lbl: "CHAT" },
    { t: "09:14:12", a: "Weight drift detected", d: "RWA7 · FIL 21.8% → cap 22%", c: tokens.amber, lbl: "WARN" },
    { t: "08:56:31", a: "Scheduled rebalance", d: "RWA7 · redistributed 5 assets", c: tokens.emerald, lbl: "EXEC" },
  ];

  const indices = [
    { n: "HYPE-DEPIN-8", s: "HDP8", a: "$1.10M", d: "+5.24%", dc: tokens.emerald, sh: "1.82", h: "127", r: "2m ago", st: "LIVE", sc: tokens.emerald, spark: fakeSeries(20, 100, 0.04, 2) },
    { n: "RWA-SEVEN", s: "RWA7", a: "$780K", d: "+1.82%", dc: tokens.emerald, sh: "1.41", h: "64", r: "4h ago", st: "LIVE", sc: tokens.emerald, spark: fakeSeries(20, 100, 0.02, 4) },
    { n: "AI-MEME-3", s: "AIM3", a: "$260K", d: "−0.41%", dc: tokens.red, sh: "0.92", h: "18", r: "now", st: "REBAL", sc: tokens.amber, spark: fakeSeries(20, 100, 0.06, 8) },
  ];

  const sectors: [string, number, string][] = [
    ["DePIN", 92, tokens.emerald],
    ["RWA", 78, tokens.emerald],
    ["AI", 71, tokens.emerald],
    ["Memes", 64, tokens.amber],
    ["DeFi", 58, tokens.amber],
    ["L2", 44, tokens.textDim],
    ["Gaming", 31, tokens.textDim],
    ["NFT", -12, tokens.red],
  ];

  return (
    <div className="px-6 py-5 flex flex-col gap-4">
      <div className="flex justify-between items-end">
        <div>
          <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>
            Command Center
          </div>
          <Mono size={11}>3 indices live · agent logged 14 decisions in 24h · last pulse 2s ago</Mono>
        </div>
        <div className="flex gap-2">
          <Btn small>Pause agent</Btn>
          <Btn small primary icon={<span style={{ fontSize: 14 }}>+</span>}>
            New index
          </Btn>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3">
        {kpis.map((c, i) => (
          <Card key={i} pad={14}>
            <div className="flex justify-between items-start">
              <div>
                <Label>{c.k}</Label>
                <Metric v={c.v} size={28} style={{ marginTop: 8 }} />
                <Mono size={11} color={c.c} style={{ marginTop: 4, display: "block" }}>
                  {c.d}
                </Mono>
              </div>
              {c.data && <Spark data={c.data} w={70} h={36} color={c.c} />}
            </div>
          </Card>
        ))}
      </div>

      <div className="grid gap-3" style={{ gridTemplateColumns: "1.5fr 1fr" }}>
        <Card pad={16}>
          <div className="flex justify-between mb-3">
            <div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>Portfolio NAV</div>
              <Mono size={10}>aggregate · usd · 90d</Mono>
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
            h={240}
            series={[
              { data: navData, color: tokens.emerald, thick: true, fill: true },
              { data: fakeSeries(60, 100, 0.02, 11), color: tokens.textDim, dashed: true },
            ]}
          />
          <div className="flex gap-4 mt-2">
            <div className="flex items-center gap-1.5">
              <div style={{ width: 12, height: 2, background: tokens.emerald }} />
              <Mono size={10} color={tokens.text}>HypeNode aggregate</Mono>
            </div>
            <div className="flex items-center gap-1.5">
              <div style={{ width: 12, height: 2, background: tokens.textDim }} />
              <Mono size={10}>BTC benchmark</Mono>
            </div>
          </div>
        </Card>

        <Card pad={0}>
          <div
            className="flex justify-between items-center"
            style={{ padding: "14px 16px", borderBottom: `1px solid ${tokens.border}` }}
          >
            <div style={{ fontSize: 14, fontWeight: 600 }}>Agent Activity</div>
            <Tag small color={tokens.emerald} dot>monitoring</Tag>
          </div>
          <div style={{ padding: "6px 0", overflowY: "auto", maxHeight: 290 }}>
            {events.map((e, i) => (
              <div
                key={i}
                className="flex gap-2.5 items-start"
                style={{ padding: "8px 16px", borderBottom: `1px solid ${tokens.borderFaint}` }}
              >
                <Mono size={10} color={tokens.textFaint} style={{ minWidth: 54, paddingTop: 2 }}>
                  {e.t}
                </Mono>
                <Tag small color={e.c} style={{ minWidth: 44, justifyContent: "center" }}>
                  {e.lbl}
                </Tag>
                <div className="flex-1">
                  <div style={{ fontSize: 12.5, color: tokens.text, fontWeight: 500 }}>{e.a}</div>
                  <Mono size={10}>{e.d}</Mono>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid gap-3" style={{ gridTemplateColumns: "1.5fr 1fr" }}>
        <Card pad={0}>
          <div
            className="flex justify-between items-center"
            style={{ padding: "12px 16px", borderBottom: `1px solid ${tokens.border}` }}
          >
            <div style={{ fontSize: 14, fontWeight: 600 }}>My Indices</div>
            <Mono size={10}>on-chain · ValueChain L1</Mono>
          </div>
          <div
            className="grid"
            style={{
              gridTemplateColumns: "1.8fr 1fr 0.8fr 1fr 0.8fr 1.2fr 0.8fr",
              padding: "8px 16px",
              gap: 8,
              borderBottom: `1px solid ${tokens.borderFaint}`,
            }}
          >
            {["NAME", "AUM", "24H", "SHARPE", "HOLDERS", "LAST REBAL", "STATUS"].map((k) => (
              <Label key={k}>{k}</Label>
            ))}
          </div>
          {indices.map((r, i) => (
            <div
              key={i}
              className="grid items-center"
              style={{
                gridTemplateColumns: "1.8fr 1fr 0.8fr 1fr 0.8fr 1.2fr 0.8fr",
                padding: "11px 16px",
                gap: 8,
                borderBottom: `1px solid ${tokens.borderFaint}`,
              }}
            >
              <div className="flex items-center gap-2.5">
                <div
                  className="flex items-center justify-center font-mono"
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 6,
                    background: tokens.bgElev2,
                    border: `1px solid ${tokens.border}`,
                    fontSize: 9.5,
                    color: tokens.emerald,
                    fontWeight: 600,
                  }}
                >
                  {r.s.slice(0, 2)}
                </div>
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: tokens.text }}>{r.n}</div>
                  <Mono size={9.5}>{r.s}</Mono>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Mono size={12} color={tokens.text}>{r.a}</Mono>
                <Spark data={r.spark} w={50} h={20} color={r.dc} fill={false} />
              </div>
              <Mono size={12} color={r.dc}>{r.d}</Mono>
              <Mono size={12} color={tokens.text}>{r.sh}</Mono>
              <Mono size={12}>{r.h}</Mono>
              <Mono size={11}>{r.r}</Mono>
              <Tag small color={r.sc} dot>
                {r.st}
              </Tag>
            </div>
          ))}
        </Card>

        <Card pad={16}>
          <div className="flex justify-between mb-3">
            <div style={{ fontSize: 14, fontWeight: 600 }}>Sector Sentiment</div>
            <Mono size={10}>SoSoValue · 1h</Mono>
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {sectors.map(([s, v, c], i) => (
              <div
                key={i}
                style={{
                  padding: "10px 10px",
                  background: `${c}10`,
                  border: `1px solid ${c}30`,
                  borderRadius: 6,
                }}
              >
                <Mono size={9.5} color={tokens.textDim}>
                  {s}
                </Mono>
                <div
                  className="tabular"
                  style={{
                    fontSize: 20,
                    fontWeight: 600,
                    color: c,
                    letterSpacing: "-0.02em",
                    marginTop: 2,
                  }}
                >
                  {(v as number) > 0 ? "+" : ""}
                  {v}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
