"use client";

import { useEffect, useState } from "react";
import { Btn, Mono, Tag } from "@/components/ui";
import { ChatComposer } from "@/components/live/ChatComposer";
import { tokens } from "@/lib/tokens";

type Turn = { role: "user" | "agent"; content: string; ts?: string };

// MCP tools surface from agent-service/src/mcp_server.py (canonical list).
const MCP_TOOLS = [
  "terminal.get_sentiment",
  "terminal.get_fund_flow",
  "terminal.get_news",
  "backtest.run",
  "ssi.wrap",
  "ssi.unwrap",
  "sodex.execute_trade",
  "risk.check_thresholds",
];

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

function fmtUptime(s: number): string {
  if (!s || s <= 0) return "—";
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export default function ChatPage() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [agent, setAgent] = useState<AgentState | null>(null);

  // Live agent state — uptime, model, current LangGraph node — for the
  // session-context panel. Polls every 10s.
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
  const decisions = agent?.decisions24h ?? agent?.decisions_24h ?? 0;
  const toolCalls = agent?.toolCalls ?? agent?.tool_calls ?? 0;
  const currentNode = agent?.currentNode ?? agent?.current_node ?? null;
  const model = agent?.model ?? "claude-sonnet-4-5";
  const agentOnline = uptime > 0;

  return (
    <div
      className="grid h-[calc(100vh-48px)]"
      style={{ gridTemplateColumns: "240px 1fr 280px" }}
    >
      <aside
        className="flex flex-col gap-1.5 overflow-y-auto"
        style={{ padding: 14, borderRight: `1px solid ${tokens.border}` }}
      >
        <div className="flex justify-between items-center mb-2">
          <div style={{ fontSize: 13, fontWeight: 600 }}>Conversations</div>
          <Btn
            small
            onClick={() => {
              try {
                localStorage.removeItem("hype.chat.v1");
              } catch {
                /* noop */
              }
              window.location.reload();
            }}
          >
            + New
          </Btn>
        </div>

        <div
          style={{
            padding: "9px 10px",
            background: tokens.bgElev2,
            border: `1px solid ${tokens.border}`,
            borderRadius: 6,
            cursor: "pointer",
          }}
        >
          <div className="flex justify-between">
            <div style={{ fontSize: 12, fontWeight: 600, color: tokens.text }}>
              Current session
            </div>
            <Mono size={9}>{firstTs ? `${minutes}m` : "now"}</Mono>
          </div>
          <Mono size={10} className="mt-0.5 block">
            {turns.length === 0
              ? "no messages yet"
              : `${userTurns} prompts · ${agentTurns} replies`}
          </Mono>
        </div>

        <div className="flex-1" />
        <div
          style={{
            padding: "10px 12px",
            background: tokens.bgElev,
            border: `1px solid ${tokens.border}`,
            borderRadius: 6,
          }}
        >
          <Mono size={10} color={tokens.cyan}>
            MCP · Model Context Protocol
          </Mono>
          <Mono size={10} className="mt-0.5 block">
            {MCP_TOOLS.length} tools registered
          </Mono>
        </div>
      </aside>

      <section className="flex flex-col overflow-hidden">
        <div
          className="flex justify-between items-center"
          style={{ padding: "14px 20px", borderBottom: `1px solid ${tokens.border}` }}
        >
          <div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>HypeNode agent</div>
            <Mono size={10}>
              {turns.length === 0
                ? `${MCP_TOOLS.length} MCP tools available · model ${model}`
                : `${userTurns} prompts · ${agentTurns} replies · ${minutes}m elapsed`}
            </Mono>
          </div>
          <div className="flex items-center gap-2">
            <Tag small color={agentOnline ? tokens.emerald : tokens.textFaint} dot>
              {agentOnline ? "agent online" : "agent offline"}
            </Tag>
          </div>
        </div>
        <ChatComposer onTurnsChange={setTurns} />
      </section>

      <aside
        className="flex flex-col gap-2.5 overflow-y-auto"
        style={{ padding: 14, borderLeft: `1px solid ${tokens.border}` }}
      >
        <div className="flex justify-between items-center">
          <div style={{ fontSize: 13, fontWeight: 600 }}>MCP tools</div>
          <Tag small color={agentOnline ? tokens.emerald : tokens.textFaint} dot>
            {agentOnline ? "live" : "offline"}
          </Tag>
        </div>
        {MCP_TOOLS.map((t) => (
          <div
            key={t}
            className="flex justify-between items-center"
            style={{
              padding: "7px 10px",
              background: tokens.bgElev,
              border: `1px solid ${tokens.border}`,
              borderRadius: 5,
            }}
          >
            <Mono size={10.5} color={tokens.text}>
              {t}
            </Mono>
            <div
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: agentOnline ? tokens.emerald : tokens.textFaint,
                boxShadow: agentOnline ? `0 0 6px ${tokens.emerald}` : undefined,
              }}
            />
          </div>
        ))}

        <div style={{ height: 1, background: tokens.border, margin: "6px 0" }} />

        <div style={{ fontSize: 12, fontWeight: 600 }}>Agent telemetry</div>
        {[
          ["Uptime", fmtUptime(uptime)],
          ["Model", model],
          ["Decisions (24h)", String(decisions)],
          ["Tool calls", toolCalls.toLocaleString()],
          ["Current node", currentNode ?? "idle"],
        ].map(([k, v]) => (
          <div key={k} className="flex justify-between">
            <Mono size={10}>{k}</Mono>
            <Mono size={10} color={agentOnline ? tokens.text : tokens.textFaint}>
              {v}
            </Mono>
          </div>
        ))}

        <div
          style={{
            padding: "8px 10px",
            background: tokens.bgElev,
            border: `1px solid ${tokens.border}`,
            borderRadius: 5,
            marginTop: 6,
          }}
        >
          <Mono size={9} color={tokens.textFaint}>
            CHAT MEMORY
          </Mono>
          <Mono size={10} className="mt-0.5 block">
            {turns.length} turn{turns.length === 1 ? "" : "s"} · stored in browser
            (localStorage)
          </Mono>
        </div>
      </aside>
    </div>
  );
}
