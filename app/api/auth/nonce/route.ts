import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { generateNonce } from "siwe";

import { sessionOptions, type SessionData } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

// Issue a single-use nonce, store it in the session cookie, and return it
// to the client. The client embeds it in the SIWE message so /verify can
// confirm the signature was produced for *this* session.
export async function GET() {
  const session = await getIronSession<SessionData>(cookies(), sessionOptions);
  session.nonce = generateNonce();
  await session.save();
  return NextResponse.json({ nonce: session.nonce });
}
