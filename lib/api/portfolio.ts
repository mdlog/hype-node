// User portfolio aggregation — combines on-chain SSI Registry data with
// SoDEX spot balances into a single view per address.
//
// Three data sources merged:
//   1. SSIRegistry contract (Sepolia by default) → indices the user has
//      published. Read by iterating indexCount/indexIdAt/getIndex and
//      filtering by `creator == userAddress`. We use sequential reads
//      instead of getLogs because public RPC providers commonly rate-limit
//      or refuse open-ended event queries; index counts are bounded so
//      the linear scan is fine for N < ~500.
//   2. SoDEX REST `/spot/accounts/{addr}/balances` → user's spot balances
//      across all assets. Read endpoint, no auth required (public per the
//      sodex.com docs rate-limits page).
//   3. (Future) per-asset USD pricing via SoSoValue snapshot. Deferred to
//      v2 — adds 1 quota call per holding which we don't want during
//      testing.

import { http, createPublicClient, type Address, type Hex } from "viem";
import { mainnet, sepolia } from "viem/chains";
import { valueChainMainnet, valueChainTestnet } from "@/lib/chains";
import { SSI_REGISTRY_ABI } from "@/lib/contracts/ssiRegistryAbi";

// Use the SSI_* env (server-side) for the registry chain. Sepolia is the
// default deployment target — see contracts/SSIRegistry.sol README.
const REGISTRY = (process.env.SSI_REGISTRY_ADDRESS ?? "") as Address | "";
const RPC = process.env.SSI_RPC_URL ?? "";
const CHAIN_ID = Number(process.env.SSI_CHAIN_ID ?? sepolia.id);

// Hard cap on how many on-chain indices we scan per portfolio request so a
// future explosion in `_indexIds` length can't time out the route. 500 is
// an order of magnitude above any realistic index count for v1.
const MAX_REGISTRY_SCAN = 500;

// SoDEX REST endpoint. Uses the same env switch as agent-service so
// testnet/mainnet stay consistent across processes.
const SODEX_ENV = (process.env.SODEX_ENV ?? "mainnet").toLowerCase();
const SODEX_SPOT_BASE =
  process.env.SODEX_SPOT_BASE ??
  (SODEX_ENV === "testnet"
    ? "https://testnet-gw.sodex.dev/api/v1/spot"
    : "https://mainnet-gw.sodex.dev/api/v1/spot");

function pickChain(id: number) {
  switch (id) {
    case mainnet.id:
      return mainnet;
    case sepolia.id:
      return sepolia;
    case valueChainMainnet.id:
      return valueChainMainnet;
    case valueChainTestnet.id:
      return valueChainTestnet;
    default:
      return { ...sepolia, id };
  }
}

export type PublishedIndex = {
  id: Hex;
  symbol: string;
  name: string;
  base: string;
  tokens: string[];
  weightsBps: number[];
  mgmtFeeBps: number;
  perfFeeBps: number;
  createdAt: number; // unix seconds
};

export type SpotBalance = {
  asset: string;
  free: string;
  locked: string;
  total: string;
};

export type UserPortfolio = {
  address: Address;
  registry: {
    chainId: number;
    address: Address | null;
    indices: PublishedIndex[];
    /** Total indexCount on the registry — for context (not user-specific). */
    totalIndices: number;
    error?: string;
  };
  sodex: {
    env: "mainnet" | "testnet";
    base: string;
    balances: SpotBalance[];
    error?: string;
  };
  fetchedAt: string;
};


// ---------- SSI Registry: indices created by the user ----------

async function readUserPublishedIndices(
  address: Address,
): Promise<{ indices: PublishedIndex[]; total: number; error?: string }> {
  if (!REGISTRY) {
    return {
      indices: [],
      total: 0,
      error: "SSI_REGISTRY_ADDRESS not set",
    };
  }
  try {
    const chain = pickChain(CHAIN_ID);
    const transport = RPC ? http(RPC) : http();
    const client = createPublicClient({ chain, transport });

    const total = (await client.readContract({
      address: REGISTRY,
      abi: SSI_REGISTRY_ABI,
      functionName: "indexCount",
      args: [],
    })) as bigint;
    const totalNum = Number(total);
    const scanCount = Math.min(totalNum, MAX_REGISTRY_SCAN);

    if (scanCount === 0) {
      return { indices: [], total: 0 };
    }

    // Batch the per-id reads. viem's multicall would be faster but requires
    // the Multicall3 contract to be deployed on the chain — Sepolia has it,
    // ValueChain might not. Sequential is fine for v1 with low index count.
    const ids: Hex[] = [];
    for (let i = 0; i < scanCount; i++) {
      const id = (await client.readContract({
        address: REGISTRY,
        abi: SSI_REGISTRY_ABI,
        functionName: "indexIdAt",
        args: [BigInt(i)],
      })) as Hex;
      ids.push(id);
    }

    const indices: PublishedIndex[] = [];
    for (const id of ids) {
      const idx = (await client.readContract({
        address: REGISTRY,
        abi: SSI_REGISTRY_ABI,
        functionName: "getIndex",
        args: [id],
      })) as {
        creator: Address;
        createdAt: bigint;
        symbol: string;
        name: string;
        base: string;
        tokens: string[];
        weightsBps: number[];
        mgmtFeeBps: number;
        perfFeeBps: number;
        rebalanceCron: string;
      };
      if (idx.creator.toLowerCase() === address.toLowerCase()) {
        indices.push({
          id,
          symbol: idx.symbol,
          name: idx.name,
          base: idx.base,
          tokens: idx.tokens,
          weightsBps: idx.weightsBps.map((w) => Number(w)),
          mgmtFeeBps: Number(idx.mgmtFeeBps),
          perfFeeBps: Number(idx.perfFeeBps),
          createdAt: Number(idx.createdAt),
        });
      }
    }

    return { indices, total: totalNum };
  } catch (err) {
    return {
      indices: [],
      total: 0,
      error: (err as Error).message,
    };
  }
}


// ---------- SoDEX spot balances ----------

type SodexBalanceWire = {
  asset?: string;
  symbol?: string;
  coin?: string;
  free?: string | number;
  available?: string | number;
  locked?: string | number;
  frozen?: string | number;
  total?: string | number;
};

function pickAsset(b: SodexBalanceWire): string {
  return String(b.asset ?? b.symbol ?? b.coin ?? "").toUpperCase();
}

function pickAmount(...candidates: (string | number | undefined)[]): string {
  for (const c of candidates) {
    if (c !== undefined && c !== null && c !== "") return String(c);
  }
  return "0";
}

async function readSodexBalances(
  address: Address,
): Promise<{ balances: SpotBalance[]; error?: string }> {
  // SoDEX docs (https://sodex.com/documentation/api/api-rate-limits.md) list
  // "Query balances" as a public spot endpoint with weight 5. Path inferred
  // from the Go SDK convention; if SoDEX ever rotates this we'll get a 404
  // and surface the error in the UI rather than crashing.
  const url = `${SODEX_SPOT_BASE}/accounts/${address}/balances`;
  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
      headers: { accept: "application/json" },
    });
    if (!res.ok) {
      return { balances: [], error: `SoDEX HTTP ${res.status}` };
    }
    const body = (await res.json()) as unknown;
    // The gateway sometimes wraps payloads as `{ data: [...] }` and sometimes
    // returns a bare array. Accept both.
    const list: SodexBalanceWire[] = Array.isArray(body)
      ? (body as SodexBalanceWire[])
      : Array.isArray((body as { data?: unknown }).data)
        ? ((body as { data: SodexBalanceWire[] }).data)
        : [];
    const balances: SpotBalance[] = list.map((b) => {
      const free = pickAmount(b.free, b.available);
      const locked = pickAmount(b.locked, b.frozen);
      // Sum manually so the UI doesn't depend on the gateway's `total` field
      // (which some endpoints omit). All amounts are decimal strings to
      // avoid float precision drift on common token decimals (6/8/18).
      const total = pickAmount(
        b.total,
        (Number(free) + Number(locked)).toString(),
      );
      return {
        asset: pickAsset(b),
        free,
        locked,
        total,
      };
    });
    // Drop zero-balance rows so the UI focuses on what the user actually holds.
    const nonZero = balances.filter(
      (b) => b.asset && (Number(b.total) > 0 || Number(b.free) > 0),
    );
    return { balances: nonZero };
  } catch (err) {
    return {
      balances: [],
      error: (err as Error).message,
    };
  }
}


// ---------- Public entry ----------

export async function getUserPortfolio(address: Address): Promise<UserPortfolio> {
  const [registry, sodex] = await Promise.all([
    readUserPublishedIndices(address),
    readSodexBalances(address),
  ]);
  return {
    address,
    registry: {
      chainId: CHAIN_ID,
      address: REGISTRY ? (REGISTRY as Address) : null,
      indices: registry.indices,
      totalIndices: registry.total,
      error: registry.error,
    },
    sodex: {
      env: SODEX_ENV === "testnet" ? "testnet" : "mainnet",
      base: SODEX_SPOT_BASE,
      balances: sodex.balances,
      error: sodex.error,
    },
    fetchedAt: new Date().toISOString(),
  };
}
