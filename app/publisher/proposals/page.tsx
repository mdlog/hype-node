import Link from "next/link";
import { Card, Mono, Tag, Btn, HypeGauge } from "@/components/ui";
import { tokens } from "@/lib/tokens";
import {
  getSectorScores,
  getSsiConstituents,
  sectorToSsi,
  type IndexConstituent,
} from "@/lib/api/sosovalue";

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

const TICKER_MAP: Record<string, string> = {
  filecoin: "FIL",
  render: "RNDR",
  helium: "HNT",
  arweave: "AR",
  "akash-network": "AKT",
  "theta-network": "THETA",
  iota: "IOTA",
  golem: "GLM",
  livepeer: "LPT",
  aethir: "ATH",
  grass: "GRASS",
  ondo: "ONDO",
  mkr: "MKR",
  usdy: "USDY",
  btc: "BTC",
  eth: "ETH",
  sol: "SOL",
  bnb: "BNB",
  ada: "ADA",
  avax: "AVAX",
};

function tickerOf(symbol: string): string {
  return TICKER_MAP[symbol.toLowerCase()] ?? symbol.slice(0, 5).toUpperCase();
}

function fmtRelative(driftMin: number): string {
  if (driftMin < 60) return `${driftMin}m ago`;
  return `${Math.round(driftMin / 60)}h ago`;
}

type SectorScore = { sector: string; score: number; delta: number; news: number };

type Proposal = {
  id: string;
  ticker: string;
  sector: string;
  name: string;
  conf: number;
  trigger: string;
  assets: [string, number][];
  proj: string;
  time: string;
  highlight: boolean;
};

function buildProposal(
  sec: SectorScore,
  ticker: string,
  constituents: IndexConstituent[],
  age: number,
  index: number,
): Proposal {
  // Confidence proxy: combines sector score (0–100) with breadth (constituent
  // count) and clamps. Real agent confidence will replace this when wired.
  const conf = Math.max(
    20,
    Math.min(99, Math.round(sec.score * 0.7 + Math.min(constituents.length, 12) * 2.5)),
  );
  const top = constituents.slice(0, 8).map((c) => [tickerOf(c.symbol), Math.round(c.weight * 100)] as [string, number]);
  const subsLo = Math.max(20, Math.round(conf * 0.6));
  const subsHi = subsLo + Math.round(conf * 0.5);
  const earnLo = subsLo * 4;
  const earnHi = subsHi * 4;

  return {
    id: ticker.toLowerCase().replace(/^ssi/, ""),
    ticker,
    sector: sec.sector,
    name: `HYPE-${sec.sector.toUpperCase()}-${constituents.length}`,
    conf,
    trigger: `Sector score ${sec.score} · 24h Δ ${sec.delta >= 0 ? "+" : ""}${sec.delta} · ${
      constituents.length
    } SSI constituents`,
    assets: top,
    proj: `Est. subs: ${subsLo}–${subsHi} · proj. 30d earnings $${earnLo}–$${earnHi}`,
    time: `drafted ${fmtRelative(age * (index + 1))} · expires in ${6 - index}h`,
    highlight: index === 0 && sec.score >= 60,
  };
}

const SECTOR_PRIORITY = ["DePIN", "RWA", "AI", "Meme", "GameFi", "DeFi", "Layer2", "Layer1"];

export default async function ProposalsPage() {
  // Auto-generate proposals from the top SoSoValue sectors. Strategy:
  // 1. Fetch sector spotlight scores.
  // 2. Filter to sectors with a known SSI ticker mapping.
  // 3. For top 3, fetch live constituents and build a proposal card.
  const sectors = await getSectorScores();
  const eligible = sectors
    .map((s) => ({ ...s, ticker: sectorToSsi(s.sector) }))
    .filter((s): s is SectorScore & { ticker: string } => !!s.ticker)
    .sort((a, b) => {
      // Prefer narrative-aligned sectors first, then by score.
      const aPri = SECTOR_PRIORITY.indexOf(a.sector);
      const bPri = SECTOR_PRIORITY.indexOf(b.sector);
      if (aPri !== -1 && bPri !== -1) return aPri - bPri;
      if (aPri !== -1) return -1;
      if (bPri !== -1) return 1;
      return b.score - a.score;
    })
    .slice(0, 3);

  const constituentLists = await Promise.all(
    eligible.map((s) => getSsiConstituents(s.ticker).catch(() => [] as IndexConstituent[])),
  );

  const proposals: Proposal[] = eligible.map((s, i) =>
    buildProposal(s, s.ticker, constituentLists[i], 6, i),
  );

  const live = sectors.length >= 13 && constituentLists.some((cs) => cs.length > 0);

  return (
    <div className="px-6 py-5 flex flex-col gap-3.5">
      <div className="flex justify-between items-end">
        <div>
          <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>
            Pending Proposals
          </div>
          <Mono size={11}>
            {proposals.length} drafts derived from sector-spotlight + SSI constituents · expires in
            6h if untouched
          </Mono>
        </div>
        <div className="flex gap-1.5">
          <Tag small color={live ? tokens.emerald : tokens.textFaint} dot>
            {live ? "live · /sector-spotlight + /indices" : "fallback"}
          </Tag>
          <Btn small>Rejected (4)</Btn>
          <Btn small>Published (12)</Btn>
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
                <HypeGauge score={p.conf} sector="AGENT CONFIDENCE" size={84} />
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
                  <Mono size={10}>{p.time}</Mono>
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
                        background: palette[j],
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
                <Mono size={11} color={tokens.emerald} className="mt-2 block">
                  💰 {p.proj}
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
      </div>
    </div>
  );
}
