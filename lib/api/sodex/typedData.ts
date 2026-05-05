// EIP-712 typed-data builders for SoDEX.
//
// SoDEX wraps every signed action in a constant `ExchangeAction` envelope:
//
//     domain  = { name: "spot"|"futures", version: "1", chainId, verifyingContract: 0x0 }
//     message = { payloadHash: keccak256(canonical-json(action)), nonce: ms-timestamp }
//
// The action body itself (e.g. `{ type: "newOrder", params: {...} }`) is sent
// as the REST request body. The server recomputes payloadHash from the body
// and validates it against the recovered signer.

import { keccak256, toBytes, type Hex } from "viem";

export const SODEX_VERIFYING_CONTRACT =
  "0x0000000000000000000000000000000000000000" as const;

export type SodexEnv = "mainnet" | "testnet";

export const SODEX_CHAIN_IDS: Record<SodexEnv, number> = {
  mainnet: 286623,
  testnet: 138565,
};

export const SODEX_REST: Record<
  SodexEnv,
  { spot: string; perps: string; wsSpot: string; wsPerps: string }
> = {
  mainnet: {
    spot: "https://mainnet-gw.sodex.dev/api/v1/spot",
    perps: "https://mainnet-gw.sodex.dev/api/v1/perps",
    wsSpot: "wss://mainnet-gw.sodex.dev/ws/spot",
    wsPerps: "wss://mainnet-gw.sodex.dev/ws/perps",
  },
  testnet: {
    spot: "https://testnet-gw.sodex.dev/api/v1/spot",
    perps: "https://testnet-gw.sodex.dev/api/v1/perps",
    wsSpot: "wss://testnet-gw.sodex.dev/ws/spot",
    wsPerps: "wss://testnet-gw.sodex.dev/ws/perps",
  },
};

// REST routing key — what path the request goes to.
export type SodexProduct = "spot" | "perps";
// EIP-712 domain `name` field — perps uses the literal string "futures" per spec.
export type SodexDomainName = "spot" | "futures";

export function domainNameFor(product: SodexProduct): SodexDomainName {
  return product === "spot" ? "spot" : "futures";
}

export const EIP712_TYPES = {
  EIP712Domain: [
    { name: "name", type: "string" },
    { name: "version", type: "string" },
    { name: "chainId", type: "uint256" },
    { name: "verifyingContract", type: "address" },
  ],
  ExchangeAction: [
    { name: "payloadHash", type: "bytes32" },
    { name: "nonce", type: "uint64" },
  ],
} as const;

export function sodexDomain(name: SodexDomainName, env: SodexEnv) {
  return {
    name,
    version: "1",
    chainId: SODEX_CHAIN_IDS[env],
    verifyingContract: SODEX_VERIFYING_CONTRACT as `0x${string}`,
  } as const;
}

// Canonical JSON: compact (no whitespace), preserves the caller's key
// insertion order. The SoDEX server reproduces payloadHash by re-marshalling
// the request struct via Go's json.Marshal, which serializes in struct field
// declaration order. So callers MUST construct objects in the matching order
// for each action type — see new_order_request.go etc. in the Go SDK.
//
// Decimal fields (price, quantity, funds, stopPrice) MUST be JSON strings,
// not numbers, because the Go structs use string-typed decimal fields.
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value);
}

export function payloadHashOf(action: unknown): Hex {
  return keccak256(toBytes(canonicalJson(action)));
}

export type ExchangeAction = {
  type: string;
  params: Record<string, unknown>;
};

export type SignedRequest = {
  body: string;
  headers: Record<string, string>;
};

// Build the typed-data envelope a wallet should sign. Used by both the
// browser (viem `walletClient.signTypedData` / wagmi) and the server signer.
export function buildSignedEnvelope(
  product: SodexProduct,
  env: SodexEnv,
  action: ExchangeAction,
  nonce?: bigint,
) {
  const n = nonce ?? BigInt(Date.now());
  // payloadHash commits to the FULL `{type, params}` envelope JSON.
  const signedPayload = canonicalJson(action);
  const hash = keccak256(toBytes(signedPayload));
  // The wire body is just `params` — the server reconstructs the envelope
  // by combining the URL-implied action type with the body.
  const wireBody = canonicalJson(action.params);
  return {
    domain: sodexDomain(domainNameFor(product), env),
    types: { ExchangeAction: EIP712_TYPES.ExchangeAction },
    primaryType: "ExchangeAction" as const,
    message: { payloadHash: hash, nonce: n },
    signedPayload,
    wireBody,
    nonce: n,
  };
}

// SoDEX wire signature is 66 bytes: 0x01 type tag || 65-byte ECDSA sig.
// Two transforms required on viem's signature output:
//   1. Normalize the v-byte from Ethereum's {27,28} convention to Go's
//      raw recovery id {0,1}. The server's signer-recovery rejects 27/28.
//   2. Prepend the signature-type byte 0x01 (EIP-712 in SoDEX's enum).
export function withSignaturePrefix(rawSig: Hex): Hex {
  if (!rawSig.startsWith("0x")) throw new Error("expected 0x-prefixed hex");
  if (rawSig.length !== 132) {
    throw new Error(`expected 65-byte hex sig (132 chars), got ${rawSig.length}`);
  }
  const r = rawSig.slice(2, 66);
  const s = rawSig.slice(66, 130);
  let v = parseInt(rawSig.slice(130, 132), 16);
  if (v >= 27) v -= 27;
  return ("0x01" + r + s + v.toString(16).padStart(2, "0")) as Hex;
}

export function authHeaders(
  apiKeyName: string,
  signature: Hex,
  nonce: bigint,
  chainId: number,
): Record<string, string> {
  // Per SoDEX Go SDK: empty APIKeyName == master-wallet auth (no X-API-Key
  // header). X-API-Chain is required even though chainId is already in the
  // EIP-712 domain — the server uses it to route to the correct verifier.
  const headers: Record<string, string> = {
    "X-API-Sign": signature,
    "X-API-Nonce": nonce.toString(),
    "X-API-Chain": String(chainId),
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (apiKeyName) headers["X-API-Key"] = apiKeyName;
  return headers;
}
