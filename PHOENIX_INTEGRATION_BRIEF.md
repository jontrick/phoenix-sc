# PHOENIX → EXTERNAL APP: INTEGRATION BRIEF

**For a chat in another organisation that cannot read the Phoenix repo.** Self-contained.
Written 2026-11-10 against Phoenix **v4.9.392**. **The integration is LIVE and verified
against real data** — nothing needs to be set up on the Phoenix side.

Phoenix is Jon's personal fitness PWA (training, nutrition, bodyweight). You are building a
daily work-accountability app that fills itself in from it.

---

## 1. ⭐ THE WHOLE MECHANISM — ONE VIEW, ONE ROW PER DAY

**Read this section and you can start building. The rest is detail.**

```js
const { data } = await supabase
  .from('accountability_day')
  .select('*')
  .order('date', { ascending: false })
  .limit(30);
```

One row per calendar day for the last 180 days. **Query this and nothing else.** Jon signs
in with his own Phoenix account; row-level security scopes every read to him automatically.

**Verified live on 2026-11-10**, which is the shape to expect:

```
date        trained  session_name         sets_logged  weighed_in  weight_kg  kcal
2026-11-10  true     Upper — Max Effort   22           true        111.4      null
```

| column | type | meaning |
|---|---|---|
| `date` | date | **Local day** (Australia/Brisbane, UTC+10, no DST) |
| `trained` | bool | a session was **completed** that day |
| `session_name` `session_type` | text | what he did |
| `duration_seconds` | int | **currently always null** — see §3 |
| `distance_m` `volume_kg` | numeric | metres; Σ weight × reps |
| `rpe_session` | numeric | session RPE, may be null |
| `sets_logged` | int | sets recorded that day |
| `weighed_in` | bool | he weighed in |
| `weight_kg` | numeric | kilograms, or null |
| `scored` `wod_id` `personal_best` | bool/text/bool | WOD or Core score |
| `kcal` `protein_g` | numeric | what he ate — **null for now, see §2** |
| `target_kcal` `target_protein_g` | numeric | **that day's** target, training-adjusted |
| `kcal_delta` | int | `kcal − target_kcal`. Negative = under. |

### Four rules already applied for you — do not re-implement them

1. **`trained` is not "a session row exists".** Phoenix writes a row the moment a session
   *starts*, and two thirds of that table are unfinished sessions. The view requires
   completed status **and** a completion timestamp.
2. **Day boundaries are local, not UTC.** Jon trains at 04:30, which is 18:30 *the previous
   day* in UTC. This bug has been shipped twice here — once in the app, once in this very
   view, where it deleted the current day until 10:00 every morning. The view converts with
   an explicit timezone.
3. **`sets_logged` arrives late.** Sets flush from an on-device outbox, minutes or hours
   after a session closes. **A day can read `trained: true` with `sets_logged: 0`, then
   climb.** Never infer "he did not lift" from a zero on a day he trained.
4. **`weight_kg` null means he did not weigh in.** Never carry the previous day forward.

---

## 2. THE TWO THINGS THAT WILL STILL CATCH YOU

**`trained: false` means two different things.** On a past day he did not train. On **today**
it means only *not yet* — the day is still open. **Rendering today's `false` as a missed day
is wrong every morning.** Treat today as provisional until it is over.

**NUTRITION IS NULL RIGHT NOW, AND NULL IS NOT ZERO.** Jon is rebuilding the nutrition part
of Phoenix, so `kcal`, `target_kcal` and `kcal_delta` are null on every row.

> **Render it as "no data" — never as 0 kcal, never as a missed target.** A zero reads as
> *"he ate nothing today"*, a far worse wrong answer than a blank, and it would be wrong
> every single day until he finishes.

The plumbing is already live and tested. **It starts returning real numbers the day he logs
a meal, with no change on your side.**

**`kcal_delta` is deliberately not a boolean.** "Ate to plan" is a judgement — is 800 kcal
*under* target compliant? — and the view will not hand you a verdict dressed as a fact.
Pick your own threshold.

---

## 3. SMALLER THINGS WORTH KNOWING

- **`duration_seconds` is null on every completed session** in the live data. The column
  exists and is wired; callers mostly do not pass it. **Do not build a "time trained"
  feature on it** without first checking it has started arriving. It is not your bug.
- **`wod_scores` is empty** (0 rows), so `scored` is false everywhere today. Jon's WOD
  scores currently live only on his phone.
- **`rpe_session` and `volume_kg`** are populated for some sessions, not all.
- **180 days** of history, rolling. Older days are not available.
- Jon's local day is **Australia/Brisbane**, UTC+10, and Queensland has **no daylight
  saving** — so the offset never changes.

---

## 4. WHAT YOU NEED FROM JON

1. The Supabase **Project URL** and the **`anon` / `public`** key. Both are already public
   in the shipped PWA, so they are not secrets and grant nothing on their own.
2. He signs into your app with his Phoenix account. **No shared secret, nothing to rotate.**

**Never ask for the `service_role` key.** It bypasses row-level security entirely and would
expose the medical data this view exists to keep out.

---

## 5. WHAT CANNOT REACH YOU, BY CONSTRUCTION

Phoenix also holds a peptide/hormone protocol, blood-panel results, **photographs of
pathology reports**, body photographs, free-text injury notes, coaching chat, and GPS tracks
of outdoor runs.

**None of it is a column in this view.** Not because the app chooses not to ask — a
`select('*')` physically cannot reach it. Verified table by table, and confirmed that
row-level security is enabled with correct per-user policies on all eight underlying tables.

**If you find yourself wanting a column that is not in `accountability_day`, ask Jon rather
than querying a base table.** The view exists so that the rules in §1 are applied once,
server-side, and so that the excluded data stays excluded.

Revoking the whole integration is one line on Jon's side: `drop view accountability_day;`

---

## 6. IF SOMETHING LOOKS WRONG

The view is a rollup, and **a rollup cannot audit itself** — "nothing was logged" and "the
view dropped it" look identical from the outside. Every one of the four bugs found while
building this was caught by comparing the view against its source tables, never by reading
the view alone.

So if a day looks empty and Jon says he trained, **say so rather than designing around it.**
That is a Phoenix-side question with a Phoenix-side answer.
