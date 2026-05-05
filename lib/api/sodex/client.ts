// SoDEX REST client with EIP-712 signing.
//
// Two signing paths:
//   1. server-side hot-key flow (autonomous agent, server actions): pass
//      `signMessage` from a viem privateKey account.
//   2. browser wallet flow (manual user trade UI): pass
//      `signTypedDataAsync` from wagmi `useSignTypedData`.

import {
  buildSignedEnvelope,
  authHeaders,
  withSignaturePrefix,
  SODEX_REST,
  SODEX_CHAIN_IDS,
  EIP712_TYPES,
  type ExchangeAction,
  type SodexEnv,
  type SodexProduct,
} from "./typedData";
import type { Hex } from "viem";

const CHAIN_ID_FOR: Record<SodexEnv, number> = {
  mainnet: SODEX_CHAIN_IDS.mainnet,
  testnet: SODEX_CHAIN_IDS.testnet,
};

export type SignTypedData = (args: {
  domain: {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: `0x${string}`;
  };
  types: typeof EIP712_TYPES;
  primaryType: "ExchangeAction";
  message: { payloadHash: Hex; nonce: bigint };
}) => Promise<Hex>;

export type SodexClientOpts = {
  env: SodexEnv;
  apiKeyName: string;
  signTypedData: SignTypedData;
};

export class SodexClient {
  constructor(private readonly opts: SodexClientOpts) {}

  private base(product: SodexProduct): string {
    return product === "spot"
      ? SODEX_REST[this.opts.env].spot
      : SODEX_REST[this.opts.env].perps;
  }

  /** Sign + POST an action. Returns the parsed JSON response. */
  async send<T>(
    product: SodexProduct,
    path: string,
    action: ExchangeAction,
    init?: { method?: "POST" | "DELETE" },
  ): Promise<T> {
    const envelope = buildSignedEnvelope(product, this.opts.env, action);
    const rawSig = await this.opts.signTypedData({
      domain: envelope.domain,
      types: { ...EIP712_TYPES },
      primaryType: envelope.primaryType,
      message: envelope.message,
    });
    const signature = withSignaturePrefix(rawSig);
    const headers = authHeaders(
      this.opts.apiKeyName,
      signature,
      envelope.nonce,
      CHAIN_ID_FOR[this.opts.env],
    );
    const url = this.base(product) + path;
    const res = await fetch(url, {
      method: init?.method ?? "POST",
      headers,
      body: envelope.wireBody,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`SoDEX ${res.status} ${res.statusText}: ${text}`);
    }
    return (await res.json()) as T;
  }

  // Convenience wrappers — extend as needed against the published REST spec.
  newSpotOrder<T>(params: Record<string, unknown>) {
    return this.send<T>("spot", "/trade/orders/batch", {
      type: "newOrder",
      params,
    });
  }
  cancelSpotOrder<T>(params: Record<string, unknown>) {
    return this.send<T>("spot", "/trade/orders/batch", {
      type: "cancelOrder",
      params,
    }, { method: "DELETE" });
  }
  newPerpsOrder<T>(params: Record<string, unknown>) {
    return this.send<T>("perps", "/trade/orders", {
      type: "newOrder",
      params,
    });
  }
  cancelPerpsOrder<T>(params: Record<string, unknown>) {
    return this.send<T>("perps", "/trade/orders", {
      type: "cancelOrder",
      params,
    }, { method: "DELETE" });
  }
  transfer<T>(product: SodexProduct, params: Record<string, unknown>) {
    return this.send<T>(product, "/accounts/transfers", {
      type: "transferAsset",
      params,
    });
  }
}

/** Read-only helper — public market data endpoints don't need signing. */
export async function sodexGet<T>(
  env: SodexEnv,
  product: SodexProduct,
  path: string,
): Promise<T> {
  const base = product === "spot" ? SODEX_REST[env].spot : SODEX_REST[env].perps;
  const res = await fetch(base + path);
  if (!res.ok) {
    throw new Error(`SoDEX ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

export { SODEX_CHAIN_IDS, SODEX_REST };
