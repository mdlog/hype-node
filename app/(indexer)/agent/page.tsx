"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { tokens } from "@/lib/tokens";
import { useFirstRun } from "@/lib/hooks/useFirstRun";
import { CoachCallout } from "@/components/onboarding";

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
  paused: boolean;
  halted: boolean;
};

type ReasoningKind = "TOOL" | "OBS" | "THINK" | "ACT" | "WAIT";

type ReasoningEntry = {
  ts: string;
  kind: ReasoningKind;
  text: string;
  url?: string | null;
};

/* ---------- palette extras (violet not in tokens) ---------- */
const VIOLET = "#A78BFA";

/* ---------- node visual config (mirrors Agent Console Redesign.html) ----------
   Coordinates are in the SVG flow viewBox (1000x890, preserveAspectRatio=none).
   Node positions use percentage-of-canvas + absolute pixel top so the layer
   maps 1:1 with the SVG edge endpoints.
------------------------------------------------------------------------------- */

type NodeLayout = {
  left: string;
  top: number;
  width: string;
  phase: 1 | 2 | 3 | 4;
  defaultLabel: string;
  defaultSub: string;
  badge: string;
  metricIdle: string;
};

const NODE_VISUAL: Record<string, NodeLayout> = {
  signal: {
    left: "8%", top: 90, width: "11%", phase: 1,
    defaultLabel: "Signal Listener", defaultSub: "polls 2s · 11 sectors",
    badge: "SIGNAL", metricIdle: "—",
  },
  sentiment: {
    left: "26%", top: 90, width: "11%", phase: 1,
    defaultLabel: "Sentiment Analysis", defaultSub: "DePIN +92 · cluster of 11",
    badge: "SENTIMENT", metricIdle: "—",
  },
  flow: {
    left: "44%", top: 90, width: "11%", phase: 1,
    defaultLabel: "Flow Aggregator", defaultSub: "Terminal API · 4 calls",
    badge: "FLOW", metricIdle: "queued",
  },
  strategy: {
    left: "41%", top: 260, width: "16.8%", phase: 2,
    defaultLabel: "Strategy Builder", defaultSub: "weighted basket",
    badge: "STRATEGY", metricIdle: "queued",
  },
  backtest: {
    left: "66.2%", top: 260, width: "16.8%", phase: 2,
    defaultLabel: "Backtest Runner", defaultSub: "90d window",
    badge: "BACKTEST", metricIdle: "queued",
  },
  risk: {
    left: "16.4%", top: 430, width: "16.8%", phase: 3,
    defaultLabel: "Risk Gate", defaultSub: "σ · drawdown · liq",
    badge: "RISK", metricIdle: "5 gates",
  },
  wrap: {
    left: "41.6%", top: 430, width: "16.8%", phase: 3,
    defaultLabel: "SSI Wrap", defaultSub: "wrap / unwrap basket",
    badge: "WRAP", metricIdle: "SSI",
  },
  exec: {
    left: "66.8%", top: 430, width: "16.8%", phase: 3,
    defaultLabel: "SoDEX Execute", defaultSub: "router · ValueChain",
    badge: "EXEC", metricIdle: "L1 TX",
  },
  loop: {
    left: "38.6%", top: 600, width: "21%", phase: 4,
    defaultLabel: "Monitor Loop", defaultSub: "sleep 30s · re-enter signal",
    badge: "LOOP · MONITOR", metricIdle: "re-enter",
  },
};

/* Step number for each canonical node in the diagram order. */
const STEP_NUM: Record<string, number> = {
  signal: 1, sentiment: 2, flow: 3,
  strategy: 4, backtest: 5,
  risk: 6, wrap: 7, exec: 8,
  loop: 9,
};

/* Edge list — orthogonal/right-angle paths matching the redesign HTML.
   Each entry: [fromId, toId, svgPath, dashed?]                          */
type EdgeSpec = { from: string; to: string; d: string; dashed?: boolean };

const EDGES: EdgeSpec[] = [
  { from: "signal", to: "sentiment", d: "M 188 129 L 260 129" },
  { from: "sentiment", to: "flow", d: "M 368 129 L 440 129" },
  { from: "flow", to: "strategy", d: "M 494 214 L 494 261" },
  { from: "strategy", to: "backtest", d: "M 576 306 L 662 306" },
  {
    from: "backtest", to: "risk",
    d: "M 746 350 L 746 391 Q 746 401 736 401 L 258 401 Q 248 401 248 411 L 248 431",
  },
  { from: "risk", to: "wrap", d: "M 330 475 L 416 475" },
  { from: "wrap", to: "exec", d: "M 582 475 L 668 475" },
  {
    from: "exec", to: "loop",
    d: "M 752 517 L 752 565 Q 752 575 742 575 L 626 575 Q 616 575 616 585 L 616 642 Q 616 652 606 652 L 596 652",
  },
  {
    from: "loop", to: "signal",
    d: "M 388 652 L 50 652 Q 40 652 40 642 L 40 159 Q 40 149 50 149 L 80 149",
    dashed: true,
  },
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
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

const KIND_TAG: Record<ReasoningKind, { bg: string; fg: string }> = {
  TOOL: { bg: "rgba(34,211,238,0.12)", fg: tokens.cyan },
  OBS: { bg: "rgba(167,139,250,0.12)", fg: VIOLET },
  THINK: { bg: "rgba(245,158,11,0.12)", fg: tokens.amber },
  WAIT: { bg: "rgba(94,104,119,0.18)", fg: tokens.textFaint },
  ACT: { bg: "rgba(16,185,129,0.14)", fg: tokens.emerald },
};

type FilterTab = "all" | "tools" | "decisions" | "errors";

/* ---------- page ------------------------------------------------------- */

export default function AgentPage() {
  const [state, setState] = useState<AgentState | null>(null);
  const [reasoning, setReasoning] = useState<ReasoningEntry[]>([]);
  const [reasoningLoaded, setReasoningLoaded] = useState(false);
  const [tab, setTab] = useState<FilterTab>("all");
  const [enabledKinds, setEnabledKinds] = useState<Set<ReasoningKind>>(
    () => new Set<ReasoningKind>(["TOOL", "OBS", "THINK", "WAIT", "ACT"]),
  );
  const [holding, setHolding] = useState(false);
  const streamRef = useRef<HTMLDivElement>(null);
  const { completeStep } = useFirstRun();

  useEffect(() => {
    if (state) completeStep("monitor");
  }, [state, completeStep]);

  // Pull state + reasoning from the agent service. Defined as a callback so
  // the run-control buttons can request an immediate refresh after a /pause,
  // /step, /reset, /halt POST instead of waiting for the next 5s tick.
  const refresh = useCallback(async () => {
    try {
      const [sRes, rRes] = await Promise.all([
        fetch("/api/agent/state", { cache: "no-store" }),
        fetch("/api/agent/reasoning", { cache: "no-store" }),
      ]);
      if (sRes.ok) {
        const data = (await sRes.json()) as AgentState;
        setState(data);
      }
      if (rRes.ok) {
        const data = (await rRes.json()) as ReasoningEntry[];
        setReasoning(Array.isArray(data) ? data.slice(-200) : []);
        setReasoningLoaded(true);
      }
    } catch {
      /* keep last-good */
    }
  }, []);

  useEffect(() => {
    if (holding) return;

    // Page Visibility integration: pause polling whenever the tab is hidden
    // (background tab, minimized window, switched workspace). Saves ~720
    // hits/day to /api/agent/state + /api/agent/reasoning when the operator
    // isn't actually watching, without affecting backend behaviour. When the
    // tab becomes visible again, fire an immediate refresh so the operator
    // doesn't see stale numbers and the polling resumes from the new tick.
    let id: ReturnType<typeof setInterval> | null = null;

    const startPolling = () => {
      if (id !== null) return;
      void refresh();
      id = setInterval(refresh, 5_000);
    };

    const stopPolling = () => {
      if (id !== null) {
        clearInterval(id);
        id = null;
      }
    };

    const onVisibilityChange = () => {
      if (document.hidden) {
        stopPolling();
      } else {
        // Immediate refresh on resume so the user sees current state without
        // waiting up to 5s for the next interval tick.
        startPolling();
      }
    };

    if (typeof document !== "undefined" && document.hidden) {
      // Tab opened in background — do nothing until visible.
    } else {
      startPolling();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      stopPolling();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [holding, refresh]);

  useEffect(() => {
    const el = streamRef.current;
    if (!el || holding) return;
    el.scrollTop = el.scrollHeight;
  }, [reasoning.length, holding]);

  const uptimeSec = state?.uptimeSec ?? 0;
  const agentOnline = uptimeSec > 0;
  const currentNode = state?.currentNode ?? null;

  const nodeById = useMemo(() => {
    const map = new Map<string, AgentNode>();
    (state?.nodes ?? []).forEach((n) => map.set(n.id, n));
    return map;
  }, [state?.nodes]);

  /* Tab counts derived from reasoning entries. Errors are not yet emitted by
     the agent service, so we leave the counter wired but currently zero.    */
  const counts = useMemo(() => {
    let tool = 0, obs = 0, think = 0, act = 0, wait = 0;
    for (const e of reasoning) {
      if (e.kind === "TOOL") tool++;
      else if (e.kind === "OBS") obs++;
      else if (e.kind === "THINK") think++;
      else if (e.kind === "ACT") act++;
      else if (e.kind === "WAIT") wait++;
    }
    return {
      tool, obs, think, act, wait,
      all: reasoning.length,
      decisions: think + act,
      errors: 0,
    };
  }, [reasoning]);

  const filtered = useMemo(() => {
    return reasoning.filter((e) => {
      if (tab === "tools" && e.kind !== "TOOL") return false;
      if (tab === "decisions" && e.kind !== "THINK" && e.kind !== "ACT") return false;
      if (tab === "errors") return false;
      return enabledKinds.has(e.kind);
    });
  }, [reasoning, tab, enabledKinds]);

  function toggleKind(kind: ReasoningKind) {
    setEnabledKinds((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }

  return (
    <div
      className="grid"
      style={{
        gridTemplateColumns: "1fr 380px",
        height: "calc(100vh - 48px)",
        minHeight: 0,
      }}
    >
      {/* ===== MAIN ===== */}
      <div
        className="overflow-auto"
        style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 14 }}
      >
        <PageHeader
          currentNode={currentNode}
          agentOnline={agentOnline}
          paused={state?.paused ?? false}
          halted={state?.halted ?? false}
          refresh={refresh}
        />
        {!state && (
          <CoachCallout
            icon="🧭"
            title="How the agent works"
            body="This console streams the LangGraph loop: signal → sentiment → flow → strategy → backtest → risk → wrap → exec → loop. Start or resume the agent to watch each node light up."
          />
        )}
        <KpiStrip state={state} />
        <StateGraph
          nodeById={nodeById}
          currentNode={currentNode}
          agentOnline={agentOnline}
        />
      </div>

      {/* ===== SIDE: REASONING LOG ===== */}
      <aside
        style={{
          borderLeft: `1px solid ${tokens.border}`,
          background: tokens.bgElev,
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
        }}
      >
        <SideHeader />
        <SideTabs tab={tab} setTab={setTab} counts={counts} />
        <SideFilters enabled={enabledKinds} toggle={toggleKind} counts={counts} />

        <div
          ref={streamRef}
          className="flex-1 overflow-y-auto"
          style={{ minHeight: 0 }}
        >
          {filtered.length === 0 ? (
            <div
              style={{
                padding: 16,
                color: tokens.textFaint,
                fontFamily: "JetBrains Mono, monospace",
                fontSize: 11,
              }}
            >
              {!reasoningLoaded
                ? "loading reasoning log…"
                : reasoning.length === 0
                  ? "no reasoning entries yet — waiting for agent to act…"
                  : "no entries match current filters"}
            </div>
          ) : (
            filtered.map((e, i) => <LogRow key={i} entry={e} active={i === filtered.length - 1} />)
          )}
        </div>

        <SideFooter holding={holding} setHolding={setHolding} entriesCount={filtered.length} />
      </aside>

      {/* keyframes */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
            @keyframes ag-pulse { 0%,100% { opacity: 1; } 50% { opacity: .35; } }
            @keyframes ag-flowDash { to { stroke-dashoffset: -40; } }
            @keyframes ag-ringExpand {
              0% { transform: scale(1); opacity: 0.6; }
              100% { transform: scale(1.08); opacity: 0; }
            }
            .ag-pulse { animation: ag-pulse 1.4s ease-in-out infinite; }
            .ag-flow-dash { animation: ag-flowDash 1.4s linear infinite; }
            .ag-ring-expand { animation: ag-ringExpand 2s ease-out infinite; }
          `,
        }}
      />
    </div>
  );
}

/* ===========================================================================
   PAGE HEADER
=========================================================================== */

function PageHeader({
  currentNode,
  agentOnline,
  paused,
  halted,
  refresh,
}: {
  currentNode: string | null;
  agentOnline: boolean;
  paused: boolean;
  halted: boolean;
  refresh: () => Promise<void>;
}) {
  // Run-control busy flags so buttons disable while a POST is in flight.
  // The refresh() call after each action keeps state.paused/halted truthful
  // for the next render — no optimistic UI fudging.
  const [busy, setBusy] = useState<null | "pause" | "step" | "reset" | "halt">(null);

  const wrap = (action: "pause" | "step" | "reset" | "halt") => async () => {
    if (busy) return;
    setBusy(action);
    try {
      const res = await fetch(`/api/agent/${action}`, {
        method: "POST",
        cache: "no-store",
      });
      if (!res.ok) {
        // 502 from the proxy means the agent service at AGENT_SERVICE_URL
        // isn't running. Surface a one-shot console.warn rather than a
        // toast/alert here since the rest of the page already shows
        // "agent offline" in the subtitle.
        console.warn(`[agent] ${action} failed: HTTP ${res.status}`);
      }
    } catch (err) {
      console.warn(`[agent] ${action} threw`, err);
    } finally {
      // Always refresh — paused/halted flags should reflect reality even on
      // error (the action may have partially succeeded server-side).
      await refresh();
      setBusy(null);
    }
  };

  return (
    <div className="flex justify-between items-end">
      <div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontFamily: "JetBrains Mono, monospace",
            fontSize: 10,
            color: tokens.textFaint,
            marginBottom: 4,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
          }}
        >
          <span>Indexer</span>
          <span style={{ color: tokens.borderStrong }}>/</span>
          <span style={{ color: tokens.emerald }}>Agent Console</span>
          {halted && (
            <span style={{ color: tokens.red, marginLeft: 4 }}>· HALTED</span>
          )}
          {paused && !halted && (
            <span style={{ color: tokens.amber, marginLeft: 4 }}>· PAUSED</span>
          )}
        </div>
        <h1
          style={{
            fontSize: 22,
            fontWeight: 600,
            letterSpacing: "-0.02em",
            lineHeight: 1.1,
          }}
        >
          Agent Console
        </h1>
        <div
          style={{
            fontSize: 12,
            color: tokens.textDim,
            marginTop: 4,
            fontFamily: "JetBrains Mono, monospace",
          }}
        >
          LangGraph state machine · monitor → research → strategy → execute ·{" "}
          {agentOnline ? (
            <>
              currently in{" "}
              <span style={{ color: tokens.cyan }}>{currentNode ?? "idle"}</span>
            </>
          ) : (
            <span style={{ color: tokens.textFaint }}>agent offline</span>
          )}
        </div>
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <Btn
          icon={paused ? "▶" : "⏸"}
          label={paused ? "Resume" : "Pause"}
          onClick={wrap("pause")}
          disabled={busy !== null || halted}
        />
        <Btn
          icon="▷"
          label="Step"
          onClick={wrap("step")}
          disabled={busy !== null || halted}
        />
        <Btn
          icon="↻"
          label="Reset state"
          onClick={wrap("reset")}
          disabled={busy !== null}
        />
        <Btn
          icon="⏹"
          label="Halt"
          danger
          onClick={wrap("halt")}
          disabled={busy !== null || halted}
        />
      </div>
    </div>
  );
}

function Btn({
  icon,
  label,
  danger = false,
  small = false,
  onClick,
  disabled = false,
}: {
  icon?: string;
  label: string;
  danger?: boolean;
  small?: boolean;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: small ? "4px 8px" : "6px 12px",
        borderRadius: 6,
        fontSize: small ? 11 : 12,
        fontWeight: 500,
        cursor: disabled ? "not-allowed" : "pointer",
        border: `1px solid ${danger ? "rgba(239,68,68,0.3)" : tokens.border}`,
        background: tokens.bgElev,
        color: danger ? tokens.red : tokens.text,
        fontFamily: "inherit",
        transition: "all .15s",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {icon && (
        <span style={{ fontFamily: "JetBrains Mono, monospace" }}>{icon}</span>
      )}
      {label}
    </button>
  );
}

/* ===========================================================================
   KPI STRIP
=========================================================================== */

function KpiStrip({ state }: { state: AgentState | null }) {
  const items: Array<{
    lbl: string;
    v: string;
    d: string;
    color?: "emerald" | "cyan" | "amber" | "default";
    accent?: boolean;
    smallV?: boolean;
  }> = state
    ? [
        {
          lbl: "Uptime",
          v: fmtUptime(state.uptimeSec),
          d: "since last reset · 99.97%",
          color: "emerald",
          accent: true,
        },
        {
          lbl: "Decisions (24h)",
          v: String(state.decisions24h),
          d: "publishes + holds",
        },
        {
          lbl: "Tool calls",
          v: state.toolCalls.toLocaleString(),
          d: "avg 84ms · 0 errors",
          color: "cyan",
        },
        {
          lbl: "Gas spent (24h)",
          v: `${state.gasSpentVal.toFixed(2)} VAL`,
          d: "ValueChain",
          color: "amber",
        },
        {
          lbl: "Model",
          v: state.model,
          d: "temp 0.2 · 8K ctx",
          smallV: true,
        },
      ]
    : [
        { lbl: "Uptime", v: "—", d: "connecting…", accent: true },
        { lbl: "Decisions (24h)", v: "—", d: "connecting…" },
        { lbl: "Tool calls", v: "—", d: "connecting…" },
        { lbl: "Gas spent (24h)", v: "—", d: "connecting…" },
        { lbl: "Model", v: "—", d: "connecting…", smallV: true },
      ];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10 }}>
      {items.map((it, i) => (
        <div
          key={i}
          style={{
            padding: "12px 14px",
            background: it.accent
              ? `linear-gradient(180deg, rgba(16,185,129,0.04), ${tokens.bgElev})`
              : tokens.bgElev,
            border: `1px solid ${it.accent ? "rgba(16,185,129,0.3)" : tokens.border}`,
            borderRadius: 8,
            position: "relative",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              fontFamily: "JetBrains Mono, monospace",
              fontSize: 9.5,
              color: tokens.textFaint,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              marginBottom: 6,
            }}
          >
            {it.lbl}
          </div>
          <div
            style={{
              fontSize: it.smallV ? 14 : 20,
              fontWeight: 600,
              letterSpacing: "-0.02em",
              lineHeight: 1.1,
              fontFamily: "JetBrains Mono, monospace",
              paddingTop: it.smallV ? 4 : 0,
              color:
                it.color === "emerald"
                  ? tokens.emerald
                  : it.color === "cyan"
                    ? tokens.cyan
                    : it.color === "amber"
                      ? tokens.amber
                      : tokens.text,
            }}
          >
            {it.v}
          </div>
          <div
            style={{
              fontSize: 10.5,
              color: tokens.textDim,
              fontFamily: "JetBrains Mono, monospace",
              marginTop: 4,
            }}
          >
            {it.d}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ===========================================================================
   STATE GRAPH
=========================================================================== */

function StateGraph({
  nodeById,
  currentNode,
  agentOnline,
}: {
  nodeById: Map<string, AgentNode>;
  currentNode: string | null;
  agentOnline: boolean;
}) {
  /* Compute edge state from node statuses. An edge is `active` when it leads
     into the currently-running node; `completed` when its source node has
     already run (active/current upstream of running cursor in graph order).  */
  function edgeState(edge: EdgeSpec): "active" | "completed" | "idle" {
    const a = nodeById.get(edge.from);
    const b = nodeById.get(edge.to);
    if (!a || !b) return "idle";
    if (b.status === "current" && (a.status === "active" || a.status === "current")) {
      return "active";
    }
    if (a.status === "active" && (b.status === "active" || b.status === "current")) {
      return "completed";
    }
    return "idle";
  }

  return (
    <div
      style={{
        height: 890,
        flexShrink: 0,
        background: `radial-gradient(800px 400px at 50% 30%, rgba(16,185,129,0.05), transparent 70%), ${tokens.bgElev}`,
        border: `1px solid ${tokens.border}`,
        borderRadius: 12,
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* grid pattern overlay */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            `linear-gradient(rgba(28,35,44,0.25) 1px, transparent 1px), linear-gradient(90deg, rgba(28,35,44,0.25) 1px, transparent 1px)`,
          backgroundSize: "24px 24px",
          pointerEvents: "none",
        }}
      />

      {/* TOOLBAR (top-left) */}
      <div
        style={{
          position: "absolute",
          top: 14,
          left: 14,
          display: "flex",
          gap: 6,
          zIndex: 7,
        }}
      >
        <ToolbarMeta>
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: tokens.emerald,
              boxShadow: `0 0 6px ${tokens.emerald}`,
            }}
            className="ag-pulse"
          />
          <span>STATE</span>
          <span style={{ color: tokens.emerald, fontWeight: 600 }}>
            {currentNode ? currentNode.toUpperCase() : "IDLE"}
          </span>
          <span style={{ color: tokens.borderStrong }}>·</span>
          <span>TICK</span>
          <span style={{ color: tokens.emerald, fontWeight: 600 }}>
            #{agentOnline ? Math.floor(Date.now() / 1000) % 9999 : "----"}
          </span>
        </ToolbarMeta>
        <ToolbarMeta>
          <span>FOCUS</span>
          <span style={{ color: tokens.amber, fontWeight: 600 }}>DEPIN</span>
        </ToolbarMeta>
      </div>

      {/* ZOOM (top-right) — cosmetic */}
      <div
        style={{
          position: "absolute",
          top: 14,
          right: 14,
          display: "flex",
          gap: 4,
          zIndex: 7,
        }}
      >
        <ZoomBtn>+</ZoomBtn>
        <ZoomBtn>−</ZoomBtn>
        <ZoomBtn small>⎈</ZoomBtn>
      </div>

      {/* LEGEND (top-center) */}
      <div
        style={{
          position: "absolute",
          top: 14,
          left: "50%",
          transform: "translateX(-50%)",
          display: "flex",
          gap: 12,
          padding: "5px 12px",
          background: "rgba(15,20,27,0.92)",
          backdropFilter: "blur(8px)",
          border: `1px solid ${tokens.border}`,
          borderRadius: 6,
          zIndex: 6,
        }}
      >
        <LegendItem color={tokens.emerald} label="Completed" />
        <LegendItem color={tokens.cyan} label="Running" />
        <LegendItem color={tokens.amber} label="Warning" />
        <LegendItem color={tokens.textFaint} label="Idle" faded />
      </div>

      {!agentOnline && (
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            zIndex: 8,
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
          <div
            style={{
              fontFamily: "JetBrains Mono, monospace",
              fontSize: 10,
              color: tokens.textFaint,
              marginTop: 4,
            }}
          >
            start with{" "}
            <span style={{ color: tokens.cyan }}>npm run agent</span>
          </div>
        </div>
      )}

      {/* CANVAS — SVG (viewBox 1000x890) and node overlay share the same
          coordinate frame: container height locked to 890px (graph wrap above)
          so node `top: <px>` lines up with SVG y units 1:1, and node `left: <%>`
          tracks the SVG x-axis stretched by preserveAspectRatio="none". */}
      <div
        style={{
          position: "absolute",
          inset: 0,
        }}
      >
        <svg
          viewBox="0 0 1000 890"
          preserveAspectRatio="none"
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            display: "block",
          }}
        >
          <defs>
            <marker id="ah-idle" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M 0 0 L 10 5 L 0 10 z" fill={tokens.borderStrong} />
            </marker>
            <marker id="ah-done" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(16,185,129,0.55)" />
            </marker>
            <marker id="ah-active" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto">
              <path d="M 0 0 L 10 5 L 0 10 z" fill={tokens.cyan} />
            </marker>
          </defs>

          {/* phase backdrops */}
          <rect x="10" y="68" width="980" height="125" rx="10" fill="rgba(16,185,129,0.025)" stroke="rgba(16,185,129,0.08)" strokeDasharray="2 4" />
          <rect x="10" y="240" width="980" height="125" rx="10" fill="rgba(167,139,250,0.025)" stroke="rgba(167,139,250,0.08)" strokeDasharray="2 4" />
          <rect x="10" y="410" width="980" height="125" rx="10" fill="rgba(245,158,11,0.022)" stroke="rgba(245,158,11,0.08)" strokeDasharray="2 4" />
          <rect x="10" y="580" width="980" height="125" rx="10" fill="rgba(148,163,184,0.022)" stroke="rgba(148,163,184,0.08)" strokeDasharray="2 4" />

          {/* phase labels */}
          <text x="22" y="61" fill={tokens.emerald} fontFamily="JetBrains Mono, monospace" fontSize="9" letterSpacing="1.6" fontWeight="600">PHASE 1 · RESEARCH</text>
          <text x="22" y="233" fill={VIOLET} fontFamily="JetBrains Mono, monospace" fontSize="9" letterSpacing="1.6" fontWeight="600">PHASE 2 · DECISION</text>
          <text x="22" y="403" fill={tokens.amber} fontFamily="JetBrains Mono, monospace" fontSize="9" letterSpacing="1.6" fontWeight="600">PHASE 3 · EXECUTION</text>
          <text x="22" y="573" fill={tokens.textFaint} fontFamily="JetBrains Mono, monospace" fontSize="9" letterSpacing="1.6" fontWeight="600">PHASE 4 · MONITOR LOOP</text>

          {/* re-enter loop label */}
          <text
            x="32"
            y="400"
            fill={tokens.textFaint}
            fontFamily="JetBrains Mono, monospace"
            fontSize="9"
            letterSpacing="1.4"
            fontWeight="600"
            transform="rotate(-90, 32, 400)"
          >
            RE-ENTER · 30s
          </text>

          {/* edges */}
          {EDGES.map((edge, i) => {
            const st = edgeState(edge);
            const stroke =
              st === "active" ? tokens.cyan : st === "completed" ? "rgba(16,185,129,0.5)" : tokens.borderStrong;
            const strokeWidth = st === "active" ? 2 : 1.5;
            const dasharray = edge.dashed ? "5 6" : undefined;
            const opacity = edge.dashed ? 0.65 : 1;
            const marker =
              st === "active" ? "url(#ah-active)" : st === "completed" ? "url(#ah-done)" : "url(#ah-idle)";
            return (
              <g key={i}>
                <path
                  d={edge.d}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={strokeWidth}
                  strokeDasharray={dasharray}
                  opacity={opacity}
                  style={{
                    filter: st === "active" ? `drop-shadow(0 0 6px rgba(34,211,238,0.5))` : undefined,
                  }}
                  markerEnd={marker}
                />
                {st === "active" && (
                  <>
                    <path
                      d={edge.d}
                      fill="none"
                      stroke={tokens.cyan}
                      strokeWidth={2.5}
                      strokeLinecap="round"
                      strokeDasharray="6 14"
                      style={{ filter: `drop-shadow(0 0 8px ${tokens.cyan})` }}
                      className="ag-flow-dash"
                    />
                    <circle r={3.5} fill={tokens.cyan} style={{ filter: `drop-shadow(0 0 6px ${tokens.cyan})` }}>
                      <animateMotion dur="1.6s" repeatCount="indefinite" path={edge.d} />
                    </circle>
                  </>
                )}
                {st === "completed" && (
                  <circle r={2} fill="rgba(16,185,129,0.6)">
                    <animateMotion dur="2.2s" repeatCount="indefinite" path={edge.d} />
                  </circle>
                )}
              </g>
            );
          })}
        </svg>

        {/* node overlays */}
        {Object.entries(NODE_VISUAL).map(([id, vis]) => {
          const node = nodeById.get(id);
          return (
            <NodeCard
              key={id}
              id={id}
              vis={vis}
              node={node}
            />
          );
        })}
      </div>
    </div>
  );
}

function ToolbarMeta({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 10px",
        background: "rgba(15,20,27,0.8)",
        backdropFilter: "blur(8px)",
        border: `1px solid ${tokens.border}`,
        borderRadius: 6,
        fontFamily: "JetBrains Mono, monospace",
        fontSize: 10,
        color: tokens.textDim,
      }}
    >
      {children}
    </div>
  );
}

function ZoomBtn({
  children,
  small,
}: {
  children: React.ReactNode;
  small?: boolean;
}) {
  return (
    <button
      style={{
        width: 28,
        height: 28,
        background: "rgba(15,20,27,0.8)",
        backdropFilter: "blur(8px)",
        border: `1px solid ${tokens.border}`,
        borderRadius: 6,
        display: "grid",
        placeItems: "center",
        cursor: "pointer",
        color: tokens.textDim,
        fontSize: small ? 10 : 14,
      }}
    >
      {children}
    </button>
  );
}

function LegendItem({
  color,
  label,
  faded,
}: {
  color: string;
  label: string;
  faded?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        fontFamily: "JetBrains Mono, monospace",
        fontSize: 9.5,
        color: tokens.textDim,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: 2,
          background: color,
          opacity: faded ? 0.5 : 1,
        }}
      />
      {label}
    </div>
  );
}

function NodeCard({
  id,
  vis,
  node,
}: {
  id: string;
  vis: NodeLayout;
  node: AgentNode | undefined;
}) {
  const status = node?.status ?? "idle";
  const stepNum = STEP_NUM[id] ?? "·";
  const label = node?.label ?? vis.defaultLabel;
  const sub = node?.sub ?? vis.defaultSub;

  const isCompleted = status === "active";
  const isRunning = status === "current";
  const isWarn = status === "warn";
  const isIdle = status === "idle" || status === "danger";

  const stateStyle = isRunning
    ? {
        borderColor: tokens.cyan,
        background: `linear-gradient(180deg, rgba(34,211,238,0.10), ${tokens.bgElev})`,
        boxShadow: `0 0 0 1px rgba(34,211,238,0.2), 0 0 24px rgba(34,211,238,0.18)`,
      }
    : isCompleted
      ? {
          borderColor: "rgba(16,185,129,0.35)",
          background: `linear-gradient(180deg, rgba(16,185,129,0.04), ${tokens.bgElev})`,
        }
      : isWarn
        ? {
            borderColor: "rgba(245,158,11,0.4)",
            background: `linear-gradient(180deg, rgba(245,158,11,0.05), ${tokens.bgElev})`,
          }
        : {
            borderColor: tokens.border,
            background: tokens.bgElev,
            opacity: 0.55,
          };

  const stepStyle = isRunning
    ? { background: tokens.cyan, color: tokens.bg, borderColor: tokens.cyan, boxShadow: `0 0 10px rgba(34,211,238,0.6)` }
    : isCompleted
      ? { background: tokens.emerald, color: tokens.bg, borderColor: tokens.emerald, boxShadow: `0 0 10px rgba(16,185,129,0.5)` }
      : isWarn
        ? { background: tokens.amber, color: tokens.bg, borderColor: tokens.amber }
        : { background: tokens.bg, color: tokens.textFaint, borderColor: tokens.borderStrong };

  const badgeColor = isRunning
    ? tokens.cyan
    : isCompleted
      ? tokens.emerald
      : isWarn
        ? tokens.amber
        : tokens.textFaint;

  const dotShadow = isRunning || isCompleted || isWarn ? `0 0 6px ${badgeColor}` : undefined;

  const metric = isRunning ? "running" : isCompleted ? "done" : vis.metricIdle;

  return (
    <div
      style={{
        position: "absolute",
        left: vis.left,
        top: vis.top,
        width: vis.width,
        padding: "11px 12px",
        border: "1px solid",
        borderRadius: 9,
        transition: "all .25s ease",
        zIndex: 2,
        ...stateStyle,
      }}
    >
      {/* step number */}
      <div
        style={{
          position: "absolute",
          top: -9,
          left: -9,
          width: 22,
          height: 22,
          borderRadius: "50%",
          border: "1px solid",
          display: "grid",
          placeItems: "center",
          fontFamily: "JetBrains Mono, monospace",
          fontSize: 10,
          fontWeight: 700,
          zIndex: 3,
          ...stepStyle,
        }}
      >
        {stepNum}
      </div>

      {/* running ring */}
      {isRunning && (
        <span
          aria-hidden
          className="ag-ring-expand"
          style={{
            position: "absolute",
            inset: -1,
            borderRadius: 9,
            border: `1px solid ${tokens.cyan}`,
            opacity: 0.6,
            pointerEvents: "none",
          }}
        />
      )}

      {/* head */}
      <div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            fontFamily: "JetBrains Mono, monospace",
            fontSize: 8.5,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: badgeColor,
          }}
        >
          <span
            className={isRunning ? "ag-pulse" : undefined}
            style={{
              width: 5,
              height: 5,
              borderRadius: "50%",
              background: badgeColor,
              boxShadow: dotShadow,
            }}
          />
          {vis.badge}
        </span>
        <span
          style={{
            fontFamily: "JetBrains Mono, monospace",
            fontSize: 9.5,
            color: isIdle ? tokens.textFaint : tokens.textDim,
          }}
        >
          {metric}
        </span>
      </div>

      <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: "-0.01em", marginBottom: 3 }}>
        {label}
      </div>
      <div
        style={{
          fontFamily: "JetBrains Mono, monospace",
          fontSize: 10,
          color: tokens.textDim,
        }}
      >
        {sub}
      </div>

      {isRunning && (
        <div
          style={{
            marginTop: 6,
            height: 3,
            background: "rgba(255,255,255,0.05)",
            borderRadius: 2,
            overflow: "hidden",
            position: "relative",
          }}
        >
          <i
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              width: "64%",
              background: tokens.cyan,
              borderRadius: 2,
              boxShadow: `0 0 8px ${tokens.cyan}`,
            }}
          />
        </div>
      )}
    </div>
  );
}

/* ===========================================================================
   SIDE: REASONING LOG
=========================================================================== */

function SideHeader() {
  return (
    <div
      style={{
        padding: "14px 16px",
        borderBottom: `1px solid ${tokens.border}`,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}
    >
      <div>
        <h2 style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-0.01em" }}>
          Reasoning Log
        </h2>
        <div
          style={{
            fontFamily: "JetBrains Mono, monospace",
            fontSize: 9.5,
            color: tokens.textFaint,
            letterSpacing: "0.1em",
            marginTop: 3,
            textTransform: "uppercase",
          }}
        >
          state · tools · decisions · auditable
        </div>
      </div>
      <Btn icon="⤓" label="Export" small />
    </div>
  );
}

function SideTabs({
  tab,
  setTab,
  counts,
}: {
  tab: FilterTab;
  setTab: (t: FilterTab) => void;
  counts: { all: number; tool: number; decisions: number; errors: number };
}) {
  const items: Array<{ id: FilterTab; label: string; count: number }> = [
    { id: "all", label: "All", count: counts.all },
    { id: "tools", label: "Tools", count: counts.tool },
    { id: "decisions", label: "Decisions", count: counts.decisions },
    { id: "errors", label: "Errors", count: counts.errors },
  ];
  return (
    <div
      style={{
        display: "flex",
        gap: 0,
        padding: "0 14px",
        borderBottom: `1px solid ${tokens.border}`,
      }}
    >
      {items.map((it) => {
        const active = tab === it.id;
        return (
          <button
            key={it.id}
            onClick={() => setTab(it.id)}
            style={{
              padding: "10px 12px",
              fontSize: 11.5,
              color: active ? tokens.text : tokens.textFaint,
              cursor: "pointer",
              borderBottom: `2px solid ${active ? tokens.emerald : "transparent"}`,
              marginBottom: -1,
              fontFamily: "JetBrains Mono, monospace",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              background: "transparent",
              border: "none",
              borderBottomLeftRadius: 0,
              borderBottomRightRadius: 0,
              borderBottomWidth: 2,
              borderBottomStyle: "solid",
              borderBottomColor: active ? tokens.emerald : "transparent",
            }}
          >
            {it.label}
            <span
              style={{
                color: active ? tokens.emerald : tokens.textFaint,
                marginLeft: 5,
                fontSize: 9.5,
              }}
            >
              {it.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function SideFilters({
  enabled,
  toggle,
  counts,
}: {
  enabled: Set<ReasoningKind>;
  toggle: (k: ReasoningKind) => void;
  counts: { tool: number; obs: number; think: number; wait: number; act: number };
}) {
  const chips: Array<{ kind: ReasoningKind; count: number }> = [
    { kind: "TOOL", count: counts.tool },
    { kind: "OBS", count: counts.obs },
    { kind: "THINK", count: counts.think },
    { kind: "WAIT", count: counts.wait },
    { kind: "ACT", count: counts.act },
  ];
  return (
    <div
      style={{
        padding: "10px 14px",
        borderBottom: `1px solid ${tokens.border}`,
        display: "flex",
        gap: 5,
        flexWrap: "wrap",
        alignItems: "center",
      }}
    >
      <span
        style={{
          fontFamily: "JetBrains Mono, monospace",
          fontSize: 9.5,
          color: tokens.textFaint,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
        }}
      >
        Filter
      </span>
      {chips.map((c) => {
        const on = enabled.has(c.kind);
        return (
          <button
            key={c.kind}
            onClick={() => toggle(c.kind)}
            style={{
              padding: "3px 8px",
              borderRadius: 4,
              background: on ? tokens.bgHover : tokens.bgElev,
              border: `1px solid ${on ? tokens.borderStrong : tokens.border}`,
              fontFamily: "JetBrains Mono, monospace",
              fontSize: 9.5,
              color: on ? tokens.text : tokens.textDim,
              cursor: "pointer",
              letterSpacing: "0.06em",
            }}
          >
            {c.kind}
            <span style={{ color: tokens.textFaint, marginLeft: 4 }}>{c.count}</span>
          </button>
        );
      })}
    </div>
  );
}

function LogRow({ entry, active }: { entry: ReasoningEntry; active: boolean }) {
  const tag = KIND_TAG[entry.kind];
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "56px 52px 1fr",
        gap: 10,
        padding: active ? "10px 14px 10px 12px" : "10px 14px",
        borderBottom: `1px solid rgba(28,35,44,0.5)`,
        alignItems: "flex-start",
        background: active ? "rgba(34,211,238,0.05)" : "transparent",
        borderLeft: active ? `2px solid ${tokens.cyan}` : undefined,
        transition: "background .15s",
      }}
    >
      <span
        style={{
          fontFamily: "JetBrains Mono, monospace",
          fontSize: 10,
          color: tokens.textFaint,
          paddingTop: 1,
        }}
      >
        {formatClock(entry.ts)}
      </span>
      <span
        style={{
          fontFamily: "JetBrains Mono, monospace",
          fontSize: 9,
          fontWeight: 600,
          padding: "2px 5px",
          borderRadius: 3,
          textAlign: "center",
          letterSpacing: "0.08em",
          height: 16,
          lineHeight: "12px",
          background: tag.bg,
          color: tag.fg,
        }}
      >
        {entry.kind}
      </span>
      <span
        style={{
          fontFamily: "JetBrains Mono, monospace",
          fontSize: 11,
          lineHeight: 1.45,
          color: entry.kind === "WAIT" ? tokens.textDim : tokens.text,
          wordBreak: "break-word",
        }}
      >
        {entry.text}
        {entry.url && (
          <a
            href={entry.url}
            target="_blank"
            rel="noopener noreferrer"
            title={entry.url}
            style={{
              marginLeft: 6,
              color: tokens.cyan,
              textDecoration: "none",
              fontSize: 11,
            }}
          >
            ↗
          </a>
        )}
      </span>
    </div>
  );
}

function SideFooter({
  holding,
  setHolding,
  entriesCount,
}: {
  holding: boolean;
  setHolding: (v: boolean) => void;
  entriesCount: number;
}) {
  return (
    <div
      style={{
        padding: "10px 14px",
        borderTop: `1px solid ${tokens.border}`,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 8,
        background: tokens.bgElev,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontFamily: "JetBrains Mono, monospace",
          fontSize: 10,
          color: tokens.textFaint,
        }}
      >
        <span
          className={holding ? undefined : "ag-pulse"}
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: holding ? tokens.textFaint : tokens.emerald,
            boxShadow: holding ? undefined : `0 0 6px ${tokens.emerald}`,
          }}
        />
        <span>{holding ? "PAUSED" : "STREAMING"}</span>
        <span style={{ color: tokens.borderStrong }}>·</span>
        <span>{entriesCount} entries</span>
      </div>
      <Btn
        icon={holding ? "▷" : "⏸"}
        label={holding ? "Resume" : "Hold log"}
        small
        onClick={() => setHolding(!holding)}
      />
    </div>
  );
}
