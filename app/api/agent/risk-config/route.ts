import { NextResponse, type NextRequest } from "next/server";

import { getRiskConfig, updateRiskConfig } from "@/lib/api/agent";
import { db } from "@/lib/supabase/server";
import { getRequestUser } from "@/lib/supabase/auth";
import type { Json } from "@/lib/supabase/types";

// Browser-side proxy to the FastAPI agent service. The Risk page UI fetches
// thresholds + rule toggles from here and POSTs partial updates back.
//
// Auth model: GET is open (anyone signed-in or not can read defaults — they
// drive the live agent regardless). POST writes a `sys_risk_audit` row
// best-effort after the agent confirms the change so we have a tamper-proof
// timeline of who flipped what when. Audit failure does NOT roll back the
// underlying config change — the agent's SQLite is the source of truth.

export async function GET() {
  const cfg = await getRiskConfig();
  return NextResponse.json({ ok: true, config: cfg });
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  // Snapshot before for the audit row.
  const before = await getRiskConfig().catch(() => null);

  const updated = await updateRiskConfig(body);
  if (!updated) {
    return NextResponse.json(
      { ok: false, error: "agent service unreachable" },
      { status: 502 },
    );
  }

  // Best-effort audit write. Anonymous edits (no SIWE session) get logged
  // with `user_address = 'anonymous'` + `change_source = 'api_anonymous'`
  // so the trail isn't gappy. Errors here are warned and swallowed —
  // never surface to the caller, the underlying config is already applied.
  try {
    const res = NextResponse.next();
    const user = await getRequestUser(req, res);
    const userAddress = user?.address ?? "anonymous";
    const source = user ? "ui" : "api_anonymous";
    await db.from("sys_risk_audit").insert({
      user_address: userAddress,
      config_before: (before ?? null) as Json,
      config_after: updated as unknown as Json,
      change_source: source,
    });
  } catch (e) {
    console.warn("[risk-config] audit write failed:", e);
  }

  return NextResponse.json({ ok: true, config: updated });
}
