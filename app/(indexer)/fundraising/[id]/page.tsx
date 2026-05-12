import Link from "next/link";
import { Card, Label, Mono, Tag, ProjectLogo } from "@/components/ui";
import { tokens } from "@/lib/tokens";
import { getProjectFundraising } from "@/lib/api/sosovalue/fundraising";
import { investorLogoUrl } from "@/lib/investor-logos";
import type {
  FundraisingInvestor,
  FundraisingPortfolioItem,
} from "@/lib/api/sosovalue/fundraising";

export const revalidate = 60;

function fmtUsd(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(0)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function fmtDate(s: string): string {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toISOString().slice(0, 10);
}

function ecosystemColor(eco: string): string {
  const k = eco?.toLowerCase() ?? "";
  if (k.includes("ethereum")) return "#8B5CF6"; // violet
  if (k.includes("solana")) return tokens.cyan;
  if (k.includes("bitcoin")) return tokens.amber;
  return tokens.textDim;
}

function fundingStatusColor(s: string): string {
  const k = s?.toLowerCase() ?? "";
  if (k.includes("active") || k.includes("funded")) return tokens.emerald;
  if (k.includes("stealth")) return tokens.amber;
  if (k.includes("pre")) return tokens.cyan;
  return tokens.textDim;
}

// Count co-investments for an investor across all rounds — used by the Top
// Investors card to surface conviction.
function countCoInvestments(
  investorId: number,
  rounds: { investors: FundraisingInvestor[] }[],
): number {
  let c = 0;
  for (const r of rounds) {
    if (r.investors.some((i) => i.investor_id === investorId)) c++;
  }
  return c;
}

export default async function FundraisingDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { name?: string };
}) {
  // ID is the SoSoValue currency_id (string — exceeds JS Number range).
  // The list page passes ?name=... so we still have the user's chosen project
  // label for the empty-state title when upstream is unreachable.
  const projectId = params.id;
  const knownName = searchParams.name?.trim() || undefined;
  const detail = await getProjectFundraising(projectId, knownName);

  if (!detail) {
    return (
      <div className="px-6 py-5 flex flex-col gap-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <Mono size={10} color={tokens.textFaint}>
              <Link href="/fundraising" style={{ color: tokens.textFaint }}>
                ← all projects
              </Link>
            </Mono>
            <div
              style={{
                fontSize: 24,
                fontWeight: 600,
                letterSpacing: "-0.02em",
                color: tokens.text,
                marginTop: 4,
              }}
            >
              {knownName ?? `Project #${projectId}`}
            </div>
          </div>
          <Tag small color={tokens.amber} dot>
            data unavailable
          </Tag>
        </div>
        <Card pad={20}>
          <Mono size={11} color={tokens.textFaint}>
            SoSoValue has no disclosed fundraising history for this currency,
            or upstream is unreachable / rate-limited. The project may exist
            on RootData (try the chat agent: &quot;show RootData detail for{" "}
            {knownName ?? projectId}&quot;).
          </Mono>
        </Card>
      </div>
    );
  }

  // Always honour the URL-provided name when the detail payload's name looks
  // generic or doesn't match — defends against partial upstream responses.
  if (knownName) detail.project_name = knownName;
  const rounds = detail.fundraising_rounds ?? [];
  // SoSoValue's per-currency fundraising endpoint is sparse for many projects
  // (only major coins have full team / investor / portfolio coverage). When
  // every section is empty we surface a single banner pointing to RootData
  // via chat instead of leaving the user with three separate "no data" cards.
  const hasAnyData =
    rounds.length > 0 ||
    (detail.investors ?? []).length > 0 ||
    (detail.team ?? []).length > 0 ||
    (detail.portfolio ?? []).length > 0;
  const investors = detail.investors ?? [];
  const portfolio = detail.portfolio ?? [];
  const stats = detail.investment_stats ?? {
    total_rounds: rounds.length,
    lead_investments: 0,
    portfolio_count: portfolio.length,
  };

  return (
    <div className="px-6 py-5 flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-end justify-between gap-4">
        <div className="flex items-center gap-4">
          <ProjectLogo name={detail.project_name} size={56} />
          <div>
            <Mono size={10} color={tokens.textFaint}>
              <Link href="/fundraising" style={{ color: tokens.textFaint }}>
                ← all projects
              </Link>
            </Mono>
            <div
              style={{
                fontSize: 24,
                fontWeight: 600,
                letterSpacing: "-0.02em",
                color: tokens.text,
                marginTop: 4,
              }}
            >
              {detail.project_name}
            </div>
            <div className="flex items-center gap-3 mt-1">
            {detail.twitter_username ? (
              <a
                href={`https://twitter.com/${detail.twitter_username}`}
                target="_blank"
                rel="noreferrer"
                style={{ color: tokens.cyan, fontSize: 12 }}
              >
                @{detail.twitter_username}
              </a>
            ) : (
              <Mono size={11} color={tokens.textFaint}>
                no twitter
              </Mono>
            )}
            <Mono size={10} color={tokens.textFaint}>
              · created {fmtDate(detail.create_time)}
            </Mono>
            <Mono size={10} color={tokens.textFaint}>
              · updated {fmtDate(detail.update_time)}
            </Mono>
          </div>
          </div>
        </div>
        <Tag small color={tokens.textDim}>
          id #{detail.project_id}
        </Tag>
      </div>

      {!hasAnyData && (
        <Card pad={14}>
          <div className="flex items-start gap-3">
            <Tag small color={tokens.amber} dot>
              limited data
            </Tag>
            <div style={{ flex: 1 }}>
              <Mono size={11} color={tokens.text}>
                SoSoValue OpenAPI has no fundraising rounds, investors, team, or
                portfolio disclosed for this currency.
              </Mono>
              <Mono size={10} color={tokens.textFaint} style={{ marginTop: 6, display: "block" }}>
                Major coins (BTC/ETH) often appear here without VC history because
                they had no priced funding round. For startup / pre-launch projects,
                ask the chat agent:{" "}
                <span style={{ color: tokens.cyan }}>
                  &quot;show RootData detail for {detail.project_name}&quot;
                </span>
              </Mono>
            </div>
          </div>
        </Card>
      )}

      {/* Funding Rounds — vertical timeline */}
      <Card pad={16}>
        <Label>Funding Rounds</Label>
        {rounds.length === 0 ? (
          <Mono size={11} color={tokens.textFaint} style={{ marginTop: 10 }}>
            No fundraising rounds disclosed in SoSoValue. Try the chat agent:{" "}
            <span style={{ color: tokens.cyan }}>
              &quot;show RootData detail for {detail.project_name}&quot;
            </span>
          </Mono>
        ) : (
          <div className="flex flex-col" style={{ marginTop: 12, gap: 0 }}>
            {rounds.map((r, i) => {
              const last = i === rounds.length - 1;
              return (
                <div
                  key={`${r.round_name}-${r.date}-${i}`}
                  className="flex"
                  style={{ gap: 14, paddingBottom: last ? 0 : 18 }}
                >
                  {/* timeline rail */}
                  <div className="flex flex-col items-center" style={{ width: 14 }}>
                    <div
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: "50%",
                        background: tokens.emerald,
                        boxShadow: `0 0 8px ${tokens.emerald}`,
                        marginTop: 4,
                      }}
                    />
                    {!last && (
                      <div
                        style={{
                          width: 1,
                          flex: 1,
                          background: tokens.border,
                          marginTop: 4,
                        }}
                      />
                    )}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <div
                        style={{
                          fontSize: 14,
                          fontWeight: 600,
                          color: tokens.text,
                          letterSpacing: "-0.01em",
                        }}
                      >
                        {r.round_name}
                      </div>
                      <Tag small color={tokens.emerald}>
                        {fmtUsd(r.raised_amount)} raised
                      </Tag>
                      <Mono size={10} color={tokens.textDim}>
                        valuation {fmtUsd(r.valuation)}
                      </Mono>
                      <Mono size={10} color={tokens.textFaint}>
                        · {fmtDate(r.date)}
                      </Mono>
                    </div>
                    <div className="flex items-center gap-1 flex-wrap" style={{ marginTop: 8 }}>
                      {(r.investors ?? []).length === 0 ? (
                        <Mono size={10} color={tokens.textFaint}>
                          investors undisclosed
                        </Mono>
                      ) : (
                        (r.investors ?? []).map((inv) => (
                          <Tag
                            key={inv.investor_id}
                            small
                            color={inv.is_lead_investor ? tokens.amber : tokens.textDim}
                            filled={inv.is_lead_investor}
                          >
                            {inv.is_lead_investor ? "★ " : ""}
                            {inv.name}
                          </Tag>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Top Investors */}
      <Card pad={16}>
        <Label>Top Investors</Label>
        {investors.length === 0 ? (
          <Mono size={11} color={tokens.textFaint} style={{ marginTop: 10 }}>
            No investor data in SoSoValue. RootData often has fuller investor
            lists — ask the chat agent:{" "}
            <span style={{ color: tokens.cyan }}>
              &quot;who funded {detail.project_name}?&quot;
            </span>
          </Mono>
        ) : (
          <div
            className="grid"
            style={{
              gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
              gap: 10,
              marginTop: 12,
            }}
          >
            {investors.map((inv) => {
              const co = countCoInvestments(inv.investor_id, rounds);
              // Prefer the SoSoValue API's own logo_url when set; else
              // resolve to a Google-favicon URL via the curated VC →
              // domain map; else null → ProjectLogo renders the letter
              // avatar fallback.
              const logoUrl = inv.logo_url || investorLogoUrl(inv.name);
              return (
                <div
                  key={inv.investor_id}
                  style={{
                    padding: 10,
                    border: `1px solid ${tokens.border}`,
                    borderRadius: 6,
                    background: tokens.bgElev2,
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <ProjectLogo
                        name={inv.name}
                        size={26}
                        logoUrl={logoUrl}
                      />
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          color: tokens.text,
                          letterSpacing: "-0.01em",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {inv.name}
                      </div>
                    </div>
                    {inv.is_lead_investor && (
                      <Tag small color={tokens.amber} filled>
                        LEAD
                      </Tag>
                    )}
                  </div>
                  <div className="flex items-center gap-2" style={{ marginTop: 6 }}>
                    <Tag small color={tokens.textDim}>
                      {inv.type || "Investor"}
                    </Tag>
                    <Mono size={10} color={tokens.textFaint}>
                      {co} co-investment{co === 1 ? "" : "s"}
                    </Mono>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Investment Stats */}
      <div
        className="grid"
        style={{
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gap: 12,
        }}
      >
        <Card pad={14}>
          <Label>Total Rounds</Label>
          <div
            style={{
              fontSize: 22,
              fontWeight: 600,
              color: (stats.total_rounds ?? rounds.length) > 0 ? tokens.text : tokens.textFaint,
              marginTop: 4,
              letterSpacing: "-0.02em",
            }}
          >
            {(stats.total_rounds ?? rounds.length) || "—"}
          </div>
          {typeof stats.rounds_in_past_year === "number" && stats.rounds_in_past_year > 0 && (
            <Mono size={10} color={tokens.textFaint}>
              {stats.rounds_in_past_year} in past year
            </Mono>
          )}
        </Card>
        <Card pad={14}>
          <Label>Lead Investments</Label>
          <div
            style={{
              fontSize: 22,
              fontWeight: 600,
              color: (stats.lead_investments ?? 0) > 0 ? tokens.amber : tokens.textFaint,
              marginTop: 4,
              letterSpacing: "-0.02em",
            }}
          >
            {(stats.lead_investments ?? 0) || "—"}
          </div>
          <Mono size={10} color={tokens.textFaint}>
            unique lead investors
          </Mono>
        </Card>
        <Card pad={14}>
          <Label>Portfolio Count</Label>
          <div
            style={{
              fontSize: 22,
              fontWeight: 600,
              color: (stats.portfolio_count ?? portfolio.length) > 0 ? tokens.cyan : tokens.textFaint,
              marginTop: 4,
              letterSpacing: "-0.02em",
            }}
          >
            {(stats.portfolio_count ?? portfolio.length) || "—"}
          </div>
          <Mono size={10} color={tokens.textFaint}>
            related projects
          </Mono>
        </Card>
      </div>

      {/* Portfolio table */}
      <Card pad={0}>
        <div
          className="grid"
          style={{
            gridTemplateColumns: "1fr 160px 140px 60px",
            padding: "10px 16px",
            gap: 12,
            borderBottom: `1px solid ${tokens.border}`,
            background: tokens.bgElev2,
          }}
        >
          <Label>PROJECT</Label>
          <Label>ECOSYSTEM</Label>
          <Label>STATUS</Label>
          <Label>{""}</Label>
        </div>
        {portfolio.length === 0 ? (
          <div style={{ padding: "16px" }}>
            <Mono size={11} color={tokens.textFaint}>
              No portfolio companies tracked in SoSoValue. Ask the chat agent:{" "}
              <span style={{ color: tokens.cyan }}>
                &quot;{detail.project_name} portfolio companies&quot;
              </span>{" "}
              to query RootData.
            </Mono>
          </div>
        ) : (
          portfolio.map((p: FundraisingPortfolioItem) => (
            <div
              key={`${p.project_id}-${p.name}`}
              className="grid items-center"
              style={{
                gridTemplateColumns: "1fr 160px 140px 60px",
                padding: "10px 16px",
                gap: 12,
                borderBottom: `1px solid ${tokens.borderFaint}`,
              }}
            >
              <div className="flex items-center gap-2.5" style={{ fontSize: 12, color: tokens.text }}>
                <ProjectLogo name={p.name} size={22} logoUrl={p.logo_url ?? null} />
                <span>{p.name}</span>
              </div>
              <div>
                <Tag small color={ecosystemColor(p.ecosystem)}>
                  {p.ecosystem || "—"}
                </Tag>
              </div>
              <div>
                <Tag small color={fundingStatusColor(p.funding_status)} dot>
                  {p.funding_status || "—"}
                </Tag>
              </div>
              <div style={{ textAlign: "right" }}>
                <Mono size={11} color={tokens.textFaint}>
                  →
                </Mono>
              </div>
            </div>
          ))
        )}
      </Card>
    </div>
  );
}
