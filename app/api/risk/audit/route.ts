// List risk-config audit entries for the signed-in user. Anonymous edits
// (made when no session was present) are also surfaced when the caller
// passes `?include_anonymous=true` so admins can see system overrides.

import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/auth";
import type { SysRiskAuditRow } from "@/lib/supabase/types";

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.user) return auth.res;
  const userAddress = auth.user.address;

  const { searchParams } = req.nextUrl;
  const limit = Math.min(200, Math.max(1, Number(searchParams.get("limit") ?? 50)));
  const includeAnonymous = searchParams.get("include_anonymous") === "true";

  let query = db
    .from("sys_risk_audit")
    .select("*")
    .order("changed_at", { ascending: false })
    .limit(limit);

  if (includeAnonymous) {
    query = query.in("user_address", [userAddress, "anonymous"]);
  } else {
    query = query.eq("user_address", userAddress);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json((data ?? []) as SysRiskAuditRow[]);
}
