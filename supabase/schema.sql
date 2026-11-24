-- ============================================================
--  FORMA – przygotowanie bazy danych
--  Wklej CAŁY ten plik w Supabase: SQL Editor -> New query -> Run
--  Można uruchomić ponownie – nic się nie zepsuje.
-- ============================================================

-- Profil: dane i cele
create table if not exists public.profiles (
  user_id        uuid primary key default auth.uid() references auth.users on delete cascade,
  sex            text check (sex in ('f','m')),
  age            int,
  height_cm      numeric,
  weight_kg      numeric,
  lifestyle      text default 'light',
  goal           text default 'cut',
  kcal_target    int,
  protein_g      int,
  carbs_g        int,
  fat_g          int,
  fiber_g        int,
  targets_manual boolean default false,
  updated_at     timestamptz default now()
);

-- Plan: waga docelowa i punkt startu (dodane w aktualizacji 1)
alter table public.profiles
  add column if not exists target_weight_kg  numeric,
  add column if not exists plan_start_date   date,
  add column if not exists plan_start_weight numeric;

-- Moja baza posiłków i produktów
create table if not exists public.foods (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users on delete cascade,
  name         text not null,
  basis        text not null default 'szt' check (basis in ('g','szt')), -- 'g' = wartości na 100 g, 'szt' = na 1 sztukę/porcję
  unit_label   text,
  unit_grams   numeric,
  kcal         numeric not null default 0,
  protein      numeric not null default 0,
  carbs        numeric not null default 0,
  fat          numeric not null default 0,
  fiber        numeric not null default 0,
  barcode      text,
  favorite     boolean not null default false,
  recipe       jsonb,
  use_count    int not null default 0,
  last_used_at timestamptz,
  created_at   timestamptz not null default now()
);

-- Zjedzone posiłki
create table if not exists public.meal_entries (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  date        date not null,
  meal        text,
  name        text not null,
  amount      numeric,
  amount_unit text,
  kcal        numeric not null default 0,
  protein     numeric not null default 0,
  carbs       numeric not null default 0,
  fat         numeric not null default 0,
  fiber       numeric not null default 0,
  food_id     uuid references public.foods on delete set null,
  source      text,
  created_at  timestamptz not null default now()
);

-- Aktywności
create table if not exists public.activities (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  date       date not null,
  type       text,
  label      text,
  minutes    numeric,
  steps      int,
  kcal       numeric not null default 0,
  note       text,
  created_at timestamptz not null default now()
);

-- Historia wagi
create table if not exists public.weight_log (
  user_id   uuid not null default auth.uid() references auth.users on delete cascade,
  date      date not null,
  weight_kg numeric not null,
  primary key (user_id, date)
);

-- Plan treningowy (przyda się w etapie 2)
create table if not exists public.training_plan (
  user_id    uuid primary key default auth.uid() references auth.users on delete cascade,
  plan       jsonb,
  updated_at timestamptz default now()
);

create index if not exists meal_entries_user_date on public.meal_entries (user_id, date);
create index if not exists activities_user_date   on public.activities (user_id, date);
create index if not exists foods_user             on public.foods (user_id);

-- ============================================================
--  ZABEZPIECZENIA: każdy widzi i zmienia WYŁĄCZNIE swoje dane
-- ============================================================
do $$
declare t text;
begin
  foreach t in array array['profiles','foods','meal_entries','activities','weight_log','training_plan'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "tylko_moje" on public.%I', t);
    execute format(
      'create policy "tylko_moje" on public.%I for all to authenticated
         using ((select auth.uid()) = user_id)
         with check ((select auth.uid()) = user_id)', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;
