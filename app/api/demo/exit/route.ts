// Demo mode exit-point.
//
// Accepts both GET (so a plain <a href="/api/demo/exit"> works) and POST.
// Destroys the iron-session and 303-redirects to the landing page.

import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { sessionOptions, type SessionData } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

async function handleExit(req: NextRequest): Promise<NextResponse> {
  const session = await getIronSession<SessionData>(cookies(), sessionOptions);
  session.destroy();

  return NextResponse.redirect(new URL("/", req.url), { status: 303 });
}

export const GET = handleExit;
export const POST = handleExit;
