// Single backtest run — read / patch metadata / hard delete.
//
// Ownership is enforced by `eq("user_address", userAddress)` on every query.
// A row that doesn't match the caller is reported as 404 (not 403) so the
// existence of other users' rows isn't leaked.

import { NextResponse, type NextRequest } from "next/server";

import { requireUser } from "@/lib/supabase/auth";
import { db } from "@/lib/supabase/server";
import type { BtRunRow, BtRunUpdate } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

export async function GET(req: NextRequest, { params }: Ctx) {
  const auth = await requireUser(req);
  if (!auth.user) return auth.res;
  const userAddress = auth.user.address;

  const { data, error } = await db
    .from("bt_runs")
    .select("*")
    .eq("user_address", userAddress)
    .eq("id", params.id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json(data as BtRunRow);
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const auth = await requireUser(req);
  if (!auth.user) return auth.res;
  const userAddress = auth.user.address;

  let body: { label?: unknown; notes?: unknown; tags?: unknown };
  try {
    body = (await req.json()) as { label?: unknown; notes?: unknown; tags?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const patch: BtRunUpdate = {};
  if ("label" in body) {
    if (body.label === null) patch.label = null;
    else if (typeof body.label === "string") patch.label = body.label.trim() || null;
    else return NextResponse.json({ error: "label must be string|null" }, { status: 400 });
  }
  if ("notes" in body) {
    if (body.notes === null) patch.notes = null;
    else if (typeof body.notes === "string") patch.notes = body.notes.trim() || null;
    else return NextResponse.json({ error: "notes must be string|null" }, { status: 400 });
  }
  if ("tags" in body) {
    if (body.tags === null) patch.tags = null;
    else if (
      Array.isArray(body.tags) &&
      body.tags.every((t) => typeof t === "string")
    ) {
      patch.tags = body.tags;
    } else {
      return NextResponse.json({ error: "tags must be string[]|null" }, { status: 400 });
    }
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "no updatable fields provided" }, { status: 400 });
  }

  // See note in routes.ts about the proxy-induced `never` narrowing on
  // mutating calls — cast the payload to satisfy type-checking.
  const { data, error } = await db
    .from("bt_runs")
    .update(patch)
    .eq("user_address", userAddress)
    .eq("id", params.id)
    .select("*")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json(data as BtRunRow);
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const auth = await requireUser(req);
  if (!auth.user) return auth.res;
  const userAddress = auth.user.address;

  // Use `select` to detect whether anything was actually deleted (so we can
  // return a 404 when the row doesn't exist or belongs to someone else).
  const { data, error } = await db
    .from("bt_runs")
    .delete()
    .eq("user_address", userAddress)
    .eq("id", params.id)
    .select("id");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data || data.length === 0) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, id: params.id });
}
