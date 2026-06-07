import { NextResponse, type NextRequest } from "next/server";
import { stepAgent } from "@/lib/api/agent";
import { requireOperator } from "@/lib/auth/operator";

// Triggers one agent tick — both a control AND a cost action (LLM + tools),
// so it requires an authorized operator, not just any caller.
export async function POST(req: NextRequest) {
  const auth = await requireOperator(req);
  if (!auth.user) return auth.res;

  const result = await stepAgent();
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error ?? "agent service unreachable" },
      { status: 502 },
    );
  }
  return NextResponse.json({ ok: true, ...(result.data ?? {}) });
}
