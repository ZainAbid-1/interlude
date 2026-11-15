-- ─────────────────────────────────────────────────────────────────────
-- Interlude — usernames + friends
-- Run once in the Supabase SQL editor, after schema.sql. Safe to re-run.
--
-- Profiles stay private (own-row RLS). Everything other players may see
-- (username, display name, avatar) is exposed only through the
-- SECURITY DEFINER functions below, and all friend writes go through them
-- too, so the rules live in one place.
-- ─────────────────────────────────────────────────────────────────────

-- Supabase keeps extensions in the "extensions" schema. If pg_trgm is
-- already installed (in public or extensions) this is a no-op; the functions
-- below look in both schemas.
create extension if not exists pg_trgm with schema extensions;

-- Usernames ---------------------------------------------------------------
alter table public.profiles add column if not exists username text;
alter table public.profiles add column if not exists discoverable boolean not null default true;

alter table public.profiles drop constraint if exists profiles_username_format;
alter table public.profiles
  add constraint profiles_username_format
  check (username is null or username ~ '^[a-z0-9_.]{3,20}$');

create unique index if not exists profiles_username_key on public.profiles (username);
create index if not exists profiles_username_trgm
  on public.profiles using gin (username gin_trgm_ops);
create index if not exists profiles_display_name_trgm
  on public.profiles using gin (lower(display_name) gin_trgm_ops);

-- Older sign-ins could store the email address as the display name; never
-- show that to other players.
update public.profiles set display_name = null where display_name like '%@%';

-- Friendships ---------------------------------------------------------------
-- One row per pair. 'pending' = requester asked addressee; 'accepted' =
-- friends. Declining, cancelling and unfriending delete the row.
create table if not exists public.friendships (
  id            uuid primary key default gen_random_uuid(),
  requester_id  uuid not null references public.profiles (id) on delete cascade,
  addressee_id  uuid not null references public.profiles (id) on delete cascade,
  status        text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at    timestamptz not null default now(),
  responded_at  timestamptz,
  constraint friendships_not_self check (requester_id <> addressee_id)
);

create unique index if not exists friendships_pair_key
  on public.friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));
create index if not exists friendships_addressee_idx on public.friendships (addressee_id, status);
create index if not exists friendships_requester_idx on public.friendships (requester_id, status);

alter table public.friendships enable row level security;

drop policy if exists "friendships: participants read" on public.friendships;
create policy "friendships: participants read" on public.friendships
  for select using (auth.uid() in (requester_id, addressee_id));
-- No insert/update/delete policies: writes only via the functions below.

-- Live updates for the Friends tab (requests appearing / being accepted).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'friendships'
  ) then
    alter publication supabase_realtime add table public.friendships;
  end if;
end $$;

-- Functions -----------------------------------------------------------------

create or replace function public.is_username_available(p_username text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select lower(trim(p_username)) ~ '^[a-z0-9_.]{3,20}$'
     and not exists (
       select 1 from profiles p
       where p.username = lower(trim(p_username))
         and p.id <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid)
     );
$$;

create or replace function public.set_username(p_username text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v text := lower(trim(p_username));
begin
  if auth.uid() is null then
    raise exception 'You need to be signed in';
  end if;
  if v !~ '^[a-z0-9_.]{3,20}$' then
    raise exception 'Use 3–20 characters: letters, numbers, _ and .';
  end if;
  if exists (select 1 from profiles p where p.username = v and p.id <> auth.uid()) then
    raise exception 'That username is taken';
  end if;
  update profiles set username = v where id = auth.uid();
  if not found then
    raise exception 'Profile not found';
  end if;
exception
  when unique_violation then
    raise exception 'That username is taken';
end;
$$;

-- relation: 'friend' | 'outgoing' (you asked them) | 'incoming' (they asked you) | 'none'
create or replace function public.search_players(p_query text)
returns table (id uuid, username text, display_name text, avatar_url text, relation text)
language sql stable security definer set search_path = public, extensions
as $$
  with q as (
    select t,
           replace(replace(replace(t, '\', '\\'), '%', '\%'), '_', '\_') as e
    from (select ltrim(lower(trim(coalesce(p_query, ''))), '@') as t) raw
  )
  select p.id, p.username, p.display_name, p.avatar_url,
         case
           when f.status = 'accepted' then 'friend'
           when f.status = 'pending' and f.requester_id = auth.uid() then 'outgoing'
           when f.status = 'pending' then 'incoming'
           else 'none'
         end as relation
  from profiles p
  cross join q
  left join friendships f
    on (f.requester_id = auth.uid() and f.addressee_id = p.id)
    or (f.addressee_id = auth.uid() and f.requester_id = p.id)
  where auth.uid() is not null
    and length(q.t) >= 2
    and p.id <> auth.uid()
    and p.username is not null
    and (p.discoverable or f.id is not null)
    and (
      p.username like q.e || '%'
      or p.username % q.t
      or lower(coalesce(p.display_name, '')) like '%' || q.e || '%'
    )
  order by (p.username = q.t) desc,
           (p.username like q.e || '%') desc,
           similarity(p.username, q.t) desc,
           p.username
  limit 20;
$$;

-- Friends + pending requests, with your head-to-head record against each.
create or replace function public.list_friends()
returns table (
  id uuid, username text, display_name text, avatar_url text, relation text,
  wins int, losses int, draws int, created_at timestamptz
)
language sql stable security definer set search_path = public
as $$
  select p.id, p.username, p.display_name, p.avatar_url,
         case
           when f.status = 'accepted' then 'friend'
           when f.requester_id = auth.uid() then 'outgoing'
           else 'incoming'
         end as relation,
         coalesce(h.wins, 0)::int, coalesce(h.losses, 0)::int, coalesce(h.draws, 0)::int,
         f.created_at
  from friendships f
  join profiles p
    on p.id = case when f.requester_id = auth.uid() then f.addressee_id else f.requester_id end
  left join lateral (
    select count(*) filter (where mr.outcome = 'win')  as wins,
           count(*) filter (where mr.outcome = 'loss') as losses,
           count(*) filter (where mr.outcome = 'draw') as draws
    from match_results mr
    join rooms r on r.id = mr.room_id
    where mr.player_id = auth.uid()
      and (
        (r.host_id = auth.uid() and r.guest_id = p.id)
        or (r.guest_id = auth.uid() and r.host_id = p.id)
      )
  ) h on true
  where auth.uid() in (f.requester_id, f.addressee_id)
  order by f.created_at desc;
$$;

-- Returns the new relation. Asking someone who already asked you accepts.
create or replace function public.send_friend_request(p_user uuid)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  existing friendships%rowtype;
begin
  if me is null then
    raise exception 'You need to be signed in';
  end if;
  if p_user = me then
    raise exception 'You can''t add yourself';
  end if;
  if not exists (select 1 from profiles where id = p_user) then
    raise exception 'Player not found';
  end if;

  select * into existing from friendships
  where (requester_id = me and addressee_id = p_user)
     or (requester_id = p_user and addressee_id = me);

  if found then
    if existing.status = 'accepted' then
      return 'friend';
    end if;
    if existing.requester_id = me then
      return 'outgoing';
    end if;
    update friendships set status = 'accepted', responded_at = now() where id = existing.id;
    return 'friend';
  end if;

  insert into friendships (requester_id, addressee_id) values (me, p_user);
  return 'outgoing';
exception
  when unique_violation then
    return 'outgoing';
end;
$$;

create or replace function public.respond_friend_request(p_user uuid, p_accept boolean)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'You need to be signed in';
  end if;
  if p_accept then
    update friendships set status = 'accepted', responded_at = now()
    where requester_id = p_user and addressee_id = me and status = 'pending';
    if not found then
      raise exception 'That request is no longer pending';
    end if;
    return 'friend';
  end if;
  delete from friendships
  where requester_id = p_user and addressee_id = me and status = 'pending';
  return 'none';
end;
$$;

-- Unfriend, or cancel a request you sent.
create or replace function public.remove_friend(p_user uuid)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'You need to be signed in';
  end if;
  delete from friendships
  where (requester_id = me and addressee_id = p_user)
     or (requester_id = p_user and addressee_id = me);
  return 'none';
end;
$$;

-- Signed-in players only.
revoke execute on function public.is_username_available(text) from public, anon;
revoke execute on function public.set_username(text) from public, anon;
revoke execute on function public.search_players(text) from public, anon;
revoke execute on function public.list_friends() from public, anon;
revoke execute on function public.send_friend_request(uuid) from public, anon;
revoke execute on function public.respond_friend_request(uuid, boolean) from public, anon;
revoke execute on function public.remove_friend(uuid) from public, anon;

grant execute on function public.is_username_available(text) to authenticated;
grant execute on function public.set_username(text) to authenticated;
grant execute on function public.search_players(text) to authenticated;
grant execute on function public.list_friends() to authenticated;
grant execute on function public.send_friend_request(uuid) to authenticated;
grant execute on function public.respond_friend_request(uuid, boolean) to authenticated;
grant execute on function public.remove_friend(uuid) to authenticated;
