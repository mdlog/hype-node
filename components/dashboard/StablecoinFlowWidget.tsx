"use client";

// Stablecoin Market Cap · 90-day stack
// ------------------------------------
// Surfaces the aggregate stablecoin market cap broken down by issuer
// (USDT/USDC/USDS/USDE/PYUSD/USDD), the 30d delta in absolute USD and
// percentage terms, and a stacked-area chart of the per-issuer time series.
//
// Data source: SoSoValue OpenAPI v1 GET /analyses/stablecoin_total_market_cap
// (90 daily samples). Pulled via lib/api/sosovalue/analyses.ts so the
// rate-limit / backoff / synthetic-fallback contract stays consistent.
//
// Polls every 5 minutes — stablecoin cap updates daily upstream, but the
// API allows us to detect re-issuance / redemption events sooner. No chart
// library: stacked area is computed inline as cumulative y per series so
// the dashboard payload stays small.
//
// Status pill mirrors SmartMoneyWidget: live / synthetic / error.

import { useCallback, useEffect, useMemo, useState } from "react";

import { Card, Mono, Tag } from "@/components/ui";
import { tokens } from "@/lib/tokens";
import { getChartData, type ChartRow } from "@/lib/api/sosovalue/analyses";

type Status = "live" | "synthetic" | "error";

const POLL_MS = 5 * 60 * 1000;

const CHART_NAME = "stablecoin_total_market_cap";

// Per-issuer series order (bottom → top of the stack). Locking the order
// keeps the visual stable across renders even if the API permutes fields.
const SERIES = [
  { key: "usdt", label: "USDT", color: tokens.emerald },
  { key: "usdc", label: "USDC", color: tokens.cyan },
  { key: "usds", label: "USDS", color: "#A78BFA" }, // violet
  { key: "usde", label: "USDE", color: tokens.amber },
  { key: "pyusd", label: "PYUSD", color: tokens.red },
  { key: "usdd", label: "USDD", color: tokens.textDim },
] as const;

type SeriesKey = (typeof SERIES)[number]["key"];

// Synthetic detection fingerprint: the analyses fallback seeds USDT at
// ~$119B with deterministic drift. If we see the exact synthetic shape,
// flag the pill as "synthetic" rather than "live".
const SYNTH_USDT_BASE = 119_000_000_000;

export function StablecoinFlowWidget() {
  const [rows, setRows] = useState<ChartRow[]>([]);
  const [status, setStatus] = useState<Status>("synthetic");
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await getChartData(CHART_NAME, { limit: 90 });
      const sorted = [...data].sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
      setRows(sorted);
      // Synthetic fingerprint: the seeded USDT base + integer count of 90.
      const looksSynthetic =
        sorted.length === 90 &&
        Math.abs(num(sorted[0]?.usdt) - SYNTH_USDT_BASE) < SYNTH_USDT_BASE * 0.02;
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

  const stats = useMemo(() => computeStats(rows), [rows]);

  const statusColor =
    status === "live" ? tokens.emerald : status === "error" ? tokens.red : tokens.amber;

  return (
    <Card pad={0} className="overflow-hidden">
      <div
        className="flex items-center justify-between"
        style={{ padding: "12px 16px", borderBottom: `1px solid ${tokens.border}` }}
      >
        <div className="flex items-center gap-2">
          <div style={{ fontSize: 13, fontWeight: 600 }}>Stablecoin Market Cap</div>
          <Tag small color={statusColor} dot>
            {status}
          </Tag>
        </div>
        <Mono size={10} color={tokens.textFaint}>
          GET /analyses/{CHART_NAME} · 90d
        </Mono>
      </div>

      {!loaded ? (
        <div style={{ padding: "24px 16px" }}>
          <Mono size={11} color={tokens.textFaint}>
            Loading stablecoin market cap...
          </Mono>
        </div>
      ) : rows.length === 0 ? (
        <div style={{ padding: "24px 16px" }}>
          <Mono size={11} color={tokens.textFaint}>
            No stablecoin market cap data available right now.
          </Mono>
        </div>
      ) : (
        <div>
          <div
            className="flex items-end justify-between"
            style={{ padding: "14px 16px 8px" }}
          >
            <div>
              <div
                style={{
                  fontSize: 28,
                  fontWeight: 600,
                  letterSpacing: "-0.02em",
                  color: tokens.text,
                  lineHeight: 1.05,
                }}
              >
                {fmtUsd(stats.latestMcap)}
              </div>
              <Mono
                size={11}
                color={stats.delta30dPct >= 0 ? tokens.emerald : tokens.red}
                style={{ marginTop: 6, display: "inline-block" }}
              >
                {fmtPct(stats.delta30dPct)} / {fmtUsd(stats.delta30dAbs, true)} (30d)
              </Mono>
            </div>
            <div style={{ textAlign: "right" }}>
              <Mono size={10} color={tokens.textFaint}>
                {stats.latestDate} · {rows.length} samples
              </Mono>
            </div>
          </div>
          <StackedArea rows={rows} />
          <Legend />
        </div>
      )}
    </Card>
  );
}

// ---------- stacked area ----------

function StackedArea({ rows }: { rows: ChartRow[] }) {
  const w = 560;
  const h = 220;
  const padL = 56;
  const padR = 12;
  const padT = 8;
  const padB = 22;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;

  const [hover, setHover] = useState<number | null>(null);

  // Per-row stacked totals for y-axis scale: max stacked total wins.
  const totals = rows.map((r) =>
    SERIES.reduce((sum, s) => sum + Math.max(0, num(r[s.key])), 0),
  );
  const yMax = Math.max(1, ...totals);

  const xFor = (i: number) => padL + (i / Math.max(1, rows.length - 1)) * innerW;
  const yFor = (v: number) => padT + innerH - (v / yMax) * innerH;

  // Build stacked layers bottom-up. Each layer is a closed polygon defined
  // by lo (cumulative below) → hi (cumulative below + this series).
  const layers = SERIES.map((s) => ({ ...s, lo: [] as number[], hi: [] as number[] }));
  for (let i = 0; i < rows.length; i++) {
    let cum = 0;
    for (let li = 0; li < SERIES.length; li++) {
      const v = Math.max(0, num(rows[i][SERIES[li].key]));
      layers[li].lo.push(cum);
      cum += v;
      layers[li].hi.push(cum);
    }
  }

  // Y-axis ticks: 4 evenly spaced lines.
  const tickCount = 4;
  const ticks = Array.from({ length: tickCount + 1 }, (_, i) => (yMax * i) / tickCount);

  // X-axis date labels: roughly 5 evenly spaced.
  const xLabelIdx = pickIndices(rows.length, 5);

  const hoverRow = hover != null ? rows[hover] : null;
  const hoverX = hover != null ? xFor(hover) : null;

  return (
    <div style={{ position: "relative" }}>
      <svg
        width={w}
        height={h}
        className="block"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = e.clientX - rect.left;
          const ratio = (px - padL) / innerW;
          const idx = Math.round(ratio * (rows.length - 1));
          if (idx >= 0 && idx < rows.length) setHover(idx);
          else setHover(null);
        }}
        style={{ display: "block" }}
      >
        {/* Y gridlines */}
        {ticks.map((t, i) => {
          const y = yFor(t);
          return (
            <g key={i}>
              <line
                x1={padL}
                x2={w - padR}
                y1={y}
                y2={y}
                stroke={tokens.borderFaint}
                strokeDasharray="2 3"
              />
              <text
                x={padL - 6}
                y={y + 3}
                textAnchor="end"
                fontFamily="JetBrains Mono, monospace"
                fontSize={9}
                fill={tokens.textFaint}
              >
                {fmtUsdShort(t)}
              </text>
            </g>
          );
        })}

        {/* Stacked layers (bottom-up) */}
        {layers.map((layer) => {
          const fwd = layer.hi
            .map((v, i) => `${i === 0 ? "M" : "L"} ${xFor(i).toFixed(1)} ${yFor(v).toFixed(1)}`)
            .join(" ");
          const bwd = layer.lo
            .map(
              (v, i) =>
                `L ${xFor(layer.lo.length - 1 - i).toFixed(1)} ${yFor(layer.lo[layer.lo.length - 1 - i]).toFixed(1)}`,
            )
            .join(" ");
          const d = `${fwd} ${bwd} Z`;
          return (
            <g key={layer.key}>
              <path d={d} fill={layer.color} fillOpacity={0.55} stroke={layer.color} strokeWidth={1} />
            </g>
          );
        })}

        {/* X-axis date labels */}
        {xLabelIdx.map((i) => (
          <text
            key={i}
            x={xFor(i)}
            y={h - padB + 14}
            textAnchor="middle"
            fontFamily="JetBrains Mono, monospace"
            fontSize={9}
            fill={tokens.textFaint}
          >
            {fmtMmmDd(num(rows[i].timestamp))}
          </text>
        ))}

        {/* Hover crosshair */}
        {hoverX != null ? (
          <line
            x1={hoverX}
            x2={hoverX}
            y1={padT}
            y2={padT + innerH}
            stroke={tokens.text}
            strokeOpacity={0.35}
            strokeDasharray="2 2"
          />
        ) : null}
      </svg>

      {hoverRow ? (
        <div
          style={{
            position: "absolute",
            // Pin the tooltip to whichever side of the cursor has more space
            // so it never falls off the chart edge.
            left:
              (hoverX ?? 0) > w / 2
                ? Math.max(padL + 4, (hoverX ?? 0) - 168)
                : Math.min(w - padR - 4, (hoverX ?? 0) + 8),
            top: padT + 4,
            background: tokens.bgElev2,
            border: `1px solid ${tokens.border}`,
            borderRadius: 6,
            padding: "8px 10px",
            pointerEvents: "none",
            minWidth: 160,
            zIndex: 1,
          }}
        >
          <Mono size={10} color={tokens.textFaint}>
            {fmtMmmDd(num(hoverRow.timestamp))}
          </Mono>
          <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 2 }}>
            {SERIES.map((s) => (
              <div
                key={s.key}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                }}
              >
                <span
                  style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 2,
                      background: s.color,
                      display: "inline-block",
                    }}
                  />
                  <Mono size={10} color={tokens.text}>
                    {s.label}
                  </Mono>
                </span>
                <Mono size={10} color={tokens.text}>
                  {fmtUsdShort(num(hoverRow[s.key]))}
                </Mono>
              </div>
            ))}
            <div
              style={{
                borderTop: `1px solid ${tokens.borderFaint}`,
                marginTop: 3,
                paddingTop: 3,
                display: "flex",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <Mono size={10} color={tokens.textDim}>
                Total
              </Mono>
              <Mono size={10} color={tokens.text}>
                {fmtUsdShort(num(hoverRow.mcap))}
              </Mono>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Legend() {
  return (
    <div
      className="flex flex-wrap items-center"
      style={{
        gap: "6px 14px",
        padding: "8px 16px 14px",
        borderTop: `1px solid ${tokens.borderFaint}`,
      }}
    >
      {SERIES.map((s) => (
        <span
          key={s.key}
          style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
        >
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: 2,
              background: s.color,
              display: "inline-block",
            }}
          />
          <Mono size={10} color={tokens.text}>
            {s.label}
          </Mono>
        </span>
      ))}
    </div>
  );
}

// ---------- helpers ----------

function num(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function computeStats(rows: ChartRow[]): {
  latestMcap: number;
  delta30dPct: number;
  delta30dAbs: number;
  latestDate: string;
} {
  if (rows.length === 0) {
    return { latestMcap: 0, delta30dPct: 0, delta30dAbs: 0, latestDate: "—" };
  }
  const latest = rows[rows.length - 1];
  const latestMcap =
    num(latest.mcap) ||
    SERIES.reduce((sum, s) => sum + num(latest[s.key as SeriesKey]), 0);
  // 30d delta: prefer index `length-31`; fall back to first row if window
  // is shorter than 30 samples.
  const baselineIdx = Math.max(0, rows.length - 31);
  const baseline = rows[baselineIdx];
  const baselineMcap =
    num(baseline.mcap) ||
    SERIES.reduce((sum, s) => sum + num(baseline[s.key as SeriesKey]), 0);
  const delta30dAbs = latestMcap - baselineMcap;
  const delta30dPct = baselineMcap > 0 ? (delta30dAbs / baselineMcap) * 100 : 0;
  return {
    latestMcap,
    delta30dPct,
    delta30dAbs,
    latestDate: fmtMmmDd(num(latest.timestamp)),
  };
}

function fmtUsd(n: number, signed = false): string {
  const sign = n >= 0 ? (signed ? "+" : "") : "−";
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000_000) return `${sign}$${(abs / 1_000_000_000_000).toFixed(2)}T`;
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

// Compact form used inside the tooltip + axis where horizontal space is
// tight. Same scale ladder, fewer decimals.
function fmtUsdShort(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (abs >= 1_000_000_000_000) return `${sign}$${(abs / 1_000_000_000_000).toFixed(1)}T`;
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(0)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

function fmtPct(n: number): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmtMmmDd(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  const d = new Date(ms);
  return `${MONTH_ABBR[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, "0")}`;
}

// Pick `count` evenly-spaced indices spanning [0, length-1] for axis labels.
function pickIndices(length: number, count: number): number[] {
  if (length <= count) return Array.from({ length }, (_, i) => i);
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    out.push(Math.round((i / (count - 1)) * (length - 1)));
  }
  return out;
}
