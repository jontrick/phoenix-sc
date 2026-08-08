# PHOENIX CTO HANDOFF — CHAT 5
**Date:** 8 August 2026
**Handing off from:** CTO Chat 4
**Current live version:** v4.9.118
**Repo:** jontrick/phoenix-sc
**Live URL:** projectphoenix-app.com
**Jon UUID:** df7fc046-0dd6-4416-b0ce-44b55fa2fb8e
**Supabase project:** mxtowhccuqarszcwpbkq (Sydney ap-southeast-2)
**Working directory:** ~/Desktop/phoenix-sc

---

## CRITICAL RULES — READ FIRST

1. **Finder → New Terminal at Folder** to open terminal in ~/Desktop/phoenix-sc — Desktop TCC permissions block standard terminal access. Then run `claude` to open Claude Code.
2. **Full runtime check before EVERY push** — extract main script block, stub browser globals, run `node /tmp/full.js`. `node --check` misses runtime errors.
3. **BLAB state in `localStorage('blab_v1_{userId}')`** — also mirrors to Supabase `profiles.blab_state` (jsonb). Never store inside `athlete.aiProgramme`.
4. **SW cache aggressive on iOS** — always bump APP_VERSION on every push. Delete PWA + hard refresh Safari to test.
5. **DOM methods for overlays** — no string concatenation with nested quotes. Black screen guaranteed.
6. **Archive dead code to `blab_archive.js`** — never leave stray code in index.html. Keeps the file clean and avoids interference.
7. **Push after every confirmed-clean build** — no exceptions. Chat 3 work was lost for never being committed.

---

## WHAT WAS BUILT IN CHAT 4

### BLAB Programme — Full Rebuild (v4.9.108+)

**Architecture:**
- Dead overlay renderer system removed (blabBuildExCard, blabLaunchExercise, blabRenderPct/Super/MaxReps/Std)
- Single live path: blabToPhoenixSession → openTodaySession → block builders
- blabRunWorkout / _blabWoState / blab-workout-overlay KEPT — live timer engine for complex/run/total_rep blocks
- All dead code to be moved to `blab_archive.js` (not yet done — Priority 0)

**Programme Structure (4-day):**
- Day 1: Upper Strength (Bench) — per DeFranco PDF exactly
- Day 2: Lower Strength — Block 1 (W1-4) Free Back Squat, Block 2 (W6-9) Conventional Deadlift, Block 3 (W11-12) Athlete Choice
- Day 3: Upper Strength (Chins) — per DeFranco PDF exactly
- Day 4: Power + Conditioning — see full spec below (NOT a percentage lift day)

**Complex Sets:**
```
W1:2, W2:2, W3:2, W4:4, W5:1(bar only), W6:3, W7:3, W8:3, W9:3(desc), W10:1(bar only), W11:4(desc), W12:5(desc)
```

**Complex Rep Schemes (W6-8 ascending per set):**
- W6: 3 sets — 7/8/9 reps
- W7: 3 sets — 8/9/10 reps
- W8: 3 sets — 8/9/10 reps

**Data fixes applied in Chat 4:**
- Deload chin bug fixed (W5/W10 = 0.5× max, not 1.5×)
- Interval format split: steady_state / tabata / 1.6km — never overwrite each other
- 100 push-ups timed via afap renderer, saves to `records['100_pushups_time']`
- Main lift AMRAP top set saved to `records['bench_amrap_w'+week]` etc
- W12 bench test = max_reps_sets with 84kg/102kg load chips
- W12 chin = fresh max retest
- Standard sets with "record" note get Save-result field

**Previous best surfacing (all exercise formats):**
- percentage_sets: "Last week: X reps @ Ykg" on AMRAP set
- max_reps_sets: "Beat last week: X reps @ Ykg. Same weight."
- superset: "Last week: Xkg × Y reps" under each movement (all sets, not just first)
- afap/complex: "PREVIOUS BEST: M:SS" gold banner throughout runner
- interval/run: "Previous best: M:SS — beat it."
- 100 push-ups: time banner

**Supabase cloud sync:**
- `blabSaveState` mirrors to `profiles.blab_state` (debounced 1.5s + pagehide keepalive flush)
- `blabRestoreFromCloud` on load — progress-aware tiebreak (cloud wins if last_completed_day is greater)
- BLAB routing: if `blabIsActive()` after restore → route to Today regardless of fq_completed

**Session completion:**
- Native `confirm()` replaced with DOM modal (iOS PWA suppresses native dialogs)
- `_blabSessionCompleteCallback` → `blabCompleteSession` → state advances → Today re-renders to next session

**Rest timers:**
- All formats use full-screen `startRestTimer` gold overlay (z-index 9700)
- `startRestTimer` has optional `onDone` callback for afap runner
- `#phx-complete-confirm` modal at z-index 9800

**Timer reliability (v4.9.118):**
- All timed sessions store `window._phxTimerStart = Date.now()` when clock hits 0:00
- `visibilitychange` → visible recalculates elapsed from timestamp (screen lock safe)
- Wake lock re-requested on every visible transition, held through rest periods
- 5-second countdown (5,4,3,2,1,GO!) before ALL timed sessions — does NOT count toward score

**RPE tracking:**
- `_blabBlockComplete(idx, ex, setRows)` fires after every block (all formats)
- Logs set rows to `set_logs` table, then fires `showExerciseBlockRPE`

### WOD + Core Library (v4.9.112+)

**Architecture:**
- Entire old WOD generation system removed and replaced
- Static library: `PHX_LIB` — WODs + Core sessions
- All scores saved to Supabase `wod_scores` table + localStorage mirror
- RECORDS tab replaces STATS in bottom nav

**Scoring renderers (all working):**
1. AFAP / FOR TIME — count-up timer, movement tap-through, total time
2. AMRAP — countdown, round counter, partial rep counter
3. FOR LOAD — set rows with weight input + per-set tick, 3-min rest overlay
4. EMOM — per-minute countdown, completion tracking
5. SPRINT INTERVALS — per-phase timestamps, split time per interval
6. CORE — set-by-set rows with load + reps input, 90s rest overlay, prev best banner
7. CHIPPER — ordered movement list, tap per movement done, count-up timer
8. FREE ORDER CHIPPER — same as chipper but exercises can be done in any order (Leviathan)
9. LENGTH TRACKER — tap per length/rep with running timer and position display (Atlas)

**Supabase table — wod_scores:**
```sql
CREATE TABLE IF NOT EXISTS wod_scores (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  wod_id text NOT NULL,
  score text NOT NULL,
  score_type text NOT NULL,
  date timestamptz DEFAULT now(),
  notes text,
  is_pb boolean DEFAULT false
);
-- RLS enabled, own-row policies, indexes on user_id and wod_id
-- ⚠️ Run this SQL in Supabase dashboard if not already applied
```

---

## CURRENT STATE AT HANDOFF (v4.9.118)

### What's working
- BLAB programme loads correctly, all 4 session types render
- Previous best shows for all exercise types
- Session completion advances to next day
- Supabase cloud sync restores state after PWA reinstall
- WOD library accessible, scored, recorded
- Core library — set-by-set logging
- RECORDS tab shows WOD and Core PBs with history
- Rest timers — full-screen gold overlay for all formats
- Timer reliability — screen lock safe, accurate elapsed
- 5-second countdown before all timed sessions

### Jon's current BLAB state
- Week 2, Day 1-2 completed
- Maxes: Bench 130kg, Squat 150kg, Deadlift 170kg, Chin-up: establishing W1D3
- Session records in Supabase blab_state (manually entered after Chat 4 sessions)

---

## 6-DAY TRAINING STRUCTURE

Jon trains Tuesday/Thursday/Saturday/Sunday mornings at 4:30am. Other days available for evening sessions. Programme is session-based not day-locked — BLAB advances on completion, not calendar.

```
SESSION 1 — BLAB Day 1: Upper Strength (Bench)
SESSION 2 — BLAB Day 2: Lower Strength (Squat/Deadlift by block)
SESSION 3 — BLAB Day 3: Upper Strength (Chins)
SESSION 4 — Lower Power (morning) + Rotational Core (afternoon double)
SESSION 5 — Conditioning WOD (smart recommendation)
SESSION 6 — Aerobic Session (Sunday preferred, 25-45 mins)
+ Core Strength/Power: evening sessions or Saturday afternoon doubles
```

**48-hour rule:** Day 4 (posterior chain) must not follow Day 2 (lower) back-to-back. App flags this.

---

## BUILD PRIORITIES — ORDERED

### Priority 0 — Code Cleanup (do first, before anything else)
- Move all dead/unused code to `blab_archive.js` in repo root
- Remove `?debug=1` panel code from index.html (v4.9.101-debug remnant)
- Verify index.html loads clean after removal
- Commit as v4.9.119

### Priority 1 — Hamburger Menu Restructure

Remove all current hamburger items. Replace with exactly:

```
Built Like A Badass
  ├── View Programme
  │     Full 12-week view. Completed sessions highlighted.
  │     Shows where Jon is in the block. Tappable sessions link to session detail.
  ├── Audit Programme
  │     Existing audit view (tap session → see all exercises). Keep as-is.
  └── Adjust Programme
        Not built yet. Placeholder for now. Will handle week/block adjustments.

Themes
  Keep existing theme/skin switcher exactly as-is.

Records
  ├── Heaviest Lift (all-time PB per exercise, read from set_logs)
  ├── Total Volume (kg × reps per session, and per lift type across all sessions)
  ├── BLAB Benchmarks (complex time, run time, 100 push-up time — per week)
  └── WOD / Core PBs (link to existing RECORDS tab view)

Weight Check
  Keep existing weight check-in. Will connect to nutrition daily check-in in Phase 2.

Nutrition
  ├── View Week (weekly meal plan — Phase 2)
  ├── Add Recipe (Phase 2)
  ├── Add Food (Phase 2)
  ├── Create Week (Phase 2)
  └── Shop — Create / View (Phase 2)
  Show all as "Coming soon" placeholders for now.

Standalone Timer (new)
  See spec below.
```

**Remove entirely:** All old Phoenix programme items, questionnaire links, Agoge, Leaderboard, Combine, alpha system, invite codes, stats screen, old WOD generator links.

Bump to v4.9.120, harness check, push.

### Priority 2 — Today Screen Restructure

New Today screen layout (top to bottom):

```
[Morning Check-in tile — weight + feeling score, full width]
[NEXT SESSION — main tile, full width, prominent gold border]
[This week's remaining sessions — smaller tiles, horizontal scroll or stack, can reorder by drag]
[Daily Nutrition tile — shows cal remaining + P/C/F progress bars, taps to full day view — Phase 2 placeholder for now]
[+ Add Session tile — smart recommendation engine]
[Walk / Run tile]
[Version number — bottom, subtle]
```

**Next session tile logic:**
- Reads BLAB state → shows next BLAB day with session name, week/day label, START button
- If all 4 BLAB done this week → shows WOD recommendation tile instead
- Completed sessions show ✓ COMPLETED badge but do NOT show for next day (bug fixed in v4.9.98 — confirm still working)

Bump to v4.9.121, harness check, push.

### Priority 3 — BLAB Day 4 Full Rebuild (12-week progression)

Current Day 4 is a placeholder. Build full 12-week spec with 4-week block variations.

**Main lift rotation:**

| Week | Main Lift | Sets × Reps | Notes |
|------|-----------|-------------|-------|
| W1 | Banded Deadlift | 4×3 @ 60% | Speed-strength base |
| W2 | Rack Pull | 4×4 @ 70% | Posterior chain overload |
| W3 | Banded Deadlift | 5×3 @ 65% | Load increase |
| W4 | Hang Clean | 4×3 @ 65% | Power expression pre-deload |
| W5 | Push Press | 3×5 @ 50% | Deload — upper power |
| W6 | Banded Deadlift | 4×3 @ 65% | Block 2 — pairs with DL main lift |
| W7 | Rack Pull | 4×4 @ 75% | Heavy overload week |
| W8 | Hang Clean | 4×3 @ 70% | Mid-block power |
| W9 | Push Press | 4×4 @ 65% | Pre-deload power expression |
| W10 | Banded Deadlift | 3×3 @ 50% | Deload — bar speed |
| W11 | Rack Pull | 5×3 @ 80% | Peak posterior |
| W12 | Hang Clean | 5×3 @ 75% | Test week power |

**Accessories — rotating per block:**

Block 1 (W1-4):
- Box Jumps 4×5 (record height in inches)
- Nordic Planks 3×5 (eccentric only)
- Banded KB Swing 4×10
- Prowler Push 4×20m

Block 2 (W6-9):
- Depth Drops into Box Jump 4×5
- Nordic Planks 4×6
- Banded KB Romanian Deadlift 4×10
- Prowler Pull 4×20m

Block 3 (W11-12):
- Max Height Box Jump 5×3
- Nordic Planks 4×8
- Banded KB Good Morning 4×12
- Prowler Push + Pull superset 3×20m each

Deload (W5, W10):
- Box Jumps 2×5 (submaximal)
- Banded KB Swing 2×10 (light)
- No prowler, no nordics

**All sets/reps/load logged per set. History and PB tracked. Previous best shown during session.**

Bump to v4.9.122, harness check, push.

### Priority 4 — Core Library Full Rebuild

Replace current core library with Jon's specified sessions. All sessions: set-by-set logging, load + reps per set, full-screen rest overlay between sets, previous best banner, history tracked in wod_scores.

#### ROTATIONAL FOCUS — 3 sessions

**Session R1 — Rotational Power:**
1. Pallof Press — 3×12 each side
2. Landmine 180 — 4×8 each side
3. Landmine Rotational Press — 3×10 each side
4. Rotational Deadlift — 3×10 each side
5. Side Scoop Throw (med ball) — 4×8 each side
6. Rotational Med Ball Wall Throw — 4×6 each side *(added for balance)*

**Session R2 — Cable Rotation:**
1. Cable Crunches — 4×15
2. Banded High-Low Cable Wood Chop — 3×12 each side
3. Banded Low-High Cable Wood Chop — 3×12 each side
4. Rotational Med Ball Slam — 4×8 each side
5. Seated Cable Rotation — 3×15 each side *(added for controlled finish)*

**Session R3 — Loaded Rotation (progression from R1/R2):**
Higher load, lower reps — power-strength focus:
1. Half-Kneeling Landmine Press — 4×6 each side
2. Single-Arm Cable Chop (heavy) — 4×6 each side
3. Landmine Rainbow — 3×8 each side
4. Med Ball Rotational Slam (heavy ball) — 4×6 each side
5. Copenhagen Side Plank with Rotation — 3×8 each side

Rotate R1 → R2 → R3 across the 4-week block. Load/completion tracked and visible across sessions.

#### CORE STRENGTH/POWER — 3 sessions

No Nordic Planks in these (those are Lower Power only).

**Session S1 — Med Ball Power:**
1. Rotational Med Ball Slam — 4×8
2. Ab Wheel Rollout — 4×8
3. Hanging Knee Raise — 3×12
4. Med Ball Sit-Up Throw — 3×15
5. Dead Bug — 3×10 each side

**Session S2 — Plank Series:**
1. Weighted Plank — 4×45s
2. Plank DB Pull-Through — 3×12 each side
3. Plank Row — 3×10 each side
4. Hollow Body Hold — 3×30s
5. Ab Wheel Rollout — 3×8

**Session S3 — Loaded Flexion:**
1. Cable Crunch — 4×15
2. Hanging Leg Raise — 4×10
3. Decline Weighted Sit-Up — 4×12
4. Med Ball Slam — 3×10
5. Ab Wheel Rollout (slow eccentric 3s) — 3×6

Rotate S1 → S2 → S3 across the block.

**Slot assignment:**
- Rotational Focus (R1/R2/R3): pairs with Session 4 Lower Power (afternoon double)
- Core Strength/Power (S1/S2/S3): evening sessions or Saturday double

Bump to v4.9.123, harness check, push.

### Priority 5 — WOD Library Full Rebuild

Replace entire current WOD library with Jon's specified sessions only. No other WODs kept. Remove all WODs not listed below.

#### AEROBIC SESSIONS (new tier — "AEROBIC")

Rotate as Session 6 (Sunday aerobic). Tracked for time PB.

1. **The Row** — 5km Row AFAP. Score: total time.
2. **Run/Row** — 2km Run + 2km Row AFAP. Score: total time.
3. **The Grind** — 1km Row, 800m Run, 1km Row, 800m Run AFAP. Score: total time.
4. **The Long Run** — 5km Run AFAP. Score: total time.
5. **Bike/Row** — 4km Assault Bike + 2km Row + 4km Assault Bike AFAP. Score: total time.
   *(4km assault bike ≈ 8-12 mins depending on effort)*

Renderer: count-up timer, movement blocks in order, tap each when complete, total time logged.

#### CONDITIONING WODs

**Kronos — FOR TIME CHIPPER**
Row 2000m → Wall Ball 50 reps (9kg) → Sandbag Over Shoulder 30 reps (25kg) → Thruster 20 reps (60kg) → Pull-Up 20 reps → Run 1.6km
Score: total time. Renderer: standard chipper — ordered, tap each movement done.

**Atlas — LENGTH TRACKER CHIPPER**
Each movement tracked as individual 25m lengths, tapped as completed. Timer running throughout. Display shows current exercise + "Length X of Y".
- Farmers Walk: 16 lengths × 25m = 400m total (32kg each hand)
- Sandbag Carry: 8 lengths × 25m = 200m total (30kg)
- Overhead KB Carry: 4 lengths × 25m = 100m total (24kg each)
Score: total time.

**Tartarus — SPRINT INTERVALS**
6 × 500m Row. Rest 3 min between efforts.
Score: average 500m split (seconds). Log split time per interval.

**Leviathan — FREE ORDER CHIPPER**
100 Air Squats + 100 Push-Ups + 100 Pull-Ups + 100 Burpees.
User chooses order — tap any exercise to work on it, tap + to add reps, tap next exercise whenever. Timer running throughout. Progress bars per exercise.
Score: total time.

**Ragnarok — FOR TIME CHIPPER** *(modified)*
Row 1000m → Push Press 30 reps (40kg) → Tricep Dips 20 reps → Sandbag Carry 200m (30kg) → Box Jump 30 reps (24") → Run 800m → Hang Clean 20 reps (40kg) → Chest to Floor Burpees 20 reps
Score: total time.

**Ragnar — AMRAP 25** *(box jumps in inches)*
5 Power Cleans (70kg), 10 Pull-Ups, 15 Box Jumps (24"), 200m Run
Score: rounds.reps

**Valkyrie — 4 ROUNDS AFAP** *(lengths not distance)*
Farmers Carry 8 lengths × 25m (24kg each), 8 × 25m Sprint lengths, 10 Burpees
Score: total time. Each length tapped individually.

**Ajax — AMRAP 20** *(box jumps in inches)*
10 DB Thrusters (22.5kg), 15 Box Jumps (24"), 20 Push-Ups
Score: rounds.reps

**Hermes — FOR TIME**
100 Wall Balls (9kg) for time.
Score: total time.

**Centurion — FOR TIME**
100 Burpees for time.
Score: total time.

**Viking — 5 ROUNDS AFAP**
10 DB Snatches each arm (22.5kg), 20 Wall Balls (9kg), 30 Air Squats
Score: total time.

**Legionnaire — SPRINT INTERVALS** *(two versions)*

Legionnaire RUN:
10 × 100m Sprint. Rest 60s between efforts. Log split time per effort.
Score: average split (seconds).

Legionnaire ROW:
10 × 100m Row. Rest 60s between efforts. Log split time per effort.
Score: average split (seconds).

Both versions tracked separately in history.

**Hammerfall — FOR TIME** *(KB, box jumps in inches)*
21-15-9: KB Snatch each arm (24kg), Burpee Box Jump (24")
Score: total time.

#### WOD RECOMMENDATION ENGINE

When "+ Add Session" is tapped and WOD is selected, app reads:
- Current BLAB week and block phase
- Last WOD type completed (and when)
- Next BLAB session scheduled
- Daily check-in feeling score
- Day of week

Returns: "Recommended: [WOD name] — [reason]" with one-tap start.

Logic:
- Heavy BLAB lower day yesterday → recommend aerobic (The Row / Long Run)
- Rest day → recommend conditioning WOD (Tartarus / Legionnaire)
- Mid-block accumulation → prefer aerobic + mixed modal
- Block peak (W9/W11) → prefer benchmark WODs (Kronos / Ragnarok)
- Low feeling score → recommend shorter WOD (Hermes / Centurion)
- High feeling score → recommend longer benchmark

Bump to v4.9.124, full harness check (all sessions generate without errors), push.

### Priority 6 — Standalone Timer

Accessible from hamburger menu. Full-screen utility — no session logging.

**Three modes:**

**Stopwatch:**
- Count up from 0:00
- Start / Pause / Reset
- Lap button — records split times, shows lap list below timer
- Large gold time display

**Countdown:**
- User sets time (MM:SS picker)
- Countdown to 0:00
- Audible + vibration alarm at completion
- +1min / +30s buttons during countdown
- Start / Pause / Reset

**Tabata:**
- Default: 20s work / 10s rest / 8 rounds (all configurable)
- Shows: current phase (WORK/REST) in large text, round number, time remaining
- Audio cue on phase change
- Configurable: work duration, rest duration, rounds
- Auto-cycles through all rounds, shows completion screen with total time

No data saved. Pure utility.

Bump to v4.9.125, harness check, push.

### Priority 7 — Custom Session Builder

User builds their own session from scratch. Tracked exactly like built-in sessions.

**Flow:**
1. Tap "+ Add Session" → "Build Your Own"
2. Session name (optional — defaults to date)
3. Add exercises one at a time:
   - Search exercise library (all BLAB + WOD movements searchable)
   - Or free-text any exercise name
   - Set: sets, reps/duration, load (kg), rest (seconds)
4. Optional: tap "Recommend exercises" → AI suggests based on:
   - What's been done this week (avoid overlapping muscle groups)
   - Next BLAB session coming up (don't fatigue muscles needed tomorrow)
   - Goal (fat loss / hypertrophy / strength)
   - Available time
5. Reorder exercises by drag
6. Save session (optionally name and save as template for reuse)
7. Start session → same set-by-set renderer as BLAB/Core sessions

**Logging:**
- Each set logged: load (kg) + reps achieved + tick
- Full-screen rest overlay between sets
- Previous best shown per exercise (reads from set_logs)
- On completion: saves to wod_scores (type: 'custom') + set_logs
- Feeds into weekly analysis, Records view, and smart Add Session recommendation

**Templates:**
- Named custom sessions saved and reusable
- Shown in Add Session flow under "My Sessions"
- Can be edited or duplicated

Bump to v4.9.126, harness check, push.

### Priority 8 — Smart Add Session Recommendation Engine

When "+ Add Session" is tapped, app intelligently recommends what to do next.

**Reads:**
- BLAB state: current week, block phase, sessions done this week
- Last session of each type (BLAB day, WOD, Core, Aerobic, Custom) and when
- Next BLAB session scheduled (what muscle groups are coming up)
- Daily check-in: weight trend, feeling score
- Time of day (morning → BLAB priority, evening → WOD/Core/Aerobic)
- Day of week (Sunday → aerobic preference)

**Output:**
Primary recommendation card: session name, type, estimated duration, reason in one line.
"Choose something else" reveals full session type picker (BLAB / WOD / Core / Aerobic / Custom).

**Recommendation logic:**
- Morning + BLAB day due → BLAB (primary)
- Evening + BLAB done today → Core or short WOD
- 2+ days since last WOD → WOD recommendation
- Core not done this week → flag it
- Sunday + all BLAB done → Aerobic
- Deload week → lower intensity recommendations
- Low feeling score (≤4) → recommend rest or gentle aerobic only
- High feeling score (8+) → can suggest benchmark WOD

### Priority 9 — Holiday Reset Mechanism

Before Jon's next holiday (or any extended break):

**"Pause Programme" option** (in hamburger → Built Like A Badass → Adjust Programme):
- Saves current week/day state with timestamp
- Shows "Programme paused" on Today screen with resume option

**On return — two options presented:**
1. "Resume where I left off" → continues from saved week/day
2. "Reset to Week 1 with updated maxes" → enter new 1RMs, recalculates all future sessions

Reset flow: enter new Bench / Squat / Deadlift 1RM + Chin-up max → confirms → resets week to 1, day to 1, clears log, keeps records for reference. Saves new maxes to blab_state.

### Priority 10 — Records Tab Enhancement

Current RECORDS tab shows WOD/Core PBs. Expand to include:

**Heaviest Lift (all time):**
- Per exercise: highest kg logged in set_logs
- Shows: exercise name, weight, date, which session it was from

**Volume Tracking:**
- Total volume per session (sum of kg × reps for all sets)
- Volume per lift type (bench / squat / deadlift / accessory) across all sessions
- Trend over time (simple week-by-week chart)

**BLAB Benchmarks:**
- Barbell Complex PB time (per week — shows progression across 12 weeks)
- 1.6km Run PB
- 100 Push-up time PB
- Chin-up max (established W1D3, updated W12D3)

**WOD / Core:** existing view, keep as-is.

### Priority 11 — Outstanding Bug Fixes

Apply these alongside other priorities, not as a separate sprint:

**Superset previous session data (all sets):**
Currently only shows first set's weight. Need all sets logged and displayed. Athlete needs to see progression per set to calibrate load increase when reps drop.
Fix: `_blabSSdoneB` should save per-set load to `records[movementName+'_wt_set'+setNum]`. Renderer reads all set records and displays them.

**Push-up counter in timed sessions:**
Count tracker broken in chipper and other timed sessions. Audit all modes with rep counters — chipper, Leviathan, Centurion, Hermes. Ensure tap-to-count works reliably on iOS.

**Screen always on:**
Wake lock working for timed sessions but general app browsing still times out. Add persistent wake lock while app is open (request on load, re-request on visibilitychange).

**Superset reps — Week 2 onwards:**
Confirm all superset rep schemes match the PDF after v4.9.107 audit. Spot-check Week 2 (should be 4×12, not 4×15).

---

## NUTRITION ENGINE — PREPA INTEGRATION

Prepa (prepa.com.au spec) is being built INTO Phoenix as the nutrition engine — not a separate app. All nutrition features live inside the Phoenix PWA, sharing the same Supabase project.

Source documents: Prepa_Handoff_Document.docx + prepa-build-handoff.md (in Chat 4/5 files).

**Build nutrition AFTER Priorities 1-11 are complete.** Today screen nutrition tile is a placeholder until then.

### Architecture
- Phoenix stays as single HTML file PWA
- Prepa component model + AUSNUT engine built into index.html
- New Supabase tables added to existing mxtowhccuqarszcwpbkq project
- Today screen nutrition tile connects to nutrition data
- Training-aware: nutrition adjusts based on BLAB session type and daily check-in

### Nutrition Phase 1 — Build This

#### Macro Targets — AI Adaptive

User sets goal: Fat Loss / Hypertrophy / Strength / Maintenance

Base targets calculated from profile (weight, height, age, activity) using Mifflin-St Jeor + activity multiplier:
- Fat Loss: -20% calories, protein 2.2g/kg
- Hypertrophy: +10% calories, protein 2.0g/kg, carbs dominant
- Strength: maintenance calories, protein 1.8g/kg
- Maintenance: TDEE, protein 1.6g/kg

**App adjusts DAILY targets based on:**
- BLAB session type today: heavy lower (squat/deadlift) = +carbs. Upper day = moderate. Rest day = -carbs, slight calorie reduction.
- Daily weight check-in trend: above/below goal → adjust weekly target ±5-10%
- Daily feeling score (1-10): ≤4 = increase carbs for recovery. 8+ = hold targets.
- Block phase: accumulation = higher volume macros. Deload = reduced. Peak = maintain.
- User can always override any recommendation.

#### Daily Tracking — Frictionless

**Today screen nutrition tile shows:**
- Calories remaining (large number, prominent)
- Protein / Carbs / Fat progress bars
- Tap → full day view

**Full day view:**
- Meal slots: Breakfast / Lunch / Dinner / Snacks
- Each slot shows planned meal name + macros
- Tick = confirm eaten (no logging friction — one tap)
- Tap meal to: adjust quantities, swap a component, add notes
- "+ Add food" for anything outside the plan
- Daily macro summary updates live as meals ticked

**Daily check-in (morning — integrates with existing weight tile):**
- Weight (kg)
- Feeling score (1-10 energy/fatigue)
- App reads both + today's BLAB session → adjusts today's macro recommendation

#### Component-Based Meal Builder (Prepa core model)

Meals are combinations of interchangeable components — not fixed recipes.

| Category | Examples |
|----------|---------|
| Protein | Chicken breast, beef strips, salmon, eggs, tofu, king prawns |
| Carb base | Basmati rice, pasta, sweet potato, quinoa, udon noodles |
| Vegetables | Broccolini, bok choy, capsicum, baby spinach, edamame (up to 3) |
| Sauce | Teriyaki, soy & sesame, miso glaze, tomato-based, olive oil + lemon |
| Extras | Sesame seeds, avocado, cheese, nuts, soft-boiled egg |

**Builder interaction:**
- Select meal template → default components pre-loaded
- Swap any component within category → macros update live
- Gram sliders adjust quantity
- Serves multiplier scales for meal prep batches
- Preset modes: Standard / High Protein / Low Carb / Bulk
- Nutrition panel: kJ, kcal, protein, carbs, fat, fibre, sodium — all live

#### Weekly Meal Planner

- 3 meals/day × 7 days = 21 meal slots
- Training-aware: BLAB day slots = higher carb/calorie. Rest days = lighter.
- Weekly plan hits weekly macro target ±5% (not each individual day — realistic)
- Regenerate: individual meal / full day / full week
- Feeds into daily Today view for the week

#### AUSNUT Nutrition Engine

Data source: AUSNUT 2011-13 (FSANZ — 8,661 Australian foods, free commercial use)
Load into Supabase as reference tables — this is the data moat.

Attribution required: "Nutrition data sourced from FSANZ AUSNUT 2011-13" in About screen.
Medical disclaimer required: "Not medical advice. Consult a doctor for specific dietary needs."

Phase 1 component library: 40 components (8 per category × 5 categories) — Jon to provide curated list with AUSNUT IDs.

### Supabase Tables — Nutrition (run in dashboard)

```sql
-- Nutrition targets
CREATE TABLE nutrition_targets (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  goal text NOT NULL,
  calories int NOT NULL,
  protein_g int NOT NULL,
  carbs_g int NOT NULL,
  fat_g int NOT NULL,
  effective_date date DEFAULT CURRENT_DATE,
  created_at timestamptz DEFAULT now()
);

-- Food components (AUSNUT-backed)
CREATE TABLE foods (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  ausnut_id text,
  name text NOT NULL,
  category text NOT NULL,
  calories_per_100g numeric,
  protein_per_100g numeric,
  carbs_per_100g numeric,
  fat_per_100g numeric,
  fibre_per_100g numeric,
  sodium_per_100g numeric,
  cooking_yield_factor numeric DEFAULT 1.0,
  dietary_flags text[],
  image_url text
);

-- Weekly meal plans
CREATE TABLE meal_plans (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  week_starting_date date NOT NULL,
  status text DEFAULT 'active',
  created_at timestamptz DEFAULT now()
);

-- Meals within a plan
CREATE TABLE meals (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  meal_plan_id uuid REFERENCES meal_plans(id) ON DELETE CASCADE,
  day int NOT NULL,
  slot text NOT NULL,
  notes text,
  confirmed boolean DEFAULT false
);

-- Components within a meal
CREATE TABLE meal_components (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  meal_id uuid REFERENCES meals(id) ON DELETE CASCADE,
  food_id uuid REFERENCES foods(id),
  quantity_g numeric NOT NULL
);

-- Daily check-ins (extends existing weight check-in)
CREATE TABLE daily_checkins (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  date date DEFAULT CURRENT_DATE,
  weight_kg numeric,
  feeling_score int,
  notes text,
  created_at timestamptz DEFAULT now()
);

-- Products table (future state — create now, use later)
CREATE TABLE products (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  food_id uuid REFERENCES foods(id),
  retailer text,
  sku text,
  name text,
  price_aud numeric,
  size_g numeric,
  last_updated timestamptz,
  price_source text DEFAULT 'manual'
);

-- Enable RLS
ALTER TABLE nutrition_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE foods ENABLE ROW LEVEL SECURITY;
ALTER TABLE meal_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE meals ENABLE ROW LEVEL SECURITY;
ALTER TABLE meal_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "own data" ON nutrition_targets FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "own data" ON meal_plans FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "own data" ON meals FOR ALL USING (
  meal_plan_id IN (SELECT id FROM meal_plans WHERE user_id = auth.uid()));
CREATE POLICY "own data" ON meal_components FOR ALL USING (
  meal_id IN (SELECT id FROM meals WHERE meal_plan_id IN (
    SELECT id FROM meal_plans WHERE user_id = auth.uid())));
CREATE POLICY "own data" ON daily_checkins FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "foods readable by all" ON foods FOR SELECT USING (true);
```

### Nutrition Future State — Noted, Do Not Build Yet

Captured so data model supports them from day one:
- Coles/Woolworths price comparison (static seed prices first, live scraping Phase 3)
- Shopping list generation
- Pantry tracker + barcode scanner (EAN → Open Food Facts AU)
- Direct-to-cart ordering (Coles/Woolworths OAuth)
- Voice parser — Jarvis (Claude API: natural language → component JSON)
- AI leftover recipe generator (Claude API from pantry contents)
- Community hub (recipe sharing, ratings, weekly challenges)
- Cook-chill tracker (Blue Book food safety, FSANZ standards)
- Push notifications (expiry alerts, meal prep reminders)

---

## SUPABASE SCHEMA (full current state)

**profiles table (existing):**
- `blab_state` jsonb — full BLAB state
- `fq_completed` timestamptz — always write as ISO string
- `ai_programme` jsonb — nulled when BLAB active

**wod_scores (existing — apply if not done):**
- id, user_id, wod_id, score, score_type, date, notes, is_pb

**set_logs (existing):**
- Per-set data for RPE and previous best surfacing

**Nutrition tables:** See SQL above — run in Supabase dashboard before starting nutrition build.

---

## KEY FUNCTIONS (current index.html)

**BLAB core:**
- `blabGetState()` / `blabSaveState()` — localStorage + Supabase mirror
- `blabIsActive()` — reads `s.active`
- `blabGetSessionData(week, day)` — returns raw session object
- `blabToPhoenixSession(sess, week, day)` — translates to Phoenix format
- `blabCompleteSession(week, day)` — advances state, saves, re-renders Today
- `blabRestoreFromCloud(profileRow)` — hydrates localStorage from Supabase
- `_blabFlushCloud()` — force-sends pending write on pagehide

**Session rendering:**
- `openTodaySession()` — main session launcher
- `blabRunWorkout(ex, idx)` — timer engine for afap/total_rep/run
- `_blabWoRender()` — renders current runner state
- `_blabBlockComplete(idx, ex, setRows)` — fires RPE + saves set_logs

**WOD/Core:**
- `PHX_LIB` — static library array
- `openPhxSession(id)` — opens a WOD/Core session
- `_phxSaveScore(wodId, score, scoreType, notes)` — saves to wod_scores
- `renderRecordsTab()` — builds RECORDS tab view

**Timer:**
- `showCountIn(onComplete)` — 5-second countdown
- `_phxStampTimerStart()` — records start timestamp
- `_phxElapsedSince()` — calculates elapsed (screen-lock safe)
- `startRestTimer(sec, label, ..., onDone)` — full-screen gold rest overlay

---

## 2-YEAR STRENGTH ROADMAP

Current: Bench 130kg / Squat 150kg / Deadlift 170kg
Target by 2028: Bench 200kg / Squat 250kg / Deadlift 300kg

| Phase | Period | Programme | Expected Gains |
|-------|--------|-----------|----------------|
| 1 | Now → Jan 2027 | BLAB (hypertrophy/conditioning) | B145 / S175 / D195 |
| 2 | Jan → Jun 2027 | Wendler 5/3/1 (dedicated strength) | B170 / S215 / D250 |
| 3 | Jun → Dec 2027 | Strength + peaking cycle | B190 / S240 / D280 |
| 4 | Jan 2028 | Peak block | B200 / S250 / D300 |

Non-negotiables: 8hr sleep, bodyweight managed, no major injuries, 48+ training weeks/year.

---

## COMMUNICATION STYLE

- Jon is non-technical — strong on vision and ideas, needs clear execution
- Short messages, screenshots — "lets go" / "next" / "do it" = proceed without discussion
- One fix at a time, push immediately after confirmed-clean build
- Always full runtime check before push (node execution, not just --check)
- Jon is personally training on the app — real 4:30am sessions are the live test environment
- Direct feedback after each session — fix what's broken immediately
- Never speculate — if unsure, say so and ask

---

## EXCEL PROGRAMME DOC

`Phoenix_12_Week_Programme.xlsx` — 13 tabs (Overview + Week 1-12).
- Days 1-3 fully populated from DeFranco PDF source
- Day 4 marked TBC — Jon to review and fill in spec, pass back to Claude Code
- Day 5 (WOD) and Day 6 (Aerobic) named per block rotation
- Core rotation per week noted
- Week notes / AI assessment section for RPE logging

Jon to review, spec out Day 4, and pass back to Claude Code.

---

*End of handoff document — Chat 5*
*Version: v4.9.118 live at projectphoenix-app.com*

---

## DAY 4 — LOWER POWER — COMPLETE BUILD SPEC

Build this directly into `blabGetSessionData` for `day === 4` across all 12 weeks. No Excel needed — build it in code.

### Architecture

Day 4 structure every week:
1. **Main lift** — rotates per week (banded deadlift / rack pull / hang clean / push press)
2. **Jump/Plyometric** — rotates per block
3. **Posterior chain accessory** — rotates per block
4. **Conditioning finisher** — rotates per block (deload weeks: no finisher)

All exercises: set-by-set logging, load + reps per set, full-screen rest overlay, previous best banner.
Jumps: record height in inches where applicable. Prowler: record load (kg).
All results save to `records[exerciseName+'_result']` and surface as previous best next session.

---

### WEEK-BY-WEEK SESSION DATA

#### WEEK 1 — Banded Deadlift

**1. Banded Deadlift** — format: percentage_sets
Sets: 4×3 @ 60% DL 1RM. Coaching note: "Drive through the floor. Bar speed is the goal — not max load. Keep band tension consistent."

**2. Box Jumps** — format: standard_sets, record: height (inches)
4×5. 24". Full reset between reps. Stick the landing. Log height achieved.
Coaching note: "Step down — never jump down. Full hip extension at top."

**3. Nordic Planks** — format: standard_sets
3×5 eccentric only. Lower as slowly as possible. Use hands to push back up.
Coaching note: "Control the descent. 3-5 seconds down. This is hamstring armour."

**4. Banded KB Swing** — format: standard_sets
4×10. 24kg KB + light band anchored in front.
Coaching note: "Hinge hard, drive hips through. Band adds accommodating resistance at the top."

**5. Prowler Push** — format: standard_sets, record: load (kg)
4×20m. Log load used.
Coaching note: "Low handles, forward lean, short fast steps. Record load for next week."

---

#### WEEK 2 — Rack Pull

**1. Rack Pull** — format: percentage_sets
Sets: 4×4 @ 70% DL 1RM. Bar set just below knee. Coaching note: "Pull the slack out before driving. Think: push the floor away. Overload position — handle more than your floor pull."

**2. Box Jumps** — format: standard_sets, record: height (inches)
4×5. 24". Same as W1. Log height.

**3. Nordic Planks** — format: standard_sets
3×5 eccentric. Slightly slower descent than W1.

**4. Banded KB Swing** — format: standard_sets
4×12. 24kg + band. 2 more reps than W1.

**5. Prowler Push** — format: standard_sets, record: load (kg)
4×20m. Increase load from W1 if W1 felt manageable.

---

#### WEEK 3 — Banded Deadlift (load increase)

**1. Banded Deadlift** — format: percentage_sets
Sets: 5×3 @ 65% DL 1RM. One more set, slightly higher percentage.
Coaching note: "Same bar speed focus. If it slows down — that's too heavy. Reduce load, keep speed."

**2. Box Jumps** — format: standard_sets, record: height (inches)
4×5. Attempt 30" if 24" felt comfortable. Log height.

**3. Nordic Planks** — format: standard_sets
3×6 eccentric. One more rep per set.

**4. Banded KB Romanian Deadlift** — format: standard_sets
4×10 each side. 24kg + band. Switch from swing to RDL for hip hinge variation.
Coaching note: "Slow eccentric. Feel the hamstring load. Drive hips back not down."

**5. Prowler Push** — format: standard_sets, record: load (kg)
4×20m. Match or beat W2 load.

---

#### WEEK 4 — Hang Clean (power expression pre-deload)

**1. Hang Clean** — format: percentage_sets
Sets: 4×3 @ 65% DL 1RM (use as reference load — hang clean is technique dependent, adjust if needed).
Coaching note: "Start from mid-thigh hang. Violent hip extension, high pull, fast elbows. This is about rate of force development."

**2. Box Jumps** — format: standard_sets, record: height (inches)
5×5. Increase sets — accumulation peak. Log height.

**3. Nordic Planks** — format: standard_sets
3×8 eccentric. Block peak.

**4. Banded KB Good Morning** — format: standard_sets
4×12. 16kg KB + band. Third variation to close Block 1.
Coaching note: "Soft knees, hinge from hips, feel the hamstring stretch at bottom. Control the return."

**5. Prowler Push + Pull superset** — format: superset, record: load (kg)
3×20m Push + 20m Pull. Log load for each.
Coaching note: "Push first, turn around, pull back. One length each direction = one set."

---

#### WEEK 5 — DELOAD (Push Press)

**1. Push Press** — format: standard_sets
3×5 @ 50% bench 1RM. Light, technical focus.
Coaching note: "Dip and drive. Use leg drive to initiate, press to lockout. Not a shoulder press — it's a full body movement."

**2. Box Jumps** — format: standard_sets, record: height (inches)
2×5 submaximal. 24". No max effort — just maintain the pattern.

**3. Banded KB Swing** — format: standard_sets
2×10. Light band, 16kg KB. Easy effort.

*(No prowler, no nordics — deload week)*

---

#### WEEK 6 — Banded Deadlift (Block 2 start — now in deadlift main lift block)

**1. Banded Deadlift** — format: percentage_sets
Sets: 4×3 @ 65% DL 1RM. Block 2 begins — DL is now the Day 2 main lift too. Day 4 banded DL is speed work to complement heavy Day 2 pulling.
Coaching note: "Speed is everything. If you did heavy conventional on Day 2, this is your contrast session. Light bands, fast bar."

**2. Depth Drops into Box Jump** — format: standard_sets, record: height (inches)
4×5. Step off a 30cm box, land, immediately jump onto target box (24"+).
Coaching note: "Minimal ground contact time. Reactive — don't pause at the bottom. This is plyometric potentiation."

**3. Nordic Planks** — format: standard_sets
4×6. Block 2 — one more set than Block 1 peak.

**4. Banded KB Swing** — format: standard_sets
4×10. 24kg + medium band. Back to swings for Block 2.

**5. Prowler Pull** — format: standard_sets, record: load (kg)
4×20m. Facing away from sled, pull by rope hand-over-hand or walk forward with rope.
Coaching note: "Different stimulus from the push — posterior chain dominant. Log load."

---

#### WEEK 7 — Rack Pull (pairs with heavy DL block)

**1. Rack Pull** — format: percentage_sets
Sets: 4×4 @ 75% DL 1RM. Higher percentage than W2.
Coaching note: "You're pulling heavier on Day 2 now too. Rack pull gives you the overload stimulus without the full fatigue of a floor pull. Squeeze the bar before you pull."

**2. Depth Drops into Box Jump** — format: standard_sets, record: height (inches)
4×5. Same as W6. Aim for same or higher box.

**3. Nordic Planks** — format: standard_sets
4×8. Load increasing each week.

**4. Banded KB Romanian Deadlift** — format: standard_sets
4×12 each side. 28kg if available, otherwise 24kg + heavier band.

**5. Prowler Pull** — format: standard_sets, record: load (kg)
4×20m. Match or beat W6 load.

---

#### WEEK 8 — Hang Clean (mid-block power)

**1. Hang Clean** — format: percentage_sets
Sets: 4×3 @ 70% DL 1RM (reference). Heavier than W4.
Coaching note: "You're stronger now. More aggressive hip snap. Catch should feel automatic."

**2. Broad Jumps** — format: standard_sets, record: distance (metres)
4×5. Max distance each jump. Log distance.
Coaching note: "Change of stimulus mid-block. Horizontal power vs vertical. Drive arms hard."

**3. Nordic Planks** — format: standard_sets
4×8. Hold at Block 2 peak.

**4. Banded KB Good Morning** — format: standard_sets
4×12. 20kg + band.

**5. Prowler Push + Pull superset** — format: superset, record: load (kg)
4×20m each. Increase sets from W4.

---

#### WEEK 9 — Push Press (pre-deload power expression)

**1. Push Press** — format: percentage_sets
Sets: 4×4 @ 65% bench 1RM. More volume than W5.
Coaching note: "Aggressive dip and drive. This is the most athletic lift in the programme — full body power chain."

**2. Broad Jumps** — format: standard_sets, record: distance (metres)
4×5. Match or beat W8 distance.

**3. Nordic Planks** — format: standard_sets
4×8. Maintain Block 2 peak.

**4. Banded KB Swing** — format: standard_sets
5×10. More sets pre-deload.

**5. Prowler Push** — format: standard_sets, record: load (kg)
4×20m. Max load you can move with good mechanics.

---

#### WEEK 10 — DELOAD (Banded Deadlift)

**1. Banded Deadlift** — format: standard_sets
3×3 @ 50% DL 1RM. Light band. Bar speed focus.
Coaching note: "Deload means easy. Reinforce the pattern, not the load."

**2. Box Jumps** — format: standard_sets, record: height (inches)
2×5 submaximal. 24". Maintain reactive capacity.

**3. Banded KB Swing** — format: standard_sets
2×10. Light. 16kg + light band.

*(No prowler, no nordics — deload week)*

---

#### WEEK 11 — Rack Pull (peak posterior chain)

**1. Rack Pull** — format: percentage_sets
Sets: 5×3 @ 80% DL 1RM. Peak load of the programme.
Coaching note: "This is the heaviest rack pull you'll do. Set up perfectly. Pull the slack out, brace hard, drive. PR territory."

**2. Max Height Box Jumps** — format: standard_sets, record: height (inches)
5×3. True max height attempt each set. Full rest between reps.
Coaching note: "This is a test. What's your max box height? Log it. This is your Block 3 baseline."

**3. Nordic Planks** — format: standard_sets
4×8 with 2-second pause at bottom before pushing back up. Increased difficulty.

**4. Banded KB Good Morning** — format: standard_sets
4×15. Higher reps at Block 3. 20kg + medium band.

**5. Prowler Push + Pull superset** — format: superset, record: load (kg)
3×20m each. Heavy. Log load — this is your prowler benchmark.

---

#### WEEK 12 — Hang Clean (test week power)

**1. Hang Clean** — format: percentage_sets
Sets: 5×3 @ 75% DL 1RM (reference). Peak hang clean load.
Coaching note: "12 weeks of power work pays off here. Go heavier than you think you can. Fast hips, fast elbows. This is an expression of everything built this block."

**2. Max Height Box Jumps** — format: standard_sets, record: height (inches)
5×3. Match or beat W11. Log final height.
Coaching note: "Your 12-week power benchmark. This number carries forward to Block 2."

**3. Nordic Planks** — format: standard_sets
4×8 with 2-second pause. Final week.

**4. Banded KB Swing** — format: standard_sets
5×10. 24kg + medium band. All-out effort on last set.

**5. Prowler Push** — format: standard_sets, record: load (kg)
5×20m. Max load. Final benchmark.
Coaching note: "Record this load. Block 2 starts here."

---

### IMPLEMENTATION NOTES FOR CLAUDE CODE

1. Add Day 4 data to `blabGetSessionData` under `if(d === 4)` — follow exact same pattern as Days 1-3.

2. Each exercise needs these fields at minimum:
```javascript
{
  name: 'Exercise Name',
  format: 'standard_sets', // or percentage_sets / superset
  sets: 4,
  reps: '5', // or 'Max' or '3' etc
  rest: 120, // seconds
  note: 'Coaching cue here',
  prev_best: (state.records && state.records['Exercise Name_result']) || 0,
  record_key: 'Exercise Name_result' // what key to save result under
}
```

3. Percentage sets use `blabPct(DL, percentage)` for load calculation — same as bench/squat.

4. Deload weeks (5, 10) follow the `isDeload` pattern — reduced volume, no conditioning finisher.

5. Previous best for jumps shows as "Previous best: 24 inches". For prowler: "Previous best: 80kg". For distance: "Previous best: 4.2m".

6. All Day 4 records save to `blabState.records` under the exercise name key — same pattern as all other BLAB exercises.

7. After building, run the full 48-session harness to confirm all sessions generate without errors before pushing.

