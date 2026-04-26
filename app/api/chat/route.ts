import { NextRequest, NextResponse } from "next/server";
import { chat, type ChatTurn } from "@/lib/api/agent";

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { turns: ChatTurn[] };
  if (!Array.isArray(body.turns)) {
    return NextResponse.json({ error: "turns array required" }, { status: 400 });
  }
  const reply = await chat(body.turns);
  return NextResponse.json(reply);
}
