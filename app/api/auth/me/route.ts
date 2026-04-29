import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { sessionOptions, type SessionData } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getIronSession<SessionData>(cookies(), sessionOptions);
  return NextResponse.json({
    address: session.address ?? null,
    chainId: session.chainId ?? null,
  });
}
