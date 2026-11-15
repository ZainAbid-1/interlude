-- ─────────────────────────────────────────────────────────────────────
-- Interlude — lock down the game tables
-- Run once in the Supabase SQL editor, after schema.sql, friends.sql and
-- invites.sql. Safe to re-run.
--
-- schema.sql shipped demo policies ("using (true)") that let anyone with
-- the public anon key read every room/round/answer (including correct
-- answers and join codes), rewrite any room, insert answers as anyone and
-- write anyone's match results. This replaces them with:
--   • game data readable only by the two players in that room
--   • rooms created and changed only by their host (and only the columns
--     the game actually changes); joining goes through join_room()
--   • answers graded on the server from the stored correct answer
--   • final results computed and written on the server (finalize_match)
-- ─────────────────────────────────────────────────────────────────────

-- Remove the demo policies ---------------------------------------------------
drop policy if exists "open read"   on public.track_pools;
drop policy if exists "open read"   on public.track_pool_tracks;
drop policy if exists "open read"   on public.track_pool_options;
drop policy if exists "open read"   on public.rooms;
drop policy if exists "open read"   on public.rounds;
drop policy if exists "open read"   on public.round_answers;
drop policy if exists "open read"   on public.match_results;
drop policy if exists "open insert" on public.track_pools;
drop policy if exists "open insert" on public.track_pool_tracks;
drop policy if exists "open insert" on public.track_pool_options;
drop policy if exists "open insert" on public.rooms;
drop policy if exists "open insert" on public.rounds;
drop policy if exists "open insert" on public.round_answers;
drop policy if exists "open insert" on public.match_results;
drop policy if exists "open update" on public.rooms;

-- Helper: is the caller one of the two players in this room? ---------------
-- SECURITY DEFINER so policies on other tables can use it without tripping
-- over the rooms policy themselves.
create or replace function public.is_room_member(p_room uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from rooms r
    where r.id = p_room and auth.uid() is not null and auth.uid() in (r.host_id, r.guest_id)
  );
$$;
revoke execute on function public.is_room_member(uuid) from public, anon;
grant execute on function public.is_room_member(uuid) to authenticated;

-- Track pools (song lists): not secret, but only signed-in players read
-- them and only the creator writes them.
drop policy if exists "track_pools: read" on public.track_pools;
drop policy if exists "track_pools: create own" on public.track_pools;
create policy "track_pools: read" on public.track_pools
  for select to authenticated using (true);
create policy "track_pools: create own" on public.track_pools
  for insert to authenticated with check (created_by = auth.uid());

drop policy if exists "track_pool_tracks: read" on public.track_pool_tracks;
drop policy if exists "track_pool_tracks: create own" on public.track_pool_tracks;
create policy "track_pool_tracks: read" on public.track_pool_tracks
  for select to authenticated using (true);
create policy "track_pool_tracks: create own" on public.track_pool_tracks
  for insert to authenticated with check (
    exists (select 1 from track_pools p where p.id = track_pool_id and p.created_by = auth.uid())
  );

drop policy if exists "track_pool_options: read" on public.track_pool_options;
drop policy if exists "track_pool_options: create own" on public.track_pool_options;
create policy "track_pool_options: read" on public.track_pool_options
  for select to authenticated using (true);
create policy "track_pool_options: create own" on public.track_pool_options
  for insert to authenticated with check (
    exists (select 1 from track_pools p where p.id = track_pool_id and p.created_by = auth.uid())
  );

-- Rooms -----------------------------------------------------------------------
drop policy if exists "rooms: players read" on public.rooms;
drop policy if exists "rooms: host creates" on public.rooms;
drop policy if exists "rooms: host updates" on public.rooms;
create policy "rooms: players read" on public.rooms
  for select to authenticated using (auth.uid() in (host_id, guest_id));
create policy "rooms: host creates" on public.rooms
  for insert to authenticated
  with check (host_id = auth.uid() and guest_id is null and status = 'waiting');
create policy "rooms: host updates" on public.rooms
  for update to authenticated
  using (host_id = auth.uid()) with check (host_id = auth.uid());

-- The host may only change match progress — never who the players are or
-- the room code. (guest_id is set by join_room below.)
revoke update on public.rooms from anon, authenticated;
grant update (status, current_round, round_started_at) on public.rooms to authenticated;

-- Join by code: the only way to become a room's guest.
create or replace function public.join_room(p_code text)
returns public.rooms
language plpgsql security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  r rooms;
begin
  if me is null then
    raise exception 'You must be signed in to join a room';
  end if;
  select * into r from rooms where code = upper(trim(p_code)) for update;
  if not found then
    raise exception 'Room not found';
  end if;
  if r.host_id = me then
    raise exception 'You are the host of this room';
  end if;
  if r.guest_id is not null and r.guest_id <> me then
    raise exception 'This room is already full';
  end if;
  if r.status <> 'waiting' and r.guest_id is distinct from me then
    raise exception 'This room has already started';
  end if;
  update rooms set guest_id = me where id = r.id returning * into r;
  return r;
end;
$$;
revoke execute on function public.join_room(text) from public, anon;
grant execute on function public.join_room(text) to authenticated;

-- Rounds (contain the correct answers): players of that room only.
drop policy if exists "rounds: players read" on public.rounds;
drop policy if exists "rounds: host creates" on public.rounds;
create policy "rounds: players read" on public.rounds
  for select to authenticated using (public.is_room_member(room_id));
create policy "rounds: host creates" on public.rounds
  for insert to authenticated with check (
    exists (select 1 from rooms r where r.id = room_id and r.host_id = auth.uid() and r.status = 'waiting')
  );

-- Answers: players of that room read them; you can only answer as yourself,
-- in an active match you're part of. Grading happens on the server.
drop policy if exists "round_answers: players read" on public.round_answers;
drop policy if exists "round_answers: answer as yourself" on public.round_answers;
create policy "round_answers: players read" on public.round_answers
  for select to authenticated using (
    exists (select 1 from rounds ro where ro.id = round_id and public.is_room_member(ro.room_id))
  );
create policy "round_answers: answer as yourself" on public.round_answers
  for insert to authenticated with check (
    player_id = auth.uid()
    and exists (
      select 1 from rounds ro join rooms r on r.id = ro.room_id
      where ro.id = round_id and r.status = 'active' and auth.uid() in (r.host_id, r.guest_id)
    )
  );

-- Grade every answer from the stored correct answer; whatever the phone
-- claims for is_correct / points_awarded is ignored. Mirrors the app's
-- scoring: 100 for a correct answer + up to 100 speed bonus over 8s.
create or replace function public.grade_round_answer()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  correct text;
begin
  select ro.correct_answer into correct from rounds ro where ro.id = new.round_id;
  if correct is null then
    raise exception 'Unknown round';
  end if;
  new.response_ms := least(greatest(coalesce(new.response_ms, 8000), 0), 8000);
  new.is_correct := coalesce(new.choice, '') <> '' and new.choice = correct;
  new.points_awarded := case
    when new.is_correct then 100 + greatest(0, 100 - floor(new.response_ms * 100.0 / 8000))::int
    else 0
  end;
  new.answered_at := now();
  return new;
end;
$$;
drop trigger if exists grade_round_answer on public.round_answers;
create trigger grade_round_answer
  before insert or update on public.round_answers
  for each row execute function public.grade_round_answer();

-- Results: read your own and your opponent's; written only by finalize_match.
drop policy if exists "match_results: players read" on public.match_results;
create policy "match_results: players read" on public.match_results
  for select to authenticated using (player_id = auth.uid() or public.is_room_member(room_id));

-- Computes both players' totals from the graded answers, writes
-- match_results and marks the room completed. Idempotent: both phones call
-- it at the end and get the same numbers.
create or replace function public.finalize_match(p_room uuid)
returns table (player_id uuid, total_score int, correct_count int, avg_response_ms int, outcome text)
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

  update rooms set status = 'completed' where id = p_room and status <> 'completed';

  return query
    select m.player_id, m.total_score, m.correct_count, m.avg_response_ms, m.outcome
    from match_results m where m.room_id = p_room;
end;
$$;
revoke execute on function public.finalize_match(uuid) from public, anon;
grant execute on function public.finalize_match(uuid) to authenticated;
