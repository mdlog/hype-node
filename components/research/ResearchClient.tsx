"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

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

type Timeframe = "all" | "1H" | "4H" | "24H" | "7D" | "30D";
type Strength = "all" | "strong" | "med" | "weak";
type SortKey = "relevance" | "newest" | "sent_up" | "sent_down";

const TIMEFRAME_MS: Record<Timeframe, number> = {
  all: Number.POSITIVE_INFINITY,
  "1H": 60 * 60 * 1000,
  "4H": 4 * 60 * 60 * 1000,
  "24H": 24 * 60 * 60 * 1000,
  "7D": 7 * 24 * 60 * 60 * 1000,
  "30D": 30 * 24 * 60 * 60 * 1000,
};

const STRENGTH_TO_IMPORTANCE: Record<
  Exclude<Strength, "all">,
  NewsItem["importance"]
> = {
  strong: "high",
  med: "med",
  weak: "low",
};

const PAGE_SIZE = 8;

const PALETTE = {
  bg: tokens.bg,
  bg2: tokens.bgElev,
  bg3: tokens.bgElev2,
  bg4: tokens.bgHover,
  line: tokens.border,
  line2: tokens.borderStrong,
  text: tokens.text,
  dim: tokens.textDim,
  faint: tokens.textFaint,
  emerald: tokens.emerald,
  emeraldDim: tokens.emeraldDim,
  amber: tokens.amber,
  cyan: tokens.cyan,
  violet: tokens.violet,
  rose: tokens.rose,
};

const MONO = '"JetBrains Mono", ui-monospace, Menlo, Monaco, monospace';

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

// Maps importance to the card's left-edge accent color.
function importanceAccent(imp: NewsItem["importance"], sentiment: number) {
  if (sentiment <= -25) return PALETTE.rose;
  if (imp === "high") return PALETTE.emerald;
  if (imp === "med") return PALETTE.cyan;
  if (imp === "low") return PALETTE.amber;
  return PALETTE.line2;
}

// Color cycle for sector tags so they don't all read emerald.
function sectorTagColor(sector: string): string {
  const palette = [
    PALETTE.emerald,
    PALETTE.cyan,
    PALETTE.violet,
    PALETTE.amber,
    PALETTE.rose,
  ];
  let h = 0;
  for (let i = 0; i < sector.length; i++) h = (h * 31 + sector.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
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
  const [selectedSources, setSelectedSources] = useState<Set<string>>(new Set());
  const [timeframe, setTimeframe] = useState<Timeframe>("all");
  const [strength, setStrength] = useState<Strength>("all");
  const [sentMin, setSentMin] = useState(-50);
  const [sortKey, setSortKey] = useState<SortKey>("relevance");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  function analyzeNews(item: NewsItem) {
    const prompt = `Analyze this headline and what it implies for the ${item.sector} thesis: "${item.title}"`;
    router.push(`/chat?q=${encodeURIComponent(prompt)}`);
  }

  function buildIndexFor(sectorOrItem: NewsItem | string) {
    const sector =
      typeof sectorOrItem === "string" ? sectorOrItem : sectorOrItem.sector;
    router.push(`/builder?sector=${encodeURIComponent(sector)}`);
  }

  function buildFromFeed() {
    const top = [...selectedSectors][0];
    if (top) buildIndexFor(top);
    else router.push("/builder");
  }

  // Count sectors and sources for filter panels.
  const sectorOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of news) {
      if (!n.sector) continue;
      counts.set(n.sector, (counts.get(n.sector) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([sector, count]) => ({ sector, count }));
  }, [news]);

  const sourceOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of news) {
      if (!n.source) continue;
      counts.set(n.source, (counts.get(n.source) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([source, count]) => ({ source, count }));
  }, [news]);

  const filtered = useMemo(() => {
    const now = Date.now();
    const window = TIMEFRAME_MS[timeframe];
    const result = news.filter((n) => {
      if (selectedSectors.size > 0 && !selectedSectors.has(n.sector)) return false;
      if (selectedSources.size > 0 && !selectedSources.has(n.source)) return false;
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
    if (sortKey === "newest") {
      result.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
    } else if (sortKey === "sent_up") {
      result.sort((a, b) => b.sentiment - a.sentiment);
    } else if (sortKey === "sent_down") {
      result.sort((a, b) => a.sentiment - b.sentiment);
    }
    return result;
  }, [news, selectedSectors, selectedSources, timeframe, strength, sentMin, sortKey]);

  const visible = filtered.slice(0, visibleCount);

  // 24h sector momentum cards from /sector-spotlight delta.
  const momentum = useMemo(() => {
    return [...sectors]
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
      .slice(0, 6)
      .map((s) => ({ sector: s.sector, pct: s.delta / 2 }));
  }, [sectors]);

  // Top sentiment scores derived from the loaded news pool, grouped by sector.
  const topSentScores = useMemo(() => {
    const agg = new Map<string, { sum: number; count: number }>();
    for (const n of news) {
      if (!n.sector) continue;
      const cur = agg.get(n.sector) ?? { sum: 0, count: 0 };
      cur.sum += n.sentiment;
      cur.count += 1;
      agg.set(n.sector, cur);
    }
    return Array.from(agg.entries())
      .map(([sector, { sum, count }]) => ({ sector, avg: Math.round(sum / count) }))
      .sort((a, b) => b.avg - a.avg)
      .slice(0, 5);
  }, [news]);

  function toggleSet<T>(key: T, set: Set<T>, setter: (s: Set<T>) => void) {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setter(next);
  }

  function resetAll() {
    setSelectedSectors(new Set());
    setSelectedSources(new Set());
    setTimeframe("all");
    setStrength("all");
    setSentMin(-50);
    setSortKey("relevance");
    setVisibleCount(PAGE_SIZE);
  }

  const totalActive =
    selectedSectors.size +
    selectedSources.size +
    (timeframe !== "all" ? 1 : 0) +
    (strength !== "all" ? 1 : 0) +
    (sentMin > -50 ? 1 : 0);

  const activeSectorCount = new Set(filtered.map((n) => n.sector).filter(Boolean)).size;

  return (
    <div style={{ background: PALETTE.bg, color: PALETTE.text, minHeight: "100vh" }}>
      <div style={{ maxWidth: 1440, margin: "0 auto", padding: "22px 24px 60px" }}>
        {/* Page header */}
        <header
          style={{
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            marginBottom: 16,
            gap: 24,
          }}
        >
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em" }}>
              Research Feed
            </h1>
            <div
              style={{
                fontSize: 12,
                color: PALETTE.dim,
                marginTop: 4,
                fontFamily: MONO,
              }}
            >
              {filtered.length} of {news.length} news · live SoSoValue stream ·
              client-filtered · {activeSectorCount} sectors active
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Pill live>LIVE</Pill>
            <button
              type="button"
              className="hype-btn"
              style={btnStyle()}
              onClick={() => setVisibleCount(filtered.length)}
            >
              ⤢ Show all
            </button>
            <button
              type="button"
              className="hype-btn primary"
              style={btnStyle({ primary: true })}
              onClick={buildFromFeed}
            >
              ＋ Build index from feed
            </button>
          </div>
        </header>

        {/* Full-text news search (separate from the 50-item feed pool) */}
        <div style={{ marginBottom: 18 }}>
          <NewsSearchBar />
        </div>

        {/* 3-col grid */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "240px 1fr 320px",
            gap: 18,
            alignItems: "start",
          }}
        >
          {/* LEFT: filters */}
          <aside
            style={{
              position: "sticky",
              top: 22,
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <Panel
              title="Sector"
              right={
                totalActive > 0 ? (
                  <span
                    onClick={resetAll}
                    style={{
                      fontFamily: MONO,
                      fontSize: 10,
                      color: PALETTE.faint,
                      cursor: "pointer",
                    }}
                  >
                    Reset
                  </span>
                ) : null
              }
            >
              <FilterList
                items={sectorOptions.map(({ sector, count }) => ({
                  key: sector,
                  label: sector,
                  count,
                }))}
                selected={selectedSectors}
                onToggle={(k) =>
                  toggleSet(k, selectedSectors, setSelectedSectors)
                }
                emptyText="no tagged news"
                defaultLimit={8}
              />
            </Panel>

            <Panel title="Sentiment ≥" right={<Mono>−50 → +100</Mono>}>
              <SentimentSlider value={sentMin} onChange={setSentMin} />
            </Panel>

            <Panel title="Timeframe">
              <Segmented
                options={["1H", "4H", "24H", "7D", "30D", "all"] as const}
                value={timeframe}
                onChange={setTimeframe}
                labelFor={(v) => (v === "all" ? "Any" : v)}
              />
            </Panel>

            <Panel title="Signal strength">
              <Segmented
                options={["all", "strong", "med", "weak"] as const}
                value={strength}
                onChange={setStrength}
                labelFor={(v) =>
                  v === "all"
                    ? "Any"
                    : v === "strong"
                    ? "Strong"
                    : v === "med"
                    ? "Med"
                    : "Weak"
                }
              />
            </Panel>

            <Panel
              title="Source"
              right={
                <Mono>
                  {selectedSources.size || sourceOptions.length} of{" "}
                  {sourceOptions.length}
                </Mono>
              }
            >
              <FilterList
                items={sourceOptions.map(({ source, count }) => ({
                  key: source,
                  label: source,
                  count,
                }))}
                selected={selectedSources}
                onToggle={(k) =>
                  toggleSet(k, selectedSources, setSelectedSources)
                }
                emptyText="no sources"
                defaultLimit={5}
              />
            </Panel>

            <button
              type="button"
              style={{
                ...btnStyle(),
                width: "100%",
                justifyContent: "center",
              }}
              onClick={resetAll}
            >
              Clear all filters
            </button>
          </aside>

          {/* CENTER: feed */}
          <main>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 12,
                gap: 12,
              }}
            >
              <div
                style={{
                  fontFamily: MONO,
                  fontSize: 11.5,
                  color: PALETTE.dim,
                  flex: 1,
                  minWidth: 0,
                }}
              >
                <b style={{ color: PALETTE.text, fontWeight: 600 }}>
                  {filtered.length}
                </b>{" "}
                results ·{" "}
                <b style={{ color: PALETTE.text, fontWeight: 600 }}>
                  {activeSectorCount}
                </b>{" "}
                sectors · sentiment ≥{" "}
                <b style={{ color: PALETTE.text, fontWeight: 600 }}>
                  {sentMin >= 0 ? "+" : ""}
                  {sentMin}
                </b>{" "}
                · {timeframe === "all" ? "all time" : timeframe}
              </div>
              <select
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as SortKey)}
                style={{
                  background: PALETTE.bg2,
                  border: `1px solid ${PALETTE.line}`,
                  borderRadius: 6,
                  color: PALETTE.dim,
                  font: "inherit",
                  fontSize: 11.5,
                  padding: "5px 10px",
                  cursor: "pointer",
                  outline: 0,
                }}
              >
                <option value="relevance">Sort · Relevance</option>
                <option value="newest">Newest</option>
                <option value="sent_up">Sentiment ↑</option>
                <option value="sent_down">Sentiment ↓</option>
              </select>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {visible.length === 0 && (
                <div
                  style={{
                    padding: 32,
                    textAlign: "center",
                    background: PALETTE.bg2,
                    border: `1px dashed ${PALETTE.line}`,
                    borderRadius: 10,
                    color: PALETTE.faint,
                    fontFamily: MONO,
                    fontSize: 12,
                  }}
                >
                  No news matches the current filters
                </div>
              )}
              {visible.map((n) => (
                <NewsCard
                  key={n.id}
                  item={n}
                  inWatchlist={watchlist.has(n.id)}
                  onToggleWatchlist={() => watchlist.toggle(n.id)}
                  onAnalyze={() => analyzeNews(n)}
                  onBuild={() => buildIndexFor(n)}
                />
              ))}
            </div>

            {visible.length < filtered.length && (
              <div style={{ textAlign: "center", padding: "20px 0" }}>
                <button
                  type="button"
                  style={{ ...btnStyle(), padding: "10px 24px", fontSize: 12 }}
                  onClick={() =>
                    setVisibleCount((c) => Math.min(c + PAGE_SIZE, filtered.length))
                  }
                >
                  Load {Math.min(PAGE_SIZE, filtered.length - visible.length)} more
                  results
                </button>
              </div>
            )}
          </main>

          {/* RIGHT: rails */}
          <aside
            style={{
              position: "sticky",
              top: 22,
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <Panel title="Sector momentum · 24h" right={<Mono>SoSoValue</Mono>}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 8,
                }}
              >
                {momentum.map((s) => {
                  const up = s.pct >= 0;
                  const color = up ? PALETTE.emerald : PALETTE.rose;
                  return (
                    <div
                      key={s.sector}
                      style={{
                        padding: "10px 12px",
                        borderRadius: 8,
                        border: `1px solid ${color}40`,
                        background: PALETTE.bg3,
                        position: "relative",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          fontSize: 11.5,
                          fontWeight: 600,
                          color: PALETTE.text,
                        }}
                      >
                        {s.sector}
                      </div>
                      <div
                        style={{
                          fontFamily: MONO,
                          fontSize: 10.5,
                          marginTop: 2,
                          color,
                        }}
                      >
                        {up ? "+" : ""}
                        {s.pct.toFixed(2)}%
                      </div>
                      <Spark
                        up={up}
                        magnitude={Math.min(1, Math.abs(s.pct) / 10)}
                      />
                    </div>
                  );
                })}
                {momentum.length === 0 && (
                  <div
                    style={{
                      gridColumn: "span 2",
                      padding: 14,
                      textAlign: "center",
                      color: PALETTE.faint,
                      fontFamily: MONO,
                      fontSize: 11,
                    }}
                  >
                    no sector data
                  </div>
                )}
              </div>
            </Panel>

            <Panel title="Top sentiment scores" right={<Mono>last 24h</Mono>}>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {topSentScores.map((s) => {
                  const color =
                    s.avg > 0
                      ? PALETTE.emerald
                      : s.avg < 0
                      ? PALETTE.rose
                      : PALETTE.dim;
                  const fillPct = Math.min(50, Math.abs(s.avg) / 2);
                  return (
                    <div
                      key={s.sector}
                      style={{
                        padding: "9px 12px",
                        background: PALETTE.bg3,
                        border: `1px solid ${PALETTE.line}`,
                        borderRadius: 8,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                        }}
                      >
                        <span style={{ fontSize: 11.5, fontWeight: 600 }}>
                          {s.sector}
                        </span>
                        <span
                          style={{
                            fontFamily: MONO,
                            fontSize: 11.5,
                            fontWeight: 700,
                            color,
                          }}
                        >
                          {s.avg > 0 ? "+" : ""}
                          {s.avg}
                        </span>
                      </div>
                      <div
                        style={{
                          height: 4,
                          background: PALETTE.bg4,
                          borderRadius: 2,
                          marginTop: 6,
                          position: "relative",
                          overflow: "hidden",
                        }}
                      >
                        <span
                          style={{
                            position: "absolute",
                            top: 0,
                            bottom: 0,
                            left: "50%",
                            width: 1,
                            background: PALETTE.line2,
                          }}
                        />
                        <span
                          style={{
                            position: "absolute",
                            top: 0,
                            bottom: 0,
                            ...(s.avg >= 0
                              ? { left: "50%", width: `${fillPct}%` }
                              : { right: "50%", width: `${fillPct}%` }),
                            background: color,
                          }}
                        />
                      </div>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          marginTop: 5,
                          fontFamily: MONO,
                          fontSize: 9.5,
                          color: PALETTE.faint,
                        }}
                      >
                        <span>−100</span>
                        <span>+100</span>
                      </div>
                    </div>
                  );
                })}
                {topSentScores.length === 0 && (
                  <div
                    style={{
                      padding: 14,
                      textAlign: "center",
                      color: PALETTE.faint,
                      fontFamily: MONO,
                      fontSize: 11,
                    }}
                  >
                    no sector sentiment
                  </div>
                )}
              </div>
            </Panel>

            <Panel title="Sentiment timeline · 24h">
              <SentimentTimeline news={news} />
            </Panel>

            <div
              style={{
                padding: 14,
                background: `linear-gradient(180deg, rgba(16,185,129,0.06), ${PALETTE.bg2})`,
                border: `1px solid ${PALETTE.emerald}40`,
                borderRadius: 10,
              }}
            >
              <h5 style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                Build index from this feed
              </h5>
              <p
                style={{
                  fontSize: 11.5,
                  color: PALETTE.dim,
                  lineHeight: 1.5,
                  marginBottom: 10,
                }}
              >
                Snapshot the current{" "}
                {selectedSectors.size > 0
                  ? `${selectedSectors.size}-sector`
                  : "filtered"}{" "}
                view as a strategy basis — agent will draft, backtest, and route
                through approval.
              </p>
              <button
                type="button"
                style={{
                  ...btnStyle({ primary: true }),
                  width: "100%",
                  justifyContent: "center",
                }}
                onClick={buildFromFeed}
              >
                → Open Strategy Builder
              </button>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

/* ---------------- subcomponents ---------------- */

function Pill({ live, children }: { live?: boolean; children: React.ReactNode }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "5px 10px",
        border: `1px solid ${live ? PALETTE.emerald + "4D" : PALETTE.line}`,
        background: live ? "rgba(16,185,129,0.08)" : "transparent",
        borderRadius: 6,
        fontSize: 11,
        color: live ? PALETTE.emerald : PALETTE.dim,
        fontFamily: MONO,
      }}
    >
      {live && (
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "currentColor",
            boxShadow: "0 0 8px currentColor",
          }}
        />
      )}
      {children}
    </span>
  );
}

function Mono({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ fontFamily: MONO, fontSize: 10, color: PALETTE.faint }}>
      {children}
    </span>
  );
}

function btnStyle(opts: { primary?: boolean } = {}): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 12px",
    borderRadius: 6,
    fontSize: 12,
    border: `1px solid ${opts.primary ? PALETTE.emerald : PALETTE.line}`,
    background: opts.primary ? PALETTE.emerald : PALETTE.bg3,
    color: opts.primary ? PALETTE.bg : PALETTE.text,
    cursor: "pointer",
    fontFamily: "inherit",
    fontWeight: opts.primary ? 600 : 400,
  };
}

function Panel({
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
        background: PALETTE.bg2,
        border: `1px solid ${PALETTE.line}`,
        borderRadius: 10,
      }}
    >
      <div
        style={{
          padding: "11px 14px",
          borderBottom: `1px solid ${PALETTE.line}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <h4
          style={{
            fontFamily: MONO,
            fontSize: 9.5,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: PALETTE.dim,
            fontWeight: 600,
          }}
        >
          {title}
        </h4>
        {right}
      </div>
      <div style={{ padding: "10px 12px" }}>{children}</div>
    </div>
  );
}

function FilterList<K extends string>({
  items,
  selected,
  onToggle,
  emptyText,
  defaultLimit,
}: {
  items: { key: K; label: string; count: number }[];
  selected: Set<K>;
  onToggle: (k: K) => void;
  emptyText: string;
  defaultLimit?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  if (items.length === 0) {
    return (
      <div
        style={{
          fontFamily: MONO,
          fontSize: 10.5,
          color: PALETTE.faint,
          padding: "4px 6px",
        }}
      >
        {emptyText}
      </div>
    );
  }
  // Always render selected items so toggling-then-collapsing keeps state visible.
  const showAll = expanded || !defaultLimit || items.length <= defaultLimit;
  const shown = showAll
    ? items
    : (() => {
        const head = items.slice(0, defaultLimit);
        const headKeys = new Set(head.map((i) => i.key));
        const extraSelected = items.filter(
          (i) => !headKeys.has(i.key) && selected.has(i.key),
        );
        return [...head, ...extraSelected];
      })();
  const hidden = items.length - shown.length;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {shown.map(({ key, label, count }) => {
        const on = selected.has(key);
        return (
          <button
            key={key}
            type="button"
            onClick={() => onToggle(key)}
            style={{
              all: "unset",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "6px 8px",
              borderRadius: 6,
              cursor: "pointer",
              fontSize: 12,
              color: on ? PALETTE.emerald : PALETTE.dim,
              background: on ? "rgba(16,185,129,0.08)" : "transparent",
            }}
          >
            <span style={{ display: "inline-flex", alignItems: "center" }}>
              <span
                style={{
                  width: 12,
                  height: 12,
                  border: `1.5px solid ${on ? PALETTE.emerald : PALETTE.line2}`,
                  background: on ? PALETTE.emerald : "transparent",
                  borderRadius: 3,
                  marginRight: 8,
                  position: "relative",
                  flexShrink: 0,
                }}
              >
                {on && (
                  <span
                    style={{
                      position: "absolute",
                      left: 3,
                      top: 0,
                      width: 4,
                      height: 7,
                      borderRight: `1.6px solid ${PALETTE.bg}`,
                      borderBottom: `1.6px solid ${PALETTE.bg}`,
                      transform: "rotate(45deg)",
                    }}
                  />
                )}
              </span>
              {label}
            </span>
            <span
              style={{
                fontFamily: MONO,
                fontSize: 10.5,
                color: on ? PALETTE.emerald : PALETTE.faint,
                opacity: on ? 0.7 : 1,
              }}
            >
              {count}
            </span>
          </button>
        );
      })}
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          style={{
            all: "unset",
            padding: "6px 8px",
            fontSize: 11.5,
            color: PALETTE.faint,
            cursor: "pointer",
          }}
        >
          + {hidden} more
        </button>
      )}
      {expanded && defaultLimit && items.length > defaultLimit && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          style={{
            all: "unset",
            padding: "6px 8px",
            fontSize: 11.5,
            color: PALETTE.faint,
            cursor: "pointer",
          }}
        >
          − show less
        </button>
      )}
    </div>
  );
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
  labelFor,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  labelFor: (v: T) => string;
}) {
  return (
    <div
      style={{
        display: "flex",
        gap: 2,
        padding: 3,
        background: PALETTE.bg3,
        border: `1px solid ${PALETTE.line}`,
        borderRadius: 6,
      }}
    >
      {options.map((opt) => {
        const on = value === opt;
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            style={{
              flex: 1,
              background: on ? PALETTE.bg : "transparent",
              border: 0,
              color: on ? PALETTE.text : PALETTE.dim,
              fontFamily: MONO,
              fontSize: 10.5,
              padding: "5px 0",
              borderRadius: 4,
              cursor: "pointer",
            }}
          >
            {labelFor(opt)}
          </button>
        );
      })}
    </div>
  );
}

function SentimentSlider({
  value,
  onChange,
}: {
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <div style={{ padding: "6px 4px 4px" }}>
      <input
        type="range"
        min={-50}
        max={100}
        step={5}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{
          width: "100%",
          accentColor: PALETTE.emerald,
          cursor: "pointer",
        }}
      />
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: 8,
          fontFamily: MONO,
          fontSize: 10,
          color: PALETTE.faint,
        }}
      >
        <span>−50</span>
        <span style={{ color: value >= 40 ? PALETTE.emerald : PALETTE.text }}>
          {value >= 0 ? "+" : ""}
          {value}
        </span>
        <span>+100</span>
      </div>
    </div>
  );
}

function NewsCard({
  item,
  inWatchlist,
  onToggleWatchlist,
  onAnalyze,
  onBuild,
}: {
  item: NewsItem;
  inWatchlist: boolean;
  onToggleWatchlist: () => void;
  onAnalyze: () => void;
  onBuild: () => void;
}) {
  const accent = importanceAccent(item.importance, item.sentiment);
  const sentColor =
    item.sentiment > 0
      ? PALETTE.emerald
      : item.sentiment < 0
      ? PALETTE.rose
      : PALETTE.dim;
  const sectorColor = sectorTagColor(item.sector);

  return (
    <article
      style={{
        background: PALETTE.bg2,
        border: `1px solid ${PALETTE.line}`,
        borderLeft: `3px solid ${accent}`,
        borderRadius: 10,
        padding: "14px 16px",
        display: "grid",
        gridTemplateColumns: "74px 1fr 130px",
        gap: 14,
        alignItems: "start",
        transition: "border-color .12s",
      }}
    >
      {/* Meta column: sentiment + time */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          alignItems: "stretch",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            padding: "8px 0",
            background: PALETTE.bg3,
            border: `1px solid ${PALETTE.line}`,
            borderRadius: 8,
          }}
        >
          <div
            style={{
              fontFamily: MONO,
              fontSize: 18,
              fontWeight: 700,
              lineHeight: 1,
              color: sentColor,
            }}
          >
            {item.sentiment > 0 ? "+" : ""}
            {item.sentiment}
          </div>
          <div
            style={{
              fontFamily: MONO,
              fontSize: 8.5,
              letterSpacing: "0.1em",
              color: PALETTE.faint,
              marginTop: 3,
              textTransform: "uppercase",
            }}
          >
            Sentiment
          </div>
        </div>
        <div
          style={{
            fontFamily: MONO,
            fontSize: 10.5,
            color: PALETTE.faint,
            textAlign: "center",
          }}
        >
          {fmtRelative(item.ts)}
        </div>
      </div>

      {/* Body column: tags + headline + meta */}
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            gap: 6,
            alignItems: "center",
            marginBottom: 6,
            flexWrap: "wrap",
          }}
        >
          <SecTag color={sectorColor}>{item.sector || "Uncategorized"}</SecTag>
          {item.importance === "high" && (
            <SigTag color={PALETTE.emerald}>⚡ STRONG</SigTag>
          )}
          {item.importance === "med" && <SigTag color={PALETTE.amber}>MED</SigTag>}
          <span
            style={{
              fontFamily: MONO,
              fontSize: 9.5,
              padding: "3px 7px",
              borderRadius: 3,
              background: PALETTE.bg3,
              color: PALETTE.dim,
              border: `1px solid ${PALETTE.line}`,
              letterSpacing: "0.04em",
            }}
          >
            {item.source}
          </span>
        </div>
        <div
          style={{
            fontFamily: MONO,
            fontSize: 11,
            color: PALETTE.text,
            fontWeight: 500,
            marginBottom: 3,
          }}
        >
          {item.source}
          <span style={{ color: PALETTE.faint, fontWeight: 400 }}>
            {" "}
            · live feed
          </span>
        </div>
        <div
          style={{
            fontSize: 13.5,
            lineHeight: 1.5,
            color: PALETTE.text,
            marginBottom: 8,
          }}
        >
          {item.title}
        </div>
        <div
          style={{
            display: "flex",
            gap: 14,
            fontFamily: MONO,
            fontSize: 10.5,
            color: PALETTE.faint,
            flexWrap: "wrap",
          }}
        >
          <span>
            <span>importance</span>{" "}
            <span style={{ color: PALETTE.text, fontWeight: 600 }}>
              {item.importance.toUpperCase()}
            </span>
          </span>
          <span>
            <span>sector</span>{" "}
            <span style={{ color: PALETTE.text, fontWeight: 600 }}>
              {item.sector || "—"}
            </span>
          </span>
          <span>
            <span>signal</span>{" "}
            <span
              style={{
                color: item.sentiment > 0 ? PALETTE.emerald : PALETTE.rose,
                fontWeight: 600,
              }}
            >
              {item.sentiment > 0 ? "bullish" : item.sentiment < 0 ? "bearish" : "neutral"}
            </span>
          </span>
        </div>
      </div>

      {/* Action column */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          alignItems: "stretch",
        }}
      >
        <button
          type="button"
          onClick={onBuild}
          style={{
            ...btnStyle(),
            justifyContent: "center",
            background: "rgba(16,185,129,0.12)",
            color: PALETTE.emerald,
            borderColor: `${PALETTE.emerald}4D`,
            fontWeight: 500,
          }}
        >
          → Build index
        </button>
        <button
          type="button"
          onClick={onToggleWatchlist}
          style={{
            ...btnStyle(),
            justifyContent: "center",
            padding: "4px 9px",
            fontSize: 11,
            ...(inWatchlist
              ? {
                  background: `${PALETTE.emerald}20`,
                  borderColor: PALETTE.emerald,
                  color: PALETTE.emerald,
                }
              : {}),
          }}
        >
          {inWatchlist ? "✓ Watchlisted" : "＋ Watchlist"}
        </button>
        <button
          type="button"
          onClick={onAnalyze}
          style={{
            ...btnStyle(),
            justifyContent: "center",
            padding: "4px 9px",
            fontSize: 11,
            background: "transparent",
          }}
        >
          Analyze
        </button>
      </div>
    </article>
  );
}

function SecTag({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span
      style={{
        fontFamily: MONO,
        fontSize: 9.5,
        padding: "3px 7px",
        borderRadius: 3,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        background: `${color}1F`,
        color,
        border: `1px solid ${color}40`,
      }}
    >
      {children}
    </span>
  );
}

function SigTag({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span
      style={{
        fontFamily: MONO,
        fontSize: 9.5,
        padding: "3px 7px",
        borderRadius: 3,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        background: `${color}26`,
        color,
        border: `1px solid ${color}4D`,
        fontWeight: 700,
      }}
    >
      {children}
    </span>
  );
}

function Spark({ up, magnitude }: { up: boolean; magnitude: number }) {
  // Procedurally generates a tiny sparkline that trends up or down based on
  // the sector delta — not real time-series data, just a visual cue.
  const w = 50;
  const h = 24;
  const points = [];
  for (let i = 0; i <= 6; i++) {
    const x = (i / 6) * w;
    const baseY = up ? h - 4 - (i / 6) * (10 + magnitude * 8) : 4 + (i / 6) * (10 + magnitude * 8);
    const jitter = (Math.sin(i * 1.7) * 1.5);
    points.push(`${x.toFixed(1)},${(baseY + jitter).toFixed(1)}`);
  }
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      style={{
        position: "absolute",
        right: 6,
        bottom: 4,
        width: 50,
        height: 24,
        opacity: 0.5,
      }}
    >
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke={up ? PALETTE.emerald : PALETTE.rose}
        strokeWidth={1.4}
      />
    </svg>
  );
}

function SentimentTimeline({ news }: { news: NewsItem[] }) {
  // Bucket the news pool into 24 hourly buckets and average sentiment per
  // bucket. With only ~50 items this is sparse, so we draw a smoothed line
  // over the non-empty buckets and treat empty buckets as the previous value.
  const buckets = useMemo(() => {
    const now = Date.now();
    const ranges = Array.from({ length: 24 }, (_, i) => now - (24 - i) * 60 * 60 * 1000);
    const sums = new Array(24).fill(0);
    const counts = new Array(24).fill(0);
    for (const n of news) {
      const ts = new Date(n.ts).getTime();
      const ageHours = Math.floor((now - ts) / (60 * 60 * 1000));
      if (ageHours < 0 || ageHours >= 24) continue;
      const idx = 23 - ageHours;
      sums[idx] += n.sentiment;
      counts[idx] += 1;
    }
    let last = 0;
    return ranges.map((_, i) => {
      if (counts[i] > 0) {
        last = sums[i] / counts[i];
      }
      return last;
    });
  }, [news]);

  const w = 280;
  const h = 80;
  const max = 100;
  const min = -100;
  const stepX = w / (buckets.length - 1);
  const path = buckets
    .map((v, i) => {
      const x = i * stepX;
      const y = h - ((v - min) / (max - min)) * h;
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  const lastY =
    h - ((buckets[buckets.length - 1] - min) / (max - min)) * h;

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      style={{ width: "100%", height: 80, display: "block" }}
    >
      <defs>
        <linearGradient id="research-tl-gradient" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={PALETTE.emerald} stopOpacity={0.4} />
          <stop offset="100%" stopColor={PALETTE.emerald} stopOpacity={0} />
        </linearGradient>
      </defs>
      <line
        x1={0}
        y1={h / 2}
        x2={w}
        y2={h / 2}
        stroke={PALETTE.line}
        strokeWidth={1}
        strokeDasharray="3 3"
      />
      <path d={`${path} L ${w} ${h} L 0 ${h} Z`} fill="url(#research-tl-gradient)" />
      <path d={path} fill="none" stroke={PALETTE.emerald} strokeWidth={1.6} />
      <circle cx={w} cy={lastY} r={3} fill={PALETTE.emerald} />
    </svg>
  );
}
