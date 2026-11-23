-- ─────────────────────────────────────────────────────────────────────
-- Interlude — fair match endings
-- Run in the Supabase SQL editor after notifications.sql. Safe to re-run.
--
--   • Leaving a match is a forfeit: the leaver loses, the opponent wins
--     (forfeit_match). Disappearing counts too: the player who stayed can
--     claim the win once the other hasn't checked in for 45 s (claim_forfeit).
--   • Phones check in every few seconds (touch_room) so the server knows
--     who is really still there.
--   • A match can only be finished after its last round has been played,
--     and the host can only move rounds forward one at a time.
--   • Room codes expire after 30 minutes in the lobby.
--   • Challenging a friend who is in a match is refused straight away.
-- ─────────────────────────────────────────────────────────────────────

alter table public.rooms
  add column if not exists host_seen_at     timestamptz,
  add column if not exists guest_seen_at    timestamptz,
  add column if not exists round_changed_at timestamptz,
  add column if not exists forfeit_by       uuid references public.profiles (id) on delete set null;

-- ── The host may only move a match forward, one round at a time ────────
-- Direct updates from phones run as "authenticated"; the server functions
-- below run as their owner and are not limited by this.
create or replace function public.guard_room_update()
returns trigger
language plpgsql
as $$
begin
  if new.current_round is distinct from old.current_round then
    new.round_changed_at := now();
  end if;

  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  -- Status: only waiting → active. Finishing goes through finalize/forfeit.
  if new.status is distinct from old.status
     and not (old.status = 'waiting' and new.status = 'active') then
    raise exception 'Matches can only be finished by the server';
  end if;

  -- Rounds: one step forward at a time, never back, never skipping.
  if new.current_round is distinct from old.current_round then
    if new.current_round is null
       or new.current_round <> coalesce(old.current_round, 0) + 1 then
      raise exception 'Rounds can only move forward one at a time';
    end if;
    if coalesce(old.current_round, 0) >= 1
       and old.round_changed_at is not null
       and now() < old.round_changed_at + interval '2 seconds' then
      raise exception 'That round has only just started';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists rooms_guard on public.rooms;
create trigger rooms_guard
  before update on public.rooms
  for each row execute function public.guard_room_update();

-- ── Check-ins ─────────────────────────────────────────────────────────
create or replace function public.touch_room(p_room uuid)
returns void
language sql security definer set search_path = public
as $$
  update rooms set
    host_seen_at  = case when host_id  = auth.uid() then now() else host_seen_at end,
    guest_seen_at = case when guest_id = auth.uid() then now() else guest_seen_at end
  where id = p_room and auth.uid() in (host_id, guest_id) and status <> 'completed';
$$;
revoke all on function public.touch_room(uuid) from public, anon;
grant execute on function public.touch_room(uuid) to authenticated;

-- ── Results (internal) ────────────────────────────────────────────────
-- Totals both players from the server-graded answers. A forfeit decides
-- the outcome whatever the score.
create or replace function public.compute_match_results(p_room uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r rooms;
begin
  select * into r from rooms where id = p_room;

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
    when r.forfeit_by is not null then
      case when m.player_id = r.forfeit_by then 'loss' else 'win' end
    when m.total_score > o.total_score then 'win'
    when m.total_score < o.total_score then 'loss'
    else 'draw'
  end
  from match_results o
  where m.room_id = p_room and o.room_id = p_room and o.player_id <> m.player_id;
end;
$$;
revoke all on function public.compute_match_results(uuid) from public, anon, authenticated;

-- Finishes the room, applies the rating, and returns both players' rows.
create or replace function public.close_match(p_room uuid)
returns table (
  player_id uuid, total_score int, correct_count int, avg_response_ms int, outcome text,
  rating int, rating_change int, forfeited boolean
)
language plpgsql security definer set search_path = public
as $$
#variable_conflict use_column
begin
  perform public.compute_match_results(p_room);
  update rooms set status = 'completed', completed_at = coalesce(completed_at, now())
  where id = p_room and status <> 'completed';
  perform public.apply_match_rating(p_room);

  return query
    select m.player_id, m.total_score, m.correct_count, m.avg_response_ms, m.outcome,
           pr.rating,
           case when m.player_id = mr.host_id then mr.host_delta else mr.guest_delta end,
           coalesce(m.player_id = r.forfeit_by, false)
    from match_results m
    join rooms r on r.id = m.room_id
    left join player_ratings pr on pr.player_id = m.player_id
    left join match_ratings mr on mr.room_id = p_room
    where m.room_id = p_room;
end;
$$;
revoke all on function public.close_match(uuid) from public, anon, authenticated;

-- ── Finishing normally ────────────────────────────────────────────────
drop function if exists public.finalize_match(uuid);
create function public.finalize_match(p_room uuid)
returns table (
  player_id uuid, total_score int, correct_count int, avg_response_ms int, outcome text,
  rating int, rating_change int, forfeited boolean
)
language plpgsql security definer set search_path = public
as $$
#variable_conflict use_column
declare
  me uuid := auth.uid();
  r rooms;
  total int;
  last_round uuid;
  answered int;
begin
  -- Locked, so two phones finishing at once are handled one after the other.
  select * into r from rooms where id = p_room for update;
  if not found or me is null or me not in (r.host_id, r.guest_id) then
    raise exception 'You are not a player in this room';
  end if;
  if r.guest_id is null then
    raise exception 'This match has no opponent';
  end if;
  if r.status not in ('active', 'completed') then
    raise exception 'This match has not started';
  end if;

  if r.status = 'active' then
    -- Only once the last round has really been played.
    select count(*) into total from rounds where room_id = p_room;
    if total = 0 or coalesce(r.current_round, 0) < total then
      raise exception 'MATCH_NOT_FINISHED';
    end if;
    select id into last_round from rounds where room_id = p_room and round_index = r.current_round;
    select count(distinct a.player_id) into answered from round_answers a where a.round_id = last_round;
    if answered < 2
       and now() < coalesce(r.round_changed_at, '-infinity'::timestamptz) + interval '10 seconds' then
      raise exception 'MATCH_NOT_FINISHED';
    end if;
  end if;

  return query select * from public.close_match(p_room);
end;
$$;
revoke all on function public.finalize_match(uuid) from public, anon;
grant execute on function public.finalize_match(uuid) to authenticated;

-- ── Leaving: the leaver loses ─────────────────────────────────────────
create or replace function public.forfeit_match(p_room uuid)
returns table (
  player_id uuid, total_score int, correct_count int, avg_response_ms int, outcome text,
  rating int, rating_change int, forfeited boolean
)
language plpgsql security definer set search_path = public
as $$
#variable_conflict use_column
declare
  me uuid := auth.uid();
  r rooms;
begin
  select * into r from rooms where id = p_room for update;
  if not found or me is null or me not in (r.host_id, r.guest_id) then
    raise exception 'You are not a player in this room';
  end if;
  if r.status = 'active' and r.guest_id is not null then
    update rooms set forfeit_by = me where id = p_room;
    return query select * from public.close_match(p_room);
  elsif r.status = 'completed' then
    return query select * from public.close_match(p_room);
  end if;
  -- Still in the lobby: nothing to forfeit.
end;
$$;
revoke all on function public.forfeit_match(uuid) from public, anon;
grant execute on function public.forfeit_match(uuid) to authenticated;

-- ── The other player vanished: claim the win ──────────────────────────
create or replace function public.claim_forfeit(p_room uuid)
returns table (
  player_id uuid, total_score int, correct_count int, avg_response_ms int, outcome text,
  rating int, rating_change int, forfeited boolean
)
language plpgsql security definer set search_path = public
as $$
#variable_conflict use_column
declare
  me uuid := auth.uid();
  r rooms;
  them uuid;
  their_seen timestamptz;
begin
  select * into r from rooms where id = p_room for update;
  if not found or me is null or me not in (r.host_id, r.guest_id) then
    raise exception 'You are not a player in this room';
  end if;
  if r.status = 'completed' then
    return query select * from public.close_match(p_room);
    return;
  end if;
  if r.status <> 'active' or r.guest_id is null then
    raise exception 'This match has not started';
  end if;

  them := case when me = r.host_id then r.guest_id else r.host_id end;
  their_seen := case when me = r.host_id then r.guest_seen_at else r.host_seen_at end;
  -- Never checked in at all: count from when the match last moved.
  their_seen := coalesce(their_seen, r.round_changed_at, r.created_at);
  if their_seen > now() - interval '45 seconds' then
    raise exception 'OPPONENT_STILL_HERE';
  end if;

  update rooms set
    forfeit_by = them,
    host_seen_at  = case when me = host_id  then now() else host_seen_at end,
    guest_seen_at = case when me = guest_id then now() else guest_seen_at end
  where id = p_room;
  return query select * from public.close_match(p_room);
end;
$$;
revoke all on function public.claim_forfeit(uuid) from public, anon;
grant execute on function public.claim_forfeit(uuid) to authenticated;

-- ── Room codes expire after 30 minutes in the lobby ───────────────────
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
  if r.status = 'completed' and r.guest_id = me then
    raise exception 'This match has already ended';
  end if;
  if r.status <> 'waiting' and r.guest_id is distinct from me then
    raise exception 'This room has already started';
  end if;
  if r.status = 'waiting' and r.created_at < now() - interval '30 minutes' then
    raise exception 'This room has expired. Ask for a new code.';
  end if;
  update rooms set guest_id = me where id = r.id returning * into r;
  return r;
end;
$$;
revoke execute on function public.join_room(text) from public, anon;
grant execute on function public.join_room(text) to authenticated;

-- Someone is "in a match" if their match has moved or checked in recently
-- (an abandoned room left 'active' doesn't count).
create or replace function public.is_in_match(p_user uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from rooms r
    where r.status = 'active' and p_user in (r.host_id, r.guest_id)
      and greatest(r.host_seen_at, r.guest_seen_at, r.round_changed_at) > now() - interval '60 seconds'
  );
$$;
revoke all on function public.is_in_match(uuid) from public, anon, authenticated;

-- ── Challenges: refuse busy friends and expired rooms up front ────────
create or replace function public.send_game_invite(p_to uuid, p_room uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  new_id uuid;
begin
  if me is null then
    raise exception 'You need to be signed in';
  end if;
  if not exists (
    select 1 from friendships f
    where f.status = 'accepted'
      and ((f.requester_id = me and f.addressee_id = p_to)
        or (f.requester_id = p_to and f.addressee_id = me))
  ) then
    raise exception 'You can only challenge your friends';
  end if;
  if not exists (
    select 1 from rooms r
    where r.id = p_room and r.host_id = me and r.status = 'waiting' and r.guest_id is null
  ) then
    raise exception 'That room is no longer open';
  end if;
  if exists (
    select 1 from rooms r where r.id = p_room and r.created_at < now() - interval '30 minutes'
  ) then
    raise exception 'This room has expired. Pick an artist again to make a new one.';
  end if;
  if public.is_in_match(p_to) then
    raise exception 'BUSY: They are in a match right now';
  end if;

  update game_invites set status = 'cancelled', responded_at = now()
  where from_id = me and to_id = p_to and status = 'pending';

  insert into game_invites (from_id, to_id, room_id)
  values (me, p_to, p_room)
  returning id into new_id;
  return new_id;
end;
$$;
revoke all on function public.send_game_invite(uuid, uuid) from public, anon;
grant execute on function public.send_game_invite(uuid, uuid) to authenticated;
