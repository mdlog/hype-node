import { NextResponse } from "next/server";

import { getDecisionHistory, getHistoryStats } from "@/lib/api/agent";

// Decision audit trail proxy. Server components and the History page client
// both call here so we can swap the upstream (e.g. Postgres later) without
// touching the rendering layer.

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Number(url.searchParams.get("limit") ?? 100);
  const sector = url.searchParams.get("sector") ?? undefined;
  const since = url.searchParams.get("since") ?? undefined;
  const wantsStats = url.searchParams.get("withStats") === "1";

  const [rows, stats] = await Promise.all([
    getDecisionHistory({ limit, sector, since }),
    wantsStats ? getHistoryStats() : Promise.resolve(null),
  ]);

  return NextResponse.json({
    ok: true,
    rows,
    count: rows.length,
    stats: stats ?? null,
  });
}
