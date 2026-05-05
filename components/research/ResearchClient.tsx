"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Btn, Label, Metric, Mono, Tag } from "@/components/ui";
import { NewsSearchBar } from "@/components/research/NewsSearchBar";
import { useWatchlist } from "@/lib/hooks/useWatchlist";
import { tokens } from "@/lib/tokens";
import type { NewsItem } from "@/lib/api/sosovalue";

type SectorScore = {
  sector: string;
  score: number;
  delta: number;
  news: number;
};

type Timeframe = "all" | "1H" | "4H" | "24H" | "7D";
type Strength = "all" | "strong" | "medium" | "weak";

const TIMEFRAME_MS: Record<Timeframe, number> = {
  all: Number.POSITIVE_INFINITY,
  "1H": 60 * 60 * 1000,
  "4H": 4 * 60 * 60 * 1000,
  "24H": 24 * 60 * 60 * 1000,
  "7D": 7 * 24 * 60 * 60 * 1000,
};

// Maps the user-facing strength label to the importance value the news
// classifier emits. "weak" matches "low" so the UI labels stay user-friendly.
const STRENGTH_TO_IMPORTANCE: Record<Exclude<Strength, "all">, NewsItem["importance"]> = {
  strong: "high",
  medium: "med",
  weak: "low",
};

function fmtRelative(iso: string): string {
  const dt = Date.now() - new Date(iso).getTime();
  const s = Math.max(0, Math.round(dt / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function ResearchClient({
  news,
  sectors,
}: {
  news: NewsItem[];
  sectors: SectorScore[];
}) {
  const router = useRouter();
  const watchlist = useWatchlist();
  const [selectedSectors, setSelectedSectors] = useState<Set<string>>(new Set());
  const [timeframe, setTimeframe] = useState<Timeframe>("all");
  const [strength, setStrength] = useState<Strength>("all");
  // Sentiment range — sentiment scores from `scoreFromTitle` are roughly
  // bounded to [-50, +100]; default keeps everything visible.
  const [sentMin, setSentMin] = useState(-50);

  function analyzeNews(item: NewsItem) {
    // Drop the user into the agent chat with a topic-anchored prompt. The
    // chat page reads `?q=` on mount and prefills the composer (see chat/page.tsx).
    const prompt = `Analyze this headline and what it implies for the ${item.sector} thesis: "${item.title}"`;
    router.push(`/chat?q=${encodeURIComponent(prompt)}`);
  }

  function buildIndexFor(item: NewsItem) {
    // Builder reads `?sector=` and pre-selects the dropdown if it matches a
    // known macro sector. News tags are entity names (TON, Bitcoin, a16z) —
    // most won't match, but the param is still useful when they do.
    router.push(`/builder?sector=${encodeURIComponent(item.sector)}`);
  }

  // Auto-derive sector chips from the news pool — upstream tags are entity
  // names (a16z, TON, Bitcoin) rather than macro categories, so a static
  // ["DePIN","RWA",...] list would never match. Show top by frequency.
  const sectorOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of news) {
      if (!n.sector) continue;
      counts.set(n.sector, (counts.get(n.sector) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([sector, count]) => ({ sector, count }));
  }, [news]);

  const filtered = useMemo(() => {
    const now = Date.now();
    const window = TIMEFRAME_MS[timeframe];
    return news.filter((n) => {
      if (selectedSectors.size > 0 && !selectedSectors.has(n.sector)) return false;
      if (timeframe !== "all") {
        const age = now - new Date(n.ts).getTime();
        if (age > window) return false;
      }
      if (strength !== "all" && n.importance !== STRENGTH_TO_IMPORTANCE[strength]) {
        return false;
      }
      if (n.sentiment < sentMin) return false;
      return true;
    });
  }, [news, selectedSectors, timeframe, strength, sentMin]);

  const visible = filtered.slice(0, 12);

  const sectorStrip = [...sectors]
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 8)
    .map((s) => {
      const pct = s.delta / 2;
      const mag = Math.min(1, Math.abs(pct) / 5);
      return { sector: s.sector, pct, mag };
    });

  function toggleSector(s: string) {
    setSelectedSectors((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }

  function resetFilters() {
    setSelectedSectors(new Set());
    setTimeframe("all");
    setStrength("all");
    setSentMin(-50);
  }

  const activeFilterCount =
    selectedSectors.size +
    (timeframe !== "all" ? 1 : 0) +
    (strength !== "all" ? 1 : 0) +
    (sentMin > -50 ? 1 : 0);

  return (
    <div
      className="grid h-[calc(100vh-48px)]"
      style={{ gridTemplateColumns: "240px 1fr 320px" }}
    >
      <div
        className="overflow-y-auto"
        style={{ padding: 16, borderRight: `1px solid ${tokens.border}` }}
      >
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>
          Filters
          {activeFilterCount > 0 && (
            <span
              style={{
                marginLeft: 8,
                fontSize: 10,
                color: tokens.emerald,
                fontFamily: "ui-monospace, Menlo, monospace",
              }}
            >
              {activeFilterCount} active
            </span>
          )}
        </div>

        <Label className="mb-1.5">Sector</Label>
        <div className="flex flex-wrap gap-1 mb-3.5">
          {sectorOptions.map(({ sector, count }) => {
            const on = selectedSectors.has(sector);
            return (
              <button
                key={sector}
                type="button"
                onClick={() => toggleSector(sector)}
                style={{
                  background: "transparent",
                  border: "none",
                  padding: 0,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                <Tag small color={on ? tokens.emerald : tokens.textDim} filled={on}>
                  {sector} · {count}
                </Tag>
              </button>
            );
          })}
          {sectorOptions.length === 0 && (
            <Mono size={10} color={tokens.textFaint}>
              no tagged news in pool
            </Mono>
          )}
        </div>

        <Label className="mb-1.5">Sentiment ≥</Label>
        <div
          style={{
            padding: "8px 10px",
            background: tokens.bgElev,
            border: `1px solid ${tokens.border}`,
            borderRadius: 6,
            marginBottom: 14,
          }}
        >
          <div className="flex justify-between mb-1.5">
            <Mono size={10}>−50</Mono>
            <Mono size={10} color={sentMin >= 40 ? tokens.emerald : tokens.text}>
              {sentMin >= 0 ? "+" : ""}
              {sentMin}
            </Mono>
            <Mono size={10}>+100</Mono>
          </div>
          <input
            type="range"
            min={-50}
            max={100}
            step={5}
            value={sentMin}
            onChange={(e) => setSentMin(Number(e.target.value))}
            style={{
              width: "100%",
              accentColor: tokens.emerald,
              cursor: "pointer",
            }}
          />
        </div>

        <Label className="mb-1.5">Timeframe</Label>
        <div className="flex gap-1 mb-3.5 flex-wrap">
          {(["all", "1H", "4H", "24H", "7D"] as const).map((t) => {
            const on = timeframe === t;
            return (
              <button
                key={t}
                type="button"
                onClick={() => setTimeframe(t)}
                style={{
                  background: "transparent",
                  border: "none",
                  padding: 0,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                <Tag small filled={on} color={on ? tokens.text : tokens.textDim}>
                  {t === "all" ? "Any" : t}
                </Tag>
              </button>
            );
          })}
        </div>

        <Label className="mb-1.5">Signal strength</Label>
        <div className="flex gap-1 mb-3.5 flex-wrap">
          {([
            { key: "all", label: "Any", color: tokens.textDim },
            { key: "strong", label: "Strong", color: tokens.red },
            { key: "medium", label: "Medium", color: tokens.amber },
            { key: "weak", label: "Weak", color: tokens.textDim },
          ] as const).map((s) => {
            const on = strength === s.key;
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => setStrength(s.key)}
                style={{
                  background: "transparent",
                  border: "none",
                  padding: 0,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                <Tag small color={s.color} filled={on}>
                  {s.label}
                </Tag>
              </button>
            );
          })}
        </div>

        <div style={{ height: 1, background: tokens.border, margin: "14px 0" }} />
        <Btn
          small
          className="w-full justify-center mb-1.5"
          style={{ width: "100%", justifyContent: "center" }}
          onClick={resetFilters}
        >
          Reset filters
        </Btn>
      </div>

      <div className="overflow-y-auto" style={{ padding: 20 }}>
        <div className="flex justify-between items-end mb-3.5">
          <div>
            <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.02em" }}>
              Research Feed
            </div>
            <Mono size={10}>
              {filtered.length} of {news.length} news · live SoSoValue · client-filtered
            </Mono>
          </div>
          <div className="flex gap-1.5">
            <Btn
              small
              icon={
                <div
                  style={{
                    width: 6,
                    height: 6,
                    background: tokens.red,
                    borderRadius: "50%",
                  }}
                />
              }
            >
              Live
            </Btn>
          </div>
        </div>
        <div className="mb-3.5">
          <NewsSearchBar />
        </div>
        <div className="flex flex-col gap-2.5">
          {visible.length === 0 && (
            <div
              style={{
                padding: 24,
                textAlign: "center",
                background: tokens.bgElev,
                border: `1px dashed ${tokens.border}`,
                borderRadius: 10,
                color: tokens.textFaint,
              }}
            >
              <Mono size={11}>No news matches the current filters</Mono>
            </div>
          )}
          {visible.map((n) => {
            const strong = n.importance === "high";
            const inWatchlist = watchlist.has(n.id);
            return (
              <div
                key={n.id}
                style={{
                  background: tokens.bgElev,
                  border: `1px solid ${strong ? tokens.emerald + "50" : tokens.border}`,
                  borderRadius: 10,
                  padding: 14,
                  boxShadow: strong ? `0 0 0 1px rgba(16,185,129,0.14)` : undefined,
                }}
              >
                <div className="flex justify-between items-center mb-1.5">
                  <div className="flex gap-1.5 items-center">
                    <Tag small color={tokens.emerald} filled>
                      {n.sector}
                    </Tag>
                    {strong && (
                      <Tag small color={tokens.amber} dot>
                        Strong signal
                      </Tag>
                    )}
                    <Mono size={10}>
                      {n.source} · {fmtRelative(n.ts)}
                    </Mono>
                  </div>
                </div>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 500,
                    color: tokens.text,
                    marginBottom: 10,
                    letterSpacing: "-0.01em",
                  }}
                >
                  {n.title}
                </div>
                <div className="flex items-center gap-4">
                  <div>
                    <Label>Sentiment</Label>
                    <Metric
                      v={`${n.sentiment > 0 ? "+" : ""}${n.sentiment}`}
                      size={18}
                      color={n.sentiment > 0 ? tokens.emerald : tokens.red}
                    />
                  </div>
                  <div style={{ width: 1, height: 30, background: tokens.border }} />
                  <div>
                    <Label>Sector</Label>
                    <Mono size={13} color={tokens.text}>
                      {n.sector}
                    </Mono>
                  </div>
                  <div className="flex-1" />
                  <Btn small onClick={() => analyzeNews(n)}>
                    Analyze
                  </Btn>
                  <Btn
                    small
                    onClick={() => watchlist.toggle(n.id)}
                    style={
                      inWatchlist
                        ? {
                            background: tokens.emerald + "20",
                            borderColor: tokens.emerald,
                            color: tokens.emerald,
                          }
                        : undefined
                    }
                  >
                    {inWatchlist ? "✓ Watchlisted" : "+ Watchlist"}
                  </Btn>
                  <Btn small primary onClick={() => buildIndexFor(n)}>
                    → Build index
                  </Btn>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div
        className="overflow-y-auto"
        style={{ padding: 16, borderLeft: `1px solid ${tokens.border}` }}
      >
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
          Sector momentum (24h)
        </div>
        <Mono size={10} className="block mb-2.5">
          real change_pct_24h from /sector-spotlight
        </Mono>
        <div className="grid grid-cols-2 gap-1.5 mb-4">
          {sectorStrip.map((s) => {
            const positive = s.pct >= 0;
            const base = positive ? tokens.emerald : tokens.red;
            const alpha = Math.round(38 + s.mag * 217)
              .toString(16)
              .padStart(2, "0");
            return (
              <div
                key={s.sector}
                style={{
                  padding: "8px 10px",
                  background: base + alpha,
                  border: `1px solid ${base}50`,
                  borderRadius: 6,
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                }}
              >
                <div style={{ fontSize: 11, fontWeight: 600, color: tokens.text }}>
                  {s.sector}
                </div>
                <Mono size={10} color={positive ? tokens.emerald : tokens.red}>
                  {positive ? "+" : ""}
                  {s.pct.toFixed(2)}%
                </Mono>
              </div>
            );
          })}
        </div>
        <Label className="mb-2">SECTOR SCORES</Label>
        {sectors.slice(0, 6).map((s) => {
          const pct = s.delta / 2;
          const c = pct >= 0 ? tokens.emerald : tokens.red;
          return (
            <div
              key={s.sector}
              style={{ padding: "8px 0", borderBottom: `1px solid ${tokens.borderFaint}` }}
            >
              <div className="flex justify-between mb-1">
                <div style={{ fontSize: 12, color: tokens.text }}>{s.sector}</div>
                <Mono size={11} color={c}>
                  {pct >= 0 ? "+" : ""}
                  {pct.toFixed(2)}%
                </Mono>
              </div>
              <Mono size={10} color={tokens.textDim}>
                composite score {s.score}
              </Mono>
            </div>
          );
        })}
      </div>
    </div>
  );
}
