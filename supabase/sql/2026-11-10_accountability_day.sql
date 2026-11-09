-- ════════════════════════════════════════════════════════════════════════════
-- 2026-11-10 — accountability_day
--
-- ⭐ THIS IS THE WHOLE INTEGRATION SURFACE. ONE VIEW, ONE ROW PER DAY.
--
-- The external accountability app reads THIS and nothing else:
--
--     select * from accountability_day where date = current_date;
--
-- RUN IN THE SUPABASE SQL EDITOR. Requires 2026-11-09_nutrition_daily.sql first
-- (this one references nutrition_daily).
--
-- ── WHY A ROLLUP AND NOT "read the six views" ───────────────────────────────
-- Because every rule for interpreting Phoenix's raw tables is a place to get it
-- wrong, and they are not guessable:
--   · a `sessions` row exists from the moment a session STARTS, so its presence
--     is not "he trained" — status must be 'completed' AND completed_at non-null
--   · `set_logs` arrives LATE, in batches, from an on-device outbox — minutes or
--     hours after the session closes
--   · day boundaries are LOCAL (Australia/Brisbane, UTC+10, no DST). Jon trains
--     at 04:30, which is 18:30 the PREVIOUS day in UTC. Phoenix has already
--     shipped this bug once: a UTC day key filed every morning under yesterday.
-- Encoding those here means they are applied once, server-side, correctly, and
-- the other project cannot reproduce them wrongly.
--
-- ⚠️ `security_invoker = true` IS LOAD-BEARING. Without it the view runs as its
-- owner and bypasses the caller's row security, returning every user's rows.
-- ════════════════════════════════════════════════════════════════════════════

create or replace view public.accountability_day with (security_invoker = true) as
with days as (
  -- Scoped to the caller by auth.uid(), so RLS is not even relied upon for the spine.
  select auth.uid() as user_id, gs::date as date
  from generate_series(current_date - interval '180 days', current_date, interval '1 day') gs
),
trained as (
  select user_id,
         (completed_at at time zone 'Australia/Brisbane')::date as date,
         count(*)                        as sessions_completed,
         min(session_name)               as session_name,
         min(session_type)               as session_type,
         sum(duration_seconds)           as duration_seconds,
         sum(total_distance_m)           as distance_m
  from public.sessions
  where status = 'completed' and completed_at is not null
  group by 1, 2
),
lifted as (
  select s.user_id,
         (s.completed_at at time zone 'Australia/Brisbane')::date as date,
         count(l.*)                      as sets_logged,
         round(sum(l.weight_kg * l.reps)::numeric, 0) as volume_kg
  from public.sessions s
  join public.set_logs l on l.session_id = s.id and l.user_id = s.user_id
  where s.status = 'completed' and s.completed_at is not null
  group by 1, 2
),
scored as (
  -- wod_scores.date is a TIMESTAMPTZ (see migrations/20260716000000_create_wod_scores.sql),
  -- not a date, so it must be converted to a LOCAL day like everything else.
  -- There is no wod_name column and no tier column — wod_id is the identifier.
  select user_id,
         (date at time zone 'Australia/Brisbane')::date as date,
         count(*)        as scores_logged,
         min(wod_id)     as wod_id
  from public.wod_scores
  group by 1, 2
)
select
  d.user_id,
  d.date,

  -- TRAINING. false on a PAST day means he did not train. On TODAY it only means
  -- "not yet" — the day is still open. Do not render today's false as a miss.
  coalesce(t.sessions_completed, 0) > 0            as trained,
  t.session_name,
  t.session_type,
  t.duration_seconds,
  t.distance_m,

  -- LIFTS. Arrives late and in batches: a session can be `trained` with
  -- sets_logged still 0 or climbing for a while after. Never infer "he did not
  -- lift" from 0 on a day he trained.
  coalesce(l.sets_logged, 0)                       as sets_logged,
  l.volume_kg,

  -- WEIGHT. NULL = he did not weigh in. Never substitute a previous day's value.
  (w.weight_kg is not null)                        as weighed_in,
  w.weight_kg,

  -- SCORES
  coalesce(sc.scores_logged, 0) > 0                as scored,
  sc.wod_id,

  -- NUTRITION. NULL across the board means NO DATA, and that is the state TODAY:
  -- the nutrition domain is being rebuilt and nothing is logged yet.
  --
  -- ⚠️ NULL IS NOT ZERO AND NOT A FAILED DAY. Render it as "no data" — never as
  -- 0 kcal, never as a missed target. A zero here reads as "he ate nothing",
  -- which is a far worse wrong answer than an empty cell.
  n.kcal                                           as kcal,
  n.target_kcal,
  n.protein_g,
  n.target_protein_g,

  -- Signed difference against THAT DAY's target. Negative = under.
  -- DELIBERATELY NOT A BOOLEAN. "Ate to plan" is a judgement — is 800 kcal UNDER
  -- target compliant? — and baking one definition in here would hand every
  -- consumer a verdict dressed as a fact. The app defines its own threshold.
  case when n.kcal is not null and n.target_kcal is not null
       then n.kcal - n.target_kcal end             as kcal_delta
from days d
left join trained  t  on t.user_id  = d.user_id and t.date  = d.date
left join lifted   l  on l.user_id  = d.user_id and l.date  = d.date
left join scored   sc on sc.user_id = d.user_id and sc.date = d.date
left join public.daily_weigh_ins w on w.user_id = d.user_id and w.date = d.date
left join public.nutrition_daily n on n.user_id = d.user_id and n.date = d.date;

grant select on public.accountability_day to authenticated;

-- ── NOTHING SENSITIVE CROSSES. Verified column by column: ───────────────────
--   no peptide_state, no peptide anything
--   no blood_panels, no pathology photographs
--   no body photographs, no sessions.coords (GPS), no niggle_notes (injuries)
--   no coach_conversations, no food names, no meal detail
--
-- To revoke the whole integration:  drop view public.accountability_day;
