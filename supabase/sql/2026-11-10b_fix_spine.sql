-- ════════════════════════════════════════════════════════════════════════════
-- 2026-11-10b — FIX: the view had no row for TODAY.
--
-- Run this whole file. It replaces the view only — nothing is dropped, no data
-- is touched, and nutrition_daily is left alone.
--
-- THE BUG: the day spine used `current_date`, which is the DATABASE's date and
-- therefore UTC. Brisbane is UTC+10, so for the first TEN HOURS of every
-- Brisbane day Postgres still thinks it is yesterday. Every bucket in the view
-- converts timestamps to a Brisbane day — so the current Brisbane day had no
-- spine row to join to, and the session Jon completed today vanished.
--
-- Proven live: `sessions` held a completed row started AND completed 2026-11-10
-- Brisbane, and the view returned 2026-11-03 .. 2026-11-09 with no 11-10 row.
--
-- This is the same UTC day-key bug the app itself shipped in v4.9.168 (a UTC key
-- filed every 04:30 session under the previous day), reintroduced in the single
-- place in this view that was not explicitly converted.
-- ════════════════════════════════════════════════════════════════════════════

create or replace view public.accountability_day with (security_invoker = true) as
with days as (
  select auth.uid() as user_id, gs::date as date
  from generate_series(
         (now() at time zone 'Australia/Brisbane')::date - interval '180 days',
         (now() at time zone 'Australia/Brisbane')::date,
         interval '1 day') gs
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
         count(*)      as scores_logged,
         min(wod_id)   as wod_id,
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
from days d
left join trained t  on t.user_id  = d.user_id and t.date  = d.date
left join lifted  l  on l.user_id  = d.user_id and l.date  = d.date
left join scored  sc on sc.user_id = d.user_id and sc.date = d.date
left join public.daily_weigh_ins w on w.user_id = d.user_id and w.date = d.date
left join public.nutrition_daily n on n.user_id = d.user_id and n.date = d.date;

grant select on public.accountability_day to authenticated;
