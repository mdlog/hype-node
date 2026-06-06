// Pure demo seed data.
//
// This module is intentionally free of side-effects — no Date.now() / new
// Date() calls at module scope. The portfolio route stamps `fetchedAt` at
// request time; all date strings here use fixed ISO constants so this module
// is safe to import in unit tests without any environment setup.

import type { Address, Hex } from "viem";
import type { UserPortfolio, PublishedIndex, SpotBalance } from "@/lib/api/portfolio";
import type { PbProposalRow, PtRebalanceRow } from "@/lib/supabase/types";
import { DEMO_ADDRESS } from "./demo";

// Fixed ISO timestamp used for all static date fields in seed data.
// The portfolio route overrides `fetchedAt` with `new Date().toISOString()`
// at request time so users always see a fresh timestamp.
const SEED_DATE = "2026-06-06T00:00:00.000Z";

// ---------- PublishedIndex seeds ----------

const DEMO_INDEX_DEPIN: PublishedIndex = {
  id: "0xDEAD000000000000000000000000000000000001000000000000000000000001" as Hex,
  symbol: "ssiDEMO-DEPIN",
  name: "DEMO DePIN Infrastructure Index",
  base: "USDC",
  tokens: ["FIL", "HNT", "IOTX", "MOBILE"],
  weightsBps: [3500, 2500, 2000, 2000],
  mgmtFeeBps: 30,
  perfFeeBps: 100,
  createdAt: 1_700_000_000,
};

const DEMO_INDEX_AI: PublishedIndex = {
  id: "0xDEAD000000000000000000000000000000000001000000000000000000000002" as Hex,
  symbol: "ssiDEMO-AI",
  name: "DEMO AI & Compute Index",
  base: "USDC",
  tokens: ["TAO", "RENDER", "AKT"],
  weightsBps: [4000, 3500, 2500],
  mgmtFeeBps: 30,
  perfFeeBps: 100,
  createdAt: 1_700_000_000,
};

// ---------- SpotBalance seeds ----------

const DEMO_BALANCES: SpotBalance[] = [
  { asset: "USDC", free: "5000.00", locked: "0.00", total: "5000.00" },
  { asset: "ssiDEMO-DEPIN", free: "12.500000", locked: "0.000000", total: "12.500000" },
  { asset: "ssiDEMO-AI", free: "8.250000", locked: "0.000000", total: "8.250000" },
];

// ---------- UserPortfolio seed factory ----------
// `fetchedAt` is accepted as a parameter so callers (route handlers) can
// stamp the real current time instead of the static seed date.

export function makeDemoPortfolio(fetchedAt: string): UserPortfolio {
  return {
    address: DEMO_ADDRESS as Address,
    registry: {
      chainId: 11155111, // Sepolia
      address: null,
      indices: [DEMO_INDEX_DEPIN, DEMO_INDEX_AI],
      totalIndices: 2,
    },
    sodex: {
      env: "mainnet",
      base: "https://mainnet-gw.sodex.dev/api/v1/spot",
      balances: DEMO_BALANCES,
    },
    fetchedAt,
  };
}

// Convenience constant for use in tests or static contexts.
// The portfolio route MUST call makeDemoPortfolio(new Date().toISOString())
// instead to stamp a fresh fetchedAt.
export const DEMO_PORTFOLIO: UserPortfolio = makeDemoPortfolio(SEED_DATE);

// ---------- PbProposalRow seeds ----------

export const DEMO_PROPOSALS: PbProposalRow[] = [
  {
    id: "demo-depin-001",
    creator_address: DEMO_ADDRESS,
    created_at: SEED_DATE,
    updated_at: SEED_DATE,
    ssi_ticker: "ssiDEMO-DEPIN",
    title: "DEMO — DePIN Infrastructure Index",
    thesis:
      "[DEMO] This is a sample index for the HypeNode demo mode. " +
      "It tracks decentralized physical infrastructure networks: " +
      "Filecoin (storage), Helium (wireless), IoTeX (IoT), and MOBILE. " +
      "Rebalanced monthly by market cap weight.",
    constituents: [
      { symbol: "FIL", weight: 0.35, currency_id: "filecoin" },
      { symbol: "HNT", weight: 0.25, currency_id: "helium" },
      { symbol: "IOTX", weight: 0.20, currency_id: "iotex" },
      { symbol: "MOBILE", weight: 0.20, currency_id: "helium-mobile" },
    ],
    meta: { demo: true, label: "DEMO — sample data, not real" },
    source: "manual",
    source_run_id: null,
    status: "published",
    on_chain_tx: null,
    on_chain_index_id: null,
    backtest_return: 0.412,
    backtest_sharpe: 1.85,
    backtest_max_dd: -0.23,
  },
  {
    id: "demo-ai-002",
    creator_address: DEMO_ADDRESS,
    created_at: SEED_DATE,
    updated_at: SEED_DATE,
    ssi_ticker: "ssiDEMO-AI",
    title: "DEMO — AI & Compute Index",
    thesis:
      "[DEMO] This is a sample index for the HypeNode demo mode. " +
      "It captures value from AI model training and inference infrastructure " +
      "on-chain: Bittensor (model market), Render (GPU compute), and Akash " +
      "(decentralized cloud). Equal-weight rebalanced quarterly.",
    constituents: [
      { symbol: "TAO", weight: 0.40, currency_id: "bittensor" },
      { symbol: "RENDER", weight: 0.35, currency_id: "render-token" },
      { symbol: "AKT", weight: 0.25, currency_id: "akash-network" },
    ],
    meta: { demo: true, label: "DEMO — sample data, not real" },
    source: "manual",
    source_run_id: null,
    status: "published",
    on_chain_tx: null,
    on_chain_index_id: null,
    backtest_return: 0.693,
    backtest_sharpe: 2.14,
    backtest_max_dd: -0.31,
  },
];

// ---------- PtRebalanceRow seeds ----------
//
// Clearly labelled DEMO data — not real execution results.
// 3-5 rows per demo ticker, all using SEED_DATE family of timestamps.
// The agent write-path will replace these with real data once live.

export const DEMO_REBALANCES: PtRebalanceRow[] = [
  // --- ssiDEMO-DEPIN rebalances ---
  {
    id: "demo-reb-depin-001",
    created_at: "2026-05-20T08:00:00.000Z",
    sector: "DePIN",
    ssi_ticker: "ssiDEMO-DEPIN",
    creator_address: DEMO_ADDRESS,
    basket_before: null,
    basket_after: { FIL: 0.35, HNT: 0.25, IOTX: 0.2, MOBILE: 0.2 },
    strategy_source: "agent_draft",
    sentiment_score: 0.71,
    risk_verdict: "pass",
    ssi_tx_hash: null,
    sodex_placed: 4,
    sodex_skipped: 0,
    sodex_errors: 0,
    emergency: false,
  },
  {
    id: "demo-reb-depin-002",
    created_at: "2026-05-27T08:00:00.000Z",
    sector: "DePIN",
    ssi_ticker: "ssiDEMO-DEPIN",
    creator_address: DEMO_ADDRESS,
    basket_before: { FIL: 0.35, HNT: 0.25, IOTX: 0.2, MOBILE: 0.2 },
    basket_after: { FIL: 0.38, HNT: 0.22, IOTX: 0.2, MOBILE: 0.2 },
    strategy_source: "agent_draft",
    sentiment_score: 0.68,
    risk_verdict: "pass",
    ssi_tx_hash: null,
    sodex_placed: 3,
    sodex_skipped: 1,
    sodex_errors: 0,
    emergency: false,
  },
  {
    id: "demo-reb-depin-003",
    created_at: "2026-06-03T08:00:00.000Z",
    sector: "DePIN",
    ssi_ticker: "ssiDEMO-DEPIN",
    creator_address: DEMO_ADDRESS,
    basket_before: { FIL: 0.38, HNT: 0.22, IOTX: 0.2, MOBILE: 0.2 },
    basket_after: { FIL: 0.36, HNT: 0.24, IOTX: 0.2, MOBILE: 0.2 },
    strategy_source: "agent_draft",
    sentiment_score: 0.74,
    risk_verdict: "pass",
    ssi_tx_hash: null,
    sodex_placed: 4,
    sodex_skipped: 0,
    sodex_errors: 0,
    emergency: false,
  },
  // --- ssiDEMO-AI rebalances ---
  {
    id: "demo-reb-ai-001",
    created_at: "2026-05-15T08:00:00.000Z",
    sector: "AI",
    ssi_ticker: "ssiDEMO-AI",
    creator_address: DEMO_ADDRESS,
    basket_before: null,
    basket_after: { TAO: 0.4, RENDER: 0.35, AKT: 0.25 },
    strategy_source: "agent_draft",
    sentiment_score: 0.81,
    risk_verdict: "pass",
    ssi_tx_hash: null,
    sodex_placed: 3,
    sodex_skipped: 0,
    sodex_errors: 0,
    emergency: false,
  },
  {
    id: "demo-reb-ai-002",
    created_at: "2026-05-29T08:00:00.000Z",
    sector: "AI",
    ssi_ticker: "ssiDEMO-AI",
    creator_address: DEMO_ADDRESS,
    basket_before: { TAO: 0.4, RENDER: 0.35, AKT: 0.25 },
    basket_after: { TAO: 0.42, RENDER: 0.33, AKT: 0.25 },
    strategy_source: "agent_draft",
    sentiment_score: 0.77,
    risk_verdict: "pass",
    ssi_tx_hash: null,
    sodex_placed: 2,
    sodex_skipped: 0,
    sodex_errors: 1,
    emergency: false,
  },
];

/** Filter DEMO_REBALANCES to those matching a specific ssi_ticker. */
export function getDemoRebalancesByTicker(ticker: string): PtRebalanceRow[] {
  return DEMO_REBALANCES.filter((r) => r.ssi_ticker === ticker);
}

// ---------- Lookup helper ----------

/** Returns the seeded demo proposal for the given id, or null if not found. */
export function getDemoProposalById(id: string): PbProposalRow | null {
  return DEMO_PROPOSALS.find((p) => p.id === id) ?? null;
}
