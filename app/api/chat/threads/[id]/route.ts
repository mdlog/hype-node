// Chat thread per-id endpoint.
//
// GET    — return { thread, messages[] } where messages are sorted by `seq`.
//          A single round trip avoids the typical "list, then fetch" double
//          load when the chat page first opens an existing thread.
// PATCH  — update title and/or archived flag. We don't expose the rest of
//          ch_threads because user_address is immutable and the timestamps
//          are managed by triggers.
// DELETE — drop the thread. ch_messages cascades via FK.
//
// Ownership is enforced by chaining `.eq("user_address", ...)` on every
// query so attempts on someone else's thread look like 404, not 403.

import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import { requireUser } from "@/lib/supabase/auth";
import { db } from "@/lib/supabase/server";
import type { ChMessageRow, ChThreadRow, ChThreadUpdate } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

// See route.ts in this directory for why we cast db.from(...). The Database
// type doesn't satisfy postgrest-js' GenericSchema, so the row generic
// resolves to `never` without the cast. We re-impose row types on read.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const threads = () => db.from("ch_threads") as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const messages = () => db.from("ch_messages") as any;

type Ctx = { params: { id: string } };

export async function GET(req: NextRequest, { params }: Ctx) {
  const auth = await requireUser(req);
  if (!auth.user) return auth.res;
  const userAddress = auth.user.address;

  const threadRes = await threads()
    .select("*")
    .eq("id", params.id)
    .eq("user_address", userAddress)
    .maybeSingle();

  if (threadRes.error) {
    return NextResponse.json({ error: threadRes.error.message }, { status: 500 });
  }
  if (!threadRes.data) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Filter messages on user_address as a defense-in-depth gate even though
  // thread ownership above is already verified — the FK ties them together.
  const msgRes = await messages()
    .select("*")
    .eq("thread_id", params.id)
    .eq("user_address", userAddress)
    .order("seq", { ascending: true });

  if (msgRes.error) {
    return NextResponse.json({ error: msgRes.error.message }, { status: 500 });
  }

  return NextResponse.json({
    thread: threadRes.data as ChThreadRow,
    messages: (msgRes.data ?? []) as ChMessageRow[],
  });
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const auth = await requireUser(req);
  if (!auth.user) return auth.res;
  const userAddress = auth.user.address;

  const body = (await req.json().catch(() => null)) as
    | { title?: string | null; archived?: boolean; pinned?: boolean }
    | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const update: ChThreadUpdate = {};
  if ("title" in body) update.title = body.title?.toString().trim() || null;
  if ("archived" in body && typeof body.archived === "boolean") {
    update.archived = body.archived;
  }
  if ("pinned" in body && typeof body.pinned === "boolean") {
    update.pinned = body.pinned;
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }

  const { data, error } = await threads()
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
  return NextResponse.json(data as ChThreadRow);
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const auth = await requireUser(req);
  if (!auth.user) return auth.res;
  const userAddress = auth.user.address;

  const { error, count } = await threads()
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
