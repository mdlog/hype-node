import { getIronSession } from "iron-session";
import { NextResponse, type NextRequest } from "next/server";

import { sessionOptions, type SessionData } from "@/lib/auth/session";

// All app surfaces behind SIWE. Anything not listed here (landing, /api/*,
// static assets) stays public.
const PROTECTED = [
  "/dashboard",
  "/agent",
  "/portfolio",
  "/risk",
  "/history",
  "/research",
  "/backtest",
  "/builder",
  "/chat",
  "/settings",
  "/publisher",
  "/onboarding",
];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isProtected = PROTECTED.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  if (!isProtected) return NextResponse.next();

  const res = NextResponse.next();
  const session = await getIronSession<SessionData>(req, res, sessionOptions);
  if (!session.address) {
    // Must be ABSOLUTE — unlike route handlers (lib/http.ts), middleware can't
    // emit a relative Location: Next 14's adapter parses it with `new URL()`
    // and no base, which throws "Invalid URL" → 500. Take the host from the
    // Host header, not `req.nextUrl`: Next builds nextUrl from its listen
    // address (https://localhost:3002 behind the tunnel), while cloudflared
    // forwards the public Host untouched. The scheme is already correct —
    // Next derives nextUrl's protocol from x-forwarded-proto.
    const host = req.headers.get("host") ?? req.nextUrl.host;
    const url = new URL(`${req.nextUrl.protocol}//${host}/`);
    url.searchParams.set("auth", "required");
    url.searchParams.set("from", pathname);
    return NextResponse.redirect(url);
  }
  return res;
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/agent/:path*",
    "/portfolio/:path*",
    "/risk/:path*",
    "/history/:path*",
    "/research/:path*",
    "/backtest/:path*",
    "/builder/:path*",
    "/chat/:path*",
    "/settings/:path*",
    "/publisher/:path*",
    "/onboarding/:path*",
  ],
};
