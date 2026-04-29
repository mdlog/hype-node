"use client";

import { useEffect, useState } from "react";
import { tokens } from "@/lib/tokens";
import { Mono, Tag } from "@/components/ui";

type Entry = {
  ts: string;
  kind: "TOOL" | "OBS" | "THINK" | "ACT" | "WAIT";
  text: string;
};

const KIND_TO_LABEL: Record<Entry["kind"], { lbl: string; c: string }> = {
  TOOL: { lbl: "TOOL", c: tokens.cyan },
  OBS: { lbl: "OBS", c: tokens.textDim },
  THINK: { lbl: "THINK", c: tokens.amber },
  ACT: { lbl: "EXEC", c: tokens.emerald },
  WAIT: { lbl: "WAIT", c: tokens.textFaint },
};

const FALLBACK: Entry[] = [
  { ts: new Date(Date.now() - 30_000).toISOString(), kind: "WAIT", text: "agent service offline · run `python -m src.main`" },
];

function fmtTs(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 8);
  return d.toISOString().slice(11, 19);
}

function splitLine(text: string): { headline: string; sub: string } {
  // Lines often look like "sentiment · DePIN score=92 Δ=15"
  // — split on " · " into head + sub.
  const idx = text.indexOf(" · ");
  if (idx === -1) return { headline: text, sub: "" };
  return { headline: text.slice(0, idx), sub: text.slice(idx + 3) };
}

export function DashboardActivity() {
  const [entries, setEntries] = useState<Entry[]>(FALLBACK);
  const [live, setLive] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const res = await fetch("/api/agent/reasoning", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as Entry[];
        if (cancelled) return;
        if (data.length > 0) {
          setLive(true);
          setEntries(data.slice(-10).reverse());
        }
      } catch {
        /* noop */
      }
    }
    tick();
    const id = setInterval(tick, 5_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <>
      <div
        className="flex justify-between items-center"
        style={{ padding: "14px 16px", borderBottom: `1px solid ${tokens.border}` }}
      >
        <div style={{ fontSize: 14, fontWeight: 600 }}>Agent Activity</div>
        <Tag small color={live ? tokens.emerald : tokens.textFaint} dot>
          {live ? "live · LangGraph" : "agent offline"}
        </Tag>
      </div>
      <div style={{ padding: "6px 0", overflowY: "auto", maxHeight: 290 }}>
        {entries.map((e, i) => {
          const { lbl, c } = KIND_TO_LABEL[e.kind] ?? { lbl: e.kind, c: tokens.textDim };
          const { headline, sub } = splitLine(e.text);
          return (
            <div
              key={i}
              className="flex gap-2.5 items-start"
              style={{ padding: "8px 16px", borderBottom: `1px solid ${tokens.borderFaint}` }}
            >
              <Mono size={10} color={tokens.textFaint} style={{ minWidth: 54, paddingTop: 2 }}>
                {fmtTs(e.ts)}
              </Mono>
              <Tag small color={c} style={{ minWidth: 44, justifyContent: "center" }}>
                {lbl}
              </Tag>
              <div className="flex-1">
                <div style={{ fontSize: 12.5, color: tokens.text, fontWeight: 500 }}>{headline}</div>
                {sub && <Mono size={10}>{sub}</Mono>}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
