-- Elo rating for the "All artists" leaderboard.
--
-- Ranking by total wins rewarded whoever played the most. With Elo everyone
-- starts at 1000 and each finished match moves points from the loser to the
-- winner, more for beating a stronger player and less for a weaker one:
--   K = 32;  expected = 1 / (1 + 10^((opponent - you) / 400))
--   change  = round(K * (result - expected))   result: win 1, draw 0.5, loss 0
--   e.g. 1000 beats 1000: +16;  beats 1200: +24;  beats 800: +8
-- Players with fewer than 5 rated matches are shown as "New" (provisional).
--
-- Run after security.sql, leaderboard.sql and scoring_device_time.sql.
-- Safe to run more than once. Existing finished matches are replayed in date
-- order the first time, so current players start with a fair rating.

-- ---------------------------------------------------------------------------
-- Tables (read only through the functions below: RLS on, no policies)
-- ---------------------------------------------------------------------------
create table if not exists public.player_ratings (
  player_id   uuid primary key references public.profiles (id) on delete cascade,
  rating      int not null default 1000,
  matches     int not null default 0,
  wins        int not null default 0,
  draws       int not null default 0,
  updated_at  timestamptz not null default now()
);
alter table public.player_ratings enable row level security;

-- One row per rated match: what was applied, so it is applied only once and
-- can be corrected if a later finalize changes the result.
create table if not exists public.match_ratings (
  room_id       uuid primary key references public.rooms (id) on delete cascade,
  host_id       uuid not null references public.profiles (id) on delete cascade,
  guest_id      uuid not null references public.profiles (id) on delete cascade,
  host_outcome  text not null check (host_outcome in ('win', 'loss', 'draw')),
  host_before   int not null,
  guest_before  int not null,
  host_delta    int not null,
  guest_delta   int not null,
  rated_at      timestamptz not null default now()
);
alter table public.match_ratings enable row level security;
create index if not exists match_ratings_host_idx on public.match_ratings (host_id);
create index if not exists match_ratings_guest_idx on public.match_ratings (guest_id);
create index if not exists player_ratings_rating_idx on public.player_ratings (rating desc);

revoke all on public.player_ratings from anon, authenticated;
revoke all on public.match_ratings from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Late answers: the first phone's finalize completes the room, which used to
-- block an answer still in the other phone's offline retry queue (that round
-- then counted as 0 in the saved result and the rating). Answers are now
-- accepted for 2 minutes after completion; the other phone's finalize then
-- recalculates and the rating is corrected.
-- ---------------------------------------------------------------------------
alter table public.rooms add column if not exists completed_at timestamptz;

drop policy if exists "round_answers: answer as yourself" on public.round_answers;
create policy "round_answers: answer as yourself" on public.round_answers
  for insert to authenticated with check (
    player_id = auth.uid()
    and exists (
      select 1 from rounds ro join rooms r on r.id = ro.room_id
      where ro.id = round_id
        and auth.uid() in (r.host_id, r.guest_id)
        and (
          r.status = 'active'
          or (r.status = 'completed' and r.completed_at > now() - interval '2 minutes')
        )
    )
  );

-- ---------------------------------------------------------------------------
-- Applying a match
-- ---------------------------------------------------------------------------
create or replace function public.apply_match_rating(p_room uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  k constant int := 32;
  r rooms;
  ho text;            -- host's outcome
  go text;            -- guest's outcome
  prev match_ratings;
  had_prev boolean;
  ra int;
  rb int;
  expected numeric;
  result numeric;
  d int;
begin
  -- Locking the room serialises the two phones' finalize calls.
  select * into r from rooms where id = p_room for update;
  if not found or r.status <> 'completed' or r.host_id is null or r.guest_id is null then
    return;
  end if;
  select outcome into ho from match_results where room_id = p_room and player_id = r.host_id;
  if ho is null or not exists (
    select 1 from match_results where room_id = p_room and player_id = r.guest_id
  ) then
    return;
  end if;
  go := case ho when 'win' then 'loss' when 'loss' then 'win' else 'draw' end;

  select * into prev from match_ratings where room_id = p_room;
  had_prev := found;
  if had_prev and prev.host_outcome = ho then
    return; -- already applied with this result
  end if;

  insert into player_ratings (player_id) values (r.host_id), (r.guest_id)
  on conflict (player_id) do nothing;

  if had_prev then
    -- A later finalize changed the result: undo the old change first.
    update player_ratings set
      rating = rating - prev.host_delta,
      matches = matches - 1,
      wins = wins - (prev.host_outcome = 'win')::int,
      draws = draws - (prev.host_outcome = 'draw')::int
    where player_id = prev.host_id;
    update player_ratings set
      rating = rating - prev.guest_delta,
      matches = matches - 1,
      wins = wins - (prev.host_outcome = 'loss')::int,
      draws = draws - (prev.host_outcome = 'draw')::int
    where player_id = prev.guest_id;
  end if;

  select rating into ra from player_ratings where player_id = r.host_id for update;
  select rating into rb from player_ratings where player_id = r.guest_id for update;

  expected := 1 / (1 + power(10::numeric, (rb - ra) / 400.0));
  result := case ho when 'win' then 1 when 'loss' then 0 else 0.5 end;
  d := round(k * (result - expected))::int;

  update player_ratings set
    rating = rating + d,
    matches = matches + 1,
    wins = wins + (ho = 'win')::int,
    draws = draws + (ho = 'draw')::int,
    updated_at = now()
  where player_id = r.host_id;
  update player_ratings set
    rating = rating - d,
    matches = matches + 1,
    wins = wins + (go = 'win')::int,
    draws = draws + (go = 'draw')::int,
    updated_at = now()
  where player_id = r.guest_id;

  insert into match_ratings (room_id, host_id, guest_id, host_outcome, host_before, guest_before, host_delta, guest_delta)
  values (p_room, r.host_id, r.guest_id, ho, ra, rb, d, -d)
  on conflict (room_id) do update set
    host_outcome = excluded.host_outcome,
    host_before = excluded.host_before,
    guest_before = excluded.guest_before,
    host_delta = excluded.host_delta,
    guest_delta = excluded.guest_delta,
    rated_at = now();
end;
$$;
-- Internal only: called by finalize_match, never by phones.
revoke execute on function public.apply_match_rating(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- finalize_match: same as security.sql, plus the rating update. Also returns
-- each player's new rating and the change from this match.
-- ---------------------------------------------------------------------------
drop function if exists public.finalize_match(uuid);
create function public.finalize_match(p_room uuid)
returns table (
  player_id uuid, total_score int, correct_count int, avg_response_ms int, outcome text,
  rating int, rating_change int
)
language plpgsql security definer set search_path = public
as $$
#variable_conflict use_column
declare
  me uuid := auth.uid();
  r rooms;
begin
  select * into r from rooms where id = p_room;
  if not found or me is null or me not in (r.host_id, r.guest_id) then
    raise exception 'You are not a player in this room';
  end if;
  if r.guest_id is null then
    raise exception 'This match has no opponent';
  end if;
  if r.status not in ('active', 'completed') then
    raise exception 'This match has not started';
  end if;

  insert into match_results (room_id, player_id, total_score, correct_count, avg_response_ms, outcome)
  select p_room, pl.pid, s.score, s.correct, s.avg_ms, null
  from (values (r.host_id), (r.guest_id)) as pl(pid)
  cross join lateral (
    select coalesce(sum(a.points_awarded), 0)::int as score,
           (count(*) filter (where a.is_correct))::int as correct,
           avg(a.response_ms)::int as avg_ms
    from round_answers a
    join rounds ro on ro.id = a.round_id
    where ro.room_id = p_room and a.player_id = pl.pid
  ) s
  on conflict (room_id, player_id) do update
    set total_score = excluded.total_score,
        correct_count = excluded.correct_count,
        avg_response_ms = excluded.avg_response_ms;

  update match_results m
  set outcome = case
    when m.total_score > o.total_score then 'win'
    when m.total_score < o.total_score then 'loss'
    else 'draw'
  end
  from match_results o
  where m.room_id = p_room and o.room_id = p_room and o.player_id <> m.player_id;

  update rooms set status = 'completed', completed_at = now()
  where id = p_room and status <> 'completed';

  perform public.apply_match_rating(p_room);

  return query
    select m.player_id, m.total_score, m.correct_count, m.avg_response_ms, m.outcome,
           pr.rating,
           case when m.player_id = mr.host_id then mr.host_delta else mr.guest_delta end
    from match_results m
    left join player_ratings pr on pr.player_id = m.player_id
    left join match_ratings mr on mr.room_id = p_room
    where m.room_id = p_room;
end;
$$;
revoke execute on function public.finalize_match(uuid) from public, anon;
grant execute on function public.finalize_match(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Leaderboard: per-artist boards unchanged (best single match); "All
-- artists" (p_artist null) now ranks by rating.
--   All time:    by current rating.
--   Last 7 days: players who played in the last 7 days, by rating gained.
-- New columns: rating_change (last 7 days) and provisional (< 5 matches).
-- ---------------------------------------------------------------------------
drop function if exists public.artist_leaderboard(text, text, text);
create function public.artist_leaderboard(
  p_artist text default null,
  p_scope text default 'friends',
  p_period text default 'all'
)
returns table (
  rank int, player_id uuid, username text, display_name text, avatar_url text,
  score int, correct int, avg_ms int, matches int, wins int,
  is_me boolean, is_friend boolean, total int,
  rating_change int, provisional boolean
)
language plpgsql stable security definer set search_path = public
as $$
#variable_conflict use_column
declare
  global_scope boolean := coalesce(p_scope, 'friends') = 'global';
  week boolean := coalesce(p_period, 'all') = 'week';
begin
  if auth.uid() is null then
    return;
  end if;

  if p_artist is not null then
    -- Per artist: each player's best single match.
    return query
    with friends as (
      select case when f.requester_id = auth.uid() then f.addressee_id else f.requester_id end as fid
      from friendships f
      where f.status = 'accepted' and auth.uid() in (f.requester_id, f.addressee_id)
    ),
    m as (
      select mr.player_id as pid, mr.total_score as ts, mr.correct_count as cc,
             mr.avg_response_ms as am, mr.outcome as oc, r.created_at as at
      from match_results mr
      join rooms r on r.id = mr.room_id and r.status = 'completed'
      join track_pools tp on tp.id = r.track_pool_id
      where public.lb_artist_key(tp.artist_name) = p_artist
        and (not week or r.created_at >= now() - interval '7 days')
    ),
    eligible as (
      select p.id as eid, p.username as un, p.display_name as dn, p.avatar_url as av,
             p.id = auth.uid() as me,
             exists (select 1 from friends fr where fr.fid = p.id) as fr
      from profiles p
      where p.id in (select m.pid from m)
        and (
          p.id = auth.uid()
          or exists (select 1 from friends fr where fr.fid = p.id)
          or (global_scope and p.username is not null and p.discoverable)
        )
    ),
    best as (
      select distinct on (m.pid) m.pid, m.ts, m.cc, m.am, m.at
      from m
      order by m.pid, m.ts desc, m.am asc nulls last, m.at asc
    ),
    agg as (
      select m.pid, count(*)::int as n, (count(*) filter (where m.oc = 'win'))::int as w
      from m group by m.pid
    ),
    ranked as (
      select e.*, b.ts, b.cc, b.am, a.n, a.w,
             (row_number() over (order by b.ts desc, b.am asc nulls last, b.at asc))::int as rnk,
             (count(*) over ())::int as tot
      from eligible e
      join best b on b.pid = e.eid
      join agg a on a.pid = e.eid
    )
    select rk.rnk, rk.eid, rk.un, rk.dn, rk.av, rk.ts, rk.cc, rk.am, rk.n, rk.w,
           rk.me, rk.fr, rk.tot, null::int, false
    from ranked rk
    where rk.me or rk.rnk <= case when global_scope then 25 else 100 end
    order by rk.rnk;
    return;
  end if;

  -- All artists: Elo rating.
  return query
  with friends as (
    select case when f.requester_id = auth.uid() then f.addressee_id else f.requester_id end as fid
    from friendships f
    where f.status = 'accepted' and auth.uid() in (f.requester_id, f.addressee_id)
  ),
  recent as (
    select x.pid, sum(x.delta)::int as gained
    from (
      select mr.host_id as pid, mr.host_delta as delta, r.created_at as at
      from match_ratings mr join rooms r on r.id = mr.room_id
      union all
      select mr.guest_id, mr.guest_delta, r.created_at
      from match_ratings mr join rooms r on r.id = mr.room_id
    ) x
    where x.at >= now() - interval '7 days'
    group by x.pid
  ),
  eligible as (
    select p.id as eid, p.username as un, p.display_name as dn, p.avatar_url as av,
           pr.rating as rt, pr.matches as n, pr.wins as w,
           p.id = auth.uid() as me,
           exists (select 1 from friends fr where fr.fid = p.id) as fr,
           rc.gained
    from player_ratings pr
    join profiles p on p.id = pr.player_id
    left join recent rc on rc.pid = pr.player_id
    where pr.matches > 0
      and (not week or rc.pid is not null)
      and (
        p.id = auth.uid()
        or exists (select 1 from friends fr where fr.fid = p.id)
        or (global_scope and p.username is not null and p.discoverable)
      )
  ),
  ranked as (
    select e.*,
           (row_number() over (
             order by
               case when week then e.gained end desc nulls last,
               e.rt desc,
               e.n desc,
               e.eid
           ))::int as rnk,
           (count(*) over ())::int as tot
    from eligible e
  )
  select rk.rnk, rk.eid, rk.un, rk.dn, rk.av, rk.rt, null::int, null::int, rk.n, rk.w,
         rk.me, rk.fr, rk.tot, coalesce(rk.gained, 0), rk.n < 5
  from ranked rk
  where rk.me or rk.rnk <= case when global_scope then 50 else 100 end
  order by rk.rnk;
end;
$$;
revoke execute on function public.artist_leaderboard(text, text, text) from public, anon;
grant execute on function public.artist_leaderboard(text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- First run only: replay every finished match in date order.
-- ---------------------------------------------------------------------------
do $$
declare
  rid uuid;
begin
  if exists (select 1 from match_ratings) then
    return;
  end if;
  for rid in
    select r.id
    from rooms r
    where r.status = 'completed'
      and r.guest_id is not null
      and (select count(*) from match_results m where m.room_id = r.id) = 2
    order by r.created_at
  loop
    perform public.apply_match_rating(rid);
  end loop;
end;
$$;
