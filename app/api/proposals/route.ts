import { NextResponse } from "next/server";

// In a real deployment, proposals would live in Postgres + the Python agent
// service. For now we serve a deterministic snapshot so the UI works
// independently of the agent process.
const proposals = [
  {
    id: "depin-8",
    sector: "DePIN",
    name: "HYPE-DEPIN-8",
    confidence: 94,
    trigger: "News Δ +340% · sentiment +92 · 11 assets clustered",
    assets: [
      { symbol: "FIL", weight: 22 },
      { symbol: "RNDR", weight: 18 },
      { symbol: "HNT", weight: 15 },
      { symbol: "AR", weight: 12 },
      { symbol: "AKT", weight: 11 },
      { symbol: "IOTX", weight: 9 },
      { symbol: "DIMO", weight: 8 },
      { symbol: "ATH", weight: 5 },
    ],
    projectedSubs: { lo: 70, hi: 120 },
    projectedEarningsUsd: { lo: 280, hi: 480 },
    draftedAt: new Date(Date.now() - 6 * 60_000).toISOString(),
    expiresAt: new Date(Date.now() + 5.9 * 3600_000).toISOString(),
    highlight: true,
  },
  {
    id: "rwa-tbill-5",
    sector: "RWA",
    name: "HYPE-RWA-TBILL-5",
    confidence: 76,
    trigger: "Tokenized T-bill news +180% · Ondo + BlackRock headlines",
    assets: [
      { symbol: "ONDO", weight: 30 },
      { symbol: "MKR", weight: 22 },
      { symbol: "USDY", weight: 18 },
      { symbol: "RLB", weight: 16 },
      { symbol: "TPROT", weight: 14 },
    ],
    projectedSubs: { lo: 40, hi: 80 },
    projectedEarningsUsd: { lo: 120, hi: 260 },
    draftedAt: new Date(Date.now() - 60 * 60_000).toISOString(),
    expiresAt: new Date(Date.now() + 5 * 3600_000).toISOString(),
    highlight: false,
  },
  {
    id: "ai-agent-6",
    sector: "AI Agents",
    name: "HYPE-AI-AGENT-6",
    confidence: 68,
    trigger: "Agent framework launches · Virtuals + AI16Z momentum",
    assets: [
      { symbol: "VIRTUAL", weight: 24 },
      { symbol: "AI16Z", weight: 20 },
      { symbol: "AIXBT", weight: 18 },
      { symbol: "GAME", weight: 14 },
      { symbol: "FAI", weight: 13 },
      { symbol: "ARC", weight: 11 },
    ],
    projectedSubs: { lo: 30, hi: 60 },
    projectedEarningsUsd: { lo: 80, hi: 180 },
    draftedAt: new Date(Date.now() - 3 * 3600_000).toISOString(),
    expiresAt: new Date(Date.now() + 3 * 3600_000).toISOString(),
    highlight: false,
  },
];

export async function GET() {
  return NextResponse.json(proposals);
}
