-- Score with the phone's own answer time again.
--
-- leaderboard.sql (first version) added a server-measured answer time. It
-- measured from when the host's room update reached the server, which is
-- before the 3-2-1 countdown and the clip, so answers were graded 1-2 s
-- slower than the phone showed and final scores dropped at the end of a match.
--
-- Now: the server still decides right/wrong from the round's correct answer
-- and clamps the time to 0..8 s, but uses the phone's response time, so the
-- saved points are exactly what players saw during the match.
-- Trade-off: a modified app could report faster answer times.
--
-- Safe to run more than once, and safe whether or not the first
-- leaderboard.sql was run.

drop trigger if exists stamp_round_server_start on public.rooms;
drop function if exists public.stamp_round_server_start();
alter table public.rooms drop column if exists round_server_started_at;

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
  -- Same formula as calculatePoints() in store/gameStore.ts.
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
