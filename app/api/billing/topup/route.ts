import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { topUp } from "@/lib/billing";
import { sessionOptions, type SessionData } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * Mock top-up endpoint. In production this would be gated behind a real
 * payment proof — USDC transfer on ValueChain L1, a Stripe webhook, etc. —
 * before crediting the balance. For demo purposes the endpoint just trusts
 * the authenticated user and records the requested amount.
 */
export async function POST(req: NextRequest) {
  const session = await getIronSession<SessionData>(cookies(), sessionOptions);
  if (!session.address) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  if (session.demo) {
    return NextResponse.json(
      { ok: false, error: "Demo mode is read-only — connect a wallet." },
      { status: 403 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as { amount_usd?: unknown };
  const amount = Number(body.amount_usd);
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json(
      { error: "amount_usd must be a positive number" },
      { status: 400 },
    );
  }

  try {
    const snapshot = topUp(session.address, amount);
    return NextResponse.json({ ok: true, snapshot });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 400 },
    );
  }
}
