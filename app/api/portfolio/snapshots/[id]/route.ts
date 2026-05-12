// Single portfolio snapshot — read / hard delete.
//
// Ownership is enforced by `eq("user_address", userAddress)` on every query.
// A row that doesn't match the caller is reported as 404 (not 403) so the
// existence of other users' rows isn't leaked.

import { NextResponse, type NextRequest } from "next/server";

import { requireUser } from "@/lib/supabase/auth";
import { db } from "@/lib/supabase/server";
import type { PfSnapshotRow } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

export async function GET(req: NextRequest, { params }: Ctx) {
  const auth = await requireUser(req);
  if (!auth.user) return auth.res;
  const userAddress = auth.user.address;

  const { data, error } = await db
    .from("pf_snapshots")
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

  const out = NextResponse.json(data as PfSnapshotRow);
  for (const cookie of auth.res.cookies.getAll()) {
    out.cookies.set(cookie);
  }
  return out;
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const auth = await requireUser(req);
  if (!auth.user) return auth.res;
  const userAddress = auth.user.address;

  const { data, error } = await db
    .from("pf_snapshots")
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

  const out = NextResponse.json({ ok: true, id: params.id });
  for (const cookie of auth.res.cookies.getAll()) {
    out.cookies.set(cookie);
  }
  return out;
}
