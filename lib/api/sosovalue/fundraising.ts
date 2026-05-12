// SoSoValue OpenAPI v1 — fundraising surface.
//
// As of 2026-05, `/fundraising/projects` and `/fundraising/projects/{id}`
// return HTTP 404 + code 400401 ("Bad request to upstream service") — those
// endpoints have been retired upstream. We migrated to:
//
//   - `GET /currencies` (full list, ~1281 items) for the listing
//   - `GET /currencies/{currency_id}/fundraising` for per-project detail
//
// IDs are now SoSoValue `currency_id` strings (e.g. "1673723677362319866")
// — too large for JS Number, so the type is `string` end-to-end. The list
// page treats id as opaque; the detail page passes it through unchanged.
//
// Wraps the shared `request<T>` helper so the rate-limiter / per-path cache
// behavior stays consistent. When upstream is missing or in backoff we now
// return EMPTY arrays + null details — pages render an explicit "data
// unavailable" state instead of seeding synthetic content that could be
// mistaken for live data.
import { request } from "@/lib/api/sosovalue";

export type FundingProjectListItem = {
  project_id: string;
  project_name: string;
};

export type FundraisingInvestor = {
  investor_id: number;
  name: string;
  logo_url: string | null;
  type: string;
  is_lead_investor: boolean;
};

export type FundraisingRound = {
  round_name: string;
  raised_amount: number;
  valuation: number;
  date: string;
  investors: FundraisingInvestor[];
};

export type FundraisingTeamMember = {
  name: string;
  role: string;
  twitter?: string | null;
};

export type FundraisingInvestmentStats = {
  total_rounds: number;
  lead_investments: number;
  portfolio_count: number;
  rounds_in_past_year?: number;
};

export type FundraisingPortfolioItem = {
  project_id: string;
  name: string;
  ecosystem: string;
  funding_status: string;
  logo_url?: string | null;
};

export type FundraisingProjectDetail = {
  project_id: string;
  project_name: string;
  twitter_username: string | null;
  create_time: string;
  update_time: string;
  fundraising_rounds: FundraisingRound[];
  investors: FundraisingInvestor[];
  team: FundraisingTeamMember[];
  investment_stats: FundraisingInvestmentStats;
  portfolio: FundraisingPortfolioItem[];
};

// ---------- wire types matching SoSoValue's actual response shape ----------

type WireCurrency = {
  currency_id: string;
  name: string;
  symbol: string | null;
};

type WireRoundInvestor = {
  investor_id: number | string;
  name: string;
  logo_url?: string | null;
  type?: string | null;
  is_lead_investor?: boolean | null;
};

type WireRound = {
  round_id?: number | string;
  // Wire field is `round` (not `round_name`). Sometimes empty string.
  round?: string | null;
  // Wire `amount` is a STRING in MILLIONS USD (e.g. "2000" = $2B). Multiply
  // by 1e6 in normalizeRound. The companion `amount_display` is pre-formatted
  // ("$2000M") and we use it as a fallback when the numeric parse fails.
  amount?: string | number | null;
  amount_display?: string | null;
  // Same string/numeric mix as amount; sometimes localized non-numeric
  // ("néant" = French for "none") — coerce safely.
  valuation?: string | number | null;
  // Date is exposed as `timestamp` (millis since epoch, as STRING).
  // Older docs called it `date` — keep both for compat.
  timestamp?: string | number | null;
  date?: string | null;
  investors?: WireRoundInvestor[] | null;
};

type WireFundraisingDetail = {
  project_id?: string | number | null;
  twitter_username?: string | null;
  create_time?: string | number | null;
  update_time?: string | number | null;
  fundraising_rounds?: WireRound[] | null;
  investors?: WireRoundInvestor[] | null;
  team?: { name?: string; role?: string; twitter?: string | null }[] | null;
  investment_stats?: {
    total_rounds?: number | null;
    rounds_last_year?: number | null;
    lead_invest_count?: number | null;
    last_invest_date?: string | null;
    portfolio_count?: number | null;
  } | null;
  portfolio?: {
    project_id?: string | number | null;
    // Wire field is `project_name` (not `name`) per the live SoSoValue
    // /currencies/{id}/fundraising response. Older clients sent `name`,
    // keep both for tolerant decoding.
    project_name?: string | null;
    name?: string | null;
    logo_url?: string | null;
    // Wire field is `ecosystems` array (not `ecosystem` string).
    ecosystems?: string[] | null;
    ecosystem?: string | null;
    funding_status?: string | null;
    established_timestamp?: string | number | null;
    regions?: string[] | null;
  }[] | null;
};

// ---------- normalization ----------

function toIsoMaybe(v: string | number | null | undefined): string {
  if (v == null || v === "") return "";
  const n = typeof v === "string" ? Number(v) : v;
  if (Number.isFinite(n) && n > 1_000_000_000_000) {
    // Looks like millis since epoch
    return new Date(n).toISOString();
  }
  if (typeof v === "string") return v;
  return "";
}

function normalizeInvestor(w: WireRoundInvestor): FundraisingInvestor {
  return {
    investor_id: Number(w.investor_id) || 0,
    name: w.name ?? "Unknown",
    logo_url: w.logo_url ?? null,
    type: w.type ?? "Investor",
    is_lead_investor: !!w.is_lead_investor,
  };
}

// `amount` is in millions USD on the wire. Returns absolute USD (e.g.
// "2000" → 2_000_000_000). Non-numeric values fall back to 0.
function parseAmountMillions(v: string | number | null | undefined): number {
  if (v == null || v === "") return 0;
  const n = typeof v === "string" ? Number(v) : v;
  if (!Number.isFinite(n)) return 0;
  return n * 1_000_000;
}

function parseDate(
  ts: string | number | null | undefined,
  date: string | null | undefined,
): string {
  // Prefer the numeric timestamp (millis since epoch) when present.
  if (ts != null && ts !== "") {
    const n = typeof ts === "string" ? Number(ts) : ts;
    if (Number.isFinite(n) && n > 1_000_000_000_000) {
      return new Date(n).toISOString().slice(0, 10);
    }
  }
  return date ?? "";
}

function normalizeRound(w: WireRound): FundraisingRound {
  return {
    round_name: w.round?.trim() || "Disclosed round",
    raised_amount: parseAmountMillions(w.amount),
    valuation: parseAmountMillions(w.valuation),
    date: parseDate(w.timestamp, w.date),
    investors: (w.investors ?? []).map(normalizeInvestor),
  };
}

function normalizeDetail(
  w: WireFundraisingDetail | null | undefined,
  fallbackId: string,
  fallbackName: string,
): FundraisingProjectDetail {
  const data = w ?? {};
  const rounds = (data.fundraising_rounds ?? []).map(normalizeRound);

  // Aggregate unique investors across rounds when the top-level investors
  // list is missing — happens for some upstream responses.
  const aggInvestors = new Map<number, FundraisingInvestor>();
  for (const r of rounds) {
    for (const inv of r.investors) {
      const existing = aggInvestors.get(inv.investor_id);
      if (!existing || (!existing.is_lead_investor && inv.is_lead_investor)) {
        aggInvestors.set(inv.investor_id, inv);
      }
    }
  }
  const investors =
    (data.investors ?? []).length > 0
      ? data.investors!.map(normalizeInvestor)
      : Array.from(aggInvestors.values());

  const stats = data.investment_stats ?? {};

  return {
    project_id: String(data.project_id ?? fallbackId),
    project_name: fallbackName,
    twitter_username: data.twitter_username ?? null,
    create_time: toIsoMaybe(data.create_time ?? null),
    update_time: toIsoMaybe(data.update_time ?? null),
    fundraising_rounds: rounds,
    investors,
    team: (data.team ?? []).map((t) => ({
      name: t.name ?? "—",
      role: t.role ?? "—",
      twitter: t.twitter ?? null,
    })),
    investment_stats: {
      total_rounds: stats.total_rounds ?? rounds.length,
      lead_investments: stats.lead_invest_count ?? 0,
      portfolio_count: stats.portfolio_count ?? (data.portfolio?.length ?? 0),
      rounds_in_past_year: stats.rounds_last_year ?? undefined,
    },
    portfolio: (data.portfolio ?? []).map((p) => ({
      project_id: String(p.project_id ?? ""),
      // Live wire uses `project_name`; legacy / synthetic shape used `name`.
      // Fall back to "—" only if both are missing — don't lose real names.
      name: (p.project_name?.trim() || p.name?.trim() || "—"),
      // `ecosystems` is an array on the wire — pick the first / join — fall
      // back to legacy `ecosystem` string when present.
      ecosystem: Array.isArray(p.ecosystems) && p.ecosystems.length > 0
        ? p.ecosystems.join(", ")
        : (p.ecosystem ?? ""),
      funding_status: p.funding_status ?? "",
      logo_url: p.logo_url ?? null,
    })),
  };
}

// ---------- public API ----------

// How many currencies to probe for the listing page. Each fetch costs ~1
// SoSoValue API call (cached 15min by the request layer), so the cold-load
// budget is ~LIST_PROBE_LIMIT * MIN_GAP_MS. With HF tier (700ms gap), 60
// probes = ~42s first load, ~free after cache warms.
const LIST_PROBE_LIMIT = 60;

/**
 * List currencies that have at least one disclosed fundraising round.
 *
 * Returns an EMPTY array when /currencies is unreachable or no listed
 * currency has disclosed rounds. Callers must render an explicit empty
 * state — never substitute synthetic placeholder names.
 */
export async function listFundingProjects(): Promise<FundingProjectListItem[]> {
  const currencies = await request<WireCurrency[]>("/currencies", () => []);
  if (!Array.isArray(currencies) || currencies.length === 0) return [];

  const head = currencies.slice(0, LIST_PROBE_LIMIT);
  const probes = await Promise.all(
    head.map((c) =>
      request<WireFundraisingDetail | null>(
        `/currencies/${encodeURIComponent(c.currency_id)}/fundraising`,
        () => null,
      ).then((data) => ({ currency: c, data })),
    ),
  );

  return probes
    .filter((p) => {
      const rounds = p.data?.fundraising_rounds ?? [];
      return Array.isArray(rounds) && rounds.length > 0;
    })
    .map<FundingProjectListItem>((p) => ({
      project_id: p.currency.currency_id,
      project_name: p.currency.name,
    }));
}

// Flat per-round timeline event — what the listing page renders as table rows.
export type FundingRoundEvent = {
  // Stable composite id for React keys + analytics. Combines currency_id and
  // round_id (or fallback hash of round + date) so two events from the same
  // project on the same date with the same round name still get unique ids.
  event_id: string;
  project_id: string; // currency_id — drives the detail link
  project_name: string;
  project_symbol: string | null;
  round_name: string;
  raised_amount: number; // absolute USD
  valuation: number; // absolute USD; 0 when undisclosed
  date: string; // YYYY-MM-DD
  date_ts: number; // millis since epoch — for sorting
  investors: FundraisingInvestor[];
};

/**
 * Cross-currency funding round timeline.
 *
 * Probes the top LIST_PROBE_LIMIT entries of /currencies, flattens every
 * disclosed round, sorts by date desc. Returns an empty array on failure
 * or when no currency has disclosed rounds.
 *
 * Coverage limitations vs sosovalue.com/assets/fundraising:
 *   - Bound by LIST_PROBE_LIMIT (60 currencies). Smaller / pre-launch
 *     projects not in the top of /currencies won't show up.
 *   - The website's `gw.sosovalue.com/v1/fundraising/list` endpoint that
 *     drives the public table requires user-session auth — not reachable
 *     from OpenAPI.
 *   - Per-round metadata (categories, region, token issuance) is not
 *     exposed by /currencies/{id}/fundraising.
 */
export async function listFundingRoundEvents(): Promise<FundingRoundEvent[]> {
  const currencies = await request<WireCurrency[]>("/currencies", () => []);
  if (!Array.isArray(currencies) || currencies.length === 0) return [];

  const head = currencies.slice(0, LIST_PROBE_LIMIT);
  const probes = await Promise.all(
    head.map((c) =>
      request<WireFundraisingDetail | null>(
        `/currencies/${encodeURIComponent(c.currency_id)}/fundraising`,
        () => null,
      ).then((data) => ({ currency: c, data })),
    ),
  );

  const events: FundingRoundEvent[] = [];
  for (const { currency, data } of probes) {
    const wireRounds = data?.fundraising_rounds ?? [];
    if (!Array.isArray(wireRounds) || wireRounds.length === 0) continue;
    for (const w of wireRounds) {
      const r = normalizeRound(w);
      const ts = Number(w.timestamp);
      const dateTs = Number.isFinite(ts) && ts > 1_000_000_000_000 ? ts : 0;
      const eventId =
        w.round_id != null
          ? `${currency.currency_id}-${w.round_id}`
          : `${currency.currency_id}-${r.date}-${r.round_name}`;
      events.push({
        event_id: eventId,
        project_id: currency.currency_id,
        project_name: currency.name,
        project_symbol: currency.symbol ?? null,
        round_name: r.round_name,
        raised_amount: r.raised_amount,
        valuation: r.valuation,
        date: r.date,
        date_ts: dateTs,
        investors: r.investors,
      });
    }
  }

  if (events.length === 0) return [];

  // Sort: known dates first (descending), then unknown-date events at the end.
  events.sort((a, b) => {
    if (a.date_ts && b.date_ts) return b.date_ts - a.date_ts;
    if (a.date_ts) return -1;
    if (b.date_ts) return 1;
    return 0;
  });

  return events;
}

/**
 * Fetch full fundraising detail for a single currency. Returns null when
 * upstream is unreachable or the currency has no disclosed funding history —
 * the detail page renders an explicit "data unavailable" state.
 */
export async function getProjectFundraising(
  currencyId: string,
  knownName?: string,
): Promise<FundraisingProjectDetail | null> {
  const id = String(currencyId);
  const fallbackName = knownName?.trim() || `Project #${id}`;
  const wire = await request<WireFundraisingDetail | null>(
    `/currencies/${encodeURIComponent(id)}/fundraising`,
    () => null,
  );
  if (!wire) return null;
  return normalizeDetail(wire, id, fallbackName);
}

