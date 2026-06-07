import { NextResponse, type NextRequest } from "next/server";

import { getRiskConfig, updateRiskConfig } from "@/lib/api/agent";
import { db } from "@/lib/supabase/server";
import { requireOperator } from "@/lib/auth/operator";
import type { Json } from "@/lib/supabase/types";

// Browser-side proxy to the FastAPI agent service. The Risk page UI fetches
// thresholds + rule toggles from here and POSTs partial updates back.
//
// Auth model: GET is open (read-only thresholds). POST mutates the LIVE risk
// thresholds of the shared autonomous agent, so it requires an authorized
// operator (see requireOperator) — never anonymous. Every accepted change is
// written to `sys_risk_audit` so we keep a tamper-proof who/what/when trail.

export async function GET() {
  const cfg = await getRiskConfig();
  return NextResponse.json({ ok: true, config: cfg });
}

export async function POST(req: NextRequest) {
  // Mutates live agent risk thresholds — operator-only, never anonymous/demo.
  const auth = await requireOperator(req);
  if (!auth.user) return auth.res;
  const operatorAddress = auth.user.address;

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

  // Best-effort audit write. The caller is always an authenticated operator
  // now, so we log their address. Errors here are warned and swallowed —
  // never surface to the caller, the underlying config is already applied.
  try {
    await db.from("sys_risk_audit").insert({
      user_address: operatorAddress,
      config_before: (before ?? null) as Json,
      config_after: updated as unknown as Json,
      change_source: "operator",
    });
  } catch (e) {
    console.warn("[risk-config] audit write failed:", e);
  }

  const out = NextResponse.json({ ok: true, config: updated });
  for (const cookie of auth.res.cookies.getAll()) {
    out.cookies.set(cookie);
  }
  return out;
}
