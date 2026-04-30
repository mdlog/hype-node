"use client";

import { Card, Label, Mono, Tag, Btn, Meter, Toggle } from "@/components/ui";
import { tokens } from "@/lib/tokens";
import { Fragment, useCallback, useEffect, useState } from "react";
import type { BasketProposal } from "@/lib/api/agent";

type LoadState = "loading" | "ready" | "error";

function fmtMcap(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return "—";
  if (v >= 1e12) return `${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  return v.toFixed(0);
}

function fmtPct(frac: number): string {
  if (!Number.isFinite(frac)) return "—";
  const pct = frac * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
}

function changeColor(frac: number): string {
  if (!Number.isFinite(frac) || Math.abs(frac) < 0.001) return tokens.textDim;
  return frac >= 0 ? tokens.emerald : tokens.red;
}

export default function BuilderPage() {
  const [proposal, setProposal] = useState<BasketProposal | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);

  const loadProposal = useCallback(async () => {
    setLoadState("loading");
    setError(null);
    try {
      const res = await fetch(
        "/api/agent/propose-basket?sector=DePIN&n_assets=8&weighting=score",
        { cache: "no-store" },
      );
      const body = (await res.json().catch(() => null)) as BasketProposal | null;
      if (!res.ok || !body || body.ok === false) {
        setError(body?.error ?? `HTTP ${res.status}`);
        setProposal(null);
        setLoadState("error");
        return;
      }
      setProposal(body);
      setLoadState("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : "network error");
      setProposal(null);
      setLoadState("error");
    }
  }, []);

  useEffect(() => {
    void loadProposal();
  }, [loadProposal]);

  // User-editable index metadata defaults (config, not signals).
  // These are the starter values shown in the form; the user is expected
  // to override them before deploying. Not data — left functional, labeled.
  const [meta, setMeta] = useState({
    name: "HYPE-DEPIN-8",
    symbol: "HDP8",
    base: "USDC",
    chain: "ValueChain L1",
  });

  // User-config UI affordances — option labels for weighting strategy and
  // rebalance triggers. These are user choices, not fabricated signals.
  const [triggers, setTriggers] = useState<Record<string, boolean>>({
    cron: true,
    sentiment: true,
    flow: false,
    vol: true,
    news: false,
  });
  const [rule, setRule] = useState(0);

  const stepLabels = ["Signal", "Constituents", "Weights & rules", "Simulate", "Deploy"];

  const constituents = proposal?.constituents ?? [];
  const summary = proposal?.summary;
  const totalWeightPct = constituents.reduce((sum, c) => sum + c.weight * 100, 0);

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
            <div style={{ fontSize: 14, fontWeight: 600 }}>
              Constituents
              {loadState === "ready" && (
                <span style={{ color: tokens.textDim, fontWeight: 400 }}>
                  {" · "}
                  {constituents.length} of {proposal?.n_pool ?? "—"} pool
                </span>
              )}
            </div>
            <div className="flex gap-1.5">
              <Btn small>+ Add asset</Btn>
              <Btn small icon={<span style={{ color: tokens.cyan }}>✦</span>}>
                Auto-suggest
              </Btn>
            </div>
          </div>

          {loadState === "loading" && (
            <div style={{ padding: "32px 16px", textAlign: "center" }}>
              <Mono size={11} color={tokens.textDim}>
                Loading basket proposal from agent service…
              </Mono>
            </div>
          )}

          {loadState === "error" && (
            <div
              style={{
                padding: "24px 16px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 10,
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600, color: tokens.amber }}>
                Builder data unavailable
              </div>
              <Mono size={11} color={tokens.textDim} style={{ textAlign: "center", maxWidth: 460 }}>
                SSI constituents could not be fetched from the agent service. — {error ?? "unknown error"}
              </Mono>
              <Btn small onClick={loadProposal}>
                Retry
              </Btn>
            </div>
          )}

          {loadState === "ready" && (
            <>
              <div
                className="grid"
                style={{
                  gridTemplateColumns: "2fr 1fr 1.4fr 0.9fr 30px",
                  padding: "8px 16px",
                  gap: 10,
                  borderBottom: `1px solid ${tokens.borderFaint}`,
                }}
              >
                {["ASSET", "24H %", "WEIGHT", "MCAP", ""].map((k, i) => (
                  <Label key={i}>{k}</Label>
                ))}
              </div>
              {constituents.length === 0 && (
                <div style={{ padding: "20px 16px", textAlign: "center" }}>
                  <Mono size={11} color={tokens.textDim}>
                    Agent returned an empty basket for sector DePIN.
                  </Mono>
                </div>
              )}
              {constituents.map((c) => {
                const weightPct = c.weight * 100;
                const tk = c.symbol.length <= 5 ? c.symbol.toUpperCase() : c.symbol.slice(0, 5).toUpperCase();
                return (
                  <div
                    key={c.currency_id}
                    className="grid items-center"
                    style={{
                      gridTemplateColumns: "2fr 1fr 1.4fr 0.9fr 30px",
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
                        {tk}
                      </div>
                      <div>
                        <div style={{ fontSize: 12.5, fontWeight: 500 }}>{c.symbol}</div>
                        <Mono size={9.5}>
                          {c.marketcap_rank != null ? `rank #${c.marketcap_rank}` : c.currency_id}
                        </Mono>
                      </div>
                    </div>
                    <Mono size={12} color={changeColor(c.change_pct_24h)}>
                      {fmtPct(c.change_pct_24h)}
                    </Mono>
                    <div className="flex items-center gap-2">
                      <div className="flex-1">
                        <Meter v={weightPct / 25} color={tokens.emerald} h={5} />
                      </div>
                      <Mono size={11} color={tokens.text} style={{ minWidth: 38, textAlign: "right" }}>
                        {weightPct.toFixed(2)}%
                      </Mono>
                    </div>
                    <Mono size={11}>${fmtMcap(c.marketcap)}</Mono>
                    <div style={{ color: tokens.textFaint, cursor: "pointer", fontSize: 14, textAlign: "center" }}>×</div>
                  </div>
                );
              })}
              <div
                className="flex justify-between items-center"
                style={{ padding: "12px 16px", background: tokens.bgElev2 }}
              >
                <Mono size={11}>Total weight</Mono>
                <div className="flex items-center gap-2">
                  <Mono
                    size={12}
                    color={Math.abs(totalWeightPct - 100) < 0.5 ? tokens.emerald : tokens.amber}
                  >
                    {totalWeightPct.toFixed(2)}%{" "}
                    {Math.abs(totalWeightPct - 100) < 0.5 ? "✓" : "Δ"}
                  </Mono>
                  <Tag
                    small
                    color={Math.abs(totalWeightPct - 100) < 0.5 ? tokens.emerald : tokens.amber}
                    dot
                  >
                    {Math.abs(totalWeightPct - 100) < 0.5 ? "balanced" : "drift"}
                  </Tag>
                </div>
              </div>
            </>
          )}
        </Card>

        <div className="flex flex-col gap-3">
          {loadState === "ready" && summary && (
            <Card pad={14}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Basket summary</div>
              <div className="grid grid-cols-3 gap-2">
                <div
                  style={{
                    padding: "8px 10px",
                    background: tokens.bgElev2,
                    border: `1px solid ${tokens.border}`,
                    borderRadius: 5,
                  }}
                >
                  <Mono size={9}>n_picked / n_pool</Mono>
                  <div className="font-mono" style={{ fontSize: 13, color: tokens.text, marginTop: 2 }}>
                    {proposal?.n_picked ?? constituents.length} / {proposal?.n_pool ?? "—"}
                  </div>
                </div>
                <div
                  style={{
                    padding: "8px 10px",
                    background: tokens.bgElev2,
                    border: `1px solid ${tokens.border}`,
                    borderRadius: 5,
                  }}
                >
                  <Mono size={9}>avg 24h Δ</Mono>
                  <div
                    className="font-mono"
                    style={{
                      fontSize: 13,
                      color: changeColor(summary.avg_change_24h_pct),
                      marginTop: 2,
                    }}
                  >
                    {fmtPct(summary.avg_change_24h_pct)}
                  </div>
                </div>
                <div
                  style={{
                    padding: "8px 10px",
                    background: tokens.bgElev2,
                    border: `1px solid ${tokens.border}`,
                    borderRadius: 5,
                  }}
                >
                  <Mono size={9}>total mcap</Mono>
                  <div className="font-mono" style={{ fontSize: 13, color: tokens.text, marginTop: 2 }}>
                    ${fmtMcap(summary.total_marketcap_usd)}
                  </div>
                </div>
              </div>

              {summary.weights_pct.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <Mono size={9} className="block mb-1.5">
                    Composition (real weights_pct)
                  </Mono>
                  <div
                    className="flex w-full overflow-hidden"
                    style={{
                      height: 10,
                      borderRadius: 4,
                      border: `1px solid ${tokens.border}`,
                    }}
                  >
                    {summary.weights_pct.map((w, i) => {
                      const palette = [
                        tokens.emerald,
                        tokens.cyan,
                        tokens.amber,
                        tokens.emeraldDim,
                        "#6366F1",
                        "#A855F7",
                        tokens.red,
                        tokens.amberDim,
                      ];
                      return (
                        <div
                          key={i}
                          title={`${summary.symbols[i] ?? ""} ${w.toFixed(2)}%`}
                          style={{
                            width: `${w}%`,
                            background: palette[i % palette.length],
                          }}
                        />
                      );
                    })}
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
                    {summary.symbols.map((s, i) => (
                      <Mono key={s} size={9.5} color={tokens.textDim}>
                        {s} {summary.weights_pct[i]?.toFixed(1)}%
                      </Mono>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          )}

          <Card pad={14}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Index metadata</div>
            <Mono size={9} className="block mb-2">
              user-editable defaults · not data
            </Mono>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ["Name", "name"],
                  ["Symbol", "symbol"],
                  ["Base", "base"],
                  ["Chain", "chain"],
                ] as const
              ).map(([label, key]) => (
                <label
                  key={key}
                  style={{
                    padding: "6px 10px",
                    background: tokens.bgElev2,
                    border: `1px solid ${tokens.border}`,
                    borderRadius: 5,
                    display: "block",
                  }}
                >
                  <Mono size={9}>{label}</Mono>
                  <input
                    value={meta[key]}
                    onChange={(e) =>
                      setMeta((p) => ({ ...p, [key]: e.target.value }))
                    }
                    className="font-mono"
                    style={{
                      fontSize: 12.5,
                      color: tokens.text,
                      marginTop: 1,
                      width: "100%",
                      background: "transparent",
                      border: "none",
                      outline: "none",
                    }}
                  />
                </label>
              ))}
            </div>
          </Card>

          <Card pad={14}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Weighting rule</div>
            <Mono size={9} className="block mb-2">
              user-config · option labels (not data)
            </Mono>
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
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Rebalance triggers</div>
            <Mono size={9} className="block mb-2">
              user-config · toggles (not data)
            </Mono>
            {(
              [
                ["Every 6h (cron)", "cron"],
                ["Sentiment Δ > 15", "sentiment"],
                ["Flow reversal", "flow"],
                ["Volatility > 0.35", "vol"],
                ["News keyword match", "news"],
              ] as const
            ).map(([r, k]) => (
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
