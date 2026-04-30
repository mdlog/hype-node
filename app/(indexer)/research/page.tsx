import { Label, Metric, Mono, Tag, Btn } from "@/components/ui";
import { tokens } from "@/lib/tokens";
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

  // Cards are pure projections of real /news rows: title, source, sentiment
  // proxy, sector tag, importance rail. No synthetic per-article series, no
  // fabricated fund-flow numbers — SoSoValue does not expose either.
  const cards = news.slice(0, 8).map((n) => ({
    sector: n.sector,
    title: n.title,
    src: `${n.source} · ${fmtRelative(n.ts)}`,
    sent: n.sentiment,
    strong: n.importance === "high",
  }));

  // Sector momentum strip — real change_pct_24h from /sector-spotlight (via
  // getSectorScores). `delta` is pct*2 (see lib/api/sosovalue.ts) so divide
  // back for a faithful display. Color/intensity track the sign + magnitude.
  const sectorStrip = [...sectors]
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 8)
    .map((s) => {
      const pct = s.delta / 2; // recover real change_pct_24h percentage
      const mag = Math.min(1, Math.abs(pct) / 5); // 5% → full intensity
      return { sector: s.sector, pct, mag };
    });

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
              Real news headlines from /news · sector momentum from /sector-spotlight · no synthetic projections
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
                  <Label>Sector</Label>
                  <Mono size={13} color={tokens.text}>
                    {e.sector}
                  </Mono>
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
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Sector momentum (24h)</div>
        <Mono size={10} className="block mb-2.5">
          real change_pct_24h from /sector-spotlight
        </Mono>
        <div className="grid grid-cols-2 gap-1.5 mb-4">
          {sectorStrip.map((s) => {
            const positive = s.pct >= 0;
            const base = positive ? tokens.emerald : tokens.red;
            // Hex alpha 26..FF based on magnitude (0..1) for intensity.
            const alpha = Math.round(38 + s.mag * 217)
              .toString(16)
              .padStart(2, "0");
            return (
              <div
                key={s.sector}
                style={{
                  padding: "8px 10px",
                  background: base + alpha,
                  border: `1px solid ${base}50`,
                  borderRadius: 6,
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                }}
              >
                <div style={{ fontSize: 11, fontWeight: 600, color: tokens.text }}>
                  {s.sector}
                </div>
                <Mono size={10} color={positive ? tokens.emerald : tokens.red}>
                  {positive ? "+" : ""}
                  {s.pct.toFixed(2)}%
                </Mono>
              </div>
            );
          })}
        </div>
        <Label className="mb-2">SECTOR SCORES</Label>
        {sectors.slice(0, 6).map((s) => {
          const pct = s.delta / 2;
          const c = pct >= 0 ? tokens.emerald : tokens.red;
          return (
            <div
              key={s.sector}
              style={{ padding: "8px 0", borderBottom: `1px solid ${tokens.borderFaint}` }}
            >
              <div className="flex justify-between mb-1">
                <div style={{ fontSize: 12, color: tokens.text }}>{s.sector}</div>
                <Mono size={11} color={c}>
                  {pct >= 0 ? "+" : ""}
                  {pct.toFixed(2)}%
                </Mono>
              </div>
              <Mono size={10} color={tokens.textDim}>
                composite score {s.score}
              </Mono>
            </div>
          );
        })}
      </div>
    </div>
  );
}
