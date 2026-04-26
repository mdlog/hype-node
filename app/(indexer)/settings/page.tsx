import { Card, Label, Metric, Mono, Tag, Btn, Spark, Meter, LineChart, Toggle } from "@/components/ui";
import { tokens } from "@/lib/tokens";
import { fakeSeries } from "@/lib/fake-data";

const quotas = [
  { t: "Terminal · Sentiment", u: 84.2, c: 100, p: "k req/day", sp: fakeSeries(30, 50, 0.1, 2) },
  { t: "Terminal · Fund Flow", u: 26.4, c: 50, p: "k req/day", sp: fakeSeries(30, 30, 0.1, 4) },
  { t: "Terminal · News", u: 11.8, c: 20, p: "k req/day", sp: fakeSeries(30, 12, 0.08, 6) },
];

export default function SettingsPage() {
  return (
    <div className="grid h-[calc(100vh-48px)]" style={{ gridTemplateColumns: "220px 1fr" }}>
      <div style={{ padding: 16, borderRight: `1px solid ${tokens.border}` }}>
        <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 14, letterSpacing: "-0.02em" }}>Settings</div>
        {[
          ["Profile", false],
          ["API Limits", true],
          ["Keys & Connections", false],
          ["MCP Tools", false],
          ["Risk Defaults", false],
          ["Notifications", false],
          ["Billing", false],
        ].map(([l, on], i) => (
          <div
            key={i}
            style={{
              padding: "8px 12px",
              background: on ? tokens.bgElev : "transparent",
              border: `1px solid ${on ? tokens.border : "transparent"}`,
              borderLeft: on ? `2px solid ${tokens.emerald}` : "2px solid transparent",
              borderRadius: 5,
              marginBottom: 2,
              fontSize: 12.5,
              color: on ? tokens.text : tokens.textDim,
              fontWeight: on ? 600 : 500,
              cursor: "pointer",
            }}
          >
            {l}
          </div>
        ))}
      </div>

      <div className="overflow-y-auto flex flex-col gap-3.5" style={{ padding: 24 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.02em" }}>API Limits & Usage</div>
          <Mono size={11}>
            SoSoValue Terminal · SSI Protocol · SoDEX · internal backtest runner
          </Mono>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {quotas.map((q, i) => {
            const pct = q.u / q.c;
            const c = pct > 0.8 ? tokens.red : pct > 0.6 ? tokens.amber : tokens.emerald;
            return (
              <Card key={i} pad={14}>
                <div className="flex justify-between">
                  <div style={{ fontSize: 12.5, fontWeight: 600 }}>{q.t}</div>
                  <Tag small color={c} dot>
                    {Math.round(pct * 100)}%
                  </Tag>
                </div>
                <div className="flex items-baseline gap-1.5 mt-1.5">
                  <Metric v={`${q.u}k`} size={22} color={c} />
                  <Mono size={11}>
                    / {q.c}k {q.p}
                  </Mono>
                </div>
                <Meter v={pct} color={c} h={4} />
                <div className="mt-2">
                  <Spark data={q.sp} w={240} h={34} color={c} />
                </div>
              </Card>
            );
          })}
        </div>

        <Card pad={16}>
          <div className="flex justify-between mb-2.5">
            <div style={{ fontSize: 13, fontWeight: 600 }}>Usage over time · 7 days</div>
            <Mono size={10}>tier: pro · upgrade pending</Mono>
          </div>
          <LineChart
            w={1100}
            h={140}
            series={[
              { data: fakeSeries(42, 50, 0.1, 1), color: tokens.emerald, fill: true, thick: true },
              { data: fakeSeries(42, 30, 0.1, 3), color: tokens.cyan },
              { data: fakeSeries(42, 12, 0.08, 5), color: tokens.amber },
            ]}
          />
        </Card>

        <Card pad={16} style={{ background: tokens.amber + "06", borderColor: tokens.amber + "40" }}>
          <div className="flex justify-between mb-2.5">
            <div style={{ fontSize: 13, fontWeight: 600 }}>Request higher limits</div>
            <Tag small color={tokens.amber} dot>pending review</Tag>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div
              style={{
                padding: 12,
                background: tokens.bgElev2,
                border: `1px solid ${tokens.border}`,
                borderRadius: 6,
              }}
            >
              <Label>Use case</Label>
              <div style={{ fontSize: 12, color: tokens.text, lineHeight: 1.5, marginTop: 6 }}>
                Research-to-Execution agent requires real-time sentiment + fund-flow monitoring to
                trigger auto-rebalancing and to run backtests before publishing indices to SSI Protocol.
              </div>
            </div>
            <div
              style={{
                padding: 12,
                background: tokens.bgElev2,
                border: `1px solid ${tokens.border}`,
                borderRadius: 6,
              }}
            >
              <Label>Requested limits</Label>
              <div className="mt-1.5">
                {[
                  ["Sentiment", "100k → 500k/day"],
                  ["Fund flow", "50k → 200k/day"],
                  ["Historical", "90d → 3yr"],
                ].map(([k, v]) => (
                  <div
                    key={k}
                    className="flex justify-between"
                    style={{ padding: "4px 0", borderBottom: `1px solid ${tokens.borderFaint}` }}
                  >
                    <div style={{ fontSize: 11.5, color: tokens.text }}>{k}</div>
                    <Mono size={11} color={tokens.emerald}>{v}</Mono>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="flex gap-1.5 mt-3 justify-end">
            <Btn small>Edit justification</Btn>
            <Btn small primary>Submit upgrade request</Btn>
          </div>
        </Card>

        <Card pad={14}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Rate-limit strategy</div>
          {[
            ["Cache sentiment for 30s when sector is idle", true],
            ["Batch flow calls across active indices", true],
            ["Throttle during quiet hours (02:00–06:00)", false],
            ["Fall back to cached values on 429", true],
          ].map(([r, on], i) => (
            <div
              key={i}
              className="flex justify-between items-center"
              style={{ padding: "7px 0", borderBottom: `1px solid ${tokens.borderFaint}` }}
            >
              <div style={{ fontSize: 12, color: on ? tokens.text : tokens.textDim }}>{r}</div>
              <Toggle on={!!on} />
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}
