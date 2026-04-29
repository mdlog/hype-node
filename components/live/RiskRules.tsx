"use client";

import { useState } from "react";
import { Card, Mono, Tag, Btn, Toggle } from "@/components/ui";
import { tokens } from "@/lib/tokens";

export function RiskRules() {
  const [rules, setRules] = useState({
    vol: true,
    drawdown: true,
    sentFlow: true,
    blackswan: true,
    manual: false,
  });
  return (
    <div className="flex flex-col gap-3 min-h-0">
      <Card pad={14}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Active alerts</div>
        {[
          { l: "FIL weight approaching cap", d: "22.0% / 25.0%", c: tokens.amber },
          { l: "No critical alerts", d: "monitoring 6 metrics", c: tokens.emerald },
        ].map((a, i) => (
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
  );
}
