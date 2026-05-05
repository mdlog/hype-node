"use client";

import { useEffect, useMemo, useState } from "react";
import { Btn, Card, Mono, Tag } from "@/components/ui";
import { tokens } from "@/lib/tokens";
import type { CurrencyListItem } from "@/lib/api/sosovalue/tokens";

// Modal for "+ Add asset" in the builder constituents card. Loads the full
// SoSoValue currency universe via /api/currencies-list (server proxy), lets
// the user search by name/symbol, and emits the selected entry back to the
// builder via `onPick`. Caller is responsible for merging into the basket
// and rebalancing weights.

type Props = {
  open: boolean;
  excludeIds: Set<string>;
  onClose: () => void;
  onPick: (currency: CurrencyListItem) => void;
};

export function AddAssetModal({ open, excludeIds, onClose, onPick }: Props) {
  const [universe, setUniverse] = useState<CurrencyListItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  // Lazy-load on first open so the heavy currency list fetch is only paid
  // when the user actually wants to browse. Persisted across re-opens.
  useEffect(() => {
    if (!open || universe !== null || loading) return;
    setLoading(true);
    setError(null);
    fetch("/api/currencies-list", { cache: "force-cache" })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const body = (await r.json()) as { items: CurrencyListItem[] };
        setUniverse(body.items ?? []);
      })
      .catch((err) => {
        setError((err as Error).message);
      })
      .finally(() => setLoading(false));
  }, [open, universe, loading]);

  const filtered = useMemo(() => {
    if (!universe) return [];
    const q = query.trim().toLowerCase();
    const eligible = universe.filter((c) => !excludeIds.has(c.currency_id));
    if (!q) return eligible.slice(0, 30);
    return eligible
      .filter(
        (c) =>
          c.symbol.toLowerCase().includes(q) ||
          c.name.toLowerCase().includes(q),
      )
      .slice(0, 30);
  }, [universe, query, excludeIds]);

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
        padding: 20,
        backdropFilter: "blur(2px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 520 }}
      >
        <Card pad={0}>
          <div
            className="flex items-center justify-between"
            style={{
              padding: "12px 16px",
              borderBottom: `1px solid ${tokens.border}`,
              background: tokens.bgElev2,
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 600 }}>
              Add asset to basket
            </div>
            <Btn small onClick={onClose}>
              ✕
            </Btn>
          </div>
          <div style={{ padding: "12px 16px" }}>
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by symbol or name…"
              className="font-mono"
              style={{
                width: "100%",
                background: tokens.bgElev,
                color: tokens.text,
                border: `1px solid ${tokens.border}`,
                borderRadius: 6,
                padding: "8px 12px",
                fontSize: 12,
                outline: "none",
              }}
            />
            <div style={{ height: 8 }} />
            {loading && (
              <Mono size={11} color={tokens.textFaint}>
                Loading currency universe…
              </Mono>
            )}
            {error && (
              <Mono size={11} color={tokens.amber}>
                Could not load currencies: {error}
              </Mono>
            )}
            <div
              style={{
                maxHeight: 360,
                overflowY: "auto",
                border: `1px solid ${tokens.borderFaint}`,
                borderRadius: 6,
                background: tokens.bg,
              }}
            >
              {filtered.length === 0 && !loading && (
                <div style={{ padding: 16, textAlign: "center" }}>
                  <Mono size={11} color={tokens.textFaint}>
                    {universe === null
                      ? ""
                      : query
                        ? `No matches for "${query}"`
                        : "All currencies already in basket"}
                  </Mono>
                </div>
              )}
              {filtered.map((c) => (
                <button
                  key={c.currency_id}
                  type="button"
                  onClick={() => {
                    onPick(c);
                    onClose();
                  }}
                  className="font-mono text-left"
                  style={{
                    width: "100%",
                    padding: "10px 14px",
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    background: "transparent",
                    border: "none",
                    borderBottom: `1px solid ${tokens.borderFaint}`,
                    cursor: "pointer",
                    color: tokens.text,
                    fontSize: 12,
                  }}
                >
                  <span
                    style={{
                      fontWeight: 600,
                      color: tokens.text,
                      minWidth: 60,
                    }}
                  >
                    {c.symbol.toUpperCase()}
                  </span>
                  <span
                    style={{
                      flex: 1,
                      color: tokens.textDim,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {c.name}
                  </span>
                  <Tag small color={tokens.cyan}>
                    add
                  </Tag>
                </button>
              ))}
            </div>
            <div style={{ marginTop: 8, textAlign: "right" }}>
              <Mono size={9} color={tokens.textFaint}>
                {universe ? `${universe.length} currencies known` : ""}
              </Mono>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
