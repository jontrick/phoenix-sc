-- Blood panels — pathology report archive + extracted markers.
-- Run this in the Supabase SQL Editor (dashboard → SQL Editor → New query → Run).
-- Project: mxtowhccuqarszcwpbkq (Sydney ap-southeast-2)
--
-- This stores MEDICAL data. Unlike checkin-photos, the storage bucket created
-- here is PRIVATE — images are only reachable via short-lived signed URLs.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. TABLE
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists blood_panels (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references profiles(id) on delete cascade not null,
  panel_date   date not null,                -- date the blood was drawn
  lab          text,                         -- e.g. "Sullivan Nicolaides", "QML"
  fasted       boolean default true,
  photo_path   text,                         -- object path inside the private bucket
  markers      jsonb default '[]'::jsonb,    -- [{name, value, unit, ref_low, ref_high, ref_text, flag}]
  notes        text,
  source       text default 'manual',        -- 'manual' | 'ai_extracted' | 'ai_corrected'
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

create index if not exists blood_panels_user_date_idx
  on blood_panels (user_id, panel_date desc);

alter table blood_panels enable row level security;

drop policy if exists "Users manage own blood panels" on blood_panels;
create policy "Users manage own blood panels" on blood_panels
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant all on blood_panels to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. PRIVATE STORAGE BUCKET
-- ─────────────────────────────────────────────────────────────────────────────
-- public = false. Reports are fetched with createSignedUrl(), which mints a
-- URL that expires. A leaked link stops working; a leaked checkin-photos link
-- never does.

insert into storage.buckets (id, name, public)
values ('blood-panels', 'blood-panels', false)
on conflict (id) do update set public = false;

-- Object paths are {user_id}/{panel_id}.jpg — the first path segment is the
-- owner, which is what these policies key off.

drop policy if exists "Users read own blood panel images"   on storage.objects;
drop policy if exists "Users upload own blood panel images" on storage.objects;
drop policy if exists "Users update own blood panel images" on storage.objects;
drop policy if exists "Users delete own blood panel images" on storage.objects;

create policy "Users read own blood panel images" on storage.objects
  for select using (
    bucket_id = 'blood-panels'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users upload own blood panel images" on storage.objects
  for insert with check (
    bucket_id = 'blood-panels'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users update own blood panel images" on storage.objects
  for update using (
    bucket_id = 'blood-panels'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users delete own blood panel images" on storage.objects
  for delete using (
    bucket_id = 'blood-panels'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. VERIFY
-- ─────────────────────────────────────────────────────────────────────────────
-- select id, public from storage.buckets where id = 'blood-panels';
--   → expect public = false
-- select count(*) from blood_panels;
--   → expect 0
