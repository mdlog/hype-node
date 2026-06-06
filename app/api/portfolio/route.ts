import { isAddress, type Address } from "viem";
import { NextResponse, type NextRequest } from "next/server";
import { getUserPortfolio } from "@/lib/api/portfolio";
import { isDemoAddress } from "@/lib/demo/demo";
import { makeDemoPortfolio } from "@/lib/demo/seed";

// Force dynamic — every request must re-query on-chain registry + SoDEX.
// Cache layer can be added later via a server-side memoizer if needed (the
// data is per-address so URL-based revalidate doesn't apply cleanly).
export const dynamic = "force-dynamic";
export const revalidate = 0;
// On-chain index scan (sequential indexCount × 2 RPC reads) plus SoDEX
// fetch can run long on the public Sepolia RPC. Default 10s is too tight.
export const maxDuration = 60;

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

  // Short-circuit for the demo sentinel — return seeded data immediately,
  // skipping the slow on-chain RPC scan and SoDEX fetch.
  if (isDemoAddress(param)) {
    const portfolio = makeDemoPortfolio(new Date().toISOString());
    return NextResponse.json({ ok: true, ...portfolio });
  }

  const portfolio = await getUserPortfolio(param as Address);
  return NextResponse.json({ ok: true, ...portfolio });
}
