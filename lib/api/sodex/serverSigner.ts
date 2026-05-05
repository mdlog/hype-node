// Server-side SoDEX signer. Uses SODEX_PRIVATE_KEY (hot key) to sign
// EIP-712 envelopes in the agent autonomous execution path.
//
// Wallet-side equivalent lives in the UI, where wagmi's useSignTypedData
// produces the same signature shape.

import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import {
  EIP712_TYPES,
  type SodexEnv,
} from "./typedData";
import { SodexClient, type SignTypedData } from "./client";

export function makeServerSodexClient(env: SodexEnv): SodexClient {
  const pk = process.env.SODEX_PRIVATE_KEY ?? "";
  // Empty key name = master-wallet auth (matches Go SDK default).
  const apiKeyName = process.env.SODEX_API_KEY_NAME ?? "";
  if (!pk) {
    throw new Error(
      "SODEX_PRIVATE_KEY not set. Server-side SoDEX execute needs a hot key.",
    );
  }
  const account = privateKeyToAccount(
    (pk.startsWith("0x") ? pk : `0x${pk}`) as Hex,
  );
  const signTypedData: SignTypedData = async (args) => {
    return account.signTypedData({
      domain: args.domain,
      types: { ExchangeAction: EIP712_TYPES.ExchangeAction },
      primaryType: args.primaryType,
      message: args.message,
    });
  };
  return new SodexClient({ env, apiKeyName, signTypedData });
}
