"use client";

import { Card, Label, Mono, Tag, Btn, Meter, Toggle } from "@/components/ui";
import { tokens } from "@/lib/tokens";
import { Fragment, useState } from "react";

const constituents: [string, string, number, number, string, string, string][] = [
  ["FIL", "Filecoin", 92, 22, "5.0B", "+8.2%", tokens.emerald],
  ["RNDR", "Render", 71, 18, "3.2B", "+2.4%", tokens.emerald],
  ["HNT", "Helium", 66, 15, "1.1B", "+5.1%", tokens.emerald],
  ["AR", "Arweave", 58, 12, "0.8B", "−1.2%", tokens.red],
  ["AKT", "Akash", 61, 11, "0.6B", "+12.8%", tokens.emerald],
  ["IOTX", "IoTeX", 48, 9, "0.4B", "+0.4%", tokens.textDim],
  ["DIMO", "Dimo", 52, 8, "0.2B", "+3.1%", tokens.emerald],
  ["ATH", "Aethir", 44, 5, "0.3B", "−2.8%", tokens.red],
];

export default function BuilderPage() {
  const [triggers, setTriggers] = useState<Record<string, boolean>>({
    cron: true,
    sentiment: true,
    flow: false,
    vol: true,
    news: false,
  });
  const [rule, setRule] = useState(0);

  const stepLabels = ["Signal", "Constituents", "Weights & rules", "Simulate", "Deploy"];

  return (
    <div className="px-6 py-5 flex flex-col gap-3.5">
      <div className="flex justify-between items-end">
        <div>
          <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>Index Builder</div>
          <Mono size={11}>research → execution · draft, simulate, deploy to SSI Protocol</Mono>
        </div>
        <div className="flex gap-1.5">
          <Btn small>Save draft</Btn>
          <Btn small>Load template</Btn>
        </div>
      </div>

      <div
        className="flex items-center"
        style={{
          padding: "12px 16px",
          background: tokens.bgElev,
          border: `1px solid ${tokens.border}`,
          borderRadius: 8,
        }}
      >
        {stepLabels.map((s, i) => (
          <Fragment key={i}>
            <div className="flex items-center gap-2">
              <div
                className="flex items-center justify-center font-mono"
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: "50%",
                  background:
                    i < 2
                      ? tokens.emerald
                      : i === 2
                        ? tokens.cyan + "20"
                        : tokens.bgElev2,
                  border: `1px solid ${i < 2 ? tokens.emerald : i === 2 ? tokens.cyan : tokens.border}`,
                  fontSize: 10,
                  color: i < 2 ? tokens.bg : i === 2 ? tokens.cyan : tokens.textDim,
                  fontWeight: 600,
                }}
              >
                {i < 2 ? "✓" : i + 1}
              </div>
              <div style={{ fontSize: 12.5, fontWeight: i === 2 ? 600 : 500, color: i <= 2 ? tokens.text : tokens.textDim }}>
                {s}
              </div>
            </div>
            {i < stepLabels.length - 1 && (
              <div
                style={{
                  flex: 1,
                  height: 1,
                  background: i < 2 ? tokens.emerald : tokens.border,
                  margin: "0 14px",
                }}
              />
            )}
          </Fragment>
        ))}
      </div>

      <div className="grid gap-3" style={{ gridTemplateColumns: "1.3fr 1fr" }}>
        <Card pad={0}>
          <div
            className="flex justify-between items-center"
            style={{ padding: "12px 16px", borderBottom: `1px solid ${tokens.border}` }}
          >
            <div style={{ fontSize: 14, fontWeight: 600 }}>Constituents · 8 assets</div>
            <div className="flex gap-1.5">
              <Btn small>+ Add asset</Btn>
              <Btn small icon={<span style={{ color: tokens.cyan }}>✦</span>}>
                Auto-suggest
              </Btn>
            </div>
          </div>
          <div
            className="grid"
            style={{
              gridTemplateColumns: "2fr 0.8fr 1.4fr 0.9fr 0.9fr 30px",
              padding: "8px 16px",
              gap: 10,
              borderBottom: `1px solid ${tokens.borderFaint}`,
            }}
          >
            {["ASSET", "SENTIMENT", "WEIGHT", "MCAP", "24H", ""].map((k, i) => (
              <Label key={i}>{k}</Label>
            ))}
          </div>
          {constituents.map(([sym, n, s, w, cap, d, dc], i) => (
            <div
              key={i}
              className="grid items-center"
              style={{
                gridTemplateColumns: "2fr 0.8fr 1.4fr 0.9fr 0.9fr 30px",
                padding: "10px 16px",
                gap: 10,
                borderBottom: `1px solid ${tokens.borderFaint}`,
              }}
            >
              <div className="flex items-center gap-2.5">
                <div
                  className="flex items-center justify-center font-mono"
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 5,
                    background: tokens.bgElev2,
                    border: `1px solid ${tokens.border}`,
                    fontSize: 9,
                    fontWeight: 600,
                    color: tokens.emerald,
                  }}
                >
                  {sym}
                </div>
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 500 }}>{n}</div>
                  <Mono size={9.5}>{sym}</Mono>
                </div>
              </div>
              <Mono size={12} color={(s as number) > 60 ? tokens.emerald : (s as number) > 40 ? tokens.amber : tokens.textDim}>
                +{s}
              </Mono>
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <Meter v={(w as number) / 25} color={tokens.emerald} h={5} />
                </div>
                <Mono size={11} color={tokens.text} style={{ minWidth: 34, textAlign: "right" }}>
                  {(w as number).toFixed(1)}%
                </Mono>
              </div>
              <Mono size={11}>${cap}</Mono>
              <Mono size={11} color={dc as string}>{d}</Mono>
              <div style={{ color: tokens.textFaint, cursor: "pointer", fontSize: 14, textAlign: "center" }}>×</div>
            </div>
          ))}
          <div
            className="flex justify-between items-center"
            style={{ padding: "12px 16px", background: tokens.bgElev2 }}
          >
            <Mono size={11}>Total weight</Mono>
            <div className="flex items-center gap-2">
              <Mono size={12} color={tokens.emerald}>100.00% ✓</Mono>
              <Tag small color={tokens.emerald} dot>balanced</Tag>
            </div>
          </div>
        </Card>

        <div className="flex flex-col gap-3">
          <Card pad={14}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Index metadata</div>
            <div className="grid grid-cols-2 gap-2">
              {[
                ["Name", "HYPE-DEPIN-8"],
                ["Symbol", "HDP8"],
                ["Base", "USDC"],
                ["Chain", "ValueChain L1"],
              ].map(([k, v]) => (
                <div
                  key={k}
                  style={{
                    padding: "6px 10px",
                    background: tokens.bgElev2,
                    border: `1px solid ${tokens.border}`,
                    borderRadius: 5,
                  }}
                >
                  <Mono size={9}>{k}</Mono>
                  <div
                    className="font-mono"
                    style={{ fontSize: 12.5, color: tokens.text, marginTop: 1 }}
                  >
                    {v}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card pad={14}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Weighting rule</div>
            {[
              "Sentiment-weighted (AI score)",
              "Market cap × liquidity",
              "Equal weight",
              "Custom formula",
            ].map((r, i) => (
              <div
                key={i}
                onClick={() => setRule(i)}
                style={{
                  padding: "8px 10px",
                  background: i === rule ? tokens.emerald + "12" : "transparent",
                  border: `1px solid ${i === rule ? tokens.emerald + "40" : tokens.border}`,
                  borderRadius: 5,
                  marginBottom: 4,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  cursor: "pointer",
                }}
              >
                <div
                  className="flex items-center justify-center"
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: "50%",
                    border: `1.5px solid ${i === rule ? tokens.emerald : tokens.borderStrong}`,
                    background: i === rule ? tokens.emerald + "30" : "transparent",
                  }}
                >
                  {i === rule && (
                    <div
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: tokens.emerald,
                      }}
                    />
                  )}
                </div>
                <div style={{ fontSize: 12, color: i === rule ? tokens.text : tokens.textDim }}>{r}</div>
              </div>
            ))}
          </Card>

          <Card pad={14} className="flex-1">
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Rebalance triggers</div>
            {[
              ["Every 6h (cron)", "cron"],
              ["Sentiment Δ > 15", "sentiment"],
              ["Flow reversal", "flow"],
              ["Volatility > 0.35", "vol"],
              ["News keyword match", "news"],
            ].map(([r, k]) => (
              <div
                key={k}
                className="flex justify-between items-center"
                style={{ padding: "6px 0", borderBottom: `1px solid ${tokens.borderFaint}` }}
              >
                <div style={{ fontSize: 12, color: triggers[k] ? tokens.text : tokens.textDim }}>{r}</div>
                <Toggle on={triggers[k]} onChange={(next) => setTriggers((p) => ({ ...p, [k]: next }))} />
              </div>
            ))}
          </Card>

          <div className="flex gap-2">
            <Btn small>← Back</Btn>
            <div className="flex-1" />
            <Btn small>Save draft</Btn>
            <Btn small primary>Simulate →</Btn>
          </div>
        </div>
      </div>
    </div>
  );
}
