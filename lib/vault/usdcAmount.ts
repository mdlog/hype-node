export const USDC_DECIMALS = 6;
export const MIN_DEPOSIT_USDC = 100;

export type ParsedUsdc = { value: bigint } | { error: string };

export function parseUsdcAmount(input: string): ParsedUsdc {
  const trimmed = (input ?? "").trim();
  if (!trimmed) return { error: "Enter an amount" };
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return { error: "Invalid number" };
  const [whole, frac = ""] = trimmed.split(".");
  if (frac.length > USDC_DECIMALS) return { error: `Max ${USDC_DECIMALS} decimals` };
  const padded = (frac + "0".repeat(USDC_DECIMALS)).slice(0, USDC_DECIMALS);
  const value = BigInt(whole) * 10n ** BigInt(USDC_DECIMALS) + BigInt(padded || "0");
  if (value < BigInt(MIN_DEPOSIT_USDC) * 10n ** BigInt(USDC_DECIMALS)) {
    return { error: `Minimum deposit is ${MIN_DEPOSIT_USDC} USDC` };
  }
  return { value };
}
