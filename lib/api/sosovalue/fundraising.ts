// SoSoValue OpenAPI v1 — `GET /fundraising/projects` and
// `GET /fundraising/projects/{project_id}`.
//
// Fundraising tracker surface: project list (id + name only) and per-project
// detail (rounds, investors, team, stats, portfolio). Wraps `request<T>` from
// `@/lib/api/sosovalue` so backoff / caching / synthetic fallback behavior
// stays consistent with the rest of the SoSoValue surface.
//
// When the API key is absent or upstream is in backoff, `request` invokes the
// fallback() — we return deterministic synthetic payloads so the UI stays
// interactive offline (20 projects, 3 rounds each, 4-6 lead investors per
// round drawn from a curated VC roster).
import { request } from "@/lib/api/sosovalue";

export type FundingProjectListItem = {
  project_id: number;
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
  project_id: number;
  name: string;
  ecosystem: string;
  funding_status: string;
};

export type FundraisingProjectDetail = {
  project_id: number;
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

const SYNTHETIC_NAMES: string[] = [
  "Crossover Markets",
  "Eigen Labs",
  "Berachain",
  "Monad Labs",
  "Celestia Labs",
  "Anoma",
  "Nillion",
  "Movement Labs",
  "Babylon",
  "Avail",
  "Initia",
  "Story Protocol",
  "Espresso Systems",
  "Penumbra Labs",
  "Polymer Labs",
  "Hyperliquid",
  "Pyth Network",
  "Worldcoin",
  "Ethena Labs",
  "Renzo Protocol",
];

const VC_ROSTER: { name: string; type: string }[] = [
  { name: "Paradigm", type: "VC" },
  { name: "a16z crypto", type: "VC" },
  { name: "Pantera Capital", type: "VC" },
  { name: "Multicoin Capital", type: "VC" },
  { name: "Polychain Capital", type: "VC" },
  { name: "Coinbase Ventures", type: "Strategic" },
  { name: "Binance Labs", type: "Strategic" },
  { name: "Dragonfly", type: "VC" },
  { name: "Galaxy Digital", type: "VC" },
  { name: "Jump Crypto", type: "VC" },
  { name: "Variant Fund", type: "VC" },
  { name: "Electric Capital", type: "VC" },
];

const ROUND_TEMPLATES: { name: string; raisedRange: [number, number]; valRange: [number, number] }[] = [
  { name: "Seed", raisedRange: [5_000_000, 12_000_000], valRange: [40_000_000, 90_000_000] },
  { name: "Series A", raisedRange: [15_000_000, 30_000_000], valRange: [150_000_000, 400_000_000] },
  { name: "Series B", raisedRange: [30_000_000, 50_000_000], valRange: [600_000_000, 1_500_000_000] },
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function rand(seed: number, lo: number, hi: number): number {
  // Deterministic LCG so synthetic data is stable per-seed.
  const x = (seed * 1664525 + 1013904223) >>> 0;
  const t = (x % 10_000) / 10_000;
  return Math.round(lo + (hi - lo) * t);
}

function pickInvestors(seed: number, count: number, leadCount: number): FundraisingInvestor[] {
  const out: FundraisingInvestor[] = [];
  const used = new Set<number>();
  for (let i = 0; i < count; i++) {
    let idx = (seed + i * 37) % VC_ROSTER.length;
    while (used.has(idx)) idx = (idx + 1) % VC_ROSTER.length;
    used.add(idx);
    const v = VC_ROSTER[idx];
    out.push({
      investor_id: 1000 + idx,
      name: v.name,
      logo_url: null,
      type: v.type,
      is_lead_investor: i < leadCount,
    });
  }
  return out;
}

/**
 * List all fundraising projects (id + name only).
 *
 * @throws never — synthetic fallback is returned on missing key / backoff.
 */
export async function listFundingProjects(): Promise<FundingProjectListItem[]> {
  return request<FundingProjectListItem[]>("/fundraising/projects", () =>
    SYNTHETIC_NAMES.map((name, i) => ({
      project_id: 9000 + i,
      project_name: name,
    })),
  );
}

/**
 * Fetch full fundraising detail for a single project.
 *
 * @throws never — synthetic fallback is returned on missing key / backoff.
 */
export async function getProjectFundraising(
  projectId: number,
  knownName?: string,
): Promise<FundraisingProjectDetail> {
  return request<FundraisingProjectDetail>(
    `/fundraising/projects/${encodeURIComponent(String(projectId))}`,
    () => syntheticDetail(projectId, knownName),
  );
}

function syntheticDetail(
  projectId: number,
  knownName?: string,
): FundraisingProjectDetail {
  // Only treat the projectId as a synthetic-list index when it falls inside
  // the canonical 9000+i range we generate ourselves. For any other id (live
  // API project that we're falling back for) use the caller-provided name or
  // a neutral placeholder — never invent an unrelated synthetic project name,
  // which would silently swap "Bitcoin" → "Pyth Network" in the detail page.
  const synIdx = projectId - 9000;
  const inSyntheticRange =
    Number.isFinite(projectId) &&
    synIdx >= 0 &&
    synIdx < SYNTHETIC_NAMES.length;
  const name =
    knownName?.trim() ||
    (inSyntheticRange ? SYNTHETIC_NAMES[synIdx] : `Project #${projectId}`);
  const seed = hash(name);

  const now = Date.now();
  const created = now - (180 + (seed % 540)) * 86_400_000;
  const updated = now - ((seed >> 4) % 14) * 86_400_000;

  const rounds: FundraisingRound[] = ROUND_TEMPLATES.map((tpl, i) => {
    const rseed = seed + i * 101;
    const raised = rand(rseed, tpl.raisedRange[0], tpl.raisedRange[1]);
    const valuation = rand(rseed + 7, tpl.valRange[0], tpl.valRange[1]);
    const investorCount = 4 + ((rseed >> 3) % 3); // 4..6
    const investors = pickInvestors(rseed, investorCount, 1 + ((rseed >> 5) % 2));
    const date = new Date(now - (ROUND_TEMPLATES.length - i) * 220 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    return {
      round_name: tpl.name,
      raised_amount: raised,
      valuation,
      date,
      investors,
    };
  });

  // Aggregate unique investors across rounds.
  const investorMap = new Map<number, FundraisingInvestor>();
  for (const r of rounds) {
    for (const inv of r.investors) {
      const existing = investorMap.get(inv.investor_id);
      if (!existing || (!existing.is_lead_investor && inv.is_lead_investor)) {
        investorMap.set(inv.investor_id, inv);
      }
    }
  }
  const investors = Array.from(investorMap.values());

  const team: FundraisingTeamMember[] = [
    { name: "Alex Chen", role: "Co-Founder & CEO", twitter: "alexchen" },
    { name: "Maria Rodriguez", role: "Co-Founder & CTO", twitter: "mrodriguez" },
    { name: "Sam Patel", role: "Head of Research", twitter: null },
  ];

  const ecosystems = ["Ethereum", "Solana", "Bitcoin", "Cosmos", "Polkadot"];
  const fundingStatuses = ["Active", "Funded", "Stealth", "Pre-Seed"];
  const portfolio: FundraisingPortfolioItem[] = Array.from({ length: 4 }, (_, i) => {
    const pseed = seed + i * 53;
    return {
      project_id: 8000 + ((pseed >> 2) % 200),
      name: `${name} Portfolio ${i + 1}`,
      ecosystem: ecosystems[(pseed >> 1) % ecosystems.length],
      funding_status: fundingStatuses[(pseed >> 3) % fundingStatuses.length],
    };
  });

  const investment_stats: FundraisingInvestmentStats = {
    total_rounds: rounds.length,
    lead_investments: investors.filter((i) => i.is_lead_investor).length,
    portfolio_count: portfolio.length,
    rounds_in_past_year: rounds.filter(
      (r) => now - new Date(r.date).getTime() < 365 * 86_400_000,
    ).length,
  };

  return {
    project_id: projectId,
    project_name: name,
    twitter_username: name.toLowerCase().replace(/\s+/g, ""),
    create_time: new Date(created).toISOString(),
    update_time: new Date(updated).toISOString(),
    fundraising_rounds: rounds,
    investors,
    team,
    investment_stats,
    portfolio,
  };
}
