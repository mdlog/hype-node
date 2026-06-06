// TDD tests for pure aggregation helpers — written before implementation.
// Run: npm test lib/track-record/aggregate.test.ts

import { describe, it, expect } from "vitest";
import { realizedFromRebalances, creatorLeaderboard } from "./aggregate";
import type { PtRebalanceRow } from "@/lib/supabase/types";
import type { PbProposalRow } from "@/lib/supabase/types";

// ---- fixtures ----

const BASE_REBALANCE: PtRebalanceRow = {
  id: "r1",
  created_at: "2026-06-01T00:00:00.000Z",
  sector: "DePIN",
  ssi_ticker: "ssiDEPIN",
  creator_address: "0xCreatorA",
  basket_before: null,
  basket_after: null,
  strategy_source: "agent_draft",
  sentiment_score: 0.72,
  risk_verdict: "pass",
  ssi_tx_hash: "0xabc",
  sodex_placed: 3,
  sodex_skipped: 1,
  sodex_errors: 0,
  emergency: false,
};

const EMERGENCY_REBALANCE: PtRebalanceRow = {
  ...BASE_REBALANCE,
  id: "r2",
  created_at: "2026-06-02T00:00:00.000Z",
  sodex_placed: 0,
  sodex_skipped: 0,
  sodex_errors: 2,
  emergency: true,
};

const SECOND_REBALANCE: PtRebalanceRow = {
  ...BASE_REBALANCE,
  id: "r3",
  created_at: "2026-06-03T00:00:00.000Z",
  ssi_ticker: "ssiDEPIN",
  creator_address: "0xCreatorA",
  sodex_placed: 2,
  sodex_skipped: 0,
  sodex_errors: 1,
  emergency: false,
};

const CREATOR_B_REBALANCE: PtRebalanceRow = {
  ...BASE_REBALANCE,
  id: "r4",
  created_at: "2026-06-01T00:00:00.000Z",
  ssi_ticker: "ssiAI",
  creator_address: "0xCreatorB",
  sodex_placed: 5,
  sodex_skipped: 0,
  sodex_errors: 0,
  emergency: false,
};

const BASE_PROPOSAL: PbProposalRow = {
  id: "p1",
  creator_address: "0xCreatorA",
  created_at: "2026-05-01T00:00:00.000Z",
  updated_at: "2026-05-01T00:00:00.000Z",
  ssi_ticker: "ssiDEPIN",
  title: "DePIN Index",
  thesis: null,
  constituents: [],
  meta: null,
  source: "agent_draft",
  source_run_id: null,
  status: "published",
  on_chain_tx: null,
  on_chain_index_id: null,
  backtest_return: 0.412,
  backtest_sharpe: 1.85,
  backtest_max_dd: -0.23,
};

const PROPOSAL_B: PbProposalRow = {
  ...BASE_PROPOSAL,
  id: "p2",
  creator_address: "0xCreatorB",
  ssi_ticker: "ssiAI",
  backtest_return: 0.693,
  backtest_sharpe: 2.14,
  backtest_max_dd: -0.31,
};

// ---- realizedFromRebalances ----

describe("realizedFromRebalances", () => {
  it("returns zeros for empty input", () => {
    const result = realizedFromRebalances([]);
    expect(result.cycles).toBe(0);
    expect(result.placed).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.errors).toBe(0);
    expect(result.emergencies).toBe(0);
  });

  it("sums placed/skipped/errors/emergencies across all rebalances", () => {
    const result = realizedFromRebalances([BASE_REBALANCE, EMERGENCY_REBALANCE, SECOND_REBALANCE]);
    expect(result.cycles).toBe(3);
    expect(result.placed).toBe(3 + 0 + 2);   // 5
    expect(result.skipped).toBe(1 + 0 + 0);  // 1
    expect(result.errors).toBe(0 + 2 + 1);   // 3
    expect(result.emergencies).toBe(1);
  });

  it("handles a single rebalance correctly", () => {
    const result = realizedFromRebalances([BASE_REBALANCE]);
    expect(result.cycles).toBe(1);
    expect(result.placed).toBe(3);
    expect(result.skipped).toBe(1);
    expect(result.errors).toBe(0);
    expect(result.emergencies).toBe(0);
  });
});

// ---- creatorLeaderboard ----

describe("creatorLeaderboard", () => {
  it("returns empty array for empty input", () => {
    expect(creatorLeaderboard([], [])).toEqual([]);
  });

  it("returns one row per creator from proposals", () => {
    const rows = creatorLeaderboard([BASE_PROPOSAL, PROPOSAL_B], []);
    expect(rows).toHaveLength(2);
    const creators = rows.map((r) => r.creator);
    expect(creators).toContain("0xCreatorA");
    expect(creators).toContain("0xCreatorB");
  });

  it("counts publishedCount correctly per creator", () => {
    const extraProposal: PbProposalRow = {
      ...BASE_PROPOSAL,
      id: "p3",
      ssi_ticker: "ssiRWA",
    };
    const rows = creatorLeaderboard([BASE_PROPOSAL, extraProposal, PROPOSAL_B], []);
    const rowA = rows.find((r) => r.creator === "0xCreatorA")!;
    expect(rowA.publishedCount).toBe(2);
    const rowB = rows.find((r) => r.creator === "0xCreatorB")!;
    expect(rowB.publishedCount).toBe(1);
  });

  it("averages backtest_sharpe per creator (ignoring null)", () => {
    const rows = creatorLeaderboard([BASE_PROPOSAL, PROPOSAL_B], []);
    const rowA = rows.find((r) => r.creator === "0xCreatorA")!;
    // Only one proposal for A with sharpe 1.85
    expect(rowA.avgBacktestSharpe).toBeCloseTo(1.85, 5);
    const rowB = rows.find((r) => r.creator === "0xCreatorB")!;
    expect(rowB.avgBacktestSharpe).toBeCloseTo(2.14, 5);
  });

  it("attaches cycles from rebalances for each creator", () => {
    const rows = creatorLeaderboard(
      [BASE_PROPOSAL, PROPOSAL_B],
      [BASE_REBALANCE, EMERGENCY_REBALANCE, SECOND_REBALANCE, CREATOR_B_REBALANCE],
    );
    const rowA = rows.find((r) => r.creator === "0xCreatorA")!;
    expect(rowA.cycles).toBe(3); // r1, r2, r3 all creator 0xCreatorA
    const rowB = rows.find((r) => r.creator === "0xCreatorB")!;
    expect(rowB.cycles).toBe(1); // r4
  });

  it("sorts descending by score (higher sharpe + more cycles ranks first)", () => {
    const rows = creatorLeaderboard(
      [BASE_PROPOSAL, PROPOSAL_B],
      [BASE_REBALANCE, CREATOR_B_REBALANCE],
    );
    // CreatorB has sharpe 2.14; CreatorA has 1.85 — B should rank first
    expect(rows[0].creator).toBe("0xCreatorB");
  });

  it("includes rank field starting at 1", () => {
    const rows = creatorLeaderboard([BASE_PROPOSAL, PROPOSAL_B], []);
    expect(rows[0].rank).toBe(1);
    expect(rows[1].rank).toBe(2);
  });

  it("handles null backtest_sharpe — avgBacktestSharpe is null and score has no NaN", () => {
    const nullSharpeProposal: PbProposalRow = {
      ...BASE_PROPOSAL,
      id: "p-null-sharpe",
      creator_address: "0xCreatorC",
      ssi_ticker: "ssiNULL",
      backtest_sharpe: null,
    };
    const rows = creatorLeaderboard([nullSharpeProposal], []);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    // A proposal with null sharpe contributes nothing to the average.
    expect(row.avgBacktestSharpe).toBeNull();
    // Score must be a finite number — no NaN or Infinity.
    expect(Number.isFinite(row.score)).toBe(true);
    // Score falls back to 0 * 0.6 + log1p(0) * 0.4 = 0
    expect(row.score).toBeCloseTo(0, 10);
  });
});
