import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { sessionOptions, type SessionData } from "@/lib/auth/session";

const AGENT_URL = process.env.AGENT_SERVICE_URL ?? "http://localhost:8001";
const AGENT_API_KEY = process.env.AGENT_API_KEY ?? "";

export const dynamic = "force-dynamic";

/**
 * Forwards a browser-signed SoDEX action envelope to the agent service,
 * which relays to SoDEX upstream. The signature was produced by wagmi
 * `signTypedDataAsync` against the typed_data prepared by the agent's
 * `sodex_execute_trade` tool — server never sees the user's private key.
 *
 * Authentication:
 *   - Requires SIWE session (cookie auth)
 *   - Verifies that the submit_payload's signer_address matches the
 *     session address — defends against a user submitting on behalf of
 *     a different connected wallet.
 */
export async function POST(req: NextRequest) {
  const session = await getIronSession<SessionData>(cookies(), sessionOptions);
  if (!session.address) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const body = (await req.json()) as {
    submit_payload?: { signer_address?: string };
    signature?: string;
  };
  const declaredSigner = body.submit_payload?.signer_address?.toLowerCase();
  if (!declaredSigner || declaredSigner !== session.address.toLowerCase()) {
    return NextResponse.json(
      {
        error:
          "submit_payload.signer_address must match the SIWE-connected wallet",
      },
      { status: 403 },
    );
  }

  try {
    const res = await fetch(`${AGENT_URL}/sodex/submit`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(AGENT_API_KEY ? { "x-agent-key": AGENT_API_KEY } : {}),
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message ?? "agent service unreachable" },
      { status: 502 },
    );
  }
}
