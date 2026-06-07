import { describe, expect, it } from "vitest";

import { keeperSecretValid } from "./keeperPolicy";

describe("keeperSecretValid", () => {
  it("is false when no secret is configured (path disabled)", () => {
    expect(keeperSecretValid("anything", undefined)).toBe(false);
    expect(keeperSecretValid("anything", "")).toBe(false);
  });
  it("is false when no/blank header provided", () => {
    expect(keeperSecretValid(null, "s3cret")).toBe(false);
    expect(keeperSecretValid(undefined, "s3cret")).toBe(false);
    expect(keeperSecretValid("", "s3cret")).toBe(false);
  });
  it("is false on mismatch", () => {
    expect(keeperSecretValid("nope", "s3cret")).toBe(false);
  });
  it("is true on exact match", () => {
    expect(keeperSecretValid("s3cret", "s3cret")).toBe(true);
  });
});
