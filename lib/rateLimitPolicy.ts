// Pure sliding-window rate-limit decision — no Next imports, unit-testable.
// Given the timestamps of prior hits in the window, decide whether the next
// hit is allowed and (if not) how long until the oldest hit ages out.

export type RateDecision = {
  allowed: boolean;
  retryAfterMs: number;
  // The pruned-to-window timestamp list to persist (includes the new hit when allowed).
  kept: number[];
};

export function slidingWindowDecision(
  timestamps: number[],
  limit: number,
  windowMs: number,
  now: number,
): RateDecision {
  const cutoff = now - windowMs;
  const recent = timestamps.filter((t) => t > cutoff);
  if (recent.length >= limit) {
    const oldest = recent[0];
    return { allowed: false, retryAfterMs: Math.max(0, oldest + windowMs - now), kept: recent };
  }
  recent.push(now);
  return { allowed: true, retryAfterMs: 0, kept: recent };
}
