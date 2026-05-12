// Daily cron — auto-snapshot every user with prior snapshot history.
//
// Protected via header `x-cron-secret` matching env CRON_SECRET. Without
// that secret in env, the endpoint refuses to run (no public unauth path).
//
// Population strategy: we don't have an on-chain event indexer for active
// SSI Registry users yet, so "active" = has at least one prior pf_snapshot
// row. New users opt in by taking a manual snapshot first; from then on
// they get daily auto-snapshots. This avoids scanning the full SSI Registry
// (which is bounded but still slow on testnet RPC) on every cron tick.
//
// Per-user errors are logged but don't fail the whole run — partial
// success beats 100% failure when one wallet's RPC times out.

import { NextResponse, type NextRequest } from "next/server";
import type { Address } from "viem";

import { db } from "@/lib/supabase/server";
import { getUserPortfolio } from "@/lib/api/portfolio";
import {
  CURRENCY_ID,
  getCurrencySnapshot,
  getSsiSnapshot,
} from "@/lib/api/sosovalue";
import {
  buildSnapshotPositions,
  computeAumUsd,
} from "@/lib/api/portfolio-snapshot";
import type { Json, PfSnapshotInsert } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;
// Long-running — give the route the full Vercel limit so a slow RPC on
// one wallet doesn't kill the run for everyone after.
export const maxDuration = 300;

// Codebase-wide workaround for the deep-Database-type instantiation issue
// that makes `db.from("pf_snapshots").insert(...)` widen to `never`. Same
// pattern used in app/api/builder/drafts and app/api/chat/threads.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const snapshots = () => db.from("pf_snapshots") as any;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET ?? "";
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured" },
      { status: 503 },
    );
  }
  const provided = req.headers.get("x-cron-secret") ?? "";
  if (provided !== secret) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Distinct active users: anyone with a snapshot in the last 60d. Bound
  // by 500 wallets per cron tick — anything beyond that needs sharding,
  // not a single scheduled run.
  const cutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
  const { data: rows, error: usersErr } = await snapshots()
    .select("user_address")
    .gte("taken_at", cutoff)
    .limit(5000);
  if (usersErr) {
    return NextResponse.json({ error: usersErr.message }, { status: 500 });
  }
  const addresses: string[] = Array.from(
    new Set(
      ((rows ?? []) as Array<{ user_address?: string | null }>)
        .map((r) => (r.user_address ?? "").toString())
        .filter(Boolean),
    ),
  ).slice(0, 500);

  // Benchmark prices once per cron tick — they don't change per user, so
  // hammering SoSoValue once per wallet would burn quota for nothing.
  const [btcRes, ethRes, mag7Res] = await Promise.all([
    safeNum(() => getCurrencySnapshot(CURRENCY_ID.btc).then((s) => s.price)),
    safeNum(() => getCurrencySnapshot(CURRENCY_ID.eth).then((s) => s.price)),
    safeNum(() => getSsiSnapshot("ssiMAG7").then((s) => s.price)),
  ]);

  let inserted = 0;
  const failures: { address: string; error: string }[] = [];

  for (const addr of addresses) {
    try {
      const portfolio = await getUserPortfolio(addr as Address);
      const positions = buildSnapshotPositions(portfolio);
      const insert: PfSnapshotInsert = {
        user_address: addr,
        positions: positions as unknown as Json,
        total_aum_usd: computeAumUsd(positions),
        total_pnl_usd: null,
        benchmark_btc_price: btcRes,
        benchmark_eth_price: ethRes,
        benchmark_ssimag7_nav: mag7Res,
        trigger: "cron_daily",
      };
      const { error } = await snapshots().insert(insert);
      if (error) {
        failures.push({ address: addr, error: error.message });
      } else {
        inserted++;
      }
    } catch (err) {
      failures.push({ address: addr, error: (err as Error).message });
    }
  }

  return NextResponse.json({
    ok: true,
    scanned: addresses.length,
    inserted,
    failed: failures.length,
    failures: failures.slice(0, 20),
  });
}

async function safeNum(fn: () => Promise<number>): Promise<number | null> {
  try {
    const v = await fn();
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}
