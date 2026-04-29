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
    const url = req.nextUrl.clone();
    url.pathname = "/";
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
  ],
};
