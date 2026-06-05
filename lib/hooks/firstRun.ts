// Pure onboarding ("first run") state — no React, no DOM, so it is unit
// testable in a plain node environment. The React/localStorage wrapper
// lives in useFirstRun.ts.

export type FirstRunStepId = "createIndex" | "chat" | "monitor";

export type FirstRunState = {
  dismissed: boolean;
  steps: Record<FirstRunStepId, boolean>;
};

export const FIRST_RUN_STORAGE_KEY = "hypenode_firstrun";
// Same-tab sync: the native `storage` event only fires in *other* tabs, so we
// dispatch this custom event after every write (mirrors useWatchlist).
export const FIRST_RUN_EVENT = "hypenode_firstrun:update";
export const STEP_IDS: FirstRunStepId[] = ["createIndex", "chat", "monitor"];

export function defaultState(): FirstRunState {
  return {
    dismissed: false,
    steps: { createIndex: false, chat: false, monitor: false },
  };
}

export function parseState(raw: string | null): FirstRunState {
  if (!raw) return defaultState();
  try {
    const p = JSON.parse(raw) as Partial<{
      dismissed: unknown;
      steps: Partial<Record<FirstRunStepId, unknown>>;
    }>;
    return {
      dismissed: p?.dismissed === true,
      steps: {
        createIndex: !!p?.steps?.createIndex,
        chat: !!p?.steps?.chat,
        monitor: !!p?.steps?.monitor,
      },
    };
  } catch {
    return defaultState();
  }
}

export function completeStep(state: FirstRunState, id: FirstRunStepId): FirstRunState {
  if (state.steps[id]) return state; // idempotent — return same reference
  return { ...state, steps: { ...state.steps, [id]: true } };
}

export function dismiss(state: FirstRunState): FirstRunState {
  if (state.dismissed) return state;
  return { ...state, dismissed: true };
}

export function doneCount(state: FirstRunState): number {
  return STEP_IDS.filter((id) => state.steps[id]).length;
}

export function isAllDone(state: FirstRunState): boolean {
  return STEP_IDS.every((id) => state.steps[id]);
}
