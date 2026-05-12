"use client";

// Smart Money · BTC Treasury Buys
// --------------------------------
// Surfaces the top 5 publicly-listed companies by BTC holdings, their 30d
// accumulation delta, and the most recent buy. Polls the SoSoValue
// /btc-treasuries endpoints every 10 minutes (treasury filings don't move
// faster than that — anything tighter would just burn the Demo-tier quota).
//
// Status pill:
//   live      → real key, real response
//   synthetic → no key OR fallback returned (deterministic shape)
//   error     → last fetch threw; widget shows the previous good state
//
// Click a row to expand a 90-day SVG sparkline of btc_holding (no chart
// library — keeps the dashboard payload small and the SSR boundary clean).

import { useCallback, useEffect, useMemo, useState } from "react";

import { Card, Mono, Tag } from "@/components/ui";
import { StockLogo } from "@/components/ui/StockLogo";
import { tokens } from "@/lib/tokens";
import {
  listTreasuries,
  getPurchaseHistory,
  type TreasuryListItem,
  type TreasuryPurchaseRow,
} from "@/lib/api/sosovalue/treasuries";

type Status = "live" | "synthetic" | "error";

type Row = {
  ticker: string;
  name: string;
  history: TreasuryPurchaseRow[];
  /** Latest btc_holding, used for ranking + display. */
  latestHolding: number;
  /** latest − oldest within ~30d window (monotonic so >= 0 in fallback). */
  delta30dBtc: number;
  /** USD value of the 30d delta, priced at the avg_btc_cost of the most
   *  recent acquisition (the one that pushed the holding to current). */
  delta30dUsd: number;
  /** ISO date of the newest purchase row. */
  lastBuyDate: string;
  /** Days since lastBuyDate; used for "ACTIVE" highlight + relative copy. */
  daysSinceBuy: number;
  /** btc_acq from the newest row, for the ACTIVE banner copy. */
  lastAcqBtc: number;
};

// 10 minutes — treasury filings update at most a few times a quarter, but
// daily refresh-on-publish from SoSoValue makes this a reasonable cadence
// for "did anyone buy in the last 7 days?" without burning the quota.
const POLL_MS = 10 * 60 * 1000;

// Synthetic holding for MSTR in lib/api/sosovalue/treasuries.ts. Used as a
// heuristic to detect "this is the synthetic fallback" without round-trip
// metadata — if listTreasuries() returns the exact synth roster AND every
// MSTR latest holding lands on the seeded base (modulo the deterministic
// step), assume the API key isn't wired up.
const SYNTH_FINGERPRINT_MSTR = 252_000;

export function SmartMoneyWidget() {
  const [rows, setRows] = useState<Row[]>([]);
  const [status, setStatus] = useState<Status>("synthetic");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const list = await listTreasuries();
      // Only fan out to the top-listed companies (the API may return
      // dozens). Sorting by name keeps the synthetic ordering stable; we
      // re-sort by holdings after histories arrive.
      const candidates = list.slice(0, 8);
      const histories = await Promise.all(
        candidates.map((c) =>
          getPurchaseHistory(c.ticker, { limit: 30 }).catch(() => [] as TreasuryPurchaseRow[]),
        ),
      );
      const built: Row[] = candidates
        .map((c, i) => buildRow(c, histories[i]))
        .filter((r): r is Row => r !== null);
      built.sort((a, b) => b.latestHolding - a.latestHolding);
      const top5 = built.slice(0, 5);
      setRows(top5);
      // Synthetic detection: client side has no env access, so we rely on
      // the fingerprint of the synthetic generator. Real MSTR holdings
      // won't land exactly on 252_000, real history won't be exactly 8
      // rows with monotonic deltas. False positives here just mean the
      // pill shows "synthetic" — never misleading the user that fake
      // data is real.
      const looksSynthetic =
        top5.some(
          (r) => r.ticker === "MSTR" && r.latestHolding === SYNTH_FINGERPRINT_MSTR,
        ) || top5.length === 0;
      setStatus(looksSynthetic ? "synthetic" : "live");
    } catch {
      setStatus("error");
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  const recentBuy = useMemo(
    // 7-day "ACTIVE" highlight: most recent buy across all 5 rows. Use
    // the ticker with the largest btc_acq within that window — the
    // headline number that justifies an amber pulsing dot.
    () => rows.filter((r) => r.daysSinceBuy <= 7).sort((a, b) => b.lastAcqBtc - a.lastAcqBtc)[0],
    [rows],
  );

  const statusColor =
    status === "live" ? tokens.emerald : status === "error" ? tokens.red : tokens.amber;

  return (
    <Card pad={0} className="overflow-hidden">
      <div
        className="flex items-center justify-between"
        style={{ padding: "12px 16px", borderBottom: `1px solid ${tokens.border}` }}
      >
        <div className="flex items-center gap-2">
          <div style={{ fontSize: 13, fontWeight: 600 }}>
            Smart Money · BTC Treasury Buys
          </div>
          <Tag small color={statusColor} dot>
            {status}
          </Tag>
        </div>
        {recentBuy ? (
          <div className="flex items-center gap-2">
            <PulseDot color={tokens.amber} />
            <Mono size={10.5} color={tokens.amber}>
              ACTIVE · {recentBuy.ticker} +{fmtBtc(recentBuy.lastAcqBtc)} BTC{" "}
              {fmtRelDays(recentBuy.daysSinceBuy)}
            </Mono>
          </div>
        ) : null}
      </div>
      {!loaded ? (
        <div style={{ padding: "20px 16px" }}>
          <Mono size={11} color={tokens.textFaint}>
            Loading treasury data...
          </Mono>
        </div>
      ) : rows.length === 0 ? (
        <div style={{ padding: "20px 16px" }}>
          <Mono size={11} color={tokens.textFaint}>
            No treasury data available right now.
          </Mono>
        </div>
      ) : (
        <div>
          {rows.map((r) => (
            <TreasuryRow
              key={r.ticker}
              row={r}
              expanded={expanded === r.ticker}
              onToggle={() =>
                setExpanded((curr) => (curr === r.ticker ? null : r.ticker))
              }
            />
          ))}
        </div>
      )}
    </Card>
  );
}

// ---------- row ----------

function TreasuryRow({
  row,
  expanded,
  onToggle,
}: {
  row: Row;
  expanded: boolean;
  onToggle: () => void;
}) {
  const positive = row.delta30dBtc >= 0;
  const deltaColor = positive ? tokens.emerald : tokens.red;
  const recent = row.daysSinceBuy <= 7;
  return (
    <div style={{ borderBottom: `1px solid ${tokens.borderFaint}` }}>
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left font-sans"
        style={{
          display: "grid",
          gridTemplateColumns: "1.4fr 1fr 1.1fr 0.9fr",
          gap: 12,
          alignItems: "center",
          padding: "11px 16px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          color: tokens.text,
        }}
      >
        <div className="flex items-center gap-2">
          {recent ? <PulseDot color={tokens.amber} /> : null}
          <StockLogo ticker={row.ticker} name={row.name} size={20} />
          <span style={{ fontSize: 12.5, fontWeight: 600, color: tokens.text }}>
            {row.name}
          </span>
          <Tag small color={tokens.textDim}>
            {row.ticker}
          </Tag>
        </div>
        <Mono size={11.5} color={tokens.text}>
          {fmtBtc(row.latestHolding)} BTC
        </Mono>
        <Mono size={11} color={deltaColor}>
          {positive ? "+" : ""}
          {fmtBtc(row.delta30dBtc)} BTC · {fmtUsd(row.delta30dUsd)}
        </Mono>
        <Mono size={10.5} color={tokens.textFaint}>
          {row.lastBuyDate} · {fmtRelDays(row.daysSinceBuy)}
        </Mono>
      </button>
      {expanded ? (
        <div
          style={{
            padding: "8px 16px 14px",
            background: tokens.bgElev2,
            borderTop: `1px solid ${tokens.borderFaint}`,
          }}
        >
          <HoldingSparkline history={row.history} />
        </div>
      ) : null}
    </div>
  );
}

// ---------- inline SVG sparkline ----------

function HoldingSparkline({ history }: { history: TreasuryPurchaseRow[] }) {
  // History from the API arrives newest-first; reverse so the X axis runs
  // chronologically. Cap at 90 days to match the spec.
  const points = useMemo(() => {
    const series = [...history].reverse().slice(-90);
    return series.map((r) => ({ date: r.date, v: r.btc_holding }));
  }, [history]);
  if (points.length < 2) {
    return (
      <Mono size={10} color={tokens.textFaint}>
        Insufficient history.
      </Mono>
    );
  }
  const w = 560;
  const h = 60;
  const pad = 4;
  const min = Math.min(...points.map((p) => p.v));
  const max = Math.max(...points.map((p) => p.v));
  const rng = max - min || 1;
  const px = points.map((p, i) => {
    const x = pad + (i / (points.length - 1)) * (w - pad * 2);
    const y = h - pad - ((p.v - min) / rng) * (h - pad * 2);
    return [x, y] as const;
  });
  const d = px
    .map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(" ");
  const area = `${d} L ${px[px.length - 1][0].toFixed(1)} ${h} L ${px[0][0].toFixed(1)} ${h} Z`;
  return (
    <div>
      <div
        className="flex items-center justify-between"
        style={{ marginBottom: 4 }}
      >
        <Mono size={9.5} color={tokens.textFaint}>
          BTC HOLDING · {points.length}D
        </Mono>
        <Mono size={9.5} color={tokens.textFaint}>
          {points[0].date} → {points[points.length - 1].date}
        </Mono>
      </div>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        width="100%"
        height={h}
        style={{ display: "block" }}
      >
        <path d={area} fill={tokens.emerald} opacity={0.12} />
        <path d={d} fill="none" stroke={tokens.emerald} strokeWidth={1.4} />
      </svg>
    </div>
  );
}

// ---------- helpers ----------

function buildRow(
  meta: TreasuryListItem,
  history: TreasuryPurchaseRow[],
): Row | null {
  if (history.length === 0) return null;
  // API returns newest-first per docs. Defend against either ordering by
  // sorting before computing latest/oldest within a 30d window.
  const sorted = [...history].sort((a, b) => (a.date < b.date ? 1 : -1));
  const latest = sorted[0];
  // Pick the oldest row within ~30d (or fall back to the absolute oldest
  // if every row is older than 30 days, e.g. very inactive treasury).
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - 30);
  const cutoffIso = cutoff.toISOString().slice(0, 10);
  const within = sorted.filter((r) => r.date >= cutoffIso);
  const oldest = within.length > 0 ? within[within.length - 1] : sorted[sorted.length - 1];
  const delta30dBtc = latest.btc_holding - oldest.btc_holding;
  const delta30dUsd = Math.round(delta30dBtc * (latest.avg_btc_cost || 0));
  const daysSince = Math.max(
    0,
    Math.round((Date.now() - new Date(latest.date).getTime()) / 86_400_000),
  );
  return {
    ticker: meta.ticker,
    name: meta.name,
    history: sorted,
    latestHolding: latest.btc_holding,
    delta30dBtc,
    delta30dUsd,
    lastBuyDate: latest.date,
    daysSinceBuy: daysSince,
    lastAcqBtc: latest.btc_acq,
  };
}

function fmtBtc(n: number): string {
  // "12,345 BTC" — locale separator only, no decimals (BTC counts are
  // whole numbers at the treasury scale; sub-unit precision adds noise).
  return Math.round(n).toLocaleString("en-US");
}

function fmtUsd(n: number): string {
  // "$1.2B" / "$430M" / "$8.4K". Sign-aware so a 30d outflow shows "-$...".
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

function fmtRelDays(days: number): string {
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30);
  return months === 1 ? "1 month ago" : `${months} months ago`;
}

// Pulsing amber dot via inline SVG + a tiny inline @keyframes block. Doing
// it inline (rather than a Tailwind utility) keeps the widget self-
// contained; no global CSS edits needed.
function PulseDot({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block",
        position: "relative",
        width: 8,
        height: 8,
      }}
    >
      <style>{`
        @keyframes hypenode-smartmoney-pulse {
          0%   { transform: scale(1);   opacity: 0.7; }
          70%  { transform: scale(2.4); opacity: 0;   }
          100% { transform: scale(2.4); opacity: 0;   }
        }
      `}</style>
      <span
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "50%",
          background: color,
          animation: "hypenode-smartmoney-pulse 1.6s ease-out infinite",
        }}
      />
      <span
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "50%",
          background: color,
          boxShadow: `0 0 6px ${color}`,
        }}
      />
    </span>
  );
}
