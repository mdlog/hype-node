// Single proposal — read / patch (status transitions, metadata) / hard delete.
//
// Read access:
//   - Public when status in ('published','live') so the marketplace can link
//     directly to a proposal page.
//   - Otherwise auth + ownership required (creator only).
//
// Status transitions are validated server-side. Earnings rows cascade-delete
// via the FK in 0001_init.sql, so DELETE removes the full ledger trail too.

import { NextResponse, type NextRequest } from "next/server";

import { demoWriteBlocked, getRequestUser, requireUser } from "@/lib/supabase/auth";
import { db } from "@/lib/supabase/server";
import type {
  Json,
  PbProposalRow,
  PbProposalUpdate,
} from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

const PUBLIC_STATUSES: PbProposalRow["status"][] = ["published", "live"];

// Allowed status flow (forward + a couple of recoveries). Keeps a draft from
// jumping straight to "live" without going through review/sign/publish.
const STATUS_GRAPH: Record<PbProposalRow["status"], PbProposalRow["status"][]> = {
  draft: ["review", "rejected"],
  review: ["draft", "signed", "rejected"],
  signed: ["published", "rejected"],
  published: ["live", "paused", "rejected"],
  live: ["paused", "rejected"],
  paused: ["live", "rejected"],
  rejected: ["draft"],
};

const ALLOWED_STATUS = new Set(Object.keys(STATUS_GRAPH));

function isJsonish(v: unknown): v is Json {
  if (v === null) return true;
  const t = typeof v;
  if (t === "string" || t === "number" || t === "boolean") return true;
  if (Array.isArray(v)) return v.every(isJsonish);
  if (t === "object") {
    return Object.values(v as Record<string, unknown>).every(isJsonish);
  }
  return false;
}

export async function GET(req: NextRequest, { params }: Ctx) {
  const { data, error } = await db
    .from("pb_proposals")
    .select("*")
    .eq("id", params.id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const row = data as PbProposalRow;

  if ((PUBLIC_STATUSES as string[]).includes(row.status)) {
    return NextResponse.json(row);
  }

  // Private — needs auth + ownership.
  const res = NextResponse.next();
  const user = await getRequestUser(req, res);
  if (!user || user.address !== row.creator_address) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const out = NextResponse.json(row);
  for (const cookie of res.cookies.getAll()) {
    out.cookies.set(cookie);
  }
  return out;
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const auth = await requireUser(req);
  if (!auth.user) return auth.res;
  const demo = demoWriteBlocked(auth.user);
  if (demo) return demo;
  const userAddress = auth.user.address;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  // Need current row to validate status transition + ownership.
  const current = await db
    .from("pb_proposals")
    .select("*")
    .eq("id", params.id)
    .maybeSingle();
  if (current.error) {
    return NextResponse.json({ error: current.error.message }, { status: 500 });
  }
  if (!current.data) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const row = current.data as PbProposalRow;
  if (row.creator_address !== userAddress) {
    // Don't leak existence of other people's rows.
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const patch: PbProposalUpdate = {};

  if ("title" in body) {
    if (body.title === null) patch.title = null;
    else if (typeof body.title === "string") patch.title = body.title.trim() || null;
    else return NextResponse.json({ error: "title must be string|null" }, { status: 400 });
  }
  if ("thesis" in body) {
    if (body.thesis === null) patch.thesis = null;
    else if (typeof body.thesis === "string") patch.thesis = body.thesis.trim() || null;
    else return NextResponse.json({ error: "thesis must be string|null" }, { status: 400 });
  }
  if ("ssi_ticker" in body) {
    if (typeof body.ssi_ticker === "string" && body.ssi_ticker.trim()) {
      patch.ssi_ticker = body.ssi_ticker.trim();
    } else {
      return NextResponse.json(
        { error: "ssi_ticker must be non-empty string" },
        { status: 400 },
      );
    }
  }
  if ("constituents" in body) {
    if (!isJsonish(body.constituents)) {
      return NextResponse.json(
        { error: "constituents must be JSON-serializable" },
        { status: 400 },
      );
    }
    patch.constituents = body.constituents as Json;
  }
  if ("meta" in body) {
    if (body.meta !== null && !isJsonish(body.meta)) {
      return NextResponse.json(
        { error: "meta must be JSON-serializable" },
        { status: 400 },
      );
    }
    patch.meta = body.meta as Json | null;
  }
  if ("on_chain_tx" in body) {
    if (body.on_chain_tx === null) patch.on_chain_tx = null;
    else if (typeof body.on_chain_tx === "string") patch.on_chain_tx = body.on_chain_tx;
    else return NextResponse.json({ error: "on_chain_tx must be string|null" }, { status: 400 });
  }
  if ("on_chain_index_id" in body) {
    if (body.on_chain_index_id === null) patch.on_chain_index_id = null;
    else if (typeof body.on_chain_index_id === "string")
      patch.on_chain_index_id = body.on_chain_index_id;
    else
      return NextResponse.json(
        { error: "on_chain_index_id must be string|null" },
        { status: 400 },
      );
  }
  for (const k of ["backtest_return", "backtest_sharpe", "backtest_max_dd"] as const) {
    if (k in body) {
      const v = body[k];
      if (v === null) {
        patch[k] = null;
      } else if (typeof v === "number" && Number.isFinite(v)) {
        patch[k] = v;
      } else {
        return NextResponse.json({ error: `${k} must be number|null` }, { status: 400 });
      }
    }
  }
  if ("status" in body) {
    const next = body.status;
    if (typeof next !== "string" || !ALLOWED_STATUS.has(next)) {
      return NextResponse.json(
        { error: `status must be one of ${Object.keys(STATUS_GRAPH).join(",")}` },
        { status: 400 },
      );
    }
    if (next !== row.status) {
      const allowed = STATUS_GRAPH[row.status] ?? [];
      if (!allowed.includes(next as PbProposalRow["status"])) {
        return NextResponse.json(
          {
            error: `illegal transition: ${row.status} -> ${next}`,
            allowed,
          },
          { status: 409 },
        );
      }
      patch.status = next as PbProposalRow["status"];
    }
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "no updatable fields provided" }, { status: 400 });
  }

  const { data, error } = await db
    .from("pb_proposals")
    .update(patch)
    .eq("creator_address", userAddress)
    .eq("id", params.id)
    .select("*")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const out = NextResponse.json(data as PbProposalRow);
  for (const cookie of auth.res.cookies.getAll()) {
    out.cookies.set(cookie);
  }
  return out;
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const auth = await requireUser(req);
  if (!auth.user) return auth.res;
  const demo = demoWriteBlocked(auth.user);
  if (demo) return demo;
  const userAddress = auth.user.address;

  // Hard delete — cascades to pb_earnings via FK on delete cascade.
  const { data, error } = await db
    .from("pb_proposals")
    .delete()
    .eq("creator_address", userAddress)
    .eq("id", params.id)
    .select("id");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data || data.length === 0) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const out = NextResponse.json({ ok: true, id: params.id });
  for (const cookie of auth.res.cookies.getAll()) {
    out.cookies.set(cookie);
  }
  return out;
}
