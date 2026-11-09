-- ⚠️ RUN THIS BEFORE SHARING ANY KEYS. Read-only.
--
-- The view relies on Row Level Security to scope rows to the signed-in user.
-- `security_invoker = true` makes the base tables' policies apply as the caller
-- — but ONLY IF THOSE TABLES HAVE RLS ENABLED. If any says `false` below, a
-- signed-in client can read EVERY user's rows from that table, and the external
-- app would see other people's data.
--
-- The SQL Editor cannot reveal this: it runs as postgres and bypasses RLS
-- either way, which is exactly why today's test showed three users' rows.

select c.relname                             as table_name,
       c.relrowsecurity                      as rls_enabled,
       c.relforcerowsecurity                 as rls_forced,
       (select count(*) from pg_policies p
         where p.schemaname = 'public' and p.tablename = c.relname) as policies
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relname in ('sessions','set_logs','daily_weigh_ins','wod_scores',
                    'nutrition_daily','weekly_checkins','profiles','blood_panels')
order by c.relrowsecurity, c.relname;
