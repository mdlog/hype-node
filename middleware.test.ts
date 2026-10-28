import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { middleware } from "./middleware";

// Regression guard for "every unauthenticated hit on a protected route 500s":
// Next 14's middleware adapter parses a redirect's `Location` with `new URL()`
// and NO base, so a relative "/?auth=required…" throws "Invalid URL". The
// Location must be absolute — and on the PUBLIC origin from the Host header,
// never `req.nextUrl`'s, which Next builds from its listen address.

// Mirrors what Next hands middleware behind the cloudflared tunnel: nextUrl is
// the listen address (scheme already taken from x-forwarded-proto), while the
// Host header carries the hostname the browser actually requested.
function unauthRequest(url: string, host: string) {
  return new NextRequest(url, { headers: { host } });
}

describe("middleware — unauthenticated redirect", () => {
  it("redirects to the public origin, not the listen address", async () => {
    const res = await middleware(
      unauthRequest("https://localhost:3002/dashboard", "hypenode.mdloglabs.org"),
    );
    expect(res.status).toBe(307);
    expect(res.headers.get("Location")).toBe(
      "https://hypenode.mdloglabs.org/?auth=required&from=%2Fdashboard",
    );
  });

  it("emits a Location the middleware adapter can parse without a base", async () => {
    const res = await middleware(
      unauthRequest("http://localhost:3002/agent/runs", "localhost:3002"),
    );
    const loc = res.headers.get("Location") ?? "";
    // Exactly what next/dist/esm/server/web/adapter.js does with it.
    expect(() => new URL(loc)).not.toThrow();
    expect(loc).toBe("http://localhost:3002/?auth=required&from=%2Fagent%2Fruns");
  });

  it("lets public paths through without a redirect", async () => {
    const res = await middleware(
      unauthRequest("http://localhost:3002/discover", "localhost:3002"),
    );
    expect(res.headers.get("Location")).toBeNull();
  });
});
