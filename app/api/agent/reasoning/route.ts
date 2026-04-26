import { NextResponse } from "next/server";
import { getReasoningLog } from "@/lib/api/agent";

export async function GET() {
  return NextResponse.json(await getReasoningLog());
}
