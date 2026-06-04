// Public marketplace — browse every published / live proposal across all
// creators. No auth gate (status filter is enforced server-side; nothing
// private leaks). We pull the rows directly through the service-role `db`
// client so there's no internal /api round-trip from a server component.
//
// Earnings stats (latest AUM, subscriber count, total earned) are aggregated
// in JS from a single pb_earnings query — at Wave 1's expected ~tens of
// proposals × ~tens of accruals each, this is well under the row budget for
// a single Supabase round-trip and avoids needing a SQL RPC for now.

import Link from "next/link";

import { Btn, Card, Label, Metric, Mono, Tag } from "@/components/ui";
import { tokens } from "@/lib/tokens";
import { db } from "@/lib/supabase/server";
import type { PbEarningRow, PbProposalRow, PbSubscriptionRow } from "@/lib/supabase/types";

import { DiscoverFilters, type SortKey } from "./DiscoverFilters";

export const dynamic = "force-dynamic";

const PUBLIC_STATUSES = ["published", "live"] as const;

const VALID_SORTS = new Set<SortKey>([
  "recent",
  "top_return",
  "top_sharpe",
  "low_dd",
]);

function parseSort(raw: string | string[] | undefined): SortKey {
  const v = typeof raw === "string" ? raw : Array.isArray(raw) ? raw[0] : "";
  return VALID_SORTS.has(v as SortKey) ? (v as SortKey) : "recent";
}

function singleString(raw: string | string[] | undefined): string {
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) return raw[0] ?? "";
  return "";
}

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

type DiscoverItem = PbProposalRow & {
  latest_earning?: {
    aum_usd_at_accrual: number | null;
    subscriber_count: number | null;
  } | null;
  total_earned_usd: number | null;
  live_subscriber_count: number;
};

// Roll up one row per proposal: pick the most recent earning entry for AUM /
// subscriber snapshot, and sum amount_usd across the full ledger for total
// earned. live_subscriber_count comes from the pb_subscriptions map keyed by
// the proposal's on_chain_index_id.
function aggregateEarnings(
  proposals: PbProposalRow[],
  earnings: PbEarningRow[],
  subCountsByIndexId: Map<string, number>,
): DiscoverItem[] {
  const byId = new Map<
    string,
    { latest: PbEarningRow | null; total: number }
  >();
  for (const p of proposals) {
    byId.set(p.id, { latest: null, total: 0 });
  }
  for (const e of earnings) {
    const slot = byId.get(e.proposal_id);
    if (!slot) continue;
    slot.total += e.amount_usd ?? 0;
    if (!slot.latest || Date.parse(e.accrued_at) > Date.parse(slot.latest.accrued_at)) {
      slot.latest = e;
    }
  }
  return proposals.map((p) => {
    const slot = byId.get(p.id);
    const liveCount =
      p.on_chain_index_id != null
        ? (subCountsByIndexId.get(p.on_chain_index_id) ?? 0)
        : 0;
    return {
      ...p,
      latest_earning: slot?.latest
        ? {
            aum_usd_at_accrual: slot.latest.aum_usd_at_accrual,
            subscriber_count: slot.latest.subscriber_count,
          }
        : null,
      total_earned_usd: slot && slot.total > 0 ? slot.total : null,
      live_subscriber_count: liveCount,
    };
  });
}

function sortItems(items: DiscoverItem[], sort: SortKey): DiscoverItem[] {
  const copy = [...items];
  switch (sort) {
    case "top_return":
      copy.sort((a, b) => (b.backtest_return ?? -Infinity) - (a.backtest_return ?? -Infinity));
      break;
    case "top_sharpe":
      copy.sort((a, b) => (b.backtest_sharpe ?? -Infinity) - (a.backtest_sharpe ?? -Infinity));
      break;
    case "low_dd":
      // backtest_max_dd is stored as a negative-or-zero fraction (e.g. -0.18
      // for an 18% drawdown). "Lowest drawdown" = closest to zero =
      // largest value first.
      copy.sort((a, b) => (b.backtest_max_dd ?? -Infinity) - (a.backtest_max_dd ?? -Infinity));
      break;
    case "recent":
    default:
      copy.sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
      break;
  }
  return copy;
}

export default async function DiscoverPage({
  searchParams,
}: {
  searchParams?: { sector?: string; sort?: string; creator?: string };
}) {
  const sectorParam = singleString(searchParams?.sector);
  const sortParam = parseSort(searchParams?.sort);
  const creatorParam = singleString(searchParams?.creator).toLowerCase();

  // Pull all public proposals first — we need the full set so the sector
  // chips reflect every available ticker even when one is filtered.
  const proposalsRes = await db
    .from("pb_proposals")
    .select("*")
    .in("status", [...PUBLIC_STATUSES])
    .order("updated_at", { ascending: false })
    .limit(200);
  if (proposalsRes.error) {
    return (
      <div className="px-6 py-8 max-w-5xl mx-auto">
        <Card pad={20}>
          <Label color={tokens.red}>ERROR</Label>
          <Mono size={12} color={tokens.text} className="mt-2 block">
            Failed to load discover feed: {proposalsRes.error.message}
          </Mono>
        </Card>
      </div>
    );
  }
  const allProposals = (proposalsRes.data ?? []) as PbProposalRow[];

  // Filter the loaded set in JS — sector + creator. Sector chips need the
  // unfiltered ticker set, so derive it before applying any filter.
  const sectors = Array.from(new Set(allProposals.map((p) => p.ssi_ticker)));

  let filtered = allProposals;
  if (sectorParam) {
    filtered = filtered.filter((p) => p.ssi_ticker === sectorParam);
  }
  if (creatorParam) {
    filtered = filtered.filter((p) =>
      p.creator_address.toLowerCase().startsWith(creatorParam),
    );
  }

  // Earnings rollup — only fetch ledger rows for proposals still in the
  // filtered set. With the in-clause limited to ≤200 ids we stay well within
  // PostgREST's URL length budget.
  let earnings: PbEarningRow[] = [];
  if (filtered.length > 0) {
    const ids = filtered.map((p) => p.id);
    const earningsRes = await db
      .from("pb_earnings")
      .select("*")
      .in("proposal_id", ids);
    if (!earningsRes.error) {
      earnings = (earningsRes.data ?? []) as PbEarningRow[];
    }
  }

  // Live subscriber counts — query pb_subscriptions for active rows keyed by
  // index_id. We only fetch index_id (the group key); counts are rolled up in
  // JS so no SQL RPC is needed. Falls back to an empty map on error so the
  // rest of the page still renders.
  const subCountsByIndexId = new Map<string, number>();
  {
    const indexIds = filtered
      .map((p) => p.on_chain_index_id)
      .filter((id): id is string => id != null);
    if (indexIds.length > 0) {
      const subsRes = await db
        .from("pb_subscriptions")
        .select("index_id")
        .eq("status", "active")
        .in("index_id", indexIds);
      if (!subsRes.error) {
        for (const row of (subsRes.data ?? []) as Pick<PbSubscriptionRow, "index_id">[]) {
          subCountsByIndexId.set(
            row.index_id,
            (subCountsByIndexId.get(row.index_id) ?? 0) + 1,
          );
        }
      }
    }
  }

  const enriched = aggregateEarnings(filtered, earnings, subCountsByIndexId);
  const items = sortItems(enriched, sortParam);

  return (
    <div className="px-6 py-5 flex flex-col gap-3.5 max-w-7xl mx-auto">
      <div className="flex justify-between items-end">
        <div>
          <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>
            Discover Indices
          </div>
          <Mono size={11}>
            community-published SSI baskets · backtested · ready to subscribe
          </Mono>
        </div>
        <div className="flex gap-1.5">
          <Tag small color={tokens.cyan} dot>
            public marketplace
          </Tag>
          <Tag small color={tokens.amber}>
            wave 1 preview
          </Tag>
        </div>
      </div>

      <DiscoverFilters
        sectors={sectors}
        activeSector={sectorParam || null}
        activeSort={sortParam}
        activeCreator={creatorParam}
        totalCount={items.length}
      />

      {items.length === 0 ? (
        <Card pad={24}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>
            {allProposals.length === 0
              ? "No published indices yet"
              : "No indices match these filters"}
          </div>
          <Mono size={11} color={tokens.textDim} className="block mb-3">
            {allProposals.length === 0
              ? "Be the first to publish — visit /publisher/proposals to draft and ship an index."
              : "Try clearing the sector / creator filters."}
          </Mono>
          {allProposals.length === 0 ? (
            <Link href="/publisher/proposals" className="contents">
              <Btn small primary>
                Open publisher console →
              </Btn>
            </Link>
          ) : (
            <Link href="/discover" className="contents">
              <Btn small>Reset filters</Btn>
            </Link>
          )}
        </Card>
      ) : (
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))" }}
        >
          {items.map((item) => (
            <DiscoverCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}

function DiscoverCard({ item }: { item: DiscoverItem }) {
  const thesisPreview = item.thesis
    ? item.thesis.length > 140
      ? `${item.thesis.slice(0, 140)}…`
      : item.thesis
    : null;
  const returnVal = item.backtest_return;
  const sharpeVal = item.backtest_sharpe;
  const maxDdVal = item.backtest_max_dd;
  const aum = item.latest_earning?.aum_usd_at_accrual ?? null;
  // Use real-time count from pb_subscriptions; fall back to "—" only when the
  // proposal has no on_chain_index_id yet (not yet deployed on-chain).
  const subs =
    item.on_chain_index_id != null ? item.live_subscriber_count : null;

  return (
    <Card pad={0} className="flex flex-col">
      <div
        className="flex flex-col gap-2"
        style={{ padding: "14px 16px 12px", borderBottom: `1px solid ${tokens.borderFaint}` }}
      >
        <div className="flex items-center gap-2 flex-wrap">
          <Tag small color={tokens.amber} filled>
            {item.ssi_ticker}
          </Tag>
          <Tag
            small
            color={item.status === "live" ? tokens.emerald : tokens.cyan}
            dot
          >
            {item.status}
          </Tag>
          <Mono size={10} color={tokens.textFaint}>
            {shortAddr(item.creator_address)}
          </Mono>
        </div>
        <Link
          href={`/discover/${item.id}`}
          style={{
            fontSize: 16,
            fontWeight: 600,
            letterSpacing: "-0.02em",
            color: tokens.text,
          }}
        >
          {item.title ?? `Untitled · ${item.id.slice(0, 8)}`}
        </Link>
        {thesisPreview && (
          <div
            style={{
              fontSize: 12,
              color: tokens.textDim,
              lineHeight: 1.45,
            }}
          >
            {thesisPreview}
          </div>
        )}
      </div>

      <div
        className="grid grid-cols-3 gap-2"
        style={{ padding: "12px 16px", borderBottom: `1px solid ${tokens.borderFaint}` }}
      >
        <KpiTile
          k="RETURN"
          v={pct(returnVal)}
          c={(returnVal ?? 0) >= 0 ? tokens.emerald : tokens.red}
        />
        <KpiTile k="SHARPE" v={num(sharpeVal)} c={tokens.cyan} />
        <KpiTile k="MAX DD" v={pct(maxDdVal)} c={tokens.amber} />
      </div>

      <div
        className="grid grid-cols-2 gap-2"
        style={{ padding: "10px 16px 12px" }}
      >
        <div>
          <Label>SUBSCRIBERS</Label>
          <Mono size={13} color={tokens.text} className="mt-1 block">
            {subs !== null ? subs.toLocaleString() : "—"}
          </Mono>
        </div>
        <div>
          <Label>AUM</Label>
          <Mono size={13} color={tokens.text} className="mt-1 block">
            {fmtUsd(aum)}
          </Mono>
        </div>
      </div>

      <div
        className="flex items-center justify-between"
        style={{ padding: "10px 16px", borderTop: `1px solid ${tokens.borderFaint}` }}
      >
        <Mono size={10} color={tokens.textFaint}>
          updated {new Date(item.updated_at).toLocaleDateString()}
        </Mono>
        <Link href={`/discover/${item.id}`} className="contents">
          <Btn primary small>
            View →
          </Btn>
        </Link>
      </div>
    </Card>
  );
}

function KpiTile({ k, v, c }: { k: string; v: string; c: string }) {
  return (
    <div
      style={{
        padding: "8px 10px",
        background: tokens.bgElev2,
        border: `1px solid ${tokens.border}`,
        borderRadius: 6,
      }}
    >
      <Label>{k}</Label>
      <Metric v={v} color={c} size={16} style={{ marginTop: 2 }} />
    </div>
  );
}
