import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { SiweMessage } from "siwe";

import { sessionOptions, type SessionData } from "@/lib/auth/session";
import { rateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // Throttle SIWE verifies per IP — signature spam / brute force.
  const limited = rateLimit(req, "auth:verify", 20, 60_000);
  if (limited) return limited;

  const session = await getIronSession<SessionData>(cookies(), sessionOptions);

  const { message, signature } = (await req.json()) as {
    message?: string;
    signature?: `0x${string}`;
  };
  if (!message || !signature) {
    return NextResponse.json({ ok: false, error: "missing message/signature" }, { status: 400 });
  }
  if (!session.nonce) {
    return NextResponse.json({ ok: false, error: "no nonce in session" }, { status: 400 });
  }

  try {
    const siwe = new SiweMessage(message);
    const result = await siwe.verify({ signature, nonce: session.nonce });
    if (!result.success) {
      return NextResponse.json({ ok: false, error: "invalid signature" }, { status: 401 });
    }
    session.address = siwe.address.toLowerCase();
    session.chainId = siwe.chainId;
    // Nonce is single-use — clear so the same signature can't be replayed
    // for a future session.
    session.nonce = undefined;
    await session.save();
    return NextResponse.json({
      ok: true,
      address: session.address,
      role: session.preferredRole ?? null,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message || "verify failed" },
      { status: 401 },
    );
  }
}
