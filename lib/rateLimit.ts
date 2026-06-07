// In-process sliding-window rate limiter for sensitive routes (SIWE handshake,
// demo entry, agent cost/control). Keyed by client IP + a route label.
//
// CAVEAT: the store is per-instance (a Map in module scope). On multi-instance
// / serverless deployments each instance limits independently — adequate as a
// first line against bursts/brute-force, but for a hard global limit move this
// to Redis/Upstash. The decision logic is in ./rateLimitPolicy.ts (tested).

import { NextResponse, type NextRequest } from "next/server";

import { slidingWindowDecision } from "./rateLimitPolicy";

const store = new Map<string, number[]>();

// Opportunistic cleanup so the Map can't grow unbounded on a long-lived
// instance: every so often drop keys whose newest hit is older than 1h.
let lastSweep = 0;
function maybeSweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [k, ts] of store) {
    if (ts.length === 0 || ts[ts.length - 1] < now - 3_600_000) store.delete(k);
  }
}

export function clientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

/**
 * Returns a 429 NextResponse when the caller is over the limit, else null.
 * Usage in a route handler:
 *   const limited = rateLimit(req, "auth:verify", 10, 60_000);
 *   if (limited) return limited;
 */
export function rateLimit(
  req: NextRequest,
  name: string,
  limit: number,
  windowMs: number,
): NextResponse | null {
  const now = Date.now();
  maybeSweep(now);
  const key = `${name}:${clientIp(req)}`;
  const decision = slidingWindowDecision(store.get(key) ?? [], limit, windowMs, now);
  store.set(key, decision.kept);
  if (decision.allowed) return null;
  const retryAfterSec = Math.ceil(decision.retryAfterMs / 1000);
  return NextResponse.json(
    { error: "rate_limited", retry_after_ms: decision.retryAfterMs },
    { status: 429, headers: { "Retry-After": String(retryAfterSec) } },
  );
}
