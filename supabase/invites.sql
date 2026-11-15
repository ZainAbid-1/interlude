-- ─────────────────────────────────────────────────────────────────────
-- Interlude — challenge a friend + head-to-head history
-- Run once in the Supabase SQL editor, after friends.sql. Safe to re-run.
--
-- A game invite points a friend at the host's waiting room. Accepting
-- returns the room code and the app joins with it exactly like typing the
-- code, so the match flow itself is unchanged.
-- ─────────────────────────────────────────────────────────────────────

create table if not exists public.game_invites (
  id            uuid primary key default gen_random_uuid(),
  from_id       uuid not null references public.profiles (id) on delete cascade,
  to_id         uuid not null references public.profiles (id) on delete cascade,
  room_id       uuid not null references public.rooms (id) on delete cascade,
  status        text not null default 'pending'
                check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null default now() + interval '2 minutes',
  responded_at  timestamptz,
  constraint game_invites_not_self check (from_id <> to_id)
);

create index if not exists game_invites_to_idx on public.game_invites (to_id, status);
create index if not exists game_invites_from_idx on public.game_invites (from_id, status);

alter table public.game_invites enable row level security;

drop policy if exists "game_invites: participants read" on public.game_invites;
create policy "game_invites: participants read" on public.game_invites
  for select using (auth.uid() in (from_id, to_id));
-- No insert/update/delete policies: writes only via the functions below.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'game_invites'
  ) then
    alter publication supabase_realtime add table public.game_invites;
  end if;
end $$;

-- Invite a friend to your waiting room. Replaces your older pending invite
-- to the same friend. Returns the invite id.
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

  update game_invites set status = 'cancelled', responded_at = now()
  where from_id = me and to_id = p_to and status = 'pending';

  insert into game_invites (from_id, to_id, room_id)
  values (me, p_to, p_room)
  returning id into new_id;
  return new_id;
end;
$$;

-- Accept → returns the room code to join. Decline → returns null.
create or replace function public.respond_game_invite(p_invite uuid, p_accept boolean)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  inv game_invites%rowtype;
  room_code text;
begin
  if me is null then
    raise exception 'You need to be signed in';
  end if;
  select * into inv from game_invites where id = p_invite and to_id = me for update;
  if not found then
    raise exception 'Invite not found';
  end if;
  if inv.status <> 'pending' then
    raise exception 'This invite is no longer active';
  end if;

  if not p_accept then
    update game_invites set status = 'declined', responded_at = now() where id = inv.id;
    return null;
  end if;

  if inv.expires_at < now() then
    raise exception 'This invite has expired';
  end if;
  select r.code into room_code from rooms r
  where r.id = inv.room_id and r.status = 'waiting' and (r.guest_id is null or r.guest_id = me);
  if room_code is null then
    raise exception 'That room is no longer open';
  end if;

  update game_invites set status = 'accepted', responded_at = now() where id = inv.id;
  return room_code;
end;
$$;

-- Host withdraws pending invites for a room (left the lobby). Null room =
-- all of the host's pending invites.
create or replace function public.cancel_game_invite(p_room uuid default null)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'You need to be signed in';
  end if;
  update game_invites set status = 'cancelled', responded_at = now()
  where from_id = auth.uid() and status = 'pending'
    and (p_room is null or room_id = p_room);
end;
$$;

-- Open invites sent to me, with who sent them and the artist.
create or replace function public.list_game_invites()
returns table (
  id uuid, room_id uuid, created_at timestamptz, expires_at timestamptz,
  from_id uuid, from_username text, from_display_name text, from_avatar_url text,
  artist_name text, artist_image_url text
)
language sql stable security definer set search_path = public
as $$
  select gi.id, gi.room_id, gi.created_at, gi.expires_at,
         p.id, p.username, p.display_name, p.avatar_url,
         tp.artist_name, tp.artist_image_url
  from game_invites gi
  join profiles p on p.id = gi.from_id
  join rooms r on r.id = gi.room_id
  join track_pools tp on tp.id = r.track_pool_id
  where gi.to_id = auth.uid()
    and gi.status = 'pending'
    and gi.expires_at > now()
    and r.status = 'waiting'
  order by gi.created_at desc;
$$;

-- Every match you and this player played against each other.
create or replace function public.head_to_head(p_user uuid)
returns table (
  room_id uuid, played_at timestamptz, artist_name text, artist_image_url text,
  my_score int, their_score int, my_correct int, their_correct int, outcome text
)
language sql stable security definer set search_path = public
as $$
  select r.id, r.created_at, tp.artist_name, tp.artist_image_url,
         mine.total_score, theirs.total_score,
         mine.correct_count, theirs.correct_count,
         mine.outcome
  from rooms r
  join track_pools tp on tp.id = r.track_pool_id
  join match_results mine on mine.room_id = r.id and mine.player_id = auth.uid()
  left join match_results theirs on theirs.room_id = r.id and theirs.player_id = p_user
  where auth.uid() is not null
    and (
      (r.host_id = auth.uid() and r.guest_id = p_user)
      or (r.guest_id = auth.uid() and r.host_id = p_user)
    )
  order by r.created_at desc
  limit 200;
$$;

revoke execute on function public.send_game_invite(uuid, uuid) from public, anon;
revoke execute on function public.respond_game_invite(uuid, boolean) from public, anon;
revoke execute on function public.cancel_game_invite(uuid) from public, anon;
revoke execute on function public.list_game_invites() from public, anon;
revoke execute on function public.head_to_head(uuid) from public, anon;

grant execute on function public.send_game_invite(uuid, uuid) to authenticated;
grant execute on function public.respond_game_invite(uuid, boolean) to authenticated;
grant execute on function public.cancel_game_invite(uuid) to authenticated;
grant execute on function public.list_game_invites() to authenticated;
grant execute on function public.head_to_head(uuid) to authenticated;
