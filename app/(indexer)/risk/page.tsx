"use client";

import { Card, Mono, Tag, Btn, Meter, Toggle } from "@/components/ui";
import { tokens } from "@/lib/tokens";
import { useState } from "react";

const thresholds = [
  { k: "Volatility (σ)", v: 0.18 as number | string, max: 0.35, c: tokens.emerald },
  { k: "Max drawdown", v: "8.1%", prog: 0.54, c: tokens.emerald },
  { k: "Sentiment Δ (neg)", v: "−4", prog: 0.2, c: tokens.emerald },
  { k: "Net outflow (24h)", v: "$0.6M", prog: 0.12, c: tokens.emerald },
  { k: "Single-asset weight", v: "22 / 25%", prog: 0.88, c: tokens.amber },
  { k: "Correlation to BTC", v: "0.42", prog: 0.42, c: tokens.emerald },
];

const flow = [
  { l: "Monitor negative news", s: "Terminal · news API", c: tokens.textDim },
  { l: "Volatility > threshold?", s: "σ > 0.35 for 30m", c: tokens.amber },
  { l: "Unwind via SoDEX", s: "market sells, 0.5% slippage cap", c: tokens.red },
  { l: "Wrap → USSI", s: "hedged basket · await recovery", c: tokens.red },
];

const alerts = [
  { l: "FIL weight approaching cap", d: "22.0% / 25.0%", c: tokens.amber },
  { l: "No critical alerts", d: "monitoring 6 metrics", c: tokens.emerald },
];

export default function RiskPage() {
  const [rules, setRules] = useState({
    vol: true,
    drawdown: true,
    sentFlow: true,
    blackswan: true,
    manual: false,
  });
  return (
    <div className="px-6 py-5 flex flex-col gap-3.5">
      <div className="flex justify-between items-end">
        <div>
          <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>Risk Control</div>
          <Mono size={11}>parameters · thresholds · emergency routes</Mono>
        </div>
        <div
          className="flex items-center gap-2.5"
          style={{
            padding: "8px 14px",
            background: tokens.emerald + "10",
            border: `1px solid ${tokens.emerald}40`,
            borderRadius: 8,
          }}
        >
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: tokens.emerald,
              boxShadow: `0 0 10px ${tokens.emerald}`,
            }}
          />
          <div style={{ fontSize: 12, fontWeight: 600, color: tokens.emerald, letterSpacing: "0.04em" }}>
            ALL SYSTEMS NOMINAL
          </div>
          <Mono size={10}>checked 2s ago</Mono>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Card pad={16}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14 }}>Thresholds</div>
          {thresholds.map((t, i) => {
            const prog =
              "prog" in t && typeof t.prog === "number"
                ? t.prog
                : (t.v as number) / (t.max ?? 1);
            return (
              <div key={i} className="mb-3.5">
                <div className="flex justify-between mb-1">
                  <div style={{ fontSize: 12, color: tokens.text }}>{t.k}</div>
                  <Mono size={11} color={t.c}>
                    {t.v}
                  </Mono>
                </div>
                <Meter v={prog} color={t.c} h={5} />
              </div>
            );
          })}
        </Card>

        <Card pad={16}>
          <div className="flex justify-between mb-1.5">
            <div style={{ fontSize: 13, fontWeight: 600 }}>Emergency Exit Route</div>
            <Tag small color={tokens.red} dot>armed</Tag>
          </div>
          <Mono size={10} className="block mb-3.5">→ USSI hedged index on trigger</Mono>
          <div className="relative">
            {flow.map((n, i) => (
              <div key={i} className="mb-2.5">
                <div
                  style={{
                    padding: "10px 12px",
                    background: `${n.c}10`,
                    border: `1px solid ${n.c}40`,
                    borderRadius: 6,
                  }}
                >
                  <div className="flex items-center gap-2 mb-0.5">
                    <Mono size={9} color={n.c}>STEP {i + 1}</Mono>
                    <div style={{ width: 5, height: 5, borderRadius: "50%", background: n.c }} />
                  </div>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: tokens.text }}>{n.l}</div>
                  <Mono size={10}>{n.s}</Mono>
                </div>
                {i < 3 && <div style={{ width: 1, height: 12, background: tokens.border, marginLeft: 20 }} />}
              </div>
            ))}
          </div>
        </Card>

        <div className="flex flex-col gap-3">
          <Card pad={14}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Active alerts</div>
            {alerts.map((a, i) => (
              <div
                key={i}
                className="flex gap-2 items-center"
                style={{
                  padding: "8px 10px",
                  background: `${a.c}10`,
                  border: `1px solid ${a.c}30`,
                  borderRadius: 5,
                  marginBottom: 6,
                }}
              >
                <div
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: a.c,
                    boxShadow: `0 0 8px ${a.c}`,
                  }}
                />
                <div className="flex-1">
                  <div style={{ fontSize: 12, color: tokens.text }}>{a.l}</div>
                  <Mono size={10}>{a.d}</Mono>
                </div>
              </div>
            ))}
          </Card>

          <Card pad={14} className="flex-1">
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Auto-hedge rules</div>
            {[
              ["σ > 0.35 for 30m", "vol"],
              ["Drawdown > 15%", "drawdown"],
              ["Sentiment Δ < −20 + flow rev.", "sentFlow"],
              ["Blackswan keyword scan", "blackswan"],
              ["Manual override", "manual"],
            ].map(([r, k]) => {
              const on = rules[k as keyof typeof rules];
              return (
                <div
                  key={k}
                  className="flex justify-between items-center"
                  style={{ padding: "7px 0", borderBottom: `1px solid ${tokens.borderFaint}` }}
                >
                  <div style={{ fontSize: 12, color: on ? tokens.text : tokens.textDim }}>{r}</div>
                  <Toggle on={on} onChange={(next) => setRules((p) => ({ ...p, [k as string]: next }))} />
                </div>
              );
            })}
          </Card>

          <Card pad={14} style={{ background: tokens.red + "08", borderColor: tokens.red + "40" }}>
            <div className="flex items-center gap-2 mb-1">
              <div style={{ fontSize: 13, fontWeight: 600, color: tokens.red }}>⚠ Panic button</div>
            </div>
            <Mono size={10}>manual emergency exit · all indices → USSI</Mono>
            <Btn
              small
              primary
              style={{
                background: tokens.red,
                borderColor: tokens.red,
                color: tokens.bg,
                marginTop: 8,
                width: "100%",
                justifyContent: "center",
              }}
            >
              HOLD TO TRIGGER
            </Btn>
          </Card>
        </div>
      </div>
    </div>
  );
}
