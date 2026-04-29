import { NextRequest, NextResponse } from "next/server";
import { getSsiConstituents } from "@/lib/api/sosovalue";

export async function GET(
  _req: NextRequest,
  { params }: { params: { ticker: string } },
) {
  const data = await getSsiConstituents(params.ticker);
  return NextResponse.json(data);
}
