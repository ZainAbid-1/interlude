-- ─────────────────────────────────────────────────────────────────────
-- Interlude — delete my account (required by Google Play)
-- Run in the Supabase SQL editor after match_integrity.sql. Safe to re-run.
--
-- Permanently deletes the signed-in player: sign-in, profile, friends,
-- invites, ratings, notification addresses, answers and results, and any
-- room that never finished. Matches they finished stay for their opponents,
-- with this player removed from them, so nobody else loses their history.
-- ─────────────────────────────────────────────────────────────────────

create or replace function public.delete_my_account()
returns void
language plpgsql security definer set search_path = public, auth
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'You need to be signed in';
  end if;

  -- Rooms that never finished (lobbies, abandoned matches) just go.
  delete from rooms
  where (host_id = me or guest_id = me) and status <> 'completed';

  -- Finished matches stay for the opponent, without this player.
  update track_pools set created_by = null where created_by = me;
  update rooms set host_id = null where host_id = me;
  update rooms set guest_id = null where guest_id = me;
  delete from round_answers where player_id = me;
  delete from match_results where player_id = me;

  -- Removing the sign-in removes the profile, and with it friendships,
  -- invites, ratings, the rating ledger and notification addresses.
  delete from auth.users where id = me;
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
