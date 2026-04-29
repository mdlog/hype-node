import { NextRequest, NextResponse } from "next/server";
import { getCurrencyKlines } from "@/lib/api/sosovalue";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? 90);
  return NextResponse.json(await getCurrencyKlines(params.id, { limit }));
}
