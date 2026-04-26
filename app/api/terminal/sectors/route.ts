import { NextResponse } from "next/server";
import { getSectorScores } from "@/lib/api/sosovalue";

export async function GET() {
  return NextResponse.json(await getSectorScores());
}
