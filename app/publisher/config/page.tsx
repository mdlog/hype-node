"use client";

import { Card, Mono, Tag, Toggle } from "@/components/ui";
import { tokens } from "@/lib/tokens";
import { useState } from "react";

const sectors = [
  ["DePIN", true, tokens.emerald, "hot"],
  ["RWA", true, tokens.emerald, null],
  ["AI Agents", true, tokens.emerald, "hot"],
  ["Restaking", true, tokens.emerald, null],
  ["Solana DeFi", true, tokens.emerald, null],
  ["Memes", false, tokens.textDim, null],
  ["Gaming", false, tokens.textDim, null],
  ["L2 Rollups", true, tokens.emerald, null],
  ["Privacy", false, tokens.textDim, null],
  ["BTC L2", true, tokens.emerald, "new"],
] as const;

const thresholds = [
  { k: "News volume Δ", v: "+200%", prog: 0.5 },
  { k: "Min avg sentiment", v: "+70", prog: 0.7 },
  { k: "Min cluster size", v: "3 assets", prog: 0.3 },
  { k: "Min liquidity filter", v: "$5M/day", prog: 0.5 },
  { k: "Freshness window", v: "4h", prog: 0.4 },
  { k: "Agent confidence floor", v: "65", prog: 0.65 },
];

export default function ConfigPage() {
  const [sectorState, setSectorState] = useState(
    Object.fromEntries(sectors.map(([s, on]) => [s, on])) as Record<string, boolean>,
  );
  const [agentOn, setAgentOn] = useState(true);

  return (
    <div className="px-6 py-5 flex flex-col gap-3.5">
      <div className="flex justify-between items-end">
        <div>
          <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>
            Agent Configuration
          </div>
          <Mono size={11}>
            tune your autonomous publisher · agent drafts proposals · you approve before publish
          </Mono>
        </div>
        <div className="flex items-center gap-2.5">
          <Mono size={10}>agent status</Mono>
          <Toggle on={agentOn} onChange={setAgentOn} />
          <Mono size={10} color={agentOn ? tokens.emerald : tokens.textFaint}>
            {agentOn ? "ACTIVE" : "PAUSED"}
          </Mono>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Card pad={16}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Sectors to monitor</div>
          <Mono size={10} className="block mb-3">agent scans these for hype signals</Mono>
          {sectors.map(([s, , , flag]) => {
            const on = sectorState[s as string];
            return (
              <div
                key={s as string}
                className="flex items-center justify-between"
                style={{ padding: "8px 0", borderBottom: `1px solid ${tokens.borderFaint}` }}
              >
                <div className="flex items-center gap-2">
                  <div
                    style={{
                      fontSize: 12.5,
                      color: on ? tokens.text : tokens.textDim,
                      fontWeight: on ? 500 : 400,
                    }}
                  >
                    {s}
                  </div>
                  {flag === "hot" && (
                    <Tag small color={tokens.amber} dot>
                      hot
                    </Tag>
                  )}
                  {flag === "new" && (
                    <Tag small color={tokens.cyan}>
                      new
                    </Tag>
                  )}
                </div>
                <Toggle
                  on={on}
                  onChange={(next) => setSectorState((p) => ({ ...p, [s as string]: next }))}
                />
              </div>
            );
          })}
        </Card>

        <Card pad={16}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Hype thresholds</div>
          <Mono size={10} className="block mb-3.5">agent drafts when all conditions met</Mono>
          {thresholds.map((t, i) => (
            <div key={i} className="mb-3.5">
              <div className="flex justify-between mb-1">
                <div style={{ fontSize: 12, color: tokens.text }}>{t.k}</div>
                <Mono size={11} color={tokens.amber}>
                  {t.v}
                </Mono>
              </div>
              <div
                className="relative"
                style={{
                  height: 4,
                  background: tokens.bgElev2,
                  borderRadius: 2,
                  border: `1px solid ${tokens.borderFaint}`,
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    width: `${t.prog * 100}%`,
                    background: tokens.amber,
                    boxShadow: `0 0 8px ${tokens.amber}80`,
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    left: `${t.prog * 100}%`,
                    top: -5,
                    width: 14,
                    height: 14,
                    background: tokens.amber,
                    borderRadius: "50%",
                    transform: "translateX(-50%)",
                    border: `2px solid ${tokens.bg}`,
                    boxShadow: `0 0 10px ${tokens.amber}`,
                  }}
                />
              </div>
            </div>
          ))}
        </Card>

        <div className="flex flex-col gap-3">
          <Card pad={16}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Creator identity</div>
            <div className="flex items-center gap-3 mb-2.5">
              <div
                className="flex items-center justify-center"
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: "50%",
                  background: `linear-gradient(135deg, #a78bfa, ${tokens.cyan})`,
                  fontSize: 16,
                  fontWeight: 700,
                  color: tokens.bg,
                }}
              >
                K
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>@kartika.eth</div>
                <Mono size={10}>publisher #0x4f…a21 · joined Aug 2024</Mono>
              </div>
            </div>
            {[
              ["Display name", "Kartika"],
              ["Bio tag", "DePIN + RWA thesis"],
              ["Auto-publish", "Off · approval required"],
            ].map(([k, v]) => (
              <div
                key={k}
                className="flex justify-between"
                style={{ padding: "6px 0", borderBottom: `1px solid ${tokens.borderFaint}` }}
              >
                <Mono size={10}>{k}</Mono>
                <Mono size={11} color={tokens.text}>{v}</Mono>
              </div>
            ))}
          </Card>

          <Card pad={16}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Agent behavior</div>
            {[
              ["Weighting model", "sentiment × log(mcap)"],
              ["Max constituents", "8"],
              ["Rebalance cadence", "daily"],
              ["Min cooldown between publishes", "48h per sector"],
              ["Draft notifications", "email + in-app"],
            ].map(([k, v]) => (
              <div
                key={k}
                className="flex justify-between"
                style={{ padding: "6px 0", borderBottom: `1px solid ${tokens.borderFaint}` }}
              >
                <Mono size={10}>{k}</Mono>
                <Mono size={11} color={tokens.text}>{v}</Mono>
              </div>
            ))}
          </Card>

          <Card pad={16}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Fee defaults</div>
            {[
              ["Management fee", "1.00% / year"],
              ["Performance fee", "10.00%"],
              ["Min subscription", "$100"],
              ["High-water mark", "on"],
            ].map(([k, v]) => (
              <div
                key={k}
                className="flex justify-between"
                style={{ padding: "6px 0", borderBottom: `1px solid ${tokens.borderFaint}` }}
              >
                <Mono size={10}>{k}</Mono>
                <Mono size={11} color={tokens.emerald}>{v}</Mono>
              </div>
            ))}
          </Card>
        </div>
      </div>
    </div>
  );
}
