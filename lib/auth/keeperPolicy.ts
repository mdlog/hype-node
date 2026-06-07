// Pure shared-secret check for the keeper/indexer write path — no server-only
// import so it is unit-testable. The IO wrapper lives in ./keeper.ts.

export const KEEPER_SECRET_HEADER = "x-keeper-secret";

export function keeperSecretValid(
  provided: string | null | undefined,
  secret: string | undefined,
): boolean {
  if (!secret) return false; // not configured → keeper auth path off
  if (!provided) return false;
  return provided === secret;
}
