// Portfolio snapshot persistence — list + take-now.
//
// All access is gated by SIWE via `requireUser()`. Rows are keyed by the
// lowercased wallet address; users only ever see their own snapshots.
//
// POST  → freezes the user's current SSI Registry indices + SoDEX spot
//         balances + benchmark prices (BTC/ETH/ssiMAG7) into a single row.
// GET   → returns recent snapshots (default 90, max 365), optionally
//         filtered by [from, to] window. Ordered taken_at desc.

import { NextResponse, type NextRequest } from "next/server";
import type { Address } from "viem";

import { requireUser } from "@/lib/supabase/auth";
import { db } from "@/lib/supabase/server";
import { getUserPortfolio } from "@/lib/api/portfolio";
import {
  CURRENCY_ID,
  getCurrencySnapshot,
  getSsiSnapshot,
} from "@/lib/api/sosovalue";
import {
  buildPriceLookup,
  buildSnapshotPositions,
  computeAumUsd,
  type SnapshotPosition,
} from "@/lib/api/portfolio-snapshot";
import type {
  Json,
  PfSnapshotInsert,
  PfSnapshotRow,
} from "@/lib/supabase/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Codebase-wide workaround for the deep-Database-type instantiation issue
// that makes `db.from("pf_snapshots").insert(...)` widen to `never`. Same
// pattern used in app/api/builder/drafts and app/api/chat/threads.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const snapshots = () => db.from("pf_snapshots") as any;

// ---------- POST: take a snapshot now ----------

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.user) return auth.res;
  if (auth.user.demo) {
    return NextResponse.json(
      { ok: false, error: "Demo mode is read-only — connect a wallet." },
      { status: 403 },
    );
  }
  const userAddress = auth.user.address;

  // Pull benchmark prices in parallel with the user portfolio. Each one is
  // independently allowed to fail (we degrade to null rather than 500ing
  // the whole snapshot) — the snapshot is still useful without benchmarks.
  const [portfolio, btcRes, ethRes, mag7Res] = await Promise.all([
    getUserPortfolio(userAddress as Address),
    safeNum(() => getCurrencySnapshot(CURRENCY_ID.btc).then((s) => s.price)),
    safeNum(() => getCurrencySnapshot(CURRENCY_ID.eth).then((s) => s.price)),
    safeNum(() => getSsiSnapshot("ssiMAG7").then((s) => s.price)),
  ]);

  // Price every spot symbol in the wallet before persisting. The cron path
  // does this in a single batch across all wallets; here it's just this
  // user's symbols, so the call is cheap (shares the SoSoValue cache with
  // the prior `getCurrencySnapshot` calls for benchmarks).
  const spotSymbols = (portfolio.sodex.balances ?? []).map((b) => b.asset);
  const priceLookup = await buildPriceLookup(spotSymbols);
  const positions: SnapshotPosition[] = buildSnapshotPositions(
    portfolio,
    priceLookup,
  );
  const totalAumUsd = computeAumUsd(positions);
  // PnL requires cost basis we don't track yet (v2 — needs on-chain transfer
  // indexing). Persist null until the indexer lands so historical rows aren't
  // poisoned with synthetic numbers.
  const totalPnlUsd: number | null = null;

  const insert: PfSnapshotInsert = {
    user_address: userAddress,
    positions: positions as unknown as Json,
    total_aum_usd: totalAumUsd,
    total_pnl_usd: totalPnlUsd,
    benchmark_btc_price: btcRes,
    benchmark_eth_price: ethRes,
    benchmark_ssimag7_nav: mag7Res,
    trigger: "manual",
  };

  const { data, error } = await snapshots()
    .insert(insert)
    .select("id, taken_at, total_aum_usd")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "insert failed" },
      { status: 500 },
    );
  }

  const out = NextResponse.json({
    id: (data as { id: string }).id,
    taken_at: (data as { taken_at: string }).taken_at,
    total_aum_usd: (data as { total_aum_usd: number | null }).total_aum_usd,
  });
  for (const cookie of auth.res.cookies.getAll()) {
    out.cookies.set(cookie);
  }
  return out;
}

// ---------- GET: list snapshots ----------

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.user) return auth.res;
  const userAddress = auth.user.address;

  const sp = req.nextUrl.searchParams;
  const rawLimit = Number(sp.get("limit") ?? 90);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 365) : 90;
  const from = sp.get("from");
  const to = sp.get("to");

  let q = snapshots()
    .select("*")
    .eq("user_address", userAddress)
    .order("taken_at", { ascending: false })
    .limit(limit);

  if (from && isIsoDate(from)) {
    q = q.gte("taken_at", from);
  }
  if (to && isIsoDate(to)) {
    q = q.lte("taken_at", to);
  }

  const { data, error } = await q;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const out = NextResponse.json((data ?? []) as PfSnapshotRow[]);
  for (const cookie of auth.res.cookies.getAll()) {
    out.cookies.set(cookie);
  }
  return out;
}

// ---------- helpers ----------

async function safeNum(fn: () => Promise<number>): Promise<number | null> {
  try {
    const v = await fn();
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

function isIsoDate(s: string): boolean {
  // Accept either YYYY-MM-DD or full ISO timestamps. Reject anything else
  // so we don't shove invalid filters into Postgres (which would 400 from
  // PostgREST and surface as a useless 500 to the caller).
  if (!s) return false;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return true;
  const d = new Date(s);
  return !Number.isNaN(d.getTime());
}
