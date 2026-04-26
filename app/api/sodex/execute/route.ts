import { NextRequest, NextResponse } from "next/server";
import { executeTrade, type TradeOrder } from "@/lib/api/sodex";

export async function POST(req: NextRequest) {
  const body = (await req.json()) as TradeOrder;
  if (!body.symbolIn || !body.symbolOut || !body.amountIn) {
    return NextResponse.json(
      { error: "symbolIn, symbolOut, amountIn required" },
      { status: 400 },
    );
  }
  const result = await executeTrade(body);
  return NextResponse.json(result);
}
