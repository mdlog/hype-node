-- 0003_pb_subscriptions.sql — subscriber positions mirrored from the HypeIndexVault.
create table public.pb_subscriptions (
  id                  uuid primary key default gen_random_uuid(),
  proposal_id         uuid not null references public.pb_proposals(id) on delete cascade,
  index_id            text not null,                 -- bytes32 vault indexId (0x..)
  subscriber_address  text not null,
  shares              numeric not null default 0,    -- on-chain position shares (WAD)
  status              text not null default 'active' check (status in ('active','redeemed')),
  first_subscribed_at timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (index_id, subscriber_address)
);
create index idx_pb_subs_proposal on public.pb_subscriptions (proposal_id);
create index idx_pb_subs_index_active on public.pb_subscriptions (index_id) where status = 'active';

alter table public.pb_subscriptions enable row level security;
create policy "service role only" on public.pb_subscriptions for all using (false);

create trigger trg_pb_subscriptions_updated_at before update on public.pb_subscriptions
  for each row execute function sys_set_updated_at();
