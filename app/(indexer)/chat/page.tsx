"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { TopUpModal } from "@/components/billing/TopUpModal";
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

// Server-side billing snapshot returned by /api/billing/usage and as the
// `billing` field on each /api/chat reply. Client state is purely a mirror
// of this — server is source of truth for free-quota accounting and paid
// balance. Mirrors `AccountSnapshot` from lib/billing.ts.
type BillingSnapshot = {
  address: string;
  daily: { date: string; spend_usd: number; tokens: number; calls: number };
  paid_balance_usd: number;
  caps: {
    free_daily_spend_usd: number;
    free_daily_tokens: number;
    free_daily_calls: number;
  };
  free_daily_left_usd: number;
  total_available_usd: number;
  blocked: boolean;
  block_reason: string | null;
  top_ups: { ts: string; amount_usd: number }[];
};

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
  const [billing, setBilling] = useState<BillingSnapshot | null>(null);
  const [topUpOpen, setTopUpOpen] = useState(false);
  const messagesRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  // Hydrate the live billing snapshot from the server on mount. Server is
  // the source of truth — per-wallet, persistent, includes paid balance and
  // free-quota gating. Each /api/chat response also returns a fresh snapshot
  // so we don't poll separately under normal use.
  const refreshBilling = useCallback(async () => {
    try {
      const res = await fetch("/api/billing/usage", { cache: "no-store" });
      if (!res.ok) return;
      setBilling((await res.json()) as BillingSnapshot);
    } catch {
      /* noop — billing panel just stays in its previous state */
    }
  }, []);

  useEffect(() => {
    refreshBilling();
  }, [refreshBilling]);

  // Hydrate the composer from `?q=` once on mount — research page deep-links
  // here with a topic-anchored prompt. We strip the param afterwards so
  // refreshing or sharing the URL doesn't re-prefill (potentially stomping
  // user edits).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const q = params.get("q");
    if (q && q.trim()) {
      setInput(q);
      params.delete("q");
      const qs = params.toString();
      const next = window.location.pathname + (qs ? `?${qs}` : "");
      window.history.replaceState({}, "", next);
      composerRef.current?.focus();
    }
  }, []);

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
    // Skip save when turns is the initial empty array — the restore effect
    // above queues `setTurns(parsed)` but its re-render hasn't applied yet
    // when this effect fires on mount. Without the guard we'd overwrite the
    // localStorage history with `[]` and then never recover (since restore
    // would read `[]` next refresh and bail-out the setState as no-op).
    // `clearHistory()` calls `localStorage.removeItem` directly, so an
    // intentional clear still works.
    if (turns.length === 0) {
      // Still scroll to top on a fresh empty thread.
      messagesRef.current?.scrollTo({ top: 0, behavior: "auto" });
      return;
    }
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
    // Pre-flight UX gate: if we already know the user is over quota, skip
    // the round trip and prompt for a top-up immediately. The server still
    // enforces — this is just to avoid a wasted chat round.
    if (billing?.blocked) {
      setTopUpOpen(true);
      return;
    }
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
      // 402 = free quota exhausted AND paid balance empty. Server returned
      // a fresh billing snapshot; surface the top-up modal and rewind the
      // optimistic user turn so the prompt isn't lost.
      if (res.status === 402) {
        const body = (await res.json()) as {
          error: string;
          reason?: string;
          billing: BillingSnapshot;
        };
        setBilling(body.billing);
        setTurns(turns); // rewind — drop the user turn we optimistically appended
        setInput(value); // restore the prompt to the composer
        setTopUpOpen(true);
        return;
      }
      const reply = (await res.json()) as Turn & { billing?: BillingSnapshot };
      setTurns([
        ...next,
        { ...reply, role: "agent", ts: reply.ts ?? new Date().toISOString() },
      ]);
      if (reply.billing) {
        setBilling(reply.billing);
      } else {
        // Server didn't echo billing (older route, error mid-stream). Pull
        // a fresh snapshot so the panel doesn't drift out of sync.
        refreshBilling();
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
        billing={billing}
        onTopUp={() => setTopUpOpen(true)}
      />

      <TopUpModal
        open={topUpOpen}
        onClose={() => setTopUpOpen(false)}
        onSuccess={() => {
          // Refresh from the server — the topup endpoint already wrote
          // the new balance, this just ensures our snapshot includes the
          // full updated record (top_ups list, etc).
          refreshBilling();
        }}
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
          <AgentMarkdown content={turn.content} />
        </>
      )}
    </div>
  );
}

/* ---------- markdown rendering for agent replies ---------- */

// Tailored styles for the dark chat theme. We keep the prose narrow (max
// 760px applied by the bubble container) and the heading scale tighter than
// browser defaults — Claude tends to use ## / ### heavily and the default
// H1 sizing would dominate the column.
const MD_COMPONENTS: Components = {
  h1: ({ children }) => (
    <h3
      style={{
        fontSize: 18,
        fontWeight: 600,
        letterSpacing: "-0.02em",
        margin: "16px 0 8px",
        color: PAL.text,
      }}
    >
      {children}
    </h3>
  ),
  h2: ({ children }) => (
    <h4
      style={{
        fontSize: 16,
        fontWeight: 600,
        letterSpacing: "-0.015em",
        margin: "14px 0 6px",
        color: PAL.text,
      }}
    >
      {children}
    </h4>
  ),
  h3: ({ children }) => (
    <h5
      style={{
        fontSize: 13.5,
        fontWeight: 600,
        letterSpacing: "-0.01em",
        margin: "12px 0 4px",
        color: PAL.text,
      }}
    >
      {children}
    </h5>
  ),
  h4: ({ children }) => (
    <h6
      style={{
        fontSize: 12.5,
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        margin: "10px 0 4px",
        color: PAL.dim,
      }}
    >
      {children}
    </h6>
  ),
  p: ({ children }) => (
    <p
      style={{
        fontSize: 14.5,
        lineHeight: 1.55,
        margin: "6px 0",
        color: PAL.text,
      }}
    >
      {children}
    </p>
  ),
  strong: ({ children }) => (
    <strong style={{ fontWeight: 600, color: PAL.text }}>{children}</strong>
  ),
  em: ({ children }) => (
    <em style={{ fontStyle: "italic", color: PAL.dim }}>{children}</em>
  ),
  ul: ({ children }) => (
    <ul
      style={{
        paddingLeft: 22,
        margin: "6px 0",
        listStyle: "disc",
        fontSize: 14,
        lineHeight: 1.55,
        color: PAL.text,
      }}
    >
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol
      style={{
        paddingLeft: 22,
        margin: "6px 0",
        listStyle: "decimal",
        fontSize: 14,
        lineHeight: 1.55,
        color: PAL.text,
      }}
    >
      {children}
    </ol>
  ),
  li: ({ children }) => (
    <li style={{ margin: "2px 0", paddingLeft: 4 }}>{children}</li>
  ),
  code: ({ children, className }) => {
    // Inline code (no language class) gets pill styling. Block code is
    // wrapped in <pre> by ReactMarkdown — handled by the `pre` override.
    const isBlock = typeof className === "string" && className.includes("language-");
    if (isBlock) {
      return (
        <code
          className={className}
          style={{
            fontFamily: MONO,
            fontSize: 12,
            color: PAL.text,
            display: "block",
          }}
        >
          {children}
        </code>
      );
    }
    return (
      <code
        style={{
          fontFamily: MONO,
          fontSize: 12.5,
          padding: "1px 5px",
          background: PAL.bg3,
          border: `1px solid ${PAL.line}`,
          borderRadius: 4,
          color: PAL.cyan,
        }}
      >
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre
      style={{
        fontFamily: MONO,
        fontSize: 12,
        padding: "10px 12px",
        background: PAL.bg2,
        border: `1px solid ${PAL.line}`,
        borderRadius: 8,
        margin: "8px 0",
        overflowX: "auto",
        color: PAL.text,
      }}
    >
      {children}
    </pre>
  ),
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      style={{ color: PAL.cyan, textDecoration: "underline" }}
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote
      style={{
        margin: "8px 0",
        padding: "4px 12px",
        borderLeft: `2px solid ${PAL.line2}`,
        color: PAL.dim,
        fontSize: 14,
        lineHeight: 1.55,
      }}
    >
      {children}
    </blockquote>
  ),
  hr: () => (
    <hr
      style={{
        border: "none",
        borderTop: `1px solid ${PAL.line}`,
        margin: "12px 0",
      }}
    />
  ),
  table: ({ children }) => (
    <div style={{ overflowX: "auto", margin: "10px 0" }}>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: 13,
          background: PAL.bg2,
          border: `1px solid ${PAL.line}`,
          borderRadius: 6,
          overflow: "hidden",
        }}
      >
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => (
    <thead style={{ background: PAL.bg3 }}>{children}</thead>
  ),
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => (
    <tr style={{ borderBottom: `1px solid ${PAL.line}` }}>{children}</tr>
  ),
  th: ({ children, style }) => (
    <th
      style={{
        padding: "8px 12px",
        textAlign: "left",
        fontWeight: 600,
        color: PAL.dim,
        fontSize: 11.5,
        letterSpacing: "0.02em",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {children}
    </th>
  ),
  td: ({ children, style }) => (
    <td
      style={{
        padding: "8px 12px",
        color: PAL.text,
        verticalAlign: "top",
        ...style,
      }}
    >
      {children}
    </td>
  ),
  del: ({ children }) => (
    <del style={{ color: PAL.faint, textDecoration: "line-through" }}>
      {children}
    </del>
  ),
};

function AgentMarkdown({ content }: { content: string }) {
  return (
    <div
      style={{
        fontSize: 14.5,
        lineHeight: 1.55,
        color: PAL.text,
      }}
    >
      <ReactMarkdown components={MD_COMPONENTS} remarkPlugins={[remarkGfm]}>
        {content}
      </ReactMarkdown>
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
  billing,
  onTopUp,
}: {
  agentOnline: boolean;
  uptime: number;
  decisions: number;
  toolCalls: number;
  currentNode: string | null;
  model: string;
  billing: BillingSnapshot | null;
  onTopUp: () => void;
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
      <UsagePanel billing={billing} onTopUp={onTopUp} />
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

function UsagePanel({
  billing,
  onTopUp,
}: {
  billing: BillingSnapshot | null;
  onTopUp: () => void;
}) {
  // All four figures come from the server-side billing store. Caps are
  // enforced — when SPEND fills, /api/chat returns 402 and the composer
  // blocks until the user tops up.
  if (!billing) {
    return (
      <PanelShell title="Usage today">
        <div style={{ padding: "12px 14px" }}>
          <span style={{ fontFamily: MONO, fontSize: 10, color: PAL.faint }}>
            Loading billing snapshot…
          </span>
        </div>
      </PanelShell>
    );
  }

  const callsMax = billing.caps.free_daily_calls;
  const tokensMax = billing.caps.free_daily_tokens;
  const spendMax = billing.caps.free_daily_spend_usd;
  const callsV = billing.daily.calls;
  const tokensV = billing.daily.tokens;
  const spendV = billing.daily.spend_usd;

  const tokensLabel =
    tokensV >= 1000
      ? `${(tokensV / 1000).toFixed(1)}k / ${(tokensMax / 1000).toFixed(0)}k`
      : `${tokensV} / ${(tokensMax / 1000).toFixed(0)}k`;

  // The spend bar reflects free-quota consumption only; paid-balance usage
  // is drawn on top of the cap so the bar can saturate at the free wall and
  // stay there while paid covers further turns.
  const spendPct = Math.min(100, (spendV / spendMax) * 100);

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
        label={`${callsV} / ${callsMax}`}
        pct={(callsV / callsMax) * 100}
        color={PAL.emerald}
      />
      <UsageBar
        k="TOKENS"
        label={tokensLabel}
        pct={(tokensV / tokensMax) * 100}
        color={PAL.cyan}
        topBorder
      />
      <UsageBar
        k="FREE SPEND"
        label={`$${spendV.toFixed(3)} / $${spendMax.toFixed(2)}`}
        pct={spendPct}
        color={billing.blocked ? PAL.red : PAL.amber}
        topBorder
      />

      {/* Balance + top-up CTA. Paid balance is permanent across days; once
          free quota is exhausted, every chat turn deducts from this. */}
      <div
        style={{
          padding: "12px 14px",
          borderTop: `1px solid ${PAL.line}`,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 8,
          }}
        >
          <span
            style={{
              fontFamily: MONO,
              fontSize: 10,
              color: PAL.faint,
              letterSpacing: "0.06em",
            }}
          >
            PAID BALANCE
          </span>
          <span
            style={{
              fontFamily: MONO,
              fontSize: 13,
              fontWeight: 600,
              color: billing.paid_balance_usd > 0 ? PAL.emerald : PAL.text,
            }}
          >
            ${billing.paid_balance_usd.toFixed(2)}
          </span>
        </div>

        {billing.blocked && billing.block_reason && (
          <div
            style={{
              padding: "8px 10px",
              background: "rgba(239,68,68,0.10)",
              border: "1px solid rgba(239,68,68,0.4)",
              borderRadius: 6,
              fontSize: 11,
              color: PAL.red,
              lineHeight: 1.4,
              marginBottom: 8,
            }}
          >
            {billing.block_reason}
          </div>
        )}

        <button
          type="button"
          onClick={onTopUp}
          style={{
            width: "100%",
            padding: "8px 12px",
            background: billing.blocked ? PAL.emerald : "transparent",
            color: billing.blocked ? PAL.bg : PAL.emerald,
            border: `1px solid ${PAL.emerald}`,
            borderRadius: 6,
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: "inherit",
            transition: "all .15s",
          }}
        >
          {billing.blocked ? "Top up to continue →" : "Top up"}
        </button>
      </div>
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
