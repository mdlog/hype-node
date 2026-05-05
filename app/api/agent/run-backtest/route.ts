import { NextRequest, NextResponse } from "next/server";
import { runBacktest } from "@/lib/api/agent";

// Forward the basket → POST /run-backtest on the FastAPI agent service.
// The Python side replays SoSoValue klines for each constituent, computes
// Sharpe / max-dd / win-rate / vs BTC+ETH benchmarks, and returns a result
// envelope with an equity_preview series for the chart.

export async function POST(req: NextRequest) {
  let payload: {
    constituents?: Array<{ currency_id: string; symbol?: string; weight: number }>;
    days?: number;
  };
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
  const result = await runBacktest(constituents, days);
  if (!result) {
    return NextResponse.json(
      { ok: false, error: "agent service unreachable" },
      { status: 502 },
    );
  }
  return NextResponse.json(result);
}
