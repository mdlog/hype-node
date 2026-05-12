// User settings — persisted in `sys_user_settings`. One row per wallet
// address, upserted by GET (which auto-creates a default row on first
// access so the UI never sees "no row found"). PUT applies a partial
// update; PATCH is the same.

import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/auth";
import type {
  SysUserSettingsRow,
  SysUserSettingsUpdate,
} from "@/lib/supabase/types";

const ALLOWED_FIELDS: Array<keyof SysUserSettingsUpdate> = [
  "theme",
  "default_period",
  "default_strategy",
  "email",
  "notify_on_drawdown",
  "notify_on_rebalance",
  "notify_on_publish",
  "display_name",
  "twitter_handle",
  "bio",
];

function sanitizePatch(body: unknown): SysUserSettingsUpdate {
  if (!body || typeof body !== "object") return {};
  const src = body as Record<string, unknown>;
  const out: SysUserSettingsUpdate = {} as SysUserSettingsUpdate;
  for (const key of ALLOWED_FIELDS) {
    if (key in src) {
      // Pass through whatever shape the client sent for the allowed key —
      // Postgres will reject malformed types (e.g. boolean for text col).
      // user_address is intentionally NOT in ALLOWED_FIELDS so callers
      // cannot rebind their settings to another wallet.
      (out as Record<string, unknown>)[key] = src[key];
    }
  }
  return out;
}

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.user) return auth.res;
  const userAddress = auth.user.address;

  // Try select first; if no row, upsert a default and return.
  const { data, error } = await db
    .from("sys_user_settings")
    .select("*")
    .eq("user_address", userAddress)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (data) {
    return NextResponse.json(data as SysUserSettingsRow);
  }

  // First-time access: create row with defaults.
  const { data: created, error: insertErr } = await db
    .from("sys_user_settings")
    .insert({ user_address: userAddress })
    .select("*")
    .single();
  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }
  return NextResponse.json(created as SysUserSettingsRow);
}

async function applyPatch(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req);
  if (!auth.user) return auth.res;
  const userAddress = auth.user.address;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const patch = sanitizePatch(body);
  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { error: "no allowed fields in body" },
      { status: 400 },
    );
  }

  // Upsert: ensure the row exists, then patch in one round-trip. The
  // `onConflict: 'user_address'` makes this idempotent for first-time users
  // who haven't called GET yet.
  const { data, error } = await db
    .from("sys_user_settings")
    .upsert(
      { user_address: userAddress, ...patch },
      { onConflict: "user_address" },
    )
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data as SysUserSettingsRow);
}

export const PUT = applyPatch;
export const PATCH = applyPatch;
