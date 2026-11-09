-- ════════════════════════════════════════════════════════════════════════════
-- RUN THIS FIRST. It changes NOTHING — it only reads the schema and prints it.
--
-- Paste the whole result back to the PM chat. The views are then generated from
-- the real column names and types instead of from what the app appears to write.
--
-- WHY: the app's code shows what it SENDS, which is not the same as what the
-- table HAS. Two columns referenced in the first draft (sessions.mode,
-- wod_scores.wod_name) are not columns at all, and wod_scores.date turned out
-- to be a timestamptz rather than a date — which would have shifted every day
-- boundary by up to ten hours.
-- ════════════════════════════════════════════════════════════════════════════

select table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name in (
    'sessions', 'set_logs', 'daily_weigh_ins', 'wod_scores',
    'nutrition_daily', 'weekly_checkins', 'weight_logs'
  )
order by table_name, ordinal_position;
