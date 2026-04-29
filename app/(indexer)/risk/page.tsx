import { Card, Mono, Tag, Meter } from "@/components/ui";
import { tokens } from "@/lib/tokens";
import {
  getSsiKlines,
  getSsiConstituents,
  getSectorScores,
} from "@/lib/api/sosovalue";
import { closesFromKlines, computeMetrics } from "@/lib/metrics";
import { RiskRules } from "@/components/live/RiskRules";

export const revalidate = 60;

const FEATURED = "ssiDePIN";
const TARGET_SECTOR = "DePIN";

const VOL_LIMIT = 0.35;
const DD_LIMIT = 0.15;
const WEIGHT_CAP = 0.25;
const SENT_DELTA_FLOOR = -20;

function pctValue(n: number): string {
  return `${(n * 100).toFixed(2)}%`;
}

export default async function RiskPage() {
  // 100% SoSoValue. Volatility / drawdown / top-asset-weight derived from
  // ssiDePIN klines + constituents. Sentiment Δ from sector spotlight.
  const [klines, constituents, sectors] = await Promise.all([
    getSsiKlines(FEATURED, { limit: 90 }),
    getSsiConstituents(FEATURED),
    getSectorScores(),
  ]);
  const closes = closesFromKlines(klines);
  const metrics = computeMetrics(closes);

  const topWeight = constituents.reduce((m, c) => (c.weight > m ? c.weight : m), 0);
  const topAsset = constituents.find((c) => c.weight === topWeight);

  const sectorRow =
    sectors.find((s) => s.sector.toLowerCase() === TARGET_SECTOR.toLowerCase()) ??
    sectors[0];
  const sentDelta = sectorRow?.delta ?? 0;

  const vol = metrics.volatility;
  const drawdown = Math.abs(metrics.max_drawdown);

  const thresholds = [
    {
      k: "Volatility (σ, 90d annualized)",
      v: vol.toFixed(2),
      prog: Math.min(1, vol / VOL_LIMIT),
      c: vol >= VOL_LIMIT ? tokens.red : vol >= VOL_LIMIT * 0.8 ? tokens.amber : tokens.emerald,
    },
    {
      k: "Max drawdown",
      v: pctValue(-drawdown),
      prog: Math.min(1, drawdown / DD_LIMIT),
      c:
        drawdown >= DD_LIMIT
          ? tokens.red
          : drawdown >= DD_LIMIT * 0.8
            ? tokens.amber
            : tokens.emerald,
    },
    {
      k: `Sentiment Δ (${TARGET_SECTOR}, 24h)`,
      v: `${sentDelta >= 0 ? "+" : ""}${sentDelta}`,
      prog: Math.min(1, Math.max(0, -sentDelta / Math.abs(SENT_DELTA_FLOOR))),
      c:
        sentDelta <= SENT_DELTA_FLOOR
          ? tokens.red
          : sentDelta < 0
            ? tokens.amber
            : tokens.emerald,
    },
    {
      k: `Single-asset weight (top: ${topAsset?.symbol.toUpperCase() ?? "—"})`,
      v: `${(topWeight * 100).toFixed(1)} / ${(WEIGHT_CAP * 100).toFixed(0)}%`,
      prog: Math.min(1, topWeight / WEIGHT_CAP),
      c:
        topWeight >= WEIGHT_CAP
          ? tokens.red
          : topWeight >= WEIGHT_CAP * 0.8
            ? tokens.amber
            : tokens.emerald,
    },
    {
      k: "Win rate (90d)",
      v: `${(metrics.win_rate * 100).toFixed(0)}%`,
      prog: metrics.win_rate,
      c:
        metrics.win_rate >= 0.55
          ? tokens.emerald
          : metrics.win_rate >= 0.45
            ? tokens.amber
            : tokens.red,
    },
    {
      k: "Sharpe (90d)",
      v: metrics.sharpe.toFixed(2),
      prog: Math.min(1, Math.max(0, metrics.sharpe / 3)),
      c:
        metrics.sharpe >= 1.5
          ? tokens.emerald
          : metrics.sharpe >= 0.5
            ? tokens.amber
            : tokens.red,
    },
  ];

  const breaches = thresholds.filter((t) => t.c === tokens.red).length;
  const warnings = thresholds.filter((t) => t.c === tokens.amber).length;
  const status = breaches > 0 ? "breach" : warnings > 0 ? "watch" : "nominal";
  const statusColor =
    status === "breach" ? tokens.red : status === "watch" ? tokens.amber : tokens.emerald;
  const statusLabel =
    status === "breach"
      ? `${breaches} BREACH${breaches > 1 ? "ES" : ""}`
      : status === "watch"
        ? `${warnings} WATCHING`
        : "ALL SYSTEMS NOMINAL";

  const flow = [
    {
      l: "Monitor negative news",
      s: "/news + /currencies/sector-spotlight",
      c: tokens.textDim,
    },
    { l: "Volatility > threshold?", s: `σ > ${VOL_LIMIT} for 30m`, c: tokens.amber },
    { l: "Unwind via DEX", s: "market sells, 0.5% slippage cap", c: tokens.red },
    { l: "Wrap → USSI hedge", s: "hedged basket · await recovery", c: tokens.red },
  ];

  return (
    <div className="px-6 py-5 flex flex-col gap-3.5">
      <div className="flex justify-between items-end">
        <div>
          <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>
            Risk Control
          </div>
          <Mono size={11}>
            metrics derived from {FEATURED} · {closes.length} klines · GET /indices/
            {FEATURED}/klines + /constituents
          </Mono>
        </div>
        <div
          className="flex items-center gap-2.5"
          style={{
            padding: "8px 14px",
            background: statusColor + "10",
            border: `1px solid ${statusColor}40`,
            borderRadius: 8,
          }}
        >
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: statusColor,
              boxShadow: `0 0 10px ${statusColor}`,
            }}
          />
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: statusColor,
              letterSpacing: "0.04em",
            }}
          >
            {statusLabel}
          </div>
          <Mono size={10}>
            {breaches} red · {warnings} amber
          </Mono>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Card pad={16}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14 }}>
            Thresholds (live · SSI)
          </div>
          {thresholds.map((t, i) => (
            <div key={i} className="mb-3.5">
              <div className="flex justify-between mb-1">
                <div style={{ fontSize: 12, color: tokens.text }}>{t.k}</div>
                <Mono size={11} color={t.c}>
                  {t.v}
                </Mono>
              </div>
              <Meter v={t.prog} color={t.c} h={5} />
            </div>
          ))}
        </Card>

        <Card pad={16}>
          <div className="flex justify-between mb-1.5">
            <div style={{ fontSize: 13, fontWeight: 600 }}>Emergency Exit Route</div>
            <Tag small color={tokens.red} dot>armed</Tag>
          </div>
          <Mono size={10} className="block mb-3.5">→ USSI hedged index on trigger</Mono>
          <div className="relative">
            {flow.map((n, i) => (
              <div key={i} className="mb-2.5">
                <div
                  style={{
                    padding: "10px 12px",
                    background: `${n.c}10`,
                    border: `1px solid ${n.c}40`,
                    borderRadius: 6,
                  }}
                >
                  <div className="flex items-center gap-2 mb-0.5">
                    <Mono size={9} color={n.c}>STEP {i + 1}</Mono>
                    <div style={{ width: 5, height: 5, borderRadius: "50%", background: n.c }} />
                  </div>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: tokens.text }}>{n.l}</div>
                  <Mono size={10}>{n.s}</Mono>
                </div>
                {i < 3 && (
                  <div
                    style={{
                      width: 1,
                      height: 12,
                      background: tokens.border,
                      marginLeft: 20,
                    }}
                  />
                )}
              </div>
            ))}
          </div>
        </Card>

        <RiskRules />
      </div>
    </div>
  );
}
