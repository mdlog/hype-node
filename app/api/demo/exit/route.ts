// Demo mode exit-point.
//
// Accepts both GET (so a plain <a href="/api/demo/exit"> works) and POST.
// Destroys the iron-session and 303-redirects to the landing page.

import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { sessionOptions, type SessionData } from "@/lib/auth/session";
import { relativeRedirect } from "@/lib/http";

export const dynamic = "force-dynamic";

async function handleExit(): Promise<NextResponse> {
  const session = await getIronSession<SessionData>(cookies(), sessionOptions);
  session.destroy();

  return relativeRedirect("/", 303);
}

export const GET = handleExit;
export const POST = handleExit;
