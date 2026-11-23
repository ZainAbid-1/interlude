-- ─────────────────────────────────────────────────────────────────────
-- Interlude — phone notifications (when the app is closed)
-- Run in the Supabase SQL editor after elo.sql. Safe to re-run.
--
-- When a challenge or friend request is saved, a trigger sends a push
-- through Expo's push service (https://exp.host) using pg_net, so no extra
-- server is needed. pg_net sends after the transaction commits, so a
-- rolled-back challenge never notifies anyone.
--
--   challenge        "Zain challenged you"            → Join / Decline
--   friend request   "Ali sent you a friend request"  → opens Friends
--   request accepted "Ali accepted your request"      → opens head to head
-- ─────────────────────────────────────────────────────────────────────

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    create extension pg_net;
  end if;
exception when others then
  raise notice 'pg_net is not available here: %', sqlerrm;
end $$;

-- ── Which alerts each player wants (all on by default) ─────────────────
alter table public.profiles
  add column if not exists notify_challenges      boolean not null default true,
  add column if not exists notify_friend_requests boolean not null default true,
  add column if not exists notify_friend_accepts  boolean not null default true;

-- ── Each phone's Expo push address ─────────────────────────────────────
create table if not exists public.push_tokens (
  token       text primary key,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  platform    text not null default 'unknown',
  updated_at  timestamptz not null default now()
);
create index if not exists push_tokens_user_idx on public.push_tokens (user_id);

-- Nobody reads or writes this table directly; only the functions below.
alter table public.push_tokens enable row level security;
revoke all on public.push_tokens from anon, authenticated;

-- Saves this phone's address for the signed-in player. A phone that was
-- used by someone else moves over to whoever is signed in now.
create or replace function public.register_push_token(p_token text, p_platform text default 'unknown')
returns void
language plpgsql security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'You need to be signed in';
  end if;
  if p_token is null or length(p_token) > 200
     or not (p_token like 'ExponentPushToken[%]' or p_token like 'ExpoPushToken[%]') then
    raise exception 'Not a valid push token';
  end if;

  insert into push_tokens (token, user_id, platform, updated_at)
  values (p_token, me, left(coalesce(p_platform, 'unknown'), 16), now())
  on conflict (token) do update
    set user_id = excluded.user_id, platform = excluded.platform, updated_at = now();

  -- Keep the 5 most recent phones per player, and forget phones that
  -- haven't opened the app in 90 days (uninstalled, replaced).
  delete from push_tokens
  where user_id = me
    and token not in (
      select token from push_tokens where user_id = me order by updated_at desc limit 5
    );
  delete from push_tokens where updated_at < now() - interval '90 days';
end;
$$;

-- Called on log out, so a shared phone stops getting the old player's alerts.
create or replace function public.unregister_push_token(p_token text)
returns void
language sql security definer set search_path = public
as $$
  delete from push_tokens where token = p_token and user_id = auth.uid();
$$;

revoke all on function public.register_push_token(text, text) from public, anon;
revoke all on function public.unregister_push_token(text) from public, anon;
grant execute on function public.register_push_token(text, text) to authenticated;
grant execute on function public.unregister_push_token(text) to authenticated;

-- ── Sending ───────────────────────────────────────────────────────────
create or replace function public.push_player_name(p_id uuid)
returns text
language sql stable security definer set search_path = public
as $$
  select coalesce(nullif(btrim(display_name), ''), '@' || username, 'A friend')
  from profiles where id = p_id;
$$;
revoke all on function public.push_player_name(uuid) from public, anon, authenticated;

-- Internal: one push to every phone of p_user. Never raises, so a delivery
-- problem can't stop a challenge or friend request from being saved.
create or replace function public.send_push(
  p_user     uuid,
  p_title    text,
  p_body     text,
  p_data     jsonb,
  p_channel  text,
  p_category text default null,
  p_ttl      int  default 2419200,
  p_tag      text default null
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  messages jsonb;
begin
  select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'to',         t.token,
           'title',      p_title,
           'body',       p_body,
           'data',       p_data,
           'sound',      'default',
           'priority',   'high',
           'channelId',  p_channel,
           'categoryId', p_category,
           'ttl',        greatest(p_ttl, 1),
           'tag',        p_tag,
           'collapseId', p_tag
         )))
  into messages
  from push_tokens t
  where t.user_id = p_user;

  if messages is null then
    return; -- no phones registered
  end if;

  perform net.http_post(
    url     := 'https://exp.host/--/api/v2/push/send',
    body    := messages,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Accept', 'application/json'
    )
  );
exception when others then
  raise warning 'push to % not sent: %', p_user, sqlerrm;
end;
$$;
revoke all on function public.send_push(uuid, text, text, jsonb, text, text, int, text)
  from public, anon, authenticated;

-- Challenge: the friend gets "Zain challenged you · Drake".
create or replace function public.push_on_game_invite()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  artist text;
  ttl int;
begin
  if new.status <> 'pending' then
    return new;
  end if;
  if not coalesce((select notify_challenges from profiles where id = new.to_id), true) then
    return new;
  end if;

  select tp.artist_name into artist
  from rooms r join track_pools tp on tp.id = r.track_pool_id
  where r.id = new.room_id;

  -- Don't deliver a challenge that has already run out.
  ttl := greatest(1, floor(extract(epoch from (new.expires_at - now())))::int);

  perform send_push(
    new.to_id,
    push_player_name(new.from_id) || ' challenged you',
    coalesce(artist, 'A music match') || ' · Join within 2 minutes',
    jsonb_build_object(
      'type', 'challenge',
      'inviteId', new.id,
      'roomId', new.room_id,
      'fromId', new.from_id,
      'fromName', push_player_name(new.from_id),
      'expiresAt', new.expires_at
    ),
    'challenges',
    'challenge',
    ttl,
    'challenge-' || new.from_id   -- a newer challenge from them replaces the old one
  );
  return new;
end;
$$;

drop trigger if exists game_invites_push on public.game_invites;
create trigger game_invites_push
  after insert on public.game_invites
  for each row execute function public.push_on_game_invite();

-- Friend requests and accepted requests.
create or replace function public.push_on_friendship()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' and new.status = 'pending' then
    if coalesce((select notify_friend_requests from profiles where id = new.addressee_id), true) then
      perform send_push(
        new.addressee_id,
        push_player_name(new.requester_id) || ' sent you a friend request',
        'Accept to challenge each other and compare scores.',
        jsonb_build_object('type', 'friend_request', 'userId', new.requester_id, 'name', push_player_name(new.requester_id)),
        'friends',
        null,
        2419200,
        'friend-' || new.requester_id
      );
    end if;
  elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status = 'accepted' then
    if coalesce((select notify_friend_accepts from profiles where id = new.requester_id), true) then
      perform send_push(
        new.requester_id,
        push_player_name(new.addressee_id) || ' accepted your friend request',
        'You can challenge them to a match now.',
        jsonb_build_object('type', 'friend_accepted', 'userId', new.addressee_id, 'name', push_player_name(new.addressee_id)),
        'friends',
        null,
        2419200,
        'friend-' || new.addressee_id
      );
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists friendships_push on public.friendships;
create trigger friendships_push
  after insert or update of status on public.friendships
  for each row execute function public.push_on_friendship();
