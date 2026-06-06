// Bridge between iron-session (SIWE) and Supabase queries.
//
// Every server-side route handler that touches Supabase MUST gate on
// `requireUser()` to obtain the lowercased wallet address that all per-user
// rows are keyed by. Without this gate, queries against `db.from(...)` are
// not authenticated at the app level (the service role bypasses RLS).

import "server-only";

import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { sessionOptions, type SessionData } from "@/lib/auth/session";

export type AuthedUser = {
  /** Lowercased wallet address — matches what we store in user_address columns. */
  address: string;
  chainId?: number;
  preferredRole?: "indexer" | "publisher";
  /** True when this is a demo-mode session (no wallet, read-only). */
  demo?: boolean;
};

/**
 * For Server Components — reads the session cookie via `next/headers`.
 * Returns null when the user isn't signed in.
 */
export async function getOptionalUser(): Promise<AuthedUser | null> {
  const session = await getIronSession<SessionData>(cookies(), sessionOptions);
  if (!session.address) return null;
  return {
    address: session.address.toLowerCase(),
    chainId: session.chainId,
    preferredRole: session.preferredRole,
    demo: session.demo ?? false,
  };
}

/**
 * For route handlers — reads the session via the request/response pair so
 * iron-session can write back any cookie updates. Returns null if the user
 * isn't signed in (caller should respond 401).
 */
export async function getRequestUser(
  req: NextRequest,
  res: NextResponse,
): Promise<AuthedUser | null> {
  const session = await getIronSession<SessionData>(req, res, sessionOptions);
  if (!session.address) return null;
  return {
    address: session.address.toLowerCase(),
    chainId: session.chainId,
    preferredRole: session.preferredRole,
  };
}

/**
 * Convenience wrapper: returns either { user, res } on success or just
 * { res } with a 401 on failure. Caller pattern:
 *
 *   const auth = await requireUser(req);
 *   if (!auth.user) return auth.res;
 *   const { address } = auth.user;
 */
export async function requireUser(
  req: NextRequest,
): Promise<{ user: AuthedUser; res: NextResponse } | { user: null; res: NextResponse }> {
  const res = NextResponse.next();
  const user = await getRequestUser(req, res);
  if (!user) {
    return {
      user: null,
      res: NextResponse.json({ error: "auth required" }, { status: 401 }),
    };
  }
  return { user, res };
}
