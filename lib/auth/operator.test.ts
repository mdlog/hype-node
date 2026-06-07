import { describe, expect, it } from "vitest";

import { operatorDecision, parseOperatorAllowlist } from "./operatorPolicy";
import type { AuthedUser } from "@/lib/supabase/auth";

const opAddr = "0xabc0000000000000000000000000000000000001";
const otherAddr = "0xdef0000000000000000000000000000000000002";

function user(over: Partial<AuthedUser> = {}): AuthedUser {
  return { address: opAddr, demo: false, ...over };
}

describe("parseOperatorAllowlist", () => {
  it("splits, trims, lowercases, drops blanks", () => {
    const set = parseOperatorAllowlist(` ${opAddr.toUpperCase()} , , ${otherAddr} `);
    expect(set.has(opAddr)).toBe(true);
    expect(set.has(otherAddr)).toBe(true);
    expect(set.size).toBe(2);
  });
  it("returns empty set for undefined/empty", () => {
    expect(parseOperatorAllowlist(undefined).size).toBe(0);
    expect(parseOperatorAllowlist("").size).toBe(0);
    expect(parseOperatorAllowlist("  , ,").size).toBe(0);
  });
});

describe("operatorDecision", () => {
  const empty = new Set<string>();
  const allow = new Set([opAddr]);

  it("rejects unauthenticated callers with 401", () => {
    expect(operatorDecision({ user: null, allowlist: allow, isProd: true })).toEqual({
      ok: false,
      status: 401,
      error: "auth required",
    });
  });

  it("rejects demo sessions with 403", () => {
    const d = operatorDecision({
      user: user({ demo: true }),
      allowlist: empty,
      isProd: false,
    });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.status).toBe(403);
  });

  it("allows an allowlisted operator (case-insensitive)", () => {
    expect(
      operatorDecision({
        user: user({ address: opAddr.toUpperCase() }),
        allowlist: allow,
        isProd: true,
      }),
    ).toEqual({ ok: true });
  });

  it("rejects an authenticated non-operator when allowlist is set", () => {
    const d = operatorDecision({
      user: user({ address: otherAddr }),
      allowlist: allow,
      isProd: true,
    });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.status).toBe(403);
  });

  it("FAILS CLOSED in production when no allowlist configured", () => {
    const d = operatorDecision({ user: user(), allowlist: empty, isProd: true });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.status).toBe(403);
  });

  it("allows any authed wallet outside production when no allowlist", () => {
    expect(
      operatorDecision({ user: user(), allowlist: empty, isProd: false }),
    ).toEqual({ ok: true });
  });
});
