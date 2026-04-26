import { NextRequest, NextResponse } from "next/server";
import { getNews, type Sector } from "@/lib/api/sosovalue";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const sector = (sp.get("sector") ?? "DePIN") as Sector;
  const limit = Number(sp.get("limit") ?? 20);
  const data = await getNews({ sector, limit });
  return NextResponse.json(data);
}
