-- ============================================================
--  FORMA – aktualizacja 1: waga docelowa i śledzenie postępów
--  Wklej w Supabase: SQL Editor -> New query -> Run
--  Można uruchomić ponownie – nic się nie zepsuje.
-- ============================================================
alter table public.profiles
  add column if not exists target_weight_kg  numeric,
  add column if not exists plan_start_date   date,
  add column if not exists plan_start_weight numeric;
