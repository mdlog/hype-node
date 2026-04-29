import { NextRequest, NextResponse } from "next/server";
import { listEtfs, getEtfHistory } from "@/lib/api/sosovalue";

export async function GET(
  req: NextRequest,
  { params }: { params: { symbol: string } },
) {
  const sp = req.nextUrl.searchParams;
  const limit = Number(sp.get("limit") ?? 30);
  // Resolve {symbol → first ETF ticker} so callers can pass BTC/ETH and get
  // the canonical large-cap ETF (e.g. BTC → IBIT).
  const etfs = await listEtfs(params.symbol);
  const ticker = etfs[0]?.ticker ?? params.symbol;
  const history = await getEtfHistory(ticker, { limit });
  return NextResponse.json({ ticker, history });
}
