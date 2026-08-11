-- Phase 1 follow-up — RLS policy the join flow needs.
-- Paste into the Supabase SQL editor (run after the Phase 1 script).

-- The guest claims a room by updating guest_id on join. Phase 1 only created
-- "open read" / "open insert" on rooms; without an update policy the join
-- update is denied.
create policy "open update" on public.rooms for update using (true) with check (true);
