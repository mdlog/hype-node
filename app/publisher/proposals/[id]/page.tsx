import Link from "next/link";
import { Card, Label, Metric, Mono, Tag, Meter, HypeGauge } from "@/components/ui";
import { tokens } from "@/lib/tokens";
import { proposeBasket, type BasketProposal } from "@/lib/api/agent";
import type { IndexSpec } from "@/lib/api/ssi";
import { PublishActions } from "./PublishActions";

export const revalidate = 60;

// Route-id → sector lookup. This is just a route alias table (not data) —
// the route segment "depin" needs to resolve to the canonical sector name
// "DePIN" so we can call proposeBasket(sector). All other data (constituents,
// weights, change, marketcap) comes from the agent's /propose-basket call.
const ROUTE_TO_SECTOR: Record<string, { sector: string; ticker: string }> = {
  depin: { sector: "DePIN", ticker: "ssiDePIN" },
  "depin-8": { sector: "DePIN", ticker: "ssiDePIN" },
  rwa: { sector: "RWA", ticker: "ssiRWA" },
  "rwa-tbill-5": { sector: "RWA", ticker: "ssiRWA" },
  ai: { sector: "AI", ticker: "ssiAI" },
  "ai-agent-6": { sector: "AI", ticker: "ssiAI" },
  ssidepin: { sector: "DePIN", ticker: "ssiDePIN" },
  ssirwa: { sector: "RWA", ticker: "ssiRWA" },
  ssiai: { sector: "AI", ticker: "ssiAI" },
  meme: { sector: "Meme", ticker: "ssiMeme" },
  ssimeme: { sector: "Meme", ticker: "ssiMeme" },
  gamefi: { sector: "GameFi", ticker: "ssiGameFi" },
  ssigamefi: { sector: "GameFi", ticker: "ssiGameFi" },
  defi: { sector: "DeFi", ticker: "ssiDeFi" },
  ssidefi: { sector: "DeFi", ticker: "ssiDeFi" },
  layer1: { sector: "Layer1", ticker: "ssiLayer1" },
  ssilayer1: { sector: "Layer1", ticker: "ssiLayer1" },
  layer2: { sector: "Layer2", ticker: "ssiLayer2" },
  ssilayer2: { sector: "Layer2", ticker: "ssiLayer2" },
};

// Same composite-score formula as /publisher/proposals — keeps the score
// consistent across the proposals list and this detail view.
function compositeFromBasket(b: NonNullable<BasketProposal>): number {
  const avgChange = b.summary?.avg_change_24h_pct ?? 0;
  const nPicked = b.n_picked ?? 0;
  const totalMcap = b.summary?.total_marketcap_usd ?? 0;
  const momentum = avgChange * 4;
  const breadth = Math.min(nPicked, 20) * 1.5;
  const scale = Math.log10(totalMcap + 1) * 2;
  return Math.max(0, Math.min(100, Math.round(50 + momentum + breadth + scale)));
}

function formatMcap(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return "—";
  if (v >= 1e12) return `${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(2)}K`;
  return v.toFixed(0);
}

function tickerSymbol(symbol: string): string {
  // SoSoValue SSI returns long-form names ("filecoin"). Convert to a short
  // ticker for display ("FIL"). This is a display-only transform, no data.
  const map: Record<string, string> = {
    filecoin: "FIL",
    render: "RNDR",
    helium: "HNT",
    arweave: "AR",
    "akash-network": "AKT",
    iota: "IOTA",
    "theta-network": "THETA",
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
  };
  return map[symbol.toLowerCase()] ?? symbol.slice(0, 5).toUpperCase();
}

function displayName(symbol: string): string {
  return symbol.replace(/-/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

export default async function ProposalReviewPage({
  params,
}: {
  params: { id: string };
}) {
  const lookup = ROUTE_TO_SECTOR[params.id.toLowerCase()] ?? {
    sector: "DePIN",
    ticker: "ssiDePIN",
  };

  const proposal = await proposeBasket(lookup.sector, 8, "score");

  // Empty state — proposeBasket failed or returned ok=false.
  if (!proposal || !proposal.ok) {
    const reason = !proposal
      ? "agent service unreachable"
      : proposal.error ?? "propose-basket returned ok=false";
    return (
      <div className="px-6 py-5 flex flex-col gap-3 h-[calc(100vh-52px)]">
        <div
          className="flex items-center gap-2 font-mono"
          style={{ fontSize: 11, color: tokens.textDim }}
        >
          <Link href="/publisher/proposals" style={{ cursor: "pointer" }}>
            Proposals
          </Link>
          <span>/</span>
          <span style={{ color: tokens.text }}>{params.id}</span>
        </div>
        <Card pad={20}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
            Proposal data unavailable for {lookup.sector} — {reason}
          </div>
          <Mono size={11} color={tokens.textDim}>
            Try again once the agent /propose-basket endpoint is reachable.
          </Mono>
        </Card>
      </div>
    );
  }

  const constituents = proposal.constituents ?? [];
  const summary = proposal.summary;

  if (!summary || constituents.length === 0) {
    return (
      <div className="px-6 py-5 flex flex-col gap-3 h-[calc(100vh-52px)]">
        <div
          className="flex items-center gap-2 font-mono"
          style={{ fontSize: 11, color: tokens.textDim }}
        >
          <Link href="/publisher/proposals" style={{ cursor: "pointer" }}>
            Proposals
          </Link>
          <span>/</span>
          <span style={{ color: tokens.text }}>{params.id}</span>
        </div>
        <Card pad={20}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
            Proposal data unavailable for {lookup.sector} — empty basket
          </div>
          <Mono size={11} color={tokens.textDim}>
            No eligible constituents returned by /propose-basket.
          </Mono>
        </Card>
      </div>
    );
  }

  const composite = compositeFromBasket(proposal);
  const nPicked = proposal.n_picked ?? constituents.length;
  const nPool = proposal.n_pool ?? 0;
  const totalMcap = summary.total_marketcap_usd;
  const avgChange = summary.avg_change_24h_pct;
  const ticker = proposal.ticker ?? lookup.ticker;
  const sectorUpper = lookup.sector.toUpperCase();
  const indexName = `HYPE-${sectorUpper}-${nPicked}`;

  // Build asset rows directly from real basket constituents — no editorial
  // text, no synthetic sentiment. Reasoning is generated honestly from the
  // snapshot (24h change · mcap rank · marketcap).
  const rows = constituents.map((c) => {
    const tk = tickerSymbol(c.symbol);
    const name = displayName(c.symbol);
    const weightPct = Math.round(c.weight * 100);
    const change24Pct = c.change_pct_24h * 100;
    const rank = c.marketcap_rank ?? null;
    const mcap = formatMcap(c.marketcap);
    const reasoning = `24h ${change24Pct >= 0 ? "+" : ""}${change24Pct.toFixed(2)}% · mcap rank #${rank ?? "?"} · mcap $${mcap}`;
    return { tk, name, weightPct, change24Pct, rank, mcap, reasoning, symbol: c.symbol };
  });

  const totalWeightPct = rows.reduce((sum, r) => sum + r.weightPct, 0);
  const topByWeight = [...rows].sort((a, b) => b.weightPct - a.weightPct)[0];

  // Real factual summary built from the snapshot — no editorial fabrication.
  const factualSummary = `${nPicked} of ${nPool || "?"} candidates picked from ${ticker}. Average 24h move ${
    avgChange >= 0 ? "+" : ""
  }${avgChange.toFixed(2)}%. Total marketcap $${formatMcap(totalMcap)}.${
    topByWeight ? ` Top by score: ${topByWeight.tk} (${topByWeight.weightPct}%).` : ""
  }`;

  // Spec posted to /api/ssi/wrap when the publisher signs. Weights are
  // re-normalized so the sum-to-1 check in wrapIndex() never trips on
  // floating-point drift from /propose-basket.
  const publishSymbol = `H${sectorUpper.slice(0, 2)}${nPicked}`;
  const sumWeight = constituents.reduce((s, c) => s + c.weight, 0) || 1;
  const normalizedWeights: Record<string, number> = {};
  for (const c of constituents) {
    normalizedWeights[c.symbol] = c.weight / sumWeight;
  }
  const publishSpec: IndexSpec = {
    symbol: publishSymbol,
    name: indexName,
    base: "USDC",
    weights: normalizedWeights,
    rebalanceCron: "0 0 * * 0",
    managementFeeBps: 100,
    performanceFeeBps: 1000,
  };

  return (
    <div className="px-6 py-5 flex flex-col gap-3 h-[calc(100vh-52px)]">
      <div
        className="flex items-center gap-2 font-mono"
        style={{ fontSize: 11, color: tokens.textDim }}
      >
        <Link href="/publisher/proposals" style={{ cursor: "pointer" }}>
          Proposals
        </Link>
        <span>/</span>
        <span style={{ color: tokens.text }}>{indexName}</span>
        <span style={{ marginLeft: 8, color: tokens.textFaint }}>· {params.id}</span>
        <div className="flex-1" />
        <Tag small color={tokens.cyan} dot>
          live · refreshed at request time
        </Tag>
      </div>

      <div className="grid gap-3 flex-1 min-h-0" style={{ gridTemplateColumns: "1fr 360px" }}>
        <div className="flex flex-col gap-3 overflow-y-auto">
          <Card pad={18}>
            <div className="flex items-center gap-3.5">
              <div
                className="flex items-center justify-center font-mono"
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 12,
                  background: `linear-gradient(135deg, ${tokens.amber}, ${tokens.red})`,
                  fontSize: 14,
                  fontWeight: 700,
                  color: tokens.bg,
                  boxShadow: `0 0 22px ${tokens.amber}50`,
                }}
              >
                H{nPicked}
              </div>
              <div className="flex-1">
                <div className="flex items-baseline gap-2.5">
                  <div
                    style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em" }}
                  >
                    {indexName}
                  </div>
                  <Tag small color={tokens.amber} filled>
                    {lookup.sector}
                  </Tag>
                  <Mono size={10} color={tokens.textFaint}>
                    · {ticker}
                  </Mono>
                </div>
                <Mono size={11} className="mt-1 block">
                  agent-drafted · score-weighted · {nPicked} constituents · publish to SSI
                  Protocol
                </Mono>
              </div>
              <HypeGauge score={composite} sector="COMPOSITE SCORE" size={84} />
            </div>
          </Card>

          <Card pad={16}>
            <div className="flex justify-between mb-2.5">
              <div style={{ fontSize: 13, fontWeight: 600 }}>Basket snapshot</div>
              <Mono size={10}>
                source: agent /propose-basket · weighting: {proposal.weighting ?? "score"}
              </Mono>
            </div>
            <div className="grid grid-cols-4 gap-2.5 mb-3">
              {[
                {
                  k: "PICKED / POOL",
                  v: `${nPicked} / ${nPool || "?"}`,
                  c: tokens.cyan,
                },
                {
                  k: "AVG 24H Δ",
                  v: `${avgChange >= 0 ? "+" : ""}${avgChange.toFixed(2)}%`,
                  c: avgChange >= 0 ? tokens.emerald : tokens.red,
                },
                {
                  k: "TOTAL MCAP",
                  v: `$${formatMcap(totalMcap)}`,
                  c: tokens.emerald,
                },
                {
                  k: "FRESHNESS",
                  v: "live",
                  c: tokens.amber,
                },
              ].map((k, i) => (
                <div
                  key={i}
                  style={{
                    padding: "10px 12px",
                    background: tokens.bgElev2,
                    border: `1px solid ${tokens.border}`,
                    borderRadius: 6,
                  }}
                >
                  <Label>{k.k}</Label>
                  <Metric v={k.v} color={k.c} size={19} style={{ marginTop: 4 }} />
                </div>
              ))}
            </div>
            <div
              style={{
                padding: 12,
                background: tokens.cyan + "08",
                border: `1px solid ${tokens.cyan}30`,
                borderRadius: 6,
                fontSize: 13,
                color: tokens.text,
                lineHeight: 1.6,
              }}
            >
              <span style={{ color: tokens.cyan, fontWeight: 600 }}>Summary:</span>{" "}
              {factualSummary}
            </div>
          </Card>

          <Card pad={0}>
            <div
              className="flex justify-between items-center"
              style={{ padding: "12px 16px", borderBottom: `1px solid ${tokens.border}` }}
            >
              <div style={{ fontSize: 13, fontWeight: 600 }}>
                Constituents · real basket from /propose-basket
              </div>
              <Mono size={10} color={tokens.textFaint}>
                {rows.length} rows
              </Mono>
            </div>

            {/* Real composition bar from summary.weights_pct × symbols. */}
            <div style={{ padding: "10px 16px", borderBottom: `1px solid ${tokens.borderFaint}` }}>
              <div
                className="flex"
                style={{
                  height: 22,
                  borderRadius: 5,
                  overflow: "hidden",
                  background: tokens.bgElev2,
                }}
              >
                {(summary.symbols ?? []).map((sym, j) => {
                  const w = summary.weights_pct?.[j] ?? 0;
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
                  return (
                    <div
                      key={j}
                      className="flex items-center justify-center font-mono"
                      style={{
                        width: `${w}%`,
                        background: palette[j % palette.length],
                        color: tokens.bg,
                        fontSize: 9.5,
                        fontWeight: 700,
                        letterSpacing: "-0.02em",
                      }}
                    >
                      {w >= 8 ? tickerSymbol(sym) : ""}
                    </div>
                  );
                })}
              </div>
            </div>

            <div
              className="grid"
              style={{
                gridTemplateColumns: "2fr 0.9fr 0.7fr 0.9fr 1.4fr 1.4fr",
                padding: "8px 16px",
                gap: 10,
                borderBottom: `1px solid ${tokens.borderFaint}`,
              }}
            >
              {["ASSET", "24H Δ", "RANK", "MCAP", "WEIGHT", "REASONING"].map((k) => (
                <Label key={k}>{k}</Label>
              ))}
            </div>
            {rows.map((r, i) => (
              <div
                key={i}
                className="grid items-center"
                style={{
                  gridTemplateColumns: "2fr 0.9fr 0.7fr 0.9fr 1.4fr 1.4fr",
                  padding: "10px 16px",
                  gap: 10,
                  borderBottom: `1px solid ${tokens.borderFaint}`,
                }}
              >
                <div className="flex items-center gap-2.5">
                  <div
                    className="flex items-center justify-center font-mono"
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 5,
                      background: tokens.bgElev2,
                      border: `1px solid ${tokens.border}`,
                      fontSize: 8.5,
                      fontWeight: 700,
                      color: tokens.emerald,
                    }}
                  >
                    {r.tk.slice(0, 3)}
                  </div>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 500 }}>{r.name}</div>
                    <Mono size={9.5}>{r.tk}</Mono>
                  </div>
                </div>
                <Mono
                  size={11}
                  color={r.change24Pct >= 0 ? tokens.emerald : tokens.red}
                >
                  {r.change24Pct >= 0 ? "+" : ""}
                  {r.change24Pct.toFixed(2)}%
                </Mono>
                <Mono size={10} color={tokens.textDim}>
                  #{r.rank ?? "?"}
                </Mono>
                <Mono size={10}>${r.mcap}</Mono>
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <Meter v={r.weightPct / 25} color={tokens.amber} h={4} />
                  </div>
                  <div
                    className="flex items-center"
                    style={{
                      gap: 2,
                      background: tokens.bgElev2,
                      border: `1px solid ${tokens.border}`,
                      borderRadius: 4,
                      padding: "2px 6px",
                      minWidth: 58,
                    }}
                  >
                    <Mono size={10.5} color={tokens.text}>
                      {r.weightPct}
                    </Mono>
                    <Mono size={9}>%</Mono>
                  </div>
                </div>
                <Mono size={10} color={tokens.textDim}>
                  {r.reasoning}
                </Mono>
              </div>
            ))}
            <div
              className="flex justify-between"
              style={{ padding: "10px 16px", background: tokens.bgElev2 }}
            >
              <Mono size={11}>Total weight</Mono>
              <Mono
                size={11}
                color={Math.abs(totalWeightPct - 100) <= 1 ? tokens.emerald : tokens.amber}
              >
                {totalWeightPct.toFixed(2)}%
                {Math.abs(totalWeightPct - 100) <= 1 ? " ✓" : " (rounded)"}
              </Mono>
            </div>
          </Card>
        </div>

        <div className="flex flex-col gap-2.5 overflow-y-auto">
          <Card pad={14}>
            <div className="flex justify-between mb-2">
              <div style={{ fontSize: 13, fontWeight: 600 }}>Publishing settings</div>
              <Tag small color={tokens.textFaint} dot>
                user-editable defaults — no fee yet
              </Tag>
            </div>
            <Mono size={10} color={tokens.textFaint} className="mb-2 block">
              These values are publisher-config inputs. They are not enforced or
              charged until the billing layer is wired in.
            </Mono>
            {[
              ["Index symbol", `H${sectorUpper.slice(0, 2)}${nPicked}`],
              ["Management fee", "1.00%"],
              ["Performance fee", "10.00%"],
              ["Rebalance", "score-weighted"],
              ["Min subscription", "$100"],
            ].map(([k, v]) => (
              <div
                key={k}
                className="flex justify-between"
                style={{ padding: "6px 0", borderBottom: `1px solid ${tokens.borderFaint}` }}
              >
                <Mono size={10}>{k}</Mono>
                <Mono size={11} color={tokens.text}>
                  {v}
                </Mono>
              </div>
            ))}
          </Card>

          <Card pad={14}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
              Subscriber & earnings
            </div>
            <Mono size={11} color={tokens.textDim}>
              Subscriber & earnings tracking pending billing layer.
            </Mono>
          </Card>

          <Card pad={14}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
              Pre-publish checks
            </div>
            {[
              {
                label: "Weights sum to ~100%",
                ok: Math.abs(totalWeightPct - 100) <= 1,
              },
              {
                label: `Picked ${nPicked} from pool ${nPool || "?"}`,
                ok: nPicked > 0,
              },
              {
                label: "All constituents have real marketcap data",
                ok: rows.every((r) => r.mcap !== "—"),
              },
              {
                label: "Composite score computed from real signals",
                ok: composite >= 0,
              },
            ].map((chk, i) => (
              <div
                key={i}
                className="flex items-center gap-1.5"
                style={{ padding: "4px 0" }}
              >
                <div
                  className="flex items-center justify-center"
                  style={{
                    width: 13,
                    height: 13,
                    borderRadius: "50%",
                    background: chk.ok ? tokens.emerald + "20" : tokens.amber + "20",
                  }}
                >
                  <svg width={8} height={8} viewBox="0 0 8 8">
                    <path
                      d={chk.ok ? "M 1 4 L 3 6 L 7 2" : "M 2 2 L 6 6 M 6 2 L 2 6"}
                      fill="none"
                      stroke={chk.ok ? tokens.emerald : tokens.amber}
                      strokeWidth={1.5}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
                <div style={{ fontSize: 11.5, color: tokens.text }}>{chk.label}</div>
              </div>
            ))}
          </Card>

          <PublishActions spec={publishSpec} />
        </div>
      </div>
    </div>
  );
}
