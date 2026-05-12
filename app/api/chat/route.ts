import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { sessionOptions, type SessionData } from "@/lib/auth/session";
import { chat, type ChatTurn } from "@/lib/api/agent";
import { canSend, getSnapshot, recordUsage } from "@/lib/billing";

export const dynamic = "force-dynamic";

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

  // Pass the SIWE-connected wallet address to the agent service so the
  // SoDEX balance / order tools query the user's wallet (not the server's
  // signer key). Trade execution still uses SODEX_PRIVATE_KEY.
  const reply = await chat(body.turns, address);

  // Record usage from the live `usage` block on the agent reply. If for any
  // reason it's missing (e.g. agent service crashed mid-turn), we still
  // emit the message but the user is not charged — better than blocking on
  // an instrumentation gap.
  if (reply.usage) {
    const u = reply.usage;
    const toolCalls = reply.tool_calls?.length ?? 0;
    // The model used is captured by the agent service, fall back to the env
    // default for cost calc parity.
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
}
