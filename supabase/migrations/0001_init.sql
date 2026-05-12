-- HypeNode — initial schema (Phase 0)
--
-- All tables in `public` schema, namespaced by domain prefix:
--   bt_*  backtest
--   bd_*  builder
--   ch_*  chat
--   pf_*  portfolio
--   pb_*  publisher
--   sys_* system / cross-cutting
--
-- Auth model: SIWE wallet address (0x…) is the canonical user id, stored as
-- text in `user_address`. We do NOT use Supabase Auth — server-side route
-- handlers verify the iron-session cookie and inject `user_address` into
-- queries. RLS policies are PERMISSIVE because all access is gated by the
-- service role + manual `where user_address = $1` filters in app code.
--
-- Lower-cased the wallet address before insert/lookup to keep equality
-- predictable (some wallets return mixed-case checksum, some lowercase).

create extension if not exists "pgcrypto";

-- Helper: short, URL-safe, collision-resistant id for share links.
create or replace function sys_short_id(len int default 10) returns text
language plpgsql as $$
declare
  alphabet text := 'abcdefghijkmnpqrstuvwxyz23456789';
  result text := '';
  i int;
begin
  for i in 1..len loop
    result := result || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return result;
end;
$$;

-- Helper: updated_at trigger
create or replace function sys_set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- =====================================================================
-- BACKTEST (Phase 1)
-- =====================================================================

create table public.bt_runs (
  id uuid primary key default gen_random_uuid(),
  user_address text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  -- Inputs
  strategy_ticker text not null,
  days int not null check (days > 0 and days <= 365),
  constituents jsonb not null,        -- [{currency_id, symbol, weight}]

  -- Result metrics
  return_total numeric,
  sharpe numeric,
  sortino numeric,
  max_drawdown numeric,
  win_rate numeric,
  vs_btc numeric,
  vs_eth numeric,
  n_assets int,
  n_returns int,

  -- Series + raw envelope (for replay / audit)
  equity_preview jsonb,               -- number[]
  raw_result jsonb,

  -- User metadata
  label text,
  notes text,
  tags text[]
);

create index idx_bt_runs_user_created on public.bt_runs (user_address, created_at desc);
create index idx_bt_runs_tags on public.bt_runs using gin (tags);

create trigger trg_bt_runs_updated_at before update on public.bt_runs
  for each row execute function sys_set_updated_at();

-- Public share links (read-only, time-limited optional)
create table public.bt_share_links (
  short_code text primary key default sys_short_id(10),
  run_id uuid not null references public.bt_runs(id) on delete cascade,
  created_by text not null,           -- user_address creator
  created_at timestamptz default now(),
  expires_at timestamptz,             -- null = never
  view_count int default 0
);

create index idx_bt_share_run on public.bt_share_links (run_id);

-- =====================================================================
-- BUILDER drafts (Phase 2)
-- =====================================================================

create table public.bd_drafts (
  id uuid primary key default gen_random_uuid(),
  user_address text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  -- Draft contents — schema mirrors builder/page.tsx state
  name text,                          -- user-given draft name
  sector text,                        -- "DePIN", "RWA", etc.
  n_assets int,
  weighting_rule text,                -- "equal", "market_cap_weighted", etc.
  constituents jsonb,                 -- BasketProposal.constituents shape
  extra_assets jsonb,                 -- user-added extras
  meta jsonb,                         -- { name, symbol, base, chain, fee, ... }
  rebalance_triggers jsonb,           -- { onCadence, onSentiment, onDrawdown, ... }

  -- Lifecycle
  status text default 'draft' check (status in ('draft', 'simulated', 'deployed', 'archived'))
);

create index idx_bd_drafts_user_updated on public.bd_drafts (user_address, updated_at desc);

create trigger trg_bd_drafts_updated_at before update on public.bd_drafts
  for each row execute function sys_set_updated_at();

-- =====================================================================
-- CHAT (Phase 2)
-- =====================================================================

create table public.ch_threads (
  id uuid primary key default gen_random_uuid(),
  user_address text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  title text,                         -- auto-generated from first user msg
  archived boolean default false
);

create index idx_ch_threads_user_updated on public.ch_threads (user_address, updated_at desc);

create trigger trg_ch_threads_updated_at before update on public.ch_threads
  for each row execute function sys_set_updated_at();

create table public.ch_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.ch_threads(id) on delete cascade,
  user_address text not null,         -- denormalized for fast filter
  created_at timestamptz default now(),

  role text not null check (role in ('user', 'assistant', 'system', 'tool')),
  content text,
  tool_calls jsonb,                   -- ToolCallTrace[]
  usage jsonb,                        -- ChatUsage

  seq int not null                    -- ordering within thread (0,1,2,…)
);

create index idx_ch_messages_thread_seq on public.ch_messages (thread_id, seq);
create index idx_ch_messages_user_created on public.ch_messages (user_address, created_at desc);

-- =====================================================================
-- PORTFOLIO snapshots (Phase 3)
-- =====================================================================

create table public.pf_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_address text not null,
  taken_at timestamptz default now(),

  -- Position state at snapshot time
  positions jsonb not null,           -- [{ index_id, basket_id, shares, nav_usd, pnl_usd }]
  total_aum_usd numeric,
  total_pnl_usd numeric,

  -- Reference benchmarks for compare
  benchmark_btc_price numeric,
  benchmark_eth_price numeric,
  benchmark_ssimag7_nav numeric,

  -- Trigger metadata
  trigger text default 'manual' check (trigger in ('manual', 'cron_daily', 'cron_hourly', 'event'))
);

create index idx_pf_snapshots_user_taken on public.pf_snapshots (user_address, taken_at desc);

-- =====================================================================
-- PUBLISHER (Phase 4)
-- =====================================================================
-- Replaces the mock /api/proposals route.

create table public.pb_proposals (
  id uuid primary key default gen_random_uuid(),
  creator_address text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  -- Proposal contents
  ssi_ticker text not null,           -- "ssiAI", "ssiDePIN", etc.
  title text,
  thesis text,                        -- creator's narrative
  constituents jsonb not null,
  meta jsonb,                         -- { name, symbol, fee_bps, rebalance_cadence }

  -- Source: drafted by agent vs. crafted by creator
  source text default 'manual' check (source in ('manual', 'agent_draft', 'hype_radar')),
  source_run_id uuid references public.bt_runs(id) on delete set null,

  -- Lifecycle
  status text default 'draft' check (status in ('draft', 'review', 'signed', 'published', 'live', 'paused', 'rejected')),
  on_chain_tx text,                   -- tx hash when published
  on_chain_index_id text,             -- bytes32 id from SSI Registry

  -- Backtest snapshot at proposal time
  backtest_return numeric,
  backtest_sharpe numeric,
  backtest_max_dd numeric
);

create index idx_pb_proposals_creator_created on public.pb_proposals (creator_address, created_at desc);
create index idx_pb_proposals_status on public.pb_proposals (status);

create trigger trg_pb_proposals_updated_at before update on public.pb_proposals
  for each row execute function sys_set_updated_at();

create table public.pb_earnings (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.pb_proposals(id) on delete cascade,
  creator_address text not null,
  accrued_at timestamptz default now(),

  -- Fee event
  event_type text not null check (event_type in ('mgmt_fee', 'perf_fee', 'subscription_fee', 'manual')),
  amount_usd numeric not null,
  tx_hash text,
  block_number bigint,

  -- AUM snapshot at accrual
  aum_usd_at_accrual numeric,
  subscriber_count int
);

create index idx_pb_earnings_proposal_accrued on public.pb_earnings (proposal_id, accrued_at desc);
create index idx_pb_earnings_creator_accrued on public.pb_earnings (creator_address, accrued_at desc);

-- =====================================================================
-- RISK audit log (Phase 5)
-- =====================================================================

create table public.sys_risk_audit (
  id uuid primary key default gen_random_uuid(),
  user_address text not null,
  changed_at timestamptz default now(),
  config_before jsonb,
  config_after jsonb,
  change_source text                  -- 'ui', 'api', 'agent_override'
);

create index idx_risk_audit_user_changed on public.sys_risk_audit (user_address, changed_at desc);

-- =====================================================================
-- USER settings (Phase 5)
-- =====================================================================

create table public.sys_user_settings (
  user_address text primary key,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  -- UI preferences
  theme text default 'dark',
  default_period text default '3M',
  default_strategy text default 'ssiDePIN',

  -- Notification preferences
  email text,
  notify_on_drawdown boolean default false,
  notify_on_rebalance boolean default false,
  notify_on_publish boolean default true,

  -- Free-form user metadata
  display_name text,
  twitter_handle text,
  bio text
);

create trigger trg_user_settings_updated_at before update on public.sys_user_settings
  for each row execute function sys_set_updated_at();

-- =====================================================================
-- RLS — permissive at table level; access control happens in app code
-- via service role + manual filter on user_address.
-- =====================================================================

-- All tables: enable RLS but use permissive policies. Only the service role
-- key (server-side) ever connects to Supabase. Anon key is unused.
alter table public.bt_runs enable row level security;
alter table public.bt_share_links enable row level security;
alter table public.bd_drafts enable row level security;
alter table public.ch_threads enable row level security;
alter table public.ch_messages enable row level security;
alter table public.pf_snapshots enable row level security;
alter table public.pb_proposals enable row level security;
alter table public.pb_earnings enable row level security;
alter table public.sys_risk_audit enable row level security;
alter table public.sys_user_settings enable row level security;

-- Service role bypasses RLS automatically. We add a "deny anon" policy so
-- if NEXT_PUBLIC_SUPABASE_ANON_KEY is ever used by mistake it returns empty
-- instead of leaking everything.
create policy "service role only" on public.bt_runs for all using (false);
create policy "service role only" on public.bt_share_links for all using (false);
create policy "service role only" on public.bd_drafts for all using (false);
create policy "service role only" on public.ch_threads for all using (false);
create policy "service role only" on public.ch_messages for all using (false);
create policy "service role only" on public.pf_snapshots for all using (false);
create policy "service role only" on public.pb_proposals for all using (false);
create policy "service role only" on public.pb_earnings for all using (false);
create policy "service role only" on public.sys_risk_audit for all using (false);
create policy "service role only" on public.sys_user_settings for all using (false);

-- One exception: bt_share_links public READ for share-by-code.
create policy "share links public read" on public.bt_share_links
  for select using (true);
