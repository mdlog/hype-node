import { Card, Label, Metric, Mono, Tag, Btn, Spark, Meter } from "@/components/ui";
import { tokens } from "@/lib/tokens";
import { fakeSeries } from "@/lib/fake-data";

const rows = [
  { n: "HYPE-DEPIN-8", s: "HDP8", sec: "DePIN", nav: "$1.182", ret: "+18.2%", rc: tokens.emerald, subs: 127, aum: "$4.10M", earn: "$312.40", st: "LIVE", sc: tokens.emerald, spark: fakeSeries(20, 100, 0.04, 2), hot: true },
  { n: "RWA-TBILL-7", s: "RWA7", sec: "RWA", nav: "$1.089", ret: "+8.9%", rc: tokens.emerald, subs: 64, aum: "$2.80M", earn: "$184.20", st: "LIVE", sc: tokens.emerald, spark: fakeSeries(20, 100, 0.02, 4), hot: false },
  { n: "RESTK-L2-6", s: "RL2", sec: "Restaking", nav: "$1.312", ret: "+31.2%", rc: tokens.emerald, subs: 89, aum: "$3.10M", earn: "$512.80", st: "LIVE", sc: tokens.emerald, spark: fakeSeries(20, 100, 0.05, 6), hot: true },
  { n: "SOL-DEFI-6", s: "SOL6", sec: "Solana DeFi", nav: "$1.124", ret: "+12.4%", rc: tokens.emerald, subs: 52, aum: "$1.60M", earn: "$248.10", st: "LIVE", sc: tokens.emerald, spark: fakeSeries(20, 100, 0.04, 8), hot: false },
  { n: "AI-AGENT-5", s: "AIA5", sec: "AI Agents", nav: "$0.942", ret: "−5.8%", rc: tokens.red, subs: 41, aum: "$0.80M", earn: "$64.10", st: "LIVE", sc: tokens.emerald, spark: fakeSeries(20, 100, 0.06, 10), hot: false },
  { n: "MEME-SEASON-4", s: "MS4", sec: "Memes", nav: "$0.882", ret: "−11.8%", rc: tokens.red, subs: 18, aum: "$0.14M", earn: "$12.40", st: "UNSUB", sc: tokens.amber, spark: fakeSeries(20, 100, 0.08, 12), hot: false },
  { n: "GAMEFI-CORE", s: "GFC", sec: "Gaming", nav: "$1.041", ret: "+4.1%", rc: tokens.emerald, subs: 22, aum: "$0.24M", earn: "$18.40", st: "LIVE", sc: tokens.emerald, spark: fakeSeries(20, 100, 0.04, 14), hot: false },
  { n: "RWA-CREDIT-4", s: "RWC4", sec: "RWA", nav: "$1.062", ret: "+6.2%", rc: tokens.emerald, subs: 28, aum: "$0.42M", earn: "$32.20", st: "LIVE", sc: tokens.emerald, spark: fakeSeries(20, 100, 0.02, 16), hot: false },
];

export default function PublishedPage() {
  return (
    <div className="px-6 py-5 flex flex-col gap-3.5 h-[calc(100vh-52px)]">
      <div className="flex justify-between items-end">
        <div>
          <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>
            My Published Indices
          </div>
          <Mono size={11}>
            12 live on SSI · 284 total subscribers · $12.4M AUM across all indices
          </Mono>
        </div>
        <div className="flex gap-1.5">
          <Btn small>Filter</Btn>
          <Btn small>Sort: earnings ↓</Btn>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3">
        {[
          { k: "LIVE INDICES", v: "12", d: "+2 this month", c: tokens.text },
          { k: "TOTAL SUBSCRIBERS", v: "284", d: "+42 (30d)", c: tokens.emerald },
          { k: "COMBINED AUM", v: "$12.4M", d: "+18.4%", c: tokens.emerald },
          { k: "CREATOR RANK", v: "#47", d: "top 5% · DePIN", c: tokens.amber },
        ].map((c, i) => (
          <Card key={i} pad={14}>
            <Label>{c.k}</Label>
            <Metric v={c.v} size={26} style={{ marginTop: 6 }} />
            <Mono size={11} color={c.c} className="mt-1 block">
              {c.d}
            </Mono>
          </Card>
        ))}
      </div>

      <Card pad={0} className="flex-1 overflow-hidden flex flex-col">
        <div
          className="grid"
          style={{
            gridTemplateColumns: "2fr 1fr 1fr 1fr 1.2fr 1fr 1fr 0.8fr",
            padding: "10px 16px",
            gap: 10,
            borderBottom: `1px solid ${tokens.border}`,
            background: tokens.bgElev2,
          }}
        >
          {["INDEX", "SECTOR", "PRICE / NAV", "30D RETURN", "SUBS", "AUM", "30D EARN", "STATUS"].map(
            (k) => (
              <Label key={k}>{k}</Label>
            ),
          )}
        </div>
        <div className="flex-1 overflow-y-auto">
          {rows.map((r, i) => (
            <div
              key={i}
              className="grid items-center"
              style={{
                gridTemplateColumns: "2fr 1fr 1fr 1fr 1.2fr 1fr 1fr 0.8fr",
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
                  {r.s.slice(0, 3)}
                </div>
                <div>
                  <div className="flex items-center gap-1">
                    <div style={{ fontSize: 12.5, fontWeight: 600 }}>{r.n}</div>
                    {r.hot && (
                      <Tag small color={tokens.amber} dot>
                        hot
                      </Tag>
                    )}
                  </div>
                  <Mono size={9.5}>{r.s}</Mono>
                </div>
              </div>
              <Tag small color={tokens.cyan}>
                {r.sec}
              </Tag>
              <div className="flex items-center gap-2">
                <Mono size={11} color={tokens.text}>{r.nav}</Mono>
                <Spark data={r.spark} w={42} h={18} color={r.rc} fill={false} />
              </div>
              <Mono size={12} color={r.rc}>{r.ret}</Mono>
              <div className="flex items-center gap-1.5">
                <Mono size={11} color={tokens.text}>{r.subs}</Mono>
                <Meter v={r.subs / 130} color={tokens.emerald} h={3} />
              </div>
              <Mono size={11} color={tokens.text}>{r.aum}</Mono>
              <Mono size={11.5} color={tokens.emerald}>{r.earn}</Mono>
              <Tag small color={r.sc} dot>
                {r.st}
              </Tag>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
