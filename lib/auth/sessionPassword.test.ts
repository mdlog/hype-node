import { describe, expect, it } from "vitest";

import {
  DEV_FALLBACK_PASSWORD,
  resolveSessionPassword,
} from "./sessionPassword";

const STRONG = "x".repeat(40);

describe("resolveSessionPassword", () => {
  it("returns a real 32+ char secret in any environment", () => {
    expect(
      resolveSessionPassword({ SESSION_PASSWORD: STRONG, NODE_ENV: "production" }),
    ).toBe(STRONG);
    expect(
      resolveSessionPassword({ SESSION_PASSWORD: STRONG, NODE_ENV: "development" }),
    ).toBe(STRONG);
  });

  it("allows the dev fallback outside production", () => {
    expect(resolveSessionPassword({ NODE_ENV: "development" })).toBe(
      DEV_FALLBACK_PASSWORD,
    );
    expect(resolveSessionPassword({ NODE_ENV: undefined })).toBe(
      DEV_FALLBACK_PASSWORD,
    );
  });

  it("throws in production when SESSION_PASSWORD is missing", () => {
    expect(() => resolveSessionPassword({ NODE_ENV: "production" })).toThrow(
      /SESSION_PASSWORD must be set/i,
    );
  });

  it("throws in production when SESSION_PASSWORD is the public dev fallback", () => {
    expect(() =>
      resolveSessionPassword({
        SESSION_PASSWORD: DEV_FALLBACK_PASSWORD,
        NODE_ENV: "production",
      }),
    ).toThrow(/forgeable|public dev fallback/i);
  });

  it("does NOT throw during next build even in production (secrets injected at runtime)", () => {
    expect(
      resolveSessionPassword({
        NODE_ENV: "production",
        NEXT_PHASE: "phase-production-build",
      }),
    ).toBe(DEV_FALLBACK_PASSWORD);
  });

  it("rejects a too-short real password", () => {
    expect(() =>
      resolveSessionPassword({ SESSION_PASSWORD: "tooshort", NODE_ENV: "development" }),
    ).toThrow(/at least 32/i);
  });
});
