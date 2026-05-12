// Catch-all server proxy for SoSoValue OpenAPI v1.
//
// "use client" widgets (e.g. SmartMoneyWidget, StablecoinMarketCap) call
// lib/api/sosovalue helpers from the browser. process.env.SOSOVALUE_API_KEY
// is server-only — without NEXT_PUBLIC_ it's stripped from the browser
// bundle, so the in-browser request() saw KEY="" and fell through to the
// synthetic fallback every time.
//
// This route lets the browser hit `/api/sosovalue/<path>?<qs>` and have the
// server perform the upstream call with the real key. The lib's request()
// reuses its existing rate-limiter / cache / backoff state since we're
// running on the server here.
//
// Sentinel handling: if the upstream is unreachable / unauthenticated,
// request() returns the fallback (a unique sentinel object). We translate
// that to a 502 so the browser-side request() falls back to its OWN
// closure-defined synthetic data (which is what the widgets read).

import { NextRequest, NextResponse } from "next/server";

import { request } from "@/lib/api/sosovalue";

const UPSTREAM_UNAVAILABLE = Symbol("sosovalue-upstream-unavailable");

export async function GET(
  req: NextRequest,
  { params }: { params: { path: string[] } },
) {
  const path = "/" + params.path.map(encodeURIComponent).join("/");
  const search = req.nextUrl.search;
  const fullPath = `${path}${search}`;

  const data = await request<unknown>(fullPath, () => UPSTREAM_UNAVAILABLE);

  if (data === UPSTREAM_UNAVAILABLE) {
    return NextResponse.json(
      { error: "sosovalue upstream unavailable" },
      { status: 502 },
    );
  }

  return NextResponse.json(data);
}
