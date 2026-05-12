// Aggregated earnings stats for the dashboard.
//
// Done in app code (not a SQL view) because the row counts here stay small
// per-creator — looping in Node is fine and avoids a migration round-trip.
// If a single creator ever grows past tens of thousands of accruals, switch
// to a Postgres materialized view or a `select sum() group by` pass.

import { NextResponse, type NextRequest } from "next/server";

import { requireUser } from "@/lib/supabase/auth";
import { db } from "@/lib/supabase/server";
import type { PbEarningRow, PbProposalRow } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

type ByProposal = {
  proposal_id: string;
  title: string | null;
  ssi_ticker: string | null;
  total_usd: number;
  count: number;
  last_accrued_at: string | null;
  latest_aum_usd: number | null;
  latest_subscribers: number | null;
};

type ByMonth = { month: string; total_usd: number; count: number };

type ByEvent = { event_type: PbEarningRow["event_type"]; total_usd: number; count: number };

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.user) return auth.res;
  const userAddress = auth.user.address;

  const { data: rowsRaw, error } = await db
    .from("pb_earnings")
    .select("*")
    .eq("creator_address", userAddress)
    .order("accrued_at", { ascending: false })
    .limit(5000);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (rowsRaw ?? []) as PbEarningRow[];

  // Resolve referenced proposal titles in one round-trip.
  const proposalIds = Array.from(new Set(rows.map((r) => r.proposal_id)));
  const titleMap = new Map<string, { title: string | null; ssi_ticker: string }>();
  if (proposalIds.length > 0) {
    const { data: props, error: propsErr } = await db
      .from("pb_proposals")
      .select("id, title, ssi_ticker")
      .in("id", proposalIds)
      .eq("creator_address", userAddress);
    if (propsErr) {
      return NextResponse.json({ error: propsErr.message }, { status: 500 });
    }
    for (const p of (props ?? []) as Pick<
      PbProposalRow,
      "id" | "title" | "ssi_ticker"
    >[]) {
      titleMap.set(p.id, { title: p.title, ssi_ticker: p.ssi_ticker });
    }
  }

  let totalUsd = 0;
  const byProp = new Map<string, ByProposal>();
  const byMonthMap = new Map<string, ByMonth>();
  const byEventMap = new Map<PbEarningRow["event_type"], ByEvent>();

  // Rows arrive newest-first, which means the first time we touch a proposal
  // we already have its latest accrual snapshot — convenient for the
  // "latest AUM / latest subscribers" columns without a second pass.
  for (const r of rows) {
    totalUsd += r.amount_usd;

    const propMeta = titleMap.get(r.proposal_id);
    const existing = byProp.get(r.proposal_id);
    if (existing) {
      existing.total_usd += r.amount_usd;
      existing.count += 1;
    } else {
      byProp.set(r.proposal_id, {
        proposal_id: r.proposal_id,
        title: propMeta?.title ?? null,
        ssi_ticker: propMeta?.ssi_ticker ?? null,
        total_usd: r.amount_usd,
        count: 1,
        last_accrued_at: r.accrued_at,
        latest_aum_usd: r.aum_usd_at_accrual,
        latest_subscribers: r.subscriber_count,
      });
    }

    const month = r.accrued_at.slice(0, 7); // YYYY-MM
    const m = byMonthMap.get(month);
    if (m) {
      m.total_usd += r.amount_usd;
      m.count += 1;
    } else {
      byMonthMap.set(month, { month, total_usd: r.amount_usd, count: 1 });
    }

    const e = byEventMap.get(r.event_type);
    if (e) {
      e.total_usd += r.amount_usd;
      e.count += 1;
    } else {
      byEventMap.set(r.event_type, {
        event_type: r.event_type,
        total_usd: r.amount_usd,
        count: 1,
      });
    }
  }

  const byProposal = Array.from(byProp.values()).sort(
    (a, b) => b.total_usd - a.total_usd,
  );
  const byMonth = Array.from(byMonthMap.values()).sort((a, b) =>
    a.month < b.month ? -1 : 1,
  );
  const byEventType = Array.from(byEventMap.values()).sort(
    (a, b) => b.total_usd - a.total_usd,
  );

  // 30-day window total for the KPI card.
  const cutoff = Date.now() - 30 * 24 * 3600_000;
  const last30Total = rows.reduce(
    (sum, r) => (Date.parse(r.accrued_at) >= cutoff ? sum + r.amount_usd : sum),
    0,
  );

  const out = NextResponse.json({
    total_usd: totalUsd,
    last_30d_usd: last30Total,
    accrual_count: rows.length,
    proposal_count: byProp.size,
    by_proposal: byProposal,
    by_month: byMonth,
    by_event_type: byEventType,
  });
  for (const cookie of auth.res.cookies.getAll()) {
    out.cookies.set(cookie);
  }
  return out;
}
