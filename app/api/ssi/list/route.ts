import { NextResponse } from "next/server";
import { listSsiTickers } from "@/lib/api/sosovalue";

export async function GET() {
  return NextResponse.json(await listSsiTickers());
}
