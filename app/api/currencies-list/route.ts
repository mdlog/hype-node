import { NextResponse } from "next/server";
import { listAllCurrencies } from "@/lib/api/sosovalue/tokens";

// Lightweight proxy that returns the full SoSoValue currency universe.
// Cached aggressively (1h) — the universe rarely changes and the page-level
// "Add asset" modal triggers this on first open.
export const revalidate = 3600;

export async function GET() {
  const items = await listAllCurrencies();
  return NextResponse.json({ items });
}
