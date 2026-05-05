import { NextResponse } from "next/server";

import { stockDomain } from "@/lib/stock-logos";

// Server-side logo proxy for the /stocks page table rows.
//
// The frontend asks for `/api/stock-logos?ticker=TSLA`; we look up the
// curated company domain, then probe several upstream logo services in
// priority order. The first source that returns a real image (HTTP 200 +
// `image/*` content-type) wins; we stream those bytes back. If every source
// fails we return 404 so `<img onError>` can fall back to a letter avatar.
//
// Why a proxy: hitting Google favicons / Clearbit / DDG directly from the
// browser fails for users with ad-blockers or strict privacy extensions —
// those domains are on common blocklists and the fetches silently 404. By
// proxying through our own origin we sidestep the entire blocklist issue,
// AND we get to pick the highest-quality source per domain instead of
// hard-binding to one.
//
// Caching: real-world favicons rarely change. We pin a 7-day browser cache
// + 30-day CDN cache so a deployed app effectively does each upstream
// lookup once per company per week. Per-route Next.js fetch caches each
// upstream call too.

export const runtime = "nodejs";
export const revalidate = 604800; // 7 days

const SOURCES = (domain: string): string[] => [
  // Clearbit — best quality (clean transparent logos for major brands).
  // Returns 404 for unknown domains, so it self-gates without false positives.
  `https://logo.clearbit.com/${domain}`,
  // DuckDuckGo — small (32px) but reliable and unblocked.
  `https://icons.duckduckgo.com/ip3/${domain}.ico`,
  // Google favicons — largest reach but lowest quality at small sizes.
  `https://www.google.com/s2/favicons?sz=128&domain=${encodeURIComponent(domain)}`,
];

export async function GET(req: Request) {
  const url = new URL(req.url);
  const ticker = url.searchParams.get("ticker");
  if (!ticker) {
    return NextResponse.json({ error: "ticker query param required" }, { status: 400 });
  }
  const domain = stockDomain(ticker);
  if (!domain) {
    // Frontend already skips the request when stockLogoUrl returns null; if
    // someone hits this directly with an unknown ticker, fail clearly.
    return NextResponse.json({ error: "unknown ticker" }, { status: 404 });
  }

  for (const src of SOURCES(domain)) {
    try {
      const res = await fetch(src, {
        // Allow Next.js to memoize the upstream response. Once a source
        // gives us a winner we don't keep probing the slower fallbacks.
        next: { revalidate: 604800 },
        // A generic-ish UA so providers don't 403 us as a bot.
        headers: { "user-agent": "Mozilla/5.0 (compatible; HypeNode/1.0)" },
      });
      if (!res.ok) continue;
      const contentType = res.headers.get("content-type") ?? "";
      // Reject HTML 200s (some services return a placeholder page when the
      // domain isn't recognized).
      if (!contentType.startsWith("image/")) continue;
      const buf = await res.arrayBuffer();
      // Tiny payloads (< 200 bytes) are almost always 1x1 pixel
      // placeholders or bogus fallbacks — skip them in favor of the next
      // source.
      if (buf.byteLength < 200) continue;
      return new NextResponse(buf, {
        status: 200,
        headers: {
          "content-type": contentType,
          "cache-control":
            "public, max-age=604800, s-maxage=2592000, stale-while-revalidate=86400, immutable",
          "x-logo-source": new URL(src).hostname,
        },
      });
    } catch {
      // Network error → try next source.
    }
  }
  return NextResponse.json({ error: "no logo found" }, { status: 404 });
}
