import { describe, expect, it } from "vitest";

import { slidingWindowDecision } from "./rateLimitPolicy";

describe("slidingWindowDecision", () => {
  it("allows hits under the limit and records them", () => {
    const d = slidingWindowDecision([], 3, 1000, 100);
    expect(d.allowed).toBe(true);
    expect(d.kept).toEqual([100]);
  });

  it("blocks once the limit is reached within the window", () => {
    const d = slidingWindowDecision([10, 20, 30], 3, 1000, 100);
    expect(d.allowed).toBe(false);
    // oldest (10) ages out at 10 + 1000 = 1010 → retry in 910ms
    expect(d.retryAfterMs).toBe(910);
  });

  it("prunes timestamps older than the window", () => {
    // window 1000, now 2000 → cutoff 1000; only 1500 survives, so under limit
    const d = slidingWindowDecision([100, 500, 1500], 3, 1000, 2000);
    expect(d.allowed).toBe(true);
    expect(d.kept).toEqual([1500, 2000]);
  });

  it("treats limit boundary correctly (exactly at limit blocks)", () => {
    expect(slidingWindowDecision([1, 2], 2, 1000, 3).allowed).toBe(false);
    expect(slidingWindowDecision([1], 2, 1000, 3).allowed).toBe(true);
  });
});
