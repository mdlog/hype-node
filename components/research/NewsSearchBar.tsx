"use client";

// NewsSearchBar — client-side full-text news search backed by SoSoValue's
// `/news/search` endpoint (see lib/api/sosovalue/news-search.ts).
//
// Behavior:
//   - 350ms debounce on the keyword input. Empty keyword clears results.
//   - Sort + category filters update results immediately (no debounce).
//   - 10 items per page (UI pagination — server pageSize is fetched larger
//     so prev/next paging stays snappy).
//   - Title highlighting preserves `<em>` tags from the API while stripping
//     all other HTML, defending against injection without pulling in a
//     sanitize lib (DOMPurify et al). See `safeEmHtml`.
//   - Keyboard: Enter triggers an immediate search, Escape clears input.
//   - States: loading skeleton, empty (no keyword OR no results), error.

import { Btn, Card, Label, Mono, Tag } from "@/components/ui";
import {
  searchNews,
  type NewsSearchItem,
  type NewsSearchResponse,
  type NewsSearchSort,
} from "@/lib/api/sosovalue/news-search";
import { tokens } from "@/lib/tokens";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type KeyboardEvent,
} from "react";

const PAGE_SIZE = 10;
const FETCH_PAGE_SIZE = 50;
const DEBOUNCE_MS = 350;

// SoSoValue news category codes (subset surfaced in the API docs).
const CATEGORY_OPTIONS: { label: string; value: number | "" }[] = [
  { label: "All categories", value: "" },
  { label: "News", value: 1 },
  { label: "Tweets", value: 2 },
  { label: "Announcements", value: 3 },
  { label: "Research", value: 4 },
  { label: "Macro", value: 7 },
  { label: "Regulation", value: 13 },
];

const SORT_OPTIONS: { label: string; value: NewsSearchSort }[] = [
  { label: "Relevance", value: "relevance" },
  { label: "Publish time", value: "publish_time" },
];

// ---------- helpers (no external libs) ----------

// Parse `release_time` which may be a numeric millis string ("1777196913000")
// or a number. Defensive: returns `NaN` if not parseable so callers can fall
// back to "—".
function toMillis(rt: string | number | null | undefined): number {
  if (rt == null) return NaN;
  if (typeof rt === "number") return rt;
  const n = Number(rt);
  return Number.isFinite(n) ? n : NaN;
}

// Inline relative-time formatter. Mirrors the convention used elsewhere in
// hypenode-app (`fmtRelative` in app/(indexer)/research/page.tsx) — keeps
// the bundle free of date-fns / dayjs.
function relativeTime(ms: number): string {
  if (!Number.isFinite(ms)) return "—";
  const dt = Date.now() - ms;
  const past = dt >= 0;
  const abs = Math.abs(dt);
  const s = Math.round(abs / 1000);
  if (s < 60) return past ? `${s}s ago` : `in ${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return past ? `${m}m ago` : `in ${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return past ? `${h}h ago` : `in ${h}h`;
  const d = Math.round(h / 24);
  if (d < 30) return past ? `${d}d ago` : `in ${d}d`;
  const mo = Math.round(d / 30);
  if (mo < 12) return past ? `${mo}mo ago` : `in ${mo}mo`;
  const y = Math.round(mo / 12);
  return past ? `${y}y ago` : `in ${y}y`;
}

// Minimal HTML sanitizer for SoSoValue's `/news/search` highlight blob.
// The API marks matched keywords with `<span style="color:#F00">…</span>`
// (and occasionally `<em>`). We rewrite those highlight tags to a bare
// `<em>` and strip everything else — drop the tag, keep the text inside —
// so no foreign attributes (script, onerror, style overrides) can ride in.
function safeEmHtml(input: string | null | undefined, fallback: string): string {
  const raw = input ?? "";
  if (!raw) return escapeHtml(fallback);

  const out: string[] = [];
  // Match: highlight open/close (<em>/<span...>), any other tag, or a run of text.
  const re = /<\/?(?:em|span|b|strong|mark)\b[^>]*>|<\/?[a-z][^>]*>|[^<]+/gi;
  const matches = raw.match(re);
  if (!matches) return escapeHtml(raw);

  const HIGHLIGHT = /^<\/?(?:em|span|b|strong|mark)\b/i;
  for (const tok of matches) {
    if (HIGHLIGHT.test(tok)) {
      out.push(tok.startsWith("</") ? "</em>" : "<em>");
    } else if (tok.startsWith("<")) {
      // Foreign tag — drop it, but keep any inner text via the surrounding tokens.
    } else {
      out.push(escapeHtml(tok));
    }
  }
  return out.join("");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ---------- component ----------

export function NewsSearchBar() {
  const [keyword, setKeyword] = useState("");
  const [debounced, setDebounced] = useState("");
  const [sort, setSort] = useState<NewsSearchSort>("relevance");
  const [category, setCategory] = useState<number | "">("");
  const [data, setData] = useState<NewsSearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uiPage, setUiPage] = useState(1);

  // Debounce keyword input.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(keyword.trim()), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [keyword]);

  // Reset pagination whenever the query parameters change.
  useEffect(() => {
    setUiPage(1);
  }, [debounced, sort, category]);

  // Track in-flight requests so a stale response cannot overwrite a fresher
  // one. Without this an old slow fetch could clobber the user's latest
  // keystroke.
  const reqId = useRef(0);

  const runSearch = useCallback(
    async (kw: string) => {
      if (!kw) {
        setData(null);
        setError(null);
        setLoading(false);
        return;
      }
      const id = ++reqId.current;
      setLoading(true);
      setError(null);
      try {
        const res = await searchNews({
          keyword: kw,
          page: 1,
          pageSize: FETCH_PAGE_SIZE,
          sort,
          category: typeof category === "number" ? category : undefined,
        });
        if (reqId.current !== id) return; // stale
        setData(res);
      } catch (e) {
        if (reqId.current !== id) return;
        setError((e as Error).message ?? "Search failed");
        setData(null);
      } finally {
        if (reqId.current === id) setLoading(false);
      }
    },
    [sort, category],
  );

  useEffect(() => {
    runSearch(debounced);
  }, [debounced, runSearch]);

  // Slice the buffered server page into the 10-per-UI-page view.
  //
  // Client-side sort fallback: SoSoValue's /news/search returns items in
  // relevance order regardless of the `sort` query param (verified with
  // sort=relevance vs sort=publish_time + several alternative param names).
  // We still send `sort` to the API for forward-compat, but re-sort here so
  // the "Publish time" dropdown produces a visible change.
  const pagedItems: NewsSearchItem[] = useMemo(() => {
    const list = data?.list ?? [];
    const ordered =
      sort === "publish_time"
        ? [...list].sort(
            (a, b) => toMillis(b.release_time) - toMillis(a.release_time),
          )
        : list;
    const start = (uiPage - 1) * PAGE_SIZE;
    return ordered.slice(start, start + PAGE_SIZE);
  }, [data, uiPage, sort]);

  const totalLocal = data?.list.length ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalLocal / PAGE_SIZE));

  // Enter = trigger immediate search (skip debounce); Escape = clear.
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      setDebounced(keyword.trim());
    } else if (e.key === "Escape") {
      e.preventDefault();
      setKeyword("");
      setDebounced("");
    }
  };

  return (
    <Card pad={14}>
      {/* Style highlight `<em>` tags emitted by safeEmHtml. Scoped via the
          data attribute so we don't restyle every <em> in the app. */}
      <style>{`
        [data-news-search-hl] em {
          font-style: normal;
          font-weight: 600;
          color: ${tokens.emerald};
          background: rgba(16, 185, 129, 0.12);
          padding: 0 3px;
          border-radius: 3px;
        }
      `}</style>
      <div className="flex items-center gap-2 mb-2.5">
        <Label>News search</Label>
        <Mono size={10}>SoSoValue · /news/search</Mono>
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        <div className="relative flex-1 min-w-[220px]">
          <input
            type="search"
            value={keyword}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setKeyword(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search news… (Enter to search, Esc to clear)"
            spellCheck={false}
            autoComplete="off"
            className="font-sans w-full"
            style={{
              fontSize: 13,
              padding: "8px 12px",
              background: tokens.bgElev2,
              border: `1px solid ${tokens.border}`,
              borderRadius: 6,
              color: tokens.text,
              outline: "none",
              letterSpacing: "-0.01em",
            }}
          />
        </div>
        <SelectField
          value={sort}
          onChange={(v) => setSort(v as NewsSearchSort)}
          options={SORT_OPTIONS.map((o) => ({ label: o.label, value: o.value }))}
        />
        <SelectField
          value={String(category)}
          onChange={(v) => setCategory(v === "" ? "" : Number(v))}
          options={CATEGORY_OPTIONS.map((o) => ({ label: o.label, value: String(o.value) }))}
        />
      </div>

      <ResultsArea
        keyword={debounced}
        loading={loading}
        error={error}
        items={pagedItems}
        totalLocal={totalLocal}
      />

      {totalLocal > PAGE_SIZE && !loading && !error && (
        <div className="flex items-center justify-between mt-3">
          <Mono size={10}>
            Page {uiPage} / {totalPages} · {totalLocal} {totalLocal === 1 ? "result" : "results"}
          </Mono>
          <div className="flex gap-1.5">
            <Btn small disabled={uiPage <= 1} onClick={() => setUiPage((p) => Math.max(1, p - 1))}>
              ← Prev
            </Btn>
            <Btn
              small
              disabled={uiPage >= totalPages}
              onClick={() => setUiPage((p) => Math.min(totalPages, p + 1))}
            >
              Next →
            </Btn>
          </div>
        </div>
      )}
    </Card>
  );
}

// ---------- subcomponents ----------

function SelectField({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { label: string; value: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="font-sans"
      style={{
        fontSize: 12,
        padding: "8px 10px",
        background: tokens.bgElev2,
        border: `1px solid ${tokens.border}`,
        borderRadius: 6,
        color: tokens.text,
        outline: "none",
        cursor: "pointer",
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} style={{ background: tokens.bgElev2 }}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function ResultsArea({
  keyword,
  loading,
  error,
  items,
  totalLocal,
}: {
  keyword: string;
  loading: boolean;
  error: string | null;
  items: NewsSearchItem[];
  totalLocal: number;
}) {
  if (!keyword) {
    return (
      <EmptyState
        title="Type a keyword to search"
        sub="e.g. bitcoin, restaking, RWA…"
      />
    );
  }
  if (loading) return <SkeletonList />;
  if (error) {
    return (
      <EmptyState
        title="Search failed"
        sub={error}
        accent={tokens.red}
      />
    );
  }
  if (totalLocal === 0) {
    return <EmptyState title="No matches" sub="Try a different keyword" />;
  }
  return (
    <ul className="flex flex-col gap-2 list-none p-0 m-0">
      {items.map((item) => (
        <ResultRow key={item.id} item={item} />
      ))}
    </ul>
  );
}

function ResultRow({ item }: { item: NewsSearchItem }) {
  const titleHtml = safeEmHtml(item.highlight?.title, item.title ?? "(untitled)");
  const ts = toMillis(item.release_time);
  const tags = (item.tags ?? []).slice(0, 3);
  const author = item.nick_name || item.author || (item.media_info?.name ?? "");
  const link = item.source_link ?? undefined;

  return (
    <li
      style={{
        padding: 12,
        background: tokens.bgElev,
        border: `1px solid ${tokens.borderFaint}`,
        borderRadius: 8,
        listStyle: "none",
      }}
    >
      <div
        data-news-search-hl
        style={{
          fontSize: 13.5,
          fontWeight: 500,
          color: tokens.text,
          letterSpacing: "-0.01em",
          marginBottom: 6,
          lineHeight: 1.35,
        }}
        // Highlight HTML is sanitized to `<em>`-only above. dangerouslySet…
        // is intentional: it is the only way to render the API's matched
        // keyword spans without pulling in a sanitize library.
        dangerouslySetInnerHTML={{ __html: titleHtml }}
      />
      <div className="flex items-center flex-wrap gap-2">
        {author && <Mono size={10}>{author}</Mono>}
        {author && <DotSep />}
        <Mono size={10}>{relativeTime(ts)}</Mono>
        {tags.length > 0 && <DotSep />}
        {tags.map((t) => (
          <Tag key={t} small color={tokens.cyan}>
            {t}
          </Tag>
        ))}
        <div className="flex-1" />
        {link && (
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: 11,
              color: tokens.emerald,
              textDecoration: "none",
              fontFamily: "var(--font-mono, monospace)",
            }}
          >
            source ↗
          </a>
        )}
      </div>
    </li>
  );
}

function DotSep() {
  return (
    <span
      aria-hidden
      style={{
        width: 2,
        height: 2,
        borderRadius: "50%",
        background: tokens.textFaint,
        display: "inline-block",
      }}
    />
  );
}

function SkeletonList() {
  const rowStyle: CSSProperties = {
    padding: 12,
    background: tokens.bgElev,
    border: `1px solid ${tokens.borderFaint}`,
    borderRadius: 8,
  };
  const bar = (w: string, h = 10): CSSProperties => ({
    width: w,
    height: h,
    background: tokens.bgElev2,
    borderRadius: 3,
    animation: "hn-pulse 1.2s ease-in-out infinite",
  });
  return (
    <div className="flex flex-col gap-2">
      <style>{`@keyframes hn-pulse{0%,100%{opacity:.5}50%{opacity:1}}`}</style>
      {[0, 1, 2].map((i) => (
        <div key={i} style={rowStyle}>
          <div style={{ ...bar("70%", 12), marginBottom: 8 }} />
          <div className="flex gap-2">
            <div style={bar("80px")} />
            <div style={bar("60px")} />
            <div style={bar("50px")} />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({
  title,
  sub,
  accent,
}: {
  title: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <div
      style={{
        padding: "24px 16px",
        textAlign: "center",
        border: `1px dashed ${tokens.borderFaint}`,
        borderRadius: 8,
        background: tokens.bgElev,
      }}
    >
      <div
        style={{
          fontSize: 13,
          fontWeight: 500,
          color: accent ?? tokens.textDim,
          marginBottom: 4,
          letterSpacing: "-0.01em",
        }}
      >
        {title}
      </div>
      {sub && <Mono size={11}>{sub}</Mono>}
    </div>
  );
}
