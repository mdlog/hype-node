// Chat threads collection endpoint.
//
// GET  /api/chat/threads[?archived=true] — list current user's threads,
//      newest activity first. By default `archived=false`; pass `?archived=
//      true` to list the archived ones. Pass `?archived=all` for both.
// POST /api/chat/threads                 — create a new (empty) thread.
//      Body { title? }: when omitted, the first user message handler may
//      back-fill it later.
//
// All access funnels through requireUser() — the service-role client bypasses
// RLS so the route is the sole guard. ch_threads.id is a uuid; the FK
// constraint on ch_messages cascades on delete.

import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import { requireUser } from "@/lib/supabase/auth";
import { db } from "@/lib/supabase/server";
import type { ChThreadInsert, ChThreadRow } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

// The hand-written Database type doesn't satisfy postgrest-js' GenericSchema
// (no Views/Functions/Relationships), so the row generic on `db.from(...)`
// resolves to `never`. We narrow with one local cast and re-impose row
// types on the returned `data`. Same pattern as builder/drafts and the
// other Supabase routes in this repo.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const threads = () => db.from("ch_threads") as any;

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.user) return auth.res;
  const userAddress = auth.user.address;

  const archivedParam = req.nextUrl.searchParams.get("archived");

  // Pinned threads sort to the top, then most-recent activity within each
  // group. The composite index idx_ch_threads_user_pinned_updated serves
  // this without a sort step.
  let query = threads()
    .select("*")
    .eq("user_address", userAddress)
    .order("pinned", { ascending: false })
    .order("updated_at", { ascending: false });

  // Default = active threads only. The sidebar wants the unarchived list
  // and the user explicitly switches to "archived" to see the rest.
  if (archivedParam === "true") {
    query = query.eq("archived", true);
  } else if (archivedParam !== "all") {
    query = query.eq("archived", false);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json((data ?? []) as ChThreadRow[]);
}

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.user) return auth.res;
  // Demo sessions must not create durable thread rows — /api/chat works
  // without a thread ID (stateless proxy), so blocking thread creation is safe.
  if (auth.user.demo) {
    return NextResponse.json(
      { ok: false, error: "Demo mode is read-only — connect a wallet." },
      { status: 403 },
    );
  }
  const userAddress = auth.user.address;

  const body = (await req.json().catch(() => null)) as { title?: string | null } | null;
  const title = body?.title?.trim() ? body.title.trim() : null;

  const insert: ChThreadInsert = {
    user_address: userAddress,
    title,
  };

  const { data, error } = await threads()
    .insert(insert)
    .select("*")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "insert failed" },
      { status: 500 },
    );
  }
  return NextResponse.json(data as ChThreadRow, { status: 201 });
}
