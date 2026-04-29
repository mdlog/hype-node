import { Card, Label, Metric, Mono, Tag, Btn, Spark, LineChart, Meter } from "@/components/ui";
import { tokens } from "@/lib/tokens";
import { fakeSeries } from "@/lib/fake-data";
import { getNews, getSectorScores } from "@/lib/api/sosovalue";

export const revalidate = 60;

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

export default async function ResearchPage() {
  const [news, sectors] = await Promise.all([getNews({ limit: 12 }), getSectorScores()]);
  // Render the top-N news as live cards, falling back to deterministic flow
  // labels (we don't have per-article fund flow yet — that's coming once we
  // wire the per-asset SoSoValue endpoints).
  const cards = news.slice(0, 8).map((n, i) => ({
    sector: n.sector,
    title: n.title,
    src: `${n.source} · ${fmtRelative(n.ts)}`,
    sent: n.sentiment,
    flow: n.sentiment > 50 ? `+$${(2 + i * 1.4).toFixed(1)}M` : `−$${(1 + i * 0.6).toFixed(1)}M`,
    strong: n.importance === "high",
    data: fakeSeries(20, 100, 0.05, 3 + i),
  }));

  // Top sector flows derived from live SoSoValue sector scores — bigger
  // |delta| means more movement either direction. Visual weight = score/100.
  const sortedSectors = [...sectors].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const flows: [string, string, string, number][] = sortedSectors.slice(0, 5).map((s) => [
    s.sector,
    `${s.delta >= 0 ? "+" : "−"}$${Math.abs(s.delta * 1.2).toFixed(1)}M`,
    s.delta >= 0 ? tokens.emerald : tokens.red,
    Math.min(1, s.score / 100),
  ]);

  return (
    <div className="grid h-[calc(100vh-48px)]" style={{ gridTemplateColumns: "240px 1fr 320px" }}>
      <div className="overflow-y-auto" style={{ padding: 16, borderRight: `1px solid ${tokens.border}` }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Filters</div>
        <Label className="mb-1.5">Sector</Label>
        <div className="flex flex-wrap gap-1 mb-3.5">
          {["DePIN", "RWA", "AI", "DeFi", "L2", "Memes", "Gaming", "NFT"].map((s, i) => (
            <Tag key={s} small color={i < 3 ? tokens.emerald : tokens.textDim} filled={i < 3}>
              {s}
            </Tag>
          ))}
        </div>
        <Label className="mb-1.5">Sentiment</Label>
        <div
          style={{
            padding: "8px 10px",
            background: tokens.bgElev,
            border: `1px solid ${tokens.border}`,
            borderRadius: 6,
            marginBottom: 14,
          }}
        >
          <div className="flex justify-between mb-1.5">
            <Mono size={10}>−50</Mono>
            <Mono size={10} color={tokens.emerald}>+40 → +100</Mono>
            <Mono size={10}>+100</Mono>
          </div>
          <div style={{ height: 4, background: tokens.bgElev2, borderRadius: 2, position: "relative" }}>
            <div
              style={{
                position: "absolute",
                left: "60%",
                right: 0,
                top: 0,
                bottom: 0,
                background: tokens.emerald,
                borderRadius: 2,
              }}
            />
          </div>
        </div>
        <Label className="mb-1.5">Fund flow</Label>
        <div className="flex gap-1 mb-3.5">
          <Tag small color={tokens.emerald} filled>Inflow</Tag>
          <Tag small>Neutral</Tag>
          <Tag small color={tokens.red}>Outflow</Tag>
        </div>
        <Label className="mb-1.5">Timeframe</Label>
        <div className="flex gap-1 mb-3.5">
          {["1H", "4H", "24H", "7D"].map((t, i) => (
            <Tag key={t} small filled={i === 2} color={i === 2 ? tokens.text : tokens.textDim}>
              {t}
            </Tag>
          ))}
        </div>
        <Label className="mb-1.5">Signal strength</Label>
        <div className="flex gap-1 mb-3.5">
          <Tag small color={tokens.red} filled>Strong</Tag>
          <Tag small color={tokens.amber}>Medium</Tag>
          <Tag small>Weak</Tag>
        </div>
        <div style={{ height: 1, background: tokens.border, margin: "14px 0" }} />
        <Btn small className="w-full justify-center mb-1.5" style={{ width: "100%", justifyContent: "center" }}>
          Reset filters
        </Btn>
        <Btn small primary className="w-full justify-center" style={{ width: "100%", justifyContent: "center" }}>
          Save preset
        </Btn>
      </div>

      <div className="overflow-y-auto" style={{ padding: 20 }}>
        <div className="flex justify-between items-end mb-3.5">
          <div>
            <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.02em" }}>Research Feed</div>
            <Mono size={10}>
              live stream · SoSoValue Terminal · {news.length} signals
            </Mono>
          </div>
          <div className="flex gap-1.5">
            <Btn small icon={<div style={{ width: 6, height: 6, background: tokens.red, borderRadius: "50%" }} />}>
              Live
            </Btn>
            <Btn small>Replay</Btn>
          </div>
        </div>
        <div className="flex flex-col gap-2.5">
          {cards.map((e, i) => (
            <div
              key={i}
              style={{
                background: tokens.bgElev,
                border: `1px solid ${e.strong ? tokens.emerald + "50" : tokens.border}`,
                borderRadius: 10,
                padding: 14,
                boxShadow: e.strong ? `0 0 0 1px rgba(16,185,129,0.14)` : undefined,
              }}
            >
              <div className="flex justify-between items-center mb-1.5">
                <div className="flex gap-1.5 items-center">
                  <Tag small color={tokens.emerald} filled>
                    {e.sector}
                  </Tag>
                  {e.strong && (
                    <Tag small color={tokens.amber} dot>
                      Strong signal
                    </Tag>
                  )}
                  <Mono size={10}>{e.src}</Mono>
                </div>
                <Spark data={e.data} w={80} h={22} color={e.sent > 0 ? tokens.emerald : tokens.red} fill={false} />
              </div>
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 500,
                  color: tokens.text,
                  marginBottom: 10,
                  letterSpacing: "-0.01em",
                }}
              >
                {e.title}
              </div>
              <div className="flex items-center gap-4">
                <div>
                  <Label>Sentiment</Label>
                  <Metric
                    v={`${e.sent > 0 ? "+" : ""}${e.sent}`}
                    size={18}
                    color={e.sent > 0 ? tokens.emerald : tokens.red}
                  />
                </div>
                <div style={{ width: 1, height: 30, background: tokens.border }} />
                <div>
                  <Label>Net flow (24h)</Label>
                  <Metric
                    v={e.flow}
                    size={18}
                    color={e.flow.startsWith("+") ? tokens.emerald : tokens.red}
                  />
                </div>
                <div className="flex-1" />
                <Btn small>Analyze</Btn>
                <Btn small>+ Watchlist</Btn>
                <Btn small primary>→ Build index</Btn>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div
        className="overflow-y-auto"
        style={{ padding: 16, borderLeft: `1px solid ${tokens.border}` }}
      >
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Fund Flow Heatmap</div>
        <div className="grid grid-cols-4 gap-1 mb-4">
          {Array.from({ length: 32 }).map((_, i) => {
            const v = ((i * 17) % 100) / 100 - 0.3;
            const c =
              v > 0.2
                ? tokens.emerald
                : v > 0
                  ? tokens.emerald + "80"
                  : v > -0.2
                    ? tokens.amber + "60"
                    : tokens.red + "60";
            return (
              <div
                key={i}
                style={{ aspectRatio: "1 / 1", background: c, borderRadius: 3 }}
              />
            );
          })}
        </div>
        <Label className="mb-2">TOP FLOWS (NET)</Label>
        {flows.map(([s, v, c, w], i) => (
          <div key={i} style={{ padding: "8px 0", borderBottom: `1px solid ${tokens.borderFaint}` }}>
            <div className="flex justify-between mb-1">
              <div style={{ fontSize: 12, color: tokens.text }}>{s}</div>
              <Mono size={11} color={c}>
                {v}
              </Mono>
            </div>
            <Meter v={w} color={c} h={3} />
          </div>
        ))}
        <Label className="mt-4 mb-2">AI SENTIMENT Δ (1H)</Label>
        <div
          style={{
            padding: 10,
            background: tokens.bgElev2,
            borderRadius: 6,
            border: `1px solid ${tokens.border}`,
          }}
        >
          <LineChart
            w={260}
            h={100}
            series={[{ data: fakeSeries(40, 60, 0.08, 2), color: tokens.cyan, thick: true, fill: true }]}
          />
        </div>
      </div>
    </div>
  );
}
