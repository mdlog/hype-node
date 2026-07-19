// Demo mode entry-point.
//
// Accepts both GET (so a plain <a href="/api/demo/enter"> works) and POST
// (for programmatic callers). Sets an iron-session with the demo sentinel
// address and immediately 303-redirects to the role home.
//
// Optional query param: ?role=indexer|publisher  (default: indexer)
//   indexer   → /dashboard
//   publisher → /publisher/radar

import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { sessionOptions, type SessionData } from "@/lib/auth/session";
import { DEMO_ADDRESS } from "@/lib/demo/demo";
import { relativeRedirect } from "@/lib/http";

export const dynamic = "force-dynamic";

const ROLE_REDIRECTS: Record<string, string> = {
  indexer: "/dashboard",
  publisher: "/publisher/radar",
};

async function handleEnter(req: NextRequest): Promise<NextResponse> {
  const roleParam = req.nextUrl.searchParams.get("role") ?? "indexer";
  const role: "indexer" | "publisher" =
    roleParam === "publisher" ? "publisher" : "indexer";

  const session = await getIronSession<SessionData>(cookies(), sessionOptions);
  session.address = DEMO_ADDRESS;
  session.chainId = 138565;
  session.demo = true;
  session.demoStartedAt = Date.now();
  session.preferredRole = role;
  // Clear any lingering nonce from a prior SIWE flow.
  session.nonce = undefined;
  await session.save();

  const destination = ROLE_REDIRECTS[role] ?? "/dashboard";
  return relativeRedirect(destination, 303);
}

export const GET = handleEnter;
export const POST = handleEnter;
