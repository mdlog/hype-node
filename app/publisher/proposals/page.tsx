import Link from "next/link";
import { Card, Mono, Tag, Btn, HypeGauge } from "@/components/ui";
import { tokens } from "@/lib/tokens";
import { getSectorScores, sectorToSsi } from "@/lib/api/sosovalue";
import { proposeBasket, type BasketProposal } from "@/lib/api/agent";

export const revalidate = 60;

const palette = [
  tokens.emerald,
  tokens.cyan,
  tokens.amber,
  "#a78bfa",
  "#34d399",
  "#60a5fa",
  "#fbbf24",
  "#f472b6",
];

type SectorScore = { sector: string; score: number; delta: number; news: number };

type Proposal = {
  id: string;
  ticker: string;
  sector: string;
  name: string;
  composite: number;
  momentumLabel: "POSITIVE" | "NEGATIVE" | "FLAT";
  trigger: string;
  assets: [string, number][];
  nPool: number;
  nPicked: number;
  totalMcapUsd: number;
  avgChange24hPct: number;
  highlight: boolean;
};

/**
 * Composite score from real basket signals — same shape as
 * /publisher/radar's compositeScore, but built from propose-basket output:
 *   momentum  = avg 24h change (%) * 4   (±5% → ±20)
 *   breadth   = picked count, capped at 20, * 1.5 (0..30)
 *   scale     = log10(total mcap usd + 1) * 2 (real basket scale)
 * Centered at 50, clamped 0..100. No hidden weights, no synthetic inputs.
 */
function compositeFromBasket(b: NonNullable<BasketProposal>): number {
  const avgChange = b.summary?.avg_change_24h_pct ?? 0;
  const nPicked = b.n_picked ?? 0;
  const totalMcap = b.summary?.total_marketcap_usd ?? 0;
  const momentum = avgChange * 4;
  const breadth = Math.min(nPicked, 20) * 1.5;
  const scale = Math.log10(totalMcap + 1) * 2;
  return Math.max(0, Math.min(100, Math.round(50 + momentum + breadth + scale)));
}

const SECTOR_PRIORITY = ["DePIN", "RWA", "AI", "Meme", "GameFi", "DeFi", "Layer2", "Layer1"];

export default async function ProposalsPage() {
  // Auto-generate proposals from the top SoSoValue sectors:
  // 1. Fetch sector spotlight scores.
  // 2. Filter to sectors with a known SSI ticker mapping.
  // 3. For top 3, call the agent's propose-basket endpoint for the real
  //    constituent pool, weights, and 24h change summary.
  const sectors = await getSectorScores();
  const eligible = sectors
    .map((s) => ({ ...s, ticker: sectorToSsi(s.sector) }))
    .filter((s): s is SectorScore & { ticker: string } => !!s.ticker)
    .sort((a, b) => {
      const aPri = SECTOR_PRIORITY.indexOf(a.sector);
      const bPri = SECTOR_PRIORITY.indexOf(b.sector);
      if (aPri !== -1 && bPri !== -1) return aPri - bPri;
      if (aPri !== -1) return -1;
      if (bPri !== -1) return 1;
      return b.score - a.score;
    })
    .slice(0, 3);

  const baskets = await Promise.all(
    eligible.map((s) => proposeBasket(s.sector, 8, "score")),
  );

  type Skipped = { sector: string; reason: string };
  const skipped: Skipped[] = [];
  const proposals: Proposal[] = [];

  eligible.forEach((sec, i) => {
    const basket = baskets[i];
    if (!basket) {
      skipped.push({ sector: sec.sector, reason: "agent service unreachable" });
      return;
    }
    if (!basket.ok) {
      skipped.push({ sector: sec.sector, reason: basket.error ?? "propose-basket returned ok=false" });
      return;
    }
    const summary = basket.summary;
    const constituents = basket.constituents ?? [];
    if (!summary || constituents.length === 0) {
      skipped.push({ sector: sec.sector, reason: "empty basket — no eligible constituents" });
      return;
    }

    const symbols = summary.symbols ?? [];
    const weights = summary.weights_pct ?? [];
    const assets: [string, number][] = symbols.map((sym, j) => [
      sym,
      Math.round(weights[j] ?? 0),
    ]);

    const composite = compositeFromBasket(basket);
    const avgChange = summary.avg_change_24h_pct;
    const momentumLabel: "POSITIVE" | "NEGATIVE" | "FLAT" =
      avgChange > 0.5 ? "POSITIVE" : avgChange < -0.5 ? "NEGATIVE" : "FLAT";

    proposals.push({
      id: sec.ticker.toLowerCase().replace(/^ssi/, ""),
      ticker: sec.ticker,
      sector: sec.sector,
      name: `HYPE-${sec.sector.toUpperCase()}-${basket.n_picked ?? constituents.length}`,
      composite,
      momentumLabel,
      trigger: `Pool ${basket.n_pool ?? "?"} → picked ${basket.n_picked ?? constituents.length} · 24h avg ${
        avgChange >= 0 ? "+" : ""
      }${avgChange.toFixed(2)}% · weighting ${basket.weighting ?? "score"}`,
      assets,
      nPool: basket.n_pool ?? 0,
      nPicked: basket.n_picked ?? constituents.length,
      totalMcapUsd: summary.total_marketcap_usd,
      avgChange24hPct: avgChange,
      highlight: i === 0 && composite >= 60,
    });
  });

  const live = proposals.length > 0;

  return (
    <div className="px-6 py-5 flex flex-col gap-3.5">
      <div className="flex justify-between items-end">
        <div>
          <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>
            Pending Proposals
          </div>
          <Mono size={11}>
            {proposals.length} drafts derived from /sector-spotlight + agent /propose-basket ·
            real basket data
          </Mono>
        </div>
        <div className="flex gap-1.5">
          <Tag small color={live ? tokens.emerald : tokens.textFaint} dot>
            {live ? "live · sector momentum from /sector-spotlight (refreshed at request time)" : "no live proposals"}
          </Tag>
          <Btn small>Rejected</Btn>
          <Btn small>Published</Btn>
        </div>
      </div>

      <div className="flex flex-col gap-3 overflow-y-auto">
        {proposals.map((p) => (
          <Card
            key={p.id}
            pad={0}
            style={{
              borderColor: p.highlight ? tokens.amber + "50" : tokens.border,
              boxShadow: p.highlight
                ? `0 0 0 1px ${tokens.amber}15, 0 4px 20px ${tokens.amber}10`
                : undefined,
            }}
          >
            <div
              className="grid items-center"
              style={{ padding: 16, gridTemplateColumns: "auto 1fr auto", gap: 20 }}
            >
              <div className="flex flex-col items-center">
                <HypeGauge score={p.composite} sector="COMPOSITE SCORE" size={84} />
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Tag small color={tokens.amber} filled>
                    {p.sector}
                  </Tag>
                  {p.highlight && (
                    <Tag small color={tokens.red} dot>
                      hot
                    </Tag>
                  )}
                  <Tag
                    small
                    color={
                      p.momentumLabel === "POSITIVE"
                        ? tokens.emerald
                        : p.momentumLabel === "NEGATIVE"
                          ? tokens.red
                          : tokens.textFaint
                    }
                    dot
                  >
                    {p.momentumLabel}
                  </Tag>
                  <Mono size={10} color={tokens.textFaint}>
                    · {p.ticker}
                  </Mono>
                </div>
                <div
                  style={{
                    fontSize: 18,
                    fontWeight: 600,
                    letterSpacing: "-0.02em",
                    marginBottom: 6,
                  }}
                >
                  {p.name}
                </div>
                <div
                  style={{ fontSize: 12, color: tokens.textDim, marginBottom: 10, lineHeight: 1.4 }}
                >
                  <span style={{ color: tokens.cyan }}>Trigger:</span> {p.trigger}
                </div>
                <div
                  className="flex"
                  style={{
                    height: 28,
                    borderRadius: 5,
                    overflow: "hidden",
                    background: tokens.bgElev2,
                    marginBottom: 6,
                  }}
                >
                  {p.assets.map(([a, w], j) => (
                    <div
                      key={j}
                      className="flex items-center justify-center font-mono"
                      style={{
                        width: `${w}%`,
                        background: palette[j % palette.length],
                        color: tokens.bg,
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: "-0.02em",
                      }}
                    >
                      {w >= 10 ? a : ""}
                    </div>
                  ))}
                </div>
                <div className="flex gap-3 flex-wrap">
                  {p.assets.map(([a, w], j) => (
                    <Mono key={j} size={10} color={tokens.textDim}>
                      {a} {w}%
                    </Mono>
                  ))}
                </div>
                <Mono size={11} color={tokens.textDim} className="mt-2 block">
                  Subscriber & earnings tracking pending billing layer
                </Mono>
              </div>
              <div className="flex flex-col gap-1.5" style={{ minWidth: 160 }}>
                <Link href={`/publisher/proposals/${p.id}`} className="contents">
                  <Btn primary style={{ justifyContent: "center" }}>
                    Review &amp; Publish →
                  </Btn>
                </Link>
                <Btn small style={{ justifyContent: "center" }}>
                  Edit weights
                </Btn>
                <Btn small style={{ justifyContent: "center", color: tokens.textDim }}>
                  Reject
                </Btn>
              </div>
            </div>
          </Card>
        ))}

        {proposals.length === 0 && (
          <Card pad={16}>
            <Mono size={11} color={tokens.textDim}>
              No live proposals — agent /propose-basket returned no eligible baskets for the top
              sectors at this time.
            </Mono>
          </Card>
        )}

        {skipped.length > 0 && (
          <div
            style={{
              padding: "8px 12px",
              borderTop: `1px solid ${tokens.borderFaint}`,
              display: "flex",
              flexDirection: "column",
              gap: 2,
            }}
          >
            {skipped.map((s, i) => (
              <Mono key={i} size={10} color={tokens.textFaint}>
                skipped {s.sector}: {s.reason}
              </Mono>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
