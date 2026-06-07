// Cancel-pending-deposit request — keeper-mediated.
//
// POST { depositId: number, indexId: string }
//
// Inserts a pb_cancel_requests row.  The keeper reads this table before
// calling pullForDeposit and, if a matching pending row exists, calls
// cancelDeposit(id, 0) instead.  The window is ~1 keeper tick (~seconds).
//
// Guards:
//   - requireUser: wallet must be connected (401 if not).
//   - demo sessions: 403, read-only.
//   - deposit_id must be a positive integer.

import { NextResponse, type NextRequest } from "next/server";

import { requireUser } from "@/lib/supabase/auth";
import { db } from "@/lib/supabase/server";
import type { PbCancelRequestInsert } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cancelRequests = () => db.from("pb_cancel_requests") as any;

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.user) return auth.res;

  if (auth.user.demo) {
    return NextResponse.json(
      { ok: false, error: "Demo mode is read-only — connect a wallet to request cancellation." },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const { depositId, indexId } = body as { depositId?: unknown; indexId?: unknown };

  if (typeof depositId !== "number" || !Number.isInteger(depositId) || depositId <= 0) {
    return NextResponse.json(
      { ok: false, error: "depositId must be a positive integer." },
      { status: 400 },
    );
  }
  if (typeof indexId !== "string" || !indexId.startsWith("0x")) {
    return NextResponse.json(
      { ok: false, error: "indexId must be a 0x-prefixed hex string." },
      { status: 400 },
    );
  }

  const insert: PbCancelRequestInsert = {
    deposit_id: depositId,
    subscriber_address: auth.user.address,
    index_id: indexId,
    status: "pending",
  };

  const { error } = await cancelRequests().insert(insert);

  if (error) {
    // Conflict on primary key = already requested; treat as success.
    if (error.code === "23505") {
      const out = NextResponse.json({ ok: true, already_requested: true });
      for (const cookie of auth.res.cookies.getAll()) out.cookies.set(cookie);
      return out;
    }
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const out = NextResponse.json({ ok: true });
  for (const cookie of auth.res.cookies.getAll()) out.cookies.set(cookie);
  return out;
}
