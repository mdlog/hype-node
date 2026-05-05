"use client";

import { useMemo, useState } from "react";
import { Card, Label, Mono, Tag } from "@/components/ui";
import { StockLogo } from "@/components/ui/StockLogo";
import { tokens } from "@/lib/tokens";

// ---------- shared row type passed from the server page ----------

export type StockRow = {
  ticker: string;
  name: string;
  sector: string;
  price: number;
  vol24h: number;
  marketcap: number;
  pe: number;
  pb: number;
};

export type SectorIndexSeries = {
  sector: string;
  rows: { date: string; price: number; btc: number; ndx: number }[];
};

// ---------- formatting ----------

function fmtUsd(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n >= 1000) return `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  if (n >= 100) return `$${n.toFixed(1)}`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(4)}`;
}

function fmtMcap(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000_000) return `$${(n / 1_000_000_000_000).toFixed(2)}T`;
  if (abs >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function fmtRatio(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "—";
  return n.toFixed(1);
}

// ---------- sortable header ----------

type SortKey = "ticker" | "name" | "sector" | "price" | "vol24h" | "marketcap" | "pe" | "pb";

const COLUMNS: { key: SortKey | "trail"; label: string; sortable: boolean }[] = [
  { key: "ticker", label: "TICKER", sortable: true },
  { key: "name", label: "NAME", sortable: true },
  { key: "sector", label: "SECTOR", sortable: true },
  { key: "price", label: "PRICE", sortable: true },
  { key: "vol24h", label: "24H VOL", sortable: true },
  { key: "marketcap", label: "MARKET CAP", sortable: true },
  { key: "pe", label: "P/E", sortable: true },
  { key: "pb", label: "P/B", sortable: true },
  { key: "trail", label: "↗", sortable: false },
];

// First column widened from 70 → 100px to fit the company logo (20px) +
// ticker text (mono, ~50px at fontSize 11) + 8px gap with breathing room.
const GRID = "100px 1fr 110px 90px 100px 110px 60px 60px 32px";

// ---------- main interactive shell ----------

export function StocksClient({
  rows,
  sectorIndex,
  availableSectors,
}: {
  rows: StockRow[];
  sectorIndex: Record<string, SectorIndexSeries>;
  availableSectors: string[];
}) {
  const [filter, setFilter] = useState<string>("All");
  const [sortKey, setSortKey] = useState<SortKey>("marketcap");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [chartSector, setChartSector] = useState<string>(availableSectors[0] ?? "BTC Treasury");

  const visible = useMemo(() => {
    const filtered = filter === "All" ? rows : rows.filter((r) => r.sector === filter);
    const sorted = [...filtered].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === "number" && typeof bv === "number") {
        return sortDir === "asc" ? av - bv : bv - av;
      }
      const as = String(av);
      const bs = String(bv);
      return sortDir === "asc" ? as.localeCompare(bs) : bs.localeCompare(as);
    });
    return sorted.slice(0, 20);
  }, [rows, filter, sortKey, sortDir]);

  const onSort = (k: SortKey) => {
    if (k === sortKey) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else {
      setSortKey(k);
      setSortDir("desc");
    }
  };

  const series = sectorIndex[chartSector];

  return (
    <div
      className="grid gap-3 flex-1 min-h-0"
      style={{ gridTemplateColumns: "minmax(0, 1fr) 360px" }}
    >
      {/* ----- left: filter chips + table ----- */}
      <div className="flex flex-col gap-3 min-h-0">
        <div className="flex gap-3 items-center flex-wrap">
          <div className="flex items-center gap-1.5">
            <Label>Sector</Label>
            {(["All", "BTC Treasury", "Mining", "Exchange", "Other"] as const).map((s) => {
              const on = filter === s;
              return (
                <button
                  key={s}
                  onClick={() => setFilter(s)}
                  className="cursor-pointer"
                  style={{ background: "none", border: "none", padding: 0 }}
                >
                  <Tag small filled={on} color={on ? tokens.text : tokens.textDim}>
                    {s}
                  </Tag>
                </button>
              );
            })}
          </div>
          <div style={{ width: 1, height: 16, background: tokens.border }} />
          <Mono size={10}>
            {visible.length} of {rows.length} listed · click headers to sort
          </Mono>
        </div>

        <Card pad={0} className="flex-1 overflow-hidden flex flex-col">
          <div
            className="grid"
            style={{
              gridTemplateColumns: GRID,
              padding: "10px 16px",
              gap: 12,
              borderBottom: `1px solid ${tokens.border}`,
              background: tokens.bgElev2,
            }}
          >
            {COLUMNS.map((c) => {
              const active = c.sortable && c.key === sortKey;
              const arrow = active ? (sortDir === "asc" ? " ↑" : " ↓") : "";
              return (
                <div
                  key={c.label}
                  onClick={c.sortable ? () => onSort(c.key as SortKey) : undefined}
                  style={{
                    cursor: c.sortable ? "pointer" : "default",
                    userSelect: "none",
                    color: active ? tokens.text : undefined,
                  }}
                >
                  <Label color={active ? tokens.text : undefined}>
                    {c.label}
                    {arrow}
                  </Label>
                </div>
              );
            })}
          </div>

          <div className="flex-1 overflow-y-auto">
            {visible.map((r) => (
              <div
                key={r.ticker}
                className="grid items-center"
                style={{
                  gridTemplateColumns: GRID,
                  padding: "10px 16px",
                  gap: 12,
                  borderBottom: `1px solid ${tokens.borderFaint}`,
                }}
              >
                <div className="flex items-center gap-2">
                  <StockLogo ticker={r.ticker} name={r.name} size={20} />
                  <Mono size={11} color={tokens.text}>
                    {r.ticker}
                  </Mono>
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: tokens.text,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {r.name}
                </div>
                <Tag small color={sectorColor(r.sector)}>
                  {r.sector}
                </Tag>
                <Mono size={11} color={tokens.text}>
                  {fmtUsd(r.price)}
                </Mono>
                <Mono size={11}>{fmtMcap(r.vol24h)}</Mono>
                <Mono size={11} color={tokens.text}>
                  {fmtMcap(r.marketcap)}
                </Mono>
                <Mono size={11}>{fmtRatio(r.pe)}</Mono>
                <Mono size={11}>{fmtRatio(r.pb)}</Mono>
                <Mono size={11} color={tokens.textFaint}>
                  →
                </Mono>
              </div>
            ))}
            {visible.length === 0 && (
              <div style={{ padding: 24, textAlign: "center" }}>
                <Mono size={11}>No stocks match filter · {filter}</Mono>
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* ----- right: sector index chart ----- */}
      <SectorIndexCard
        sectors={availableSectors}
        active={chartSector}
        onPick={setChartSector}
        series={series}
      />
    </div>
  );
}

// ---------- sector tag color ----------

function sectorColor(sector: string): string {
  switch (sector) {
    case "BTC Treasury":
      return tokens.amber;
    case "Mining":
      return tokens.emerald;
    case "Exchange":
      return tokens.cyan;
    default:
      return tokens.textDim;
  }
}

// ---------- sector index chart card ----------

function SectorIndexCard({
  sectors,
  active,
  onPick,
  series,
}: {
  sectors: string[];
  active: string;
  onPick: (s: string) => void;
  series: SectorIndexSeries | undefined;
}) {
  return (
    <Card pad={0} className="flex flex-col overflow-hidden">
      <div
        className="flex items-center justify-between"
        style={{
          padding: "10px 14px",
          borderBottom: `1px solid ${tokens.border}`,
          background: tokens.bgElev2,
        }}
      >
        <div>
          <Label>Sector Index</Label>
          <Mono size={10} color={tokens.textFaint}>
            sector vs BTC vs NDX · normalised
          </Mono>
        </div>
        <Tag small color={tokens.emerald} dot>
          {series ? `${series.rows.length}d` : "—"}
        </Tag>
      </div>

      <div
        className="flex flex-wrap"
        style={{
          padding: "10px 14px",
          gap: 6,
          borderBottom: `1px solid ${tokens.borderFaint}`,
        }}
      >
        {sectors.map((s) => {
          const on = s === active;
          return (
            <button
              key={s}
              onClick={() => onPick(s)}
              className="cursor-pointer"
              style={{ background: "none", border: "none", padding: 0 }}
            >
              <Tag small filled={on} color={on ? tokens.text : tokens.textDim}>
                {s}
              </Tag>
            </button>
          );
        })}
      </div>

      <div style={{ padding: 14 }}>
        {series ? <SectorIndexPlot series={series} /> : (
          <Mono size={10}>No data</Mono>
        )}
      </div>

      <div
        className="flex items-center"
        style={{
          padding: "8px 14px",
          gap: 14,
          borderTop: `1px solid ${tokens.border}`,
          background: tokens.bgElev2,
        }}
      >
        <LegendDot color={tokens.cyan} label={active} />
        <LegendDot color={tokens.amber} label="BTC" />
        <LegendDot color={tokens.textDim} label="NDX" />
      </div>
    </Card>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        style={{
          width: 8,
          height: 2,
          background: color,
          borderRadius: 1,
          display: "inline-block",
        }}
      />
      <Mono size={10}>{label}</Mono>
    </div>
  );
}

// ---------- inline SVG line plot ----------

function SectorIndexPlot({ series }: { series: SectorIndexSeries }) {
  const W = 320;
  const H = 180;
  const PAD_L = 4;
  const PAD_R = 4;
  const PAD_T = 6;
  const PAD_B = 18;

  const rows = series.rows;
  if (rows.length < 2) return <Mono size={10}>Not enough points</Mono>;

  // Normalise each series to 100 at t=0 so they share the same axis.
  const sectorBase = rows[0].price || 1;
  const btcBase = rows[0].btc || 1;
  const ndxBase = rows[0].ndx || 1;
  const sectorN = rows.map((r) => (r.price / sectorBase) * 100);
  const btcN = rows.map((r) => (r.btc / btcBase) * 100);
  const ndxN = rows.map((r) => (r.ndx / ndxBase) * 100);

  const allVals = [...sectorN, ...btcN, ...ndxN];
  const min = Math.min(...allVals);
  const max = Math.max(...allVals);
  const span = max - min || 1;

  const x = (i: number) =>
    PAD_L + (i / (rows.length - 1)) * (W - PAD_L - PAD_R);
  const y = (v: number) =>
    PAD_T + (1 - (v - min) / span) * (H - PAD_T - PAD_B);

  const toPath = (vals: number[]) =>
    vals.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");

  const sectorEnd = sectorN[sectorN.length - 1];
  const btcEnd = btcN[btcN.length - 1];
  const ndxEnd = ndxN[ndxN.length - 1];

  // Light horizontal grid at 100 (the baseline).
  const baseline = y(100);

  return (
    <div>
      <svg width={W} height={H} style={{ display: "block" }}>
        <line
          x1={PAD_L}
          x2={W - PAD_R}
          y1={baseline}
          y2={baseline}
          stroke={tokens.borderFaint}
          strokeWidth={1}
          strokeDasharray="2 3"
        />
        <path d={toPath(ndxN)} stroke={tokens.textDim} strokeWidth={1.25} fill="none" />
        <path d={toPath(btcN)} stroke={tokens.amber} strokeWidth={1.25} fill="none" />
        <path d={toPath(sectorN)} stroke={tokens.cyan} strokeWidth={1.5} fill="none" />
        <text
          x={PAD_L}
          y={H - 4}
          fill={tokens.textFaint}
          fontSize={9}
          fontFamily="ui-monospace, monospace"
        >
          {rows[0].date}
        </text>
        <text
          x={W - PAD_R}
          y={H - 4}
          textAnchor="end"
          fill={tokens.textFaint}
          fontSize={9}
          fontFamily="ui-monospace, monospace"
        >
          {rows[rows.length - 1].date}
        </text>
      </svg>
      <div className="flex justify-between" style={{ marginTop: 6 }}>
        <Mono size={10} color={tokens.cyan}>
          {series.sector} {sectorEnd.toFixed(1)}
        </Mono>
        <Mono size={10} color={tokens.amber}>
          BTC {btcEnd.toFixed(1)}
        </Mono>
        <Mono size={10}>
          NDX {ndxEnd.toFixed(1)}
        </Mono>
      </div>
    </div>
  );
}
