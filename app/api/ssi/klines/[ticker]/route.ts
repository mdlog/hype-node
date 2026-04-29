import { NextRequest, NextResponse } from "next/server";
import { getSsiKlines } from "@/lib/api/sosovalue";

export async function GET(req: NextRequest, { params }: { params: { ticker: string } }) {
  const sp = req.nextUrl.searchParams;
  const limit = Number(sp.get("limit") ?? 90);
  return NextResponse.json(await getSsiKlines(params.ticker, { limit }));
}
