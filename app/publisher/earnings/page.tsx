import { Card, Label, Metric, Mono, Btn, LineChart } from "@/components/ui";
import { tokens } from "@/lib/tokens";
import { fakeSeries } from "@/lib/fake-data";

const payouts = [
  { t: "2h ago", idx: "HDP8", a: "+$14.20", k: "mgmt fee · daily", tx: "0x8a…42" },
  { t: "2h ago", idx: "RL2", a: "+$22.80", k: "mgmt fee · daily", tx: "0x4d…e1" },
  { t: "2h ago", idx: "RWA7", a: "+$9.10", k: "mgmt fee · daily", tx: "0x77…bf" },
  { t: "yest", idx: "RL2", a: "+$84.20", k: "perf fee · weekly", tx: "0x19…a0" },
  { t: "yest", idx: "HDP8", a: "+$48.10", k: "perf fee · weekly", tx: "0x2c…11" },
  { t: "2d ago", idx: "SOL6", a: "+$18.40", k: "mgmt fee · daily", tx: "0x91…de" },
  { t: "3d ago", idx: "HDP8", a: "+$14.20", k: "mgmt fee · daily", tx: "0x55…08" },
  { t: "4d ago", idx: "AIA5", a: "+$4.10", k: "mgmt fee · daily", tx: "0xff…c3" },
];

export default function EarningsPage() {
  return (
    <div className="px-6 py-5 flex flex-col gap-3.5 h-[calc(100vh-52px)]">
      <div className="flex justify-between items-end">
        <div>
          <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>Creator Earnings</div>
          <Mono size={11}>
            management fees + performance fees · paid in USDC · auto-streamed to your wallet
          </Mono>
        </div>
        <div className="flex gap-1.5">
          <Btn small>Withdraw</Btn>
          <Btn small primary>View tax report</Btn>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3">
        {[
          { k: "AVAILABLE BALANCE", v: "$1,248.40", d: "USDC · on ValueChain", c: tokens.emerald, big: true },
          { k: "30D EARNINGS", v: "$847.22", d: "+32.1% vs prev 30d", c: tokens.emerald, big: false },
          { k: "ALL-TIME", v: "$4,284.10", d: "since Aug 2024", c: tokens.text, big: false },
          { k: "NEXT PAYOUT", v: "Mon 09:00", d: "est. $62.40", c: tokens.amber, big: false },
        ].map((c, i) => (
          <Card
            key={i}
            pad={14}
            style={
              c.big
                ? { borderColor: tokens.emerald + "50", background: tokens.emerald + "06" }
                : undefined
            }
          >
            <Label color={c.big ? tokens.emerald : tokens.textFaint}>{c.k}</Label>
            <Metric v={c.v} size={c.big ? 32 : 24} color={c.c} style={{ marginTop: 6 }} />
            <Mono size={11} className="mt-1 block">
              {c.d}
            </Mono>
          </Card>
        ))}
      </div>

      <div className="grid gap-3 flex-1 min-h-0" style={{ gridTemplateColumns: "1.5fr 1fr" }}>
        <Card pad={16}>
          <div className="flex justify-between mb-3">
            <div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>Earnings over time</div>
              <Mono size={10}>
                management fee (solid) · performance fee (dashed) · daily
              </Mono>
            </div>
            <div className="flex gap-1">
              {["30D", "90D", "1Y", "ALL"].map((t, i) => (
                <div
                  key={t}
                  style={{
                    padding: "4px 10px",
                    borderRadius: 4,
                    background: i === 0 ? tokens.bgElev2 : "transparent",
                    border: `1px solid ${i === 0 ? tokens.borderStrong : "transparent"}`,
                    fontFamily: "JetBrains Mono, monospace",
                    fontSize: 10,
                    color: i === 0 ? tokens.text : tokens.textDim,
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
              { data: fakeSeries(30, 20, 0.1, 3).map((v, i) => v + i * 0.8), color: tokens.emerald, thick: true, fill: true },
              { data: fakeSeries(30, 8, 0.15, 5).map((v, i) => v + i * 0.3), color: tokens.amber, dashed: true },
            ]}
          />
          <div className="flex gap-6 mt-3">
            {[
              ["MGMT FEE (30d)", "$584.20", tokens.emerald],
              ["PERF FEE (30d)", "$263.02", tokens.amber],
              ["AVG / INDEX", "$70.60", tokens.text],
              ["TOP EARNER", "RL2", tokens.cyan],
            ].map(([k, v, c]) => (
              <div key={k as string}>
                <Label>{k}</Label>
                <Metric v={v} size={18} color={c as string} style={{ marginTop: 3 }} />
              </div>
            ))}
          </div>
        </Card>

        <Card pad={0} className="overflow-hidden flex flex-col">
          <div
            style={{ padding: "12px 16px", borderBottom: `1px solid ${tokens.border}`, fontSize: 13, fontWeight: 600 }}
          >
            Recent payouts
          </div>
          <div className="flex-1 overflow-y-auto">
            {payouts.map((p, i) => (
              <div
                key={i}
                className="flex items-center gap-2.5"
                style={{ padding: "10px 16px", borderBottom: `1px solid ${tokens.borderFaint}` }}
              >
                <Mono size={10} color={tokens.textFaint} style={{ minWidth: 50 }}>
                  {p.t}
                </Mono>
                <div className="flex-1">
                  <div className="flex items-center gap-1.5">
                    <Mono size={11} color={tokens.text}>{p.idx}</Mono>
                    <Mono size={10}>{p.k}</Mono>
                  </div>
                  <Mono size={9.5} color={tokens.cyan}>{p.tx} ↗</Mono>
                </div>
                <Mono size={12} color={tokens.emerald}>{p.a}</Mono>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
