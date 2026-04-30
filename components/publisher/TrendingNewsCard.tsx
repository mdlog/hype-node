"use client";

import { useMemo, useState } from "react";

import { Card, Mono, Tag } from "@/components/ui";
import { tokens } from "@/lib/tokens";

export type RadarNewsItem = {
  /** Pre-formatted relative time, e.g. "2m" / "3h" — server computes this. */
  t: string;
  /** Headline. */
  h: string;
  /** Source / author. */
  s: string;
  /** Sentiment score 0-100 (heuristic). */
  sent: number;
  /** Importance tier — drives the colored severity rail. */
  imp: "high" | "med" | "low";
  /** First sector tag for filtering. May be empty if SoSoValue didn't tag. */
  sector: string;
};

// Common shortcuts the design surfaces. "All" disables the filter; the
// others match case-insensitively against the news item's sector tag.
// If you need more filters, add them here — the empty-state copy adapts.
const FILTERS = ["All", "DePIN", "RWA", "AI"] as const;
type Filter = (typeof FILTERS)[number];

export function TrendingNewsCard({ news }: { news: RadarNewsItem[] }) {
  const [active, setActive] = useState<Filter>("All");

  const filtered = useMemo(() => {
    if (active === "All") return news;
    const target = active.toLowerCase();
    return news.filter((n) => (n.sector ?? "").toLowerCase() === target);
  }, [news, active]);

  return (
    <Card pad={0} className="flex-1 overflow-hidden flex flex-col">
      <div
        className="flex justify-between items-center"
        style={{ padding: "12px 16px", borderBottom: `1px solid ${tokens.border}` }}
      >
        <div style={{ fontSize: 13, fontWeight: 600 }}>Trending news · {active}</div>
        <div className="flex gap-1">
          {FILTERS.map((t) => {
            const on = active === t;
            return (
              <button
                key={t}
                type="button"
                onClick={() => setActive(t)}
                className="font-sans"
                style={{
                  background: "transparent",
                  border: "none",
                  padding: 0,
                  cursor: "pointer",
                }}
              >
                <Tag small filled={on} color={on ? tokens.text : tokens.textDim}>
                  {t}
                </Tag>
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div style={{ padding: "24px 16px", textAlign: "center" }}>
            <Mono size={11} color={tokens.textFaint}>
              No headlines tagged{" "}
              <span style={{ color: tokens.textDim }}>{active}</span> in the
              current /news window. Try All or another sector.
            </Mono>
          </div>
        ) : (
          filtered.map((n, i) => (
            <div
              key={i}
              className="flex gap-2.5 items-center"
              style={{
                padding: "11px 16px",
                borderBottom: `1px solid ${tokens.borderFaint}`,
              }}
            >
              <Mono size={10} color={tokens.textFaint} style={{ minWidth: 32 }}>
                {n.t}
              </Mono>
              <div
                style={{
                  width: 3,
                  alignSelf: "stretch",
                  background:
                    n.imp === "high"
                      ? tokens.red
                      : n.imp === "med"
                        ? tokens.amber
                        : tokens.borderStrong,
                  borderRadius: 2,
                }}
              />
              <div className="flex-1 min-w-0">
                <div
                  style={{
                    fontSize: 12.5,
                    color: tokens.text,
                    lineHeight: 1.4,
                    fontWeight: 500,
                  }}
                >
                  {n.h}
                </div>
                <div className="flex gap-2 items-center mt-0.5">
                  <Mono size={10}>{n.s}</Mono>
                  {n.sector && (
                    <Mono size={9.5} color={tokens.textFaint}>
                      · {n.sector}
                    </Mono>
                  )}
                </div>
              </div>
              <Mono size={11} color={n.sent > 70 ? tokens.emerald : tokens.amber}>
                +{n.sent}
              </Mono>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}
