"use client";

// Reusable polling hook for "feels-realtime" multi-device sync.
//
// We intentionally avoid Supabase Realtime — RLS is service-role-only on this
// project, so a WebSocket relay would need its own auth layer plus per-row
// fan-out logic. Polling against the same REST endpoints the page already
// uses keeps the data path identical and lets the server stay stateless.
//
// Rules of the road:
//   - On mount: fetch immediately. Show `loading` only on this first call —
//     background refetches keep the previous `data` so the UI doesn't flash.
//   - Set up `setInterval(refetch, intervalMs)` after the first fetch lands
//     (we don't want overlapping fires while the initial request is still in
//     flight on a slow network).
//   - When `document.hidden` flips true: clear the interval entirely. When it
//     flips back to visible: fire one immediate refetch + restart the
//     interval. This is the whole point — the laptop sleeps, you grab your
//     phone, the phone wakes and sees fresh data without waiting 15s.
//   - `url === null` is a no-op. Lets callers gate the hook on auth state
//     (e.g. only poll once we know we have a session) without conditional
//     `useEffect` calls violating Rules of Hooks.
//   - Each fetch carries its own AbortController; if the URL changes, the
//     interval fires again, or the component unmounts, the in-flight request
//     is aborted. Critically we ignore `AbortError` so a manual `refetch()`
//     racing the interval doesn't get logged as an error.
//   - `refetch()` is exposed so callers can re-sync immediately after a POST
//     (save backtest, send chat message, take snapshot). This avoids a
//     full-interval delay before the local list catches up to what the user
//     just did.

import { useCallback, useEffect, useRef, useState } from "react";

import { useTabActivity } from "./useTabActivity";

export type UseAutoRefetchOptions<T> = {
  intervalMs?: number;
  pauseWhenHidden?: boolean;
  initialData?: T;
  fetcher?: (url: string, signal: AbortSignal) => Promise<T>;
};

export type UseAutoRefetchResult<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  lastFetchedAt: number | null;
};

async function defaultFetcher<T>(url: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, { cache: "no-store", signal });
  if (!res.ok) {
    // Pull error body once — some endpoints return JSON, some return text.
    let detail = "";
    try {
      const body = (await res.json()) as { error?: string };
      if (body && typeof body.error === "string") detail = body.error;
    } catch {
      /* not JSON; HTTP status alone is fine */
    }
    throw new Error(detail || `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export function useAutoRefetch<T>(
  url: string | null,
  options: UseAutoRefetchOptions<T> = {},
): UseAutoRefetchResult<T> {
  const {
    intervalMs = 15_000,
    pauseWhenHidden = true,
    initialData,
    fetcher,
  } = options;

  const [data, setData] = useState<T | null>(initialData ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);

  // Track whether the *initial* fetch for the current URL has completed so we
  // know to suppress the spinner on subsequent background polls. Stored in a
  // ref because the interval callback closes over its create-time value.
  const initialDoneRef = useRef(false);
  // Latest AbortController so we can cancel inflight on URL change / unmount /
  // before firing a new request.
  const controllerRef = useRef<AbortController | null>(null);
  // Pin the latest fetcher in a ref so callers passing inline functions don't
  // force a refetch loop just because the function identity changed.
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  }, [fetcher]);

  const { hidden } = useTabActivity();

  const refetch = useCallback(async () => {
    if (!url) return;
    // Cancel any in-flight request before starting a new one. We don't care
    // about the result of the prior call any more.
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    if (!initialDoneRef.current) setLoading(true);
    try {
      const fn = fetcherRef.current ?? defaultFetcher;
      const next = await fn(url, controller.signal);
      // Guard against a stale request resolving after we've already moved on
      // (URL change / unmount). The newer fetch will have replaced the
      // controller, so signal.aborted is true here.
      if (controller.signal.aborted) return;
      setData(next);
      setError(null);
      setLastFetchedAt(Date.now());
    } catch (err) {
      // AbortError is expected during refetch races; swallow it. Anything
      // else propagates so the caller can surface it.
      if (err instanceof DOMException && err.name === "AbortError") return;
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : "network error");
    } finally {
      if (!controller.signal.aborted) {
        initialDoneRef.current = true;
        setLoading(false);
      }
    }
  }, [url]);

  // Reset "initial fetch done" tracker whenever the URL changes so the next
  // call shows the loading state again (different resource, different UX).
  useEffect(() => {
    initialDoneRef.current = false;
    if (url === null) {
      // Caller toggled the hook off — clear stale data so we don't show an
      // ex-user's content after sign-out.
      setData(initialData ?? null);
      setError(null);
      setLastFetchedAt(null);
    }
    // initialData intentionally not in deps — we only want to reset on URL
    // changes, not on caller re-renders that pass a fresh initial object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  // Initial fetch + interval. Re-runs when url, intervalMs, pauseWhenHidden,
  // or hidden flips. When pauseWhenHidden is true and the tab is hidden, we
  // skip the entire setup so no timers fire in background tabs (better for
  // battery + avoids thundering-herd refetches when many tabs wake at once).
  useEffect(() => {
    if (!url) return;
    if (pauseWhenHidden && hidden) return;
    // Fire-and-forget — refetch internally handles abort + state.
    void refetch();
    const id = window.setInterval(() => {
      void refetch();
    }, intervalMs);
    return () => {
      window.clearInterval(id);
      controllerRef.current?.abort();
    };
  }, [url, intervalMs, pauseWhenHidden, hidden, refetch]);

  return { data, loading, error, refetch, lastFetchedAt };
}

/**
 * Format a `lastFetchedAt` epoch ms (or null) as a short "synced Xs/m/h ago"
 * label. While `loading` is true and we don't yet have a timestamp, returns
 * "syncing…". Returns "—" when never fetched and not loading. Pure function
 * so it can be called directly from a render path; pair with a 1Hz tick if
 * you want the label to refresh visually between polls.
 */
export function formatSyncLabel(
  lastFetchedAt: number | null,
  loading: boolean,
): string {
  if (loading && lastFetchedAt === null) return "syncing…";
  if (lastFetchedAt === null) return "—";
  const ageMs = Date.now() - lastFetchedAt;
  if (ageMs < 5_000) return loading ? "syncing…" : "synced just now";
  const sec = Math.floor(ageMs / 1000);
  if (sec < 60) return `synced ${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `synced ${min}m ago`;
  const hr = Math.floor(min / 60);
  return `synced ${hr}h ago`;
}
