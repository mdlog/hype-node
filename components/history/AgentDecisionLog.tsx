"use client";

import { useEffect, useMemo, useState } from "react";

import { Card, Mono, Tag, Btn, Label } from "@/components/ui";
import { tokens } from "@/lib/tokens";
import type { DecisionRow, HistoryStats } from "@/lib/api/agent";

// Real agent decision audit trail. Each row is one LangGraph cycle
// persisted to SQLite by agent-service/src/main.py:_persist_cycle. Surface
// is intentionally distinct from the ETF flow audit below — that one is
// SoSoValue ETF inflow data, this one is agent-internal decisions.
//
// Auto-refreshes every 30s so a live runner shows up without a hard reload.
// Clicking a row reveals the breach payload + reasoning excerpt.

type Filter = "all" | "active" | "idle" | "emergency";

const ETHERSCAN = "https://sepolia.etherscan.io/tx/";

export function AgentDecisionLog({
  initialRows,
  initialStats,
}: {
  initialRows: DecisionRow[];
  initialStats: HistoryStats | null;
}) {
  const [rows, setRows] = useState<DecisionRow[]>(initialRows);
  const [stats, setStats] = useState<HistoryStats | null>(initialStats);
  const [filter, setFilter] = useState<Filter>("all");
  const [sector, setSector] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  // Polling — keeps this view fresh as the agent runs cycles. Pauses when
  // the tab is hidden so we don't burn quota on idle backgrounds.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const params = new URLSearchParams({ limit: "50", withStats: "1" });
        if (sector) params.set("sector", sector);
        const res = await fetch(`/api/agent/history?${params}`, { cache: "no-store" });
        if (!res.ok) return;
        const d = (await res.json()) as {
          rows: DecisionRow[];
          stats: HistoryStats | null;
        };
        if (!cancelled) {
          setRows(d.rows);
          setStats(d.stats);
        }
      } catch {
        // Silent — keep showing the last successful payload.
      }
    };
    const id = setInterval(tick, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [sector]);

  // Manual refresh button — useful right after deploying / pausing the agent.
  const refreshNow = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "50", withStats: "1" });
      if (sector) params.set("sector", sector);
      const res = await fetch(`/api/agent/history?${params}`, { cache: "no-store" });
      if (res.ok) {
        const d = (await res.json()) as {
          rows: DecisionRow[];
          stats: HistoryStats | null;
        };
        setRows(d.rows);
        setStats(d.stats);
      }
    } finally {
      setLoading(false);
    }
  };

  const visible = useMemo(() => {
    return rows.filter((r) => {
      if (filter === "active" && (r.idle || r.emergency)) return false;
      if (filter === "idle" && !r.idle) return false;
      if (filter === "emergency" && !r.emergency) return false;
      return true;
    });
  }, [rows, filter]);

  return (
    <Card pad={0}>
      <div
        className="flex justify-between items-center"
        style={{ padding: "12px 16px", borderBottom: `1px solid ${tokens.border}` }}
      >
        <div className="flex items-center gap-3">
          <div style={{ fontSize: 13, fontWeight: 600 }}>Agent decision log</div>
          <Mono size={10}>persisted · agent-service SQLite · ≥30 day retention</Mono>
        </div>
        <div className="flex items-center gap-1.5">
          {stats && (
            <Mono size={10}>
              {stats.total} total · {stats.active_count} active · {stats.idle_count} idle ·{" "}
              {stats.emergency_count} emergency
            </Mono>
          )}
          <Btn small onClick={() => void refreshNow()} disabled={loading}>
            {loading ? "…" : "Refresh"}
          </Btn>
        </div>
      </div>

      <div
        className="flex gap-3 items-center flex-wrap"
        style={{ padding: "10px 16px", borderBottom: `1px solid ${tokens.borderFaint}` }}
      >
        <div className="flex items-center gap-1.5">
          <Label>Type</Label>
          {(["all", "active", "idle", "emergency"] as Filter[]).map((f) => (
            <span
              key={f}
              onClick={() => setFilter(f)}
              style={{ cursor: "pointer" }}
            >
              <Tag
                small
                filled={filter === f}
                color={filter === f ? tokens.text : tokens.textDim}
              >
                {f.toUpperCase()}
              </Tag>
            </span>
          ))}
        </div>
        <div style={{ width: 1, height: 16, background: tokens.border }} />
        <div className="flex items-center gap-1.5">
          <Label>Sector</Label>
          <span onClick={() => setSector(null)} style={{ cursor: "pointer" }}>
            <Tag
              small
              filled={!sector}
              color={!sector ? tokens.text : tokens.textDim}
            >
              ALL
            </Tag>
          </span>
          {(stats?.sectors ?? []).map((s) => (
            <span key={s} onClick={() => setSector(s)} style={{ cursor: "pointer" }}>
              <Tag
                small
                filled={sector === s}
                color={sector === s ? tokens.text : tokens.textDim}
              >
                {s}
              </Tag>
            </span>
          ))}
        </div>
      </div>

      <div
        className="grid"
        style={{
          gridTemplateColumns: "150px 80px 90px 1fr 110px 100px 110px 120px",
          padding: "8px 16px",
          gap: 12,
          borderBottom: `1px solid ${tokens.border}`,
          background: tokens.bgElev2,
        }}
      >
        {["TIMESTAMP", "SECTOR", "VERDICT", "BASKET", "RISK", "EXEC", "SSI TX", "SOURCE"].map(
          (k, i) => (
            <Label key={i}>{k}</Label>
          ),
        )}
      </div>

      <div style={{ maxHeight: 480, overflowY: "auto" }}>
        {visible.length === 0 ? (
          <div style={{ padding: 32, textAlign: "center" }}>
            <Mono size={11}>
              {rows.length === 0
                ? "No decisions logged yet. Start the agent (npm run agent) — first row will appear after one cycle."
                : "No rows match this filter."}
            </Mono>
          </div>
        ) : (
          visible.map((r) => (
            <DecisionRowView
              key={r.id}
              row={r}
              expanded={expandedId === r.id}
              onToggle={() => setExpandedId(expandedId === r.id ? null : r.id)}
            />
          ))
        )}
      </div>
    </Card>
  );
}

function DecisionRowView({
  row,
  expanded,
  onToggle,
}: {
  row: DecisionRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  const verdict = verdictTag(row);
  const ssiUrl = row.ssi_tx_hash ? `${ETHERSCAN}${row.ssi_tx_hash}` : null;
  const sourceColor = sourceTagColor(row.strategy_source);
  const execLabel = row.idle
    ? "—"
    : `${row.sodex_placed ?? 0}p · ${row.sodex_skipped ?? 0}s · ${row.sodex_errors ?? 0}e`;

  return (
    <>
      <div
        onClick={onToggle}
        className="grid items-center"
        style={{
          gridTemplateColumns: "150px 80px 90px 1fr 110px 100px 110px 120px",
          padding: "10px 16px",
          gap: 12,
          borderBottom: `1px solid ${tokens.borderFaint}`,
          cursor: "pointer",
          background: expanded ? tokens.bgElev2 : "transparent",
        }}
      >
        <div>
          <Mono size={10} color={tokens.text}>
            {row.ts.slice(0, 19).replace("T", " ")}
          </Mono>
          <Mono size={9} color={tokens.textFaint}>
            {relTime(row.ts)}
          </Mono>
        </div>
        <Mono size={11}>{row.sector ?? "—"}</Mono>
        <Tag small color={verdict.color}>
          {verdict.label}
        </Tag>
        <div className="flex items-center gap-2">
          {row.basket_size && row.basket_size > 0 ? (
            <>
              <Mono size={11} color={tokens.text}>
                N={row.basket_size}
              </Mono>
              {row.basket_top_symbol && (
                <Mono size={10}>
                  top {row.basket_top_symbol}@
                  {row.basket_top_weight != null
                    ? `${(row.basket_top_weight * 100).toFixed(0)}%`
                    : "—"}
                </Mono>
              )}
            </>
          ) : (
            <Mono size={10} color={tokens.textFaint}>
              empty basket
            </Mono>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Mono
            size={10}
            color={
              row.risk_verdict === "PASS"
                ? tokens.emerald
                : row.risk_verdict === "MANUAL_OVERRIDE"
                  ? tokens.amber
                  : row.risk_verdict
                    ? tokens.red
                    : tokens.textFaint
            }
          >
            {row.risk_verdict ?? "—"}
          </Mono>
          {row.risk_breaches && row.risk_breaches.length > 0 && (
            <Mono size={9} color={tokens.red}>
              ×{row.risk_breaches.length}
            </Mono>
          )}
        </div>
        <Mono size={10}>{execLabel}</Mono>
        <div>
          {ssiUrl ? (
            <a
              href={ssiUrl}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
            >
              <Mono size={10} color={tokens.cyan}>
                {row.ssi_tx_hash!.slice(0, 8)}… ↗
              </Mono>
            </a>
          ) : (
            <Mono size={10} color={tokens.textFaint}>
              {row.ssi_status ?? "—"}
            </Mono>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Mono size={10} color={sourceColor}>
            {row.strategy_source ?? "—"}
          </Mono>
          {row.strategy_confidence && (
            <Mono size={9} color={tokens.textFaint}>
              · {row.strategy_confidence}
            </Mono>
          )}
        </div>
      </div>
      {expanded && <ExpandedDetail row={row} />}
    </>
  );
}

function ExpandedDetail({ row }: { row: DecisionRow }) {
  return (
    <div
      style={{
        padding: "12px 32px",
        borderBottom: `1px solid ${tokens.borderFaint}`,
        background: tokens.bgElev,
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>SIGNAL</Label>
          <Mono size={10}>
            sentiment={row.sentiment_score ?? "—"} Δ={row.sentiment_delta ?? "—"} flow=
            {row.flow_inflow_usd != null
              ? row.flow_inflow_usd.toLocaleString(undefined, {
                  maximumFractionDigits: 0,
                })
              : "—"}
          </Mono>
        </div>
        <div>
          <Label>BACKTEST (90d)</Label>
          <Mono size={10}>
            sharpe={fmtMaybe(row.backtest_sharpe, 2)} dd=
            {fmtMaybePct(row.backtest_drawdown)} win={fmtMaybePct(row.backtest_win_rate)}
          </Mono>
        </div>
      </div>
      {row.basket && (
        <div className="mt-2">
          <Label>BASKET WEIGHTS</Label>
          <Mono size={10} className="block">
            {Object.entries(row.basket)
              .sort(([, a], [, b]) => b - a)
              .map(([s, w]) => `${s}@${(w * 100).toFixed(1)}%`)
              .join(" · ")}
          </Mono>
        </div>
      )}
      {row.risk_breaches && row.risk_breaches.length > 0 && (
        <div className="mt-2">
          <Label>RISK BREACHES</Label>
          {row.risk_breaches.map((b, i) => (
            <Mono key={i} size={10} color={tokens.red} className="block">
              {Object.entries(b)
                .map(([k, v]) => `${k}=${typeof v === "number" ? v.toFixed?.(3) ?? v : String(v)}`)
                .join(" · ")}
            </Mono>
          ))}
        </div>
      )}
      {row.strategy_reasoning && (
        <div className="mt-2">
          <Label>STRATEGY REASONING</Label>
          <Mono size={10} className="block" style={{ lineHeight: 1.5 }}>
            {row.strategy_reasoning}
          </Mono>
        </div>
      )}
    </div>
  );
}

function verdictTag(row: DecisionRow): { label: string; color: string } {
  if (row.emergency) return { label: "EMERGENCY", color: tokens.red };
  if (row.idle) return { label: "IDLE", color: tokens.textDim };
  if (row.risk_verdict === "MANUAL_OVERRIDE") return { label: "OVERRIDE", color: tokens.amber };
  if (row.risk_verdict === "PASS" && (row.sodex_placed ?? 0) > 0)
    return { label: "REBAL", color: tokens.cyan };
  if (row.risk_verdict === "PASS") return { label: "PASS", color: tokens.emerald };
  return { label: row.risk_verdict ?? "—", color: tokens.textDim };
}

function sourceTagColor(source: string | null): string {
  switch (source) {
    case "claude":
      return tokens.cyan;
    case "claude_fallback":
    case "rule_fallback":
      return tokens.amber;
    case "rule_floor":
      return tokens.textDim;
    case "fallback":
      return tokens.red;
    default:
      return tokens.textDim;
  }
}

function fmtMaybe(n: number | null, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

function fmtMaybePct(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

function relTime(iso: string): string {
  const t = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const sec = Math.max(0, Math.floor(t / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}
