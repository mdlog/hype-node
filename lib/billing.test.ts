import { describe, expect, test } from "vitest";

import { priceForModel, spendFromUsage } from "@/lib/billing";

// The agent reports the model it actually ran (reply.usage.model). When the
// provider is OpenAI, the meter must price at OpenAI rates instead of silently
// falling back to Claude Sonnet — otherwise GPT-4o usage is billed as Claude.
describe("billing prices by the active model", () => {
  test("prices gpt-4o at OpenAI rates, not the Claude fallback", () => {
    expect(priceForModel("gpt-4o")).toEqual({ input: 2.5, output: 10.0 });
  });

  test("spendFromUsage uses gpt-4o rates for gpt-4o usage", () => {
    // 1M input + 1M output at gpt-4o rates = 2.5 + 10.0 = 12.5 (Claude Sonnet
    // fallback would wrongly yield 3 + 15 = 18.0).
    const spend = spendFromUsage("gpt-4o", {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      cache_read_tokens: 0,
      cache_creation_tokens: 0,
    });
    expect(spend).toBeCloseTo(12.5, 6);
  });

  test("prices gpt-4o-mini at OpenAI rates", () => {
    expect(priceForModel("gpt-4o-mini")).toEqual({ input: 0.15, output: 0.6 });
  });

  test("unknown model still falls back to claude-sonnet pricing", () => {
    expect(priceForModel("some-unknown-model")).toEqual(
      priceForModel("claude-sonnet-4-5"),
    );
  });
});
