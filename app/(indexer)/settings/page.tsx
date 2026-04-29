import {
  Card,
  Label,
  Metric,
  Mono,
  Tag,
  Btn,
  Spark,
  Meter,
  LineChart,
  Toggle,
} from "@/components/ui";
import { tokens } from "@/lib/tokens";
import { fakeSeries } from "@/lib/fake-data";

export const revalidate = 60;

// SoSoValue High Frequency tier — these are the hard caps your account is on.
// Replace with the published values when SoSoValue exposes a usage endpoint.
const TIER = {
  name: "High Frequency",
  perMinute: 100,
  perMonth: 100_000,
  validFrom: "2025-04-01",
  validTo: "2029-12-31",
};

// Per-endpoint allotments are heuristic until SoSoValue exposes per-endpoint
// quota. We split the monthly bucket roughly proportional to expected use.
const ENDPOINT_BUDGETS = [
  { t: "/currencies/sector-spotlight", weight: 0.15 },
  { t: "/news + /news/search", weight: 0.3 },
  { t: "/indices + /constituents", weight: 0.15 },
  { t: "/indices/{ticker}/klines", weight: 0.2 },
  { t: "/etfs/* (history+summary)", weight: 0.1 },
  { t: "/currencies/{id}/klines", weight: 0.1 },
];

export default function SettingsPage() {
  // Approximate "current" usage from envelope state. Real numbers will come
  // from the X-RateLimit-* response headers once we surface them.
  const monthlyUsed = 0; // populated when usage tracker ships
  const monthlyPct = monthlyUsed / TIER.perMonth;

  return (
    <div className="grid h-[calc(100vh-48px)]" style={{ gridTemplateColumns: "220px 1fr" }}>
      <div style={{ padding: 16, borderRight: `1px solid ${tokens.border}` }}>
        <div
          style={{
            fontSize: 17,
            fontWeight: 600,
            marginBottom: 14,
            letterSpacing: "-0.02em",
          }}
        >
          Settings
        </div>
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
          <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.02em" }}>
            API Limits & Usage
          </div>
          <Mono size={11}>
            SoSoValue OpenAPI v1 · {TIER.perMinute} req/min · {(TIER.perMonth / 1000).toFixed(0)}k
            req/month
          </Mono>
        </div>

        <Card
          pad={16}
          style={{
            background: tokens.emerald + "06",
            borderColor: tokens.emerald + "40",
          }}
        >
          <div className="flex justify-between items-center">
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: tokens.emerald }}>
                {TIER.name} Package
              </div>
              <Mono size={10} className="mt-1 block">
                active · {TIER.validFrom} → {TIER.validTo}
              </Mono>
            </div>
            <div className="flex gap-4">
              <div>
                <Label>RATE LIMIT</Label>
                <Metric v={`${TIER.perMinute}/min`} size={20} style={{ marginTop: 4 }} />
              </div>
              <div>
                <Label>MONTHLY CAP</Label>
                <Metric
                  v={`${(TIER.perMonth / 1000).toFixed(0)}k`}
                  size={20}
                  style={{ marginTop: 4 }}
                />
              </div>
            </div>
          </div>
        </Card>

        <div className="grid grid-cols-3 gap-3">
          {[
            { t: "Per-minute", u: 0, c: TIER.perMinute, p: "req/min", sp: fakeSeries(30, 5, 0.4, 2) },
            {
              t: "Monthly used",
              u: 0,
              c: TIER.perMonth,
              p: `req/${(TIER.perMonth / 1000).toFixed(0)}k`,
              sp: fakeSeries(30, 100, 0.1, 4),
            },
            {
              t: "Cache hit rate",
              u: 0.85,
              c: 1,
              p: "(15-min server cache)",
              sp: fakeSeries(30, 0.85, 0.05, 6),
            },
          ].map((q, i) => {
            const pct = q.c > 1 ? q.u / q.c : q.u;
            const c = pct > 0.8 ? tokens.red : pct > 0.6 ? tokens.amber : tokens.emerald;
            const display =
              q.c > 1 ? `${q.u}` : `${(pct * 100).toFixed(0)}%`;
            const denominator =
              q.c > 1 ? `/ ${q.c.toLocaleString()} ${q.p}` : q.p;
            return (
              <Card key={i} pad={14}>
                <div className="flex justify-between">
                  <div style={{ fontSize: 12.5, fontWeight: 600 }}>{q.t}</div>
                  <Tag small color={c} dot>
                    {Math.round(pct * 100)}%
                  </Tag>
                </div>
                <div className="flex items-baseline gap-1.5 mt-1.5">
                  <Metric v={display} size={22} color={c} />
                  <Mono size={11}>{denominator}</Mono>
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
            <div style={{ fontSize: 13, fontWeight: 600 }}>
              Usage over time · 7 days (estimated)
            </div>
            <Mono size={10}>
              {monthlyPct < 0.01
                ? "fresh cycle · usage minimal"
                : `${(monthlyPct * 100).toFixed(1)}% monthly burnt`}
            </Mono>
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

        <Card pad={16}>
          <div className="flex justify-between mb-2.5">
            <div style={{ fontSize: 13, fontWeight: 600 }}>
              Per-endpoint allotment (heuristic)
            </div>
            <Mono size={10}>
              SoSoValue does not expose per-endpoint usage; weights here are
              client-side hints used by the rate limiter.
            </Mono>
          </div>
          {ENDPOINT_BUDGETS.map((b, i) => (
            <div
              key={i}
              style={{
                padding: "8px 0",
                borderBottom: `1px solid ${tokens.borderFaint}`,
              }}
            >
              <div className="flex justify-between mb-1">
                <Mono size={11} color={tokens.text}>
                  {b.t}
                </Mono>
                <Mono size={11} color={tokens.textDim}>
                  ≈ {Math.round(TIER.perMonth * b.weight).toLocaleString()} / month
                </Mono>
              </div>
              <Meter v={b.weight} color={tokens.cyan} h={3} />
            </div>
          ))}
        </Card>

        <Card pad={14}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Rate-limit strategy</div>
          {[
            ["65s gap on Demo / 700ms gap on paid tier", true],
            ["15-min server cache for snapshot/klines", true],
            ["In-flight dedup across parallel cold reads", true],
            ["Stale-on-failure (return cached on 5xx/429)", true],
            ["6h backoff on monthly-quota error · 5min on 5xx", true],
            ["Fall back to deterministic synthetic if no cache", true],
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

        <Card pad={14}>
          <Mono size={10} color={tokens.textFaint}>
            NOTE
          </Mono>
          <div style={{ fontSize: 11.5, color: tokens.textDim, lineHeight: 1.5, marginTop: 6 }}>
            Real-time per-endpoint usage will appear here once we surface the{" "}
            <code style={{ color: tokens.cyan }}>X-RateLimit-Limit / -Remaining / -Reset</code>{" "}
            response headers from the rate-limit-aware client. SoSoValue does not provide an
            account-level usage endpoint.
          </div>
        </Card>
      </div>
    </div>
  );
}
