"use client";

import { useEffect, useState } from "react";
import { tokens } from "@/lib/tokens";

type Entry = {
  ts: string;
  kind: "TOOL" | "OBS" | "THINK" | "ACT" | "WAIT";
  text: string;
};

const KIND_COLOR: Record<Entry["kind"], string> = {
  TOOL: tokens.cyan,
  OBS: tokens.textDim,
  THINK: tokens.amber,
  ACT: tokens.emerald,
  WAIT: tokens.textFaint,
};

const FALLBACK: Entry[] = [
  { ts: "09:42:18", kind: "TOOL", text: "terminal.get_sentiment(sector='DePIN', window='1h')" },
  { ts: "09:42:19", kind: "OBS", text: "→ score=92, delta=+15 vs 1h baseline" },
  { ts: "09:42:20", kind: "THINK", text: "Spike exceeds threshold (>12). Propose rebalance toward DePIN cluster." },
  { ts: "09:42:21", kind: "TOOL", text: "terminal.get_fund_flow(sector='DePIN', window='24h')" },
  { ts: "09:42:22", kind: "OBS", text: "→ net_inflow=+$24.6M, assets=11, top=FIL(+$8.1M)" },
  { ts: "09:42:23", kind: "THINK", text: "Confirmed. Running sentiment-weighted basket (N=8) through backtester." },
  { ts: "09:42:25", kind: "TOOL", text: "backtest.run(strategy_id=14, days=90, gas='avg')" },
  { ts: "09:42:31", kind: "OBS", text: "→ sharpe=1.82, max_dd=-8.1%, win_rate=0.61, trades=142" },
  { ts: "09:42:32", kind: "THINK", text: "Passes risk gate. Preparing SSI wrap for deployment." },
  { ts: "09:42:33", kind: "ACT", text: "ssi.wrap(index='HDP8', weights=[0.22,0.18,0.15,0.12,0.11,0.09,0.08,0.05])" },
  { ts: "09:42:34", kind: "WAIT", text: "awaiting tx confirmation on ValueChain L1…" },
  { ts: "09:42:38", kind: "OBS", text: "→ tx 0x8a42… confirmed · gas 0.012 VAL · latency 4.2s" },
];

function formatTs(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toISOString().slice(11, 19);
}

export function ReasoningStream() {
  const [entries, setEntries] = useState<Entry[]>(FALLBACK);
  const [live, setLive] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const res = await fetch("/api/agent/reasoning", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as Entry[];
        if (cancelled) return;
        if (data.length > 0) {
          setLive(true);
          setEntries(data.slice(-80));
        }
      } catch {
        // keep fallback
      }
    }
    tick();
    const id = setInterval(tick, 5_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <div className="flex-1 overflow-y-auto font-mono" style={{ fontSize: 10.5 }}>
      {!live && (
        <div
          style={{
            padding: "6px 16px",
            borderBottom: `1px solid ${tokens.borderFaint}`,
            color: tokens.textFaint,
            fontSize: 10,
          }}
        >
          ⚠ agent service offline — showing canned trace. Start with{" "}
          <code style={{ color: tokens.cyan }}>npm run agent</code>.
        </div>
      )}
      {entries.map((e, i) => (
        <div
          key={i}
          className="flex gap-2 items-start"
          style={{ padding: "7px 16px", borderBottom: `1px solid ${tokens.borderFaint}` }}
        >
          <span style={{ color: tokens.textFaint, minWidth: 62, fontSize: 10 }}>{formatTs(e.ts)}</span>
          <span
            className="font-semibold uppercase"
            style={{
              color: KIND_COLOR[e.kind] ?? tokens.text,
              minWidth: 42,
              fontSize: 9.5,
              letterSpacing: "0.08em",
            }}
          >
            {e.kind}
          </span>
          <span
            className="flex-1"
            style={{
              color:
                KIND_COLOR[e.kind] === tokens.textDim
                  ? tokens.text
                  : KIND_COLOR[e.kind] === tokens.textFaint
                    ? tokens.textDim
                    : tokens.text,
              lineHeight: 1.5,
            }}
          >
            {e.text}
          </span>
        </div>
      ))}
    </div>
  );
}
