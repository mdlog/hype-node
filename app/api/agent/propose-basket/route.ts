import { NextRequest, NextResponse } from "next/server";
import { proposeBasket } from "@/lib/api/agent";
import { requireUser } from "@/lib/supabase/auth";
import { canSend } from "@/lib/billing";
import { rateLimit } from "@/lib/rateLimit";

// Proxies to the agent service's LLM-backed basket drafter — a metered cost
// action. Require an authenticated wallet (so anonymous callers can't burn the
// model key / DoS the wallet) and pre-flight the per-wallet billing quota.
export async function GET(req: NextRequest) {
  const limited = rateLimit(req, "agent:propose-basket", 30, 60_000);
  if (limited) return limited;
  const auth = await requireUser(req);
  if (!auth.user) return auth.res;
  const gate = canSend(auth.user.address);
  if (!gate.allowed) {
    return NextResponse.json(
      { ok: false, error: "limit_reached", reason: gate.reason },
      { status: 402 },
    );
  }

  const { searchParams } = new URL(req.url);
  const sector = searchParams.get("sector") ?? "DePIN";
  const nAssets = Number(searchParams.get("n_assets") ?? "8");
  const weightingParam = searchParams.get("weighting") ?? "score";
  const weighting: "score" | "marketcap" | "equal" | "ssi_reference" =
    weightingParam === "marketcap" ||
    weightingParam === "equal" ||
    weightingParam === "ssi_reference"
      ? weightingParam
      : "score";

  const proposal = await proposeBasket(sector, nAssets, weighting);
  if (!proposal) {
    return NextResponse.json(
      { ok: false, error: "agent service unreachable", ticker: `ssi${sector}` },
      { status: 502 },
    );
  }
  const out = NextResponse.json(proposal);
  for (const cookie of auth.res.cookies.getAll()) out.cookies.set(cookie);
  return out;
}
