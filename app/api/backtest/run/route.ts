import { NextRequest, NextResponse } from "next/server";
import { runBacktest, type BacktestRequest } from "@/lib/api/backtest";

export async function POST(req: NextRequest) {
  const body = (await req.json()) as BacktestRequest;
  const result = await runBacktest(body);
  return NextResponse.json(result);
}
