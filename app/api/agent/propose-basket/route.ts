import { NextRequest, NextResponse } from "next/server";
import { proposeBasket } from "@/lib/api/agent";

export async function GET(req: NextRequest) {
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
  return NextResponse.json(proposal);
}
