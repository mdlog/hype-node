import { describe, expect, it } from "vitest";
import {
  completeStep,
  defaultState,
  dismiss,
  doneCount,
  isAllDone,
  parseState,
} from "./firstRun";

describe("firstRun pure logic", () => {
  it("defaults to all-incomplete and not dismissed", () => {
    const s = defaultState();
    expect(s.dismissed).toBe(false);
    expect(doneCount(s)).toBe(0);
    expect(isAllDone(s)).toBe(false);
  });

  it("completeStep flips exactly one step and is idempotent (same reference)", () => {
    const s = completeStep(defaultState(), "chat");
    expect(s.steps.chat).toBe(true);
    expect(s.steps.createIndex).toBe(false);
    expect(doneCount(s)).toBe(1);
    expect(completeStep(s, "chat")).toBe(s);
  });

  it("isAllDone is true only when all three steps done", () => {
    let s = defaultState();
    expect(isAllDone(s)).toBe(false);
    for (const id of ["createIndex", "chat", "monitor"] as const) {
      s = completeStep(s, id);
    }
    expect(isAllDone(s)).toBe(true);
    expect(doneCount(s)).toBe(3);
  });

  it("dismiss sets the dismissed flag", () => {
    expect(dismiss(defaultState()).dismissed).toBe(true);
  });

  it("dismiss is idempotent (same reference when already dismissed)", () => {
    const s = dismiss(defaultState());
    expect(dismiss(s)).toBe(s);
  });

  it("parseState falls back to default on null or malformed JSON", () => {
    expect(parseState(null)).toEqual(defaultState());
    expect(parseState("{not valid json")).toEqual(defaultState());
  });

  it("parseState coerces partial/garbage shapes to booleans", () => {
    const s = parseState(JSON.stringify({ steps: { chat: 1 }, dismissed: "yes" }));
    expect(s.steps.chat).toBe(true);
    expect(s.steps.createIndex).toBe(false);
    expect(s.dismissed).toBe(false);
  });
});
