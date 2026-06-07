-- 0006_pb_cancel_requests.sql — keeper-mediated cancel requests for pending deposits.
-- A subscriber cannot cancel on-chain (cancelDeposit is onlyKeeper).
-- The UX inserts a row here; the keeper checks this table before pullForDeposit
-- and, if a matching pending request exists, calls cancelDeposit instead.
create table public.pb_cancel_requests (
  deposit_id          bigint primary key,
  subscriber_address  text not null,
  index_id            text not null,
  requested_at        timestamptz not null default now(),
  status              text not null default 'pending' check (status in ('pending','honored','expired'))
);

create index idx_pb_cancel_requests_status on public.pb_cancel_requests (status) where status = 'pending';
create index idx_pb_cancel_requests_subscriber on public.pb_cancel_requests (subscriber_address);

alter table public.pb_cancel_requests enable row level security;
create policy "service role only" on public.pb_cancel_requests for all using (false);
