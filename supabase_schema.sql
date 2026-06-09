-- ──────────────────────────────────────────
--  Calmify — Supabase Schema
--  Run this in your Supabase SQL Editor
-- ──────────────────────────────────────────

-- 1. Profiles table (public display info)
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  username    text not null unique,
  created_at  timestamptz default now()
);

-- 2. Stats table (one row per user, upserted each session)
create table if not exists public.stats (
  id                bigint generated always as identity primary key,
  user_id           uuid not null references auth.users(id) on delete cascade unique,
  total_sound_secs  int  not null default 0,
  total_study_secs  int  not null default 0,
  total_rest_secs   int  not null default 0,
  total_sessions    int  not null default 0,
  sound_breakdown   jsonb not null default '{}'::jsonb,
  updated_at        timestamptz default now()
);

-- Auto-update updated_at
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger stats_updated_at
  before update on public.stats
  for each row execute procedure public.touch_updated_at();

-- ── Row Level Security ──────────────────────

alter table public.profiles enable row level security;
alter table public.stats     enable row level security;

-- Profiles: users can read all, write only their own
create policy "profiles_select" on public.profiles for select using (true);
create policy "profiles_insert" on public.profiles for insert with check (auth.uid() = id);
create policy "profiles_update" on public.profiles for update using (auth.uid() = id);

-- Stats: users can only read/write their own row
create policy "stats_select" on public.stats for select using (auth.uid() = user_id);
create policy "stats_insert" on public.stats for insert with check (auth.uid() = user_id);
create policy "stats_update" on public.stats for update using (auth.uid() = user_id);
