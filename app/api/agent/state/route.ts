import { NextResponse } from "next/server";
import { getAgentState } from "@/lib/api/agent";

export async function GET() {
  return NextResponse.json(await getAgentState());
}
