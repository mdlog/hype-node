import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getSnapshot } from "@/lib/billing";
import { sessionOptions, type SessionData } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getIronSession<SessionData>(cookies(), sessionOptions);
  if (!session.address) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  return NextResponse.json(getSnapshot(session.address));
}
