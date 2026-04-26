import { NextRequest, NextResponse } from "next/server";
import { getSentiment, type Sector, type Window } from "@/lib/api/sosovalue";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const sector = (sp.get("sector") ?? "DePIN") as Sector;
  const window = (sp.get("window") ?? "1h") as Window;
  const data = await getSentiment({ sector, window });
  return NextResponse.json(data);
}
