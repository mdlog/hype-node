"use client";

// Reusable modal: list of saved backtest runs with single- or multi-select.
//
// Used by both "Load strategy" (single) and "Compare runs" (multi, max 3).
// On confirm, fires `onConfirm(selectedRuns)` with the picked rows. The
// caller controls open/close via a parent state hook.

import { useEffect, useState } from "react";

import { Btn, Card, Mono } from "@/components/ui";
import { tokens } from "@/lib/tokens";
import type { BtRunRow } from "@/lib/supabase/types";

export type RunHistoryMode = "single" | "multi";

type Props = {
  mode: RunHistoryMode;
  /** Cap on multi-select (ignored in single-select). Defaults to 3. */
  maxSelections?: number;
  title?: string;
  onCancel: () => void;
  onConfirm: (rows: BtRunRow[]) => void;
  /**
   * Optional pre-fetched runs from a parent's poll loop. When provided we
   * render immediately with this list and skip the loading flash. We still
   * kick off our own fetch in the background so the modal eventually shows
   * the freshest state — useful when the parent's last poll was 14s ago.
   */
  initialRuns?: BtRunRow[] | null;
};

function timeAgo(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (Number.isNaN(ms) || ms < 0) return "just now";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

function pct(n: number | null | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${(n * 100).toFixed(1)}%`;
}

function num(n: number | null | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  return n.toFixed(2);
}

export function RunHistoryModal({
  mode,
  maxSelections = 3,
  title,
  onCancel,
  onConfirm,
  initialRuns,
}: Props) {
  // Seed from parent's polled cache when available so we don't flash a
  // "loading…" pane in the common case (parent has been polling on a
  // 15s loop and has fresh data already).
  const [runs, setRuns] = useState<BtRunRow[] | null>(initialRuns ?? null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/backtest/runs?limit=20", { cache: "no-store" });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          if (!cancelled) setLoadErr(body?.error ?? `HTTP ${res.status}`);
          return;
        }
        const rows = (await res.json()) as BtRunRow[];
        if (!cancelled) setRuns(rows);
      } catch (e) {
        if (!cancelled)
          setLoadErr(e instanceof Error ? e.message : "network error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else if (mode === "single") {
        next.clear();
        next.add(id);
      } else {
        if (next.size >= maxSelections) return prev;
        next.add(id);
      }
      return next;
    });
  };

  const confirm = () => {
    if (!runs) return;
    const picked = runs.filter((r) => selected.has(r.id));
    if (picked.length === 0) return;
    onConfirm(picked);
  };

  const headerLabel =
    title ?? (mode === "single" ? "Load strategy" : "Compare runs");
  const hint =
    mode === "single"
      ? "Pick one run to restore."
      : `Pick up to ${maxSelections} runs to overlay.`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div style={{ width: "min(680px, 95vw)", maxHeight: "85vh" }}>
        <Card pad={16}>
          <div className="flex justify-between items-start" style={{ marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-0.01em" }}>
                {headerLabel}
              </div>
              <Mono size={10}>{hint}</Mono>
            </div>
            <button
              type="button"
              onClick={onCancel}
              aria-label="Close"
              style={{
                background: "transparent",
                border: `1px solid ${tokens.border}`,
                color: tokens.textDim,
                width: 24,
                height: 24,
                borderRadius: 4,
                cursor: "pointer",
                fontSize: 12,
                lineHeight: 1,
              }}
            >
              ×
            </button>
          </div>

          <div
            style={{
              maxHeight: "55vh",
              overflowY: "auto",
              border: `1px solid ${tokens.border}`,
              borderRadius: 6,
              background: tokens.bg,
            }}
          >
            {loadErr ? (
              <div style={{ padding: 16 }}>
                <Mono size={11} color={tokens.red}>
                  ⚠ {loadErr}
                </Mono>
              </div>
            ) : runs === null ? (
              <div style={{ padding: 16 }}>
                <Mono size={11}>loading…</Mono>
              </div>
            ) : runs.length === 0 ? (
              <div style={{ padding: 16 }}>
                <Mono size={11}>
                  No saved runs yet. Run a backtest and click "Save as preset".
                </Mono>
              </div>
            ) : (
              runs.map((r) => {
                const isOn = selected.has(r.id);
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => toggle(r.id)}
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      background: isOn ? tokens.emerald + "10" : "transparent",
                      borderBottom: `1px solid ${tokens.borderFaint}`,
                      borderLeft: isOn
                        ? `3px solid ${tokens.emerald}`
                        : "3px solid transparent",
                      cursor: "pointer",
                      textAlign: "left",
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                    }}
                  >
                    <div
                      style={{
                        width: 14,
                        height: 14,
                        borderRadius: mode === "single" ? "50%" : 3,
                        border: `1.5px solid ${
                          isOn ? tokens.emerald : tokens.borderStrong
                        }`,
                        flexShrink: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {isOn ? (
                        <div
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: mode === "single" ? "50%" : 1,
                            background: tokens.emerald,
                          }}
                        />
                      ) : null}
                    </div>
                    <div className="flex-1" style={{ minWidth: 0 }}>
                      <div className="flex justify-between items-baseline">
                        <div
                          style={{
                            fontSize: 12.5,
                            color: tokens.text,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {r.label?.trim() || "untitled"}
                        </div>
                        <Mono size={9}>{timeAgo(r.created_at)}</Mono>
                      </div>
                      <div
                        className="flex gap-3"
                        style={{ marginTop: 2, flexWrap: "wrap" }}
                      >
                        <Mono size={10}>{r.strategy_ticker}</Mono>
                        <Mono size={10}>{r.days}d</Mono>
                        <Mono
                          size={10}
                          color={
                            (r.return_total ?? 0) >= 0 ? tokens.emerald : tokens.red
                          }
                        >
                          ret {pct(r.return_total)}
                        </Mono>
                        <Mono size={10}>sharpe {num(r.sharpe)}</Mono>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>

          <div
            className="flex justify-between items-center"
            style={{ marginTop: 12 }}
          >
            <Mono size={10}>
              {selected.size} selected
              {mode === "multi" ? ` / ${maxSelections}` : ""}
            </Mono>
            <div className="flex gap-2">
              <Btn small onClick={onCancel}>
                Cancel
              </Btn>
              <Btn
                small
                primary
                onClick={confirm}
                disabled={selected.size === 0}
                style={
                  selected.size === 0
                    ? { opacity: 0.4, cursor: "not-allowed" }
                    : undefined
                }
              >
                Confirm
              </Btn>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
