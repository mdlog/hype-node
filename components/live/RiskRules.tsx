"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Card, Mono, Btn, Toggle } from "@/components/ui";
import { tokens } from "@/lib/tokens";
import type { RiskConfig } from "@/lib/api/agent";

// Live, persistent risk-gate config editor. Reads `/api/agent/risk-config` on
// mount, mirrors agent-service/src/store.py state, and POSTs partial updates
// every time the user moves a threshold slider or flips a rule toggle. The
// agent's risk_node re-reads this config on every cycle, so changes here
// take effect on the next rebalance without restarting the service.

type Save = "idle" | "saving" | "saved" | "error";

type Props = {
  // Optional server-rendered initial config so the page paints with real
  // values on first frame (no flicker). Falls through to fetch if absent.
  initial?: RiskConfig;
};

const NUMERIC_FIELDS: Array<{
  key: keyof RiskConfig;
  label: string;
  hint: string;
  // 0..1 thresholds use percentage UI; the outflow uses absolute USD.
  unit: "pct" | "delta" | "usd";
  min: number;
  max: number;
  step: number;
  toggleKey:
    | "rule_volatility_enabled"
    | "rule_drawdown_enabled"
    | "rule_sentiment_enabled"
    | "rule_weight_enabled"
    | "rule_outflow_enabled";
}> = [
  {
    key: "volatility_max",
    label: "Volatility cap (σ)",
    hint: "annualized 90d std-dev",
    unit: "pct",
    min: 0.05,
    max: 1.0,
    step: 0.01,
    toggleKey: "rule_volatility_enabled",
  },
  {
    key: "drawdown_max",
    label: "Drawdown cap",
    hint: "max acceptable peak-to-trough",
    unit: "pct",
    min: 0.02,
    max: 0.6,
    step: 0.01,
    toggleKey: "rule_drawdown_enabled",
  },
  {
    key: "sentiment_delta_min",
    label: "Sentiment Δ floor",
    hint: "trip when 24h delta drops below",
    unit: "delta",
    min: -100,
    max: 0,
    step: 1,
    toggleKey: "rule_sentiment_enabled",
  },
  {
    key: "single_asset_weight_max",
    label: "Single-asset weight cap",
    hint: "max weight per constituent",
    unit: "pct",
    min: 0.05,
    max: 0.6,
    step: 0.01,
    toggleKey: "rule_weight_enabled",
  },
  {
    key: "net_outflow_24h_max_usd",
    label: "Net outflow cap (24h)",
    hint: "USD ETF outflow trigger",
    unit: "usd",
    min: 1_000_000,
    max: 500_000_000,
    step: 1_000_000,
    toggleKey: "rule_outflow_enabled",
  },
];

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(0)}%`;
}

function fmtUsd(n: number): string {
  if (Math.abs(n) >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(0)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function formatValue(unit: "pct" | "delta" | "usd", n: number): string {
  if (unit === "pct") return fmtPct(n);
  if (unit === "usd") return fmtUsd(n);
  return n >= 0 ? `+${n}` : `${n}`;
}

export function RiskRules({ initial }: Props) {
  const [cfg, setCfg] = useState<RiskConfig | null>(initial ?? null);
  const [save, setSave] = useState<Save>("idle");
  const [err, setErr] = useState<string | null>(null);
  // Debounce slider drags — fire one POST after the user stops moving rather
  // than burning a request per pixel.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Pull current config if the server didn't pre-render with it (e.g. when
  // the agent service was unreachable at SSR time but is up now).
  useEffect(() => {
    if (cfg) return;
    let alive = true;
    void fetch("/api/agent/risk-config", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { config?: RiskConfig }) => {
        if (alive && d.config) setCfg(d.config);
      })
      .catch(() => {
        if (alive) setErr("agent service unreachable");
      });
    return () => {
      alive = false;
    };
  }, [cfg]);

  const persist = useCallback(async (patch: Partial<RiskConfig>) => {
    setSave("saving");
    setErr(null);
    try {
      const res = await fetch("/api/agent/risk-config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      const d = (await res.json()) as { ok: boolean; config?: RiskConfig; error?: string };
      if (!res.ok || !d.ok || !d.config) {
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      setCfg(d.config);
      setSave("saved");
      // Drop the "saved" badge after a beat so the UI doesn't fossilize.
      setTimeout(() => setSave("idle"), 1500);
    } catch (e) {
      setErr((e as Error).message ?? "save failed");
      setSave("error");
    }
  }, []);

  const updateNumber = (key: keyof RiskConfig, value: number) => {
    setCfg((prev) => (prev ? { ...prev, [key]: value } : prev));
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void persist({ [key]: value } as Partial<RiskConfig>);
    }, 350);
  };

  const updateBool = (key: keyof RiskConfig, value: boolean) => {
    setCfg((prev) => (prev ? { ...prev, [key]: value } : prev));
    void persist({ [key]: value } as Partial<RiskConfig>);
  };

  if (!cfg) {
    return (
      <Card pad={14}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>Risk gate config</div>
        <Mono size={11}>
          {err ?? "loading agent config…"}
        </Mono>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3 min-h-0">
      <Card pad={14}>
        <div className="flex justify-between items-center mb-2">
          <div style={{ fontSize: 13, fontWeight: 600 }}>Threshold config</div>
          <SaveBadge state={save} updatedAt={cfg.updated_at} />
        </div>
        <Mono size={10} className="block mb-3">
          live · risk_node honors these every cycle
        </Mono>
        {NUMERIC_FIELDS.map((f) => {
          const v = cfg[f.key] as number;
          const enabled = cfg[f.toggleKey];
          return (
            <div
              key={f.key as string}
              style={{ padding: "8px 0", borderBottom: `1px solid ${tokens.borderFaint}` }}
            >
              <div className="flex justify-between items-center mb-1">
                <div>
                  <div
                    style={{
                      fontSize: 12,
                      color: enabled ? tokens.text : tokens.textDim,
                    }}
                  >
                    {f.label}
                  </div>
                  <Mono size={9}>{f.hint}</Mono>
                </div>
                <div className="flex items-center gap-2">
                  <Mono size={11} color={enabled ? tokens.text : tokens.textDim}>
                    {formatValue(f.unit, v)}
                  </Mono>
                  <Toggle
                    on={enabled}
                    onChange={(next) => updateBool(f.toggleKey, next)}
                  />
                </div>
              </div>
              <input
                type="range"
                min={f.min}
                max={f.max}
                step={f.step}
                value={v}
                disabled={!enabled}
                onChange={(e) => updateNumber(f.key, Number(e.currentTarget.value))}
                style={{
                  width: "100%",
                  accentColor: enabled ? tokens.emerald : tokens.textFaint,
                  opacity: enabled ? 1 : 0.4,
                  cursor: enabled ? "pointer" : "not-allowed",
                }}
              />
            </div>
          );
        })}
      </Card>

      <Card
        pad={14}
        style={{
          background: cfg.manual_override ? tokens.amber + "10" : "transparent",
          borderColor: cfg.manual_override ? tokens.amber + "60" : undefined,
        }}
      >
        <div className="flex justify-between items-center mb-1">
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: cfg.manual_override ? tokens.amber : tokens.text,
            }}
          >
            Manual override
          </div>
          <Toggle
            on={cfg.manual_override}
            onChange={(next) => updateBool("manual_override", next)}
          />
        </div>
        <Mono size={10}>
          {cfg.manual_override
            ? "ALL gate checks bypassed · risk_node returns MANUAL_OVERRIDE"
            : "off · normal gate evaluation"}
        </Mono>
      </Card>

      <Card pad={14} style={{ background: tokens.red + "08", borderColor: tokens.red + "40" }}>
        <div className="flex items-center gap-2 mb-1">
          <div style={{ fontSize: 13, fontWeight: 600, color: tokens.red }}>⚠ Panic exit</div>
        </div>
        <Mono size={10}>
          force halt the agent loop · use Halt button on /agent for emergency stop
        </Mono>
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
          onClick={() => {
            if (typeof window !== "undefined") {
              window.location.href = "/agent";
            }
          }}
        >
          GO TO /AGENT → HALT
        </Btn>
      </Card>
    </div>
  );
}

function SaveBadge({ state, updatedAt }: { state: Save; updatedAt: string }) {
  const map: Record<Save, { label: string; color: string }> = {
    idle: {
      label: updatedAt
        ? `saved ${relTime(updatedAt)}`
        : "ready",
      color: tokens.textFaint,
    },
    saving: { label: "saving…", color: tokens.amber },
    saved: { label: "saved ✓", color: tokens.emerald },
    error: { label: "save failed", color: tokens.red },
  };
  const s = map[state];
  return (
    <Mono size={9} color={s.color}>
      {s.label}
    </Mono>
  );
}

function relTime(iso: string): string {
  const t = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const sec = Math.max(0, Math.floor(t / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return new Date(iso).toISOString().slice(0, 10);
}
