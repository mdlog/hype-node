import { Card, Mono, Btn, HypeGauge } from "@/components/ui";
import { tokens } from "@/lib/tokens";
import { getNews, getSectorSpotlight } from "@/lib/api/sosovalue";
import { TrendingNewsCard } from "@/components/publisher/TrendingNewsCard";

export const revalidate = 60;

function fmtRelative(iso: string): string {
  const dt = Date.now() - new Date(iso).getTime();
  const s = Math.max(0, Math.round(dt / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

type Gauge = {
  sector: string;
  score: number;
  change_pct: number;
  news_count: number;
  marketcap_dom: number;
};

/**
 * Composite hype score from three real signals:
 *   - Momentum   = 24h change %, scaled (±5% → ±20 points)
 *   - Velocity   = headline count in the live /news sample (capped + scaled)
 *   - Dominance  = sector's market-cap dominance (real fraction 0..1)
 *
 * Centered at 50 so a flat sector with no news lands at neutral. Result clamped
 * 0..100. The formula is intentionally transparent — same inputs, same score,
 * no hidden weights — and substitutes nothing when SoSoValue lacks a
 * first-class sentiment metric.
 */
function compositeScore({
  change_pct,
  news_count,
  marketcap_dom,
}: {
  change_pct: number;
  news_count: number;
  marketcap_dom: number;
}): number {
  const momentum = change_pct * 4; // ±5% → ±20
  const velocity = Math.min(news_count, 20) * 1.5; // 0..30
  const dominance = marketcap_dom * 100 * 0.3; // 0..30 typical (mcap_dom is fraction)
  return Math.max(0, Math.min(100, Math.round(50 + momentum + velocity + dominance)));
}

export default async function RadarPage() {
  // Two parallel real-data fetches:
  //  - /news with a wide sample so per-sector counts are meaningful
  //  - /currencies/sector-spotlight for raw change_pct_24h + marketcap_dom
  // Both sit behind the 15-min request cache, so this page renders fast on
  // the second hit even though it pulls 100 articles.
  const [liveNews, spotlight] = await Promise.all([
    getNews({ limit: 100 }),
    getSectorSpotlight(),
  ]);

  // Real per-sector article counts derived from the live sample. A sector
  // with zero hits stays at 0 — never substituted with a synthetic count.
  const newsBySector = new Map<string, number>();
  for (const n of liveNews) {
    const k = (n.sector ?? "").toLowerCase();
    if (!k) continue;
    newsBySector.set(k, (newsBySector.get(k) ?? 0) + 1);
  }

  const gauges: Gauge[] = spotlight.sector.slice(0, 8).map((s) => {
    const change_pct = s.change_pct_24h * 100;
    const news_count = newsBySector.get(s.name.toLowerCase()) ?? 0;
    return {
      sector: s.name,
      score: compositeScore({ change_pct, news_count, marketcap_dom: s.marketcap_dom }),
      change_pct: Math.round(change_pct * 100) / 100,
      news_count,
      marketcap_dom: s.marketcap_dom,
    };
  });

  // Banner uses SoSoValue's own narrative spotlight rotation when present —
  // that's their curated "what's trending" signal. Fallback to the highest-
  // scored sector when spotlight is empty. Banner is hidden when nothing
  // crosses the noise floor (no spotlight + no sector above ~65).
  const ssoSpotlight = spotlight.spotlight[0];
  const topGauge = [...gauges].sort((a, b) => b.score - a.score)[0];
  const banner =
    ssoSpotlight && Math.abs(ssoSpotlight.change_pct_24h) > 0.02
      ? {
          source: "spotlight" as const,
          name: ssoSpotlight.name,
          change_pct: ssoSpotlight.change_pct_24h * 100,
          news_count: newsBySector.get(ssoSpotlight.name.toLowerCase()) ?? 0,
        }
      : topGauge && topGauge.score >= 65
        ? {
            source: "top_sector" as const,
            name: topGauge.sector,
            change_pct: topGauge.change_pct,
            news_count: topGauge.news_count,
          }
        : null;

  // Live news stream — first article's sentiment tier classifies importance.
  // `sector` is preserved so the client-side TrendingNewsCard can filter
  // by All / DePIN / RWA / AI without an extra round trip. Trim to 20 items
  // for the render — TrendingNewsCard renders all of them with scrolling.
  const news = liveNews.slice(0, 20).map((n) => ({
    t: fmtRelative(n.ts),
    h: n.title,
    s: n.source,
    sent: n.sentiment,
    imp: n.importance,
    sector: n.sector,
  }));

  // Top sectors panel — replaces the previously hardcoded "Recent hype
  // events" list. Same visual slot, real data: top-5 sectors by composite
  // score with their real change %, news count, and dominance.
  const topSectors = [...gauges].sort((a, b) => b.score - a.score).slice(0, 6);

  return (
    <div className="px-6 py-5 flex flex-col gap-3.5">
      <div className="flex justify-between items-end">
        <div>
          <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>Hype Radar</div>
          <Mono size={11}>
            SoSoValue · /sector-spotlight · /news velocity · refreshed every 60s
          </Mono>
        </div>
        <div className="flex gap-1.5">
          <Btn small>⚙ Tune sensitivity</Btn>
          <Btn small>📥 Pause detection</Btn>
        </div>
      </div>

      {banner && (
        <div
          className="flex items-center gap-3"
          style={{
            padding: "12px 16px",
            background: `linear-gradient(90deg, ${tokens.amber}15, transparent)`,
            border: `1px solid ${tokens.amber}50`,
            borderRadius: 8,
          }}
        >
          <div
            className="animate-[pulse-glow_1.2s_ease-in-out_infinite]"
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: tokens.amber,
              boxShadow: `0 0 12px ${tokens.amber}`,
            }}
          />
          <div className="flex-1">
            <div style={{ fontSize: 13, fontWeight: 600, color: tokens.amber }}>
              {banner.source === "spotlight"
                ? `SoSoValue spotlight — ${banner.name}`
                : `Top sector momentum — ${banner.name}`}
            </div>
            <Mono size={11} color={tokens.textDim}>
              24h Δ {banner.change_pct >= 0 ? "+" : ""}
              {banner.change_pct.toFixed(2)}% · {banner.news_count} headline
              {banner.news_count === 1 ? "" : "s"} in last 100 ·{" "}
              {banner.source === "spotlight"
                ? "SoSoValue narrative rotation"
                : "composite score above threshold"}
            </Mono>
          </div>
        </div>
      )}

      <div className="grid gap-3" style={{ gridTemplateColumns: "1.3fr 1fr" }}>
        <div className="flex flex-col gap-3">
          <Card pad={16}>
            <div className="flex justify-between mb-3.5">
              <div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>Sector hype scores</div>
                <Mono size={10}>
                  composite = momentum + velocity + dominance · all real signals
                </Mono>
              </div>
              <Mono size={10}>{spotlight.sector.length} sectors live</Mono>
            </div>
            <div className="grid grid-cols-4 gap-3.5">
              {gauges.map((g) => (
                <div
                  key={g.sector}
                  className="flex flex-col items-center gap-1.5"
                  style={{
                    padding: 12,
                    background:
                      g.score > 80
                        ? tokens.red + "08"
                        : g.score > 60
                          ? tokens.amber + "06"
                          : tokens.bgElev2,
                    border: `1px solid ${
                      g.score > 80
                        ? tokens.red + "40"
                        : g.score > 60
                          ? tokens.amber + "40"
                          : tokens.border
                    }`,
                    borderRadius: 8,
                  }}
                >
                  <HypeGauge score={g.score} sector={g.sector} size={84} />
                  <div className="flex gap-2 justify-center">
                    <Mono
                      size={9.5}
                      color={g.change_pct >= 0 ? tokens.emerald : tokens.red}
                    >
                      {g.change_pct >= 0 ? "+" : ""}
                      {g.change_pct.toFixed(2)}%
                    </Mono>
                    <Mono size={9.5}>
                      {g.news_count} news
                    </Mono>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <TrendingNewsCard news={news} />
        </div>

        <div className="flex flex-col gap-3">
          <Card pad={16}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
              Hype detection thresholds
            </div>
            <Mono size={10} className="block mb-2.5">
              composite score gates · agent draft path
            </Mono>
            {(
              [
                ["Composite score ≥ 65 → banner highlight", tokens.emerald],
                ["Sector momentum (24h) ≥ +3% counts toward score", tokens.emerald],
                ["News velocity capped at 20/sample (1.5pt each)", tokens.emerald],
                ["SoSoValue spotlight rotation override (always shown)", tokens.emerald],
                ["Background loop drafts when sentiment proxy ≥ 60", tokens.amber],
              ] as const
            ).map(([r, c], i) => (
              <div
                key={i}
                className="flex items-center gap-2"
                style={{
                  padding: "5px 0",
                  borderBottom: `1px solid ${tokens.borderFaint}`,
                }}
              >
                <div
                  className="flex items-center justify-center"
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: 3,
                    background: c + "20",
                    border: `1px solid ${c}40`,
                  }}
                >
                  <svg width={8} height={8} viewBox="0 0 8 8">
                    <path
                      d="M 1 4 L 3 6 L 7 2"
                      fill="none"
                      stroke={c}
                      strokeWidth={1.5}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
                <div style={{ fontSize: 11.5, color: tokens.text, flex: 1 }}>{r}</div>
              </div>
            ))}
          </Card>

          <Card pad={0} className="flex-1 overflow-hidden flex flex-col">
            <div
              style={{
                padding: "12px 16px",
                borderBottom: `1px solid ${tokens.border}`,
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              Top sectors by composite score
            </div>
            <div className="flex-1 overflow-y-auto">
              {topSectors.map((s) => {
                const c =
                  s.score > 80 ? tokens.red : s.score > 60 ? tokens.amber : tokens.emerald;
                return (
                  <div
                    key={s.sector}
                    style={{
                      padding: "10px 16px",
                      borderBottom: `1px solid ${tokens.borderFaint}`,
                    }}
                  >
                    <div className="flex justify-between mb-0.5">
                      <div className="flex items-center gap-1.5">
                        <div
                          style={{
                            width: 5,
                            height: 5,
                            borderRadius: "50%",
                            background: c,
                          }}
                        />
                        <div
                          style={{ fontSize: 12, fontWeight: 600, color: tokens.text }}
                        >
                          {s.sector}
                        </div>
                      </div>
                      <Mono size={10} color={c}>
                        {s.score}
                      </Mono>
                    </div>
                    <Mono size={10} className="mt-0.5 block">
                      24h {s.change_pct >= 0 ? "+" : ""}
                      {s.change_pct.toFixed(2)}% · {s.news_count} headline
                      {s.news_count === 1 ? "" : "s"} · mcap dom{" "}
                      {(s.marketcap_dom * 100).toFixed(2)}%
                    </Mono>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
