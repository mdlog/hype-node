// SoDEX REST v1 client.
//
// Mainnet (chainId 286623): https://mainnet-gw.sodex.dev/api/v1
// Testnet (chainId 138565): https://testnet-gw.sodex.dev/api/v1
// Subdomains: `/spot`, `/perps` are routed via the same gateway.
//
// Auth model: read-only market endpoints are public. Trade actions
// (place / cancel / replace order, transfer, leverage, margin) must be
// EIP-712 signed against the SoDEX exchange domain.
//
// Domain template:
//   {
//     name: "spot" | "futures",
//     version: "1",
//     chainId: 286623 (mainnet) | 138565 (testnet),
//     verifyingContract: "0x0000000000000000000000000000000000000000"
//   }
//
// ExchangeAction message:
//   { payloadHash: bytes32 = keccak256(json.Marshal({type, params})), nonce: uint64 }
//
// The signature is byte `0x01` || ECDSA(domainSeparator, message). That single
// byte prefix tells the gateway this is an EIP-712 signed action.
//
// This stub focuses on read endpoints + a placeholder `placeOrder` so the UI
// has something to call. Real signing requires a wallet (viem / ethers); plug
// it in when you wire up actual key custody.

const ENV = (process.env.SODEX_ENV ?? "mainnet").toLowerCase();
const SPOT_BASE =
  process.env.SODEX_SPOT_BASE ??
  (ENV === "testnet"
    ? "https://testnet-gw.sodex.dev/api/v1/spot"
    : "https://mainnet-gw.sodex.dev/api/v1/spot");
const PERPS_BASE =
  process.env.SODEX_PERPS_BASE ??
  (ENV === "testnet"
    ? "https://testnet-gw.sodex.dev/api/v1/perps"
    : "https://mainnet-gw.sodex.dev/api/v1/perps");

export const SODEX_CHAIN_ID = ENV === "testnet" ? 138565 : 286623;
export const SODEX_VERIFYING_CONTRACT = "0x0000000000000000000000000000000000000000";

export type SodexEnvelope<T> = {
  code: number;
  timestamp: number;
  data?: T;
  error?: string;
};

export type Ticker = {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  volume: string;
  high: string;
  low: string;
};

export type OrderBook = {
  symbol: string;
  bids: [string, string][];
  asks: [string, string][];
  ts: number;
};

export type Kline = [number, string, string, string, string, string];

export type TradeOrder = {
  symbolIn: string;
  symbolOut: string;
  amountIn: number;
  slippageBps?: number;
};

export type TradeResult = {
  txHash: string;
  filled: boolean;
  amountOut: number;
  slippageBps: number;
  gasVal: number;
  latencyMs: number;
  signedPayload?: string;
};

function fakeTx(): string {
  return "0x" + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}

async function get<T>(base: string, path: string, fallback: () => T): Promise<T> {
  try {
    const res = await fetch(`${base}${path}`, { next: { revalidate: 5 } });
    if (!res.ok) throw new Error(`${path} ${res.status}`);
    const env = (await res.json()) as SodexEnvelope<T>;
    if (env.error || env.data === undefined) throw new Error(env.error ?? "no data");
    return env.data;
  } catch (err) {
    console.warn("[sodex] falling back to synthetic data:", (err as Error).message);
    return fallback();
  }
}

// ---------- read-only spot endpoints ----------

export async function getSpotTicker(symbol: string): Promise<Ticker> {
  return get<Ticker>(SPOT_BASE, `/markets/tickers?symbol=${encodeURIComponent(symbol)}`, () => ({
    symbol,
    lastPrice: "1.182",
    priceChangePercent: "5.24",
    volume: "1284820",
    high: "1.21",
    low: "1.11",
  }));
}

export async function getSpotOrderBook(symbol: string, limit = 20): Promise<OrderBook> {
  return get<OrderBook>(SPOT_BASE, `/markets/${encodeURIComponent(symbol)}/orderbook?limit=${limit}`, () => ({
    symbol,
    bids: Array.from({ length: 10 }, (_, i) => [
      (1.18 - i * 0.0005).toFixed(4),
      (100 + i * 12).toFixed(2),
    ]) as [string, string][],
    asks: Array.from({ length: 10 }, (_, i) => [
      (1.18 + (i + 1) * 0.0005).toFixed(4),
      (100 + i * 14).toFixed(2),
    ]) as [string, string][],
    ts: Date.now(),
  }));
}

export async function getSpotKlines(
  symbol: string,
  opts: { interval?: "1m" | "5m" | "1h" | "4h" | "1d"; limit?: number } = {},
): Promise<Kline[]> {
  const sp = new URLSearchParams();
  sp.set("interval", opts.interval ?? "1h");
  sp.set("limit", String(opts.limit ?? 60));
  return get<Kline[]>(SPOT_BASE, `/markets/${encodeURIComponent(symbol)}/klines?${sp}`, () => {
    const now = Date.now();
    return Array.from({ length: 60 }, (_, i) => {
      const t = now - (59 - i) * 3_600_000;
      const base = 1.1 + Math.sin(i / 6) * 0.05 + i * 0.001;
      return [
        t,
        base.toFixed(4),
        (base + 0.005).toFixed(4),
        (base - 0.005).toFixed(4),
        (base + (Math.random() - 0.5) * 0.01).toFixed(4),
        (1000 + Math.random() * 1000).toFixed(2),
      ] satisfies Kline;
    });
  });
}

export async function getSpotBalances(userAddress: string, accountId?: string) {
  const sp = new URLSearchParams();
  if (accountId) sp.set("accountID", accountId);
  return get(
    SPOT_BASE,
    `/accounts/${userAddress}/balances?${sp}`,
    () => ({
      userAddress,
      balances: [
        { coin: "USDC", available: "1248.40", locked: "0" },
        { coin: "VAL", available: "12.4", locked: "0" },
      ],
    }),
  );
}

// ---------- trade execution ----------

export type Eip712TypedData = {
  types: {
    EIP712Domain: { name: string; type: string }[];
    ExchangeAction: { name: string; type: string }[];
  };
  domain: {
    name: "spot" | "futures";
    version: "1";
    chainId: number;
    verifyingContract: string;
  };
  primaryType: "ExchangeAction";
  message: {
    payloadHash: string;
    nonce: number;
  };
};

/**
 * Build the EIP-712 typed data for a SoDEX exchange action. Hand the result to
 * a wallet (viem `signTypedData`, ethers v6 `signTypedData`, or window.ethereum
 * `eth_signTypedData_v4`) and prefix the signature with `0x01` before posting.
 */
export function buildExchangeAction(
  domainName: "spot" | "futures",
  payload: { type: string; params: Record<string, unknown> },
  nonce = Date.now(),
): { typedData: Eip712TypedData; payloadJson: string; nonce: number } {
  const payloadJson = JSON.stringify(payload);
  // Real `payloadHash` is keccak256(payloadJson) — your wallet/keccak lib
  // computes that. Returned here as a placeholder so the function stays
  // dependency-free in the build.
  const payloadHash = "0x" + "0".repeat(64);
  return {
    typedData: {
      types: {
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
      },
      domain: {
        name: domainName,
        version: "1",
        chainId: SODEX_CHAIN_ID,
        verifyingContract: SODEX_VERIFYING_CONTRACT,
      },
      primaryType: "ExchangeAction",
      message: { payloadHash, nonce },
    },
    payloadJson,
    nonce,
  };
}

export async function executeTrade(order: TradeOrder): Promise<TradeResult> {
  // Without a wallet hooked up we still want the agent loop to round-trip,
  // so we synthesize a fill. The payload below is exactly what should be
  // signed and POSTed to /trade/orders/batch when keys are wired in.
  const action = buildExchangeAction("spot", {
    type: "newOrder",
    params: {
      symbol: `${order.symbolIn}_${order.symbolOut}`,
      side: "BUY",
      type: "MARKET",
      quantity: order.amountIn.toString(),
      slippageBps: order.slippageBps ?? 25,
    },
  });
  // TODO: when SODEX_PRIVATE_KEY is set, sign action.typedData with viem +
  // POST { signature: "0x01" + sig, payload: action.payloadJson, nonce } to
  // `${SPOT_BASE}/trade/orders/batch`.
  return {
    txHash: fakeTx(),
    filled: true,
    amountOut: order.amountIn * (1 - (order.slippageBps ?? 25) / 10_000),
    slippageBps: order.slippageBps ?? 25,
    gasVal: 0.012 + Math.random() * 0.02,
    latencyMs: 4_200 + Math.random() * 800,
    signedPayload: action.payloadJson,
  };
}
