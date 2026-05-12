"use client";

// Risk-config audit log viewer. Lists recent changes for the signed-in user
// (plus anonymous edits if the caller opts in). Renders a diff between
// config_before and config_after so reviewers can see exactly which
// thresholds moved without expanding every JSON blob by hand.

import { useEffect, useMemo, useState } from "react";

import { Card, Mono, Tag } from "@/components/ui";
import { tokens } from "@/lib/tokens";
import type { SysRiskAuditRow } from "@/lib/supabase/types";

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

function shortAddr(addr: string): string {
  if (addr === "anonymous") return "anonymous";
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

type Diff = { key: string; before: unknown; after: unknown };

// Compute a flat diff between two config snapshots so the UI can highlight
// only the keys that changed. JSONB columns arrive as plain objects.
function diff(before: unknown, after: unknown): Diff[] {
  if (!after || typeof after !== "object") return [];
  const a = (before ?? {}) as Record<string, unknown>;
  const b = after as Record<string, unknown>;
  const keys = Array.from(new Set([...Object.keys(a), ...Object.keys(b)]));
  return keys
    .filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]))
    .map((k) => ({ key: k, before: a[k], after: b[k] }));
}

function fmt(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "on" : "off";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(3);
  return JSON.stringify(v);
}

export function RiskAuditLog() {
  const [rows, setRows] = useState<SysRiskAuditRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [includeAnon, setIncludeAnon] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setErr(null);
    const qs = includeAnon ? "?include_anonymous=true&limit=50" : "?limit=50";
    fetch(`/api/risk/audit${qs}`, { cache: "no-store" })
      .then(async (r) => {
        if (r.status === 401) {
          if (!cancelled) setErr("Sign in to view your audit log.");
          return null;
        }
        if (!r.ok) {
          if (!cancelled) setErr(`HTTP ${r.status}`);
          return null;
        }
        return (await r.json()) as SysRiskAuditRow[];
      })
      .then((data) => {
        if (cancelled) return;
        if (data) setRows(data);
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : "load failed");
      });
    return () => {
      cancelled = true;
    };
  }, [includeAnon]);

  const diffs = useMemo(() => {
    if (!rows) return null;
    return rows.map((r) => ({ row: r, changes: diff(r.config_before, r.config_after) }));
  }, [rows]);

  return (
    <Card pad={0}>
      <div
        className="flex justify-between items-center"
        style={{ padding: "12px 16px", borderBottom: `1px solid ${tokens.border}` }}
      >
        <div style={{ fontSize: 13, fontWeight: 600 }}>Risk config audit log</div>
        <label
          className="flex items-center gap-1.5"
          style={{ cursor: "pointer", fontSize: 11, color: tokens.textDim }}
        >
          <input
            type="checkbox"
            checked={includeAnon}
            onChange={(e) => setIncludeAnon(e.target.checked)}
            style={{ accentColor: tokens.emerald }}
          />
          include anonymous / agent edits
        </label>
      </div>

      {err && (
        <div style={{ padding: 16, color: tokens.amber, fontSize: 12 }}>⚠ {err}</div>
      )}

      {!err && rows === null && (
        <div style={{ padding: 16 }}>
          <Mono size={11}>Loading audit log…</Mono>
        </div>
      )}

      {!err && rows && rows.length === 0 && (
        <div style={{ padding: 16, fontSize: 12, color: tokens.textDim }}>
          No audit entries yet. Changes you make in the Risk Rules editor will appear here.
        </div>
      )}

      {diffs && diffs.length > 0 && (
        <div style={{ maxHeight: 420, overflowY: "auto" }}>
          {diffs.map(({ row, changes }, i) => (
            <div
              key={row.id}
              style={{
                padding: "12px 16px",
                borderBottom:
                  i === diffs.length - 1 ? "none" : `1px solid ${tokens.borderFaint}`,
              }}
            >
              <div className="flex justify-between items-center" style={{ marginBottom: 6 }}>
                <div className="flex items-center gap-2">
                  <Mono size={10.5} color={tokens.text}>
                    {shortAddr(row.user_address)}
                  </Mono>
                  <Tag
                    small
                    color={
                      row.change_source === "ui"
                        ? tokens.emerald
                        : row.change_source === "agent_override"
                          ? tokens.violet
                          : tokens.textDim
                    }
                  >
                    {row.change_source ?? "—"}
                  </Tag>
                </div>
                <Mono size={10} color={tokens.textFaint}>
                  {fmtRelative(row.changed_at)}
                </Mono>
              </div>
              {changes.length === 0 ? (
                <Mono size={10.5} color={tokens.textFaint}>
                  no field changes (re-save with same values)
                </Mono>
              ) : (
                <div className="flex flex-col gap-1">
                  {changes.map((c) => (
                    <div
                      key={c.key}
                      className="flex items-center gap-2"
                      style={{ fontSize: 11, fontFamily: "JetBrains Mono, monospace" }}
                    >
                      <span style={{ color: tokens.textDim, minWidth: 180 }}>{c.key}</span>
                      <span style={{ color: tokens.red }}>{fmt(c.before)}</span>
                      <span style={{ color: tokens.textFaint }}>→</span>
                      <span style={{ color: tokens.emerald }}>{fmt(c.after)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
