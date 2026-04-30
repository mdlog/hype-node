"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { Btn, Label, Mono } from "@/components/ui";
import { tokens } from "@/lib/tokens";

/* ---------- types (mirror lib/api/agent.ts) ---------- */

type AgentNodeStatus = "idle" | "active" | "current" | "warn" | "danger";

type AgentNode = {
  id: string;
  label: string;
  status: AgentNodeStatus;
  sub?: string;
};

type AgentState = {
  uptimeSec: number;
  decisions24h: number;
  toolCalls: number;
  gasSpentVal: number;
  model: string;
  currentNode: string | null;
  nodes: AgentNode[];
};

type ReasoningKind = "TOOL" | "OBS" | "THINK" | "ACT" | "WAIT";

type ReasoningEntry = {
  ts: string;
  kind: ReasoningKind;
  text: string;
};

/* ---------- static topology ---------------------------------------------
   The LangGraph topology is stable (see agent-service/src/main.py). We hold
   the edge list fixed here and only render edges whose endpoints exist in
   the live node set returned by /api/agent/state. Layout coordinates are
   keyed by the same canonical ids the agent service emits.
------------------------------------------------------------------------ */

const NODE_LAYOUT: Record<string, { x: number; y: number }> = {
  signal: { x: 40, y: 40 },
  sentiment: { x: 230, y: 40 },
  flow: { x: 420, y: 40 },
  strategy: { x: 330, y: 180 },
  backtest: { x: 520, y: 180 },
  risk: { x: 140, y: 320 },
  wrap: { x: 330, y: 320 },
  exec: { x: 520, y: 320 },
  exit: { x: 40, y: 450 },
  loop: { x: 420, y: 450 },
};

const EDGES: Array<[string, string, boolean?]> = [
  ["signal", "sentiment"],
  ["sentiment", "flow"],
  ["sentiment", "strategy"],
  ["flow", "strategy"],
  ["strategy", "backtest"],
  ["backtest", "strategy", true],
  ["strategy", "risk"],
  ["risk", "wrap"],
  ["risk", "exit"],
  ["wrap", "exec"],
  ["exec", "loop"],
  ["loop", "strategy", true],
];

/* ---------- helpers ----------------------------------------------------- */

function fmtUptime(s: number): string {
  if (!s || s <= 0) return "—";
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function formatClock(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toISOString().slice(11, 19);
}

const REASONING_COLOR: Record<ReasoningKind, string> = {
  TOOL: tokens.cyan,
  OBS: tokens.emerald,
  THINK: "#A78BFA", // violet — palette doesn't expose one, mirror chat page
  ACT: tokens.amber,
  WAIT: tokens.textFaint,
};

function statusColors(status: AgentNodeStatus): { bg: string; bd: string; dot: string } {
  switch (status) {
    case "current":
      return { bg: tokens.cyan + "15", bd: tokens.cyan, dot: tokens.cyan };
    case "active":
      return { bg: tokens.emerald + "12", bd: tokens.emerald, dot: tokens.emerald };
    case "warn":
      return { bg: tokens.amber + "10", bd: tokens.amber, dot: tokens.amber };
    case "danger":
      return { bg: tokens.red + "12", bd: tokens.red, dot: tokens.red };
    case "idle":
    default:
      return { bg: tokens.bgElev2, bd: tokens.border, dot: tokens.textFaint };
  }
}

/* ---------- page ------------------------------------------------------- */

export default function AgentPage() {
  const [state, setState] = useState<AgentState | null>(null);
  const [reasoning, setReasoning] = useState<ReasoningEntry[]>([]);
  const [reasoningLoaded, setReasoningLoaded] = useState(false);
  const streamRef = useRef<HTMLDivElement>(null);

  // Poll cadence: 5s. Matches the spec; matches the agent service's reasoning
  // log refresh frequency (the background loop in agent-service runs at 120s
  // but emits log entries continuously, so 5s gives a near-live feel without
  // hammering the proxy).
  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const [sRes, rRes] = await Promise.all([
          fetch("/api/agent/state", { cache: "no-store" }),
          fetch("/api/agent/reasoning", { cache: "no-store" }),
        ]);
        if (sRes.ok) {
          const data = (await sRes.json()) as AgentState;
          if (!cancelled) setState(data);
        }
        if (rRes.ok) {
          const data = (await rRes.json()) as ReasoningEntry[];
          if (!cancelled) {
            setReasoning(Array.isArray(data) ? data.slice(-120) : []);
            setReasoningLoaded(true);
          }
        }
      } catch {
        /* keep last-good state */
      }
    }
    tick();
    const id = setInterval(tick, 5_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Auto-scroll the reasoning stream to the bottom as new entries arrive.
  useEffect(() => {
    const el = streamRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [reasoning.length]);

  const uptimeSec = state?.uptimeSec ?? 0;
  const agentOnline = uptimeSec > 0;
  const currentNode = state?.currentNode ?? null;

  // Build a positioned-node list by merging live status with the static layout.
  // Nodes without a known coordinate are dropped from the canvas (the topology
  // is stable, so this only ever happens if the backend ships a new node id
  // before this file is updated — better to skip than to misplace).
  const positionedNodes = useMemo(() => {
    const src = state?.nodes ?? [];
    return src
      .map((n) => {
        const layout = NODE_LAYOUT[n.id];
        if (!layout) return null;
        return { ...n, x: layout.x, y: layout.y };
      })
      .filter((n): n is AgentNode & { x: number; y: number } => n !== null);
  }, [state?.nodes]);

  const nodeById = useMemo(
    () => Object.fromEntries(positionedNodes.map((n) => [n.id, n])),
    [positionedNodes],
  );

  const stats = state
    ? [
        { k: "UPTIME", v: fmtUptime(state.uptimeSec), c: tokens.emerald },
        { k: "DECISIONS (24h)", v: String(state.decisions24h), c: tokens.text },
        { k: "TOOL CALLS", v: state.toolCalls.toLocaleString(), c: tokens.cyan },
        { k: "GAS SPENT", v: `${state.gasSpentVal.toFixed(2)} VAL`, c: tokens.amber },
        { k: "MODEL", v: state.model, c: tokens.text },
      ]
    : null;

  return (
    <div className="grid h-[calc(100vh-48px)]" style={{ gridTemplateColumns: "1fr 360px" }}>
      <div
        className="relative overflow-hidden"
        style={{ padding: 20, borderRight: `1px solid ${tokens.border}` }}
      >
        <div className="flex justify-between items-end mb-4">
          <div>
            <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.02em" }}>Agent Console</div>
            <Mono size={11}>
              LangGraph state machine ·{" "}
              {agentOnline ? (
                <>
                  currently in{" "}
                  <span style={{ color: tokens.cyan }}>{currentNode ?? "idle"}</span>
                </>
              ) : (
                <span style={{ color: tokens.textFaint }}>agent offline</span>
              )}
            </Mono>
          </div>
          <div className="flex gap-1.5">
            <Btn small>⏸ Pause</Btn>
            <Btn small>▢ Step</Btn>
            <Btn small>↻ Reset state</Btn>
          </div>
        </div>

        {stats ? (
          <div className="flex gap-2.5 mb-3.5">
            {stats.map((s, i) => (
              <div
                key={i}
                className="flex-1"
                style={{
                  padding: "8px 12px",
                  background: tokens.bgElev,
                  border: `1px solid ${tokens.border}`,
                  borderRadius: 6,
                }}
              >
                <Label>{s.k}</Label>
                <div
                  className="font-mono"
                  style={{ fontSize: 14, fontWeight: 600, color: s.c, marginTop: 3 }}
                >
                  {s.v}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div
            className="mb-3.5"
            style={{
              padding: "10px 14px",
              background: tokens.bgElev,
              border: `1px solid ${tokens.border}`,
              borderRadius: 6,
              color: tokens.textFaint,
              fontSize: 12,
            }}
          >
            connecting to agent service…
          </div>
        )}

        <div
          className="relative"
          style={{
            width: 700,
            height: 530,
            background: tokens.bgElev,
            border: `1px solid ${tokens.border}`,
            borderRadius: 8,
            backgroundImage: `radial-gradient(${tokens.borderFaint} 1px, transparent 1px)`,
            backgroundSize: "20px 20px",
          }}
        >
          {!agentOnline && (
            <div
              className="absolute inset-0 flex items-center justify-center"
              style={{ pointerEvents: "none", zIndex: 2 }}
            >
              <div
                style={{
                  padding: "12px 20px",
                  background: tokens.bgElev2,
                  border: `1px solid ${tokens.border}`,
                  borderRadius: 8,
                  textAlign: "center",
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 600, color: tokens.textDim }}>
                  agent offline
                </div>
                <Mono size={10}>
                  start the agent service with{" "}
                  <span style={{ color: tokens.cyan }}>npm run agent</span>
                </Mono>
              </div>
            </div>
          )}

          <svg width={700} height={530} className="absolute inset-0 pointer-events-none">
            <defs>
              <marker id="arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M 0 0 L 8 4 L 0 8 Z" fill={tokens.textDim} />
              </marker>
              <marker id="arrLive" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M 0 0 L 8 4 L 0 8 Z" fill={tokens.cyan} />
              </marker>
            </defs>
            {EDGES.map(([f, t, dashed], i) => {
              const a = nodeById[f];
              const b = nodeById[t];
              if (!a || !b) return null;
              const x1 = a.x + 70;
              const y1 = a.y + 24;
              const x2 = b.x + 10;
              const y2 = b.y + 24;
              const aLive = a.status === "active" || a.status === "current";
              const bLive = b.status === "active" || b.status === "current";
              const live = aLive && bLive;
              return (
                <path
                  key={i}
                  d={`M ${x1} ${y1} C ${(x1 + x2) / 2} ${y1}, ${(x1 + x2) / 2} ${y2}, ${x2} ${y2}`}
                  fill="none"
                  stroke={live ? tokens.cyan : tokens.textFaint}
                  strokeWidth={live ? 1.5 : 1}
                  strokeDasharray={dashed ? "4 3" : undefined}
                  opacity={live ? 0.7 : 0.4}
                  markerEnd={live ? "url(#arrLive)" : "url(#arr)"}
                />
              );
            })}
          </svg>
          {positionedNodes.map((n) => {
            const c = statusColors(n.status);
            const isCurrent = n.status === "current";
            const isActive = n.status === "active";
            return (
              <div
                key={n.id}
                style={{
                  position: "absolute",
                  left: n.x,
                  top: n.y,
                  width: 150,
                  padding: "8px 12px",
                  background: c.bg,
                  border: `1px solid ${c.bd}`,
                  borderRadius: 6,
                  boxShadow: isCurrent
                    ? `0 0 0 3px ${tokens.cyan}20, 0 0 16px ${tokens.cyan}40`
                    : undefined,
                }}
              >
                <div className="flex items-center gap-1.5 mb-0.5">
                  <div
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: c.dot,
                      boxShadow: isCurrent || isActive ? `0 0 6px ${c.dot}` : undefined,
                    }}
                  />
                  <Mono size={8.5} color={c.dot}>
                    {n.id.toUpperCase()}
                  </Mono>
                  {isCurrent && (
                    <Mono size={8.5} color={tokens.cyan}>
                      ● RUNNING
                    </Mono>
                  )}
                </div>
                <div style={{ fontSize: 12, fontWeight: 600, color: tokens.text }}>{n.label}</div>
                {n.sub && <Mono size={9.5}>{n.sub}</Mono>}
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col overflow-hidden">
        <div
          className="flex justify-between items-center"
          style={{ padding: "14px 16px", borderBottom: `1px solid ${tokens.border}` }}
        >
          <div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Reasoning Log</div>
            <Mono size={10}>state transitions · tool calls · decisions</Mono>
          </div>
          <Btn small>Export</Btn>
        </div>
        <div
          ref={streamRef}
          className="flex-1 overflow-y-auto font-mono"
          style={{ fontSize: 10.5 }}
        >
          {reasoning.length === 0 ? (
            <div
              style={{
                padding: "16px",
                color: tokens.textFaint,
                fontSize: 11,
              }}
            >
              {reasoningLoaded
                ? "no reasoning entries yet — waiting for agent to act…"
                : "loading reasoning log…"}
            </div>
          ) : (
            reasoning.map((e, i) => {
              const color = REASONING_COLOR[e.kind] ?? tokens.text;
              return (
                <div
                  key={i}
                  className="flex gap-2 items-start"
                  style={{
                    padding: "7px 16px",
                    borderBottom: `1px solid ${tokens.borderFaint}`,
                  }}
                >
                  <span
                    style={{ color: tokens.textFaint, minWidth: 62, fontSize: 10 }}
                  >
                    {formatClock(e.ts)}
                  </span>
                  <span
                    className="font-semibold uppercase"
                    style={{
                      color,
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
                      color: e.kind === "WAIT" ? tokens.textDim : tokens.text,
                      lineHeight: 1.5,
                    }}
                  >
                    {e.text}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
