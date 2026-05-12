"use client";

// TrendingNewsPanel
// -----------------
// Two-tab "HOT | FEATURED" trending news widget. Fetches via the
// `lib/api/sosovalue/news-trending` client (which falls back to deterministic
// synthetic data when SOSOVALUE_API_KEY is unset). Polls every 60s — that
// matches the 60s minimum gap enforced by the canonical `request` helper, so
// each poll either hits the cache or the upstream once per minute.
//
// Visual contract (per design tokens):
//   - Card shell, dark theme. Inter for body text, JetBrains Mono /
//     `Mono` primitive for timestamps + meta.
//   - 16px circular avatar (author_avatar_url, falling back to feature_image).
//   - Title truncates to 2 lines.
//   - Author + relative time on a single meta row.
//   - Source link uses ↗ glyph and opens in a new tab (rel=noopener).
//   - Tag chip color-mapped per featured category (1=cyan, 2=violet,
//     3=emerald, 4=amber, 7=red, 13=text/dim).
//
// Loading / error / empty states are explicit so the panel never silently
// renders nothing.

import { useCallback, useEffect, useMemo, useState } from "react";

import { Card, Mono, Tag } from "@/components/ui";
import { cleanText } from "@/lib/text";
import { tokens } from "@/lib/tokens";
import {
  getFeaturedNews,
  getHotNews,
  type FeaturedNewsItem,
  type HotNewsItem,
} from "@/lib/api/sosovalue/news-trending";

type Tab = "HOT" | "FEATURED";

const POLL_MS = 60_000;
const ITEMS_PER_TAB = 8;

// -- helpers -----------------------------------------------------------------

/**
 * Compact relative-time formatter. Inlined instead of pulling date-fns —
 * outputs "12s" / "5m" / "3h" / "2d" so widths stay predictable in the meta
 * row. Future timestamps clamp to "0s" rather than emitting "in 4m" — the API
 * occasionally returns a server-clock-skewed `release_time` and "in 4m" reads
 * as a bug to a user.
 */
function relativeTime(ms: number | string | undefined): string {
  if (ms == null) return "";
  const t = typeof ms === "string" ? Number(ms) : ms;
  if (!Number.isFinite(t) || t <= 0) return "";
  const dt = Date.now() - t;
  const s = Math.max(0, Math.round(dt / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  return `${d}d`;
}

function stripHtml(html: string | null | undefined): string {
  if (!html) return "";
  // Strip lone surrogates alongside HTML tags. SoSoValue's trending feed
  // sometimes returns titles ending in an emoji whose surrogate pair
  // gets split somewhere upstream; the orphan would render as U+FFFD on
  // the client and trip a hydration check if this card ever ends up in
  // an SSR path.
  return cleanText(html.replace(/<[^>]+>/g, "").trim());
}

const CATEGORY_LABEL: Record<number, string> = {
  1: "NEWS",
  2: "RESEARCH",
  3: "INSTITUTION",
  4: "KOL",
  7: "ANNOUNCE",
  13: "CRYPTO·STOCK",
};

// Color palette per design spec:
//   1=cyan · 2=violet · 3=emerald · 4=amber · 7=red · 13=text (dim)
// Violet isn't in the canonical token set so we hard-code a hex that matches
// the dark-theme palette.
const VIOLET = "#A78BFA";
const CATEGORY_COLOR: Record<number, string> = {
  1: tokens.cyan,
  2: VIOLET,
  3: tokens.emerald,
  4: tokens.amber,
  7: tokens.red,
  13: tokens.textDim,
};

function categoryLabel(cat: number | undefined): string {
  if (cat == null) return "NEWS";
  return CATEGORY_LABEL[cat] ?? "NEWS";
}

function categoryColor(cat: number | undefined): string {
  if (cat == null) return tokens.textDim;
  return CATEGORY_COLOR[cat] ?? tokens.textDim;
}

// -- normalised row shape ----------------------------------------------------

type Row = {
  id: string;
  title: string;
  body: string;
  source: string;
  ts: number | string;
  author: string;
  avatar: string;
  category: number | undefined;
  verified: boolean;
};

function hotToRow(h: HotNewsItem): Row {
  return {
    id: h.id,
    title: h.title || stripHtml(h.content).slice(0, 120) || "Untitled",
    body: stripHtml(h.content),
    source: h.source_link || "",
    ts: h.create_time,
    author: "",
    avatar: "",
    category: undefined,
    verified: false,
  };
}

function featuredToRow(f: FeaturedNewsItem): Row {
  return {
    id: f.id,
    title: f.title || stripHtml(f.content).slice(0, 120) || "Untitled",
    body: stripHtml(f.content),
    source: f.source_link || "",
    ts: f.release_time,
    author: f.nick_name || f.author || "",
    avatar: f.author_avatar_url || f.feature_image || "",
    category: f.category,
    verified: !!f.is_blue_verified,
  };
}

// -- component ---------------------------------------------------------------

export function TrendingNewsPanel() {
  const [tab, setTab] = useState<Tab>("HOT");
  const [hot, setHot] = useState<Row[] | null>(null);
  const [featured, setFeatured] = useState<Row[] | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    try {
      setError(null);
      const [hotRes, featRes] = await Promise.all([
        getHotNews({ pageSize: ITEMS_PER_TAB }),
        getFeaturedNews({ pageSize: 20 }),
      ]);
      setHot(hotRes.list.slice(0, ITEMS_PER_TAB).map(hotToRow));
      setFeatured(featRes.list.slice(0, ITEMS_PER_TAB).map(featuredToRow));
    } catch (e) {
      setError((e as Error).message || "Failed to load trending news");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadAll();
    const iv = setInterval(() => {
      if (!cancelled) void loadAll();
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [loadAll]);

  const rows: Row[] | null = tab === "HOT" ? hot : featured;

  const showLoading = loading && !rows;
  const showError = !!error && !rows;
  const showEmpty = !showLoading && !showError && rows != null && rows.length === 0;

  const tabs = useMemo<Tab[]>(() => ["HOT", "FEATURED"], []);

  return (
    <Card pad={0} className="flex-1 overflow-hidden flex flex-col">
      <div
        className="flex justify-between items-center"
        style={{ padding: "12px 16px", borderBottom: `1px solid ${tokens.border}` }}
      >
        <div style={{ fontSize: 13, fontWeight: 600, color: tokens.text }}>
          Trending news
        </div>
        <div className="flex gap-1" role="tablist" aria-label="Trending news source">
          {tabs.map((t) => {
            const on = t === tab;
            return (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setTab(t)}
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
        {showLoading && (
          <div style={{ padding: "24px 16px", textAlign: "center" }}>
            <Mono size={11} color={tokens.textFaint}>
              Loading trending news…
            </Mono>
          </div>
        )}

        {showError && (
          <div style={{ padding: "24px 16px", textAlign: "center" }}>
            <Mono size={11} color={tokens.red}>
              {error}
            </Mono>
          </div>
        )}

        {showEmpty && (
          <div style={{ padding: "24px 16px", textAlign: "center" }}>
            <Mono size={11} color={tokens.textFaint}>
              No {tab.toLowerCase()} headlines right now.
            </Mono>
          </div>
        )}

        {!showLoading &&
          !showError &&
          rows &&
          rows.length > 0 &&
          rows.map((r) => <NewsRow key={r.id} row={r} showCategory={tab === "FEATURED"} />)}
      </div>
    </Card>
  );
}

// -- single row -------------------------------------------------------------

function NewsRow({ row, showCategory }: { row: Row; showCategory: boolean }) {
  const rt = relativeTime(row.ts);
  const catColor = categoryColor(row.category);
  const catLabel = categoryLabel(row.category);

  return (
    <div
      className="flex gap-3 items-start"
      style={{
        padding: "11px 16px",
        borderBottom: `1px solid ${tokens.borderFaint}`,
      }}
    >
      <div
        style={{
          width: 16,
          height: 16,
          borderRadius: "50%",
          flexShrink: 0,
          marginTop: 2,
          background: row.avatar
            ? `center / cover no-repeat url(${JSON.stringify(row.avatar)})`
            : tokens.bgElev2,
          border: `1px solid ${tokens.border}`,
        }}
        aria-hidden
      />

      <div className="flex-1 min-w-0">
        <div
          className="font-sans"
          style={{
            fontSize: 12.5,
            color: tokens.text,
            lineHeight: 1.4,
            fontWeight: 500,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
          title={row.title}
        >
          {row.title}
        </div>

        <div className="flex gap-2 items-center mt-1 flex-wrap">
          {showCategory && row.category != null && (
            <Tag small color={catColor}>
              {catLabel}
            </Tag>
          )}
          {row.author && (
            <Mono size={10} color={tokens.textDim}>
              {row.author}
              {row.verified ? " ✓" : ""}
            </Mono>
          )}
          {rt && (
            <Mono size={10} color={tokens.textFaint}>
              {row.author ? `· ${rt}` : rt}
            </Mono>
          )}
          {row.source && (
            <a
              href={row.source}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono"
              style={{
                color: tokens.textDim,
                fontSize: 10,
                textDecoration: "none",
                marginLeft: "auto",
                letterSpacing: "-0.01em",
              }}
              aria-label="Open source in new tab"
              title="Open source"
            >
              ↗
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
