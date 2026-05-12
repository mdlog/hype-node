// Builder draft per-id endpoint.
//
// GET    — return one draft (404 if not owned by caller)
// PUT    — full replace (still validated on user_address, status optional)
// PATCH  — partial update (typical use: status transition draft → simulated
//          → deployed, or rename without touching constituents)
// DELETE — hard delete
//
// Ownership is enforced by chaining `.eq("user_address", ...)` on every
// mutation rather than fetching-then-checking, so a row not owned by the
// caller looks identical to "row doesn't exist" and returns 404. This
// removes a side-channel that could let one user enumerate another user's
// draft IDs.

import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import { requireUser } from "@/lib/supabase/auth";
import { db } from "@/lib/supabase/server";
import type { BdDraftRow, BdDraftUpdate } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

// See route.ts in this directory for why we cast db.from(...) here. The
// hand-written Database type doesn't satisfy postgrest-js' GenericSchema,
// so the row generic resolves to `never` without this escape hatch. The
// returned `data` is re-typed back to BdDraftRow.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const drafts = () => db.from("bd_drafts") as any;

type Ctx = { params: { id: string } };

export async function GET(req: NextRequest, { params }: Ctx) {
  const auth = await requireUser(req);
  if (!auth.user) return auth.res;
  const userAddress = auth.user.address;

  const { data, error } = await drafts()
    .select("*")
    .eq("id", params.id)
    .eq("user_address", userAddress)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json(data as BdDraftRow);
}

// Whitelist of fields a client may write. id/created_at/updated_at/
// user_address are stripped: the row already has the correct values, and
// `updated_at` is bumped by the trg_bd_drafts_updated_at trigger.
function sanitizeUpdate(body: Partial<BdDraftUpdate>): BdDraftUpdate {
  const out: BdDraftUpdate = {};
  if ("name" in body) out.name = body.name ?? null;
  if ("sector" in body) out.sector = body.sector ?? null;
  if ("n_assets" in body) out.n_assets = body.n_assets ?? null;
  if ("weighting_rule" in body) out.weighting_rule = body.weighting_rule ?? null;
  if ("constituents" in body) out.constituents = body.constituents ?? null;
  if ("extra_assets" in body) out.extra_assets = body.extra_assets ?? null;
  if ("meta" in body) out.meta = body.meta ?? null;
  if ("rebalance_triggers" in body) out.rebalance_triggers = body.rebalance_triggers ?? null;
  if ("status" in body && body.status) out.status = body.status;
  return out;
}

export async function PUT(req: NextRequest, { params }: Ctx) {
  const auth = await requireUser(req);
  if (!auth.user) return auth.res;
  const userAddress = auth.user.address;

  const body = (await req.json().catch(() => null)) as Partial<BdDraftUpdate> | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const update = sanitizeUpdate(body);
  const { data, error } = await drafts()
    .update(update)
    .eq("id", params.id)
    .eq("user_address", userAddress)
    .select("*")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json(data as BdDraftRow);
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  // Same wire shape as PUT — sanitizeUpdate already returns only the fields
  // the caller actually touched, so partial semantics fall out naturally.
  return PUT(req, ctx);
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const auth = await requireUser(req);
  if (!auth.user) return auth.res;
  const userAddress = auth.user.address;

  const { error, count } = await drafts()
    .delete({ count: "exact" })
    .eq("id", params.id)
    .eq("user_address", userAddress);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!count) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
