// Live system status — pings a handful of internal endpoints from the
// browser and reports green / amber / red per component. Refreshes
// every 30s. Public (no auth) — anonymous pings hit the same routes the
// app uses, so degraded states surface here even before users log in.

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Card, Mono } from "@/components/ui";
import { tokens } from "@/lib/tokens";

type ProbeState = "ok" | "slow" | "down" | "loading";

type Probe = {
  id: string;
  label: string;
  description: string;
  url: string;
  // Soft latency budget. Above this we mark "slow" (amber) instead of "ok".
  slowMs: number;
};

const PROBES: Probe[] = [
  {
    id: "agent",
    label: "Agent service",
    description: "LangGraph orchestrator · /api/agent/state",
    url: "/api/agent/state",
    slowMs: 1500,
  },
  {
    id: "reasoning",
    label: "Agent reasoning feed",
    description: "Decision log stream · /api/agent/reasoning",
    url: "/api/agent/reasoning",
    slowMs: 1200,
  },
  {
    id: "sosovalue",
    label: "SoSoValue Terminal",
    description: "SSI ticker list proxy · /api/ssi/list",
    url: "/api/ssi/list",
    slowMs: 2000,
  },
  {
    id: "currencies",
    label: "Currency universe",
    description: "Currency catalog · /api/currencies-list",
    url: "/api/currencies-list",
    slowMs: 2000,
  },
];

const COLOR: Record<ProbeState, string> = {
  ok: tokens.emerald,
  slow: tokens.amber,
  down: tokens.red,
  loading: tokens.textFaint,
};

const LABEL: Record<ProbeState, string> = {
  ok: "Operational",
  slow: "Degraded",
  down: "Outage",
  loading: "Probing…",
};

type Result = {
  state: ProbeState;
  latencyMs: number | null;
  error?: string;
  checkedAt: number;
};

async function probeOne(p: Probe, signal: AbortSignal): Promise<Result> {
  const t0 = performance.now();
  try {
    const res = await fetch(p.url, {
      method: "GET",
      cache: "no-store",
      signal,
    });
    const latencyMs = Math.round(performance.now() - t0);
    if (!res.ok) {
      return {
        state: "down",
        latencyMs,
        error: `HTTP ${res.status}`,
        checkedAt: Date.now(),
      };
    }
    return {
      state: latencyMs > p.slowMs ? "slow" : "ok",
      latencyMs,
      checkedAt: Date.now(),
    };
  } catch (e) {
    return {
      state: "down",
      latencyMs: null,
      error: e instanceof Error ? e.message : "fetch failed",
      checkedAt: Date.now(),
    };
  }
}

function timeAgo(ms: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  return `${Math.floor(s / 60)}m ago`;
}

export default function StatusPage() {
  const [results, setResults] = useState<Record<string, Result>>(
    () =>
      Object.fromEntries(
        PROBES.map((p) => [
          p.id,
          { state: "loading" as ProbeState, latencyMs: null, checkedAt: Date.now() },
        ]),
      ),
  );

  const refresh = useCallback(async () => {
    const ctrl = new AbortController();
    const settled = await Promise.all(
      PROBES.map(async (p) => [p.id, await probeOne(p, ctrl.signal)] as const),
    );
    setResults(Object.fromEntries(settled));
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 30_000);
    return () => clearInterval(t);
  }, [refresh]);

  const overall: ProbeState = useMemo(() => {
    const states = Object.values(results).map((r) => r.state);
    if (states.some((s) => s === "loading")) return "loading";
    if (states.some((s) => s === "down")) return "down";
    if (states.some((s) => s === "slow")) return "slow";
    return "ok";
  }, [results]);

  const latestCheck = useMemo(() => {
    const tss = Object.values(results)
      .map((r) => r.checkedAt)
      .filter(Boolean);
    return tss.length === 0 ? Date.now() : Math.max(...tss);
  }, [results]);

  return (
    <div
      className="mx-auto"
      style={{ maxWidth: 880, padding: "32px 24px 80px" }}
    >
      <Mono size={10} color={tokens.textFaint} style={{ letterSpacing: "0.18em" }}>
        SYSTEM STATUS
      </Mono>
      <h1
        style={{
          fontSize: 32,
          fontWeight: 700,
          letterSpacing: "-0.02em",
          marginTop: 8,
        }}
      >
        Status
      </h1>
      <Mono size={11} color={tokens.textFaint} style={{ marginTop: 6 }}>
        Live probes from your browser · auto-refresh every 30s
      </Mono>

      <Card pad={0} className="mt-6" style={{ marginTop: 22 }}>
        <div
          className="flex items-center justify-between"
          style={{
            padding: "16px 18px",
            borderBottom: `1px solid ${tokens.border}`,
          }}
        >
          <div className="flex items-center" style={{ gap: 10 }}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: COLOR[overall],
                boxShadow: `0 0 12px ${COLOR[overall]}`,
              }}
            />
            <span
              style={{
                fontSize: 16,
                fontWeight: 600,
                color: tokens.text,
                letterSpacing: "-0.01em",
              }}
            >
              {overall === "ok"
                ? "All systems operational"
                : overall === "loading"
                  ? "Checking system status…"
                  : overall === "slow"
                    ? "Some services degraded"
                    : "Active outage"}
            </span>
          </div>
          <Mono size={10} color={tokens.textFaint}>
            updated · {timeAgo(latestCheck)}
          </Mono>
        </div>

        {PROBES.map((p, i) => {
          const r = results[p.id];
          return (
            <div
              key={p.id}
              className="grid items-center"
              style={{
                gridTemplateColumns: "16px 1fr auto",
                gap: 14,
                padding: "14px 18px",
                borderBottom:
                  i === PROBES.length - 1 ? "none" : `1px solid ${tokens.border}`,
              }}
            >
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  background: COLOR[r?.state ?? "loading"],
                  boxShadow:
                    r?.state === "loading"
                      ? "none"
                      : `0 0 8px ${COLOR[r?.state ?? "loading"]}`,
                  animation:
                    r?.state === "loading" ? "pulseSoft 1.4s infinite" : undefined,
                }}
              />
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 13.5,
                    fontWeight: 600,
                    color: tokens.text,
                  }}
                >
                  {p.label}
                </div>
                <Mono size={10.5} color={tokens.textFaint} style={{ marginTop: 2 }}>
                  {p.description}
                  {r?.error ? ` · ${r.error}` : null}
                </Mono>
              </div>
              <div style={{ textAlign: "right" }}>
                <Mono size={11.5} color={COLOR[r?.state ?? "loading"]}>
                  {LABEL[r?.state ?? "loading"]}
                </Mono>
                <Mono size={10} color={tokens.textFaint} style={{ marginTop: 2, display: "block" }}>
                  {r?.latencyMs !== null && r?.latencyMs !== undefined
                    ? `${r.latencyMs}ms`
                    : "—"}
                </Mono>
              </div>
            </div>
          );
        })}
      </Card>

      <button
        type="button"
        onClick={() => void refresh()}
        style={{
          marginTop: 16,
          padding: "7px 14px",
          background: tokens.bgElev2,
          border: `1px solid ${tokens.border}`,
          borderRadius: 6,
          color: tokens.text,
          fontFamily: "JetBrains Mono, monospace",
          fontSize: 11.5,
          cursor: "pointer",
        }}
      >
        ⟳ Probe now
      </button>

      <Mono
        size={10.5}
        color={tokens.textFaint}
        style={{ marginTop: 22, display: "block", lineHeight: 1.7 }}
      >
        Probes hit your own browser → app server → upstream. A red status
        here usually means either the upstream is down or your network
        can&apos;t reach our origin. Check{" "}
        <a
          href="https://status.sosovalue.com"
          target="_blank"
          rel="noreferrer"
          style={{ color: tokens.emerald }}
        >
          SoSoValue&apos;s public status
        </a>{" "}
        for upstream incidents.
      </Mono>
    </div>
  );
}
