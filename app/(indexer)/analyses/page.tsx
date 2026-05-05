// Analysis Charts page.
// ---------------------
// Lists every analysis chart exposed by SoSoValue's GET /analyses endpoint.
// Each metadata entry becomes a card showing the chart name, declared field
// schema, and a mini SVG line chart of the first numeric field over the
// last 90 daily samples (no chart library — inline path math only).
//
// Deep-linking: a `?chart=<chart_name>` param expands the matching card
// into a detail panel with a larger chart + a tabular view of the rows.
// Server component end-to-end so URL state survives reloads / share links.

import Link from "next/link";

import { Card, Label, Mono, Tag, Btn } from "@/components/ui";
import { tokens } from "@/lib/tokens";
import {
  listChartMetadata,
  getChartData,
  type ChartMetadata,
  type ChartRow,
  type ChartField,
} from "@/lib/api/sosovalue/analyses";

export const revalidate = 60;

type SearchParams = { chart?: string };

export default async function AnalysesPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const metadata = await listChartMetadata();

  // Pick the active chart for the detail pane. Validate the URL param so a
  // stale / hand-typed `?chart=...` never crashes the page.
  const requested = searchParams?.chart;
  const knownNames = new Set(metadata.map((m) => m.chart_name));
  const activeName =
    requested && knownNames.has(requested) ? requested : null;

  // Fetch a 90-row series for each card's mini chart in parallel. The
  // per-path cache in `request<T>` dedups & caches across calls so this
  // only burns one quota slot per chart_name on cold render.
  const dataByChart = await Promise.all(
    metadata.map(async (m) => ({
      meta: m,
      rows: await getChartData(m.chart_name, { limit: 90 }).catch(() => [] as ChartRow[]),
    })),
  );

  const active = activeName
    ? dataByChart.find((d) => d.meta.chart_name === activeName)
    : null;

  const liveCount = dataByChart.filter((d) => d.rows.length > 0).length;

  return (
    <div className="px-6 py-5 flex flex-col gap-4">
      <div className="flex justify-between items-end">
        <div>
          <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>
            Analysis Charts
          </div>
          <Mono size={11}>
            {metadata.length} charts · {liveCount} with data · GET /analyses
          </Mono>
        </div>
        <div className="flex gap-1.5">
          <Tag small color={liveCount > 0 ? tokens.emerald : tokens.textFaint} dot>
            {liveCount > 0 ? "loaded" : "fallback"}
          </Tag>
          {activeName ? (
            <Link href="/analyses" style={{ textDecoration: "none" }}>
              <Btn small>Close detail</Btn>
            </Link>
          ) : null}
        </div>
      </div>

      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
        {dataByChart.map(({ meta, rows }) => {
          const firstNumericField = pickPrimaryField(meta);
          const isActive = meta.chart_name === activeName;
          return (
            <ChartCard
              key={meta.chart_name}
              meta={meta}
              rows={rows}
              field={firstNumericField}
              active={isActive}
            />
          );
        })}
      </div>

      {active ? (
        <DetailPanel
          meta={active.meta}
          rows={active.rows}
          field={pickPrimaryField(active.meta)}
        />
      ) : null}
    </div>
  );
}

// ---------- card ----------

function ChartCard({
  meta,
  rows,
  field,
  active,
}: {
  meta: ChartMetadata;
  rows: ChartRow[];
  field: ChartField | null;
  active: boolean;
}) {
  const fieldName = field?.name ?? null;
  const series = fieldName ? rows.map((r) => num(r[fieldName])) : [];
  const latest = series.length > 0 ? series[series.length - 1] : 0;
  const baseline = series.length > 1 ? series[0] : latest;
  const delta = baseline !== 0 ? ((latest - baseline) / Math.abs(baseline)) * 100 : 0;
  const deltaColor = delta >= 0 ? tokens.emerald : tokens.red;

  return (
    <Card
      pad={0}
      className="overflow-hidden"
      style={{
        border: `1px solid ${active ? tokens.emerald : tokens.border}`,
        boxShadow: active ? `0 0 0 1px ${tokens.emerald}30` : undefined,
      }}
    >
      <Link
        href={active ? "/analyses" : `/analyses?chart=${encodeURIComponent(meta.chart_name)}`}
        scroll={false}
        style={{ textDecoration: "none", color: "inherit", display: "block" }}
      >
        <div
          className="flex items-start justify-between"
          style={{ padding: "12px 16px", borderBottom: `1px solid ${tokens.border}` }}
        >
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: tokens.text }}>
              {prettyTitle(meta.chart_name)}
            </div>
            <Mono size={10} color={tokens.textFaint}>
              {meta.chart_name}
            </Mono>
          </div>
          <Tag small color={active ? tokens.emerald : tokens.textDim}>
            {active ? "Active" : `${meta.fields.length} fields`}
          </Tag>
        </div>

        <div
          className="flex items-center justify-between"
          style={{ padding: "10px 16px 4px" }}
        >
          <div>
            <Label>{fieldName ? fieldName.toUpperCase() : "—"}</Label>
            <div
              style={{
                fontSize: 18,
                fontWeight: 600,
                color: tokens.text,
                letterSpacing: "-0.02em",
                marginTop: 2,
              }}
            >
              {fieldName ? fmtAuto(latest, fieldName) : "—"}
            </div>
          </div>
          <Mono size={11} color={deltaColor}>
            {fmtPct(delta)} (window)
          </Mono>
        </div>

        <div style={{ padding: "0 16px" }}>
          {series.length > 1 ? (
            <MiniLine values={series} color={tokens.emerald} w={460} h={70} />
          ) : (
            <div
              style={{
                height: 70,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: tokens.textFaint,
              }}
            >
              <Mono size={10} color={tokens.textFaint}>
                no series data
              </Mono>
            </div>
          )}
        </div>

        <div
          className="flex flex-wrap items-center"
          style={{
            gap: "4px 6px",
            padding: "8px 16px 12px",
            borderTop: `1px solid ${tokens.borderFaint}`,
          }}
        >
          {meta.fields.map((f) => (
            <Tag key={f.name} small color={tokens.textDim}>
              {f.name}
            </Tag>
          ))}
        </div>
      </Link>
    </Card>
  );
}

// ---------- detail panel ----------

function DetailPanel({
  meta,
  rows,
  field,
}: {
  meta: ChartMetadata;
  rows: ChartRow[];
  field: ChartField | null;
}) {
  const fieldName = field?.name ?? null;
  const series = fieldName ? rows.map((r) => num(r[fieldName])) : [];

  // Tabular view trims to last 30 rows (newest first) so the page stays
  // scannable. The mini chart still represents the full window.
  const tableRows = [...rows].slice(-30).reverse();
  const numericFieldNames = meta.fields
    .filter((f) => f.type === "number" || f.type === "integer")
    .map((f) => f.name);

  return (
    <Card pad={0} className="overflow-hidden">
      <div
        className="flex items-start justify-between"
        style={{ padding: "14px 16px", borderBottom: `1px solid ${tokens.border}` }}
      >
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, color: tokens.text }}>
            {prettyTitle(meta.chart_name)} · detail
          </div>
          <Mono size={10} color={tokens.textFaint}>
            time field {meta.time_field} · {rows.length} samples · ?chart={meta.chart_name}
          </Mono>
        </div>
        <Link href="/analyses" style={{ textDecoration: "none" }}>
          <Btn small>×</Btn>
        </Link>
      </div>

      <div style={{ padding: "16px" }}>
        {series.length > 1 ? (
          <BigLine
            rows={rows}
            values={series}
            color={tokens.emerald}
            label={fieldName ?? "value"}
          />
        ) : (
          <Mono size={11} color={tokens.textFaint}>
            no data for this chart
          </Mono>
        )}
      </div>

      <div
        className="grid"
        style={{
          gridTemplateColumns: `120px repeat(${numericFieldNames.length}, minmax(0, 1fr))`,
          padding: "8px 16px",
          gap: 12,
          borderTop: `1px solid ${tokens.border}`,
          background: tokens.bgElev2,
        }}
      >
        <Label>DATE</Label>
        {numericFieldNames.map((n) => (
          <Label key={n}>{n.toUpperCase()}</Label>
        ))}
      </div>
      <div style={{ maxHeight: 320, overflowY: "auto" }}>
        {tableRows.map((r, i) => (
          <div
            key={i}
            className="grid"
            style={{
              gridTemplateColumns: `120px repeat(${numericFieldNames.length}, minmax(0, 1fr))`,
              padding: "8px 16px",
              gap: 12,
              borderBottom: `1px solid ${tokens.borderFaint}`,
              alignItems: "center",
            }}
          >
            <Mono size={10.5} color={tokens.text}>
              {fmtMmmDd(num(r.timestamp))}
            </Mono>
            {numericFieldNames.map((n) => (
              <Mono key={n} size={10.5} color={tokens.text}>
                {fmtAuto(num(r[n]), n)}
              </Mono>
            ))}
          </div>
        ))}
      </div>
    </Card>
  );
}

// ---------- inline charts ----------

function MiniLine({
  values,
  color,
  w,
  h,
}: {
  values: number[];
  color: string;
  w: number;
  h: number;
}) {
  if (values.length < 2) return null;
  const pad = 6;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const rng = max - min || 1;
  const xFor = (i: number) => pad + (i / (values.length - 1)) * (w - pad * 2);
  const yFor = (v: number) => h - pad - ((v - min) / rng) * (h - pad * 2);
  const d = values
    .map((v, i) => `${i === 0 ? "M" : "L"} ${xFor(i).toFixed(1)} ${yFor(v).toFixed(1)}`)
    .join(" ");
  const area = `${d} L ${xFor(values.length - 1).toFixed(1)} ${h - pad} L ${xFor(0).toFixed(1)} ${h - pad} Z`;
  return (
    <svg width={w} height={h} className="block" style={{ width: "100%", height: h }}>
      <path d={area} fill={color} fillOpacity={0.12} />
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} />
    </svg>
  );
}

function BigLine({
  rows,
  values,
  color,
  label,
}: {
  rows: ChartRow[];
  values: number[];
  color: string;
  label: string;
}) {
  const w = 760;
  const h = 260;
  const padL = 64;
  const padR = 12;
  const padT = 10;
  const padB = 26;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const rng = max - min || 1;

  const xFor = (i: number) => padL + (i / Math.max(1, values.length - 1)) * innerW;
  const yFor = (v: number) => padT + innerH - ((v - min) / rng) * innerH;

  const d = values
    .map((v, i) => `${i === 0 ? "M" : "L"} ${xFor(i).toFixed(1)} ${yFor(v).toFixed(1)}`)
    .join(" ");
  const area = `${d} L ${xFor(values.length - 1).toFixed(1)} ${padT + innerH} L ${xFor(0).toFixed(1)} ${padT + innerH} Z`;

  const ticks = 4;
  const yTicks = Array.from({ length: ticks + 1 }, (_, i) => min + (rng * i) / ticks);
  const xLabelIdx = pickIndices(values.length, 6);

  return (
    <div>
      <Mono size={10} color={tokens.textFaint} style={{ marginBottom: 6, display: "block" }}>
        {label} · {values.length} samples · min {fmtAuto(min, label)} · max {fmtAuto(max, label)}
      </Mono>
      <svg width={w} height={h} className="block" style={{ maxWidth: "100%", height: "auto" }}>
        {yTicks.map((t, i) => {
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
                {fmtAuto(t, label)}
              </text>
            </g>
          );
        })}
        <path d={area} fill={color} fillOpacity={0.12} />
        <path d={d} fill="none" stroke={color} strokeWidth={1.5} />
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
            {fmtMmmDd(num(rows[i]?.timestamp ?? 0))}
          </text>
        ))}
      </svg>
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

// Pick the first numeric field on the metadata. Caller uses this for the
// mini-line series + for the big-chart in the detail panel. Returns null
// if there's no numeric field (degenerate metadata — defensive only).
function pickPrimaryField(meta: ChartMetadata): ChartField | null {
  return (
    meta.fields.find((f) => f.type === "number" || f.type === "integer") ??
    meta.fields[0] ??
    null
  );
}

// Title-case the chart_name for display, replacing underscores with spaces.
function prettyTitle(name: string): string {
  return name
    .split("_")
    .map((w) => (w.length === 0 ? "" : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}

// Format a numeric value based on its field name. Price-like fields (mcap /
// inflow / assets / price / tvl) get $ formatting; everything else falls
// back to short numeric form.
function fmtAuto(v: number, fieldName: string): string {
  const lower = fieldName.toLowerCase();
  const looksUsd =
    lower.includes("mcap") ||
    lower.includes("cap") ||
    lower.includes("inflow") ||
    lower.includes("outflow") ||
    lower.includes("flow") ||
    lower.includes("asset") ||
    lower.includes("price") ||
    lower.includes("tvl") ||
    lower === "usdt" ||
    lower === "usdc" ||
    lower === "usds" ||
    lower === "usde" ||
    lower === "pyusd" ||
    lower === "usdd";
  if (looksUsd) return fmtUsdShort(v);
  return fmtNumShort(v);
}

function fmtUsdShort(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (abs >= 1_000_000_000_000) return `${sign}$${(abs / 1_000_000_000_000).toFixed(2)}T`;
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(2)}`;
}

function fmtNumShort(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (abs >= 1_000_000_000) return `${sign}${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)}K`;
  return `${sign}${abs.toFixed(2)}`;
}

function fmtPct(n: number): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmtMmmDd(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  const d = new Date(ms);
  return `${MONTH_ABBR[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, "0")}`;
}

function pickIndices(length: number, count: number): number[] {
  if (length <= count) return Array.from({ length }, (_, i) => i);
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    out.push(Math.round((i / (count - 1)) * (length - 1)));
  }
  return out;
}
