# TRAINING → CENTRAL PM — HANDOFF

> **v4.9.391 (10 Nov 2026)** — No rings anywhere (Jon: no access, not at ring-dip level). Finisher — Dips / Rows / Slams (training wk 2 and wk 4 Tue): Ring Dips → Bench Dips (feet on floor) ×10, Ring Rows → Barbell Inverted Row ×10. Checked the scheduled Core/WOD add-ons (core-s1/r1/s2/r2, wod-valkyrie/hammerfall/hermes/leg-row): none use rings. Test `NORINGS` scans all 36 days.

> **v4.9.390 (9 Nov 2026)** — Jon missed Sun 8 + Mon 9. One-off `_draftReschedule1109` (on load, dead after 11 Nov): W2D6 Speed Lower → skipped; W3D1 Bronco → Wed 11 Nov; W3D3 Sprint/Power → skipped this week. Progression unaffected (week is date-driven). Harness blabCalGet count 25 → 26. **Archive with `_draftRepairSat7` / `_phxRepair1010` once done.**

> **v4.9.388 (7 Nov 2026)** — Band colour/wraps box also on: superset cards (each band movement, labelled A/B band when both are banded — e.g. Band Face Pull), and session warm-up rows with `uses_band` (Band pull-aparts, Face pulls with band, Lateral band walks). Same `records[name+'_band_*']` store. Jon: "band colour for band pull aparts too all times in schedule".

> **v4.9.387 (7 Nov 2026)** — Any lift with "band" in its name (/\bband/i: Speed Bench (mini bands), Speed Box Squat (band)) shows Band colour (text) + wraps around the bar (number) under the coaching note; saved as typed to `records[name+'_band_colour'|'_band_wraps']`, prefilled next time. Jon: "band colour note and number of twist around bar for tension". Test `BAND`.

> **v4.9.386 (7 Nov 2026)** — `blabToPhoenixSession` percentage_sets used a FLAT `rest_sec = 180`, ignoring the programme's `rest` — every speed set ran a 3-min rest timer. Now `ex.rest > 0 ? ex.rest : 180`. Speed Bench 60 s, Speed Box Squat 90 s, Speed Deadlift 90 s (Jon). Only the Draft programme sets `rest` on percentage_sets, so BLAB is unchanged. Test `SPEEDREST`. (Near miss: a `//` comment placed mid-object-line commented out `sets:` — runtime check stayed CLEAN, functional DRAFT test caught it.)

> **v4.9.385 (7 Nov 2026)** — Every timed Mon/Wed part from training week 2 has a gym version (Jon: field or gym by weather). New: `draft-sled-gym` (heavy prowler 15 m, takes kg) for Resisted Sprints, `draft-agil-gym` (same drill on the gym floor, or a 5 m lateral cone shuffle) for the 5-10-5 / 3-cone. One kg box per card keyed by the field spec; the gym version reads it. Test `WETDAY`.

> **v4.9.384 (7 Nov 2026)** — Sat Flat DB Bench / Strict Pull-Up: pull-ups prescribed as a NUMBER = `records['Strict Pull-Up Test_max']` − 2 (min 1; 5 if untested), `_draftPullMax/_draftPullReps`. Jon: "for chins this needs to always be the case" — no 'max minus N' text anywhere in the Draft programme (test PULLREPS asserts it across all 36 days).

> **v4.9.383 (7 Nov 2026)** — Speed Bench sets carry `label: 'Grip: Close|Medium|Wide'` (repeating); translator passes `_perSetLabel`; the lift renderer draws any per-set label on its own gold line above the row (generic — any set can carry one). Test `GRIP`.

> **v4.9.382 (7 Nov 2026) — BUG IN .378:** the PWA relaunch restore (`_phxShouldReopenSession`) parsed the field part key `blab:2:5f:<date>` with parseInt → day 5 → reopened the GYM session; Jon pressed Complete and Speed Upper was ticked while Field Tests stayed open. Fixed: parts reopen via `draftOpenFieldTests`; `_blabUnfinishedToday` ignores non-numeric day keys. One-off `_draftRepairSat7` (runs once on load) removes the 7 Nov week-2-day-5 log entry, restores last_completed_day, un-ticks the calendar entry, and records Field Tests done if today's results exist. **Archive `_draftRepairSat7` once Jon confirms Today is right.** Harness blabCalGet count 24 → 25.

> **v4.9.381 (7 Nov 2026)** — Every saved result is dated (`records[name+"_result_date"]`, from the Save button, video timer and attempts), and the Best box shows anything saved today when the session is reopened (Jon: "frustrating they aren't on the screen after flicking back").
> **v4.9.380 (7 Nov 2026)** — Result-capture blocks (field tests and every other `_blabResultCapture`) show one box per attempt (count from "best of N" in the note, default 3), saved on every keystroke to `records[name+'_att'] = {date, vals}`; the best (min for unit 'sec', else max) is written to `records[name+'_result']` immediately and shown in the Best box. Jon: screen timed out between tests and the typed results were lost. Save button kept (shows the notice). Test `ATTEMPTS`.

> **v4.9.378 (5 Nov 2026) — SAT 7 NOV SPLIT INTO TWO SESSIONS; NO CORE/WOD THAT WEEKEND.** Jon: "split the field testing and gym sessions up on the weekend and remove the wods/core" → chose *two sessions, same day* and *this weekend only*.
> - W2 day 5 is now 'Speed Upper' (gym only). Field tests are `draftGetSessionData(2,'field')`, opened by the calendar custom `{cat:'TEST', libId:'draft-field-tests'}` via a hook at the top of `_phxStartSession` → `draftOpenFieldTests`. Completion copies results into `draft.tests` (`draftFieldResultsToTests`) and saves a `wod_scores` row (stamps the tile done). It NEVER calls blabCompleteSession.
> - `_blabCurrentSession.part = 'f'` → both progress / session keys become `blab:2:5f:<date>`, so field blocks cannot mark the gym session's blocks done.
> - `draftSchedule`: training week 1 gets the field custom and no Core/WOD; weeks 2-4 unchanged. `draftReconcileCustoms` (runs once on load) brings an already-built calendar into line for PENDING Draft entries dated today+; completed, past and his own entries untouched.
> - Harness `blabCalGet` call count 23 → 24 (the reconcile). Tests SPLIT x3, DRAFT calendar updated.

> **v4.9.377 (5 Nov 2026)** — Box squats (matched by name, /box squat/i) show Box height (in) + Depth on the box (Below / Parallel / Above) under the coaching note: `_phxBoxSqHTML/Get/Set`, `records[name+'_box_in']` and `[name+'_box_depth']`; a 'parallel' box squat defaults to Parallel. Per exercise, not per set. Test `BOXSQ`.

> **v4.9.375 (5 Nov 2026)** — Thu Bulgarian Split Squat now pairs with **Bench Reverse Hyper** (12 reps; v4.9.376 — DB RDL was tried first but RDL is already earlier on Thursday) instead of the 45° Back Extension, everywhere in the Draft programme. Jon: back extension is too far from the split-squat bench to superset. Test `SUBRDL`.

> **v4.9.374 (4 Nov 2026)** — Box height is PER SET (Jon: "I build up the height so not all same"). Lift sessions: a bodyweight box jump keeps the load column, which `phxExerciseUnitClass` already labels `in` (value travels in the existing weight slot, as every `in`-class movement always has). Conditioning sets: box-jump rows get an IN input (`data-dc-in`), saved per session (`_draftReps` key `i:k:in`) and remembered per set number (`records[title+'_box_in_set'+k]`). The .371/.372 single header box is archived to blab_archive.js.

> **v4.9.373 (4 Nov 2026)** — Conditioning 'sets' parts (Lateral Bound, Seated Box Jump, Wed plyos) render like a lift: one row per set — number, reps (prefilled from the ×N in the prescription, editable), tick; tick still starts the rest timer. Reps saved per session in localStorage `<draft_chk key>_reps` (`_draftReps`/`_draftSetReps`). Box height sits above the rows. Jon: "should still read like regular lifting ... with the sets down and a tick box". Test `SETROWS`.

> **v4.9.372 (4 Nov 2026)** — Box height now in INCHES (`_phxBoxIn*`, `records[name+"_box_in"]`, `data-box-in`), Jon: "the boxes are measured that way". **v4.9.371** — Box height on EVERY box jump, matched by name (/box jump/i): `_phxBoxCmHTML(name)` in the lift renderer header and on conditioning 'sets' cards; saved on input to `records[name+'_box_cm']`, prefilled next time. Jon: "always have in measure on all box jumps". Test `BOXCM`.

> **v4.9.370 (4 Nov 2026)** — Guided conditioning specs flagged `loadKg` (prowler `draft-accel-gym`, sled `draft-sled`) get a kg box on the card before Start (`data-dc-kg`, `_draftKgPending`), prefilled from `records[id+'_kg']`; saved into the score note as `@ X kg` and remembered. Test `SLEDKG`. Also pinned the Nutrition test 'the add sheet names the day' (red every Wednesday) — recorded in OPEN_ITEMS for Nutrition.

> **v4.9.365 (3 Nov 2026)** — Finisher kg is entered ON THE CARD before Start (Jon: "pre fill the kg on the finishers then hit go"): `blab-cpx-kg-<idx>-<mi>` boxes → `window['_blabCpxKg_'+idx]` → `ex2._afapKgPre` → runner `st.afapKg`, displayed as text only (no inputs mid-set). `_blabAfapKg` removed. Test `FINKG: kg is set on the card before Start`.

> **v4.9.364 (3 Nov 2026) — TWO changes in one commit (Jon was mid-session; flagged, not ideal):**
> 1. Finisher movements flagged `kg:true` (renegade rows, ball slams, KB swings) get their OWN kg box in the AFAP runner (`st.afapKg`, `_blabAfapKg`), prefilled from and saved to `records[name+'_wt']`, listed in the completion summary; the card shows "last X kg". Push-ups/dips/ring rows have none. Tests `FINKG:`.
> 2. Superset progress survives leaving the screen: `_blabSSPersist` after every A/B tick → `blockProgress[<today key>]['ss:'+idx]` (name-checked); `_blabSSLoad` on build. Blocks finished before this shipped are rebuilt from today-dated `records[name+'_setlog']`. Tests `SSKEEP:`. Gap remaining: a superset abandoned mid-way does not trigger the "unfinished session" prompt (entries carry no `.done`).

> **v4.9.363 (3 Nov 2026)** — `window._phxRepair1010`: one-off repair of Jon's 1010-rep typo (superset, 3 Nov). Local `records[*_reps]===1010` → 10 and 3 Nov `_setlog` sets; `set_logs` rows reps=1010 logged 3 Nov (Brisbane) → 10, via his own session (RLS). Flag `phx_fix1010_{uid}` set only after the cloud write succeeds. **Archive to blab_archive.js once Jon confirms the Prev line reads 10.** Test `REPAIR1010`.

> **v4.9.362 (3 Nov 2026)** — Global `input,select,textarea{color:var(--text)}`: inputs without an inline colour were rendering black on the dark cards (Jon logged 1010 reps on top of an invisible prefilled 10). Number inputs select their content on focus (document `focusin`), so typing replaces a prefill. Superset A/B reject reps > 99 with a toast.

> **v4.9.361 (3 Nov 2026)** — Med-ball power slots (Chest Pass, Overhead Throw) are LOADED, not bodyweight: Jon, "it used a med ball". `bodyweight:!/Med Ball/i.test(name)` on the Tue/Sat power slot; push-up variants stay bodyweight. Test: `BWSTD: a med-ball throw is loaded`.

> **v4.9.360 (2 Nov 2026) — CHIN-UPS OUT OF FINISHERS "FOR NOW"; UNLOADED BLOCKS SHOW THEIR WORK.**
> Jon: find an alternative to chin-ups in the finishers, scope = finishers only (weighted pull-up and the Sat DB bench / pull-up pair UNCHANGED). Replacement chosen by Jon: DB renegade rows, 10 alternating. Affects "Finisher — Pull / Push / Slam" (training wk 1 and wk 3 Tue). When he says pull-ups are back, revert the two `afap(...)` lines — see the v4.9.360 comment above `function afap`.
> `_blabBuildComplexBlock`: when `_blabHasLoad` is false the card lists rounds / each movement / rest and "Score: total time", no 0 kg target, button "Start →". Reason: in read-only preview the Start button is shielded, so the work was invisible. Applies to BLAB unloaded afap blocks too (Core Circuit, 100 Push-ups, Bodyweight Complex) — none had a meaningful kg target. Tests: `FINISH:`.

> **v4.9.359 (2 Nov 2026) — BODYWEIGHT IS A STANDARD SET TYPE (Jon: "it should be standard through the programme sessions").**
> Lift sessions: `std(..., {bodyweight:true, rest:N})` → translator sets `_bodyweight` + `rest_sec` → the renderer drops the kg column (`_noLoad`) and says "· bodyweight". Used on the Tue/Thu/Sat power slots and the taper Box Jump.
> Supersets: `SS()` flags each movement `bw` by name (`_BW` regex in the Draft module; "weighted" overrides) → translator `_ssBwA/_ssBwB` → `_blabBuildSupersetBlock` shows **BW** in place of the kg box. Reps still logged; loads were already optional.
> Conditioning screen: `bwPart(title, presc, sets, rest)` = part kind `'sets'` — Set 1..n ticks, each tick (except the last) starts `startRestTimer`. Lateral Bound, Seated Box Jump, Wed plyos.
> Tests: `BWSTD:` in tests/training.mjs (superset card test proved red by inverting the BW branch). NB card B only draws after A is ticked — test on card A or you assert on nothing.

**Written:** 4 Sep 2026, end of Training session
**From:** Training chat (worktree `.claude/worktrees/training`)
**Delivery:** the cross-chat channel is GONE from my session — `SendMessage` was removed
mid-session and `ListAgents` returns nothing. **Jon is relaying this file.** I cannot
receive replies. Anything needing my answer has to come back through him.

---

> **PM UPDATE, 2026-09-04 — SECTION 1 IS RESOLVED. READ THIS BEFORE THE REST.**
>
> Every claim Training made below was verified against the repo and was **exactly right**:
> one conflict hunk per file, version lines only, `db94d90` unpushed, the 172-line fix
> intact. The rebase has been finished by the PM using Training's own documented resolution
> (keep `.265`), then rebased again onto current origin, which had moved twice since.
>
> **All four gates green: runtime 6/6 at 100% coverage, harness 748/0, functional 750/750
> across four domains, version check clean.**
>
> **It is committed but NOT YET ON ORIGIN — GitHub was unreachable (DNS) at the moment of
> pushing.** Commit `3ddc2f2`, HEAD of `.claude/worktrees/training`, working tree clean.
> Nothing is lost. To finish:
> `cd ~/Desktop/phoenix-sc/.claude/worktrees/training && git push origin HEAD:main`
> Tracked in `OPEN_ITEMS.md` as the top item.

## 1. STATE RIGHT NOW — READ THIS FIRST

**My worktree is MID-REBASE WITH UNRESOLVED CONFLICTS. Nothing of mine is pushed.**

```
UU harness.mjs
UU index.html
UU sw.js
M  tests/training.mjs
```

- `origin/main` is at **f9a3aa2 / v4.9.264** (your Stats/Profile/My Coach fix).
- I have **one unpushed commit**, `db94d90`, labelled **v4.9.265**.
- All three conflicts are **the version line only** — `APP_VERSION`, `SW_VERSION`, and the
  harness version pin. `.264` on HEAD versus `.265` on mine.
- The resolution is simply **keep `.265` in all three**. Nothing else conflicts.
- The actual work is intact in the working tree (`_setlog` present).

**I stopped mid-resolution when Jon interrupted, and I have not touched it since.** I am
not resolving it now without him saying so, because a rebase resolution is the exact
operation that has destroyed uncommitted work in this repo before.

**If nobody finishes this, v4.9.265 does not exist and Jon's third report of the same
bug is still live on his phone.** That is the single most important line in this document.

---

## 2. THE UNPUSHED FIX — WHAT IT IS AND WHY IT MATTERS

**v4.9.265 — the superset per-set history overwrote itself, and my own .254 "fix" made it
destructive.**

Jon's report, third time for the same symptom, with the sentence that diagnosed it:

> "its still not showing the 2nd set reps achieved on the upper second blocks"
> "when started to fill out again it told me that the completed i had done were now last
> weeks records before finished the full session"

**Root cause.** The superset writer put TODAY's sets into `records[name+'_wt_setN']` /
`'_reps_setN'` — **the same keys the reader uses for LAST WEEK** — with no rotation and no
date. So the moment a block completed, today overwrote last week. Re-entering the session
(he was flicked back to Today mid-set) then showed him **his own partial, labelled as the
previous session.**

**My .254 delete loop made it destructive rather than merely confusing.** It cleared every
set number beyond what had been logged so far — intended to stop a phantom third set
surviving from a longer week. It fires on a PARTIAL session too, so completing a block
with one set logged **DELETED last week's `_reps_set2`** before he had done today's. That
is exactly "the 2nd set never shows", and **I introduced it while fixing the reader.**

**Fix:** the dated-blob pattern that has worked since .179 for max-reps —
`records[name+'_setlog'] = {date, sets:[…]}` plus `_setlog_prev`. The reader picks `_prev`
whenever the stored blob is today's, so the session survives any number of re-entries.
Wholesale replacement removes the need for the delete loop entirely.

**Legacy read kept deliberately** — every superset session Jon has logged before this
version lives in the old per-set-number keys, and dropping that read would blank his
history on the release that claims to fix it.

**Gates at the point I stopped:** runtime 6/6, harness 741/0, functional 742/742 across 4
domains. All green **before** the rebase; they must be re-run after resolving it.

---

## 3. WHY TWO EARLIER ATTEMPTS MISSED IT — the transferable part

The five existing `SETS:` cases **seed records directly and read them back.** They exercise
the READER and nothing else. **No reader-only test can ever see a writer that overwrites
the keys it reads**, or a delete loop that runs between sessions.

Same shape as the `_blabCalEntryView` calendar bug: the helpers were covered, the path was
not. The new `SSHIST:` cases write a week, then write again.

**Two harness pins had to go with the old writer.** They pinned the per-set-NUMBER writes —
so they were **faithfully protecting the bug**. Worth adding to the pin guidance: a pin
written alongside a bug will defend it, and it reads exactly like coverage.

---

## 4. STILL OPEN FROM JON'S SAME REPORT — NOT ADDRESSED

He listed four things. **I fixed one.** These three are untouched and unassigned:

1. **Still being flicked off the training screen to Today mid-session.** He reports it
   again after my .254 resume work, so either the resume is not reaching him or something
   else is navigating away. **This is the one I would take next** — it is the trigger for
   the history bug above and probably for others.
2. **"the pull up max is super unclear still."** I fixed the underlying data bug in .251
   (`chin_test` never reached the renderer, so his max was never being stored). The UI
   itself he still cannot read. Needs a design pass, not a data fix.
3. **"no clear completed for this week … on any of the sections"** — runs and complexes.
   I added a persisted done-state for three block builders in .251; he still cannot tell.
   Either it is not rendering on the blocks he means, or it is not visible enough.

**Caveat on all three: I do not know which build he tested.** He may be on `.254`, he may
not. ~~Auto-update has never been confirmed working end-to-end~~ — **CORRECTED BY PM,
2026-09-04: auto-update WAS confirmed on 22 August.** Jon answered directly that the version
at the bottom of Today moves on its own after a normal open; `v4.9.252` recorded it. The
stale claim came from `CLAUDE.md`, which asserted both that and "one more manual reinstall
is still required" on adjacent lines — Nutrition's handoff took the same wrong half
independently. Source corrected; see `KNOWN_ISSUES.md`.

**This makes these three findings STRONGER, not weaker.** The caveat was doing real damage:
it offered "he may not have the build" as an explanation for three reproducible reports,
which is exactly the kind of out that lets a live bug sit. He is receiving builds.
**Establish his APP_VERSION anyway** — it is one line at the bottom of Today, and "which
build" remains a fair question — but do not treat delivery as the likely explanation.

---

## 5. WHAT I SHIPPED TODAY (all on origin/main)

| Version | What |
|---|---|
| `.214` | Custom session templates were destroyed on every deploy — moved into `blab_state` |
| `.220` | Keyboard-safe sheets — score entry notes box, custom builder |
| `.223` | Wall balls paired, as two linked halves (the library cannot carry two scores) |
| `.238` | Five core write paths made visible — `supabaseLogSet` and friends failed to console only |
| `.241` | The other sixteen write paths, no suppression flags |
| `.251` | Upper 2 — chin max was never being set; nothing remembered what he had done |
| `.254` | Both sets of a max-reps superset, and a way back into an unfinished session |
| *(unpushed)* `.265` | The superset history fix above |

Plus harness/tests-only commits on guard quality — canaries, load-bearing needles,
tick-counting cases. None of those touched `index.html`.

---

## 6. THINGS THE PM SHOULD CARRY FORWARD

- **`phoenix_week_swaps_{weekStart}` is still local-only.** Logged as second tier during
  the egress audit, never bundled. Week-scoped and self-expiring, so a wipe costs the
  current week rather than everything — but it is unmirrored.
- **The Supabase at-rest audit is parked**, on your ruling, on the terms I stated. If Jon
  ever asks where his data sits at rest, that is the work.
- **Training data leaves to the coach worker by four doors**, pinned in the harness under
  `EXITS:`. `latest_checkin` carries **`niggle_notes`** — free-text injury notes — and
  `weight_kg`. Deliberate, documented, not closed.
- **Jon has never confirmed a single Training fix working on his phone.** Every one is
  verified by gates. The last two lines of our own definition of done have never been
  satisfied for a Training ship, and could not have been while `sw.js` was empty.

---

## 7. WHAT I WOULD ASK THE PM TO DO

1. **Decide who finishes the rebase and pushes `.265`**, or tell Jon to have me do it. It
   is three version lines. It should not sit.
2. **Assign the three open Upper 2 items**, after establishing his APP_VERSION.
3. **Note that I cannot be messaged.** If Training work is assigned to this session, it
   has to come through Jon.

— Training

---

## API other domains may call

*(Section added 2026-09-05, v4.9.301. Placed under the same heading Nutrition uses in
HANDOFF_NUTRITION so there is one predictable place to look.)*

**`blabTrainingWeek() -> number | null`**, **`blabTrainingWeekLabel() -> string | null`**,
**`blabTrainingWeekLabelLong() -> string | null`**

| Returns | When |
|---|---|
| BLAB's week, `'TRAIN W3'`, `'Week 3 of 12'` | a BLAB programme is active (paused counts) |
| the AI programme's week, `'TRAIN W6'`, `'Week 6'` | no BLAB, but an `aiProgramme` exists |
| **`null`** | neither programme is set up |

**CALL THIS. Do not read a week counter directly.** There are three in `index.html` and
they answer three different questions — this is what produced Jon's "WEEK 1 vs Week 3":

- **`blabGetState().week`** — BLAB, the programme he is actually running.
- **`athlete.currentWeek`** — the **AI programme's** counter. Bumped *only* by the coach
  weekly-regen flow (`currentWeek: nextWeekN`). **Nothing in BLAB advances it**, so on a
  BLAB account it stays at 1 forever. The Today badge read this. That was the bug.
- **`progWeek()`** — calendar weeks since `athlete.startDate`, clamped 1..15. Elapsed
  time, not programme position. A third answer again.

**MEANINGS:**

- **`null` means OMIT the label, not "Week 0" or "Week 1".** The old badge defaulted to
  1, which told a brand-new account it was in week 1 of nothing.
- **The prefix is load-bearing.** `TRAIN W3` beside Nutrition's `CUT W1`. A bare
  `Week 3` beside a bare `Week 1` is the collision Jon reported.
- **`of 12` is only on the BLAB branch.** The AI programme has no fixed length, so the
  long form omits the denominator there rather than inventing one.
- **Paused is still a position.** `paused` lives inside `active`; a paused programme
  keeps its week.

Behaviour pinned in `tests/training.mjs` under `WEEK:` — 13 cases, four of which drive
`renderTodayScreen()` rather than the helper. Proved by inversion 2026-09-05: restoring
the old expression turns 5 red with `got "TRAIN W1" / want "TRAIN W3"`, while all seven
helper-level cases stay green.

**Not fixed, and not a label swap:** the weekly-review and coach-recommendation screens
still show `athlete.currentWeek`. They are internally consistent (week-1 label over
week-1 content) and the flow increments the same number it displays. See `OPEN_ITEMS.md`
— it needs a ruling on whose week the weekly review is, not a patch.


---

## Road to Draft Day — v4.9.341 (27 Oct 2026)

**What it is.** A second programme on the BLAB rails. `blab_state.programme === 'draft'`
switches `blabGetSessionData` to `draftGetSessionData`; translator, renderers, set logging,
history banners, completion, cloud mirror and calendar are all shared. Code lives between
`DRAFT PROGRAMME — BEGIN` and `— END` in index.html.

**Weeks/days.** Internal week 1 = baseline test (days 5 Sat, 6 Sun only). Weeks 2-6 =
training weeks 1-5; week 6 tapers Mon-Thu and retests Sat/Sun. Days are fixed weekdays:
1 Mon conditioning · 2 Tue upper ME · 3 Wed sprint · 4 Thu lower ME · 5 Sat speed upper ·
6 Sun speed lower. `draftStart` schedules every session on the calendar, plus PHX_LIB
Core (Sat) and WOD (Sun) customs tagged `draft:true`.

**Engine — `draftAfterSession(week, day)`**, called from `blabCompleteSession` after both
saves. Reads only what existing loggers wrote: `records[name+'_wk']` (top set),
`_lastsets`, `_result`, and `records[name+'_rpe']` (new: mirrored from the block-RPE
overlay by `draftRecordRpe`, Draft states only). Tests SET maxes; training top sets can
only RAISE a max, max +5% per update, via variation ratios in `_DRAFT_LIFT_MAP`. Speed-day
loads ±5% from RPE (bounded -10/+5). Conditioning/sprint level 1-5 from RPE. Rep bench
+2.5 kg at 20 reps. Weighted pull-up +2.5 kg when all reps hit. Every change is shown in
a notice and kept in `draft.changes`.

**Contract changes other domains should know.**
- `blabDayLabel(d)` returns Draft names for 1-6 while Draft is active (BLAB branch and its
  1-4 range line untouched).
- `blabTrainingWeekLabel()` returns `TRAIN TEST` in the test week, then `TRAIN W1..W5`.
- `blabProgressScore` uses 6 days/week for a Draft state.
- `blabRestoreFromCloud` — PROGRAMME EPOCH rule before the progress guard: copies with
  different `programme_started` resolve to the newer epoch. Without it the Draft reset to
  week 1 reads as "behind" and is blocked on every other device. Pinned in tests.
- `_blabLogResult` now uses parseFloat (a 40-yd 4.95 was stored as 4); result inputs can
  be decimal (`result_decimal`).

**Switching back.** `draftReturnToBlab()` restores BLAB position, maxes, log, per-week
history maps and calendar; Draft is kept in `draft_parked`.

Tests: `tests/training.mjs`, cases prefixed `DRAFT`. Four were inverted and went red.

**v4.9.342 — calendar fixes for Draft** (found by tests written for Jon's "are they
moveable?"): the BLAB Day2→Day4 48h drop gate blocked legal Draft moves; Mon/Wed counted
as strength so Mon-Thu flagged "consecutive strength"; Draft week 5 showed a deload badge;
queue cards used BLAB day names; a skipped Sunday froze the week label
(`draftCurrentWeek` now takes the later of state and calendar week).

**v4.9.344 — Video timer** (`phxVideoTimerOpen`, between `VIDEO TIMER` markers). A
"Time it from a video" button on every result block whose unit is `sec` (40-yd,
5-10-5, 3-cone, 20 m). On-device only: file input → blob URL → frame stepping; nothing
is uploaded or stored, only the time is logged via `_blabLogResult`. Frame step =
median frame gap from `requestVideoFrameCallback`, snapped to a standard rate (raw
minimum read 1/63 s on a 60 fps clip). Slo-mo factor (1x/4x/8x) is chosen by Jon
because a slo-mo clip shared from Photos may play slowed. Verified in Chromium with
generated 60 and 30 fps clips: 300 and 150 frames both measured 5.00 s. Not yet tried
on iPhone Safari.

**v4.9.345 — test split moved (Jon, 31 Oct: no tape until next week).** Baseline lift
tests stay Sat 31 Oct / Sun 1 Nov (lifts only). Field tests (vertical, broad, 40-yd,
5-10-5, 3-cone) run Sat 7 Nov ahead of speed upper (week 2 day 5, `fieldTests()`).
Training week 1 Mon/Wed are gym versions; Bronco baseline moved to Mon 9 Nov (week 3
day 1). Bodyweight blocks removed from sessions: Jon logs it on the Today check-in.
Field results are now recorded from any session that has them, not only test weeks.

**v4.9.347 — test-day lift order is Jon's ruling (31 Oct): squat → power clean → bench.**
"The squat preps for the cleans which loosens shoulders for the bench." Applies to every
future lift-test Saturday (week 1 and the week 6 retest). Sunday: deadlift → 102.5 kg
reps → pull-ups → strict press. Pinned in tests/training.mjs (SPLIT cases).

**v4.9.348 — "+ Add attempt" (Jon, 31 Oct test day).** Every 1RM test on both test days
(squat, clean, bench Sat; deadlift, press Sun; week 1 and week 6 retest) and the Tue/Thu
max-effort lifts carry `allow_attempts:true`. The button clones the last set row 2.5 kg
heavier; ticking logs via autoLogSet, so the heaviest ticked set is the week's top set and
the engine sets the max from it. Missed attempts are not ticked. Extra rows are counted in
the Complete Session log (`window._phxExtraSets`). Verified in Chromium: 6 → 8 rows,
160 → 162.5 / 165 kg, ticked 162.5 saved to records[name+'_wk'].
**v4.9.349 — "✓ Done" beside "+ Add attempt"** (`_phxFinishAttempts`). Locks the block at
the heaviest TICKED set: buttons replaced by "Done · top lift X kg", unticked rows dimmed;
refuses with a toast if nothing is ticked. Extra rows now insert above `att-wrap-<i>` —
the first build inserted them inside it, so Done deleted them (caught in Chromium).

**v4.9.354 — Mon/Wed Draft sessions run on the WOD timers (Jon, 2 Nov).** The generator
returns `conditioning: [parts]`; timed parts carry a hidden PHX_LIB-shaped spec
(`tier:'DRAFT'`, ids `draft-rhie-gym|field`, `draft-1515-bike|run`, `draft-bronco`,
`draft-row2k`, `draft-accel-field|gym`, `draft-sled`, `draft-shuttle`, `draft-3cone`)
registered into `phxAllWods()` via `window._draftLibList`. `blabOpenSession` routes a
session with `conditioning` to `draftOpenConditioning` (parts list, Start timer →
`_phxStartSession`, status from today's library scores, one overall rating mirrored to
the engine, then `blabCompleteSession`). Intervals runner gained `config.countLabel`.
Fixed: week-1 gym 15/15 read ivSets/ivMins before assignment ("undefined").
Also pinned `NOTSTARTED applying a phase…` (tests/peptides.mjs) to 15 Oct 2026: it
decayed on 2 Nov when Phase 2's last start date passed — red on an unchanged build.

**v4.9.355 — retest over two weekends, Jon's lift orders (2 Nov).** Sat wk5 (28 Nov):
Retest A = squat → power clean → bench. Sat wk6 (5 Dec): field combine only. Sun wk6
(6 Dec): Retest B = deadlift → HEAVY strict press → 102.5 kg reps → pull-ups ("load
better than volume"). Week-1 Sunday uses the same B order. `liftsA()` / `liftsB()` in
the generator; pinned in tests (SPLIT). Future blocks' tests should follow the same
two-weekend shape.

**v4.9.356 — hands-free guided timer (`draftRunGuided`, Jon 2 Nov: "timers go up not
count down ... hard to work the phone clock and the machine clock").** Specs carry
`guided:{rounds, steps:[{label,secs,sub}], restSec, entry:{per:'round'|'end'}}`; every
phase counts DOWN from absolute end timestamps (lock-safe), beeps 3-2-1 and on change
(WebAudio, unlocked by the Start tap), and advances itself. Bike counts calories only:
per-bout calories typed during rest (optional), 15/15 total typed once at the end. Field
parts run on fixed windows so the phone can sit on the ground. Score saved via
`_phxSaveScore`. Bronco and 2 km row stay on the for-time stopwatch. Verified in Chromium
with `page.clock`: 8 → burpee 5 → 8 → rest 1:44 → per-round entry summed into the end
total → saved score shown on the session screen.

**v4.9.357 — Jon's guided-timer rule (2 Nov): a movement measured by reps or distance
(burpee, prowler push) is a TAP step — no clock shown, never auto-advances — followed by
a 3 s "Get set" count-in when a timed step comes next. Use this for every similar build.**
15/15 runs as ONE part: `guided.blocks` + `blockRest` (3 min easy spin counts down inside
the sequence); bike calories entered per block during the spin (`entry.per:'block'`).
Verified in Chromium: burpee held 20 s without advancing → Done → Get set 3 → sprint 8;
end of block 1 → "Easy spin 3 min" 2:58 with the block entry.
