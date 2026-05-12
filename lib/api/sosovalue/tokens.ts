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
// so backoff / cache / 60s rate-limit policy stays unified. When upstream
// is unreachable each helper returns the empty/zeroed shape — pages render
// an explicit "data unavailable" / empty state, never seeded synthetic
// numbers that could be mistaken for live data.
import { request } from "@/lib/api/sosovalue";

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
 * @throws never — returns an empty array when upstream is unreachable.
 */
export async function listAllCurrencies(): Promise<CurrencyListItem[]> {
  return request<CurrencyListItem[]>("/currencies", () => []);
}

/**
 * `GET /currencies/{id}/token-economics` — allocation + unlock + vesting.
 *
 * Returns empty/zeroed shape when upstream is unreachable or the currency
 * has no published vesting data (BTC, most non-VC L1s). The Economics tab
 * shows an explicit empty state.
 */
export async function getTokenEconomics(currencyId: string): Promise<TokenEconomics> {
  const raw = await request<Partial<TokenEconomics> | null>(
    `/currencies/${encodeURIComponent(currencyId)}/token-economics`,
    () => null,
  );
  const safe = (raw ?? {}) as Partial<TokenEconomics>;
  return {
    token_allocation: safe.token_allocation ?? [],
    token_unlock: safe.token_unlock ?? { unlocked: 0, total_locked: 0 },
    unlock_timeline: safe.unlock_timeline ?? [],
  };
}

/**
 * `GET /currencies/{id}/supply` — daily supply rows.
 *
 * @throws never — empty array when upstream is unreachable or supply history
 *   isn't published for this currency.
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
  const raw = await request<SupplyRow[] | null>(path, () => null);
  return Array.isArray(raw) ? raw : [];
}

/**
 * `GET /currencies/{id}/pairs` — top trading pairs across exchanges.
 *
 * @throws never — empty list when upstream is unreachable.
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
  const raw = await request<Partial<TradingPairsResponse> | null>(path, () => null);
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
 * @throws never — empty/zeroed shape when upstream is unreachable.
 */
export async function getCurrencyFundraising(currencyId: string): Promise<Fundraising> {
  const raw = await request<Partial<Fundraising> | null>(
    `/currencies/${encodeURIComponent(currencyId)}/fundraising`,
    () => null,
  );
  const safe = (raw ?? {}) as Partial<Fundraising>;
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

