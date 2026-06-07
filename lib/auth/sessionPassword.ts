// Resolution + validation for the iron-session seal password.
//
// Split into a pure function so the production-safety rule is unit-testable
// without booting Next. The rule:
//   - A real, 32+ char SESSION_PASSWORD is always accepted.
//   - A missing password (or the public in-repo dev fallback) is allowed ONLY
//     outside production. In production we refuse to seal cookies with a
//     guessable string — otherwise anyone can forge a session for any wallet.
//   - We skip the production throw during `next build` (NEXT_PHASE), because
//     build-time module load happens before runtime secrets are injected; the
//     module is re-evaluated per serverless cold start where the real env IS
//     present, so the runtime check still fires.

// 48 chars — long enough to pass the length check, public on purpose so it is
// obvious in logs/source that it is NOT a real secret.
export const DEV_FALLBACK_PASSWORD =
  "dev_only_change_me_____________________________";

export const MIN_PASSWORD_LENGTH = 32;

export type SessionPasswordEnv = {
  SESSION_PASSWORD?: string;
  NODE_ENV?: string;
  NEXT_PHASE?: string;
};

export function resolveSessionPassword(
  env: SessionPasswordEnv = process.env,
): string {
  const provided = env.SESSION_PASSWORD;
  const isProd = env.NODE_ENV === "production";
  const isBuildPhase = env.NEXT_PHASE === "phase-production-build";

  const missingOrPublic = !provided || provided === DEV_FALLBACK_PASSWORD;

  if (missingOrPublic) {
    if (isProd && !isBuildPhase) {
      throw new Error(
        "SESSION_PASSWORD must be set to a unique 32+ character secret in " +
          "production. Refusing to seal sessions with the public dev fallback " +
          "(sessions would be forgeable).",
      );
    }
    return DEV_FALLBACK_PASSWORD;
  }

  if (provided.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `SESSION_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters`,
    );
  }

  return provided;
}
