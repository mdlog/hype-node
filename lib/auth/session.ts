import type { SessionOptions } from "iron-session";

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
};

const password =
  process.env.SESSION_PASSWORD ??
  // Dev-only fallback so first-run works without env setup. Production MUST
  // set SESSION_PASSWORD to a 32+ char random string — the cookie can't be
  // trusted otherwise.
  "dev_only_change_me_____________________________";

if (password.length < 32) {
  throw new Error("SESSION_PASSWORD must be at least 32 characters");
}

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
