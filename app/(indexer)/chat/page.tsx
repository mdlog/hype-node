"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { tokens } from "@/lib/tokens";

/* ---------- palette aligned with the chat-redesign mock ---------- */

const PAL = {
  bg: "#07090C",
  bg2: "#0B0F14",
  bg3: "#11161E",
  bg4: "#161D26",
  line: "#1A2029",
  line2: "#242C38",
  line3: "#2F3947",
  text: tokens.text,
  dim: "#9AA4B2",
  faint: "#5E6877",
  emerald: tokens.emerald,
  emeraldDim: "#059669",
  cyan: tokens.cyan,
  amber: tokens.amber,
  red: tokens.red,
  violet: "#A78BFA",
};

const MONO = '"JetBrains Mono", monospace';

/* ---------- types ---------- */

type ToolCallTrace = {
  name: string;
  input: Record<string, unknown>;
  output_summary?: string | null;
  output_raw?: unknown;
  duration_ms: number;
  ok: boolean;
  error?: string | null;
};

type ChatUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  elapsed_ms: number;
};

type Turn = {
  role: "user" | "agent";
  content: string;
  ts?: string;
  tool_calls?: ToolCallTrace[] | null;
  usage?: ChatUsage | null;
};

type AgentState = {
  uptimeSec?: number;
  uptime_sec?: number;
  decisions24h?: number;
  decisions_24h?: number;
  toolCalls?: number;
  tool_calls?: number;
  model?: string;
  currentNode?: string | null;
  current_node?: string | null;
};

/* MCP tools surface — kept aligned with agent-service/src/mcp_server.py. */
type ToolKind = "term" | "bk" | "ssi" | "dex" | "risk";
const MCP_TOOLS: Array<{ name: string; desc: string; kind: ToolKind; live?: boolean }> = [
  { name: "terminal.get_sentiment", desc: "SoSoValue · sector sentiment", kind: "term", live: true },
  { name: "terminal.get_fund_flow", desc: "ETF flows · 24h / 7d", kind: "term", live: true },
  { name: "terminal.get_news", desc: "Headlines + impact score", kind: "term" },
  { name: "backtest.run", desc: "90d / 1y · vs benchmark", kind: "bk", live: true },
  { name: "ssi.wrap / unwrap", desc: "SSI Protocol · mint & burn", kind: "ssi" },
  { name: "sodex.execute_trade", desc: "SoDEX router · ValueChain", kind: "dex" },
  { name: "risk.check_thresholds", desc: "σ + drawdown gates", kind: "risk", live: true },
];

const SUGGESTIONS = [
  "Show my risk exposure",
  "Build RWA index",
  "Compare HDP8 to BTC",
  "Why skip ATH at 0.06?",
];

const STORAGE_KEY = "hype.chat.v1";
const USAGE_KEY = "hype.usage.v1";

// Anthropic pricing per 1M tokens, current as of 2026-04. Sonnet 4.5/4.6
// share the same price card. Update if the env switches model. Cache writes
// are 1.25× input (5-min TTL). Cache reads are 0.1× input.
const PRICING = {
  "claude-sonnet-4-5": { input: 3.0, output: 15.0 },
  "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
  "claude-haiku-4-5": { input: 1.0, output: 5.0 },
  "claude-opus-4-6": { input: 5.0, output: 25.0 },
  "claude-opus-4-7": { input: 5.0, output: 25.0 },
} as const;

function priceForModel(model: string): { input: number; output: number } {
  return (PRICING as Record<string, { input: number; output: number }>)[model]
    ?? PRICING["claude-sonnet-4-5"];
}

function todayKey(): string {
  // UTC day, matches the "resets 00:00 UTC" copy.
  return new Date().toISOString().slice(0, 10);
}

type UsageBucket = { tokens: number; calls: number; spend_usd: number };

/* ---------- helpers ---------- */

function fmtUptime(s: number): string {
  if (!s || s <= 0) return "—";
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function clockHHMM(ts?: string): string {
  if (!ts) return "now";
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "now";
  }
}

function dayLabel(ts?: string): string {
  if (!ts) return "Today";
  try {
    const d = new Date(ts);
    const today = new Date();
    const sameDay =
      d.getFullYear() === today.getFullYear() &&
      d.getMonth() === today.getMonth() &&
      d.getDate() === today.getDate();
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return sameDay ? `Today · ${time} ${tz}` : d.toLocaleString();
  } catch {
    return "Today";
  }
}

/* ---------- page ---------- */

export default function ChatPage() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [agent, setAgent] = useState<AgentState | null>(null);
  const [search, setSearch] = useState("");
  const [usageToday, setUsageToday] = useState<UsageBucket>({
    tokens: 0,
    calls: 0,
    spend_usd: 0,
  });
  const messagesRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  // Restore today's usage bucket. We key by UTC date so the panel auto-resets
  // at 00:00 UTC (matches the "resets 00:00 UTC" copy in the panel header).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(USAGE_KEY);
      if (!raw) return;
      const stored = JSON.parse(raw) as { date: string; totals: UsageBucket };
      if (stored.date === todayKey()) setUsageToday(stored.totals);
    } catch {
      /* noop */
    }
  }, []);

  // Persist on every change. Resets implicitly when todayKey() advances —
  // the next save uses the new date, the old entry is overwritten.
  useEffect(() => {
    try {
      localStorage.setItem(
        USAGE_KEY,
        JSON.stringify({ date: todayKey(), totals: usageToday }),
      );
    } catch {
      /* quota / private mode */
    }
  }, [usageToday]);

  // Restore prior session from localStorage so refresh doesn't drop history.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Turn[];
        if (Array.isArray(parsed)) setTurns(parsed);
      }
    } catch {
      /* noop */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(turns));
    } catch {
      /* quota or private mode */
    }
    messagesRef.current?.scrollTo({
      top: messagesRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [turns]);

  // Live agent state poll — drives the LIVE chip, model name, telemetry.
  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const r = await fetch("/api/agent/state", { cache: "no-store" });
        if (!r.ok) return;
        const data = (await r.json()) as AgentState;
        if (!cancelled) setAgent(data);
      } catch {
        /* noop */
      }
    }
    tick();
    const id = setInterval(tick, 10_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const userTurns = turns.filter((t) => t.role === "user").length;
  const agentTurns = turns.filter((t) => t.role === "agent").length;
  const firstTs = turns[0]?.ts;
  const minutes = firstTs
    ? Math.max(0, Math.round((Date.now() - new Date(firstTs).getTime()) / 60_000))
    : 0;
  const uptime = agent?.uptimeSec ?? agent?.uptime_sec ?? 0;
  const model = agent?.model ?? "claude-sonnet-4-5";
  const agentOnline = uptime > 0;
  const currentNode = agent?.currentNode ?? agent?.current_node ?? null;
  const decisions = agent?.decisions24h ?? agent?.decisions_24h ?? 0;
  const toolCalls = agent?.toolCalls ?? agent?.tool_calls ?? 0;

  // Stable thread id derived from the first turn timestamp — gives the
  // crumb a non-random "thread #NNNN" that survives page refresh.
  const threadId = useMemo(() => {
    if (!firstTs) return "draft";
    let h = 0;
    for (let i = 0; i < firstTs.length; i++) h = (h * 31 + firstTs.charCodeAt(i)) | 0;
    return Math.abs(h) % 9000 + 1000;
  }, [firstTs]);

  const filteredConvs = useMemo(() => {
    const q = search.trim().toLowerCase();
    const items = [
      {
        id: "current",
        title: turns.length === 0 ? "New conversation" : "Current session",
        when: turns.length === 0 ? "now" : minutes === 0 ? "now" : `${minutes}m`,
        meta: turns.length === 0
          ? "no messages yet"
          : `${userTurns} prompts · ${agentTurns} replies`,
        tag: agentOnline ? "live" : null,
        active: true,
      },
    ];
    if (!q) return items;
    return items.filter((it) =>
      [it.title, it.meta].join(" ").toLowerCase().includes(q),
    );
  }, [search, turns.length, userTurns, agentTurns, agentOnline, minutes]);

  async function send(text?: string) {
    const value = (text ?? input).trim();
    if (!value || busy) return;
    const next: Turn[] = [
      ...turns,
      { role: "user", content: value, ts: new Date().toISOString() },
    ];
    setTurns(next);
    setInput("");
    if (composerRef.current) composerRef.current.style.height = "22px";
    setBusy(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ turns: next }),
      });
      const reply = (await res.json()) as Turn;
      setTurns([
        ...next,
        { ...reply, role: "agent", ts: reply.ts ?? new Date().toISOString() },
      ]);
      // Accumulate today's usage from the live response. The spend formula
      // applies per-token-class pricing — cache reads are 10× cheaper than
      // raw input, so heavy reuse keeps the bar low even on long sessions.
      if (reply.usage) {
        const u = reply.usage;
        const total =
          (u.input_tokens ?? 0) +
          (u.output_tokens ?? 0) +
          (u.cache_read_tokens ?? 0) +
          (u.cache_creation_tokens ?? 0);
        const p = priceForModel(model);
        const spend =
          ((u.input_tokens ?? 0) * p.input +
            (u.output_tokens ?? 0) * p.output +
            (u.cache_creation_tokens ?? 0) * p.input * 1.25 +
            (u.cache_read_tokens ?? 0) * p.input * 0.1) /
          1_000_000;
        const callsThisTurn = reply.tool_calls?.length ?? 0;
        // If localStorage was last touched on a different UTC day, reset
        // so the panel doesn't carry yesterday's totals into today.
        setUsageToday((prev) => {
          let raw: string | null = null;
          try {
            raw = localStorage.getItem(USAGE_KEY);
          } catch {
            /* noop */
          }
          let base = prev;
          if (raw) {
            try {
              const stored = JSON.parse(raw) as { date: string };
              if (stored.date !== todayKey()) {
                base = { tokens: 0, calls: 0, spend_usd: 0 };
              }
            } catch {
              /* noop */
            }
          }
          return {
            tokens: base.tokens + total,
            calls: base.calls + callsThisTurn,
            spend_usd: base.spend_usd + spend,
          };
        });
      }
    } catch (err) {
      setTurns([
        ...next,
        {
          role: "agent",
          content: `Failed to reach agent: ${(err as Error).message}`,
          ts: new Date().toISOString(),
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  function clearHistory() {
    setTurns([]);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* noop */
    }
  }

  return (
    <div
      className="grid"
      style={{
        gridTemplateColumns: "264px 1fr 320px",
        height: "calc(100vh - 48px)",
        background: PAL.bg,
        color: PAL.text,
      }}
    >
      <LeftSidebar
        search={search}
        setSearch={setSearch}
        items={filteredConvs}
        onNew={clearHistory}
      />

      <section style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
        <ChatHead
          threadId={threadId}
          turns={turns.length}
          minutes={minutes}
          model={model}
          agentOnline={agentOnline}
          currentNode={currentNode}
          onClear={clearHistory}
        />
        <div
          ref={messagesRef}
          style={{ flex: 1, overflowY: "auto", padding: "24px 28px 16px" }}
        >
          {turns.length === 0 ? (
            <EmptyState />
          ) : (
            <Messages turns={turns} busy={busy} model={model} />
          )}
        </div>
        <Composer
          input={input}
          setInput={setInput}
          onSend={() => send()}
          onSuggestion={(s) => send(s)}
          busy={busy}
          textareaRef={composerRef}
        />
      </section>

      <RightSidebar
        agentOnline={agentOnline}
        uptime={uptime}
        decisions={decisions}
        toolCalls={toolCalls}
        currentNode={currentNode}
        model={model}
        usageToday={usageToday}
      />
    </div>
  );
}

/* ============================ LEFT SIDEBAR ============================ */

type ConvItem = {
  id: string;
  title: string;
  when: string;
  meta: string;
  tag: string | null;
  active: boolean;
};

function LeftSidebar({
  search,
  setSearch,
  items,
  onNew,
}: {
  search: string;
  setSearch: (v: string) => void;
  items: ConvItem[];
  onNew: () => void;
}) {
  return (
    <aside
      style={{
        borderRight: `1px solid ${PAL.line}`,
        background: PAL.bg,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      <div
        style={{
          padding: "16px 16px 12px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <h3 style={{ fontSize: 13, fontWeight: 600, letterSpacing: "-0.01em" }}>
          Conversations
        </h3>
        <button
          type="button"
          onClick={onNew}
          style={{
            padding: "4px 8px",
            fontSize: 11,
            fontWeight: 500,
            color: PAL.dim,
            background: "transparent",
            border: "1px solid transparent",
            borderRadius: 6,
            cursor: "pointer",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = PAL.text;
            e.currentTarget.style.background = PAL.bg3;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = PAL.dim;
            e.currentTarget.style.background = "transparent";
          }}
        >
          + New
        </button>
      </div>

      <div
        style={{
          margin: "0 12px 12px",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "7px 10px",
          background: PAL.bg3,
          border: `1px solid ${PAL.line}`,
          borderRadius: 7,
        }}
      >
        <svg width={13} height={13} viewBox="0 0 16 16" fill="none" stroke={PAL.faint} strokeWidth={1.6}>
          <circle cx="7" cy="7" r="5" />
          <path d="M11 11l3 3" />
        </svg>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search conversations…"
          style={{
            background: "transparent",
            border: "none",
            outline: "none",
            color: PAL.text,
            fontFamily: "inherit",
            fontSize: 12,
            flex: 1,
          }}
        />
        <span
          style={{
            fontFamily: MONO,
            fontSize: 9.5,
            color: PAL.faint,
            padding: "2px 5px",
            background: PAL.bg4,
            border: `1px solid ${PAL.line2}`,
            borderRadius: 3,
          }}
        >
          ⌘K
        </span>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "0 8px 16px" }}>
        <GroupLabel>Today</GroupLabel>
        {items.map((it) => (
          <ConvRow key={it.id} item={it} />
        ))}
      </div>

      <div
        style={{
          padding: "12px 14px",
          borderTop: `1px solid ${PAL.line}`,
          background: PAL.bg2,
        }}
      >
        <div style={{ fontSize: 11.5, color: PAL.text, fontWeight: 600 }}>
          MCP · Model Context Protocol
        </div>
        <div
          style={{
            fontFamily: MONO,
            fontSize: 10,
            color: PAL.faint,
            marginTop: 3,
          }}
        >
          <span style={{ color: PAL.emerald }}>●</span> {MCP_TOOLS.length} tools · 3 connectors
        </div>
      </div>
    </aside>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: "12px 8px 6px",
        fontFamily: MONO,
        fontSize: 9.5,
        color: PAL.faint,
        letterSpacing: "0.16em",
        textTransform: "uppercase",
      }}
    >
      {children}
    </div>
  );
}

function ConvRow({ item }: { item: ConvItem }) {
  return (
    <div
      style={{
        padding: "10px 12px",
        borderRadius: 8,
        cursor: "pointer",
        marginBottom: 2,
        border: `1px solid ${item.active ? PAL.line : "transparent"}`,
        background: item.active ? PAL.bg3 : "transparent",
        boxShadow: item.active ? `inset 2px 0 0 ${PAL.emerald}` : undefined,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 4,
        }}
      >
        <span
          style={{
            fontSize: 12.5,
            fontWeight: item.active ? 600 : 500,
            color: PAL.text,
          }}
        >
          {item.title}
        </span>
        <span style={{ fontFamily: MONO, fontSize: 9.5, color: PAL.faint }}>
          {item.when}
        </span>
      </div>
      <div
        style={{
          fontFamily: MONO,
          fontSize: 10,
          color: PAL.dim,
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        {item.tag && <ConvTag kind={item.tag} />}
        <span>{item.meta}</span>
      </div>
    </div>
  );
}

function ConvTag({ kind }: { kind: string }) {
  const style: Record<string, { bg: string; color: string }> = {
    live: { bg: "rgba(16,185,129,0.12)", color: PAL.emerald },
    research: { bg: PAL.bg4, color: PAL.dim },
    declined: { bg: "rgba(245,158,11,0.12)", color: PAL.amber },
    edu: { bg: "rgba(167,139,250,0.12)", color: PAL.violet },
  };
  const s = style[kind] ?? style.research;
  return (
    <span
      style={{
        padding: "1px 6px",
        borderRadius: 3,
        background: s.bg,
        color: s.color,
        fontSize: 9,
      }}
    >
      {kind}
    </span>
  );
}

/* ============================ CENTER ============================ */

function ChatHead({
  threadId,
  turns,
  minutes,
  model,
  agentOnline,
  currentNode,
  onClear,
}: {
  threadId: number | string;
  turns: number;
  minutes: number;
  model: string;
  agentOnline: boolean;
  currentNode: string | null;
  onClear: () => void;
}) {
  return (
    <div
      style={{
        padding: "14px 28px",
        borderBottom: `1px solid ${PAL.line}`,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 16,
        background: PAL.bg,
      }}
    >
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, letterSpacing: "-0.02em" }}>
            HypeNode agent
          </h2>
          <Chip
            tone={agentOnline ? "live" : "muted"}
            label={agentOnline ? "LIVE" : "OFFLINE"}
            withDot={agentOnline}
          />
          {currentNode && (
            <Chip tone="neutral" label={`node: ${currentNode}`} />
          )}
        </div>
        <div
          style={{
            fontFamily: MONO,
            fontSize: 10,
            color: PAL.faint,
            display: "flex",
            gap: 8,
            alignItems: "center",
            marginTop: 4,
            flexWrap: "wrap",
          }}
        >
          <span>thread #{threadId}</span>
          <Sep />
          <span>{turns} turns</span>
          <Sep />
          <span>{minutes}m elapsed</span>
          <Sep />
          <span style={{ color: PAL.cyan }}>{model}</span>
        </div>
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <Btn ghost title="Pin">📌</Btn>
        <Btn ghost title="Share">↗</Btn>
        <Btn onClick={onClear}>Clear</Btn>
      </div>
    </div>
  );
}

function Sep() {
  return <span style={{ color: PAL.line3 }}>·</span>;
}

function Chip({
  tone,
  label,
  withDot = false,
}: {
  tone: "live" | "muted" | "amber" | "neutral";
  label: string;
  withDot?: boolean;
}) {
  const tones: Record<string, { bg: string; border: string; color: string; dot: string }> = {
    live: {
      bg: "rgba(16,185,129,0.08)",
      border: "rgba(16,185,129,0.25)",
      color: PAL.emerald,
      dot: PAL.emerald,
    },
    amber: {
      bg: "rgba(245,158,11,0.08)",
      border: "rgba(245,158,11,0.25)",
      color: PAL.amber,
      dot: PAL.amber,
    },
    muted: { bg: PAL.bg3, border: PAL.line, color: PAL.dim, dot: PAL.line3 },
    neutral: { bg: PAL.bg3, border: PAL.line, color: PAL.dim, dot: PAL.line3 },
  };
  const t = tones[tone];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "2px 7px",
        background: t.bg,
        border: `1px solid ${t.border}`,
        borderRadius: 999,
        fontFamily: MONO,
        fontSize: 10,
        color: t.color,
      }}
    >
      {withDot && (
        <span
          style={{
            width: 5,
            height: 5,
            borderRadius: "50%",
            background: t.dot,
            boxShadow: tone === "live" ? `0 0 6px ${t.dot}` : undefined,
          }}
        />
      )}
      {label}
    </span>
  );
}

function Btn({
  children,
  primary = false,
  ghost = false,
  onClick,
  title,
  type = "button",
  disabled = false,
  style,
}: {
  children: React.ReactNode;
  primary?: boolean;
  ghost?: boolean;
  onClick?: () => void;
  title?: string;
  type?: "button" | "submit";
  disabled?: boolean;
  style?: React.CSSProperties;
}) {
  const baseStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 11px",
    borderRadius: 6,
    fontSize: 12,
    fontWeight: primary ? 600 : 500,
    cursor: disabled ? "not-allowed" : "pointer",
    border: `1px solid ${primary ? PAL.emerald : ghost ? "transparent" : PAL.line2}`,
    background: primary ? PAL.emerald : "transparent",
    color: primary ? PAL.bg : ghost ? PAL.dim : PAL.text,
    fontFamily: "inherit",
    opacity: disabled ? 0.5 : 1,
    transition: "all .15s",
    ...style,
  };
  return (
    <button
      type={type}
      title={title}
      onClick={onClick}
      disabled={disabled}
      style={baseStyle}
      onMouseEnter={(e) => {
        if (disabled) return;
        if (primary) {
          e.currentTarget.style.background = "#14c98e";
          e.currentTarget.style.boxShadow = "0 0 16px rgba(16,185,129,0.4)";
        } else if (ghost) {
          e.currentTarget.style.color = PAL.text;
          e.currentTarget.style.background = PAL.bg3;
        } else {
          e.currentTarget.style.borderColor = PAL.line3;
          e.currentTarget.style.background = PAL.bg3;
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = primary ? PAL.emerald : "transparent";
        e.currentTarget.style.borderColor = primary
          ? PAL.emerald
          : ghost
            ? "transparent"
            : PAL.line2;
        e.currentTarget.style.color = primary ? PAL.bg : ghost ? PAL.dim : PAL.text;
        e.currentTarget.style.boxShadow = "";
      }}
    >
      {children}
    </button>
  );
}

function EmptyState() {
  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
        padding: "60px 20px",
        textAlign: "center",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo-hypenode.png"
        alt="HypeNode"
        width={88}
        height={88}
        style={{ display: "block" }}
      />
      <div style={{ fontSize: 18, fontWeight: 600 }}>Ask the HypeNode agent</div>
      <div style={{ fontSize: 13, color: PAL.dim, maxWidth: 460, lineHeight: 1.55 }}>
        SoSoValue Terminal sentiment, ETF flows, basket backtests, on-chain
        actions via SoDEX — driven through {MCP_TOOLS.length} MCP tools. Try one
        of the suggestions below or type your own.
      </div>
    </div>
  );
}

function Messages({
  turns,
  busy,
  model,
}: {
  turns: Turn[];
  busy: boolean;
  model: string;
}) {
  // Day divider only above the first message of the day.
  return (
    <>
      <DayDivider label={dayLabel(turns[0]?.ts)} />
      {turns.map((t, i) => (
        <MsgBubble key={i} turn={t} model={model} />
      ))}
      {busy && (
        <div
          style={{
            marginBottom: 24,
            display: "flex",
            alignItems: "center",
            gap: 8,
            color: PAL.dim,
            fontFamily: MONO,
            fontSize: 11,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: PAL.cyan,
              boxShadow: `0 0 8px ${PAL.cyan}`,
              animation: "hype-pulse 1.4s ease-in-out infinite",
            }}
          />
          agent thinking…
        </div>
      )}
    </>
  );
}

function DayDivider({ label }: { label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "8px 0 16px" }}>
      <div style={{ flex: 1, height: 1, background: PAL.line }} />
      <div style={{ fontFamily: MONO, fontSize: 9.5, color: PAL.faint, letterSpacing: "0.14em" }}>
        {label}
      </div>
      <div style={{ flex: 1, height: 1, background: PAL.line }} />
    </div>
  );
}

function MsgBubble({ turn, model }: { turn: Turn; model: string }) {
  const isUser = turn.role === "user";
  const tools = turn.tool_calls ?? [];
  const toolsTotalMs = tools.reduce((acc, t) => acc + (t.duration_ms || 0), 0);
  const allOk = tools.every((t) => t.ok);
  return (
    <div
      style={{
        marginBottom: 24,
        maxWidth: 760,
        marginLeft: isUser ? "auto" : 0,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 8,
          fontFamily: MONO,
          fontSize: 10,
          color: PAL.faint,
          justifyContent: isUser ? "flex-end" : "flex-start",
          flexWrap: "wrap",
        }}
      >
        {isUser ? (
          <>
            <span>{clockHHMM(turn.ts)}</span>
            <RoleAvatar isUser />
          </>
        ) : (
          <>
            <RoleAvatar isUser={false} />
            <span style={{ color: PAL.cyan }}>· {model}</span>
            <span>· {clockHHMM(turn.ts)}</span>
            {tools.length > 0 && <span>· {tools.length} tool calls</span>}
            {turn.usage && turn.usage.elapsed_ms > 0 && (
              <span>· {(turn.usage.elapsed_ms / 1000).toFixed(1)}s</span>
            )}
          </>
        )}
      </div>
      {isUser ? (
        <div
          style={{
            background: PAL.bg3,
            border: `1px solid ${PAL.line2}`,
            borderRadius: "10px 10px 2px 10px",
            padding: "12px 14px",
            fontSize: 14,
            lineHeight: 1.5,
            color: PAL.text,
            whiteSpace: "pre-wrap",
          }}
        >
          {turn.content}
        </div>
      ) : (
        <>
          {tools.length > 0 && (
            <ToolTraceCard tools={tools} totalMs={toolsTotalMs} allOk={allOk} />
          )}
          <div
            style={{
              fontSize: 14.5,
              lineHeight: 1.55,
              color: PAL.text,
              whiteSpace: "pre-wrap",
            }}
          >
            {turn.content}
          </div>
        </>
      )}
    </div>
  );
}

function ToolTraceCard({
  tools,
  totalMs,
  allOk,
}: {
  tools: ToolCallTrace[];
  totalMs: number;
  allOk: boolean;
}) {
  return (
    <div
      style={{
        background: PAL.bg2,
        border: `1px solid ${PAL.line}`,
        borderRadius: 10,
        overflow: "hidden",
        marginBottom: 14,
      }}
    >
      <div
        style={{
          padding: "10px 14px",
          display: "flex",
          alignItems: "center",
          gap: 10,
          borderBottom: `1px solid ${PAL.line}`,
          background: PAL.bg3,
        }}
      >
        <span
          style={{
            width: 22,
            height: 22,
            borderRadius: 5,
            background: "rgba(34,211,238,0.12)",
            color: PAL.cyan,
            display: "grid",
            placeItems: "center",
            fontFamily: MONO,
            fontSize: 11,
            fontWeight: 700,
          }}
        >
          ⚙
        </span>
        <span style={{ fontSize: 12, color: PAL.text, fontWeight: 500 }}>
          Tool execution trace
        </span>
        <span
          style={{
            marginLeft: "auto",
            fontFamily: MONO,
            fontSize: 10,
            color: PAL.faint,
          }}
        >
          {tools.length} call{tools.length === 1 ? "" : "s"} ·{" "}
          {totalMs > 1000 ? `${(totalMs / 1000).toFixed(1)}s` : `${totalMs}ms`} total
        </span>
        <span
          style={{
            fontFamily: MONO,
            fontSize: 10,
            color: allOk ? PAL.emerald : PAL.amber,
            padding: "2px 6px",
            background: allOk ? "rgba(16,185,129,0.10)" : "rgba(245,158,11,0.10)",
            borderRadius: 3,
          }}
        >
          {allOk ? "all OK" : "partial"}
        </span>
      </div>
      <div style={{ padding: "8px 0" }}>
        {tools.map((t, i) => (
          <ToolTraceRow key={i} tool={t} last={i === tools.length - 1} />
        ))}
      </div>
    </div>
  );
}

function ToolTraceRow({ tool, last }: { tool: ToolCallTrace; last: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        padding: "7px 14px",
        borderBottom: last ? "none" : `1px solid ${PAL.line}`,
      }}
    >
      <span
        style={{
          color: tool.ok ? PAL.cyan : PAL.amber,
          fontFamily: MONO,
          fontSize: 11,
          paddingTop: 2,
        }}
      >
        ↳
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontFamily: MONO,
            fontSize: 11.5,
            color: tool.ok ? PAL.cyan : PAL.amber,
          }}
        >
          {tool.name}
        </div>
        <div
          style={{
            fontFamily: MONO,
            fontSize: 11,
            color: PAL.text,
            marginTop: 1,
            wordBreak: "break-all",
          }}
        >
          {formatToolArgs(tool.input)}
        </div>
        {tool.output_summary && (
          <div
            style={{
              fontFamily: MONO,
              fontSize: 10.5,
              color: tool.ok ? PAL.dim : PAL.amber,
              marginTop: 4,
              padding: "5px 8px",
              background: PAL.bg,
              borderLeft: `2px solid ${tool.ok ? PAL.line3 : PAL.amber}`,
              borderRadius: "0 4px 4px 0",
            }}
          >
            → {tool.output_summary}
          </div>
        )}
      </div>
      <div
        style={{
          fontFamily: MONO,
          fontSize: 10,
          color: PAL.faint,
          paddingTop: 2,
          minWidth: 48,
          textAlign: "right",
        }}
      >
        {tool.duration_ms > 1000
          ? `${(tool.duration_ms / 1000).toFixed(1)}s`
          : `${tool.duration_ms}ms`}
      </div>
    </div>
  );
}

function formatToolArgs(input: Record<string, unknown>): React.ReactNode {
  // Render { key1: value1, key2: value2 } with subtle color hints —
  // strings amber, numbers emerald, keys violet — matching the design.
  const entries = Object.entries(input);
  if (entries.length === 0) return <span style={{ color: PAL.faint }}>{"(no args)"}</span>;
  return (
    <>
      {entries.map(([k, v], i) => (
        <span key={k}>
          <span style={{ color: PAL.violet }}>{k}</span>
          <span>: </span>
          <span style={{ color: typeof v === "number" ? PAL.emerald : PAL.amber }}>
            {typeof v === "string" ? `"${v}"` : JSON.stringify(v)}
          </span>
          {i < entries.length - 1 && <span>, </span>}
        </span>
      ))}
    </>
  );
}

function RoleAvatar({ isUser }: { isUser: boolean }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
      }}
    >
      <span
        style={{
          width: 18,
          height: 18,
          borderRadius: "50%",
          display: "grid",
          placeItems: "center",
          fontSize: 9,
          fontWeight: 700,
          color: PAL.bg,
          background: isUser
            ? `linear-gradient(135deg, ${PAL.violet}, ${PAL.cyan})`
            : `linear-gradient(135deg, ${PAL.emerald}, ${PAL.emeraldDim})`,
        }}
      >
        {isUser ? "Y" : "A"}
      </span>
      <span
        style={{
          fontFamily: "Inter, sans-serif",
          fontSize: 11.5,
          fontWeight: 600,
          color: PAL.text,
          letterSpacing: "-0.01em",
        }}
      >
        {isUser ? "You" : "Agent"}
      </span>
    </span>
  );
}

function Composer({
  input,
  setInput,
  onSend,
  onSuggestion,
  busy,
  textareaRef,
}: {
  input: string;
  setInput: (v: string) => void;
  onSend: () => void;
  onSuggestion: (s: string) => void;
  busy: boolean;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
}) {
  return (
    <div style={{ padding: "16px 28px 18px", borderTop: `1px solid ${PAL.line}`, background: PAL.bg }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onSuggestion(s)}
            disabled={busy}
            style={{
              padding: "5px 10px",
              background: PAL.bg3,
              border: `1px solid ${PAL.line}`,
              borderRadius: 999,
              fontSize: 11.5,
              color: busy ? PAL.faint : PAL.dim,
              cursor: busy ? "not-allowed" : "pointer",
              fontFamily: "inherit",
              transition: "all .15s",
            }}
            onMouseEnter={(e) => {
              if (busy) return;
              e.currentTarget.style.color = PAL.text;
              e.currentTarget.style.borderColor = PAL.line2;
              e.currentTarget.style.background = PAL.bg4;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = busy ? PAL.faint : PAL.dim;
              e.currentTarget.style.borderColor = PAL.line;
              e.currentTarget.style.background = PAL.bg3;
            }}
          >
            {s}
          </button>
        ))}
      </div>
      <div
        style={{
          background: PAL.bg2,
          border: `1px solid ${PAL.line2}`,
          borderRadius: 12,
          padding: "12px 14px",
          transition: "border-color .15s",
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = "rgba(16,185,129,0.4)";
          e.currentTarget.style.boxShadow = "0 0 0 3px rgba(16,185,129,0.06)";
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = PAL.line2;
          e.currentTarget.style.boxShadow = "";
        }}
      >
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            const ta = e.currentTarget;
            ta.style.height = "22px";
            ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`;
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
          rows={1}
          placeholder='Ask anything — "rebalance HDP8", "simulate 2021 crash", "why DIMO?"'
          style={{
            width: "100%",
            background: "transparent",
            color: PAL.text,
            border: "none",
            outline: "none",
            resize: "none",
            fontFamily: "inherit",
            fontSize: 14,
            lineHeight: 1.5,
            minHeight: 22,
            maxHeight: 120,
          }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
          <ComposerPicker label="Tools" k={String(MCP_TOOLS.length)} />
          <ComposerPicker label="Context" k="HDP8" />
          <span style={{ flex: 1 }} />
          <span
            style={{
              fontFamily: MONO,
              fontSize: 9.5,
              color: PAL.faint,
              marginRight: 6,
            }}
          >
            ⏎ to send · ⇧⏎ for newline
          </span>
          <Btn primary onClick={onSend} disabled={busy} style={{ padding: "7px 13px" }}>
            {busy ? "Sending…" : "Send →"}
          </Btn>
        </div>
      </div>
    </div>
  );
}

function ComposerPicker({ label, k }: { label: string; k: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 9px",
        border: `1px solid ${PAL.line}`,
        borderRadius: 5,
        fontSize: 11,
        color: PAL.dim,
        cursor: "default",
      }}
    >
      <span>{label}</span>
      <span style={{ fontFamily: MONO, fontSize: 10 }}>{k}</span>
    </span>
  );
}

/* ============================ RIGHT SIDEBAR ============================ */

function RightSidebar({
  agentOnline,
  uptime,
  decisions,
  toolCalls,
  currentNode,
  model,
  usageToday,
}: {
  agentOnline: boolean;
  uptime: number;
  decisions: number;
  toolCalls: number;
  currentNode: string | null;
  model: string;
  usageToday: UsageBucket;
}) {
  return (
    <aside
      style={{
        borderLeft: `1px solid ${PAL.line}`,
        padding: "16px 18px",
        overflowY: "auto",
        background: PAL.bg,
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      <McpToolsPanel agentOnline={agentOnline} />
      <SessionContextPanel
        agentOnline={agentOnline}
        uptime={uptime}
        decisions={decisions}
        toolCalls={toolCalls}
        currentNode={currentNode}
        model={model}
      />
      <UsagePanel usage={usageToday} />
    </aside>
  );
}

function PanelShell({
  title,
  right,
  children,
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: PAL.bg2,
        border: `1px solid ${PAL.line}`,
        borderRadius: 10,
      }}
    >
      <div
        style={{
          padding: "11px 14px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: `1px solid ${PAL.line}`,
        }}
      >
        <h4 style={{ fontSize: 12, fontWeight: 600, letterSpacing: "-0.005em" }}>{title}</h4>
        {right}
      </div>
      <div style={{ padding: "8px 0" }}>{children}</div>
    </div>
  );
}

function McpToolsPanel({ agentOnline }: { agentOnline: boolean }) {
  return (
    <PanelShell
      title="MCP tools available"
      right={
        <span style={{ fontFamily: MONO, fontSize: 10, color: PAL.faint }}>
          {MCP_TOOLS.length} of {MCP_TOOLS.length}
        </span>
      }
    >
      {MCP_TOOLS.map((t) => (
        <ToolItem key={t.name} tool={t} agentOnline={agentOnline} />
      ))}
    </PanelShell>
  );
}

function ToolItem({
  tool,
  agentOnline,
}: {
  tool: { name: string; desc: string; kind: ToolKind; live?: boolean };
  agentOnline: boolean;
}) {
  const palette: Record<ToolKind, { bg: string; color: string; letter: string }> = {
    term: { bg: "rgba(34,211,238,0.1)", color: PAL.cyan, letter: "T" },
    bk: { bg: "rgba(167,139,250,0.1)", color: PAL.violet, letter: "B" },
    ssi: { bg: "rgba(16,185,129,0.1)", color: PAL.emerald, letter: "S" },
    dex: { bg: "rgba(245,158,11,0.1)", color: PAL.amber, letter: "D" },
    risk: { bg: "rgba(239,68,68,0.1)", color: PAL.red, letter: "R" },
  };
  const p = palette[tool.kind];
  const live = !!tool.live && agentOnline;
  return (
    <div
      style={{
        padding: "9px 14px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
        cursor: "pointer",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = PAL.bg3)}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
        <div
          style={{
            width: 22,
            height: 22,
            borderRadius: 5,
            display: "grid",
            placeItems: "center",
            fontFamily: MONO,
            fontSize: 9.5,
            fontWeight: 700,
            background: p.bg,
            color: p.color,
            flexShrink: 0,
          }}
        >
          {p.letter}
        </div>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontFamily: MONO,
              fontSize: 11,
              color: PAL.text,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {tool.name}
          </div>
          <div
            style={{
              fontFamily: MONO,
              fontSize: 9.5,
              color: PAL.faint,
              marginTop: 1,
            }}
          >
            {tool.desc}
          </div>
        </div>
      </div>
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          flexShrink: 0,
          background: live ? PAL.emerald : PAL.line3,
          boxShadow: live ? `0 0 6px ${PAL.emerald}` : undefined,
        }}
      />
    </div>
  );
}

function SessionContextPanel({
  agentOnline,
  uptime,
  decisions,
  toolCalls,
  currentNode,
  model,
}: {
  agentOnline: boolean;
  uptime: number;
  decisions: number;
  toolCalls: number;
  currentNode: string | null;
  model: string;
}) {
  return (
    <PanelShell title="Session context">
      <CtxRow k="Status" v={agentOnline ? "Online" : "Offline"} tone={agentOnline ? "em" : undefined} />
      <CtxRow k="Model" v={model} />
      <CtxRow k="Uptime" v={fmtUptime(uptime)} />
      <CtxRow k="Current node" v={currentNode ?? "idle"} />
      <CtxRow k="Decisions (24h)" v={String(decisions)} />
      <CtxRow k="Tool calls" v={toolCalls.toLocaleString()} />
      <CtxRow k="Network" v="ValueChain L1" />
    </PanelShell>
  );
}

function CtxRow({
  k,
  v,
  tone,
}: {
  k: string;
  v: string;
  tone?: "em" | "am";
}) {
  return (
    <div
      style={{
        padding: "8px 14px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        borderBottom: `1px solid ${PAL.line}`,
      }}
    >
      <span style={{ fontFamily: MONO, fontSize: 10.5, color: PAL.faint, letterSpacing: "0.04em" }}>
        {k}
      </span>
      <span
        style={{
          fontFamily: MONO,
          fontSize: 11,
          color: tone === "em" ? PAL.emerald : tone === "am" ? PAL.amber : PAL.text,
        }}
      >
        {v}
      </span>
    </div>
  );
}

function UsagePanel({ usage }: { usage: UsageBucket }) {
  // All three figures come from real Anthropic `usage` blocks aggregated
  // per UTC day in localStorage. Caps are soft visual ceilings — there's
  // no enforcement layer yet, just a fill bar so the user can eyeball
  // their daily spend at a glance.
  const calls = { v: usage.calls, max: 500 };
  const tokens = { v: usage.tokens, max: 200_000 };
  const spend = { v: usage.spend_usd, max: 20 };
  const tokensLabel =
    tokens.v >= 1000
      ? `${(tokens.v / 1000).toFixed(1)}k / ${(tokens.max / 1000).toFixed(0)}k`
      : `${tokens.v} / ${(tokens.max / 1000).toFixed(0)}k`;
  return (
    <PanelShell
      title="Usage today"
      right={
        <span style={{ fontFamily: MONO, fontSize: 10, color: PAL.faint }}>
          resets 00:00 UTC
        </span>
      }
    >
      <UsageBar
        k="TOOL CALLS"
        label={`${calls.v} / ${calls.max}`}
        pct={(calls.v / calls.max) * 100}
        color={PAL.emerald}
      />
      <UsageBar
        k="TOKENS"
        label={tokensLabel}
        pct={(tokens.v / tokens.max) * 100}
        color={PAL.cyan}
        topBorder
      />
      <UsageBar
        k="SPEND"
        label={`$${spend.v.toFixed(2)} / $${spend.max.toFixed(2)}`}
        pct={(spend.v / spend.max) * 100}
        color={PAL.amber}
        topBorder
      />
    </PanelShell>
  );
}

function UsageBar({
  k,
  label,
  pct,
  color,
  topBorder = false,
}: {
  k: string;
  label: string;
  pct: number;
  color: string;
  topBorder?: boolean;
}) {
  return (
    <div
      style={{
        padding: "12px 14px",
        borderTop: topBorder ? `1px solid ${PAL.line}` : undefined,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 6,
        }}
      >
        <span style={{ fontFamily: MONO, fontSize: 10, color: PAL.faint, letterSpacing: "0.06em" }}>
          {k}
        </span>
        <span style={{ fontFamily: MONO, fontSize: 11, color: PAL.text }}>{label}</span>
      </div>
      <div style={{ height: 4, background: PAL.bg4, borderRadius: 2, overflow: "hidden" }}>
        <i
          style={{
            display: "block",
            height: "100%",
            width: `${Math.max(0, Math.min(100, pct))}%`,
            background: color,
          }}
        />
      </div>
    </div>
  );
}
