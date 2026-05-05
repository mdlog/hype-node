import { NextResponse } from "next/server";

import { getRiskConfig, updateRiskConfig } from "@/lib/api/agent";

// Browser-side proxy to the FastAPI agent service. The Risk page UI fetches
// thresholds + rule toggles from here and POSTs partial updates back.

export async function GET() {
  const cfg = await getRiskConfig();
  return NextResponse.json({ ok: true, config: cfg });
}

export async function POST(req: Request) {
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }
  const updated = await updateRiskConfig(body);
  if (!updated) {
    return NextResponse.json(
      { ok: false, error: "agent service unreachable" },
      { status: 502 },
    );
  }
  return NextResponse.json({ ok: true, config: updated });
}
