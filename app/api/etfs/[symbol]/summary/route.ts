import { NextRequest, NextResponse } from "next/server";
import { getEtfSummaryHistory } from "@/lib/api/sosovalue";

export async function GET(req: NextRequest, { params }: { params: { symbol: string } }) {
  const sp = req.nextUrl.searchParams;
  const country = sp.get("country") ?? "US";
  const limit = Number(sp.get("limit") ?? 30);
  return NextResponse.json(await getEtfSummaryHistory(params.symbol, country, { limit }));
}
