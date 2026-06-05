"use client";

import Link from "next/link";
import { Card, Mono } from "@/components/ui";
import { useFirstRun } from "@/lib/hooks/useFirstRun";
import type { FirstRunStepId } from "@/lib/hooks/firstRun";
import { tokens } from "@/lib/tokens";

const STEPS: {
  id: FirstRunStepId;
  n: number;
  label: string;
  cta: string;
  href: string;
}[] = [
  { id: "createIndex", n: 1, label: "Create your first index", cta: "Open builder", href: "/builder" },
  { id: "chat", n: 2, label: "Ask the agent a question", cta: "Open chat", href: "/chat" },
  { id: "monitor", n: 3, label: "Watch a live execution", cta: "Open console", href: "/agent" },
];

export function FirstRunChecklistCard() {
  const { hydrated, dismissed, allDone, doneCount, isDone, dismiss } = useFirstRun();

  // Render nothing until hydrated (avoids SSR flicker), once dismissed, or once
  // all three steps are done.
  if (!hydrated || dismissed || allDone) return null;

  return (
    <Card pad={16} style={{ marginBottom: 18, borderColor: tokens.emeraldDim }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 15 }} aria-hidden>🚀</span>
          <span style={{ fontSize: 14, fontWeight: 600, color: tokens.text }}>Get started</span>
          <Mono size={12} color={tokens.textDim}>{doneCount}/3</Mono>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss getting started"
          style={{
            background: "none",
            border: "none",
            color: tokens.textDim,
            cursor: "pointer",
            fontSize: 16,
            lineHeight: 1,
            padding: 2,
          }}
        >
          ×
        </button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {STEPS.map((s) => {
          const done = isDone(s.id);
          return (
            <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ color: done ? tokens.emerald : tokens.textFaint, fontSize: 13 }} aria-hidden>
                {done ? "●" : "○"}
              </span>
              <span
                style={{
                  flex: 1,
                  fontSize: 13,
                  color: done ? tokens.textDim : tokens.text,
                  textDecoration: done ? "line-through" : "none",
                }}
              >
                {s.n}. {s.label}
              </span>
              {!done && (
                <Link href={s.href} className="hype-btn" style={{ fontSize: 12, padding: "4px 10px" }}>
                  {s.cta} →
                </Link>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
