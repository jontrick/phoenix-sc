# PHOENIX → EXTERNAL APP: INTEGRATION BRIEF

**For a chat in another organisation that cannot read the Phoenix repo.** Self-contained.
Written 2026-11-09 against Phoenix **v4.9.388**, derived from the source, not recalled.

**Goal:** a daily work-accountability app that auto-fills from Phoenix — training done,
weigh-ins, lifts, food plan. **Peptides and all health/pathology data excluded.**

---

## 0. ⭐ THE WHOLE MECHANISM — ONE VIEW, ONE ROW PER DAY

**Read this and you can stop. Everything below is supporting detail.**

```js
const { data } = await supabase
  .from('accountability_day')
  .select('*')
  .gte('date', '2026-11-01')
  .order('date', { ascending: false });
```

One row per calendar day for the last 180 days. Jon signs into your app with his Phoenix
account; row security scopes it to him automatically. **There is nothing else to read, and
no other table you should touch.**

| column | type | meaning |
|---|---|---|
| `date` | date | **LOCAL day** (Australia/Brisbane, UTC+10, no DST) |
| `trained` | bool | a session was COMPLETED that day |
| `session_name` `session_type` | text | what he did |
| `duration_seconds` `distance_m` | int | seconds, metres |
| `sets_logged` | int | sets recorded that day |
| `volume_kg` | numeric | Σ weight × reps |
| `weighed_in` | bool | he weighed in |
| `weight_kg` | numeric | kilograms, or NULL |
| `scored` | bool | a WOD/Core score was logged |
| `wod_name` | text | which one |
| `kcal` `protein_g` | numeric | what he ate — **NULL today, see below** |
| `target_kcal` `target_protein_g` | numeric | **that day's** target, training-adjusted |
| `kcal_delta` | int | `kcal − target_kcal`. Negative = under. |

### THE FOUR RULES THAT ARE ALREADY APPLIED FOR YOU

These are encoded in the view, server-side, so you cannot get them wrong. They are listed
so you do not re-implement them:

1. **`trained` is not "a session row exists".** Phoenix writes a row the moment a session
   STARTS. The view requires `status = 'completed'` AND a non-null `completed_at`.
2. **Day boundaries are LOCAL, not UTC.** Jon trains at 04:30, which is 18:30 the
   *previous* day in UTC. Phoenix has already shipped this bug once — a UTC day key filed
   every morning's work under yesterday. The view converts with an explicit timezone.
3. **`sets_logged` arrives LATE.** Sets flush from an on-device outbox, minutes or hours
   after the session closes. **A day can be `trained: true` with `sets_logged: 0` and then
   climb.** Never infer "he did not lift" from a zero on a day he trained.
4. **`weight_kg` NULL means he did not weigh in.** Never carry the previous day forward.

### THE TWO THINGS THAT WILL CATCH YOU ANYWAY

**`trained: false` means two different things.** On a past day it means he did not train. On
**today** it only means *not yet* — the day is still open. **Rendering today's `false` as a
missed day is wrong every morning.** Treat today as provisional until it is over.

**NUTRITION IS NULL RIGHT NOW, AND NULL IS NOT ZERO.** Jon is rebuilding the nutrition
domain, so `kcal`, `target_kcal` and `kcal_delta` are NULL for every day. **Render that as
"no data" — never as 0 kcal, never as a missed target.** A zero reads as *"he ate nothing
today"*, which is a far worse wrong answer than an empty cell, and it will be wrong every
single day until he has rebuilt and logged. The plumbing is live and tested; it starts
returning numbers the day he logs a meal, with no change on your side.

**`kcal_delta` is deliberately not a boolean.** "Ate to plan" is a judgement — is 800 kcal
*under* target compliant? — and the view will not hand you a verdict dressed as a fact.
Pick your own threshold.

### WHAT YOU NEED FROM JON

1. The Supabase **project URL** and **`anon` key**. Both are already public in the shipped
   PWA, so they are not secrets and grant nothing on their own.
2. He signs into your app with his Phoenix account. **No shared secret, nothing to rotate.**

**Never ask for the `service_role` key.** It bypasses row security entirely and would expose
the pathology and peptide data this view exists to keep out.

### WHAT CANNOT REACH YOU, BY CONSTRUCTION

No peptide protocol, no blood panels, no pathology photographs, no body photographs, no GPS
tracks, no injury notes, no coaching chat, no food names. Not by the app choosing not to ask
— **those columns are not in the view**, so a `select('*')` cannot reach them. Revoking the
whole integration is one line: `drop view accountability_day;`

---

## 1. ⛔ READ THIS BEFORE PLANNING ANYTHING

**THREE OF THE FOUR THINGS WANTED ARE IN THE CLOUD. THE DAILY FOOD DATA IS NOT.**

| wanted | where it lives | readable externally? |
|---|---|---|
| **Training sessions** | `sessions` table | ✅ yes |
| **Lifts (per set)** | `set_logs` table | ✅ yes |
| **Weigh-ins** | `daily_weigh_ins` table | ✅ yes |
| **WOD / Core scores** | `wod_scores` table | ✅ yes |
| **Recipes** | `profiles.nut_recipes` (mirrored from `phx_recipes_v1_{uid}`) | ⚠️ yes, but see below |
| **What he actually ATE, daily totals, macro targets, adherence** | `localStorage['phx_nut_v1_{uid}']` | ❌ **NOT IN THE CLOUD** |

**Be precise about this, because the halves differ.** Nutrition is split across two stores:

- **Recipes ARE mirrored** to `profiles.nut_recipes`. So the cloud knows what dishes exist.
- **The daily log is not.** `nutSaveState()` is two lines and writes only to
  `localStorage['phx_nut_v1_{uid}']` — meals eaten, daily macro totals, targets, adherence.
  **There is no cloud mirror and therefore nothing to read.**

**For daily accountability it is the missing half that matters.** Knowing his recipe library
does not answer *"did he eat to plan today"*. No credential, key or permission change fixes
it, because **only code running inside Jon's own PWA can read his `localStorage`.**

**So the daily food data needs Phoenix-side work first** — a mirror that writes a daily
nutrition summary to a table. That is a Phoenix job, not an integration job. **Do not design
around reading it; it is not there.** §5 is the recommended shape.

**A note on how this brief was written, which is also a warning about using it.** The first
draft said "nutrition is localStorage only, no cloud mirror". That was too broad — recipes
are mirrored, and the claim was corrected before this file was finished. **If a figure or a
location here matters to a decision, re-derive it from the source rather than trusting the
prose.** Phoenix ships several times a day.

---

## 2. WHAT MUST NEVER CROSS, AND WHY POLITENESS IS NOT ENOUGH

| source | contains | status |
|---|---|---|
| `profiles.peptide_state` | the entire peptide protocol, doses, stock | ⛔ **EXCLUDE** |
| `blood_panels` table | pathology results, markers, reference ranges | ⛔ **EXCLUDE** |
| `blood-panels` storage bucket | **photographs of pathology reports** | ⛔ **EXCLUDE** |
| `coach_conversations` | free-text coaching chat | ⛔ exclude — not needed |
| `checkin-photos` bucket | **body photographs** | ⛔ exclude — not needed |
| `weekly_checkins.niggle_notes` | **free-text injury notes** | ⚠️ exclude unless asked for |

**THE STRUCTURAL PROBLEM:** `peptide_state` is a **column on `profiles`**, the same row
that carries `blab_state` (training). So *"read the user's profile"* reads the peptide
protocol too. Likewise `blood_panels` sits in the same database as `sessions`.

> **An exclusion enforced by the client choosing not to look is not an exclusion.** It is a
> promise that holds until someone writes `select('*')`. Enforce it in the DATABASE — see §3.

---

## 3. THE INTEGRATION SHAPE TO BUILD — a scoped read-only view

Phoenix is a **client-side PWA on GitHub Pages**. Its Supabase URL and `anon` key are
already public in the shipped HTML — **they are not secrets and sharing them grants
nothing.** Row Level Security is what protects the data: the anon key only returns rows
matching the signed-in `auth.uid()`.

Which means the question is not *"what key do I get"*, it is **"what is the signed-in user
allowed to see"** — and today the answer is *everything, including peptides*.

**Do this instead. One Postgres view per concern, each exposing only allowed columns:**

**The full, runnable version of everything below is in the repo at
`supabase/sql/2026-11-09_nutrition_daily.sql`** — one file, table and views together. It is
the authoritative copy; the excerpt here is for reading.

```sql
-- Run in the Supabase SQL editor. Read-only, column-scoped, RLS-respecting.
create view accountability_training with (security_invoker = true) as
  select user_id, session_id, session_name, session_type, mode,
         started_at, completed_at, duration_seconds, status,
         programme_week, total_distance_m
  from sessions;                      -- NOTE: no coords (location history)

create view accountability_lifts with (security_invoker = true) as
  select user_id, session_id, exercise_name, set_number,
         weight_kg, reps, rpe, logged_at
  from set_logs;

create view accountability_weight with (security_invoker = true) as
  select user_id, date, weight_kg, logged_at
  from daily_weigh_ins;               -- NOTE: no notes, no photo_url

create view accountability_scores with (security_invoker = true) as
  select user_id, wod_name, score, score_type, date, tier
  from wod_scores;
```

**`security_invoker = true` is load-bearing.** Without it the view runs as its owner and
**bypasses the caller's RLS** — it would hand every user's rows to anyone who asks. With it,
the existing row policies still apply and each caller sees only their own.

**There is deliberately no view over `profiles`.** That is the row carrying
`peptide_state` — **and `nut_recipes`, which is a reason someone might reach for it.** If
the work app needs programme-week context or the recipe library, expose a view selecting
exactly those columns and nothing else. Never the row:

```sql
create view accountability_programme with (security_invoker = true) as
  select id as user_id, blab_state from profiles;   -- NOT select *
```

**Grant nothing else.** No `service_role` key leaves Phoenix, ever: it bypasses RLS entirely
and would expose the pathology tables regardless of any view.

---

## 4. THE DATA CONTRACT — meanings, not just column names

The parts a second implementation gets wrong:

- **`sessions.status`** — a row exists from the moment a session STARTS. `completed_at`
  being null means in-progress or abandoned. **Do not count a row as "trained today".**
  Filter on `status` plus a non-null `completed_at`.
- **`set_logs` arrives LATE and in batches.** It flushes from an on-device outbox, so sets
  can land minutes or hours after the session, and the flush de-duplicates against what is
  already there. **Poll, do not assume a session's sets are complete when it closes.**
- **`daily_weigh_ins` is UPSERT on `(user_id, date)`.** Re-saving the same day overwrites.
  Treat `date` as the key; never append.
- **`date` columns are LOCAL calendar days, not UTC.** Jon trains at 04:30 in UTC+10.
  Phoenix had a real bug here — a UTC day key filed every morning's work under the previous
  day. **If you re-derive a day from a timestamp, use his local zone or you will reproduce
  it.**
- **`weight_kg` is kilograms. `duration_seconds` is seconds. `total_distance_m` is metres.**
  Stated because a test that asserts a number and never its units is a real trap here.
- **`rpe` may be null.** Absence means not recorded, not zero.
- **The authoritative current weight is the NUTRITION daily record, which is on the phone.**
  `daily_weigh_ins` is the cloud copy and is the right one to read — but if the two ever
  disagree, Phoenix treats the local one as authoritative.

---

## 5. THE FOOD PLAN — ✅ BUILT, v4.9.389. ONE SQL FILE TO APPLY.

**Phoenix now mirrors a daily nutrition summary.** Table `nutrition_daily`, one row per
LOCAL calendar day, upserted on `(user_id, date)`:

| column | meaning |
|---|---|
| `kcal` `protein_g` `carbs_g` `fat_g` | what he actually ate that day |
| `target_kcal` `target_protein_g` `target_carbs_g` `target_fat_g` | **the TRAINING-ADJUSTED target for that day** |
| `updated_at` | when the mirror last wrote |

**⚠️ THE TARGETS ARE PER-DAY, NOT A FIXED GOAL — and this is the one thing to get right.**
Phoenix moves them: a **rest day is -120 kcal and -30g carbs**, and **days 2 and 4 are +160
kcal and +40g carbs**. So *"did he hit his target"* must compare `kcal` against
**`target_kcal` on that same row**, never against a constant. Comparing against his base
goal would show every rest day as under-eating when he hit his real number exactly, and both
figures are the same shape so nothing downstream could detect the mistake.

**`NULL` targets mean "nutrition not set up for that day". They do not mean zero** — and a
day he has not logged produces **no row at all**, deliberately, because a row of zeros reads
as a failed day. **Absent and zero are different facts. Render absent as absent.**

**Summary only.** No meals, no food names, no components. The question is whether he hit his
numbers, and a per-meal mirror is a much larger surface for no extra answer.

**IT WILL NOT WORK UNTIL JON RUNS THE SQL** — `supabase/sql/2026-11-09_nutrition_daily.sql`
in the Supabase dashboard. Until then every write fails with `42P01` and lands in
Settings → Diagnostic as `nutDailyMirror`, naming that file. Deliberate: a mirror that
silently does nothing is the failure this app has shipped most often.

**Latency to expect:** today's row is written on every nutrition save, so it is near-live.
Edits to *earlier* days reconcile on the next app open, which backfills the last 7 days in
one request. **So a correction to Tuesday may take until he next opens Phoenix to appear.**

## 6. WHAT TO ACTUALLY SEND THE OTHER CHAT

**Send:**
1. **This file.** It is self-contained and names the real tables, columns and meanings.
2. The Supabase **project URL and `anon` key** — already public in the shipped app, so this
   grants nothing on its own. Jon can lift both from the live site.
3. **The view names, not the table names** — if they code against `sessions` directly they
   will eventually `select('*')` it. After the SQL is applied they are:
   `accountability_training` · `accountability_lifts` · `accountability_weight` ·
   `accountability_scores` · `accountability_nutrition` · `accountability_programme`.
   **Everything they need is in those six. There is no reason to touch a base table.**

**Never send:**
- The **`service_role` key**. It bypasses RLS and would expose the pathology tables.
- Jon's **password or an auth session/JWT**.
- Anything from `blood_panels`, the `blood-panels` bucket, or `peptide_state`.

**How the work app authenticates:** Jon signs into it with his Phoenix Supabase account.
RLS then scopes every read to his own rows, and the views in §3 scope *which* of his rows.
No shared secret, nothing to rotate, and revoking is `drop view`.

---

## 7. ONE THING WORTH DECIDING BEFORE BUILDING

This is a **work** accountability app. Even with peptides and pathology excluded, the
remaining data is personal: bodyweight every morning, injury notes, training times and —
in `sessions.coords` — **location history of outdoor walks and runs.** The views in §3
deliberately omit `coords`, `notes`, `photo_url` and `niggle_notes` for that reason.

**Worth asking who can see the work app** before wiring bodyweight into it. If it is only
Jon, this is all fine. If a manager or team sees any of it, the right surface is probably
**booleans and streaks — "trained ✓, weighed in ✓, ate to plan ✓"** — rather than the
numbers themselves. That is also a smaller integration and a much smaller thing to get wrong.
