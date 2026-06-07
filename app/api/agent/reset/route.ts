import { NextResponse, type NextRequest } from "next/server";
import { resetAgent } from "@/lib/api/agent";
import { requireOperator } from "@/lib/auth/operator";

export async function POST(req: NextRequest) {
  const auth = await requireOperator(req);
  if (!auth.user) return auth.res;

  const result = await resetAgent();
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error ?? "agent service unreachable" },
      { status: 502 },
    );
  }
  return NextResponse.json({ ok: true, ...(result.data ?? {}) });
}
