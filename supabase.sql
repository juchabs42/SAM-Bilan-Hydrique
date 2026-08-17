-- SAM Bilan Hydrique — schéma Supabase V2
-- Exécuter dans SQL Editor sur le projet Supabase.

create extension if not exists pgcrypto;

create table if not exists public.parcels (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  location_name text not null,
  latitude double precision not null,
  longitude double precision not null,
  area_ha numeric not null check (area_ha > 0),
  clay_pct numeric not null check (clay_pct >= 0 and clay_pct <= 100),
  silt_pct numeric not null check (silt_pct >= 0 and silt_pct <= 100),
  sand_pct numeric not null check (sand_pct >= 0 and sand_pct <= 100),
  soil_class text not null,
  rum_mm_cm numeric not null check (rum_mm_cm > 0),
  root_depth_cm numeric not null check (root_depth_cm > 0),
  ru_mm numeric not null check (ru_mm > 0),
  p_factor numeric not null default 0.5 check (p_factor > 0 and p_factor < 1),
  rfu_mm numeric not null check (rfu_mm > 0),
  irrigation_system text not null default 'drip' check (irrigation_system in ('drip','sprinkler')),
  ground_cover boolean not null default false,
  harvest_date date,
  use_custom_kc boolean not null default false,
  kc_initial numeric not null,
  kc_mid numeric not null,
  kc_peak numeric,
  kc_end numeric not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Migration sûre pour une base V1 déjà existante.
alter table public.parcels add column if not exists irrigation_system text not null default 'drip';
alter table public.parcels add column if not exists harvest_date date;
alter table public.parcels add column if not exists kc_peak numeric;

create table if not exists public.irrigations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  parcel_id uuid not null references public.parcels(id) on delete cascade,
  irrigation_date date not null,
  amount_mm numeric not null check (amount_mm >= 0),
  series_id uuid,
  repeat_interval_days integer,
  series_start_date date,
  series_end_date date,
  created_at timestamptz not null default now()
);

create table if not exists public.rain_corrections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  parcel_id uuid not null references public.parcels(id) on delete cascade,
  rain_date date not null,
  amount_mm numeric not null check (amount_mm >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(parcel_id, rain_date)
);

create index if not exists parcels_user_idx on public.parcels(user_id);
create index if not exists irrigations_parcel_date_idx on public.irrigations(parcel_id, irrigation_date);
create index if not exists rain_corrections_parcel_date_idx on public.rain_corrections(parcel_id, rain_date);

alter table public.parcels enable row level security;
alter table public.irrigations enable row level security;
alter table public.rain_corrections enable row level security;

grant select, insert, update, delete on public.parcels to authenticated;
grant select, insert, update, delete on public.irrigations to authenticated;
grant select, insert, update, delete on public.rain_corrections to authenticated;

drop policy if exists "parcels_select_own" on public.parcels;
drop policy if exists "parcels_insert_own" on public.parcels;
drop policy if exists "parcels_update_own" on public.parcels;
drop policy if exists "parcels_delete_own" on public.parcels;
drop policy if exists "irrigations_select_own" on public.irrigations;
drop policy if exists "irrigations_insert_own" on public.irrigations;
drop policy if exists "irrigations_update_own" on public.irrigations;
drop policy if exists "irrigations_delete_own" on public.irrigations;
drop policy if exists "rain_select_own" on public.rain_corrections;
drop policy if exists "rain_insert_own" on public.rain_corrections;
drop policy if exists "rain_update_own" on public.rain_corrections;
drop policy if exists "rain_delete_own" on public.rain_corrections;

-- PARCELS
create policy "parcels_select_own" on public.parcels for select to authenticated using ((select auth.uid()) = user_id);
create policy "parcels_insert_own" on public.parcels for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "parcels_update_own" on public.parcels for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "parcels_delete_own" on public.parcels for delete to authenticated using ((select auth.uid()) = user_id);

-- IRRIGATIONS
create policy "irrigations_select_own" on public.irrigations for select to authenticated using ((select auth.uid()) = user_id);
create policy "irrigations_insert_own" on public.irrigations for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "irrigations_update_own" on public.irrigations for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "irrigations_delete_own" on public.irrigations for delete to authenticated using ((select auth.uid()) = user_id);

-- CORRECTIONS DE PLUIE
create policy "rain_select_own" on public.rain_corrections for select to authenticated using ((select auth.uid()) = user_id);
create policy "rain_insert_own" on public.rain_corrections for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "rain_update_own" on public.rain_corrections for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "rain_delete_own" on public.rain_corrections for delete to authenticated using ((select auth.uid()) = user_id);
