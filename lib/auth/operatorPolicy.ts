// Pure authorization policy for agent operator routes — no server-only / Next
// imports so it is unit-testable. The IO wrapper lives in ./operator.ts.

import type { AuthedUser } from "@/lib/supabase/auth";

export function parseOperatorAllowlist(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

export type OperatorDecision =
  | { ok: true }
  | { ok: false; status: 401 | 403; error: string };

export function operatorDecision(input: {
  user: AuthedUser | null;
  allowlist: Set<string>;
  isProd: boolean;
}): OperatorDecision {
  const { user, allowlist, isProd } = input;

  if (!user) {
    return { ok: false, status: 401, error: "auth required" };
  }
  if (user.demo) {
    return {
      ok: false,
      status: 403,
      error: "Demo mode is read-only — connect a wallet.",
    };
  }
  if (allowlist.size > 0) {
    return allowlist.has(user.address.toLowerCase())
      ? { ok: true }
      : { ok: false, status: 403, error: "operator access required" };
  }
  // No allowlist configured.
  if (isProd) {
    return {
      ok: false,
      status: 403,
      error:
        "agent control is disabled — set AGENT_OPERATORS to a wallet allowlist",
    };
  }
  return { ok: true };
}
