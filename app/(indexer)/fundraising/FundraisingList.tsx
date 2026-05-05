"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Btn, Card, Mono, Tag, ProjectLogo } from "@/components/ui";
import { tokens } from "@/lib/tokens";
import { projectSlug } from "@/lib/project-slugs";
import type { FundingProjectListItem } from "@/lib/api/sosovalue/fundraising";

const PAGE_SIZE = 20;
// CoinGecko per-request id ceiling. Each rendered page is well under this so
// the visible-page batch is always a single chunk.
const CHUNK = 50;

export function FundraisingList({ projects }: { projects: FundingProjectListItem[] }) {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return projects;
    return projects.filter((p) => p.project_name.toLowerCase().includes(needle));
  }, [q, projects]);

  // Reset to page 1 whenever the search query changes — otherwise typing
  // could land the user on an empty page (e.g., page 50 of "Bitcoin").
  useEffect(() => {
    setPage(1);
  }, [q]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const start = (safePage - 1) * PAGE_SIZE;
  const visible = filtered.slice(start, start + PAGE_SIZE);

  // Logo lookup against /api/asset-logos. With pagination we only batch the
  // currently visible page (~20 cards), so the request is small and fast and
  // we never burn lookups on coins the user can't see. Keyed by lowercase
  // project name so cards render without an extra round-trip.
  const [logos, setLogos] = useState<Record<string, string | null>>({});
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      const nameToSlug = new Map<string, string>();
      for (const p of visible) {
        const slug = projectSlug(p.project_name);
        if (slug) nameToSlug.set(p.project_name.toLowerCase(), slug);
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
    // visible is recomputed on every render, but its identity changes only
    // when filtered or page changes — which is what we actually want.
  }, [filtered, safePage]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search projects by name…"
          className="font-mono"
          style={{
            flex: 1,
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
        <Tag small color={tokens.textDim}>
          {filtered.length}/{projects.length}
        </Tag>
      </div>

      {filtered.length === 0 ? (
        <Card>
          <Mono size={11} color={tokens.textFaint}>
            No projects match &quot;{q}&quot;.
          </Mono>
        </Card>
      ) : (
        <>
          <div
            className="grid"
            style={{
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: 12,
            }}
          >
            {visible.map((p) => (
              <Link
                key={p.project_id}
                href={`/fundraising/${p.project_id}?name=${encodeURIComponent(p.project_name)}`}
                style={{ textDecoration: "none" }}
              >
                <Card
                  pad={14}
                  className="hover:bg-bg-hover transition-colors"
                  style={{ cursor: "pointer" }}
                >
                  <div className="flex justify-between items-start gap-3">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <ProjectLogo
                        name={p.project_name}
                        size={36}
                        logoUrl={logos[p.project_name.toLowerCase()] ?? null}
                      />
                      <div className="min-w-0 flex-1">
                        <div
                          style={{
                            fontSize: 14,
                            fontWeight: 600,
                            color: tokens.text,
                            letterSpacing: "-0.01em",
                            marginBottom: 4,
                          }}
                        >
                          {p.project_name}
                        </div>
                        <Mono size={10} color={tokens.textFaint}>
                          id #{p.project_id} · click for details
                        </Mono>
                      </div>
                    </div>
                    <Mono size={10} color={tokens.textFaint}>
                      →
                    </Mono>
                  </div>
                </Card>
              </Link>
            ))}
          </div>

          <Pager
            page={safePage}
            pageCount={pageCount}
            total={filtered.length}
            pageSize={PAGE_SIZE}
            onChange={setPage}
          />
        </>
      )}
    </div>
  );
}

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
        borderTop: `1px solid ${tokens.border}`,
        background: tokens.bgElev2,
        borderRadius: 6,
        marginTop: 4,
      }}
    >
      <Mono size={10} color={tokens.textFaint}>
        showing {start.toLocaleString()}–{end.toLocaleString()} of{" "}
        {total.toLocaleString()}
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
          page <span style={{ color: tokens.emerald }}>{page}</span> /{" "}
          {pageCount}
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
