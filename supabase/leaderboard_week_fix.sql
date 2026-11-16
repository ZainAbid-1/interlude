-- Follow-up for anyone who already ran the first leaderboard.sql.
-- "Last 7 days" is now a rolling 7-day window (it used to reset every
-- Monday 00:00 UTC, which emptied the board), and artist names are trimmed.
-- Replaces the two functions only; grants and everything else stay as they are.
-- Safe to run more than once.

-- Artist chips for the picker: artists you've played first, then the most
-- played. Without a query only artists with 3+ finished matches (or that
-- you played) are listed; with a query any matching artist is.
create or replace function public.leaderboard_artists(
  p_period text default 'all',
  p_query text default null
)
returns table (
  artist_key text, artist_name text, artist_image_url text,
  matches int, my_matches int, my_best int
)
language sql stable security definer set search_path = public
as $$
  with m as (
    select public.lb_artist_key(tp.artist_name) as k,
           tp.artist_name, tp.artist_image_url, tp.spotify_artist_id,
           r.id as room_id, r.created_at, mr.player_id, mr.total_score
    from match_results mr
    join rooms r on r.id = mr.room_id and r.status = 'completed'
    join track_pools tp on tp.id = r.track_pool_id
    where auth.uid() is not null
      and (coalesce(p_period, 'all') <> 'week' or r.created_at >= now() - interval '7 days')
  ),
  a as (
    select m.k,
           count(distinct m.room_id)::int as matches,
           (count(*) filter (where m.player_id = auth.uid()))::int as my_matches,
           (max(m.total_score) filter (where m.player_id = auth.uid()))::int as my_best
    from m
    group by m.k
  ),
  look as (
    -- Name and photo from the newest list that has a photo, Spotify first.
    select distinct on (m.k) m.k, m.artist_name, m.artist_image_url
    from m
    order by m.k,
             (coalesce(m.artist_image_url, '') <> '') desc,
             (m.spotify_artist_id ~ '^[0-9A-Za-z]{22}$') desc,
             m.created_at desc
  )
  select a.k, btrim(look.artist_name), look.artist_image_url, a.matches, a.my_matches, a.my_best
  from a
  join look on look.k = a.k
  where a.k <> ''
    and case
          when coalesce(btrim(p_query), '') = '' then a.my_matches > 0 or a.matches >= 3
          else strpos(a.k, public.lb_artist_key(p_query)) > 0
        end
  order by a.my_matches desc, a.matches desc, look.artist_name
  limit 40;
$$;

-- One board. p_artist = an artist_key from leaderboard_artists, or null for
-- "All artists". Per artist: each player's best single match (ties: faster
-- average answer, then whoever got it first). All artists: wins, then win
-- rate (counted from 5 matches), then fewer matches.
-- Global: top 25 per artist / top 50 overall. Friends: you + friends, up to
-- 100. Your own row is always included, even outside the top.
create or replace function public.artist_leaderboard(
  p_artist text default null,
  p_scope text default 'friends',
  p_period text default 'all'
)
returns table (
  rank int, player_id uuid, username text, display_name text, avatar_url text,
  score int, correct int, avg_ms int, matches int, wins int,
  is_me boolean, is_friend boolean, total int
)
language sql stable security definer set search_path = public
as $$
  with friends as (
    select case when f.requester_id = auth.uid() then f.addressee_id else f.requester_id end as id
    from friendships f
    where f.status = 'accepted' and auth.uid() in (f.requester_id, f.addressee_id)
  ),
  m as (
    select mr.player_id, mr.total_score, mr.correct_count, mr.avg_response_ms, mr.outcome, r.created_at
    from match_results mr
    join rooms r on r.id = mr.room_id and r.status = 'completed'
    join track_pools tp on tp.id = r.track_pool_id
    where auth.uid() is not null
      and (p_artist is null or public.lb_artist_key(tp.artist_name) = p_artist)
      and (coalesce(p_period, 'all') <> 'week' or r.created_at >= now() - interval '7 days')
  ),
  eligible as (
    select p.id, p.username, p.display_name, p.avatar_url,
           p.id = auth.uid() as is_me,
           exists (select 1 from friends fr where fr.id = p.id) as is_friend
    from profiles p
    where p.id in (select m.player_id from m)
      and (
        p.id = auth.uid()
        or exists (select 1 from friends fr where fr.id = p.id)
        or (coalesce(p_scope, 'friends') = 'global' and p.username is not null and p.discoverable)
      )
  ),
  best as (
    select distinct on (m.player_id)
           m.player_id, m.total_score, m.correct_count, m.avg_response_ms, m.created_at
    from m
    order by m.player_id, m.total_score desc, m.avg_response_ms asc nulls last, m.created_at asc
  ),
  agg as (
    select m.player_id,
           count(*)::int as matches,
           (count(*) filter (where m.outcome = 'win'))::int as wins
    from m
    group by m.player_id
  ),
  ranked as (
    select e.id, e.username, e.display_name, e.avatar_url, e.is_me, e.is_friend,
           b.total_score, b.correct_count, b.avg_response_ms, a.matches, a.wins,
           (row_number() over (
             order by
               case when p_artist is null then a.wins else b.total_score end desc,
               case when p_artist is null and a.matches >= 5
                    then a.wins::numeric / a.matches end desc nulls last,
               case when p_artist is null then a.matches end asc nulls last,
               b.avg_response_ms asc nulls last,
               b.created_at asc
           ))::int as rnk,
           (count(*) over ())::int as total
    from eligible e
    join best b on b.player_id = e.id
    join agg a on a.player_id = e.id
  )
  select rnk, id, username, display_name, avatar_url,
         total_score, correct_count, avg_response_ms, matches, wins,
         is_me, is_friend, total
  from ranked
  where is_me
     or rnk <= case
                 when coalesce(p_scope, 'friends') <> 'global' then 100
                 when p_artist is null then 50
                 else 25
               end
  order by rnk;
$$;
