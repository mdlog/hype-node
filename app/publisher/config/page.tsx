"use client";

import { Card, Mono, Tag, Toggle } from "@/components/ui";
import { tokens } from "@/lib/tokens";
import { useEffect, useState } from "react";
import { CreatorIdentityCard } from "@/components/auth/CreatorIdentityCard";

const SSI_DISPLAY: Record<string, { label: string; flag: "hot" | "new" | null }> = {
  ssiDePIN: { label: "DePIN", flag: "hot" },
  ssiRWA: { label: "RWA", flag: null },
  ssiAI: { label: "AI Agents", flag: "hot" },
  ssiMeme: { label: "Memes", flag: null },
  ssiGameFi: { label: "GameFi", flag: null },
  ssiLayer1: { label: "Layer 1 majors", flag: null },
  ssiLayer2: { label: "L2 rollups", flag: null },
  ssiMAG7: { label: "Crypto MAG7", flag: null },
  ssiPayFi: { label: "PayFi", flag: "new" },
  ssiDeFi: { label: "DeFi blue-chip", flag: null },
  ssiSocialFi: { label: "SocialFi", flag: "new" },
  ssiCeFi: { label: "CeFi", flag: null },
  ssiNFT: { label: "NFT", flag: null },
};

const FALLBACK_TICKERS = [
  "ssiDePIN",
  "ssiRWA",
  "ssiAI",
  "ssiMeme",
  "ssiGameFi",
  "ssiLayer1",
  "ssiLayer2",
];

const thresholds = [
  { k: "News volume Δ", v: "+200%", prog: 0.5 },
  { k: "Min avg sentiment", v: "+70", prog: 0.7 },
  { k: "Min cluster size", v: "3 assets", prog: 0.3 },
  { k: "Min liquidity filter", v: "$5M/day", prog: 0.5 },
  { k: "Freshness window", v: "4h", prog: 0.4 },
  { k: "Agent confidence floor", v: "65", prog: 0.65 },
];

export default function ConfigPage() {
  // Sector list pulled live from SoSoValue's /indices endpoint. Falls back to
  // a deterministic set if the call fails (rate-limit / quota / no key).
  const [tickers, setTickers] = useState<string[]>(FALLBACK_TICKERS);
  const [sectorState, setSectorState] = useState<Record<string, boolean>>(
    Object.fromEntries(FALLBACK_TICKERS.map((t, i) => [t, i < 4])),
  );
  const [agentOn, setAgentOn] = useState(true);
  const [live, setLive] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/ssi/list")
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: string[]) => {
        if (cancelled || !Array.isArray(rows) || rows.length === 0) return;
        setTickers(rows);
        setLive(rows.length >= 13);
        setSectorState((prev) => {
          const next: Record<string, boolean> = {};
          rows.forEach((t, i) => {
            next[t] = prev[t] ?? i < 5;
          });
          return next;
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="px-6 py-5 flex flex-col gap-3.5">
      <div className="flex justify-between items-end">
        <div>
          <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>
            Agent Configuration
          </div>
          <Mono size={11}>
            {tickers.length} SoSoValue sectors loaded · GET /indices · agent drafts proposals · you
            approve before publish
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
          <div className="flex justify-between items-center mb-1">
            <div style={{ fontSize: 13, fontWeight: 600 }}>Sectors to monitor</div>
            <Tag small color={live ? tokens.emerald : tokens.textFaint} dot>
              {live ? "live · /indices" : "fallback"}
            </Tag>
          </div>
          <Mono size={10} className="block mb-3">
            agent scans these for hype signals
          </Mono>
          <div>
            {tickers.map((t) => {
              const display = SSI_DISPLAY[t] ?? { label: t, flag: null };
              const on = sectorState[t] ?? false;
              return (
                <div
                  key={t}
                  className="flex items-center justify-between"
                  style={{
                    padding: "8px 0",
                    borderBottom: `1px solid ${tokens.borderFaint}`,
                  }}
                >
                  <div className="flex items-center gap-2">
                    <div>
                      <div
                        style={{
                          fontSize: 12.5,
                          color: on ? tokens.text : tokens.textDim,
                          fontWeight: on ? 500 : 400,
                        }}
                      >
                        {display.label}
                      </div>
                      <Mono size={9} color={tokens.textFaint}>
                        {t}
                      </Mono>
                    </div>
                    {display.flag === "hot" && (
                      <Tag small color={tokens.amber} dot>
                        hot
                      </Tag>
                    )}
                    {display.flag === "new" && (
                      <Tag small color={tokens.cyan}>
                        new
                      </Tag>
                    )}
                  </div>
                  <Toggle
                    on={on}
                    onChange={(next) =>
                      setSectorState((p) => ({ ...p, [t]: next }))
                    }
                  />
                </div>
              );
            })}
          </div>
        </Card>

        <Card pad={16}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Hype thresholds</div>
          <Mono size={10} className="block mb-3.5">
            agent drafts when all conditions met
          </Mono>
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
          <CreatorIdentityCard />

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
                <Mono size={11} color={tokens.text}>
                  {v}
                </Mono>
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
                <Mono size={11} color={tokens.emerald}>
                  {v}
                </Mono>
              </div>
            ))}
          </Card>
        </div>
      </div>
    </div>
  );
}
