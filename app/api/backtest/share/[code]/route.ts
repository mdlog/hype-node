// Public share-link resolver. No auth — anyone with the short code can view
// the linked run. We strip `user_address` from the joined response so the
// creator's wallet isn't leaked.
//
// Behaviour:
//   - 404 if the short_code doesn't exist
//   - 410 Gone if expires_at is in the past
//   - On success: increments view_count and returns the run (sans owner)

import { NextResponse, type NextRequest } from "next/server";

import { db } from "@/lib/supabase/server";
import type { BtRunRow } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

type Ctx = { params: { code: string } };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const code = params.code;
  if (!code || typeof code !== "string") {
    return NextResponse.json({ error: "invalid code" }, { status: 400 });
  }

  const { data: link, error: linkErr } = await db
    .from("bt_share_links")
    .select("short_code, run_id, expires_at, view_count")
    .eq("short_code", code)
    .maybeSingle();

  if (linkErr) {
    return NextResponse.json({ error: linkErr.message }, { status: 500 });
  }
  if (!link) {
    return NextResponse.json({ error: "share link not found" }, { status: 404 });
  }

  const linkRow = link as {
    short_code: string;
    run_id: string;
    expires_at: string | null;
    view_count: number;
  };

  if (linkRow.expires_at) {
    const exp = Date.parse(linkRow.expires_at);
    if (!Number.isNaN(exp) && exp < Date.now()) {
      return NextResponse.json({ error: "share link expired" }, { status: 410 });
    }
  }

  const { data: run, error: runErr } = await db
    .from("bt_runs")
    .select("*")
    .eq("id", linkRow.run_id)
    .maybeSingle();

  if (runErr) {
    return NextResponse.json({ error: runErr.message }, { status: 500 });
  }
  if (!run) {
    return NextResponse.json({ error: "run not found" }, { status: 404 });
  }

  // Best-effort increment — don't fail the request if it errors.
  await db
    .from("bt_share_links")
    .update({ view_count: linkRow.view_count + 1 })
    .eq("short_code", code);

  // Strip owner wallet for privacy.
  const fullRun = run as BtRunRow;
  const { user_address: _omit, ...publicRun } = fullRun;
  void _omit;

  return NextResponse.json({
    short_code: linkRow.short_code,
    expires_at: linkRow.expires_at,
    view_count: linkRow.view_count + 1,
    run: publicRun,
  });
}
