-- ════════════════════════════════════════════════════════════════════════════
-- 2026-11-10d — the working view, plus a caller filter as defence in depth.
--
-- Supersedes 2026-11-10c. Run this whole file; it replaces the view only.
--
-- STEP 1 — PROVE THE CAUSE. Run this line on its own first:
--
--     select auth.uid();
--
-- In the Supabase SQL Editor this returns NULL, because the editor connects as
-- the `postgres` role with no user token. `auth.uid()` reads the JWT claims and
-- there is no JWT.
--
-- THE DEFECT: the day spine was `select auth.uid() as user_id`. With auth.uid()
-- null, every join `t.user_id = d.user_id` compares against NULL, which is never
-- true — so the spine rows appeared (generate_series works) and every left join
-- missed. All columns null, which is indistinguishable from "nothing logged".
--
-- ⚠️ THE INSTRUMENT DID NOT REPRODUCE THE SUBJECT. The view was being tested in
-- a context it does not run in. From a real signed-in client auth.uid() is the
-- user and the old view may well have worked — we would have shipped it as
-- broken, or "fixed" something that was not wrong.
--
-- THE FIX: do not depend on auth.uid() at all. Derive the users from the data
-- the caller can already see, and let Row Level Security do the scoping — which
-- is its job, and which works for an authenticated client regardless.
--   · authenticated client: RLS limits the base tables to that user, so `me`
--     holds exactly one id and rows are that user's
--   · SQL Editor as postgres: RLS is bypassed, so `me` holds every user, and
--     rows stay correctly separated BY user_id rather than merging
-- Either way the view is now testable in the editor and correct in the app.
--
-- Run this whole file. It replaces the view only. No data is touched.
-- ════════════════════════════════════════════════════════════════════════════

create or replace view public.accountability_day with (security_invoker = true) as
with days as (
  -- Brisbane days, not current_date (which is UTC) — see 2026-11-10b.
  select gs::date as date
  from generate_series(
         (now() at time zone 'Australia/Brisbane')::date - interval '180 days',
         (now() at time zone 'Australia/Brisbane')::date,
         interval '1 day') gs
),
me as (
  -- Whose data can the caller see? Under RLS this is exactly one user.
  --
  -- v2026-11-10d: the `auth.uid()` filter is DEFENCE IN DEPTH, not decoration.
  -- Without it this view's shape depends entirely on RLS being enabled on every
  -- base table — and `sessions`, `set_logs`, `daily_weigh_ins` and
  -- `weekly_checkins` were created outside the repo, so their RLS status is not
  -- recorded anywhere. With it, a signed-in caller gets ONLY their own spine
  -- rows, so even a table with RLS off cannot leak another user through THIS
  -- view. It is not a substitute for RLS on the tables themselves — run
  -- RLS_CHECK.sql — it just means this surface does not depend on it.
  --
  -- When auth.uid() is null (SQL Editor, postgres role) the filter is a no-op,
  -- so the view stays testable and returns one row per user per day.
  select user_id from (
    select user_id from public.sessions
    union
    select user_id from public.daily_weigh_ins
    union
    select user_id from public.nutrition_daily
  ) u
  where auth.uid() is null or user_id = auth.uid()
),
spine as (
  select me.user_id, days.date
  from me cross join days
),
trained as (
  select user_id,
         (completed_at at time zone 'Australia/Brisbane')::date as date,
         count(*)              as sessions_completed,
         min(session_name)     as session_name,
         min(session_type)     as session_type,
         sum(duration_seconds) as duration_seconds,
         sum(total_distance_m) as distance_m,
         sum(total_volume_kg)  as volume_kg,
         max(rpe_session)      as rpe_session
  from public.sessions
  where status = 'completed' and completed_at is not null
  group by 1, 2
),
lifted as (
  select s.user_id,
         (s.completed_at at time zone 'Australia/Brisbane')::date as date,
         count(l.id) as sets_logged
  from public.sessions s
  join public.set_logs l on l.session_id = s.id and l.user_id = s.user_id
  where s.status = 'completed' and s.completed_at is not null
  group by 1, 2
),
scored as (
  select user_id,
         (date at time zone 'Australia/Brisbane')::date as date,
         count(*)       as scores_logged,
         min(wod_id)    as wod_id,
         bool_or(is_pb) as any_pb
  from public.wod_scores
  group by 1, 2
)
select
  d.user_id,
  d.date,
  coalesce(t.sessions_completed, 0) > 0 as trained,
  t.session_name,
  t.session_type,
  t.duration_seconds,           -- null on every completed row in the live data today
  t.distance_m,
  t.volume_kg,
  t.rpe_session,
  coalesce(l.sets_logged, 0)            as sets_logged,
  (w.weight_kg is not null)             as weighed_in,
  w.weight_kg,
  coalesce(sc.scores_logged, 0) > 0     as scored,
  sc.wod_id,
  coalesce(sc.any_pb, false)            as personal_best,
  n.kcal,
  n.target_kcal,
  n.protein_g,
  n.target_protein_g,
  case when n.kcal is not null and n.target_kcal is not null
       then n.kcal - n.target_kcal end  as kcal_delta
from spine d
left join trained t  on t.user_id  = d.user_id and t.date  = d.date
left join lifted  l  on l.user_id  = d.user_id and l.date  = d.date
left join scored  sc on sc.user_id = d.user_id and sc.date = d.date
left join public.daily_weigh_ins w on w.user_id = d.user_id and w.date = d.date
left join public.nutrition_daily n on n.user_id = d.user_id and n.date = d.date;

grant select on public.accountability_day to authenticated;
