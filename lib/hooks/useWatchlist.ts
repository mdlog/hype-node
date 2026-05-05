"use client";

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "hypenode_watchlist";

// Cross-tab sync: same window, different components — fired manually below
// (the `storage` event only fires for *other* tabs, not the originating one).
const EVENT = "hypenode_watchlist:update";

function readStorage(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.filter((x) => typeof x === "string")) : new Set();
  } catch {
    return new Set();
  }
}

function writeStorage(ids: Set<string>) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(ids)));
    window.dispatchEvent(new Event(EVENT));
  } catch {
    /* localStorage might be disabled (private mode, quota); silently degrade */
  }
}

export function useWatchlist() {
  const [ids, setIds] = useState<Set<string>>(() => new Set());

  // Hydrate after mount to avoid SSR mismatch.
  useEffect(() => {
    setIds(readStorage());
    const onUpdate = () => setIds(readStorage());
    window.addEventListener("storage", onUpdate);
    window.addEventListener(EVENT, onUpdate);
    return () => {
      window.removeEventListener("storage", onUpdate);
      window.removeEventListener(EVENT, onUpdate);
    };
  }, []);

  const toggle = useCallback((id: string) => {
    setIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      writeStorage(next);
      return next;
    });
  }, []);

  const has = useCallback((id: string) => ids.has(id), [ids]);

  return { has, toggle, count: ids.size };
}
