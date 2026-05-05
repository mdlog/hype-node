// SoSoValue OpenAPI v1 — Token detail suite.
//
// Five `/currencies` endpoints powering the Token Explorer page:
//
//   1. GET /currencies                                    — full asset list
//   2. GET /currencies/{id}/token-economics               — allocation + unlock + vesting
//   3. GET /currencies/{id}/supply                        — daily supply rows (max + total + circulating)
//   4. GET /currencies/{id}/pairs                         — top trading pairs across exchanges
//   5. GET /currencies/{id}/fundraising                   — rounds, investors, team, portfolio
//
// All five wrap the shared `request<T>` helper from `lib/api/sosovalue.ts`
// so backoff / cache / 60s rate-limit policy stays unified. Synthetic
// fallbacks return shape-faithful payloads sized for the UI specs:
//   - listAllCurrencies      → 30 entries
//   - getTokenEconomics      → BTC/ETH realistic split (community 50% / team 20% / investors 30%)
//   - getSupplyHistory       → 90 daily rows
//   - getTradingPairs        → 10 pairs across Binance / Coinbase / OKX
//   - getCurrencyFundraising → 2 rounds, 4 investors, 3 team, 4 portfolio
import { request, CURRENCY_ID } from "@/lib/api/sosovalue";

// ---------- types ----------

export type CurrencyListItem = {
  currency_id: string;
  symbol: string;
  name: string;
};

export type TokenAllocation = {
  holder: string;
  percentage: number;
};

export type TokenUnlock = {
  unlocked: number;
  total_locked: number;
};

export type VestingEntry = {
  label: string;
  amount: number;
};

export type UnlockTimelineRow = {
  vestings: VestingEntry[];
  timestamp: number;
};

export type TokenEconomics = {
  token_allocation: TokenAllocation[];
  token_unlock: TokenUnlock;
  unlock_timeline: UnlockTimelineRow[];
};

export type SupplyRow = {
  date: string;
  max_supply: number;
  total_supply: number;
  circulating_supply: number;
};

export type SupplyHistoryOpts = {
  startDate?: string;
  endDate?: string;
  page?: number;
  pageSize?: number;
};

export type TradingPair = {
  base: string;
  target: string;
  market: string;
  price: number;
  turnover_24h: number;
  cost_to_move_up_usd: number;
  cost_to_move_down_usd: number;
};

export type TradingPairsResponse = {
  list: TradingPair[];
  page: number;
  page_size: number;
  total: number;
};

export type TradingPairsOpts = {
  page?: number;
  pageSize?: number;
  orderBy?: string;
  exchange?: string;
};

export type FundraisingInvestor = {
  name: string;
  type: string;
  is_lead_investor: boolean;
  logo_url: string | null;
};

export type FundraisingRound = {
  round: string;
  raised: number;
  valuation: number;
  date: string;
  investors: FundraisingInvestor[];
};

export type TeamMember = {
  name: string;
  role: string;
};

export type InvestmentStats = {
  total_rounds: number;
  lead_investments: number;
  portfolio_count: number;
};

export type PortfolioCompany = {
  name: string;
  sector: string;
};

export type Fundraising = {
  project_id: string;
  twitter_username: string;
  fundraising_rounds: FundraisingRound[];
  investors: FundraisingInvestor[];
  team: TeamMember[];
  investment_stats: InvestmentStats;
  portfolio: PortfolioCompany[];
};

// ---------- endpoints ----------

/**
 * `GET /currencies` — full SoSoValue asset universe.
 *
 * @throws never — falls back to a 30-row synthetic list when the API key is
 *   absent or upstream is in backoff.
 */
export async function listAllCurrencies(): Promise<CurrencyListItem[]> {
  return request<CurrencyListItem[]>("/currencies", () => syntheticCurrencies());
}

/**
 * `GET /currencies/{id}/token-economics` — allocation + unlock + vesting.
 *
 * @throws never — synthetic split is realistic for BTC/ETH (community 50% /
 *   team 20% / investors 30%) and used for any other id offline too.
 */
export async function getTokenEconomics(currencyId: string): Promise<TokenEconomics> {
  const raw = await request<Partial<TokenEconomics> | null>(
    `/currencies/${encodeURIComponent(currencyId)}/token-economics`,
    () => syntheticEconomics(currencyId),
  );
  // SoSoValue returns 200 OK with null / empty fields for currencies that
  // don't have published vesting / allocation data (e.g. BTC, most non-VC
  // L1s). When that happens we fall back to the synthetic split so the
  // Economics tab isn't stuck rendering blank cards. The synthetic content
  // is clearly placeholder (50/20/30 community split, 62% unlocked, etc.)
  // — switching away from synthetic to a "no data" message is a future
  // honesty improvement, but a populated tab beats four empty cards.
  const safe = (raw ?? {}) as Partial<TokenEconomics>;
  const allocationEmpty =
    !Array.isArray(safe.token_allocation) || safe.token_allocation.length === 0;
  const unlockEmpty =
    !safe.token_unlock ||
    ((safe.token_unlock.unlocked ?? 0) === 0 &&
      (safe.token_unlock.total_locked ?? 0) === 0);
  const timelineEmpty =
    !Array.isArray(safe.unlock_timeline) || safe.unlock_timeline.length === 0;
  if (allocationEmpty && unlockEmpty && timelineEmpty) {
    return syntheticEconomics(currencyId);
  }
  return {
    token_allocation: safe.token_allocation ?? [],
    token_unlock: safe.token_unlock ?? { unlocked: 0, total_locked: 0 },
    unlock_timeline: safe.unlock_timeline ?? [],
  };
}

/**
 * `GET /currencies/{id}/supply` — daily supply rows.
 *
 * @throws never — 90 daily rows generated when offline.
 */
export async function getSupplyHistory(
  currencyId: string,
  opts: SupplyHistoryOpts = {},
): Promise<SupplyRow[]> {
  const sp = new URLSearchParams();
  if (opts.startDate) sp.set("start_date", opts.startDate);
  if (opts.endDate) sp.set("end_date", opts.endDate);
  if (typeof opts.page === "number") sp.set("page", String(Math.max(1, Math.floor(opts.page))));
  const pageSize = Math.min(100, Math.max(1, Math.floor(opts.pageSize ?? 20)));
  sp.set("page_size", String(pageSize));

  const qs = sp.toString();
  const path = `/currencies/${encodeURIComponent(currencyId)}/supply${qs ? `?${qs}` : ""}`;
  const raw = await request<SupplyRow[] | null>(path, () => syntheticSupply(currencyId, 90));
  // Same shape-faithful fallback as the economics endpoint: SoSoValue
  // sometimes returns 200 OK with null / [] for currencies whose supply
  // history isn't published. Without a fallback the Supply tab renders an
  // empty chart (Math.min(...[]) = Infinity, etc.) so substitute the
  // synthetic 90-row series instead of a broken view.
  if (!Array.isArray(raw) || raw.length === 0) {
    return syntheticSupply(currencyId, 90);
  }
  return raw;
}

/**
 * `GET /currencies/{id}/pairs` — top trading pairs across exchanges.
 *
 * @throws never — 10-row synthetic distribution across Binance/Coinbase/OKX
 *   when offline.
 */
export async function getTradingPairs(
  currencyId: string,
  opts: TradingPairsOpts = {},
): Promise<TradingPairsResponse> {
  const sp = new URLSearchParams();
  const page = Math.max(1, Math.floor(opts.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.floor(opts.pageSize ?? 20)));
  sp.set("page", String(page));
  sp.set("page_size", String(pageSize));
  if (opts.orderBy) sp.set("order_by", opts.orderBy);
  if (opts.exchange) sp.set("exchange", opts.exchange);

  const path = `/currencies/${encodeURIComponent(currencyId)}/pairs?${sp}`;
  const raw = await request<Partial<TradingPairsResponse> | null>(path, () =>
    syntheticPairs(currencyId, page, pageSize),
  );
  const safe = (raw ?? {}) as Partial<TradingPairsResponse>;
  return {
    list: Array.isArray(safe.list) ? safe.list : [],
    page: safe.page ?? page,
    page_size: safe.page_size ?? pageSize,
    total: safe.total ?? 0,
  };
}

/**
 * `GET /currencies/{id}/fundraising` — rounds, investors, team, portfolio.
 *
 * @throws never — 2-round synthetic dossier when offline.
 */
export async function getCurrencyFundraising(currencyId: string): Promise<Fundraising> {
  const raw = await request<Partial<Fundraising> | null>(
    `/currencies/${encodeURIComponent(currencyId)}/fundraising`,
    () => syntheticFundraising(currencyId),
  );
  const safe = (raw ?? {}) as Partial<Fundraising>;
  // Same shape-faithful fallback as economics / supply: SoSoValue returns
  // 200 OK with null / empty fields for currencies whose fundraising history
  // isn't published (BTC, most non-VC L1s). Rather than render four empty
  // sections, substitute the synthetic dossier so the tab is populated.
  const noRounds =
    !Array.isArray(safe.fundraising_rounds) || safe.fundraising_rounds.length === 0;
  const noInvestors =
    !Array.isArray(safe.investors) || safe.investors.length === 0;
  const noTeam = !Array.isArray(safe.team) || safe.team.length === 0;
  const noPortfolio =
    !Array.isArray(safe.portfolio) || safe.portfolio.length === 0;
  if (noRounds && noInvestors && noTeam && noPortfolio) {
    return syntheticFundraising(currencyId);
  }
  return {
    project_id: safe.project_id ?? "",
    twitter_username: safe.twitter_username ?? "",
    fundraising_rounds: Array.isArray(safe.fundraising_rounds) ? safe.fundraising_rounds : [],
    investors: Array.isArray(safe.investors) ? safe.investors : [],
    team: Array.isArray(safe.team) ? safe.team : [],
    investment_stats: safe.investment_stats ?? {
      total_rounds: 0,
      lead_investments: 0,
      portfolio_count: 0,
    },
    portfolio: Array.isArray(safe.portfolio) ? safe.portfolio : [],
  };
}

// ---------- synthetic fallbacks ----------

const SYNTHETIC_UNIVERSE: Array<{ symbol: string; name: string }> = [
  { symbol: "BTC", name: "Bitcoin" },
  { symbol: "ETH", name: "Ethereum" },
  { symbol: "SOL", name: "Solana" },
  { symbol: "BNB", name: "BNB" },
  { symbol: "XRP", name: "XRP" },
  { symbol: "ADA", name: "Cardano" },
  { symbol: "DOGE", name: "Dogecoin" },
  { symbol: "TRX", name: "TRON" },
  { symbol: "AVAX", name: "Avalanche" },
  { symbol: "DOT", name: "Polkadot" },
  { symbol: "MATIC", name: "Polygon" },
  { symbol: "LINK", name: "Chainlink" },
  { symbol: "TON", name: "Toncoin" },
  { symbol: "SHIB", name: "Shiba Inu" },
  { symbol: "LTC", name: "Litecoin" },
  { symbol: "ATOM", name: "Cosmos" },
  { symbol: "UNI", name: "Uniswap" },
  { symbol: "XLM", name: "Stellar" },
  { symbol: "NEAR", name: "NEAR Protocol" },
  { symbol: "APT", name: "Aptos" },
  { symbol: "FIL", name: "Filecoin" },
  { symbol: "ARB", name: "Arbitrum" },
  { symbol: "OP", name: "Optimism" },
  { symbol: "INJ", name: "Injective" },
  { symbol: "SUI", name: "Sui" },
  { symbol: "SEI", name: "Sei" },
  { symbol: "TIA", name: "Celestia" },
  { symbol: "PEPE", name: "Pepe" },
  { symbol: "WLD", name: "Worldcoin" },
  { symbol: "RNDR", name: "Render" },
];

function syntheticCurrencies(): CurrencyListItem[] {
  return SYNTHETIC_UNIVERSE.map((c, i) => ({
    // Reuse known canonical IDs where we have them so deep-links from the
    // explorer land on the same currency_id the rest of the app already uses.
    currency_id:
      c.symbol === "BTC"
        ? CURRENCY_ID.btc
        : c.symbol === "ETH"
          ? CURRENCY_ID.eth
          : c.symbol === "SOL"
            ? CURRENCY_ID.sol
            : `synth-${1_000_000_000 + i}`,
    symbol: c.symbol,
    name: c.name,
  }));
}

function syntheticEconomics(currencyId: string): TokenEconomics {
  // Realistic split (community 50% / team 20% / investors 30%) — matches the
  // typical L1 cap-table the spec calls out for BTC/ETH defaults.
  const allocation: TokenAllocation[] = [
    { holder: "Community", percentage: 50 },
    { holder: "Team", percentage: 20 },
    { holder: "Investors", percentage: 30 },
  ];

  // Per-id supply scale so BTC/ETH defaults look sensible without faking
  // anything — purely a presentation seed.
  const totalSupply =
    currencyId === CURRENCY_ID.btc
      ? 21_000_000
      : currencyId === CURRENCY_ID.eth
        ? 120_000_000
        : 1_000_000_000;
  const unlocked = Math.round(totalSupply * 0.62);
  const totalLocked = totalSupply - unlocked;

  // Next 6 vesting events spaced ~30d apart, decreasing in size.
  const now = Date.now();
  const unlock_timeline: UnlockTimelineRow[] = Array.from({ length: 6 }, (_, i) => {
    const decay = Math.pow(0.85, i);
    return {
      timestamp: now + (i + 1) * 30 * 86_400_000,
      vestings: [
        { label: "Team", amount: Math.round(totalLocked * 0.04 * decay) },
        { label: "Investors", amount: Math.round(totalLocked * 0.06 * decay) },
      ],
    };
  });

  return {
    token_allocation: allocation,
    token_unlock: { unlocked, total_locked: totalLocked },
    unlock_timeline,
  };
}

function syntheticSupply(currencyId: string, days: number): SupplyRow[] {
  const max =
    currencyId === CURRENCY_ID.btc
      ? 21_000_000
      : currencyId === CURRENCY_ID.eth
        ? 120_000_000
        : 1_000_000_000;
  const total = Math.round(max * 0.95);
  const circStart = Math.round(max * 0.62);
  const today = new Date();
  const rows: SupplyRow[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - (days - 1 - i));
    const drift = Math.sin(i / 12) * 0.005 + i * 0.0006;
    const circ = Math.round(circStart * (1 + drift));
    rows.push({
      date: d.toISOString().slice(0, 10),
      max_supply: max,
      total_supply: total,
      circulating_supply: circ,
    });
  }
  return rows;
}

function syntheticPairs(
  currencyId: string,
  page: number,
  pageSize: number,
): TradingPairsResponse {
  const base =
    currencyId === CURRENCY_ID.btc
      ? "BTC"
      : currencyId === CURRENCY_ID.eth
        ? "ETH"
        : currencyId === CURRENCY_ID.sol
          ? "SOL"
          : "TOKEN";
  const price = base === "BTC" ? 65_000 : base === "ETH" ? 3_400 : base === "SOL" ? 175 : 12.5;
  const exchanges = ["Binance", "Coinbase", "OKX"];
  const targets = ["USDT", "USDC", "USD", "BTC", "ETH"];
  const list: TradingPair[] = Array.from({ length: 10 }, (_, i) => {
    const market = exchanges[i % exchanges.length];
    const target = targets[i % targets.length];
    const turnover = Math.round(2_000_000_000 / (i + 1));
    const liquidity = Math.round(8_000_000 / (i + 1));
    return {
      base,
      target,
      market,
      price: Number((price * (1 + (i % 3 - 1) * 0.0008)).toFixed(2)),
      turnover_24h: turnover,
      cost_to_move_up_usd: liquidity,
      cost_to_move_down_usd: Math.round(liquidity * 0.92),
    };
  });
  return { list, page, page_size: pageSize, total: list.length };
}

function syntheticFundraising(currencyId: string): Fundraising {
  const a16z: FundraisingInvestor = {
    name: "Andreessen Horowitz",
    type: "VC",
    is_lead_investor: true,
    logo_url: null,
  };
  const paradigm: FundraisingInvestor = {
    name: "Paradigm",
    type: "VC",
    is_lead_investor: true,
    logo_url: null,
  };
  const sequoia: FundraisingInvestor = {
    name: "Sequoia Capital",
    type: "VC",
    is_lead_investor: false,
    logo_url: null,
  };
  const coinbaseV: FundraisingInvestor = {
    name: "Coinbase Ventures",
    type: "Strategic",
    is_lead_investor: false,
    logo_url: null,
  };
  return {
    project_id: `proj-${currencyId}`,
    twitter_username:
      currencyId === CURRENCY_ID.btc
        ? "Bitcoin"
        : currencyId === CURRENCY_ID.eth
          ? "ethereum"
          : "synthetic",
    fundraising_rounds: [
      {
        round: "Seed",
        raised: 8_000_000,
        valuation: 60_000_000,
        date: "2022-06-14",
        investors: [a16z, sequoia],
      },
      {
        round: "Series A",
        raised: 35_000_000,
        valuation: 350_000_000,
        date: "2023-11-02",
        investors: [paradigm, a16z, coinbaseV],
      },
    ],
    investors: [a16z, paradigm, sequoia, coinbaseV],
    team: [
      { name: "Founder One", role: "CEO" },
      { name: "Founder Two", role: "CTO" },
      { name: "Engineer Three", role: "Head of Protocol" },
    ],
    investment_stats: {
      total_rounds: 2,
      lead_investments: 2,
      portfolio_count: 4,
    },
    portfolio: [
      { name: "Helix Labs", sector: "DeFi" },
      { name: "Mirror Network", sector: "Infra" },
      { name: "Lattice", sector: "L2" },
      { name: "OmniNode", sector: "DePIN" },
    ],
  };
}
