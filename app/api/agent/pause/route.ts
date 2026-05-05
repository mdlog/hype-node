import { NextResponse } from "next/server";
import { pauseAgent } from "@/lib/api/agent";

export async function POST() {
  const result = await pauseAgent();
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error ?? "agent service unreachable" },
      { status: 502 },
    );
  }
  return NextResponse.json({ ok: true, ...(result.data ?? {}) });
}
