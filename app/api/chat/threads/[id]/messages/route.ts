// Append a message to a thread.
//
// POST /api/chat/threads/[id]/messages
//   body { role, content?, tool_calls?, usage? }
//
// Steps:
//   1. Auth + verify the thread is owned by the caller.
//   2. Compute the next `seq` from the current max for this thread. We do
//      this in two queries (max-then-insert) which has a TOCTOU race if the
//      same user submits two messages in parallel — acceptable because the
//      UI serializes user/assistant pairs through the same hook. A future
//      hardening would push this into a Postgres function with row locks.
//   3. Insert the message.
//   4. Bump `ch_threads.updated_at` so the sidebar's "newest activity"
//      ordering reflects the new message. ch_threads has an
//      `updated_at` trigger but it only fires on UPDATE, not on FK INSERT
//      to ch_messages — explicit nudge is required.
//   5. Optionally back-fill the thread title from the first user message
//      so the sidebar shows something useful before the user renames.

import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import { requireUser } from "@/lib/supabase/auth";
import { db } from "@/lib/supabase/server";
import type {
  ChMessageInsert,
  ChMessageRow,
  Json,
} from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

// See sibling routes for why we cast db.from(...). Database doesn't satisfy
// postgrest-js' GenericSchema and the row generic resolves to `never`
// without this escape hatch. Row types are re-imposed on read.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const threads = () => db.from("ch_threads") as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const messages = () => db.from("ch_messages") as any;

type Ctx = { params: { id: string } };

const VALID_ROLES = new Set<ChMessageRow["role"]>([
  "user",
  "assistant",
  "system",
  "tool",
]);

export async function POST(req: NextRequest, { params }: Ctx) {
  const auth = await requireUser(req);
  if (!auth.user) return auth.res;
  const userAddress = auth.user.address;

  const body = (await req.json().catch(() => null)) as
    | {
        role?: string;
        content?: string | null;
        tool_calls?: Json;
        usage?: Json;
      }
    | null;

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const role = body.role as ChMessageRow["role"] | undefined;
  if (!role || !VALID_ROLES.has(role)) {
    return NextResponse.json(
      { error: "role must be user|assistant|system|tool" },
      { status: 400 },
    );
  }

  // 1. Verify ownership of the parent thread.
  const threadRes = await threads()
    .select("id, title")
    .eq("id", params.id)
    .eq("user_address", userAddress)
    .maybeSingle();
  if (threadRes.error) {
    return NextResponse.json({ error: threadRes.error.message }, { status: 500 });
  }
  if (!threadRes.data) {
    return NextResponse.json({ error: "thread not found" }, { status: 404 });
  }
  const threadRow = threadRes.data as { id: string; title: string | null };

  // 2. Compute the next sequence number. `order desc, limit 1` is cheap
  // because of idx_ch_messages_thread_seq.
  const seqRes = await messages()
    .select("seq")
    .eq("thread_id", params.id)
    .order("seq", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (seqRes.error) {
    return NextResponse.json({ error: seqRes.error.message }, { status: 500 });
  }
  const seqRow = seqRes.data as { seq: number } | null;
  const nextSeq = (seqRow?.seq ?? 0) + 1;

  // 3. Insert the message.
  const insert: ChMessageInsert = {
    thread_id: params.id,
    user_address: userAddress,
    role,
    content: body.content ?? null,
    tool_calls: body.tool_calls ?? null,
    usage: body.usage ?? null,
    seq: nextSeq,
  };
  const insertRes = await messages()
    .insert(insert)
    .select("*")
    .single();
  if (insertRes.error || !insertRes.data) {
    return NextResponse.json(
      { error: insertRes.error?.message ?? "insert failed" },
      { status: 500 },
    );
  }

  // 4 + 5. Bump thread `updated_at` and (when this is the first user
  // message and the thread is still untitled) set the title from the
  // first ~60 chars of content. Both happen in a single UPDATE so there's
  // no extra RTT; the trigger refreshes updated_at automatically.
  const titleUpdate: { title?: string; updated_at: string } = {
    updated_at: new Date().toISOString(),
  };
  if (
    !threadRow.title &&
    role === "user" &&
    typeof body.content === "string" &&
    body.content.trim().length > 0
  ) {
    const firstLine = body.content.trim().split("\n")[0] ?? body.content.trim();
    titleUpdate.title = firstLine.slice(0, 60);
  }
  // Best-effort — if the bump fails the message is already persisted, so
  // don't fail the whole request.
  await threads()
    .update(titleUpdate)
    .eq("id", params.id)
    .eq("user_address", userAddress);

  return NextResponse.json(insertRes.data as ChMessageRow, { status: 201 });
}
