# PHOENIX → EXTERNAL APP: INTEGRATION BRIEF

**For a chat in another organisation that cannot read the Phoenix repo.** Self-contained.
Written 2026-11-09 against Phoenix **v4.9.388**, derived from the source, not recalled.

**Goal:** a daily work-accountability app that auto-fills from Phoenix — training done,
weigh-ins, lifts, food plan. **Peptides and all health/pathology data excluded.**

---

## 1. ⛔ READ THIS BEFORE PLANNING ANYTHING

**THREE OF THE FOUR THINGS WANTED ARE IN THE CLOUD. THE FOOD PLAN IS NOT.**

Phoenix's nutrition domain — meals, recipes, macro targets, the food plan, the whole
eating side — is `localStorage` only. `nutSaveState()` is two lines and writes to the
browser. **There is no cloud mirror and therefore nothing to read.** No credential, key or
permission changes that.

| wanted | where it lives | readable externally? |
|---|---|---|
| **Training sessions** | `sessions` table | ✅ yes |
| **Lifts (per set)** | `set_logs` table | ✅ yes |
| **Weigh-ins** | `daily_weigh_ins` table | ✅ yes |
| **WOD / Core scores** | `wod_scores` table | ✅ yes |
| **Food plan / meals / macros** | `localStorage['phx_nut_v1_{uid}']` | ❌ **NOT IN THE CLOUD** |

**So the food plan needs Phoenix-side work first** — a mirror that writes a daily nutrition
summary to a table. That is a Phoenix job, not an integration job, because only code running
in Jon's own PWA can read his `localStorage`. **Do not design around reading it; it is not
there.** §5 is the recommended shape.

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

**There is deliberately no view over `profiles`.** That is the row carrying `peptide_state`.
If the work app needs programme-week context, expose a view selecting `blab_state` alone —
never the row.

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

## 5. THE FOOD PLAN — the only part needing Phoenix-side work

Only code running inside Jon's PWA can read his nutrition `localStorage`. So:

**Phoenix adds a summary mirror.** A new table, written by Phoenix on the same debounced +
pagehide path its other mirrors already use:

```sql
create table nutrition_daily (
  user_id    uuid not null references auth.users(id),
  date       date not null,                 -- LOCAL day key
  kcal       integer, protein_g integer, carbs_g integer, fat_g integer,
  target_kcal integer, target_protein_g integer,
  adherence  numeric,                       -- logged vs target, if wanted
  updated_at timestamptz not null default now(),
  primary key (user_id, date)
);
alter table nutrition_daily enable row level security;
-- then the same owner-only policy the other tables use
```

**Summary only — totals and targets, not every meal.** The work app wants *"did he eat to
plan"*, and a per-meal mirror is a much larger surface for no benefit.

**This is the Phoenix lane's build, not the external app's.** Until it exists, the work app
should show the food row as *"not available"* rather than guessing — and **not** as zero,
because zero and unknown are different facts and a zero will read as a failed day.

---

## 6. WHAT TO ACTUALLY SEND THE OTHER CHAT

**Send:**
1. **This file.** It is self-contained and names the real tables, columns and meanings.
2. The Supabase **project URL and `anon` key** — already public in the shipped app, so this
   grants nothing on its own. Jon can lift both from the live site.
3. Which views exist once §3 is run. **Tell them the view names, not the table names** — if
   they code against `sessions` directly they will eventually `select('*')` it.

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
