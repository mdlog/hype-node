// Builder drafts collection endpoint.
//
// GET  /api/builder/drafts[?status=draft] — list current user's drafts,
//      newest first by updated_at.
// POST /api/builder/drafts                — create a new draft for the
//      authenticated user. Body is a subset of BdDraftInsert (user_address
//      is forced from the session, never trusted from the request body).
//
// Auth: every method requires a valid SIWE session via requireUser().
// The service-role Supabase client bypasses RLS, so the route is the only
// gate — never call db.from("bd_drafts") without a wallet check.

import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import { requireUser } from "@/lib/supabase/auth";
import { db } from "@/lib/supabase/server";
import type { BdDraftInsert, BdDraftRow } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

// The hand-written `Database` type in lib/supabase/types.ts doesn't fully
// satisfy postgrest-js' `GenericSchema` (Tables lack `Relationships`, plus
// the schema is missing `Views`/`Functions`). As a result, `db.from(...)`
// resolves its row generic to `never` at every call site. We sidestep the
// schema-mismatch error with one localized cast and re-impose the per-row
// typing on read by casting the returned `data` back to `BdDraftRow`. This
// pattern matches the other Supabase-backed routes in this repo.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const drafts = () => db.from("bd_drafts") as any;

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.user) return auth.res;
  const userAddress = auth.user.address;

  const status = req.nextUrl.searchParams.get("status");

  let query = drafts()
    .select("*")
    .eq("user_address", userAddress)
    .order("updated_at", { ascending: false });

  if (status) {
    // The CHECK constraint in 0001_init.sql restricts status to a finite
    // set; we forward whatever string the client sent and let Postgres
    // return an empty list if it doesn't match.
    query = query.eq("status", status);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json((data ?? []) as BdDraftRow[]);
}

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.user) return auth.res;
  const userAddress = auth.user.address;

  const body = (await req.json().catch(() => null)) as Partial<BdDraftInsert> | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  // Force user_address from session — never trust the client's claim of
  // who they are.
  const insert: BdDraftInsert = {
    user_address: userAddress,
    name: body.name ?? null,
    sector: body.sector ?? null,
    n_assets: body.n_assets ?? null,
    weighting_rule: body.weighting_rule ?? null,
    constituents: body.constituents ?? null,
    extra_assets: body.extra_assets ?? null,
    meta: body.meta ?? null,
    rebalance_triggers: body.rebalance_triggers ?? null,
    status: body.status ?? "draft",
  };

  const { data, error } = await drafts()
    .insert(insert)
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const id = (data as { id: string } | null)?.id ?? null;
  return NextResponse.json({ id }, { status: 201 });
}
