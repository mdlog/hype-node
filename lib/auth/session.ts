import type { SessionOptions } from "iron-session";

import { resolveSessionPassword } from "./sessionPassword";

export type SessionData = {
  // Set after a successful SIWE verify. Address is lowercased.
  address?: string;
  chainId?: number;
  // Server-issued nonce for the in-flight SIWE flow. Cleared after verify.
  nonce?: string;
  // Last surface the user picked from the landing page or header switcher.
  // Drives the post-SIWE redirect and the landing CTA highlight. Independent
  // of address — the user can express a preference before signing in.
  preferredRole?: "indexer" | "publisher";
  // Demo-mode flag — set by /api/demo/enter, cleared by /api/demo/exit.
  // When true, all stateful DB writes are gated with 403.
  demo?: boolean;
  // Unix ms timestamp when the demo session was started — used for TTL checks.
  demoStartedAt?: number;
};

// Resolves the seal password and HARD-FAILS in production if it is missing or
// left at the public dev fallback — otherwise sessions would be forgeable.
// See lib/auth/sessionPassword.ts for the rule + tests.
const password = resolveSessionPassword();

export const sessionOptions: SessionOptions = {
  password,
  cookieName: "hypenode_session",
  cookieOptions: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  },
};
