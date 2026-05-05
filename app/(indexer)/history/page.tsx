import { Card, Label, Mono, Tag, Btn } from "@/components/ui";
import { tokens } from "@/lib/tokens";
import { getEtfHistory, listEtfs, getEtfSummaryHistory } from "@/lib/api/sosovalue";
import { getDecisionHistory, getHistoryStats } from "@/lib/api/agent";
import { EtfSnapshotPanel } from "@/components/history/EtfSnapshotPanel";
import { AgentDecisionLog } from "@/components/history/AgentDecisionLog";

// Decision log lives in agent-service SQLite — must be fresh on every load
// (no static revalidate window) so a just-finished cycle shows up.
export const revalidate = 0;

const SYMBOL = "BTC";

function fmtFlow(usd: number): string {
  const abs = Math.abs(usd);
  if (abs >= 1_000_000_000) return `${usd >= 0 ? "+" : "−"}$${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${usd >= 0 ? "+" : "−"}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${usd >= 0 ? "+" : "−"}$${(abs / 1_000).toFixed(0)}K`;
  return `${usd >= 0 ? "+" : "−"}$${abs.toFixed(0)}`;
}

function classify(flow: number): { lbl: string; c: string } {
  const abs = Math.abs(flow);
  if (flow < -200_000_000) return { lbl: "EXIT", c: tokens.red };
  if (flow < -50_000_000) return { lbl: "GUARD", c: tokens.amber };
  if (abs < 5_000_000) return { lbl: "SKIP", c: tokens.textFaint };
  if (flow < 0) return { lbl: "OUTFLOW", c: tokens.red };
  if (flow > 200_000_000) return { lbl: "WRAP", c: tokens.emerald };
  return { lbl: "REBAL", c: tokens.cyan };
}

function fmtRel(date: string): string {
  const t = Date.now() - new Date(date).getTime();
  const d = Math.floor(t / 86_400_000);
  if (d === 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 7) return `${d}d ago`;
  return new Date(date).toISOString().slice(0, 10);
}

export default async function HistoryPage() {
  // Two audit trails on this page:
  //   1. Agent decision log (top) — real persistent decisions from
  //      agent-service SQLite. Each row = one LangGraph cycle.
  //   2. ETF flow audit (bottom) — SoSoValue ETF history, kept as the
  //      market-side reference. Each daily ETF inflow is treated as a
  //      synthetic "rebalance event" so users with no agent activity yet
  //      still see something meaningful.
  const [agentRows, agentStats, etfs, summary] = await Promise.all([
    getDecisionHistory({ limit: 50 }),
    getHistoryStats(),
    listEtfs(SYMBOL, "US"),
    getEtfSummaryHistory(SYMBOL, "US", { limit: 30 }),
  ]);

  // Pull individual ETF history for the top 3 ETFs to enrich per-row metadata.
  const top3 = etfs.slice(0, 3);
  const histories = await Promise.all(
    top3.map((e) => getEtfHistory(e.ticker, { limit: 10 }).catch(() => [])),
  );

  // Build the activity log: aggregate rows + per-ETF rows interleaved by date.
  type Row = {
    date: string;
    rel: string;
    label: string;
    color: string;
    action: string;
    target: string;
    trigger: string;
    flowUsd: number;
    cum: number;
    txDigest: string;
  };

  const rows: Row[] = [];
  for (const s of summary) {
    const c = classify(s.total_net_inflow);
    rows.push({
      date: s.date,
      rel: fmtRel(s.date),
      label: c.lbl,
      color: c.c,
      action: `Aggregate ETF flow · ${fmtFlow(s.total_net_inflow)}`,
      target: `${SYMBOL} ETF`,
      trigger: `assets ${(s.total_net_assets / 1_000_000_000).toFixed(1)}B · vol ${(s.total_value_traded / 1_000_000_000).toFixed(1)}B`,
      flowUsd: s.total_net_inflow,
      cum: s.cum_net_inflow,
      txDigest: `etf:${SYMBOL}:${s.date}`,
    });
  }

  for (let i = 0; i < top3.length; i++) {
    const etf = top3[i];
    for (const h of histories[i]) {
      const c = classify(h.net_inflow);
      rows.push({
        date: h.date,
        rel: fmtRel(h.date),
        label: c.lbl,
        color: c.c,
        action: `${etf.ticker} · ${fmtFlow(h.net_inflow)}`,
        target: etf.ticker,
        trigger: `${etf.exchange} · prem/dsc ${(h.prem_dsc * 100).toFixed(3)}%`,
        flowUsd: h.net_inflow,
        cum: h.cum_inflow,
        txDigest: `${etf.ticker}:${h.date}`,
      });
    }
  }

  rows.sort((a, b) => b.date.localeCompare(a.date));

  const summaryLive = summary.length === 30 || (summary[0]?.total_net_inflow ?? 0) !== 15_000_000;

  return (
    <div className="px-6 py-5 flex flex-col gap-3">
      <div className="flex justify-between items-end">
        <div>
          <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>
            Audit Trail
          </div>
          <Mono size={11}>
            agent decisions · ETF flow reference · {agentStats?.total ?? 0} agent cycles
            persisted · {rows.length} ETF rows
          </Mono>
        </div>
        <div className="flex gap-1.5">
          <Tag small color={summaryLive ? tokens.emerald : tokens.textFaint} dot>
            {summaryLive ? "live · 1mo cap" : "fallback"}
          </Tag>
          <Btn small>Export CSV</Btn>
          <Btn small>Explorer ↗</Btn>
        </div>
      </div>

      <AgentDecisionLog initialRows={agentRows} initialStats={agentStats} />

      <div
        className="flex justify-between items-end mt-2"
        style={{ borderTop: `1px dashed ${tokens.border}`, paddingTop: 12 }}
      >
        <div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>ETF flow reference</div>
          <Mono size={10}>
            {SYMBOL} ETF history · GET /etfs/summary-history + /etfs/{`{ticker}`}/history
          </Mono>
        </div>
      </div>

      <div className="flex gap-3 items-center flex-wrap">
        <div className="flex items-center gap-1.5">
          <Label>Asset</Label>
          {["BTC", "ETH", "SOL"].map((t, i) => (
            <Tag key={t} small filled={i === 0} color={i === 0 ? tokens.text : tokens.textDim}>
              {t}
            </Tag>
          ))}
        </div>
        <div style={{ width: 1, height: 16, background: tokens.border }} />
        <div className="flex items-center gap-1.5">
          <Label>Type</Label>
          {["All", "WRAP", "REBAL", "OUTFLOW", "GUARD", "EXIT"].map((t, i) => (
            <Tag key={t} small filled={i === 0} color={i === 0 ? tokens.text : tokens.textDim}>
              {t}
            </Tag>
          ))}
        </div>
        <div style={{ width: 1, height: 16, background: tokens.border }} />
        <Tag small>Last 30 days ▾</Tag>
      </div>

      <EtfSnapshotPanel tickers={["IBIT", "FBTC", "ARKB", "BITB", "BRRR"]} />

      <Card pad={0} className="overflow-hidden flex flex-col">
        <div
          className="grid"
          style={{
            gridTemplateColumns: "120px 1fr 110px 200px 130px 120px 60px",
            padding: "10px 16px",
            gap: 12,
            borderBottom: `1px solid ${tokens.border}`,
            background: tokens.bgElev2,
          }}
        >
          {["DATE", "ACTION", "TARGET", "DETAIL", "FLOW", "CUM. INFLOW", ""].map((k, i) => (
            <Label key={i}>{k}</Label>
          ))}
        </div>
        <div style={{ maxHeight: 480, overflowY: "auto" }}>
          {rows.slice(0, 100).map((r, i) => (
            <div
              key={`${r.date}-${r.target}-${i}`}
              className="grid items-center"
              style={{
                gridTemplateColumns: "120px 1fr 110px 200px 130px 120px 60px",
                padding: "10px 16px",
                gap: 12,
                borderBottom: `1px solid ${tokens.borderFaint}`,
              }}
            >
              <div>
                <Mono size={10} color={tokens.text}>
                  {r.date}
                </Mono>
                <Mono size={9} color={tokens.textFaint}>
                  {r.rel}
                </Mono>
              </div>
              <div className="flex items-center gap-2">
                <Tag small color={r.color} style={{ minWidth: 60, justifyContent: "center" }}>
                  {r.label}
                </Tag>
                <div style={{ fontSize: 12, color: tokens.text }}>{r.action}</div>
              </div>
              <Mono size={11} color={tokens.text}>
                {r.target}
              </Mono>
              <Mono size={10}>{r.trigger}</Mono>
              <Mono size={11} color={r.flowUsd >= 0 ? tokens.emerald : tokens.red}>
                {fmtFlow(r.flowUsd)}
              </Mono>
              <Mono size={10}>{fmtFlow(r.cum)}</Mono>
              <div style={{ textAlign: "right" }}>
                <Mono size={11} color={tokens.textFaint}>
                  →
                </Mono>
              </div>
            </div>
          ))}
        </div>
        <div
          className="flex justify-between items-center"
          style={{
            padding: "10px 16px",
            borderTop: `1px solid ${tokens.border}`,
            background: tokens.bgElev2,
          }}
        >
          <Mono size={10}>
            showing {Math.min(100, rows.length)} of {rows.length} · sourced from {top3.length} ETFs
            + aggregate
          </Mono>
          <div className="flex gap-1">
            <Btn small>← Prev</Btn>
            <Btn small>Next →</Btn>
          </div>
        </div>
      </Card>
    </div>
  );
}
