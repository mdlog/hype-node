import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { sessionOptions, type SessionData } from "@/lib/auth/session";
import { chat, type ChatTurn } from "@/lib/api/agent";
import { canSend, getSnapshot, recordUsage } from "@/lib/billing";

export const dynamic = "force-dynamic";
// Vercel Pro default is 10s, which is too tight for agent turns that hit the
// LLM + tool chain (typical 5-15s, occasional 30s+ on cold starts). 60s is
// the Pro tier ceiling without a special plan.
export const maxDuration = 60;

/**
 * Authenticated, billing-gated chat endpoint.
 *
 * Flow:
 *   1. Resolve wallet address from the SIWE session — block unauth'd callers
 *      so we always have a billing key.
 *   2. Pre-flight: `canSend` checks the user's free quota + paid balance.
 *      If both are exhausted, return **402 Payment Required** with the
 *      latest snapshot so the UI can surface the top-up CTA.
 *   3. Proxy the turn to the Python agent service. Cost is unknown until
 *      the response arrives, so over-cap deduction happens post-flight.
 *   4. Record token usage + tool-call count against the user's daily bucket
 *      (paid balance covers any spend beyond `FREE_DAILY_SPEND_USD`).
 *   5. Return the agent reply with a fresh `billing` snapshot attached so
 *      the client can update the Usage panel without a separate round trip.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getIronSession<SessionData>(cookies(), sessionOptions);
    if (!session.address) {
      return NextResponse.json(
        { error: "not authenticated" },
        { status: 401 },
      );
    }
    const address = session.address;

    const body = (await req.json()) as { turns: ChatTurn[] };
    if (!Array.isArray(body.turns)) {
      return NextResponse.json(
        { error: "turns array required" },
        { status: 400 },
      );
    }

    const gate = canSend(address);
    if (!gate.allowed) {
      return NextResponse.json(
        {
          error: "limit_reached",
          reason: gate.reason,
          billing: getSnapshot(address),
        },
        { status: 402 },
      );
    }

    const reply = await chat(body.turns, address);

    if (reply.usage) {
      const u = reply.usage;
      const toolCalls = reply.tool_calls?.length ?? 0;
      const model = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5";
      const snapshot = recordUsage(
        address,
        model,
        {
          input_tokens: u.input_tokens ?? 0,
          output_tokens: u.output_tokens ?? 0,
          cache_read_tokens: u.cache_read_tokens ?? 0,
          cache_creation_tokens: u.cache_creation_tokens ?? 0,
        },
        toolCalls,
      );
      return NextResponse.json({ ...reply, billing: snapshot });
    }

    return NextResponse.json({ ...reply, billing: getSnapshot(address) });
  } catch (err) {
    // Without this catch, a thrown error (missing SESSION_PASSWORD, corrupt
    // cookie, agent fetch failure) gives Vercel an empty 500 body — the
    // browser then surfaces "Unexpected end of JSON input" instead of the
    // real cause. Reply with structured JSON so the UI shows the actual
    // failure and Vercel logs capture the stack.
    const message = err instanceof Error ? err.message : String(err);
    console.error("[/api/chat] uncaught", err);
    return NextResponse.json(
      {
        role: "agent",
        content: `Server error: ${message}`,
        error: message,
      },
      { status: 500 },
    );
  }
}
