-- ════════════════════════════════════════════════════════════════════════════
-- 2026-11-09 — nutrition_daily table + the scoped read surface for an external
-- accountability app.
--
-- RUN THIS IN THE SUPABASE SQL EDITOR (dashboard → SQL). Phoenix never applies
-- schema changes from code — CLAUDE.md.
--
-- Until PART 1 is applied, every nutrition mirror write fails with 42P01 and
-- lands in Settings → Diagnostic as `nutDailyMirror`. That is deliberate.
-- ════════════════════════════════════════════════════════════════════════════

-- ── PART 1 — the table the app writes ───────────────────────────────────────
-- Summary per LOCAL calendar day. Targets are the TRAINING-ADJUSTED ones, not
-- the base: a rest day is -120 kcal / -30g carbs, days 2 and 4 are +160 / +40g.
-- Comparing intake against the base would make every rest day read as
-- under-eating when he hit his real number exactly.
create table if not exists public.nutrition_daily (
  user_id          uuid        not null references auth.users(id) on delete cascade,
  date             date        not null,          -- LOCAL day, never UTC
  kcal             integer,
  protein_g        numeric(6,1),
  carbs_g          numeric(6,1),
  fat_g            numeric(6,1),
  target_kcal      integer,                       -- NULL = not set up. Not zero.
  target_protein_g numeric(6,1),
  target_carbs_g   numeric(6,1),
  target_fat_g     numeric(6,1),
  updated_at       timestamptz not null default now(),
  primary key (user_id, date)
);

alter table public.nutrition_daily enable row level security;

-- Owner-only, matching every other Phoenix table.
drop policy if exists nutrition_daily_own on public.nutrition_daily;
create policy nutrition_daily_own on public.nutrition_daily
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── PART 2 — the scoped read surface ────════════════════════════════════════
-- ⛔ WHY VIEWS AND NOT "just read the tables".
--
-- `profiles` carries peptide_state (the whole protocol, doses, stock) AND
-- blab_state (training) AND nut_recipes IN ONE ROW. So "read the user's
-- profile" reads the peptide protocol. blood_panels and a storage bucket of
-- PATHOLOGY PHOTOGRAPHS live in the same database as sessions.
--
-- An exclusion the client enforces by choosing not to look is not an
-- exclusion. It is a promise that holds until someone writes select('*').
-- These views make it structural: there is no view over profiles, and no view
-- touches peptides or bloods, so a careless or compromised reader still cannot
-- reach them.
--
-- ⚠️ `security_invoker = true` IS LOAD-BEARING. Without it a view executes as
-- its OWNER and bypasses the caller's row security — it would hand every
-- user's rows to anyone who asks. With it, the policies above still apply.

-- TRAINING — sessions. No `coords`: that is GPS of outdoor runs and walks.
create or replace view public.accountability_training with (security_invoker = true) as
  select user_id, session_id, session_name, session_type, mode,
         started_at, completed_at, duration_seconds, status,
         programme_week, total_distance_m
  from public.sessions;

-- LIFTS — per set. rpe may be NULL: not recorded, not zero.
create or replace view public.accountability_lifts with (security_invoker = true) as
  select user_id, session_id, exercise_name, set_number,
         weight_kg, reps, rpe, logged_at
  from public.set_logs;

-- WEIGHT — no `notes`, no `photo_url`.
create or replace view public.accountability_weight with (security_invoker = true) as
  select user_id, date, weight_kg, logged_at
  from public.daily_weigh_ins;

-- SCORES — WOD / Core.
create or replace view public.accountability_scores with (security_invoker = true) as
  select user_id, wod_name, score, score_type, date, tier
  from public.wod_scores;

-- NUTRITION — the mirror from PART 1.
create or replace view public.accountability_nutrition with (security_invoker = true) as
  select user_id, date, kcal, protein_g, carbs_g, fat_g,
         target_kcal, target_protein_g, target_carbs_g, target_fat_g, updated_at
  from public.nutrition_daily;

-- PROGRAMME CONTEXT — named column only, NEVER `select *` on profiles.
-- This is the row that carries peptide_state.
create or replace view public.accountability_programme with (security_invoker = true) as
  select id as user_id, blab_state
  from public.profiles;

grant select on public.accountability_training,
                public.accountability_lifts,
                public.accountability_weight,
                public.accountability_scores,
                public.accountability_nutrition,
                public.accountability_programme
  to authenticated;

-- ── DELIBERATELY ABSENT. Do not add these "for completeness". ───────────────
--   profiles.peptide_state     the protocol, doses, stock
--   peptide_* anything         the whole domain
--   blood_panels               pathology results and reference ranges
--   storage: blood-panels      PHOTOGRAPHS of pathology reports
--   storage: checkin-photos    body photographs
--   weekly_checkins            carries niggle_notes — free-text injury notes
--   coach_conversations        free-text coaching chat
--   sessions.coords            GPS tracks
--
-- To revoke the whole integration:
--   drop view public.accountability_training, public.accountability_lifts,
--             public.accountability_weight,  public.accountability_scores,
--             public.accountability_nutrition, public.accountability_programme;
