// Publisher proposals — list + create.
//
// Replaces the earlier mock snapshot with Supabase-backed persistence. Two
// access modes via `?scope=`:
//   - "mine" (default for authed callers): rows where creator_address matches
//     the SIWE session.
//   - "all": public marketplace view of proposals with status in
//     ('published', 'live'). No auth required.
//
// All writes (POST) require auth and stamp creator_address from the session.

import { NextResponse, type NextRequest } from "next/server";

import { demoWriteBlocked, getRequestUser, requireUser } from "@/lib/supabase/auth";
import { db } from "@/lib/supabase/server";
import type {
  Json,
  PbProposalInsert,
  PbProposalRow,
} from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

// String unions matching the bd/pb_proposals CHECK constraints. Keeping them
// as the literal types Supabase's generated Database expects means callers
// can use them directly in `.in('status', ...)` / `.eq('source', ...)` without
// any-casts.
type ProposalStatus = PbProposalRow["status"];
type ProposalSource = NonNullable<PbProposalRow["source"]>;

const ALLOWED_STATUS = new Set<ProposalStatus>([
  "draft",
  "review",
  "signed",
  "published",
  "live",
  "paused",
  "rejected",
]);
const ALLOWED_SOURCE = new Set<ProposalSource>([
  "manual",
  "agent_draft",
  "hype_radar",
]);
const PUBLIC_STATUSES: readonly ProposalStatus[] = ["published", "live"] as const;

function clampLimit(raw: string | null, fallback = 50, max = 200): number {
  const n = Number(raw ?? fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), 1), max);
}

function clampOffset(raw: string | null): number {
  const n = Number(raw ?? 0);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0;
}

function isProposalStatus(s: string): s is ProposalStatus {
  return ALLOWED_STATUS.has(s as ProposalStatus);
}

function parseStatusList(raw: string | null): ProposalStatus[] | null {
  if (!raw) return null;
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter(isProposalStatus);
  return parts.length > 0 ? parts : null;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const scope = (sp.get("scope") ?? "mine").toLowerCase();
  const limit = clampLimit(sp.get("limit"));
  const offset = clampOffset(sp.get("offset"));
  const statuses = parseStatusList(sp.get("status"));
  const sourceRaw = sp.get("source");
  const source: ProposalSource | null =
    sourceRaw && ALLOWED_SOURCE.has(sourceRaw as ProposalSource)
      ? (sourceRaw as ProposalSource)
      : null;

  // Public marketplace view — no auth required.
  if (scope === "all") {
    let q = db
      .from("pb_proposals")
      .select("*")
      .in(
        "status",
        statuses && statuses.every((s) => PUBLIC_STATUSES.includes(s))
          ? statuses
          : PUBLIC_STATUSES,
      )
      .order("updated_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if (source) q = q.eq("source", source);

    const { data, error } = await q;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json((data ?? []) as PbProposalRow[]);
  }

  // "mine" — auth required.
  const res = NextResponse.next();
  const user = await getRequestUser(req, res);
  if (!user) {
    return NextResponse.json({ error: "auth required" }, { status: 401 });
  }

  let q = db
    .from("pb_proposals")
    .select("*")
    .eq("creator_address", user.address)
    .order("updated_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (statuses) q = q.in("status", statuses);
  if (source) q = q.eq("source", source);

  const { data, error } = await q;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const out = NextResponse.json((data ?? []) as PbProposalRow[]);
  for (const cookie of res.cookies.getAll()) {
    out.cookies.set(cookie);
  }
  return out;
}

type CreateBody = {
  ssi_ticker?: unknown;
  title?: unknown;
  thesis?: unknown;
  constituents?: unknown;
  meta?: unknown;
  source?: unknown;
  source_run_id?: unknown;
  status?: unknown;
  on_chain_tx?: unknown;
  on_chain_index_id?: unknown;
  backtest_return?: unknown;
  backtest_sharpe?: unknown;
  backtest_max_dd?: unknown;
};

function isJsonish(v: unknown): v is Json {
  // Insert validator — Supabase will accept anything serializable, but we
  // keep this gate so we fail fast on circular refs / Bigint / functions.
  if (v === null) return true;
  const t = typeof v;
  if (t === "string" || t === "number" || t === "boolean") return true;
  if (Array.isArray(v)) return v.every(isJsonish);
  if (t === "object") {
    return Object.values(v as Record<string, unknown>).every(isJsonish);
  }
  return false;
}

function optNumber(v: unknown): number | null {
  if (v === undefined || v === null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

function optString(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v === "string") {
    const t = v.trim();
    return t.length > 0 ? t : null;
  }
  return null;
}

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.user) return auth.res;
  const demo = demoWriteBlocked(auth.user);
  if (demo) return demo;
  const userAddress = auth.user.address;

  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (typeof body.ssi_ticker !== "string" || !body.ssi_ticker.trim()) {
    return NextResponse.json(
      { error: "ssi_ticker (string) required" },
      { status: 400 },
    );
  }
  if (!isJsonish(body.constituents)) {
    return NextResponse.json(
      { error: "constituents must be JSON-serializable" },
      { status: 400 },
    );
  }
  if (body.meta !== undefined && !isJsonish(body.meta)) {
    return NextResponse.json(
      { error: "meta must be JSON-serializable" },
      { status: 400 },
    );
  }

  const source: ProposalSource =
    typeof body.source === "string" && ALLOWED_SOURCE.has(body.source as ProposalSource)
      ? (body.source as ProposalSource)
      : "manual";

  // New proposals default to draft regardless of caller intent — a publish
  // transition must go through PATCH so we have a single audit path.
  const requestedStatus: ProposalStatus =
    typeof body.status === "string" && ALLOWED_STATUS.has(body.status as ProposalStatus)
      ? (body.status as ProposalStatus)
      : "draft";
  const status: PbProposalRow["status"] =
    requestedStatus === "published" || requestedStatus === "live"
      ? "draft"
      : requestedStatus;

  const insert: PbProposalInsert = {
    creator_address: userAddress,
    ssi_ticker: body.ssi_ticker.trim(),
    title: optString(body.title),
    thesis: optString(body.thesis),
    constituents: body.constituents as Json,
    meta: body.meta === undefined ? null : (body.meta as Json),
    source,
    source_run_id:
      typeof body.source_run_id === "string" && body.source_run_id.length > 0
        ? body.source_run_id
        : null,
    status,
    on_chain_tx: optString(body.on_chain_tx),
    on_chain_index_id: optString(body.on_chain_index_id),
    backtest_return: optNumber(body.backtest_return),
    backtest_sharpe: optNumber(body.backtest_sharpe),
    backtest_max_dd: optNumber(body.backtest_max_dd),
  };

  const { data, error } = await db
    .from("pb_proposals")
    .insert(insert)
    .select("id")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "insert failed" },
      { status: 500 },
    );
  }

  const out = NextResponse.json({ id: (data as { id: string }).id });
  for (const cookie of auth.res.cookies.getAll()) {
    out.cookies.set(cookie);
  }
  return out;
}
