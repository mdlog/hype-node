import { DynamicServerError } from "next/dist/client/components/hooks-server-context";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Regression guard for "menus hang 16–66 s while SoSoValue stalls": a fetch
// that timed out (after its one retry) set no backoff, so every following
// cold request — the rest of the render's sequential waves, and every render
// after it — waited out 2 × FETCH_TIMEOUT_MS again. Seen in production: the
// dashboard took 66 s during an intermittent upstream stall.

type Transport = typeof import("@/lib/api/sosovalue");

const timeoutError = () =>
  new DOMException("The operation was aborted due to timeout", "TimeoutError");

const jsonResponse = (body: unknown, status = 200) => () =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

// The transport keeps its rate/backoff state on globalThis and reads the key
// at import, so each test gets a fresh module + state.
async function loadTransport(env: Record<string, string> = {}): Promise<Transport> {
  const g = globalThis as { __sosoState?: unknown; __sosoStateVersion?: unknown };
  delete g.__sosoState;
  delete g.__sosoStateVersion;
  vi.resetModules();
  vi.stubEnv("SOSOVALUE_API_KEY", "test-key");
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  return import("@/lib/api/sosovalue");
}

describe("SoSoValue transport — upstream unreachable", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("serves fallback for the next cold path without touching the network after a timeout", async () => {
    fetchMock.mockImplementation(() => Promise.reject(timeoutError()));
    const { request } = await loadTransport();

    expect(await request("/indices", () => ["fallback-a"])).toEqual(["fallback-a"]);
    expect(fetchMock).toHaveBeenCalledTimes(2); // first attempt + its one retry

    expect(await request("/macro/events", () => ["fallback-b"])).toEqual(["fallback-b"]);
    expect(fetchMock).toHaveBeenCalledTimes(2); // backed off — no new network call
  });

  it("backs off when the response stalls mid-body, not just before headers", async () => {
    // Headers arrive, then the body stream dies on the fetch timeout — what a
    // stall during a large payload (e.g. the 3.8 MB /crypto-stocks list) does.
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            pull(controller) {
              controller.error(timeoutError());
            },
          }),
        ),
      ),
    );
    const { request } = await loadTransport();

    await request("/crypto-stocks", () => []);
    expect(await request("/macro/events", () => ["fallback"])).toEqual(["fallback"]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reaches upstream again once the backoff window has passed", async () => {
    fetchMock.mockImplementation(() => Promise.reject(timeoutError()));
    const { request } = await loadTransport({ SOSOVALUE_TRANSPORT_BACKOFF_MS: "50" });

    await request("/indices", () => []);
    await new Promise((r) => setTimeout(r, 80));
    fetchMock.mockImplementation(jsonResponse({ code: 0, data: ["live"] }));

    expect(await request("/macro/events", () => ["fallback"])).toEqual(["live"]);
  });

  it("hands Next's dynamic-usage signal back untouched — no retry, log, or backoff", async () => {
    // During `next build`, Next's patched fetch throws DynamicServerError for a
    // no-store request to mark the route dynamic. That is control flow, not an
    // outage: treating it as one logged a false UPSTREAM UNREACHABLE per route.
    const dynamicUsage = new DynamicServerError(
      "no-store fetch https://openapi.sosovalue.com/openapi/v1/indices /backtest",
    );
    fetchMock.mockImplementationOnce(() => Promise.reject(dynamicUsage));
    const { request } = await loadTransport();

    await expect(request("/indices", () => [])).rejects.toBe(dynamicUsage);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(console.warn).not.toHaveBeenCalled();

    fetchMock.mockImplementation(jsonResponse({ code: 0, data: ["live"] }));
    expect(await request("/macro/events", () => ["fallback"])).toEqual(["live"]);
  });

  it("does not back off globally on an HTTP 404 — other paths still reach upstream", async () => {
    fetchMock.mockImplementation(jsonResponse({ code: 404, message: "not found" }, 404));
    const { request } = await loadTransport();

    await request("/indices/nope/constituents", () => []);
    await request("/macro/events", () => []);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
