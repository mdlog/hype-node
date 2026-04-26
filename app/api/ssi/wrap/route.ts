import { NextRequest, NextResponse } from "next/server";
import { wrapIndex, type IndexSpec } from "@/lib/api/ssi";

export async function POST(req: NextRequest) {
  const body = (await req.json()) as IndexSpec;
  if (!body.symbol || !body.weights) {
    return NextResponse.json({ error: "symbol and weights required" }, { status: 400 });
  }
  try {
    const result = await wrapIndex(body);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
