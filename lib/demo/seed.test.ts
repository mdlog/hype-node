// TDD tests for demo helpers + seed data.
// Write first → run → fail → implement → pass.

import { describe, it, expect } from "vitest";
import { isDemoAddress, isDemoExpired, DEMO_ADDRESS, DEMO_TTL_MS } from "./demo";
import { DEMO_PROPOSALS, getDemoProposalById } from "./seed";

// ---------- isDemoAddress ----------
describe("isDemoAddress", () => {
  it("returns true for the sentinel (exact case)", () => {
    expect(isDemoAddress(DEMO_ADDRESS)).toBe(true);
  });
  it("returns true for the sentinel (uppercase)", () => {
    expect(isDemoAddress(DEMO_ADDRESS.toUpperCase())).toBe(true);
  });
  it("returns true for the sentinel (mixed case)", () => {
    expect(isDemoAddress("0x000000000000000000000000000000000000DEAD")).toBe(true);
  });
  it("returns false for a normal wallet address", () => {
    expect(isDemoAddress("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045")).toBe(false);
  });
  it("returns false for null", () => {
    expect(isDemoAddress(null)).toBe(false);
  });
  it("returns false for undefined", () => {
    expect(isDemoAddress(undefined)).toBe(false);
  });
  it("returns false for empty string", () => {
    expect(isDemoAddress("")).toBe(false);
  });
});

// ---------- isDemoExpired ----------
describe("isDemoExpired", () => {
  const base = 1_700_000_000_000; // arbitrary fixed ms timestamp

  it("returns false when startedAt is undefined", () => {
    expect(isDemoExpired(undefined, base + DEMO_TTL_MS + 1)).toBe(false);
  });
  it("returns false when now is 0 (not yet evaluated)", () => {
    expect(isDemoExpired(base, 0)).toBe(false);
  });
  it("returns false for a fresh session (within TTL)", () => {
    expect(isDemoExpired(base, base + DEMO_TTL_MS - 1000)).toBe(false);
  });
  it("returns true for a session exactly past TTL", () => {
    expect(isDemoExpired(base, base + DEMO_TTL_MS + 1)).toBe(true);
  });
  it("returns true for a very old session", () => {
    expect(isDemoExpired(base, base + DEMO_TTL_MS * 10)).toBe(true);
  });
});

// ---------- seed data ----------
describe("DEMO_PROPOSALS", () => {
  it("is a non-empty array", () => {
    expect(Array.isArray(DEMO_PROPOSALS)).toBe(true);
    expect(DEMO_PROPOSALS.length).toBeGreaterThan(0);
  });
  it("every proposal id starts with 'demo-'", () => {
    for (const p of DEMO_PROPOSALS) {
      expect(p.id).toMatch(/^demo-/);
    }
  });
  it("every proposal status is 'published'", () => {
    for (const p of DEMO_PROPOSALS) {
      expect(p.status).toBe("published");
    }
  });
  it("every proposal has a DEMO-prefixed ssi_ticker", () => {
    for (const p of DEMO_PROPOSALS) {
      expect(p.ssi_ticker.toUpperCase()).toContain("DEMO");
    }
  });
  it("every proposal is created by the demo sentinel", () => {
    for (const p of DEMO_PROPOSALS) {
      expect(p.creator_address).toBe(DEMO_ADDRESS);
    }
  });
  it("every proposal on_chain_index_id is null (not yet deployed)", () => {
    for (const p of DEMO_PROPOSALS) {
      expect(p.on_chain_index_id).toBeNull();
    }
  });
});

// ---------- getDemoProposalById ----------
describe("getDemoProposalById", () => {
  it("returns a row for a known seeded id", () => {
    const first = DEMO_PROPOSALS[0];
    const result = getDemoProposalById(first.id);
    expect(result).not.toBeNull();
    expect(result?.id).toBe(first.id);
  });
  it("returns null for an unknown id", () => {
    expect(getDemoProposalById("does-not-exist-xyz")).toBeNull();
  });
  it("returns null for empty string", () => {
    expect(getDemoProposalById("")).toBeNull();
  });
  it("returns matching rows for every seeded id", () => {
    for (const p of DEMO_PROPOSALS) {
      const result = getDemoProposalById(p.id);
      expect(result?.id).toBe(p.id);
    }
  });
});
