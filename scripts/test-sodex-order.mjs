// One-shot SoDEX testnet order — places a BTC-USD limit BUY @ $20k (far from
// market) so it rests safely without filling, then cancels it.
//
// Two key insights from reading the official Go SDK source:
//
//   1. The wire body is the inner `params` JSON only (e.g. NewOrderRequest
//      struct). The `{type, params}` envelope is used ONLY when computing
//      payloadHash — it never goes on the wire.
//
//   2. Required headers: X-API-Sign, X-API-Nonce, X-API-Chain. (X-API-Key
//      only when using a delegated key; omitted = master-wallet auth.)
//
// Pipeline:
//   {type, params} JSON (struct field order) ─keccak256─▶ payloadHash
//   ExchangeAction{payloadHash, nonce} ─EIP-712 sign─▶ 65-byte sig
//   0x01 || sig ─hex─▶ X-API-Sign header
//   wire body = JSON of params (struct field order)
//
// Run:
//   node --env-file=.env scripts/test-sodex-order.mjs

import { keccak256, toBytes, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const ENV = process.env.SODEX_ENV ?? "testnet";
const IS_TESTNET = ENV === "testnet";
const BASE = IS_TESTNET
  ? "https://testnet-gw.sodex.dev/api/v1/perps"
  : "https://mainnet-gw.sodex.dev/api/v1/perps";
const CHAIN_ID = IS_TESTNET ? 138565n : 286623n;
const VERIFYING_CONTRACT = "0x0000000000000000000000000000000000000000";

const PK_RAW = process.env.SODEX_PRIVATE_KEY;
if (!PK_RAW) {
  console.error("SODEX_PRIVATE_KEY not set");
  process.exit(1);
}
const PK = PK_RAW.startsWith("0x") ? PK_RAW : `0x${PK_RAW}`;
const account = privateKeyToAccount(PK);

const ACCOUNT_ID = 53291;       // from /accounts/{addr}/state
const BTC_USD_SYMBOL_ID = 1;

// ── Build JSON in EXACT Go struct field order ────────────────────────────────
// RawOrder fields:  clOrdID, modifier, side, type, timeInForce, [price],
//                   [quantity], [funds]?, [stopPrice]?, ..., reduceOnly,
//                   positionSide
// NewOrderRequest:  accountID, symbolID, orders
function buildNewOrderJson(clOrdID) {
  // We construct an ordered object literal — JS preserves insertion order
  // (ES2015+), and JSON.stringify follows it. Decimals MUST be strings.
  const order = {
    clOrdID,
    modifier: 1,         // Normal
    side: 1,             // Buy
    type: 1,             // Limit
    timeInForce: 1,      // GTC
    price: "20000",      // far below market 76k → won't fill
    quantity: "0.001",
    reduceOnly: false,
    positionSide: 1,     // Both (one-way mode default)
  };
  const params = {
    accountID: ACCOUNT_ID,
    symbolID: BTC_USD_SYMBOL_ID,
    orders: [order],
  };
  return { type: "newOrder", params };
}

function buildCancelJson(symbolID, orderID) {
  return {
    type: "cancelOrder",
    params: {
      accountID: ACCOUNT_ID,
      cancels: [{ symbolID, orderID }],
    },
  };
}

// JSON.stringify with no spaces, preserving insertion order — matches Go
// json.Marshal struct-order output exactly.
function compactJson(v) {
  return JSON.stringify(v);
}

async function signAndSend(action, method = "POST", path = "/trade/orders") {
  // Signed payload is the `{type, params}` envelope — but the wire body is
  // just `action.params` (the inner request struct).
  const signedPayload = compactJson(action);
  const wireBody = compactJson(action.params);
  const payloadHash = keccak256(toBytes(signedPayload));
  const nonce = BigInt(Date.now());

  const rawSig = await account.signTypedData({
    domain: {
      name: "futures",          // perps engine
      version: "1",
      chainId: Number(CHAIN_ID),
      verifyingContract: VERIFYING_CONTRACT,
    },
    types: {
      ExchangeAction: [
        { name: "payloadHash", type: "bytes32" },
        { name: "nonce",       type: "uint64" },
      ],
    },
    primaryType: "ExchangeAction",
    message: { payloadHash, nonce },
  });

  // Normalize the recovery byte: viem returns v ∈ {27,28} (Ethereum convention)
  // but Go's crypto.Sign — and therefore the SoDEX server's recovery — expects
  // v ∈ {0,1} (raw recovery id). Subtract 27 if needed before serializing.
  const r = rawSig.slice(2, 66);
  const s = rawSig.slice(66, 130);
  let v = parseInt(rawSig.slice(130, 132), 16);
  if (v >= 27) v -= 27;
  const sig65 = r + s + v.toString(16).padStart(2, "0");
  // Prepend signature-type byte 0x01 (EIP-712) → 66-byte wire signature.
  const xApiSign = "0x01" + sig65;

  console.log("\n── REQUEST ──");
  console.log("URL:           ", BASE + path);
  console.log("signed payload:", signedPayload);
  console.log("wire body:     ", wireBody);
  console.log("payloadHash:   ", payloadHash);
  console.log("nonce:         ", nonce.toString());
  console.log("signer:        ", account.address);
  console.log("X-API-Sign:    ", xApiSign.slice(0, 30) + "...(" + xApiSign.length + " chars)");

  const res = await fetch(BASE + path, {
    method,
    headers: {
      "X-API-Sign":  xApiSign,
      "X-API-Nonce": nonce.toString(),
      "X-API-Chain": CHAIN_ID.toString(),
      "Content-Type": "application/json",
      "Accept":       "application/json",
    },
    body: wireBody,
  });
  const text = await res.text();
  console.log("\n── RESPONSE ──");
  console.log("status:", res.status, res.statusText);
  console.log("body:  ", text);
  let parsed;
  try { parsed = JSON.parse(text); } catch { /* keep raw */ }
  return { status: res.status, ok: res.ok, body: parsed, raw: text };
}

// ── Run ──────────────────────────────────────────────────────────────────────
const clOrdID = `test-${Date.now()}`;
console.log("=".repeat(70));
console.log("SoDEX order test");
console.log("env:    ", ENV, "chainId:", CHAIN_ID.toString());
console.log("base:   ", BASE);
console.log("address:", account.address);
console.log("clOrdID:", clOrdID);
console.log("=".repeat(70));

const place = await signAndSend(buildNewOrderJson(clOrdID));

if (!place.ok) {
  console.log("\n❌ place failed — see body above");
  process.exit(1);
}

// Parse order id from response (shape may vary).
const orderID =
  place.body?.data?.results?.[0]?.orderID ??
  place.body?.data?.[0]?.orderID ??
  place.body?.data?.orders?.[0]?.orderID ??
  null;

if (!orderID) {
  console.log("\n⚠️ place succeeded but couldn't find orderID in response");
  console.log("response keys:", place.body && Object.keys(place.body.data ?? {}));
  process.exit(0);
}

console.log(`\n✅ placed orderID=${orderID} — waiting 1s, then cancelling…`);
await new Promise((r) => setTimeout(r, 1000));

const cancel = await signAndSend(
  buildCancelJson(BTC_USD_SYMBOL_ID, Number(orderID)),
  "DELETE",
  "/trade/orders",
);
if (cancel.ok) console.log("\n✅ cancel ok");
else console.log("\n❌ cancel failed");
