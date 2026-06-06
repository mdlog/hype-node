// Demo-mode sentinel address and pure helpers.
//
// The sentinel is a burn address (0x...dead) that can never sign a real SIWE
// message — giving it a session is inherently safe and clearly DEMO-labeled.
// All helpers here are side-effect-free so they can be used in both server
// and client code and are straightforward to unit-test.

export const DEMO_ADDRESS = "0x000000000000000000000000000000000000dead";

/** 60-minute soft expiry for the demo session. */
export const DEMO_TTL_MS = 60 * 60 * 1000;

/**
 * True when the given address is the demo sentinel (case-insensitive).
 */
export function isDemoAddress(addr?: string | null): boolean {
  return !!addr && addr.toLowerCase() === DEMO_ADDRESS;
}

/**
 * True when the demo session is past its TTL.
 *
 * @param startedAt - Unix-ms timestamp from `session.demoStartedAt`
 * @param now       - Current Unix-ms (pass `Date.now()` at the call site;
 *                    accept explicitly so this stays pure and testable)
 */
export function isDemoExpired(startedAt?: number, now = 0): boolean {
  return !!startedAt && now > 0 && now - startedAt > DEMO_TTL_MS;
}
