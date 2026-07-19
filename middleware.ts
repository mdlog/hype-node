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
    // Relative Location so the browser resolves it against the public origin
    // it requested — a reverse proxy's internal Host (e.g. localhost:3002)
    // must not leak into the redirect. Same reasoning as lib/http.ts.
    const params = new URLSearchParams({ auth: "required", from: pathname });
    return new NextResponse(null, {
      status: 307,
      headers: { Location: `/?${params.toString()}` },
    });
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
