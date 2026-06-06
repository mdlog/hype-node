// Public proposal detail — anyone can land on this URL and see the full
// thesis, constituents, backtest snapshot, and (placeholder) subscribe CTA.
// Server-rendered with the service-role `db` client so we don't need an
// internal /api fetch hop. Status is gated on the row itself: anything not
// in (published, live) 404s for non-creators.
//
// CTAs:
//   - Subscribe with USDC: live via <SubscribePanel> (approve + requestDeposit
//     to HypeIndexVault). Env-gated: shows a clear "vault not deployed yet"
//     fallback until NEXT_PUBLIC_HYPE_VAULT_ADDRESS / _USDC_ADDRESS are set.
//   - View on chain: link to Sepolia explorer when on_chain_tx exists.
//   - View backtest: link to the share page when a bt_share_link has been
//     published for the proposal's source run; otherwise just a "saved by
//     creator" pill so we don't surface a dead link.
//   - Open creator's other indices: query-string filter back to /discover.

import Link from "next/link";
import { notFound } from "next/navigation";

import { Btn, Card, Label, Metric, Mono, Tag } from "@/components/ui";
import { tokens } from "@/lib/tokens";
import { db } from "@/lib/supabase/server";
import type { PbEarningRow, PbProposalRow } from "@/lib/supabase/types";
import { getDemoProposalById } from "@/lib/demo/seed";
import { SubscribePanel } from "./SubscribePanel";

export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

const PUBLIC_STATUSES = ["published", "live"] as const;

function shortAddr(addr: string): string {
  if (addr.length < 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function pct(n: number | null | undefined, digits = 2): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${(n * 100).toFixed(digits)}%`;
}

function num(n: number | null | undefined, digits = 2): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

function fmtUsd(n: number | null | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(2)}K`;
  return `$${n.toFixed(2)}`;
}

function explorerUrl(tx: string): string {
  return `https://sepolia.etherscan.io/tx/${tx}`;
}

type ConstituentRow = {
  symbol: string;
  weight: number | null;
  currency_id: string | null;
};

function parseConstituents(c: unknown): ConstituentRow[] {
  if (Array.isArray(c)) {
    return c.map((x) => {
      if (typeof x === "object" && x !== null) {
        const r = x as Record<string, unknown>;
        const symbol =
          typeof r.symbol === "string"
            ? r.symbol
            : typeof r.ticker === "string"
              ? r.ticker
              : "—";
        const weight =
          typeof r.weight === "number"
            ? r.weight
            : typeof r.weight_pct === "number"
              ? r.weight_pct / 100
              : null;
        const currency_id =
          typeof r.currency_id === "string"
            ? r.currency_id
            : typeof r.currencyId === "string"
              ? r.currencyId
              : typeof r.id === "string"
                ? r.id
                : null;
        return { symbol, weight, currency_id };
      }
      return { symbol: String(x), weight: null, currency_id: null };
    });
  }
  if (typeof c === "object" && c !== null) {
    return Object.entries(c as Record<string, unknown>).map(([symbol, v]) => ({
      symbol,
      weight: typeof v === "number" ? v : null,
      currency_id: null,
    }));
  }
  return [];
}

type EarningsStats = {
  total_earned: number;
  last_30d_earned: number;
  subscribers: number | null;
  latest_aum: number | null;
  count: number;
};

function rollupEarnings(rows: PbEarningRow[]): EarningsStats {
  const now = Date.now();
  const thirty = 30 * 24 * 60 * 60 * 1000;
  let total = 0;
  let last30 = 0;
  let latest: PbEarningRow | null = null;
  for (const r of rows) {
    total += r.amount_usd ?? 0;
    if (Date.parse(r.accrued_at) >= now - thirty) {
      last30 += r.amount_usd ?? 0;
    }
    if (!latest || Date.parse(r.accrued_at) > Date.parse(latest.accrued_at)) {
      latest = r;
    }
  }
  return {
    total_earned: total,
    last_30d_earned: last30,
    subscribers: latest?.subscriber_count ?? null,
    latest_aum: latest?.aum_usd_at_accrual ?? null,
    count: rows.length,
  };
}

const STATUS_COLOR: Record<PbProposalRow["status"], string> = {
  draft: tokens.textDim,
  review: tokens.cyan,
  signed: tokens.amber,
  published: tokens.emerald,
  live: tokens.emerald,
  paused: tokens.amber,
  rejected: tokens.red,
};

export default async function DiscoverDetailPage({ params }: Ctx) {
  // Short-circuit: demo-* ids never hit Supabase — serve from seed data.
  if (params.id.startsWith("demo-")) {
    const demoProposal = getDemoProposalById(params.id);
    if (!demoProposal) notFound();
    const demoStats: EarningsStats = {
      total_earned: 3_200,
      last_30d_earned: 840,
      subscribers: 47,
      latest_aum: 125_000,
      count: 1,
    };
    const demoConstituents = parseConstituents(demoProposal.constituents);
    const demoTotalWeight = demoConstituents.reduce((s, r) => s + (r.weight ?? 0), 0);
    return renderDetailJsx(demoProposal, demoStats, demoConstituents, demoTotalWeight, null);
  }

  const { data: proposalRaw, error: proposalErr } = await db
    .from("pb_proposals")
    .select("*")
    .eq("id", params.id)
    .maybeSingle();

  if (proposalErr) {
    return (
      <div className="px-6 py-8 max-w-4xl mx-auto">
        <Card pad={20}>
          <Label color={tokens.red}>ERROR</Label>
          <Mono size={12} color={tokens.text} className="mt-2 block">
            {proposalErr.message}
          </Mono>
        </Card>
      </div>
    );
  }

  if (!proposalRaw) notFound();

  const proposal = proposalRaw as PbProposalRow;
  // The /discover surface is public-only — non-public statuses 404 even when
  // the row exists, so we don't leak draft titles or rejection reasons to
  // anyone who happens to know an id.
  if (!(PUBLIC_STATUSES as readonly string[]).includes(proposal.status)) {
    notFound();
  }

  // Parallelize earnings + share-link lookup.
  const [earningsRes, shareRes] = await Promise.all([
    db
      .from("pb_earnings")
      .select("*")
      .eq("proposal_id", proposal.id)
      .order("accrued_at", { ascending: false }),
    proposal.source_run_id
      ? db
          .from("bt_share_links")
          .select("short_code")
          .eq("run_id", proposal.source_run_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  const earnings: PbEarningRow[] = earningsRes.error
    ? []
    : ((earningsRes.data ?? []) as PbEarningRow[]);
  const stats = rollupEarnings(earnings);

  const shareCode =
    !shareRes || shareRes.error
      ? null
      : (shareRes.data as { short_code: string } | null)?.short_code ?? null;

  const constituents = parseConstituents(proposal.constituents);
  const totalWeight = constituents.reduce((s, r) => s + (r.weight ?? 0), 0);

  return renderDetailJsx(proposal, stats, constituents, totalWeight, shareCode);
}

function renderDetailJsx(
  proposal: PbProposalRow,
  stats: EarningsStats,
  constituents: ConstituentRow[],
  totalWeight: number,
  shareCode: string | null,
) {
  return (
    <div className="px-6 py-5 flex flex-col gap-3 max-w-6xl mx-auto">
      <Crumbs ticker={proposal.ssi_ticker} title={proposal.title ?? proposal.id.slice(0, 8)} />

      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: "1fr 360px" }}
      >
        {/* Main column */}
        <div className="flex flex-col gap-3 min-w-0">
          <Card pad={18}>
            <div className="flex items-center gap-2 flex-wrap">
              <Tag small color={tokens.amber} filled>
                {proposal.ssi_ticker}
              </Tag>
              <Tag small color={STATUS_COLOR[proposal.status]} dot>
                {proposal.status}
              </Tag>
              <Tag small color={tokens.textFaint}>
                source: {proposal.source}
              </Tag>
            </div>
            <div
              style={{
                fontSize: 26,
                fontWeight: 700,
                letterSpacing: "-0.02em",
                marginTop: 8,
              }}
            >
              {proposal.title ?? `Untitled · ${proposal.id.slice(0, 8)}`}
            </div>
            <div className="flex items-center gap-3 mt-2 flex-wrap">
              <Mono size={11} color={tokens.textDim}>
                by {shortAddr(proposal.creator_address)}
              </Mono>
              <Mono size={10} color={tokens.textFaint}>
                · published {new Date(proposal.created_at).toLocaleDateString()}
              </Mono>
              <Link
                href={`/discover?creator=${proposal.creator_address.toLowerCase()}`}
                style={{ fontSize: 11, color: tokens.cyan }}
              >
                more from this creator →
              </Link>
            </div>
          </Card>

          {proposal.thesis && (
            <Card pad={16}>
              <Label>THESIS</Label>
              <div
                style={{
                  fontSize: 13.5,
                  color: tokens.text,
                  lineHeight: 1.6,
                  marginTop: 8,
                  whiteSpace: "pre-wrap",
                }}
              >
                {proposal.thesis}
              </div>
            </Card>
          )}

          <Card pad={0}>
            <div
              className="flex justify-between items-center"
              style={{
                padding: "12px 16px",
                borderBottom: `1px solid ${tokens.border}`,
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600 }}>Constituents</div>
              <Mono size={10} color={tokens.textFaint}>
                {constituents.length} assets · sum {(totalWeight * 100).toFixed(2)}%
              </Mono>
            </div>
            <div
              className="grid"
              style={{
                gridTemplateColumns: "1fr 1fr 1.6fr",
                padding: "8px 16px",
                gap: 10,
                borderBottom: `1px solid ${tokens.borderFaint}`,
              }}
            >
              <Label>SYMBOL</Label>
              <Label>WEIGHT</Label>
              <Label>CURRENCY ID</Label>
            </div>
            {constituents.length === 0 ? (
              <div style={{ padding: 16 }}>
                <Mono size={11} color={tokens.textDim}>
                  No constituents recorded.
                </Mono>
              </div>
            ) : (
              constituents.map((c, i) => (
                <div
                  key={i}
                  className="grid items-center"
                  style={{
                    gridTemplateColumns: "1fr 1fr 1.6fr",
                    padding: "8px 16px",
                    gap: 10,
                    borderBottom: `1px solid ${tokens.borderFaint}`,
                  }}
                >
                  <Mono size={12} color={tokens.text}>
                    {c.symbol}
                  </Mono>
                  <Mono size={11} color={tokens.textDim}>
                    {c.weight !== null ? `${(c.weight * 100).toFixed(2)}%` : "—"}
                  </Mono>
                  <Mono size={10} color={tokens.textFaint}>
                    {c.currency_id ? `${c.currency_id.slice(0, 22)}${c.currency_id.length > 22 ? "…" : ""}` : "—"}
                  </Mono>
                </div>
              ))
            )}
          </Card>

          <Card pad={16}>
            <div className="flex justify-between items-center mb-2">
              <Label>BACKTEST SNAPSHOT</Label>
              {shareCode ? (
                <Link
                  href={`/share/backtest/${shareCode}`}
                  style={{ fontSize: 11, color: tokens.cyan }}
                >
                  view full backtest →
                </Link>
              ) : (
                <Tag small color={tokens.textFaint}>
                  saved by creator
                </Tag>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2.5">
              <KpiCard
                k="RETURN"
                v={pct(proposal.backtest_return)}
                c={(proposal.backtest_return ?? 0) >= 0 ? tokens.emerald : tokens.red}
              />
              <KpiCard k="SHARPE" v={num(proposal.backtest_sharpe)} c={tokens.cyan} />
              <KpiCard k="MAX DD" v={pct(proposal.backtest_max_dd)} c={tokens.amber} />
            </div>
            {proposal.source_run_id && (
              <Mono size={10} color={tokens.textFaint} className="mt-2 block">
                source run: {proposal.source_run_id.slice(0, 14)}…
              </Mono>
            )}
          </Card>

          <Card pad={16}>
            <Label>EARNINGS · PUBLIC LEDGER</Label>
            <div className="grid grid-cols-4 gap-2.5 mt-2">
              <KpiCard k="TOTAL EARNED" v={fmtUsd(stats.total_earned)} c={tokens.emerald} />
              <KpiCard k="LAST 30D" v={fmtUsd(stats.last_30d_earned)} c={tokens.text} />
              <KpiCard
                k="SUBSCRIBERS"
                v={stats.subscribers !== null ? stats.subscribers.toLocaleString() : "—"}
                c={tokens.cyan}
              />
              <KpiCard k="LATEST AUM" v={fmtUsd(stats.latest_aum)} c={tokens.text} />
            </div>
            <Mono size={10} color={tokens.textFaint} className="mt-2 block">
              {stats.count} accrual{stats.count === 1 ? "" : "s"} on record
              {stats.count === 0 ? " · ledger seeds when vault deploys" : ""}
            </Mono>
          </Card>
        </div>

        {/* Action panel */}
        <div className="flex flex-col gap-2.5 min-w-0">
          <SubscribePanel indexId={proposal.on_chain_index_id} ticker={proposal.ssi_ticker} />

          <Card pad={14}>
            <Label>LINKS</Label>
            <div className="flex flex-col gap-1.5 mt-2">
              {proposal.on_chain_tx ? (
                <a
                  href={explorerUrl(proposal.on_chain_tx)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="contents"
                >
                  <Btn small style={{ justifyContent: "center", width: "100%" }}>
                    View on chain ↗
                  </Btn>
                </a>
              ) : (
                <Btn
                  small
                  disabled
                  style={{
                    justifyContent: "center",
                    width: "100%",
                    color: tokens.textFaint,
                  }}
                >
                  No on-chain tx yet
                </Btn>
              )}
              {shareCode ? (
                <Link href={`/share/backtest/${shareCode}`} className="contents">
                  <Btn small style={{ justifyContent: "center", width: "100%" }}>
                    View backtest →
                  </Btn>
                </Link>
              ) : (
                <Btn
                  small
                  disabled
                  style={{
                    justifyContent: "center",
                    width: "100%",
                    color: tokens.textFaint,
                  }}
                >
                  No public backtest share
                </Btn>
              )}
              <Link
                href={`/discover?creator=${proposal.creator_address.toLowerCase()}`}
                className="contents"
              >
                <Btn small style={{ justifyContent: "center", width: "100%" }}>
                  Creator&apos;s other indices →
                </Btn>
              </Link>
            </div>
          </Card>

          {(proposal.on_chain_tx || proposal.on_chain_index_id) && (
            <Card pad={14}>
              <Label>ON-CHAIN</Label>
              {proposal.on_chain_index_id && (
                <Mono size={10} color={tokens.textDim} className="block mt-2">
                  index id: {proposal.on_chain_index_id.slice(0, 18)}…
                </Mono>
              )}
              {proposal.on_chain_tx && (
                <Mono size={10} color={tokens.textDim} className="block mt-1">
                  tx: {proposal.on_chain_tx.slice(0, 18)}…
                </Mono>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function KpiCard({ k, v, c }: { k: string; v: string; c: string }) {
  return (
    <div
      style={{
        padding: "10px 12px",
        background: tokens.bgElev2,
        border: `1px solid ${tokens.border}`,
        borderRadius: 6,
      }}
    >
      <Label>{k}</Label>
      <Metric v={v} color={c} size={18} style={{ marginTop: 4 }} />
    </div>
  );
}

function Crumbs({ ticker, title }: { ticker: string; title: string }) {
  return (
    <div
      className="flex items-center gap-2 font-mono"
      style={{ fontSize: 11, color: tokens.textDim }}
    >
      <Link href="/discover" style={{ cursor: "pointer" }}>
        Discover
      </Link>
      <span>/</span>
      <span style={{ color: tokens.textFaint }}>{ticker}</span>
      <span>/</span>
      <span style={{ color: tokens.text }}>{title}</span>
    </div>
  );
}
