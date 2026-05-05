"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Card, Label, Mono, Btn, ProjectLogo } from "@/components/ui";
import { tokens } from "@/lib/tokens";
import type { CurrencyListItem } from "@/lib/api/sosovalue/tokens";

const PAGE_SIZE = 50;
// CoinGecko per-batch ceiling — visible page is 50 tokens which fits in
// a single chunk well under the 8KB URL cap.
const CHUNK = 50;

export function TokenExplorerTable({ rows }: { rows: CurrencyListItem[] }) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.symbol.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q) ||
        r.currency_id.toLowerCase().includes(q),
    );
  }, [rows, query]);

  // Drop back to page 1 whenever the query changes — otherwise typing
  // narrows the result set under the current page index and the user
  // sees an empty table until they hit Prev manually.
  useEffect(() => {
    setPage(1);
  }, [query]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const start = (safePage - 1) * PAGE_SIZE;
  const slice = filtered.slice(start, start + PAGE_SIZE);

  // Logo lookup against /api/asset-logos for the currently visible page only.
  // Symbols are short and unique within a page, so a single 50-id batch
  // request resolves all logos in one round-trip. The route handler caches
  // hits 24h server-side, so paging back to a previously-loaded page is
  // instant. Keyed by lowercase symbol so the row render stays simple.
  const [logos, setLogos] = useState<Record<string, string | null>>({});
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      const symbols = Array.from(
        new Set(slice.map((r) => r.symbol.toLowerCase()).filter(Boolean)),
      );
      if (symbols.length === 0) return;
      const chunks: string[][] = [];
      for (let i = 0; i < symbols.length; i += CHUNK) {
        chunks.push(symbols.slice(i, i + CHUNK));
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
        setLogos((prev) => ({ ...prev, ...merged }));
      });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [filtered, safePage]);

  return (
    <Card pad={0} className="flex-1 overflow-hidden flex flex-col">
      <div
        className="flex items-center gap-3"
        style={{
          padding: "10px 16px",
          borderBottom: `1px solid ${tokens.border}`,
          background: tokens.bgElev2,
        }}
      >
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(1);
          }}
          placeholder="Search by symbol, name, or id"
          className="font-mono"
          style={{
            flex: 1,
            height: 30,
            background: tokens.bgElev,
            border: `1px solid ${tokens.border}`,
            borderRadius: 5,
            padding: "0 10px",
            fontSize: 12,
            color: tokens.text,
            outline: "none",
            letterSpacing: "-0.01em",
          }}
        />
        <Mono size={10}>
          {filtered.length} of {rows.length}
        </Mono>
      </div>
      <div
        className="grid"
        style={{
          gridTemplateColumns: "120px 1fr 320px 60px",
          padding: "10px 16px",
          gap: 12,
          borderBottom: `1px solid ${tokens.border}`,
          background: tokens.bgElev2,
        }}
      >
        <Label>SYMBOL</Label>
        <Label>NAME</Label>
        <Label>ID</Label>
        <Label>{" "}</Label>
      </div>
      <div className="flex-1 overflow-y-auto">
        {slice.map((r) => (
          <Link
            key={r.currency_id}
            href={`/tokens/${r.currency_id}`}
            className="grid items-center"
            style={{
              gridTemplateColumns: "120px 1fr 320px 60px",
              padding: "10px 16px",
              gap: 12,
              borderBottom: `1px solid ${tokens.borderFaint}`,
              textDecoration: "none",
            }}
          >
            <div className="flex items-center gap-2">
              <ProjectLogo
                name={r.name || r.symbol}
                size={22}
                logoUrl={logos[r.symbol.toLowerCase()] ?? null}
              />
              <span
                className="font-mono"
                style={{ fontSize: 12, fontWeight: 600, color: tokens.text }}
              >
                {r.symbol.toUpperCase()}
              </span>
            </div>
            <div style={{ fontSize: 13, color: tokens.text }}>{r.name}</div>
            <Mono size={10}>{r.currency_id}</Mono>
            <div style={{ textAlign: "right" }}>
              <Mono size={11} color={tokens.textFaint}>
                →
              </Mono>
            </div>
          </Link>
        ))}
        {slice.length === 0 && (
          <div style={{ padding: 24, textAlign: "center" }}>
            <Mono size={11}>No matches for &ldquo;{query}&rdquo;</Mono>
          </div>
        )}
      </div>
      <div
        className="flex justify-between items-center"
        style={{
          padding: "10px 16px",
          borderTop: `1px solid ${tokens.border}`,
          background: tokens.bgElev2,
        }}
      >
        <Mono size={10}>
          page {safePage} of {pageCount} · {PAGE_SIZE} per page
        </Mono>
        <div className="flex gap-1">
          <Btn small onClick={() => setPage((p) => Math.max(1, p - 1))}>
            ← Prev
          </Btn>
          <Btn small onClick={() => setPage((p) => Math.min(pageCount, p + 1))}>
            Next →
          </Btn>
        </div>
      </div>
    </Card>
  );
}
