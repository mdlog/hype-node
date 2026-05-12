"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { useAccount, useSignTypedData, useSwitchChain } from "wagmi";

import { TopUpModal } from "@/components/billing/TopUpModal";
import { LogoSplash } from "@/components/ui/LogoSplash";
import { formatSyncLabel, useAutoRefetch } from "@/lib/hooks/useAutoRefetch";
import { tokens } from "@/lib/tokens";
import type { ToolHealth, ToolStatus } from "@/lib/api/agent";

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
  rose: tokens.rose,
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

/* MCP tools surface — kept aligned with agent-service/src/mcp_server.py.
   Live status comes from /api/agent/tools/health (real probe), not the
   hardcoded array — see McpToolsPanel + ToolHealth in lib/api/agent.ts. */
type ToolKind = "term" | "bk" | "ssi" | "dex" | "risk" | "fund" | "rd";
const MCP_TOOLS: Array<{ name: string; desc: string; kind: ToolKind }> = [
  { name: "terminal.get_sentiment", desc: "SoSoValue · sector sentiment", kind: "term" },
  { name: "terminal.get_fund_flow", desc: "ETF flows · 24h / 7d", kind: "term" },
  { name: "terminal.get_news", desc: "Headlines + impact score", kind: "term" },
  { name: "list_funding_rounds", desc: "Recent VC rounds · top currencies", kind: "fund" },
  { name: "get_project_fundraising", desc: "Per-project funding history", kind: "fund" },
  { name: "search_rootdata", desc: "RootData search · projects/VCs/people", kind: "rd" },
  { name: "get_rootdata_project", desc: "RootData · full project profile", kind: "rd" },
  { name: "get_rootdata_investor", desc: "RootData · VC portfolio detail", kind: "rd" },
  { name: "backtest.run", desc: "90d / 1y · vs benchmark", kind: "bk" },
  { name: "ssi.wrap / unwrap", desc: "SSI Protocol · mint & burn", kind: "ssi" },
  { name: "sodex_execute_trade", desc: "SoDEX testnet · buy with USDC", kind: "dex" },
  { name: "sodex_sell_trade", desc: "SoDEX testnet · sell asset for USDC", kind: "dex" },
  { name: "sodex_get_balances", desc: "SoDEX wallet balances", kind: "dex" },
  { name: "sodex_list_orders", desc: "SoDEX open orders", kind: "dex" },
  { name: "sodex_cancel_order", desc: "SoDEX cancel resting order", kind: "dex" },
  { name: "risk.check_thresholds", desc: "σ + drawdown gates", kind: "risk" },
];

const SUGGESTIONS = [
  "Buy $20 of SOSO on SoDEX testnet",
  "Show my SoDEX balances",
  "Latest VC fundraising rounds",
  "Who funded Avalanche?",
];

// Legacy localStorage key — Phase 2 migrated chat history to Supabase
// (`ch_threads` + `ch_messages`). We keep the constant so we can detect
// stale local data on first load and offer to import it into the user's
// account before clearing it.
const LEGACY_STORAGE_KEY = "hype.chat.v1";

// Wire shapes for /api/chat/threads — hand-mirrored so we don't import
// server-only types from lib/supabase into a "use client" module.
type ThreadWire = {
  id: string;
  created_at: string;
  updated_at: string;
  title: string | null;
  archived: boolean;
  pinned: boolean;
};

type MessageWire = {
  id: string;
  thread_id: string;
  created_at: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string | null;
  tool_calls: ToolCallTrace[] | null;
  usage: ChatUsage | null;
  seq: number;
};

// Adapt an API message row into the local `Turn` shape the UI renders.
// "assistant" / "tool" / "system" all surface as a single bubble in this
// chat — only "user" gets the right-aligned style.
function messageToTurn(m: MessageWire): Turn {
  return {
    role: m.role === "user" ? "user" : "agent",
    content: m.content ?? "",
    ts: m.created_at,
    tool_calls: m.tool_calls,
    usage: m.usage,
  };
}

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
  const [toolsHealth, setToolsHealth] = useState<ToolHealth | null>(null);
  const [search, setSearch] = useState("");
  const [billing, setBilling] = useState<BillingSnapshot | null>(null);
  const [topUpOpen, setTopUpOpen] = useState(false);
  const messagesRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  // ---- Phase 2 thread persistence ----
  //
  // Threads + messages are persisted server-side in `ch_threads` and
  // `ch_messages`. The chat page mounts → fetch threads → if any, load the
  // most recent; otherwise create a new empty thread. New user/agent turns
  // are POSTed to the messages endpoint *after* the chat round-trip
  // completes so the DB state matches what the model actually saw.
  //
  // If the user is unauthenticated (401), we fall back to a local-only
  // session: turns still flow, but nothing persists. This matches the old
  // localStorage behaviour for anonymous use.
  const [threads, setThreads] = useState<ThreadWire[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [persistAuthed, setPersistAuthed] = useState<boolean>(false);
  // Set when we detect a legacy localStorage `hype.chat.v1` payload at
  // mount and the user hasn't yet decided whether to import or discard.
  const [legacyTurns, setLegacyTurns] = useState<Turn[] | null>(null);
  const [migratingChat, setMigratingChat] = useState(false);

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

  // Detect legacy localStorage history once at mount. We don't auto-import
  // because (a) the user might be on a different account than the one that
  // wrote the data, and (b) merging strategies are ambiguous. Banner is
  // shown until the user explicitly imports or discards.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Turn[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        setLegacyTurns(parsed);
      } else {
        localStorage.removeItem(LEGACY_STORAGE_KEY);
      }
    } catch {
      try {
        localStorage.removeItem(LEGACY_STORAGE_KEY);
      } catch {
        /* private mode */
      }
    }
  }, []);

  // Load a single thread + its messages by id. Auth failures bubble up as
  // a `false` return so callers can decide whether to retry or fall back.
  const loadThread = useCallback(async (id: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/chat/threads/${id}`, { cache: "no-store" });
      if (res.status === 401) return false;
      if (!res.ok) return false;
      const body = (await res.json()) as {
        thread: ThreadWire;
        messages: MessageWire[];
      };
      setActiveThreadId(body.thread.id);
      setTurns(body.messages.map(messageToTurn));
      return true;
    } catch {
      return false;
    }
  }, []);

  const refreshThreads = useCallback(async (): Promise<ThreadWire[] | null> => {
    try {
      const res = await fetch("/api/chat/threads", { cache: "no-store" });
      if (res.status === 401) {
        setPersistAuthed(false);
        setThreads([]);
        return null;
      }
      if (!res.ok) return null;
      const rows = (await res.json()) as ThreadWire[];
      setPersistAuthed(true);
      setThreads(rows);
      return rows;
    } catch {
      return null;
    }
  }, []);

  const createThread = useCallback(
    async (title?: string | null): Promise<ThreadWire | null> => {
      try {
        const res = await fetch("/api/chat/threads", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: title ?? null }),
        });
        if (res.status === 401) {
          setPersistAuthed(false);
          return null;
        }
        if (!res.ok) return null;
        const t = (await res.json()) as ThreadWire;
        setActiveThreadId(t.id);
        setTurns([]);
        await refreshThreads();
        return t;
      } catch {
        return null;
      }
    },
    [refreshThreads],
  );

  // Initial load: list threads → either pick the most recent or create
  // a fresh empty one. If the API 401s we leave the page in unauthed mode
  // (no persistence; turns array stays in memory only).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const list = await refreshThreads();
      if (cancelled || list === null) return;
      if (list.length > 0) {
        await loadThread(list[0].id);
      } else {
        await createThread(null);
      }
    })();
    return () => {
      cancelled = true;
    };
    // refreshThreads/loadThread/createThread are stable (defined with
    // useCallback over only stable deps), but we list them so future
    // additions stay correct.
  }, [refreshThreads, loadThread, createThread]);

  // ---- Phase 6b: cross-device sync via background polling ----
  //
  // Two parallel pollers:
  //   1. Threads list every 30s — surfaces NEW threads created from another
  //      device (or by the agent service). Cheap, low-frequency.
  //   2. Active thread messages every 10s — surfaces new replies sent from
  //      another device on the same thread (e.g. user typed a follow-up on
  //      their phone while the laptop is open). Higher frequency because
  //      this is where the user is actually looking.
  //
  // Both pollers are gated on `persistAuthed` so anonymous sessions don't
  // hammer 401s on a loop. The hook auto-pauses on hidden tabs.
  const threadsPoll = useAutoRefetch<ThreadWire[]>(
    persistAuthed ? "/api/chat/threads" : null,
    { intervalMs: 30_000 },
  );
  const messagesPoll = useAutoRefetch<{
    thread: ThreadWire;
    messages: MessageWire[];
  }>(
    persistAuthed && activeThreadId
      ? `/api/chat/threads/${activeThreadId}`
      : null,
    { intervalMs: 10_000 },
  );

  // Reflect the polled thread list into local state so the sidebar updates
  // when threads from another device arrive. We only overwrite when the
  // hook genuinely returned data; otherwise leave the sidebar alone so the
  // user doesn't see a flash of empty during a transient hook loading state.
  useEffect(() => {
    if (threadsPoll.data) setThreads(threadsPoll.data);
  }, [threadsPoll.data]);

  // Merge polled messages into local turns. CRITICAL: append-only — never
  // replace the whole array. The local turns may already include a freshly
  // sent message that hasn't round-tripped to /messages yet (the optimistic
  // append in `send()` happens before the persist call), so a wholesale
  // replace would briefly hide the user's own message and then put it back
  // when the next poll runs. Append handles two real cases cleanly:
  //   - Another device sent a message → poll sees `serverLen > localLen`,
  //     we append the new ones in seq order.
  //   - Local optimistic > server (because send hasn't persisted yet) →
  //     poll sees `serverLen <= localLen`, we no-op.
  // We also gate on the response's `thread.id` matching the active thread —
  // the user could have switched threads while the request was in flight.
  useEffect(() => {
    const payload = messagesPoll.data;
    if (!payload || payload.thread.id !== activeThreadId) return;
    const incoming = payload.messages.map(messageToTurn);
    setTurns((local) => {
      if (incoming.length <= local.length) return local;
      // Pick up only the tail beyond what we already have. We assume the
      // server returns messages ordered by seq; if a future migration
      // changes that, the merge here would need to dedupe by id instead.
      return [...local, ...incoming.slice(local.length)];
    });
  }, [messagesPoll.data, activeThreadId]);

  // Auto-scroll to the bottom whenever turns change. We no longer write to
  // localStorage here — the messages route handler persists each turn after
  // the chat round-trip completes.
  useEffect(() => {
    if (turns.length === 0) {
      messagesRef.current?.scrollTo({ top: 0, behavior: "auto" });
      return;
    }
    messagesRef.current?.scrollTo({
      top: messagesRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [turns]);

  // POST a single message to the active thread. Best-effort: a network
  // failure here doesn't unwind the in-memory turn (the user already saw
  // it render) — we just lose the persistence for that one entry.
  const persistMessage = useCallback(
    async (turn: Turn) => {
      if (!persistAuthed || !activeThreadId) return;
      try {
        await fetch(`/api/chat/threads/${activeThreadId}/messages`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            role: turn.role === "user" ? "user" : "assistant",
            content: turn.content,
            tool_calls: turn.tool_calls ?? null,
            usage: turn.usage ?? null,
          }),
        });
        // Side-effect: bump local thread updated_at by re-listing so the
        // sidebar shows the freshest activity. Cheap (one indexed query).
        void refreshThreads();
      } catch {
        /* silent — DB persistence is best-effort, user already saw the message */
      }
    },
    [activeThreadId, persistAuthed, refreshThreads],
  );

  const importLegacyChat = useCallback(async () => {
    if (!legacyTurns || legacyTurns.length === 0) return;
    setMigratingChat(true);
    try {
      // Create a dedicated thread so we don't merge legacy turns into an
      // active session. The title surfaces in the sidebar so the user can
      // tell at a glance which thread came from import.
      const t = await createThread("Imported from local history");
      if (!t) return; // 401 — the banner stays visible, user can retry after sign in.
      for (const turn of legacyTurns) {
        await fetch(`/api/chat/threads/${t.id}/messages`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            role: turn.role === "user" ? "user" : "assistant",
            content: turn.content,
            tool_calls: turn.tool_calls ?? null,
            usage: turn.usage ?? null,
          }),
        });
      }
      try {
        localStorage.removeItem(LEGACY_STORAGE_KEY);
      } catch {
        /* private mode */
      }
      setLegacyTurns(null);
      // Re-load the imported thread so the user sees their old history.
      await loadThread(t.id);
    } finally {
      setMigratingChat(false);
    }
  }, [legacyTurns, createThread, loadThread]);

  const discardLegacyChat = useCallback(() => {
    try {
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      /* private mode */
    }
    setLegacyTurns(null);
  }, []);

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

  // Per-tool readiness probe — populates the dot color in the MCP panel
  // (ok=green, degraded=amber, missing_config=grey). Returns null on agent
  // unreachable, in which case the panel falls back to all-grey.
  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const r = await fetch("/api/agent/tools/health", { cache: "no-store" });
        if (!r.ok) {
          if (!cancelled) setToolsHealth(null);
          return;
        }
        const data = (await r.json()) as ToolHealth;
        if (!cancelled) setToolsHealth(data);
      } catch {
        if (!cancelled) setToolsHealth(null);
      }
    }
    tick();
    const id = setInterval(tick, 15_000);
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

  // Sidebar list — sourced from the server's thread list once we're
  // authenticated, with the active thread highlighted. While loading or
  // when unauthenticated we fall back to a single placeholder row that
  // mirrors the in-memory session state.
  const filteredConvs = useMemo(() => {
    const q = search.trim().toLowerCase();
    let items: ConvItem[];
    if (persistAuthed && threads.length > 0) {
      items = threads.map((t) => {
        const isActive = t.id === activeThreadId;
        const elapsedMin = Math.max(
          0,
          Math.round((Date.now() - new Date(t.updated_at).getTime()) / 60_000),
        );
        const when = elapsedMin === 0 ? "now" : elapsedMin < 60 ? `${elapsedMin}m` : `${Math.floor(elapsedMin / 60)}h`;
        const promptCount = isActive ? userTurns : 0;
        const replyCount = isActive ? agentTurns : 0;
        return {
          id: t.id,
          title: t.title?.trim() || "New conversation",
          when,
          meta: isActive
            ? promptCount === 0 && replyCount === 0
              ? "no messages yet"
              : `${promptCount} prompts · ${replyCount} replies`
            : "saved thread",
          tag: isActive && agentOnline ? "live" : null,
          active: isActive,
          pinned: !!t.pinned,
        };
      });
    } else {
      items = [
        {
          id: "current",
          title: turns.length === 0 ? "New conversation" : "Current session",
          when: turns.length === 0 ? "now" : minutes === 0 ? "now" : `${minutes}m`,
          meta:
            turns.length === 0
              ? "no messages yet"
              : `${userTurns} prompts · ${agentTurns} replies`,
          tag: agentOnline ? "live" : null,
          active: true,
          pinned: false,
        },
      ];
    }
    if (!q) return items;
    return items.filter((it) =>
      [it.title, it.meta].join(" ").toLowerCase().includes(q),
    );
  }, [
    search,
    threads,
    activeThreadId,
    persistAuthed,
    turns.length,
    userTurns,
    agentTurns,
    agentOnline,
    minutes,
  ]);

  // Sidebar callbacks — pick an existing thread or create a fresh one.
  // Both no-op when not authenticated (the sidebar still renders one row
  // mirroring the local-only session in that mode).
  const handlePickThread = useCallback(
    (id: string) => {
      if (id === "current") return;
      if (id === activeThreadId) return;
      void loadThread(id);
    },
    [activeThreadId, loadThread],
  );
  const handleNewThread = useCallback(() => {
    if (!persistAuthed) {
      setTurns([]);
      return;
    }
    void createThread(null);
  }, [persistAuthed, createThread]);

  // Per-row delete. Confirms inline so an accidental click on a dense
  // thread list can't wipe a saved conversation. When the active thread
  // is deleted we either jump to the next remaining thread or create a
  // fresh empty one — never leave the chat with a dangling activeThreadId.
  const handleDeleteThread = useCallback(
    async (id: string) => {
      if (!persistAuthed) return;
      if (typeof window !== "undefined" && !window.confirm("Delete this conversation? This cannot be undone.")) {
        return;
      }
      try {
        const res = await fetch(`/api/chat/threads/${id}`, { method: "DELETE" });
        if (!res.ok && res.status !== 404) return;
      } catch {
        return;
      }
      const list = await refreshThreads();
      if (id === activeThreadId) {
        const next = (list ?? []).find((t) => t.id !== id);
        if (next) {
          await loadThread(next.id);
        } else {
          await createThread(null);
        }
      }
    },
    [persistAuthed, activeThreadId, refreshThreads, loadThread, createThread],
  );

  // Pin / unpin. Pinned threads sort to the top of the sidebar. The server
  // PATCH returns the updated row but we just refresh the whole list so the
  // sort order is consistent with what the GET endpoint returns.
  const handlePinThread = useCallback(
    async (id: string, pinned: boolean) => {
      if (!persistAuthed) return;
      try {
        await fetch(`/api/chat/threads/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ pinned }),
        });
      } catch {
        return;
      }
      await refreshThreads();
    },
    [persistAuthed, refreshThreads],
  );

  // Rename via PATCH /title. window.prompt is intentionally lo-fi — a real
  // inline editor is a follow-up. Title null/empty resets to the auto-
  // generated "New conversation" placeholder.
  const handleRenameThread = useCallback(
    async (id: string, currentTitle: string) => {
      if (!persistAuthed) return;
      if (typeof window === "undefined") return;
      const next = window.prompt("Rename conversation:", currentTitle);
      if (next === null) return;
      const trimmed = next.trim();
      try {
        await fetch(`/api/chat/threads/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: trimmed || null }),
        });
      } catch {
        return;
      }
      await refreshThreads();
    },
    [persistAuthed, refreshThreads],
  );

  // Archive hides the thread from the default list (the GET endpoint filters
  // archived=false unless the caller asks otherwise). Archived threads still
  // exist on the server and can be unarchived later via a future surface.
  // When archiving the active thread we move to the next visible thread or
  // open a fresh empty one, mirroring the delete flow.
  const handleArchiveThread = useCallback(
    async (id: string) => {
      if (!persistAuthed) return;
      try {
        await fetch(`/api/chat/threads/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ archived: true }),
        });
      } catch {
        return;
      }
      const list = await refreshThreads();
      if (id === activeThreadId) {
        const next = (list ?? []).find((t) => t.id !== id);
        if (next) {
          await loadThread(next.id);
        } else {
          await createThread(null);
        }
      }
    },
    [persistAuthed, activeThreadId, refreshThreads, loadThread, createThread],
  );

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
    const userTurn: Turn = {
      role: "user",
      content: value,
      ts: new Date().toISOString(),
    };
    const next: Turn[] = [...turns, userTurn];
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
      const agentTurn: Turn = {
        ...reply,
        role: "agent",
        ts: reply.ts ?? new Date().toISOString(),
      };
      setTurns([...next, agentTurn]);
      if (reply.billing) {
        setBilling(reply.billing);
      } else {
        // Server didn't echo billing (older route, error mid-stream). Pull
        // a fresh snapshot so the panel doesn't drift out of sync.
        refreshBilling();
      }
      // Persist BOTH turns to the server *after* a successful chat round
      // trip. Saving user-then-agent in order means if the network drops
      // mid-pair, the user message still lands and the agent message can
      // be re-derived from `/api/chat` history rather than ending up with
      // an orphan reply with no question.
      await persistMessage(userTurn);
      await persistMessage(agentTurn);
      // Bypass the 10s/30s poll intervals so the sidebar's last-activity
      // timestamp and any concurrent device updates land immediately.
      // Hooks dedup against in-flight requests so this is safe.
      void threadsPoll.refetch();
      void messagesPoll.refetch();
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

  // "Clear" no longer wipes localStorage — it deletes the active thread on
  // the server (cascade drops messages) and opens a fresh empty thread.
  // For unauthenticated users, we just zero the in-memory turns.
  async function clearHistory() {
    if (!persistAuthed) {
      setTurns([]);
      return;
    }
    if (activeThreadId) {
      try {
        await fetch(`/api/chat/threads/${activeThreadId}`, { method: "DELETE" });
      } catch {
        /* swallow — fall through to creating a new thread anyway */
      }
    }
    await createThread(null);
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
        onNew={handleNewThread}
        onPick={handlePickThread}
        onDelete={handleDeleteThread}
        onPin={handlePinThread}
        onRename={handleRenameThread}
        onArchive={handleArchiveThread}
        legacyChatPending={!!legacyTurns}
        legacyCount={legacyTurns?.length ?? 0}
        onImportLegacy={importLegacyChat}
        onDiscardLegacy={discardLegacyChat}
        migrating={migratingChat}
        persistAuthed={persistAuthed}
        toolsHealth={toolsHealth}
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
          syncLabel={
            persistAuthed
              ? formatSyncLabel(messagesPoll.lastFetchedAt, messagesPoll.loading)
              : null
          }
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
        toolsHealth={toolsHealth}
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
  pinned: boolean;
};

function LeftSidebar({
  search,
  setSearch,
  items,
  onNew,
  onPick,
  onDelete,
  onPin,
  onRename,
  onArchive,
  legacyChatPending,
  legacyCount,
  onImportLegacy,
  onDiscardLegacy,
  migrating,
  persistAuthed,
  toolsHealth,
}: {
  search: string;
  setSearch: (v: string) => void;
  items: ConvItem[];
  onNew: () => void;
  onPick: (id: string) => void;
  onDelete: (id: string) => void;
  onPin: (id: string, pinned: boolean) => void;
  onRename: (id: string, currentTitle: string) => void;
  onArchive: (id: string) => void;
  legacyChatPending: boolean;
  legacyCount: number;
  onImportLegacy: () => void;
  onDiscardLegacy: () => void;
  migrating: boolean;
  persistAuthed: boolean;
  toolsHealth: ToolHealth | null;
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
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            padding: "5px 10px",
            fontSize: 11,
            fontWeight: 600,
            color: PAL.bg,
            background: PAL.emerald,
            border: `1px solid ${PAL.emerald}`,
            borderRadius: 6,
            cursor: "pointer",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.filter = "brightness(1.08)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.filter = "none";
          }}
          title="Start a new conversation"
        >
          <svg width={11} height={11} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
            <path d="M8 3v10M3 8h10" />
          </svg>
          New chat
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
        {/* Legacy localStorage migration prompt — only renders when we
            detect old `hype.chat.v1` data and the user hasn't yet
            decided. Kept in the sidebar so it's visible alongside the
            thread list, not floating on top of the chat. */}
        {legacyChatPending && (
          <div
            style={{
              margin: "0 4px 12px",
              padding: "10px 11px",
              background: PAL.bg3,
              border: `1px solid ${PAL.line2}`,
              borderRadius: 7,
            }}
          >
            <div style={{ fontSize: 11.5, fontWeight: 600, color: PAL.text, marginBottom: 3 }}>
              {legacyCount} local message{legacyCount === 1 ? "" : "s"} found
            </div>
            <div
              style={{
                fontFamily: MONO,
                fontSize: 9.5,
                color: PAL.dim,
                lineHeight: 1.4,
                marginBottom: 8,
              }}
            >
              {persistAuthed
                ? "import them into a new thread on your account"
                : "sign in to import — or discard"}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                type="button"
                onClick={onImportLegacy}
                disabled={migrating || !persistAuthed}
                style={{
                  flex: 1,
                  padding: "5px 8px",
                  fontSize: 11,
                  fontWeight: 600,
                  background: persistAuthed ? PAL.emerald : PAL.bg4,
                  color: persistAuthed ? PAL.bg : PAL.faint,
                  border: `1px solid ${persistAuthed ? PAL.emerald : PAL.line2}`,
                  borderRadius: 5,
                  cursor: persistAuthed && !migrating ? "pointer" : "not-allowed",
                }}
              >
                {migrating ? "Importing…" : "Import"}
              </button>
              <button
                type="button"
                onClick={onDiscardLegacy}
                disabled={migrating}
                style={{
                  padding: "5px 8px",
                  fontSize: 11,
                  fontWeight: 500,
                  background: "transparent",
                  color: PAL.dim,
                  border: `1px solid ${PAL.line2}`,
                  borderRadius: 5,
                  cursor: migrating ? "not-allowed" : "pointer",
                }}
              >
                Discard
              </button>
            </div>
          </div>
        )}
        <GroupLabel>{persistAuthed ? "Threads" : "Today"}</GroupLabel>
        {items.map((it) => {
          const canManage = persistAuthed && it.id !== "current";
          return (
            <ConvRow
              key={it.id}
              item={it}
              onClick={() => onPick(it.id)}
              actions={
                canManage
                  ? {
                      onPin: () => onPin(it.id, !it.pinned),
                      onRename: () => onRename(it.id, it.title),
                      onArchive: () => onArchive(it.id),
                      onDelete: () => onDelete(it.id),
                    }
                  : null
              }
            />
          );
        })}
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
          <span style={{ color: PAL.emerald }}>●</span> {MCP_TOOLS.length} tools ·{" "}
          {toolsHealth ? toolsHealth.summary.ok : 0} live
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

type ConvRowActions = {
  onPin: () => void;
  onRename: () => void;
  onArchive: () => void;
  onDelete: () => void;
};

function ConvRow({
  item,
  onClick,
  actions,
}: {
  item: ConvItem;
  onClick?: () => void;
  actions?: ConvRowActions | null;
}) {
  const [hover, setHover] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Close the menu on outside click / Escape so the dropdown doesn't get
  // stuck open when the user moves on. Listening on document means we don't
  // have to thread an open-state up to the sidebar level.
  useEffect(() => {
    if (!menuOpen) return;
    function onDocClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      role={onClick ? "button" : undefined}
      style={{
        position: "relative",
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
          gap: 6,
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            fontSize: 12.5,
            fontWeight: item.active ? 600 : 500,
            color: PAL.text,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
          }}
        >
          {item.pinned && (
            <svg
              width={11}
              height={11}
              viewBox="0 0 16 16"
              fill={PAL.amber}
              stroke={PAL.amber}
              strokeWidth={1.2}
              strokeLinejoin="round"
              style={{ flexShrink: 0 }}
              aria-label="pinned"
            >
              <path d="M9.5 2L14 6.5l-3 1L8 10.5 6.5 12 4 9.5 5.5 8l3-3 1-3z" />
              <path d="M6.5 9.5L3 13" stroke={PAL.amber} strokeWidth={1.4} fill="none" strokeLinecap="round" />
            </svg>
          )}
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {item.title}
          </span>
        </span>
        {actions && (hover || menuOpen) ? (
          <div ref={menuRef} style={{ position: "relative", flexShrink: 0 }}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen((v) => !v);
              }}
              title="More actions"
              aria-label="More actions"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 22,
                height: 22,
                padding: 0,
                border: `1px solid ${menuOpen ? PAL.line2 : "transparent"}`,
                borderRadius: 5,
                background: menuOpen ? PAL.bg4 : "transparent",
                color: PAL.dim,
                cursor: "pointer",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = PAL.bg4;
                e.currentTarget.style.color = PAL.text;
              }}
              onMouseLeave={(e) => {
                if (!menuOpen) {
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.color = PAL.dim;
                }
              }}
            >
              <svg width={14} height={14} viewBox="0 0 16 16" fill="currentColor">
                <circle cx="3" cy="8" r="1.4" />
                <circle cx="8" cy="8" r="1.4" />
                <circle cx="13" cy="8" r="1.4" />
              </svg>
            </button>
            {menuOpen && (
              <ConvRowMenu
                pinned={item.pinned}
                onPin={() => {
                  setMenuOpen(false);
                  actions.onPin();
                }}
                onRename={() => {
                  setMenuOpen(false);
                  actions.onRename();
                }}
                onArchive={() => {
                  setMenuOpen(false);
                  actions.onArchive();
                }}
                onDelete={() => {
                  setMenuOpen(false);
                  actions.onDelete();
                }}
              />
            )}
          </div>
        ) : (
          <span style={{ fontFamily: MONO, fontSize: 9.5, color: PAL.faint, flexShrink: 0 }}>
            {item.when}
          </span>
        )}
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

function ConvRowMenu({
  pinned,
  onPin,
  onRename,
  onArchive,
  onDelete,
}: {
  pinned: boolean;
  onPin: () => void;
  onRename: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      role="menu"
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        right: 0,
        top: "calc(100% + 4px)",
        minWidth: 168,
        padding: 4,
        background: PAL.bg2,
        border: `1px solid ${PAL.line2}`,
        borderRadius: 7,
        boxShadow: "0 10px 24px rgba(0,0,0,0.45)",
        zIndex: 50,
      }}
    >
      <ConvRowMenuItem
        label={pinned ? "Lepas sematan" : "Sematkan"}
        onClick={onPin}
        icon={
          <svg width={12} height={12} viewBox="0 0 16 16" fill={pinned ? PAL.amber : "none"} stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round">
            <path d="M9.5 2L14 6.5l-3 1L8 10.5 6.5 12 4 9.5 5.5 8l3-3 1-3z" />
            <path d="M6.5 9.5L3 13" strokeLinecap="round" />
          </svg>
        }
      />
      <ConvRowMenuItem
        label="Ganti nama"
        onClick={onRename}
        icon={
          <svg width={12} height={12} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 2l3 3-9 9H2v-3z" />
            <path d="M9 4l3 3" />
          </svg>
        }
      />
      <ConvRowMenuItem
        label="Arsipkan"
        onClick={onArchive}
        icon={
          <svg width={12} height={12} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="3" width="12" height="3" rx="1" />
            <path d="M3 6v7h10V6" />
            <path d="M6 9h4" />
          </svg>
        }
      />
      <div style={{ height: 1, background: PAL.line, margin: "4px 0" }} />
      <ConvRowMenuItem
        label="Hapus"
        onClick={onDelete}
        danger
        icon={
          <svg width={12} height={12} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 4h10M6.5 4V2.5h3V4M5 4l.6 9.5h4.8L11 4M7 7v4M9 7v4" />
          </svg>
        }
      />
    </div>
  );
}

function ConvRowMenuItem({
  label,
  onClick,
  icon,
  danger,
}: {
  label: string;
  onClick: () => void;
  icon: ReactNode;
  danger?: boolean;
}) {
  const baseColor = danger ? PAL.red : PAL.text;
  return (
    <button
      type="button"
      role="menuitem"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        width: "100%",
        padding: "7px 9px",
        fontSize: 12,
        textAlign: "left",
        background: "transparent",
        color: baseColor,
        border: "none",
        borderRadius: 5,
        cursor: "pointer",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = danger
          ? "rgba(239,68,68,0.08)"
          : PAL.bg3;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      <span style={{ display: "inline-flex", color: baseColor }}>{icon}</span>
      <span>{label}</span>
    </button>
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
  syncLabel,
}: {
  threadId: number | string;
  turns: number;
  minutes: number;
  model: string;
  agentOnline: boolean;
  currentNode: string | null;
  onClear: () => void;
  /** Multi-device sync freshness label, or null when persistence is off. */
  syncLabel: string | null;
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
          {syncLabel && (
            <>
              <Sep />
              <span>{syncLabel}</span>
            </>
          )}
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
            gap: 10,
            color: PAL.dim,
            fontFamily: MONO,
            fontSize: 11,
          }}
        >
          <LogoSplash inline size={20} />
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
          {/* If any tool result is a prepared SoDEX trade awaiting browser
              signature, render an approve card. Browser-signed flow keeps
              the user's private key in their wallet. */}
          {tools
            .map((t) => extractTradeApproval(t))
            .filter((p): p is TradeApprovalProps => p !== null)
            .map((props, i) => (
              <TradeApprovalCard key={`approval-${i}`} {...props} />
            ))}
          <AgentMarkdown content={turn.content} />
        </>
      )}
    </div>
  );
}

type TradeApprovalProps = {
  product: "spot" | "perps" | "transfer";
  summary: {
    // common
    signer_address: string;
    // trade-only
    pair?: string;
    side?: string;
    type?: string;
    mode?: string;
    limit_price?: string;
    quantity?: string;
    external_url?: string;
    // spot-only
    symbol_in?: string;
    symbol_out?: string;
    amount_in?: number;
    last_price?: string;
    notional?: number;
    estimated_fee?: number;
    // perps-only
    mark_price?: string;
    leverage?: number;
    reduce_only?: boolean;
    // transfer-only
    action?: string;
    from_account?: string;
    to_account?: string;
    coin?: string;
    amount?: string;
    from_account_id?: number;
    to_account_id?: number;
    experimental_note?: string;
  };
  typed_data: Record<string, unknown>;
  submit_payload: Record<string, unknown>;
};

function extractTradeApproval(t: ToolCallTrace): TradeApprovalProps | null {
  if (
    t.name !== "sodex_execute_trade" &&
    t.name !== "sodex_sell_trade" &&
    t.name !== "sodex_perps_trade" &&
    t.name !== "sodex_transfer"
  ) {
    return null;
  }
  const r = t.output_raw as Record<string, unknown> | null | undefined;
  if (!r || typeof r !== "object") return null;
  if (!r.ready_to_sign || !r.typed_data || !r.submit_payload || !r.summary) {
    return null;
  }
  const product: TradeApprovalProps["product"] =
    t.name === "sodex_perps_trade"
      ? "perps"
      : t.name === "sodex_transfer"
        ? "transfer"
        : "spot";
  return {
    product,
    summary: r.summary as TradeApprovalProps["summary"],
    typed_data: r.typed_data as Record<string, unknown>,
    submit_payload: r.submit_payload as Record<string, unknown>,
  };
}

function TradeApprovalCard({ product, summary, typed_data, submit_payload }: TradeApprovalProps) {
  const { signTypedDataAsync } = useSignTypedData();
  const { switchChainAsync } = useSwitchChain();
  const { chainId: activeChainId, isConnected } = useAccount();
  const [status, setStatus] = useState<
    "idle" | "switching" | "signing" | "submitting" | "done" | "error"
  >("idle");
  const [orderId, setOrderId] = useState<string | number | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  // Pre-submit failures (wallet not connected, user rejected sign, chain switch
  // refused) happen BEFORE SoDEX sees anything — nonce is intact, user can just
  // click Approve again. Post-submit failures (HTTP error to /sodex/submit, or
  // SoDEX rejecting the envelope) consumed the nonce → user must re-prompt for
  // a fresh envelope. Lumping them together (the old behaviour) was misleading.
  const [failStage, setFailStage] = useState<"presubmit" | "submit" | null>(null);

  // Domain chainId from the prepared typed-data — sign must happen on the same
  // chain or wagmi/viem aborts with "chainId must match the active chainId".
  const domain = (typed_data as { domain?: { chainId?: number | string } }).domain;
  const requiredChainId =
    typeof domain?.chainId === "string" ? Number(domain.chainId) : domain?.chainId;

  async function approve() {
    if (status === "switching" || status === "signing" || status === "submitting") return;
    setErrMsg(null);
    setFailStage(null);
    let stage: "presubmit" | "submit" = "presubmit";
    try {
      // Pre-flight: wagmi connector must be live for signTypedDataAsync. A
      // page refresh after SIWE login, or a wallet auto-locking, drops the
      // wagmi connector while the SIWE cookie is still valid — leaving the
      // user with a confusing "Connector not connected" error mid-sign.
      if (!isConnected) {
        setErrMsg(
          "Wallet disconnected. Reconnect via the top-right wallet button, then click Approve & sign.",
        );
        setFailStage("presubmit");
        setStatus("error");
        return;
      }
      // Switch wallet to the chain the typed-data is bound to (ValueChain
      // testnet 138565 for SoDEX). User may be on Sepolia for the SSI
      // registry — wagmi/MetaMask will prompt add-chain if missing.
      if (requiredChainId && activeChainId !== requiredChainId) {
        setStatus("switching");
        await switchChainAsync({ chainId: requiredChainId });
      }
      setStatus("signing");
      // wagmi v2 signTypedData needs args narrowed by `as` because typed_data
      // came over the wire as a generic Record. The shape matches EIP-712.
      const td = typed_data as {
        types: Record<string, { name: string; type: string }[]>;
        domain: Record<string, unknown>;
        primaryType: string;
        message: Record<string, unknown>;
      };
      // wagmi v2's generics infer from a typed const; passing a runtime
      // object requires a wide cast. Validation already happened on the
      // server (typed_data was built from a known-good template).
      const sig = (await signTypedDataAsync({
        types: td.types,
        domain: td.domain,
        primaryType: td.primaryType,
        message: td.message,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)) as string;

      // Crossing into submit territory — any failure from here on burns the
      // nonce on SoDEX's side.
      stage = "submit";
      setStatus("submitting");
      const res = await fetch("/api/sodex/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ submit_payload, signature: sig }),
      });
      const data = (await res.json()) as { ok?: boolean; order_id?: string | number; error?: string };
      if (!res.ok || data.ok === false) {
        setErrMsg(data.error ?? `submit failed (HTTP ${res.status})`);
        setFailStage("submit");
        setStatus("error");
        return;
      }
      setOrderId(data.order_id ?? null);
      setStatus("done");
    } catch (e) {
      const msg = (e as Error)?.message ?? "sign failed";
      setErrMsg(msg.length > 200 ? msg.slice(0, 200) + "…" : msg);
      setFailStage(stage);
      setStatus("error");
    }
  }

  const accent = status === "done" ? PAL.emerald : status === "error" ? PAL.red : PAL.amber;

  return (
    <div
      style={{
        marginTop: 8,
        marginBottom: 8,
        background: PAL.bg2,
        border: `1px solid ${accent}66`,
        borderRadius: 10,
        padding: 14,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: accent,
            boxShadow: `0 0 6px ${accent}`,
          }}
        />
        <span
          style={{
            fontFamily: MONO,
            fontSize: 10,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: accent,
            fontWeight: 600,
          }}
        >
          {status === "done"
            ? product === "transfer"
              ? "TRANSFER SUBMITTED"
              : "ORDER SUBMITTED"
            : status === "error"
            ? "APPROVAL FAILED"
            : "AWAITING WALLET APPROVAL"}
        </span>
      </div>

      {(() => {
        if (product === "transfer") {
          return (
            <>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "4px 16px",
                  fontSize: 12.5,
                }}
              >
                <Row label="Action" value="Transfer" />
                <Row
                  label="Direction"
                  value={`${summary.from_account ?? "?"} → ${summary.to_account ?? "?"}`}
                />
                <Row label="Coin" value={summary.coin ?? "—"} />
                <Row label="Amount" value={summary.amount ?? "—"} />
                {summary.from_account_id !== undefined && (
                  <Row label="From aid" value={String(summary.from_account_id)} />
                )}
                {summary.to_account_id !== undefined && (
                  <Row label="To aid" value={String(summary.to_account_id)} />
                )}
                <Row label="Signer" value={shortAddr(summary.signer_address)} />
              </div>
              {summary.experimental_note && (
                <div
                  style={{
                    marginTop: 10,
                    padding: "8px 10px",
                    background: `${PAL.amber}1A`,
                    border: `1px solid ${PAL.amber}66`,
                    borderRadius: 6,
                    fontFamily: MONO,
                    fontSize: 11,
                    color: PAL.amber,
                    lineHeight: 1.45,
                  }}
                >
                  ⚠ {summary.experimental_note}
                </div>
              )}
            </>
          );
        }
        // Spot quantity is in the base asset (whichever side isn't USDC).
        // Perps quantity is always in the base asset of the contract (e.g. SOL).
        const pair = summary.pair ?? "";
        const baseSym =
          product === "perps"
            ? pair.replace(/-USD$/, "")
            : summary.symbol_in === "USDC"
              ? summary.symbol_out
              : summary.symbol_in;
        return (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "4px 16px",
              fontSize: 12.5,
            }}
          >
            <Row label="Pair" value={`${pair}${product === "perps" ? " (perps)" : ""}`} />
            <Row
              label="Side"
              value={`${summary.side ?? ""} (${summary.mode ?? ""})${
                product === "perps" && summary.reduce_only ? " · reduce-only" : ""
              }`}
            />
            <Row label="Quantity" value={`${summary.quantity ?? ""} ${baseSym ?? ""}`.trim()} />
            <Row label="Limit price" value={`$${summary.limit_price ?? "—"}`} />
            {product === "perps" ? (
              <>
                <Row label="Mark price" value={`$${summary.mark_price ?? "—"}`} />
                <Row label="Leverage" value={`${summary.leverage ?? 1}x`} />
                {summary.estimated_fee !== undefined && (
                  <Row label="Est. fee" value={`$${summary.estimated_fee.toFixed(4)}`} />
                )}
              </>
            ) : (
              <>
                <Row label="Notional" value={`$${(summary.notional ?? 0).toFixed(2)} USDC`} />
                <Row label="Last price" value={`$${summary.last_price ?? "—"}`} />
                <Row label="Est. fee" value={`$${(summary.estimated_fee ?? 0).toFixed(4)}`} />
              </>
            )}
            <Row label="Signer" value={shortAddr(summary.signer_address)} />
          </div>
        );
      })()}

      {status === "done" && (orderId !== null || product === "transfer") && (
        <div
          style={{
            marginTop: 10,
            padding: "8px 10px",
            background: `${PAL.emerald}1A`,
            border: `1px solid ${PAL.emerald}66`,
            borderRadius: 6,
            fontFamily: MONO,
            fontSize: 11.5,
            color: PAL.emerald,
          }}
        >
          {product === "transfer" ? (
            <>
              ✓ Transfer submitted — funds should appear on the {summary.to_account}{" "}
              side within 1–2 blocks (~5s).
            </>
          ) : (
            <>
              ✓ Order #{orderId} submitted ·{" "}
              <a href={summary.external_url} target="_blank" rel="noopener noreferrer" style={{ color: PAL.emerald, textDecoration: "underline" }}>
                view on SoDEX testnet ↗
              </a>
            </>
          )}
        </div>
      )}

      {status === "error" && errMsg && (
        <div
          style={{
            marginTop: 10,
            padding: "8px 10px",
            background: `${PAL.red}1A`,
            border: `1px solid ${PAL.red}66`,
            borderRadius: 6,
            fontFamily: MONO,
            fontSize: 11.5,
            color: PAL.red,
            wordBreak: "break-word",
          }}
        >
          {errMsg}
          {failStage === "submit" ? (
            // SoDEX consumes the nonce server-side on the first submit (whether
            // the inner order accepts or rejects). Retrying with the same
            // envelope ALWAYS fails with "nonce already used". Fix: re-prompt
            // the agent for a fresh signed envelope.
            <div style={{ marginTop: 8, color: PAL.dim, fontFamily: "inherit", fontSize: 11.5 }}>
              This envelope is single-use — SoDEX consumed the nonce.{" "}
              <strong style={{ color: PAL.text }}>
                Re-send your prompt to the agent (e.g. type the same instruction
                again) to get a fresh envelope.
              </strong>
            </div>
          ) : (
            // Pre-submit error: signature wasn't produced or chain wasn't switched
            // → SoDEX never saw the envelope, so the nonce is still valid. Most
            // common cause: wallet got disconnected (wagmi "Connector not
            // connected"), user rejected the sign prompt, or chain switch failed.
            <div style={{ marginTop: 8, color: PAL.dim, fontFamily: "inherit", fontSize: 11.5 }}>
              The envelope was{" "}
              <strong style={{ color: PAL.text }}>not submitted</strong> — nonce
              is still valid.{" "}
              {/Connector not connected/i.test(errMsg) ? (
                <>
                  Reconnect your wallet (top-right) and click{" "}
                  <strong style={{ color: PAL.text }}>Approve & sign</strong> below
                  to retry.
                </>
              ) : (
                <>
                  Click{" "}
                  <strong style={{ color: PAL.text }}>Approve & sign</strong> again
                  to retry with the same envelope.
                </>
              )}
            </div>
          )}
        </div>
      )}

      {(status !== "done" && (status !== "error" || failStage === "presubmit")) && (
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button
            type="button"
            onClick={approve}
            disabled={
              status === "switching" || status === "signing" || status === "submitting"
            }
            style={{
              flex: 1,
              padding: "9px 14px",
              background: PAL.emerald,
              border: `1px solid ${PAL.emerald}`,
              borderRadius: 6,
              color: PAL.bg,
              fontFamily: "inherit",
              fontSize: 13,
              fontWeight: 600,
              cursor:
                status === "switching" || status === "signing" || status === "submitting"
                  ? "wait"
                  : "pointer",
            }}
          >
            {status === "switching"
              ? `Switching to chain ${requiredChainId}…`
              : status === "signing"
              ? "Signing in wallet…"
              : status === "submitting"
              ? "Submitting to SoDEX…"
              : "Approve & sign in wallet"}
          </button>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
      <span style={{ fontFamily: MONO, fontSize: 10, color: PAL.faint, letterSpacing: "0.06em" }}>
        {label}
      </span>
      <span style={{ color: PAL.text, fontWeight: 500 }}>{value}</span>
    </div>
  );
}

function shortAddr(a: string): string {
  if (!a) return "—";
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
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
      {isUser ? (
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
            background: `linear-gradient(135deg, ${PAL.violet}, ${PAL.cyan})`,
          }}
        >
          Y
        </span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src="/logo-hypenode.png"
          alt="HypeNode"
          width={18}
          height={18}
          style={{ display: "block", borderRadius: "50%", objectFit: "cover" }}
        />
      )}
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
          data-chat-composer
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
        {/* Dim the placeholder so the example prompts don't compete with what
            the user is typing. Inline ::placeholder rule scoped to this
            textarea via the data attribute. */}
        <style>{`
          [data-chat-composer]::placeholder {
            color: ${PAL.line3};
            opacity: 1;
          }
          [data-chat-composer]:focus::placeholder {
            color: ${PAL.line2};
          }
        `}</style>
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
  toolsHealth,
}: {
  agentOnline: boolean;
  uptime: number;
  decisions: number;
  toolCalls: number;
  currentNode: string | null;
  model: string;
  billing: BillingSnapshot | null;
  onTopUp: () => void;
  toolsHealth: ToolHealth | null;
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
      <McpToolsPanel toolsHealth={toolsHealth} />
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

function McpToolsPanel({ toolsHealth }: { toolsHealth: ToolHealth | null }) {
  const okCount = toolsHealth?.summary.ok ?? 0;
  return (
    <PanelShell
      title="MCP tools available"
      right={
        <span style={{ fontFamily: MONO, fontSize: 10, color: PAL.faint }}>
          {okCount} of {MCP_TOOLS.length} live
        </span>
      }
    >
      {MCP_TOOLS.map((t) => {
        const h = toolsHealth?.tools[t.name];
        return (
          <ToolItem
            key={t.name}
            tool={t}
            status={h?.status ?? "unknown"}
            reason={h?.reason ?? null}
          />
        );
      })}
    </PanelShell>
  );
}

function ToolItem({
  tool,
  status,
  reason,
}: {
  tool: { name: string; desc: string; kind: ToolKind };
  status: ToolStatus;
  reason: string | null;
}) {
  const palette: Record<ToolKind, { bg: string; color: string; letter: string }> = {
    term: { bg: "rgba(34,211,238,0.1)", color: PAL.cyan, letter: "T" },
    bk: { bg: "rgba(167,139,250,0.1)", color: PAL.violet, letter: "B" },
    ssi: { bg: "rgba(16,185,129,0.1)", color: PAL.emerald, letter: "S" },
    dex: { bg: "rgba(245,158,11,0.1)", color: PAL.amber, letter: "D" },
    risk: { bg: "rgba(239,68,68,0.1)", color: PAL.red, letter: "R" },
    fund: { bg: "rgba(244,63,94,0.1)", color: PAL.rose, letter: "F" },
    rd: { bg: "rgba(167,139,250,0.1)", color: PAL.violet, letter: "★" },
  };
  const p = palette[tool.kind];
  const dot =
    status === "ok"
      ? { color: PAL.emerald, glow: true }
      : status === "degraded"
      ? { color: PAL.amber, glow: true }
      : status === "missing_config"
      ? { color: PAL.red, glow: false }
      : { color: PAL.line3, glow: false };
  const tooltip =
    status === "ok"
      ? `${tool.name} · ready`
      : `${tool.name} · ${status}${reason ? ` — ${reason}` : ""}`;
  return (
    <div
      title={tooltip}
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
          background: dot.color,
          boxShadow: dot.glow ? `0 0 6px ${dot.color}` : undefined,
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
