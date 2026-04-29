"use client";

import { useEffect, useRef, useState } from "react";
import { Btn } from "@/components/ui/Btn";
import { Mono } from "@/components/ui/Mono";
import { Tag } from "@/components/ui/Tag";
import { tokens } from "@/lib/tokens";

type Turn = { role: "user" | "agent"; content: string; ts?: string };

const SUGGESTIONS = [
  "Which SSI sector is hottest this week?",
  "Compare ssiDePIN vs ssiAI 90d return",
  "What's the volatility on ssiRWA?",
  "Build a basket from top sector",
];

const STORAGE_KEY = "hype.chat.v1";

export function ChatComposer({
  onTurnsChange,
}: {
  onTurnsChange?: (turns: Turn[]) => void;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const transcriptRef = useRef<HTMLDivElement>(null);

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
    onTurnsChange?.(turns);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(turns));
    } catch {
      /* quota or private mode */
    }
    // Auto-scroll transcript to bottom on new turn.
    transcriptRef.current?.scrollTo({
      top: transcriptRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [turns, onTurnsChange]);

  async function send(text?: string) {
    const value = (text ?? input).trim();
    if (!value || busy) return;
    const next: Turn[] = [
      ...turns,
      { role: "user", content: value, ts: new Date().toISOString() },
    ];
    setTurns(next);
    setInput("");
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
        {
          ...reply,
          role: "agent",
          ts: reply.ts ?? new Date().toISOString(),
        },
      ]);
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

  function reset() {
    setTurns([]);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* noop */
    }
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div ref={transcriptRef} className="flex-1 overflow-y-auto" style={{ padding: 20 }}>
        {turns.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center text-center"
            style={{ height: "100%", gap: 12, padding: "40px 20px" }}
          >
            <div
              className="flex items-center justify-center"
              style={{
                width: 44,
                height: 44,
                borderRadius: 10,
                background: `linear-gradient(135deg, ${tokens.emerald}, ${tokens.emeraldDim})`,
                boxShadow: `0 0 24px ${tokens.emerald}40`,
              }}
            >
              <svg width={22} height={22} viewBox="0 0 12 12">
                <path
                  d="M 2 9 L 4 5 L 7 8 L 10 3"
                  fill="none"
                  stroke={tokens.bg}
                  strokeWidth={1.6}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <div style={{ fontSize: 16, fontWeight: 600, color: tokens.text }}>
              Chat with the HypeNode agent
            </div>
            <Mono size={11} color={tokens.textDim} style={{ maxWidth: 420 }}>
              Ask anything about SoSoValue sectors, SSI indices, or your basket.
              The agent uses live SoSoValue data + MCP tools to answer.
            </Mono>
          </div>
        ) : (
          <div className="flex flex-col gap-3.5">
            {turns.map((t, i) => (
              <div
                key={i}
                style={{
                  alignSelf: t.role === "user" ? "flex-end" : "flex-start",
                  maxWidth: "80%",
                }}
              >
                <div
                  style={{
                    padding: "10px 14px",
                    background: t.role === "user" ? tokens.cyan + "12" : tokens.bgElev,
                    border: `1px solid ${t.role === "user" ? tokens.cyan + "30" : tokens.border}`,
                    borderRadius: 10,
                    color: tokens.text,
                    fontSize: 13.5,
                    lineHeight: 1.55,
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {t.content}
                </div>
                <Mono
                  size={9}
                  className="mt-1 block"
                  style={{ textAlign: t.role === "user" ? "right" : "left" }}
                >
                  {t.role} ·{" "}
                  {t.ts ? new Date(t.ts).toISOString().slice(11, 16) : "now"}
                </Mono>
              </div>
            ))}
            {busy && (
              <div style={{ alignSelf: "flex-start" }}>
                <Tag small color={tokens.cyan} dot>
                  agent thinking…
                </Tag>
              </div>
            )}
          </div>
        )}
      </div>

      <div style={{ padding: 14, borderTop: `1px solid ${tokens.border}` }}>
        <div
          className="flex items-center gap-2.5"
          style={{
            padding: "10px 14px",
            background: tokens.bgElev,
            border: `1px solid ${tokens.borderStrong}`,
            borderRadius: 10,
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder='Ask the agent — "which SSI sector is hot?" · "compare ssiAI vs BTC"'
            className="flex-1 bg-transparent outline-none"
            style={{ fontSize: 13, color: tokens.text }}
          />
          {turns.length > 0 && (
            <Btn small onClick={reset}>
              Clear
            </Btn>
          )}
          <Btn small primary onClick={() => send()} disabled={busy}>
            Send →
          </Btn>
        </div>
        <div className="flex gap-1.5 mt-2 flex-wrap">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => send(s)}
              disabled={busy}
              style={{
                padding: "4px 10px",
                background: tokens.bgElev2,
                border: `1px solid ${tokens.border}`,
                borderRadius: 4,
                fontSize: 11,
                color: busy ? tokens.textFaint : tokens.textDim,
                cursor: busy ? "not-allowed" : "pointer",
              }}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
