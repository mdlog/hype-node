import { describe, expect, it } from "vitest";

import { relativeRedirect } from "./http";

// Regression guard for the "logged in on hypenode.mdloglabs.org but redirected
// to https://localhost:3002/dashboard" bug: the redirect Location MUST be a
// relative path so a reverse proxy's internal Host can never leak into it.
describe("relativeRedirect", () => {
  it("emits a relative Location (no scheme, no host)", () => {
    const res = relativeRedirect("/dashboard");
    const loc = res.headers.get("Location");
    expect(loc).toBe("/dashboard");
    // Never absolute — this is the whole point.
    expect(loc).not.toMatch(/^https?:\/\//);
    expect(loc).not.toMatch(/^\/\//);
    expect(loc).not.toContain("localhost");
  });

  it("defaults to 303 and honours a custom status", () => {
    expect(relativeRedirect("/dashboard").status).toBe(303);
    expect(relativeRedirect("/", 307).status).toBe(307);
  });

  it("rejects protocol-relative targets (open-redirect guard)", () => {
    expect(relativeRedirect("//evil.com/phish").headers.get("Location")).toBe("/");
  });

  it("rejects absolute URLs and non-slash paths", () => {
    expect(relativeRedirect("https://evil.com").headers.get("Location")).toBe("/");
    expect(relativeRedirect("dashboard").headers.get("Location")).toBe("/");
  });

  it("preserves query strings on same-origin paths", () => {
    expect(
      relativeRedirect("/?auth=required&from=%2Fdashboard").headers.get("Location"),
    ).toBe("/?auth=required&from=%2Fdashboard");
  });
});
