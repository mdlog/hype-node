// Backtest run persistence — list + create.
//
// All access is gated by SIWE via `requireUser()`. Rows are keyed by the
// lowercased wallet address; users only ever see their own runs.

import { NextResponse, type NextRequest } from "next/server";

import { requireUser } from "@/lib/supabase/auth";
import { db } from "@/lib/supabase/server";
import type { BacktestResult } from "@/lib/api/agent";
import type { BtRunInsert, BtRunRow, Json } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

type SaveBody = {
  strategy_ticker?: string;
  days?: number;
  constituents?: unknown;
  result?: BacktestResult | null;
  label?: string | null;
  notes?: string | null;
  tags?: string[] | null;
};

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.user) return auth.res;
  const userAddress = auth.user.address;

  let body: SaveBody;
  try {
    body = (await req.json()) as SaveBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (!body.strategy_ticker || typeof body.strategy_ticker !== "string") {
    return NextResponse.json(
      { error: "strategy_ticker required" },
      { status: 400 },
    );
  }
  if (typeof body.days !== "number" || body.days <= 0 || body.days > 365) {
    return NextResponse.json(
      { error: "days must be 1..365" },
      { status: 400 },
    );
  }
  if (!body.constituents) {
    return NextResponse.json({ error: "constituents required" }, { status: 400 });
  }
  if (!body.result || typeof body.result !== "object") {
    return NextResponse.json({ error: "result required" }, { status: 400 });
  }

  const r = body.result;
  const insert: BtRunInsert = {
    user_address: userAddress,
    strategy_ticker: body.strategy_ticker,
    days: body.days,
    constituents: body.constituents as Json,
    return_total: typeof r.return === "number" ? r.return : null,
    sharpe: typeof r.sharpe === "number" ? r.sharpe : null,
    sortino: null,
    max_drawdown: typeof r.max_drawdown === "number" ? r.max_drawdown : null,
    win_rate: typeof r.win_rate === "number" ? r.win_rate : null,
    vs_btc: typeof r.vs_btc === "number" ? r.vs_btc : null,
    vs_eth: typeof r.vs_eth === "number" ? r.vs_eth : null,
    n_assets: typeof r.n_assets === "number" ? r.n_assets : null,
    n_returns: typeof r.n_returns === "number" ? r.n_returns : null,
    equity_preview: Array.isArray(r.equity_preview)
      ? (r.equity_preview as unknown as Json)
      : null,
    raw_result: r as unknown as Json,
    label: typeof body.label === "string" && body.label.trim() ? body.label.trim() : null,
    notes: typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null,
    tags:
      Array.isArray(body.tags) && body.tags.every((t) => typeof t === "string")
        ? body.tags
        : null,
  };

  // The `db` proxy in lib/supabase/server.ts loses generic type info on the
  // dynamic `.from(...)` call, so the inferred Insert payload narrows to
  // `never`. Cast through `never` to satisfy the type check; runtime payload
  // is still validated against `BtRunInsert` shape above.
  const { data, error } = await db
    .from("bt_runs")
    .insert(insert)
    .select("id")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "insert failed" },
      { status: 500 },
    );
  }

  // Re-attach any cookies refreshed by requireUser's session-touch.
  const out = NextResponse.json({ id: (data as { id: string }).id });
  for (const cookie of auth.res.cookies.getAll()) {
    out.cookies.set(cookie);
  }
  return out;
}

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.user) return auth.res;
  const userAddress = auth.user.address;

  const sp = req.nextUrl.searchParams;
  const rawLimit = Number(sp.get("limit") ?? 20);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 20;
  const rawOffset = Number(sp.get("offset") ?? 0);
  const offset = Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : 0;
  const tag = sp.get("tag");

  let q = db
    .from("bt_runs")
    .select("*")
    .eq("user_address", userAddress)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (tag) {
    q = q.contains("tags", [tag]);
  }

  const { data, error } = await q;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const out = NextResponse.json((data ?? []) as BtRunRow[]);
  for (const cookie of auth.res.cookies.getAll()) {
    out.cookies.set(cookie);
  }
  return out;
}
