// Pure demo seed data.
//
// This module is intentionally free of side-effects — no Date.now() / new
// Date() calls at module scope. The portfolio route stamps `fetchedAt` at
// request time; all date strings here use fixed ISO constants so this module
// is safe to import in unit tests without any environment setup.

import type { Address, Hex } from "viem";
import type { UserPortfolio, PublishedIndex, SpotBalance } from "@/lib/api/portfolio";
import type { PbProposalRow } from "@/lib/supabase/types";
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

// ---------- Lookup helper ----------

/** Returns the seeded demo proposal for the given id, or null if not found. */
export function getDemoProposalById(id: string): PbProposalRow | null {
  return DEMO_PROPOSALS.find((p) => p.id === id) ?? null;
}
