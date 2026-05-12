// Creator earnings ledger — list + manual insert.
//
// GET returns every accrual for the caller, optionally filtered by proposal /
// time window. Auth + creator_address scope is enforced on every query.
//
// POST is a manual entry escape-hatch (admin tooling, migration, manual
// reconciliation). The eventual production fill path is an on-chain indexer
// listening for SSI Protocol fee events — see `event_type` enum.

import { NextResponse, type NextRequest } from "next/server";

import { requireUser } from "@/lib/supabase/auth";
import { db } from "@/lib/supabase/server";
import type { PbEarningInsert, PbEarningRow } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

type EventType = NonNullable<PbEarningRow["event_type"]>;

const ALLOWED_EVENT_TYPES = new Set<EventType>([
  "mgmt_fee",
  "perf_fee",
  "subscription_fee",
  "manual",
]);

function clampLimit(raw: string | null, fallback = 100, max = 500): number {
  const n = Number(raw ?? fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), 1), max);
}

function parseIso(raw: string | null): string | null {
  if (!raw) return null;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.user) return auth.res;
  const userAddress = auth.user.address;

  const sp = req.nextUrl.searchParams;
  const proposalId = sp.get("proposal_id");
  const limit = clampLimit(sp.get("limit"));
  const from = parseIso(sp.get("from"));
  const to = parseIso(sp.get("to"));
  const eventType = sp.get("event_type");

  let q = db
    .from("pb_earnings")
    .select("*")
    .eq("creator_address", userAddress)
    .order("accrued_at", { ascending: false })
    .limit(limit);

  if (proposalId) q = q.eq("proposal_id", proposalId);
  if (from) q = q.gte("accrued_at", from);
  if (to) q = q.lte("accrued_at", to);
  if (eventType && ALLOWED_EVENT_TYPES.has(eventType as EventType))
    q = q.eq("event_type", eventType as EventType);

  const { data, error } = await q;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const out = NextResponse.json((data ?? []) as PbEarningRow[]);
  for (const cookie of auth.res.cookies.getAll()) {
    out.cookies.set(cookie);
  }
  return out;
}

type CreateBody = {
  proposal_id?: unknown;
  event_type?: unknown;
  amount_usd?: unknown;
  accrued_at?: unknown;
  tx_hash?: unknown;
  block_number?: unknown;
  aum_usd_at_accrual?: unknown;
  subscriber_count?: unknown;
};

function optString(v: unknown): string | null {
  if (typeof v === "string" && v.trim().length > 0) return v.trim();
  return null;
}

function optNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

function optInt(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  return null;
}

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.user) return auth.res;
  const userAddress = auth.user.address;

  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (typeof body.proposal_id !== "string" || !body.proposal_id) {
    return NextResponse.json(
      { error: "proposal_id (string) required" },
      { status: 400 },
    );
  }
  if (
    typeof body.event_type !== "string" ||
    !ALLOWED_EVENT_TYPES.has(body.event_type as EventType)
  ) {
    return NextResponse.json(
      {
        error: `event_type must be one of ${Array.from(ALLOWED_EVENT_TYPES).join(",")}`,
      },
      { status: 400 },
    );
  }
  if (typeof body.amount_usd !== "number" || !Number.isFinite(body.amount_usd)) {
    return NextResponse.json(
      { error: "amount_usd (number) required" },
      { status: 400 },
    );
  }

  // Ownership check: the proposal must belong to the caller. We also use the
  // lookup to confirm the row exists before writing the ledger entry.
  const proposal = await db
    .from("pb_proposals")
    .select("id, creator_address")
    .eq("id", body.proposal_id)
    .maybeSingle();
  if (proposal.error) {
    return NextResponse.json({ error: proposal.error.message }, { status: 500 });
  }
  const propRow = proposal.data as { id: string; creator_address: string } | null;
  if (!propRow || propRow.creator_address !== userAddress) {
    // Same response for "doesn't exist" and "not yours" so we don't leak ids.
    return NextResponse.json({ error: "proposal not found" }, { status: 404 });
  }

  const accruedRaw = body.accrued_at;
  const accruedAt =
    typeof accruedRaw === "string" && Number.isFinite(Date.parse(accruedRaw))
      ? new Date(accruedRaw).toISOString()
      : undefined;

  const insert: PbEarningInsert = {
    proposal_id: body.proposal_id,
    creator_address: userAddress,
    event_type: body.event_type as PbEarningRow["event_type"],
    amount_usd: body.amount_usd,
    accrued_at: accruedAt,
    tx_hash: optString(body.tx_hash),
    block_number: optInt(body.block_number),
    aum_usd_at_accrual: optNumber(body.aum_usd_at_accrual),
    subscriber_count: optInt(body.subscriber_count),
  };

  const { data, error } = await db
    .from("pb_earnings")
    .insert(insert)
    .select("*")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "insert failed" },
      { status: 500 },
    );
  }

  const out = NextResponse.json(data as PbEarningRow);
  for (const cookie of auth.res.cookies.getAll()) {
    out.cookies.set(cookie);
  }
  return out;
}
