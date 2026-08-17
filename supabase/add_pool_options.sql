-- ─────────────────────────────────────────────────────────────────────
-- Interlude — add track_pool_options (wider-catalog answer distractors)
-- Paste into the Supabase SQL editor for your project.
-- Idempotent: safe to run against a database that already has the table.
-- ─────────────────────────────────────────────────────────────────────

create table if not exists public.track_pool_options (
  id            uuid primary key default gen_random_uuid(),
  track_pool_id uuid not null references public.track_pools (id) on delete cascade,
  position      int not null default 0,
  track_name    text not null,
  created_at    timestamptz not null default now(),
  unique (track_pool_id, position)
);

create index if not exists track_pool_options_pool_idx
  on public.track_pool_options (track_pool_id);

alter table public.track_pool_options enable row level security;

create policy "open read"   on public.track_pool_options for select using (true);
create policy "open insert" on public.track_pool_options for insert with check (true);