-- Vault earnings indexer: idempotency + block checkpoint.
--
-- The on-chain VaultIndexer re-scans overlapping block ranges, so pb_earnings
-- rows must be deduped. One real fee event = one (tx_hash, event_type,
-- proposal_id), so a partial unique index on that triple makes inserts
-- idempotent (the indexer upserts with on_conflict=ignore). Partial (tx_hash
-- not null) so manual/operator rows without a tx_hash are unaffected.

create unique index if not exists pb_earnings_onchain_uniq
  on public.pb_earnings (tx_hash, event_type, proposal_id)
  where tx_hash is not null;

-- Persisted block checkpoint so the daemon only ingests new blocks each tick.
create table if not exists public.sys_indexer_state (
  key         text primary key,
  last_block  bigint      not null default 0,
  updated_at  timestamptz not null default now()
);

-- Service-role only (same posture as pb_earnings / sys_risk_audit). The keeper
-- writes with the service key; no anon/auth access.
alter table public.sys_indexer_state enable row level security;
create policy "service role only" on public.sys_indexer_state for all using (false);
