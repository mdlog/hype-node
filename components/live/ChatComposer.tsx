"use client";

import { useState } from "react";
import { Btn } from "@/components/ui/Btn";
import { Mono } from "@/components/ui/Mono";
import { Tag } from "@/components/ui/Tag";
import { tokens } from "@/lib/tokens";

type Turn = { role: "user" | "agent"; content: string; ts?: string };

const SUGGESTIONS = [
  "Show my risk exposure",
  "Build RWA index",
  "Compare HDP8 to BTC",
  "Why skip at 00:06?",
];

export function ChatComposer() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  async function send() {
    const text = input.trim();
    if (!text) return;
    const next: Turn[] = [...turns, { role: "user", content: text, ts: new Date().toISOString() }];
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
      setTurns([...next, { ...reply, role: "agent" }]);
    } catch (err) {
      setTurns([
        ...next,
        {
          role: "agent",
          content: `Failed to reach agent: ${(err as Error).message}`,
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {turns.length > 0 && (
        <div className="flex flex-col gap-3 mb-3 max-h-[280px] overflow-y-auto">
          {turns.map((t, i) => (
            <div
              key={i}
              style={{ alignSelf: t.role === "user" ? "flex-end" : "flex-start", maxWidth: "80%" }}
            >
              <div
                style={{
                  padding: "10px 14px",
                  background: t.role === "user" ? tokens.cyan + "12" : tokens.bgElev,
                  border: `1px solid ${t.role === "user" ? tokens.cyan + "30" : tokens.border}`,
                  borderRadius: 10,
                  color: tokens.text,
                  fontSize: 13,
                  lineHeight: 1.5,
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
                {t.role} · {t.ts ? new Date(t.ts).toISOString().slice(11, 16) : "now"}
              </Mono>
            </div>
          ))}
          {busy && (
            <Tag small color={tokens.cyan} dot>
              agent thinking…
            </Tag>
          )}
        </div>
      )}
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
          placeholder='Ask anything — "rebalance HDP8" · "simulate 2021 crash" · "why DIMO?"'
          className="flex-1 bg-transparent outline-none"
          style={{ fontSize: 13, color: tokens.text }}
        />
        <Btn small onClick={() => setInput("")}>
          🎙
        </Btn>
        <Btn small primary onClick={send} disabled={busy}>
          Send →
        </Btn>
      </div>
      <div className="flex gap-1.5 mt-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            onClick={() => setInput(s)}
            style={{
              padding: "4px 10px",
              background: tokens.bgElev2,
              border: `1px solid ${tokens.border}`,
              borderRadius: 4,
              fontSize: 11,
              color: tokens.textDim,
              cursor: "pointer",
            }}
          >
            {s}
          </button>
        ))}
      </div>
    </>
  );
}
