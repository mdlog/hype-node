/**
 * Per-wallet usage tracking + free-tier enforcement + paid top-up balance.
 *
 * Storage model — JSON file at `.billing/usage.json`. Multi-process unsafe
 * (last-write wins) but adequate for single-Next.js-instance dev/demo. Swap
 * for Postgres / Redis when traffic warrants. The store is keyed by lower-
 * cased wallet address from the SIWE session.
 *
 * Cost model — Anthropic pricing per 1M tokens, current as of 2026-04. Cache
 * writes are 1.25× input, cache reads 0.1× input. We deduct from the daily
 * free quota first; any spend above `FREE_DAILY_SPEND_USD` is taken from the
 * user's `paid_balance_usd` (top-up balance, persistent across days). When
 * both are zero, /api/chat returns 402 Payment Required.
 */

import fs from "node:fs";
import path from "node:path";

// Vercel serverless functions only allow writes to `/tmp`. `process.cwd()`
// resolves to `/var/task` which is read-only — mkdir there throws ENOENT and
// crashes /api/chat. On Vercel we fall back to `/tmp/.billing`; note it is
// ephemeral (wiped between cold starts) so usage tracking resets periodically.
// Override with BILLING_DIR for self-hosted Node deployments.
const STORE_DIR =
  process.env.BILLING_DIR ??
  (process.env.VERCEL ? "/tmp/.billing" : path.join(process.cwd(), ".billing"));
const STORE_FILE = path.join(STORE_DIR, "usage.json");

// Free-tier caps — small intentionally so users hit the wall and exercise
// the top-up flow on a demo deployment. Override via env in production.
export const FREE_DAILY_SPEND_USD = Number(
  process.env.FREE_DAILY_SPEND_USD ?? 0.5,
);
export const FREE_DAILY_TOKENS = Number(
  process.env.FREE_DAILY_TOKENS ?? 100_000,
);
export const FREE_DAILY_CALLS = Number(
  process.env.FREE_DAILY_CALLS ?? 200,
);

// LLM pricing per 1M tokens, keyed by the model id the agent reports back in
// reply.usage.model. Covers both providers so the meter prices whatever the
// agent actually ran (LLM_PROVIDER lives in agent-service/.env, not here).
// Anthropic: Sonnet 4.5/4.6 share the same card. OpenAI: gpt-4o family.
const PRICING: Record<string, { input: number; output: number }> = {
  "claude-sonnet-4-5": { input: 3.0, output: 15.0 },
  "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
  "claude-haiku-4-5": { input: 1.0, output: 5.0 },
  "claude-opus-4-6": { input: 5.0, output: 25.0 },
  "claude-opus-4-7": { input: 5.0, output: 25.0 },
  "gpt-4o": { input: 2.5, output: 10.0 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
};

export type UsageBlock = {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
};

export function priceForModel(model: string): { input: number; output: number } {
  return PRICING[model] ?? PRICING["claude-sonnet-4-5"];
}

export function spendFromUsage(model: string, u: UsageBlock): number {
  const p = priceForModel(model);
  return (
    (u.input_tokens * p.input +
      u.output_tokens * p.output +
      u.cache_creation_tokens * p.input * 1.25 +
      u.cache_read_tokens * p.input * 0.1) /
    1_000_000
  );
}

export type DailyUsage = {
  date: string;
  spend_usd: number;
  tokens: number;
  calls: number;
};

export type Account = {
  address: string;
  daily: DailyUsage;
  paid_balance_usd: number;
  top_ups: { ts: string; amount_usd: number }[];
};

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptyDaily(): DailyUsage {
  return { date: todayKey(), spend_usd: 0, tokens: 0, calls: 0 };
}

function emptyAccount(address: string): Account {
  return {
    address,
    daily: emptyDaily(),
    paid_balance_usd: 0,
    top_ups: [],
  };
}

function ensureStore(): void {
  if (!fs.existsSync(STORE_DIR)) {
    fs.mkdirSync(STORE_DIR, { recursive: true });
  }
  if (!fs.existsSync(STORE_FILE)) {
    fs.writeFileSync(STORE_FILE, "{}", "utf8");
  }
}

function loadAll(): Record<string, Account> {
  ensureStore();
  try {
    const raw = fs.readFileSync(STORE_FILE, "utf8");
    return JSON.parse(raw) as Record<string, Account>;
  } catch {
    return {};
  }
}

function saveAll(data: Record<string, Account>): void {
  ensureStore();
  fs.writeFileSync(STORE_FILE, JSON.stringify(data, null, 2), "utf8");
}

function rolloverIfStale(a: Account): Account {
  if (a.daily.date !== todayKey()) {
    return { ...a, daily: emptyDaily() };
  }
  return a;
}

export function getAccount(address: string): Account {
  const all = loadAll();
  const a = all[address.toLowerCase()];
  return rolloverIfStale(a ?? emptyAccount(address.toLowerCase()));
}

export type AccountSnapshot = {
  address: string;
  daily: DailyUsage;
  paid_balance_usd: number;
  caps: {
    free_daily_spend_usd: number;
    free_daily_tokens: number;
    free_daily_calls: number;
  };
  free_daily_left_usd: number;
  total_available_usd: number;
  blocked: boolean;
  block_reason: string | null;
  top_ups: { ts: string; amount_usd: number }[];
};

export function getSnapshot(address: string): AccountSnapshot {
  const a = getAccount(address);
  const free_daily_left_usd = Math.max(0, FREE_DAILY_SPEND_USD - a.daily.spend_usd);
  const total_available_usd = free_daily_left_usd + a.paid_balance_usd;

  let blocked = false;
  let reason: string | null = null;
  if (total_available_usd <= 0) {
    blocked = true;
    reason = "Daily free spend exhausted — top up to continue.";
  } else if (a.daily.tokens >= FREE_DAILY_TOKENS && a.paid_balance_usd <= 0) {
    blocked = true;
    reason = "Daily free token cap reached — top up to continue.";
  } else if (a.daily.calls >= FREE_DAILY_CALLS && a.paid_balance_usd <= 0) {
    blocked = true;
    reason = "Daily free tool-call cap reached — top up to continue.";
  }

  return {
    address: a.address,
    daily: a.daily,
    paid_balance_usd: a.paid_balance_usd,
    caps: {
      free_daily_spend_usd: FREE_DAILY_SPEND_USD,
      free_daily_tokens: FREE_DAILY_TOKENS,
      free_daily_calls: FREE_DAILY_CALLS,
    },
    free_daily_left_usd,
    total_available_usd,
    blocked,
    block_reason: reason,
    top_ups: a.top_ups.slice(-10),
  };
}

export function canSend(address: string): { allowed: boolean; reason?: string } {
  const snap = getSnapshot(address);
  return snap.blocked
    ? { allowed: false, reason: snap.block_reason ?? "blocked" }
    : { allowed: true };
}

export function recordUsage(
  address: string,
  model: string,
  usage: UsageBlock,
  toolCallsThisTurn: number,
): AccountSnapshot {
  const all = loadAll();
  const key = address.toLowerCase();
  let a = all[key] ?? emptyAccount(key);
  a = rolloverIfStale(a);

  const cost = spendFromUsage(model, usage);
  const totalTokens =
    usage.input_tokens +
    usage.output_tokens +
    usage.cache_read_tokens +
    usage.cache_creation_tokens;

  // Snapshot of the over-cap delta before AND after applying this turn —
  // the difference is what comes out of paid_balance. Free quota covers
  // everything until daily.spend exceeds the cap.
  const prevOver = Math.max(0, a.daily.spend_usd - FREE_DAILY_SPEND_USD);
  a.daily.spend_usd += cost;
  a.daily.tokens += totalTokens;
  a.daily.calls += toolCallsThisTurn;
  const newOver = Math.max(0, a.daily.spend_usd - FREE_DAILY_SPEND_USD);
  const deductFromPaid = newOver - prevOver;
  if (deductFromPaid > 0) {
    a.paid_balance_usd = Math.max(0, a.paid_balance_usd - deductFromPaid);
  }

  all[key] = a;
  saveAll(all);
  return getSnapshot(key);
}

export function topUp(address: string, amount_usd: number): AccountSnapshot {
  if (!Number.isFinite(amount_usd) || amount_usd <= 0) {
    throw new Error("amount must be a positive number");
  }
  if (amount_usd > 1000) {
    throw new Error("max top-up is $1000 per request");
  }
  const all = loadAll();
  const key = address.toLowerCase();
  let a = all[key] ?? emptyAccount(key);
  a = rolloverIfStale(a);
  a.paid_balance_usd += amount_usd;
  a.top_ups.push({ ts: new Date().toISOString(), amount_usd });
  all[key] = a;
  saveAll(all);
  return getSnapshot(key);
}
