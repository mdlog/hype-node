-- 0004_pt_track_record.sql — strategy track-record tables.
-- pt_rebalances stores one row per agent cycle that executes trades.
-- pt_trades stores the per-asset SoDEX trade results linked to a rebalance.

create table public.pt_rebalances (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  sector            text not null,
  ssi_ticker        text,
  creator_address   text,
  basket_before     jsonb,
  basket_after      jsonb,
  strategy_source   text,
  sentiment_score   numeric,
  risk_verdict      text,
  ssi_tx_hash       text,
  sodex_placed      int not null default 0,
  sodex_skipped     int not null default 0,
  sodex_errors      int not null default 0,
  emergency         bool not null default false
);

create index idx_pt_rebalances_ssi_ticker     on public.pt_rebalances (ssi_ticker);
create index idx_pt_rebalances_creator_address on public.pt_rebalances (creator_address);

alter table public.pt_rebalances enable row level security;
create policy "service role only" on public.pt_rebalances for all using (false);

-- ------------------------------------------------------------------

create table public.pt_trades (
  id             uuid primary key default gen_random_uuid(),
  rebalance_id   uuid not null references public.pt_rebalances(id) on delete cascade,
  created_at     timestamptz not null default now(),
  symbol         text,
  weight         numeric,
  amount_in_usdc numeric,
  limit_price    text,
  last_price     text,
  quantity       text,
  notional       numeric,
  gas_val        numeric,
  latency_ms     int,
  order_id       text,
  cl_ord_id      text,
  pair           text,
  mode           text,
  status         text,
  error          text
);

create index idx_pt_trades_rebalance_id on public.pt_trades (rebalance_id);

alter table public.pt_trades enable row level security;
create policy "service role only" on public.pt_trades for all using (false);
