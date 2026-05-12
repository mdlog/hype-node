import { NextResponse } from "next/server";

import { getToolsHealth } from "@/lib/api/agent";

export const dynamic = "force-dynamic";

export async function GET() {
  const health = await getToolsHealth();
  if (!health) {
    return NextResponse.json({ error: "agent unreachable" }, { status: 502 });
  }
  return NextResponse.json(health);
}
