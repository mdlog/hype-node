// Authorization gate for routes that drive the SHARED autonomous agent
// (halt/pause/reset/step, live risk-config). These are not per-user resources:
// one unauthenticated caller could halt the fund-managing agent for everyone,
// or burn the LLM key. So we require an authenticated, non-demo session and —
// when an operator allowlist is configured — membership in it.
//
// Allowlist source: AGENT_OPERATORS = comma-separated lowercased addresses.
//   - allowlist set   → only those addresses pass.
//   - allowlist empty → any authenticated wallet passes OUTSIDE production;
//                       in production we FAIL CLOSED (no operators configured
//                       == agent control disabled) so a forgotten env var can
//                       never leave these routes wide open.
//
// The policy (operatorDecision/parseOperatorAllowlist) lives in
// ./operatorPolicy.ts so it is unit-testable without Next request plumbing.

import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import { getRequestUser, type AuthedUser } from "@/lib/supabase/auth";
import { operatorDecision, parseOperatorAllowlist } from "./operatorPolicy";

export {
  operatorDecision,
  parseOperatorAllowlist,
  type OperatorDecision,
} from "./operatorPolicy";

export async function requireOperator(
  req: NextRequest,
): Promise<
  | { user: AuthedUser; res: NextResponse }
  | { user: null; res: NextResponse }
> {
  const res = NextResponse.next();
  const user = await getRequestUser(req, res);
  const decision = operatorDecision({
    user,
    allowlist: parseOperatorAllowlist(process.env.AGENT_OPERATORS),
    isProd: process.env.NODE_ENV === "production",
  });
  if (!decision.ok) {
    return {
      user: null,
      res: NextResponse.json({ error: decision.error }, { status: decision.status }),
    };
  }
  return { user: user as AuthedUser, res };
}
