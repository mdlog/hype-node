import { describe, expect, it } from "vitest";
import { parseUsdcAmount, MIN_DEPOSIT_USDC } from "./usdcAmount";

describe("parseUsdcAmount", () => {
  it("rejects empty / non-numeric", () => {
    expect("error" in parseUsdcAmount("")).toBe(true);
    expect("error" in parseUsdcAmount("abc")).toBe(true);
  });
  it("rejects below the 100 USDC minimum", () => {
    const r = parseUsdcAmount("50");
    expect("error" in r).toBe(true);
  });
  it("accepts 100 and returns 6-decimal bigint", () => {
    const r = parseUsdcAmount("100");
    expect("value" in r && r.value === 100_000000n).toBe(true);
  });
  it("handles fractional up to 6 decimals", () => {
    const r = parseUsdcAmount("123.456789");
    expect("value" in r && r.value === 123_456789n).toBe(true);
  });
  it("rejects more than 6 decimal places", () => {
    expect("error" in parseUsdcAmount("1.1234567")).toBe(true);
  });
  it("exposes MIN_DEPOSIT_USDC = 100", () => {
    expect(MIN_DEPOSIT_USDC).toBe(100);
  });
});
