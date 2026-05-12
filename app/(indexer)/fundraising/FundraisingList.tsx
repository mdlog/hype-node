"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { Btn, Card, Mono, Tag, ProjectLogo } from "@/components/ui";
import { tokens } from "@/lib/tokens";
import { projectSlug } from "@/lib/project-slugs";
import type { FundingRoundEvent } from "@/lib/api/sosovalue/fundraising";

const PAGE_SIZE = 25;
// Asset-logos batch ceiling. Each rendered page is <= PAGE_SIZE so a single
// chunk is always enough.
const CHUNK = 50;

type RoundFilter = "all" | "seed" | "series_a" | "series_b" | "strategic" | "later";
type SortKey = "date_desc" | "date_asc" | "amount_desc" | "amount_asc";

const ROUND_LABEL: Record<RoundFilter, string> = {
  all: "All",
  seed: "Seed / Pre",
  series_a: "Series A",
  series_b: "Series B+",
  strategic: "Strategic",
  later: "Later / IPO",
};

function classifyRound(name: string): Exclude<RoundFilter, "all"> {
  const k = name.toLowerCase();
  if (k.includes("seed") || k.includes("pre")) return "seed";
  if (k.includes("series a")) return "series_a";
  if (k.includes("series b") || k.includes("series c") || k.includes("series d"))
    return "series_b";
  if (k.includes("strategic") || k.includes("private")) return "strategic";
  return "later";
}

function fmtUsd(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(0)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function fmtDate(s: string): string {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function FundraisingList({ events }: { events: FundingRoundEvent[] }) {
  const [q, setQ] = useState("");
  const [round, setRound] = useState<RoundFilter>("all");
  const [sort, setSort] = useState<SortKey>("date_desc");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = events.slice();
    if (needle) {
      list = list.filter(
        (e) =>
          e.project_name.toLowerCase().includes(needle) ||
          (e.project_symbol ?? "").toLowerCase().includes(needle) ||
          e.round_name.toLowerCase().includes(needle) ||
          e.investors.some((i) => i.name.toLowerCase().includes(needle)),
      );
    }
    if (round !== "all") {
      list = list.filter((e) => classifyRound(e.round_name) === round);
    }
    list.sort((a, b) => {
      switch (sort) {
        case "date_asc":
          if (a.date_ts && b.date_ts) return a.date_ts - b.date_ts;
          if (a.date_ts) return 1;
          if (b.date_ts) return -1;
          return 0;
        case "amount_desc":
          return b.raised_amount - a.raised_amount;
        case "amount_asc":
          return a.raised_amount - b.raised_amount;
        case "date_desc":
        default:
          if (a.date_ts && b.date_ts) return b.date_ts - a.date_ts;
          if (a.date_ts) return -1;
          if (b.date_ts) return 1;
          return 0;
      }
    });
    return list;
  }, [events, q, round, sort]);

  useEffect(() => {
    setPage(1);
  }, [q, round, sort]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const start = (safePage - 1) * PAGE_SIZE;
  const visible = filtered.slice(start, start + PAGE_SIZE);

  // Logo lookup against /api/asset-logos for visible page only.
  const [logos, setLogos] = useState<Record<string, string | null>>({});
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      const nameToSlug = new Map<string, string>();
      for (const e of visible) {
        const slug = projectSlug(e.project_name);
        if (slug) nameToSlug.set(e.project_name.toLowerCase(), slug);
      }
      if (nameToSlug.size === 0) return;
      const slugs = Array.from(new Set(nameToSlug.values()));
      const chunks: string[][] = [];
      for (let i = 0; i < slugs.length; i += CHUNK) {
        chunks.push(slugs.slice(i, i + CHUNK));
      }
      Promise.all(
        chunks.map((c) =>
          fetch(`/api/asset-logos?ids=${encodeURIComponent(c.join(","))}`, {
            cache: "force-cache",
          })
            .then((r) => r.json() as Promise<Record<string, string | null>>)
            .catch(() => ({}) as Record<string, string | null>),
        ),
      ).then((results) => {
        if (cancelled) return;
        const merged: Record<string, string | null> = Object.assign({}, ...results);
        const byName: Record<string, string | null> = {};
        for (const [nameKey, slug] of nameToSlug) {
          byName[nameKey] = merged[slug] ?? null;
        }
        setLogos((prev) => ({ ...prev, ...byName }));
      });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [filtered, safePage]);

  const totalRaised = filtered.reduce((s, e) => s + e.raised_amount, 0);

  return (
    <div className="flex flex-col gap-3">
      {/* Toolbar: search + round filter + sort */}
      <div className="flex items-center gap-2 flex-wrap">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search project, symbol, round, investor…"
          className="font-mono"
          style={{
            flex: 1,
            minWidth: 240,
            background: tokens.bgElev,
            color: tokens.text,
            border: `1px solid ${tokens.border}`,
            borderRadius: 6,
            padding: "8px 12px",
            fontSize: 12,
            outline: "none",
            letterSpacing: "-0.01em",
          }}
        />
        <select
          value={round}
          onChange={(e) => setRound(e.target.value as RoundFilter)}
          style={selectStyle}
        >
          {(Object.keys(ROUND_LABEL) as RoundFilter[]).map((k) => (
            <option key={k} value={k} style={{ background: tokens.bgElev2 }}>
              Round · {ROUND_LABEL[k]}
            </option>
          ))}
        </select>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          style={selectStyle}
        >
          <option value="date_desc">Sort · Newest first</option>
          <option value="date_asc">Sort · Oldest first</option>
          <option value="amount_desc">Sort · Largest raise</option>
          <option value="amount_asc">Sort · Smallest raise</option>
        </select>
        <Tag small color={tokens.textDim}>
          {filtered.length}/{events.length} rounds
        </Tag>
        <Tag small color={tokens.emerald}>
          {fmtUsd(totalRaised)} raised
        </Tag>
      </div>

      {filtered.length === 0 ? (
        <Card>
          <Mono size={11} color={tokens.textFaint}>
            No rounds match the current filter.
          </Mono>
        </Card>
      ) : (
        <Card pad={0}>
          {/* Table header */}
          <div
            className="grid"
            style={{
              gridTemplateColumns: "40px 1fr 130px 110px 120px 110px 1.4fr",
              padding: "10px 14px",
              gap: 12,
              borderBottom: `1px solid ${tokens.border}`,
              background: tokens.bgElev2,
              fontFamily: "var(--font-jetbrains-mono, monospace)",
              fontSize: 10,
              color: tokens.textFaint,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            <div>#</div>
            <div>Project</div>
            <div>Round</div>
            <div style={{ textAlign: "right" }}>Amount</div>
            <div style={{ textAlign: "right" }}>Valuation</div>
            <div>Date</div>
            <div>Investors</div>
          </div>

          {visible.map((e, idx) => {
            const logoUrl = logos[e.project_name.toLowerCase()] ?? null;
            const round = classifyRound(e.round_name);
            const roundColor =
              round === "seed"
                ? tokens.emerald
                : round === "series_a"
                ? tokens.cyan
                : round === "series_b"
                ? tokens.violet
                : round === "strategic"
                ? tokens.amber
                : tokens.textDim;
            return (
              <Link
                key={e.event_id}
                href={`/fundraising/${e.project_id}?name=${encodeURIComponent(e.project_name)}`}
                style={{ textDecoration: "none" }}
              >
                <div
                  className="grid items-center"
                  style={{
                    gridTemplateColumns: "40px 1fr 130px 110px 120px 110px 1.4fr",
                    padding: "10px 14px",
                    gap: 12,
                    borderBottom: `1px solid ${tokens.borderFaint}`,
                    cursor: "pointer",
                    transition: "background 0.1s",
                  }}
                  onMouseEnter={(ev) => {
                    (ev.currentTarget as HTMLElement).style.background = tokens.bgHover;
                  }}
                  onMouseLeave={(ev) => {
                    (ev.currentTarget as HTMLElement).style.background = "transparent";
                  }}
                >
                  <Mono size={10} color={tokens.textFaint}>
                    {start + idx + 1}
                  </Mono>
                  <div className="flex items-center gap-2.5 min-w-0">
                    <ProjectLogo name={e.project_name} size={28} logoUrl={logoUrl} />
                    <div className="min-w-0">
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: tokens.text,
                          letterSpacing: "-0.01em",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {e.project_name}
                      </div>
                      {e.project_symbol && (
                        <Mono size={10} color={tokens.textFaint}>
                          {e.project_symbol.toUpperCase()}
                        </Mono>
                      )}
                    </div>
                  </div>
                  <div>
                    <Tag small color={roundColor}>
                      {e.round_name}
                    </Tag>
                  </div>
                  <div
                    style={{
                      textAlign: "right",
                      fontSize: 13,
                      fontWeight: 600,
                      color: e.raised_amount > 0 ? tokens.text : tokens.textFaint,
                      fontFamily: "var(--font-jetbrains-mono, monospace)",
                    }}
                  >
                    {fmtUsd(e.raised_amount)}
                  </div>
                  <div
                    style={{
                      textAlign: "right",
                      fontSize: 12,
                      color: e.valuation > 0 ? tokens.textDim : tokens.textFaint,
                      fontFamily: "var(--font-jetbrains-mono, monospace)",
                    }}
                  >
                    {fmtUsd(e.valuation)}
                  </div>
                  <Mono size={11} color={tokens.textDim}>
                    {fmtDate(e.date)}
                  </Mono>
                  <div className="flex flex-wrap gap-1 items-center">
                    {e.investors.length === 0 ? (
                      <Mono size={10} color={tokens.textFaint}>
                        undisclosed
                      </Mono>
                    ) : (
                      <>
                        {e.investors.slice(0, 3).map((inv) => (
                          <Tag
                            key={inv.investor_id}
                            small
                            color={inv.is_lead_investor ? tokens.amber : tokens.textDim}
                            filled={inv.is_lead_investor}
                          >
                            {inv.is_lead_investor ? "★ " : ""}
                            {inv.name}
                          </Tag>
                        ))}
                        {e.investors.length > 3 && (
                          <Tag small color={tokens.textFaint}>
                            +{e.investors.length - 3}
                          </Tag>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </Link>
            );
          })}

          <Pager
            page={safePage}
            pageCount={pageCount}
            total={filtered.length}
            pageSize={PAGE_SIZE}
            onChange={setPage}
          />
        </Card>
      )}
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  background: tokens.bgElev,
  color: tokens.text,
  border: `1px solid ${tokens.border}`,
  borderRadius: 6,
  padding: "8px 10px",
  fontSize: 12,
  outline: "none",
  cursor: "pointer",
  fontFamily: "inherit",
};

function Pager({
  page,
  pageCount,
  total,
  pageSize,
  onChange,
}: {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  onChange: (p: number) => void;
}) {
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  const [jump, setJump] = useState("");

  const submitJump = () => {
    const n = Number(jump);
    if (Number.isFinite(n) && n >= 1 && n <= pageCount) onChange(Math.floor(n));
    setJump("");
  };

  return (
    <div
      className="flex items-center justify-between"
      style={{
        padding: "10px 14px",
        background: tokens.bgElev2,
      }}
    >
      <Mono size={10} color={tokens.textFaint}>
        showing {start.toLocaleString()}–{end.toLocaleString()} of {total.toLocaleString()}
      </Mono>
      <div className="flex items-center gap-1.5">
        <Btn small onClick={() => onChange(1)}>
          « First
        </Btn>
        <Btn small onClick={() => onChange(Math.max(1, page - 1))}>
          ← Prev
        </Btn>
        <span
          style={{
            padding: "0 10px",
            fontSize: 11,
            color: tokens.text,
            fontFamily: "var(--font-jetbrains-mono, monospace)",
          }}
        >
          page <span style={{ color: tokens.emerald }}>{page}</span> / {pageCount}
        </span>
        <Btn small onClick={() => onChange(Math.min(pageCount, page + 1))}>
          Next →
        </Btn>
        <Btn small onClick={() => onChange(pageCount)}>
          Last »
        </Btn>
        <input
          value={jump}
          onChange={(e) => setJump(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submitJump();
          }}
          placeholder="goto"
          inputMode="numeric"
          className="font-mono"
          style={{
            width: 60,
            marginLeft: 8,
            background: tokens.bgElev,
            color: tokens.text,
            border: `1px solid ${tokens.border}`,
            borderRadius: 4,
            padding: "4px 6px",
            fontSize: 11,
            outline: "none",
            textAlign: "center",
          }}
        />
      </div>
    </div>
  );
}
