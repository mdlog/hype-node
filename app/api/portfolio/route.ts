import { isAddress, type Address } from "viem";
import { NextResponse, type NextRequest } from "next/server";
import { getUserPortfolio } from "@/lib/api/portfolio";

// Force dynamic — every request must re-query on-chain registry + SoDEX.
// Cache layer can be added later via a server-side memoizer if needed (the
// data is per-address so URL-based revalidate doesn't apply cleanly).
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  const param = req.nextUrl.searchParams.get("address")?.trim() ?? "";
  if (!param) {
    return NextResponse.json(
      { ok: false, error: "missing ?address=" },
      { status: 400 },
    );
  }
  if (!isAddress(param)) {
    return NextResponse.json(
      { ok: false, error: "invalid EVM address" },
      { status: 400 },
    );
  }

  const portfolio = await getUserPortfolio(param as Address);
  return NextResponse.json({ ok: true, ...portfolio });
}
