"use client";

import { useCallback, useEffect, useState } from "react";
import {
  completeStep as applyComplete,
  defaultState,
  dismiss as applyDismiss,
  doneCount,
  FIRST_RUN_EVENT,
  FIRST_RUN_STORAGE_KEY,
  type FirstRunState,
  type FirstRunStepId,
  isAllDone,
  parseState,
} from "./firstRun";

function read(): FirstRunState {
  if (typeof window === "undefined") return defaultState();
  try {
    return parseState(window.localStorage.getItem(FIRST_RUN_STORAGE_KEY));
  } catch {
    return defaultState();
  }
}

function write(next: FirstRunState) {
  try {
    window.localStorage.setItem(FIRST_RUN_STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event(FIRST_RUN_EVENT));
  } catch {
    /* localStorage disabled (private mode / quota) — degrade silently */
  }
}

export function useFirstRun() {
  const [state, setState] = useState<FirstRunState>(() => defaultState());
  const [hydrated, setHydrated] = useState(false);

  // Hydrate after mount to avoid SSR/client mismatch (same pattern as useWatchlist).
  useEffect(() => {
    setState(read());
    setHydrated(true);
    const onUpdate = () => setState(read());
    window.addEventListener("storage", onUpdate);
    window.addEventListener(FIRST_RUN_EVENT, onUpdate);
    return () => {
      window.removeEventListener("storage", onUpdate);
      window.removeEventListener(FIRST_RUN_EVENT, onUpdate);
    };
  }, []);

  const completeStep = useCallback((id: FirstRunStepId) => {
    setState((prev) => {
      const next = applyComplete(prev, id);
      if (next !== prev) write(next);
      return next;
    });
  }, []);

  const dismiss = useCallback(() => {
    setState((prev) => {
      const next = applyDismiss(prev);
      if (next !== prev) write(next);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setState(() => {
      const next = defaultState();
      write(next);
      return next;
    });
  }, []);

  const isDone = useCallback((id: FirstRunStepId) => state.steps[id], [state]);

  return {
    hydrated,
    dismissed: state.dismissed,
    steps: state.steps,
    isDone,
    completeStep,
    dismiss,
    reset,
    allDone: isAllDone(state),
    doneCount: doneCount(state),
  };
}
