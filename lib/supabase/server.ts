// Server-side Supabase client (service role).
//
// This client bypasses RLS. ONLY import in server-side code (route handlers,
// Server Components, server actions) — never in "use client" components.
//
// All access control happens in app code: route handlers verify the iron-
// session cookie and inject `user_address` into queries via `requireUser()`
// from `./auth`. The service role key is the master key — protect it like
// a database password.
//
// We use a singleton across the Node process so the underlying connection
// pool is reused across hot reloads. The browser bundle should NEVER include
// this file; webpack will inline `process.env.SUPABASE_SERVICE_ROLE_KEY` as
// `undefined` in the client bundle, and the createClient call would throw
// at import time. The `import "server-only"` directive enforces this — any
// "use client" file that transitively imports this will fail to compile.

import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "./types";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

// Lazy singleton — instantiate on first use so module import doesn't crash
// when env vars are missing during build (e.g. type-checking without .env).
const G = globalThis as unknown as {
  __supabaseAdmin?: SupabaseClient<Database>;
};

export function supabaseAdmin(): SupabaseClient<Database> {
  if (!G.__supabaseAdmin) {
    if (!URL || !SERVICE_KEY) {
      throw new Error(
        "Supabase credentials missing. Set NEXT_PUBLIC_SUPABASE_URL and " +
          "SUPABASE_SERVICE_ROLE_KEY in .env.",
      );
    }
    G.__supabaseAdmin = createClient<Database>(URL, SERVICE_KEY, {
      auth: {
        // No user sessions — we don't use Supabase Auth. SIWE address is the
        // canonical id, stored in the session cookie via iron-session.
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }
  return G.__supabaseAdmin;
}

// Convenience re-export so callers can do `import { db } from ...`
export const db = new Proxy({} as SupabaseClient<Database>, {
  get(_target, prop) {
    const client = supabaseAdmin();
    const value = (client as unknown as Record<string | symbol, unknown>)[prop];
    return typeof value === "function" ? (value as Function).bind(client) : value;
  },
});
