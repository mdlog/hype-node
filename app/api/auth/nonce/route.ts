import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { generateNonce } from "siwe";

import { sessionOptions, type SessionData } from "@/lib/auth/session";
import { rateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

// Issue a single-use nonce, store it in the session cookie, and return it
// to the client. The client embeds it in the SIWE message so /verify can
// confirm the signature was produced for *this* session.
export async function GET(req: NextRequest) {
  // Throttle nonce issuance per IP — cheap to call, don't let it be a spam amp.
  const limited = rateLimit(req, "auth:nonce", 60, 60_000);
  if (limited) return limited;

  const session = await getIronSession<SessionData>(cookies(), sessionOptions);
  session.nonce = generateNonce();
  await session.save();
  return NextResponse.json({ nonce: session.nonce });
}
