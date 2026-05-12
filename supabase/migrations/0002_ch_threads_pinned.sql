-- Pin support for chat threads.
--
-- The sidebar lets users pin a few important conversations to the top of
-- the list. Sort order becomes: pinned threads first (most-recent activity
-- within), then unpinned threads. The existing single-column index on
-- (user_address, updated_at desc) is replaced with a three-column index
-- so the new sort can be served from the index without a sort step.

alter table public.ch_threads
  add column if not exists pinned boolean not null default false;

drop index if exists idx_ch_threads_user_updated;

create index idx_ch_threads_user_pinned_updated
  on public.ch_threads (user_address, pinned desc, updated_at desc);
