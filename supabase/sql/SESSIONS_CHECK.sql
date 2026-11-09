-- Read-only. Is accountability_day empty because nothing was logged, or because
-- the view is filtering wrongly? These two answers look identical from the view.

-- A: everything in sessions, by status, with date ranges
select status,
       count(*)                           as rows,
       count(completed_at)                as have_completed_at,
       min(started_at)::date              as earliest,
       max(started_at)::date              as latest
from sessions
group by status
order by rows desc;

-- B: the ten most recent, whatever their state
select (started_at   at time zone 'Australia/Brisbane')::date as started_local,
       (completed_at at time zone 'Australia/Brisbane')::date as completed_local,
       status, session_type, session_name, duration_seconds
from sessions
order by started_at desc
limit 10;

-- C: are there weigh-ins and sets at all?
select 'daily_weigh_ins' as t, count(*) as rows, max(date)::text        as latest from daily_weigh_ins
union all
select 'set_logs',            count(*),          max(logged_at)::text            from set_logs
union all
select 'wod_scores',          count(*),          max(date)::text                 from wod_scores;
