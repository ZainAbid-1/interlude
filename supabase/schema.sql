-- ─────────────────────────────────────────────────────────────────────
-- Interlude — Supabase schema (Phase 1)
-- Paste into the Supabase SQL editor for your project.
-- ─────────────────────────────────────────────────────────────────────

create extension if not exists pgcrypto;

-- Profiles ------------------------------------------------------------
create table if not exists profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  display_name  text,
  avatar_url    text,
  spotify_user_id text,
  created_at    timestamptz not null default now()
);

-- Track pools (auto-generated from a chosen artist) --------------------
create table if not exists public.track_pools (
  id                uuid primary key default gen_random_uuid(),
  created_by        uuid references public.profiles (id) on delete cascade,
  spotify_artist_id text not null,
  artist_name       text not null,
  artist_image_url  text,
  created_at        timestamptz not null default now()
);

create table if not exists public.track_pool_tracks (
  id                uuid primary key default gen_random_uuid(),
  track_pool_id     uuid not null references public.track_pools (id) on delete cascade,
  position          int not null check (position between 1 and 10),
  spotify_track_id  text not null,
  track_name        text not null,
  album_art_url     text,
  preview_url       text not null,
  preview_source    text not null check (preview_source in ('itunes', 'deezer')),
  clip_start_ms     int not null default 0,
  unique (track_pool_id, position)
);

-- Rooms -----------------------------------------------------------------
create table if not exists public.rooms (
  id                uuid primary key default gen_random_uuid(),
  code              text not null unique,
  host_id           uuid references public.profiles (id),
  guest_id          uuid references public.profiles (id),
  track_pool_id     uuid not null references public.track_pools (id) on delete cascade,
  status            text not null default 'waiting' check (status in ('waiting', 'active', 'completed')),
  current_round     int not null default 0,
  round_started_at  timestamptz,
  created_at        timestamptz not null default now()
);

create index rooms_code_idx on public.rooms (code);
create index rooms_status_idx on public.rooms (status);

-- Rounds ----------------------------------------------------------------
create table if not exists public.rounds (
  id                   uuid primary key default gen_random_uuid(),
  room_id              uuid not null references public.rooms (id) on delete cascade,
  round_index          int not null check (round_index between 1 and 10),
  track_pool_track_id  uuid not null references public.track_pool_tracks (id),
  options              jsonb not null default '[]'::jsonb, -- 4 track-name choices
  correct_answer       text not null,
  round_started_at     timestamptz
);

create index rounds_room_idx on public.rounds (room_id, round_index);

-- Round answers ----------------------------------------------------------
create table if not exists public.round_answers (
  id              uuid primary key default gen_random_uuid(),
  round_id        uuid not null references public.rounds (id) on delete cascade,
  player_id       uuid references public.profiles (id),
  choice          text not null,
  response_ms     int,
  is_correct      boolean,
  points_awarded  int default 0,
  answered_at     timestamptz not null default now(),
  unique (round_id, player_id)
);

-- Match results ----------------------------------------------------------
create table if not exists public.match_results (
  id              uuid primary key default gen_random_uuid(),
  room_id         uuid not null references public.rooms (id) on delete cascade,
  player_id       uuid references public.profiles (id),
  total_score     int not null default 0,
  correct_count   int not null default 0,
  avg_response_ms int,
  outcome         text check (outcome in ('win', 'loss', 'draw')),
  unique (room_id, player_id)
);

-- Realtime ----------------------------------------------------------------
alter publication supabase_realtime add table public.rooms;
alter publication supabase_realtime add table public.rounds;
alter publication supabase_realtime add table public.round_answers;

-- Row Level Security -----------------------------------------------------
-- NOTE: tighten these once Supabase Auth is wired up. For the demo the
-- anon key can read/write rooms and pools; scoring writes (round_answers
-- points/is_correct, match_results) should later move to a service-role
-- Edge Function as per the PRD.
alter table public.profiles enable row level security;
alter table public.track_pools enable row level security;
alter table public.track_pool_tracks enable row level security;
alter table public.rooms enable row level security;
alter table public.rounds enable row level security;
alter table public.round_answers enable row level security;
alter table public.match_results enable row level security;

create policy "own profile read"   on public.profiles for select using (auth.uid() = id);
create policy "own profile update" on public.profiles for update using (auth.uid() = id);
create policy "own profile insert" on public.profiles for insert with check (auth.uid() = id);

create policy "open read"      on public.track_pools      for select using (true);
create policy "open read"      on public.track_pool_tracks for select using (true);
create policy "open read"      on public.rooms            for select using (true);
create policy "open read"      on public.rounds           for select using (true);
create policy "open read"      on public.round_answers    for select using (true);
create policy "open read"      on public.match_results    for select using (true);

create policy "open insert" on public.track_pools       for insert with check (true);
create policy "open insert" on public.track_pool_tracks for insert with check (true);
create policy "open insert" on public.rooms             for insert with check (true);
create policy "open insert" on public.rounds            for insert with check (true);
create policy "open insert" on public.round_answers     for insert with check (true);
create policy "open insert" on public.match_results     for insert with check (true);