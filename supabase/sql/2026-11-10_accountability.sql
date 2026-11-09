-- ════════════════════════════════════════════════════════════════════════════
-- PHOENIX → EXTERNAL ACCOUNTABILITY APP.  THE WHOLE INTEGRATION, ONE FILE.
-- 2026-11-10. Every column below was verified against information_schema on
-- that date, not inferred from the app's source.
--
-- RUN THIS WHOLE FILE IN THE SUPABASE SQL EDITOR. It supersedes
-- 2026-11-09_nutrition_daily.sql and 2026-11-10_accountability_day.sql, both of
-- which referenced columns that do not exist (sessions.session_id, sessions.mode,
-- wod_scores.wod_name, wod_scores.tier) and therefore rolled back in full —
-- the editor runs a script as ONE transaction, so nothing from the earlier
-- attempt was created. Safe to run on a clean database or over a partial one:
-- every statement is `if not exists` / `or replace`.
--
-- WHAT THE EXTERNAL APP READS, AND NOTHING ELSE:
--     select * from accountability_day where date = current_date;
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. THE TABLE PHOENIX WRITES ─────────────────────────────────────────────
-- One summary row per LOCAL calendar day. Targets are the TRAINING-ADJUSTED
-- figures, not the base: a rest day is -120 kcal / -30g carbs, days 2 and 4 are
-- +160 / +40g. Comparing intake to the base would show every rest day as
-- under-eating when the real target was hit exactly.
create table if not exists public.nutrition_daily (
  user_id          uuid        not null references auth.users(id) on delete cascade,
  date             date        not null,
  kcal             integer,
  protein_g        numeric(6,1),
  carbs_g          numeric(6,1),
  fat_g            numeric(6,1),
  target_kcal      integer,                       -- NULL = not set up. NOT zero.
  target_protein_g numeric(6,1),
  target_carbs_g   numeric(6,1),
  target_fat_g     numeric(6,1),
  updated_at       timestamptz not null default now(),
  primary key (user_id, date)
);

alter table public.nutrition_daily enable row level security;

drop policy if exists nutrition_daily_own on public.nutrition_daily;
create policy nutrition_daily_own on public.nutrition_daily
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── 2. THE READ SURFACE — ONE VIEW, ONE ROW PER DAY ─────────────────────────
-- ⚠️ `security_invoker = true` IS LOAD-BEARING. Without it the view runs as its
-- OWNER and bypasses the caller's row security, returning every user's rows.
--
-- VERIFIED COLUMN TYPES, because two of these differ and it matters:
--   sessions.completed_at   timestamptz  -> must be converted to a local day
--   wod_scores.date         timestamptz  -> must be converted to a local day
--   daily_weigh_ins.date    date         -> already a local day, join directly
--   set_logs.session_id     uuid         -> references sessions.id (NOT session_id)
--
-- Local means Australia/Brisbane, UTC+10, no daylight saving. Jon trains at
-- 04:30, which is 18:30 the PREVIOUS day in UTC.
create or replace view public.accountability_day with (security_invoker = true) as
with days as (
  select auth.uid() as user_id, gs::date as date
  from generate_series(current_date - interval '180 days', current_date, interval '1 day') gs
),
trained as (
  select user_id,
         (completed_at at time zone 'Australia/Brisbane')::date as date,
         count(*)                   as sessions_completed,
         min(session_name)          as session_name,
         min(session_type)          as session_type,
         sum(duration_seconds)      as duration_seconds,
         sum(total_distance_m)      as distance_m,
         sum(total_volume_kg)       as volume_kg,
         max(rpe_session)           as rpe_session
  from public.sessions
  where status = 'completed' and completed_at is not null
  group by 1, 2
),
lifted as (
  select s.user_id,
         (s.completed_at at time zone 'Australia/Brisbane')::date as date,
         count(l.id)                as sets_logged
  from public.sessions s
  join public.set_logs l on l.session_id = s.id and l.user_id = s.user_id
  where s.status = 'completed' and s.completed_at is not null
  group by 1, 2
),
scored as (
  select user_id,
         (date at time zone 'Australia/Brisbane')::date as date,
         count(*)                   as scores_logged,
         min(wod_id)                as wod_id,
         bool_or(is_pb)             as any_pb
  from public.wod_scores
  group by 1, 2
)
select
  d.user_id,
  d.date,

  -- TRAINING. On a PAST day false means he did not train. On TODAY it means
  -- only "not yet" — the day is still open. Do not render today's false as a miss.
  coalesce(t.sessions_completed, 0) > 0   as trained,
  t.session_name,
  t.session_type,
  t.duration_seconds,
  t.distance_m,
  t.volume_kg,
  t.rpe_session,

  -- LIFTS. Sets flush from an on-device outbox, so they arrive LATE and in
  -- batches. A day can be trained:true with sets_logged:0 and then climb.
  -- Never infer "he did not lift" from a zero on a day he trained.
  coalesce(l.sets_logged, 0)              as sets_logged,

  -- WEIGHT. NULL means he did not weigh in. Never carry a previous day forward.
  (w.weight_kg is not null)               as weighed_in,
  w.weight_kg,

  -- SCORES
  coalesce(sc.scores_logged, 0) > 0       as scored,
  sc.wod_id,
  coalesce(sc.any_pb, false)              as personal_best,

  -- NUTRITION. NULL across the board means NO DATA — the state today, while the
  -- nutrition domain is rebuilt.
  -- ⚠️ NULL IS NOT ZERO AND NOT A FAILED DAY. Render it as "no data": a zero
  -- reads as "he ate nothing today", a far worse wrong answer than a blank.
  n.kcal,
  n.target_kcal,
  n.protein_g,
  n.target_protein_g,

  -- Signed difference against THAT DAY's target. Negative = under.
  -- DELIBERATELY NOT A BOOLEAN: "ate to plan" is a judgement (is 800 under
  -- compliant?) and a view must not hand over a verdict dressed as a fact.
  case when n.kcal is not null and n.target_kcal is not null
       then n.kcal - n.target_kcal end     as kcal_delta
from days d
left join trained t  on t.user_id  = d.user_id and t.date  = d.date
left join lifted  l  on l.user_id  = d.user_id and l.date  = d.date
left join scored  sc on sc.user_id = d.user_id and sc.date = d.date
left join public.daily_weigh_ins w on w.user_id = d.user_id and w.date = d.date
left join public.nutrition_daily n on n.user_id = d.user_id and n.date = d.date;

grant select on public.accountability_day to authenticated;

-- ── NOTHING SENSITIVE CAN CROSS, BY CONSTRUCTION ────────────────────────────
-- These are not columns in the view, so a select('*') cannot reach them:
--   profiles.peptide_state        the protocol, doses, stock
--   blood_panels + its bucket     pathology results and PHOTOGRAPHS of reports
--   checkin-photos bucket         body photographs
--   weekly_checkins.niggle_notes  free-text injury notes
--   weekly_checkins.photo_*_url   body photographs
--   coach_conversations           free-text coaching chat
--   sessions.details              carries GPS coords for walks and runs
--   any food name or meal detail
--
-- Revoke the entire integration:
--   drop view public.accountability_day;
