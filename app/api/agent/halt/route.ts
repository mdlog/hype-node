import { NextResponse } from "next/server";
import { haltAgent } from "@/lib/api/agent";

export async function POST() {
  const result = await haltAgent();
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error ?? "agent service unreachable" },
      { status: 502 },
    );
  }
  return NextResponse.json({ ok: true, ...(result.data ?? {}) });
}
