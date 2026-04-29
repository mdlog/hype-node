import { NextRequest, NextResponse } from "next/server";
import { getSsiSnapshot } from "@/lib/api/sosovalue";

export async function GET(_req: NextRequest, { params }: { params: { ticker: string } }) {
  return NextResponse.json(await getSsiSnapshot(params.ticker));
}
