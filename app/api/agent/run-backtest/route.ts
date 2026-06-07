import { NextRequest, NextResponse } from "next/server";
import { runBacktest, type BacktestCostParams } from "@/lib/api/agent";
import { requireUser } from "@/lib/supabase/auth";
import { canSend } from "@/lib/billing";
import { rateLimit } from "@/lib/rateLimit";

// Forward the basket → POST /run-backtest on the FastAPI agent service.
// The Python side replays SoSoValue klines for each constituent, computes
// Sharpe / max-dd / win-rate / vs BTC+ETH benchmarks, and returns a result
// envelope with an equity_preview series for the chart.
//
// Cost / risk knobs are optional — when present they are passed through to
// the agent service so the same Python backtester applies fees, slippage,
// position caps, the risk-free rate, and an initial-capital scale factor.

const COST_KEYS: Array<keyof BacktestCostParams> = [
  "fee_bps",
  "slippage_bps",
  "position_cap",
  "risk_free_rate",
  "init_capital",
  "rebalance_days",
];

export async function POST(req: NextRequest) {
  // Metered cost action (replays klines server-side). Require an authenticated
  // wallet + pre-flight the billing quota so anonymous callers can't burn it.
  const limited = rateLimit(req, "agent:run-backtest", 30, 60_000);
  if (limited) return limited;
  const auth = await requireUser(req);
  if (!auth.user) return auth.res;
  const gate = canSend(auth.user.address);
  if (!gate.allowed) {
    return NextResponse.json(
      { ok: false, error: "limit_reached", reason: gate.reason },
      { status: 402 },
    );
  }

  let payload: {
    constituents?: Array<{ currency_id: string; symbol?: string; weight: number }>;
    days?: number;
  } & Partial<BacktestCostParams>;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid JSON body" },
      { status: 400 },
    );
  }
  const constituents = payload.constituents;
  if (!Array.isArray(constituents) || constituents.length === 0) {
    return NextResponse.json(
      { ok: false, error: "constituents required" },
      { status: 400 },
    );
  }
  const days = typeof payload.days === "number" && payload.days > 0 ? payload.days : 90;

  const costs: BacktestCostParams = {};
  for (const k of COST_KEYS) {
    const v = payload[k];
    if (typeof v === "number" && Number.isFinite(v)) {
      costs[k] = v;
    }
  }

  const result = await runBacktest(constituents, days, costs);
  if (!result) {
    return NextResponse.json(
      { ok: false, error: "agent service unreachable" },
      { status: 502 },
    );
  }
  const out = NextResponse.json(result);
  for (const cookie of auth.res.cookies.getAll()) out.cookies.set(cookie);
  return out;
}
