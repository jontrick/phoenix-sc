# OPEN ITEMS — the single working list

**SIZE BUDGET: 300 lines.** `board_check.mjs` warns past it. When you cross it, ARCHIVE
resolved threads out — do not leave them in place. A list nobody finishes reading is a
list that lies about being read.

**ONE LIST.** A thread recorded here *and* in a chat's context goes stale in the chat, and
nothing announces it. If it is open, it is here. If it is not here, it is not tracked.

**Never invent an owner, a date or a figure.** Unknowns are written `???`. A marked gap is
more useful than a confident guess.

Format: `- [ ] OWNER — the thread. What would close it.`
Closing an item: delete the line, or move it under ARCHIVE with the version that closed it.

---

- [ ] TRAINING/PM — **The weekly-review and coach cluster still shows the AI programme's
      week to a BLAB user.** Same root cause as the badge fixed in v4.9.301, NOT fixed
      with it, and deliberately so. Sites: the Sunday "Week N Complete" card on Today
      (`mark`, ~L30601), the "Week N Review" title (`openWeeklyCheckin`, ~L30841), and
      "Coach Recommendation — Week N" / "Week N — Step 1 of 2" (~L31206, ~L31871).
      **WHY A LABEL SWAP IS THE WRONG FIX.** Those screens are internally CONSISTENT
      today: a week-1 label over week-1 content. Relabelling them `TRAIN W3` while the
      content still comes from `aiProgramme.week` would trade a visible disagreement for
      a label that lies about what is under it. Worse, the flow computes `nextN = weekN+1`
      and writes it back (`currentWeek: nextWeekN`, ~L14852) — display and increment are
      the same number, so changing the display forks the counter.
      **The real question is whose week the weekly review is**, and that is a decision,
      not a patch. Owner **???** — PM ruling wanted. Jon has not reported these; found
      while fixing the badge, so it is not urgent, but it is the same complaint waiting
      to happen on a Sunday.

- [ ] TRAINING/PM — **`#hamburger-dot-records` can never show.** The Records screen has
      its own hamburger with its own dot element, but `_phxUpdateHamburgerDot()` only
      ever writes to `#hamburger-dot` (the Today one). So the Records dot is finished
      code with no door — the same shape as `_blabCalEntryView` and the orphaned `_bak`.
      NOT fixed with v4.9.314 because the fix is a choice, not a repair: wiring it up
      ADDS a badge to a screen that has never had one, which is new behaviour nobody
      asked for. Deleting it is the other option. Owner **???**, needs a one-line
      decision. Found 2026-09-06 while fixing the menu.

- [ ] TRAINING — **`tests/training.mjs` "DOT: a submitted check-in clears it on the day
      itself" is RED on origin/main, and goes green again on Friday.** Reproduced against
      origin's OWN untouched `index.html` and `tests/training.mjs` in a scratch copy, so
      it is not caused by any peptide change. **The app is right; the test is wrong.**
      The test derives today's weekday name and sets `fqCheckInDay` to it. The onboarding
      picker (index.html ~L2546) offers only Friday / Saturday / Sunday / Monday, and
      `CHECK_IN_DAYS` (~L33363) maps exactly those four. On a Tuesday it sets `'tuesday'`,
      `_phxCheckInDayIndex()` falls back to 5 (Friday), so the dot correctly stays hidden
      and the assertion `want "block"` fails.
      **So it fails Tue/Wed/Thu and passes Fri/Sat/Sun/Mon.** Found 2026-09-08, a Tuesday.
      Fix: pick a day the app actually supports rather than today's, or assert the
      fallback. Not mine to edit — Training's test, Training's feature.
      **Why it matters more than one red row:** a gate that is red three days in seven
      teaches everyone to push through a red gate, and the next red will be a real one.

- [ ] **PM — SWIPE FORWARD/BACK BY DAY ON THE MAIN TODAY SCREEN. Jon asked for this
      across PEPTIDES, NUTRITION AND TRAINING, and asked for PM to drive it** (2026-09-08,
      "i want this for peptides, nutrition and training - pm to push on all"). PEPTIDES
      raised it and is NOT building it: `renderTodayScreen` is shared, it was rewritten at
      v4.9.298 and is still untested by him, and the hard part is not the swipe.
      **THE HARD PART IS THAT EVERY WRITE ON THAT SCREEN ASSUMES TODAY.** Peptides is the
      worked example, and the other two will have the same shape:
      · `pepToggleDose` writes `ps.checked[_pepToday()]`; `pepSkipDose` and
        `pepAddExtraDose` likewise; `pepLogMakeUp` stamps `openedDate = _pepToday()`.
      · So on a screen showing Monday, a tick lands on TODAY. Silent, and it corrupts
        adherence and stock in a way nothing surfaces.
      **The reading side is already done in peptides and is not the problem:**
      `_pepGetDoses(ps, dateStr)` has taken a date since v4.9.255 and the calendar uses it.
      **Three decisions PM needs to make before anyone writes code, in this order:**
      1. Is a past/future day READ-ONLY, or can he act on it? Read-only is one day's work
         and cannot corrupt anything. Editable means every write path in all three domains
         takes an explicit date, which is the real project.
      2. If editable, what does "add a dose"/"complete a session" mean on a FUTURE day?
      3. Which surfaces move together — does swiping the Today screen also move the
         nutrition day, the session card and the peptide tile as one, or do they scroll
         independently? Jon's phrasing ("swipe forward and back days to see") reads as
         READ-ONLY and AS ONE, which is decision 1 = read-only and decision 3 = together.
      **Recommendation from PEPTIDES:** ship read-only first. It is what he described, it
      is a fraction of the work, and it cannot produce a wrong tick at 4:30am. Editing a
      past day can follow once someone has costed date-threading across the three domains.
      Peptides will do its half on PM's word; the peptide read path needs no new work.

## JON'S 2026-09-08 SESSION REPORT — 6 OF 7 STILL OPEN

One message, seven items. One commit each. **Six done (.320-.324); only #1 Run the
Rack is left.** Diagnoses
below are verified against the source, not guessed — build from these, do not re-derive.

- [x] **2. Banded Deadlift showed last week's Rack Pull.** DONE v4.9.320. Day 4 slot 1
      rotates and every movement in it carries `blab_lift:'deadlift'`, so the banner's
      `records['deadlift_amrap_w'+(week-1)]` was reliably the OTHER exercise. Now reads
      `records[name+'_wk']` (per-exercise, added .291) scanning back, and names the week.
- [ ] **1. Run the Rack — needs its own format.** Currently `{name:'Run the Rack DB
      Curls', format:'standard_sets', sets:1, reps:'1 descending set'}` at ~L7157, W3–4
      only. Jon wants: a row per drop that he ADDS as he goes, tick to complete each and
      move to the next, a "Run the rack completed" button at the bottom, **total volume
      (kg × reps summed across drops) as the benchmark**, and the per-drop breakdown
      surfaced next week. Nearest precedent is the pull-up chip UI (`_blabTrRemove`,
      `_blabTrRecount`) — add-as-you-go rows already exist there. Biggest of the seven.
- [x] **3. Core circuit compared against a different circuit.** DONE v4.9.321. Keyed by
      the circuit itself (rounds + movements + reps); the old shared record is ignored,
      not deleted. WAS: `coreCircuit()` (~L6914)
      hardcodes `_timeRecordKey:'Core Circuit_time'` and `prev_best:rec('Core Circuit_time')`
      for EVERY variant, but the movements change by block — W1–2 is Toe Touches/Bicycle/
      Side Plank, W3–4 is Sprinter Sit-ups/V-ups/Toe Touches/Hip-ups. Same PB slot, different
      work. Jon: "not much point — just keep for next weeks redo to check this one", i.e.
      key the record to the CIRCUIT COMPOSITION so a redo of the same circuit compares and a
      different one shows nothing. Same class as #2: a key that does not identify the thing.
- [x] **4. Box jumps showed no last-week numbers.** DONE v4.9.323. The history was never
      missing — the dropdown was nested inside the weight suggestion, which correctly
      returns null without a load. Split; fixed for every bodyweight movement. WAS: They carry `prev_best:rec('Box Jumps_height')`
      + `record_key:'Box Jumps_height'` (~L7223/7237/7274) — a HEIGHT record only. Nothing
      surfaces what he actually achieved per set. `records[name+'_wk']` already holds it
      (written for every format since .291); this is a read/render gap, not a storage one.
- [x] **5. 1.6km run best under the timer.** DONE v4.9.323, plus a live ahead/behind gap
      painted from the existing clock tick. WAS: The previous best
      exists (`_phxCardioBlock`, ~L5757–5768, appends "— beat it.") but is not positioned or
      sized to read mid-run. Rendering change only.
- [x] **6. DONE v4.9.322 — Copenhagen planks,** with a read-fallback so his logged Nordic
      holds still reach the new name. Nothing migrated. WAS: Nordic Planks are actually COPENHAGEN planks — Jon's own correction.** Slot 3 of
      Day 4, W1–W12, with a `hold_secs` progression 20→45 (~L7291+). **Renaming the display
      is the easy half; the trap is the records.** Keys are `Nordic Planks_*` (incl. `_wk`,
      `_time`), and the harness pins the NP: hold_secs ladder by name. A blind rename orphans
      his history — needs a read-fallback to the old key, and the harness pins updated
      deliberately rather than made to pass.
- [x] **7. DONE v4.9.324 — dry run for Core and WOD.** Own flag (`_phxDryRun`), because
      `_blabDryRun` does NOT cover `_phxSaveScore` — reusing it would have logged a real
      score and a real PB during a "preview". WAS: Dry run for Core and WOD sessions — "to check they are working but to also see
      the format before I choose". **The machinery already exists for BLAB**: `blabOpenAudit`
      / `blabOpenAuditDay` set `_blabDryRun` (blocks every write via the guard in
      `blabSaveState`) and `_blabAuditMode.readOnly`. WOD/Core open via
      `_phxStartSession(libId)` off `PHX_LIB` (~L37623). Extend the same flags rather than
      inventing a second preview path — and note `_blabDryRun` guards BLAB's save, so the
      PHX score/save paths (`_phxSaveScore`) need their own guard or they WILL write.

## WAITING ON JON

- [ ] JON — **Upper 2, morning session of 2026-09-05.** Six Training fixes land together
      and NONE has been used by him yet. All are verified by gates only, and three fixes
      this week passed clean gates while still being broken for him — each time the tests
      covered the piece just written rather than the route he takes. So this session is
      the only real check. The six shipped by v4.9.276; live is now v4.9.298 (curl-confirmed
      against projectphoenix-app.com, code present, not just the version string).
      **What to watch, in the order he will hit it:**
      · PULL-UPS — count-in before the clock; the clock is now 42px, not an 11px line;
        each set is a chip with an "x" to delete; the input says "Reps in THIS set only".
        His 4+3-typed-as-7 case is the one to retry deliberately.
      · Last time's REPS AND TIME should show on the pull-up card before he starts.
      · A green COMPLETED badge under the exercise name after finishing any run/complex.
      · SUPERSET history should show BOTH sets from last week, not one.
      · Leaving the session and returning should keep his progress and NOT re-show today's
        partial as last week's numbers.
      Closes when he reports. **A silent pass is not a pass** — ask him per item, because
      "seems fine" has twice meant "did not reach that screen".

- [ ] JON — **Today, two session cards (v4.9.298).** From his 10:29 screenshot: the
      whole top of Today was one IN PROGRESS / RESUME / START OVER panel, because the
      in-progress takeover ran before the calendar renderer and returned. It is now the
      no-calendar path only. **What to watch:**
      · On a day with a BLAB session AND a WOD/core, BOTH cards are on screen, each with
        its own name, status and button.
      · Finish one: it goes green with a COMPLETED tag and offers NO buttons — it must not
        vanish, and it must not still say Resume.
      · A part-done session shows In progress + Resume ON ITS OWN CARD, with the other
        session still visible beside it.
      · Header reads "1 of 2 done". When both are done the outer card is green and tapping
        it does nothing.
      Untested by him. Note the shape of the risk: every direct-renderer test stayed green
      when I inverted the takeover gate, because they call `_blabRenderTodayFromCalendar`
      and so never reach the branch that was broken. One screen-level test now drives
      `renderTodayScreen()`; that is the only automated cover for the actual fault.

- [ ] JON — **Five nutrition decisions were made FOR him; each needs his eyes.** The
      rest of v4.9.299–.315 he asked for. Detail is in each version's commit.
      · **04:15 (.299)** — every non-lifting day LOST its banana. He described the old
        behaviour the other way round; a probe showed the inverse. One line to reverse.
      · **Cashews (.303), grains (.305), dinner-heavy (.312)** — each holds ONE macro and
        lets the others move UNCOMPENSATED, and each says so on its row: cashews ~6 g
        carbs over, quinoa +5.4 g protein and +4.9 g fat at lunch. **Nothing compensated
        before .305 either.** The alternative is routing fat through the evening oil.
      · **Dinner-heavy reverses a skew he did not know was there** — he said protein was
        "roughly evenly spread"; measured, LUNCH is 28% and dinner 21%. Chicken
        135→101 g, yoghurt 200→150 g, +15 g at 19:00, daily total unchanged.
      · **Meal 7 (.308)** — OFF by default; on, it **trims chicken, salmon, tuna and whey
        by about a fifth** so the target does not move. My reading of "the daily macro
        target and other meals adjust"; the alternative is ~215 kcal over. Changes the
        Sunday batch, so it is a WEEK decision. He put it at ~350 kcal; it is 216.
      · **Four tabs (.313-.315)** — the day HEADER opens the day-level choices, since
        those are not components with a line to tap; the calendar and recipe library kept
        doors after losing their tabs; and the run-up PREVIEWS Monday, with ticks landing
        on Monday rather than today.
      **A ceiling now exists and is declared:** dinner-heavy + Meal 7 + eggs + whites at
      phase 5 floors the evening oil at zero with 5.8 g of fat uncompensated. The sheet
      says so and names the fix — the first limit this plan admits rather than absorbs.
      On the phone: "nothing" at 04:15 and check the carbs still land; three grains and
      check the prep plan lists three pots; Meal 7 on and see whether the smaller lunch is
      one he will eat; and tap a food on PLAN to confirm it opens only that food.
- [ ] JON — **Two week badges, top right of Today (v4.9.301).** Was one pill reading
      "WEEK 1" under a Week 3 session. **What to watch:** it should now read `TRAIN W3`,
      matching the session card. **The nutrition pill is EXPECTED TO BE ABSENT until
      7 Sept** — the cut opens then, and Nutrition's contract says an unopened programme
      has no week and the label must be omitted rather than shown as "Week 0". So one
      pill before the 7th and two from the 7th is correct behaviour, not a half-built
      feature. Closes when he confirms the training number matches the session card.

- [ ] JON — **The hamburger menu (v4.9.314).** He reported the tap going nowhere and
      asked for it removed if it was only the old AI-programme notifier. **It is not** —
      it opens 17 navigation items and is the ONLY route to Nutrition, Peptides, Records,
      the training calendar, Programme/Audit/Adjust and the standalone timer. So it was
      fixed, not removed. **I COULD NOT REPRODUCE HIS SYMPTOM**, and that matters: the
      DOM wiring is correct and the tap lands on the button (verified against the live
      site). What I DID find and fix is one way it can die silently — `openSidebar()`
      read the walk streak before opening the panel, and a corrupt `phoenix_walk_logs`
      throws there, killing the tap with no message on iOS. The panel now opens first.
      **What to watch:** if the menu still goes nowhere on v4.9.314, the cause is
      something else and the next step is his console, not another guess.
      · The red dot is the WEEKLY CHECK-IN reminder, not an AI-programme badge. It shows
        only on `athlete.fqCheckInDay` (default Friday) when that week's check-in has not
        been submitted. He saw it on a Sunday, which means his check-in day is set to
        Sunday — worth confirming. Say the word and it goes; it was left because his
        stated condition for removal ("purely the AI programme notification") is false.

- [ ] JON — Wake lock: does the screen still sleep on v4.9.264? Settings → Diagnostic now
      prints `screen wake lock` as `held` / `REFUSED: …` / `UNSUPPORTED`. Closes when he
      reports the line. Note: iOS Low Power Mode disables wake locks outright.
- [ ] JON — Peptide stock take, still to enter: STOCK -> "Count stock by total mg"
      (v4.9.268 takes TOTAL MG, not vial counts, and shows its division).
      HIS FIGURES, 2026-09-04 — recorded here because they exist nowhere else. 12 of 13
      Phase 2 compounds; only DSIP is outstanding.
        Retatrutide  8 x 30mg = 240mg      Tesamorelin  5 x 10mg =   50mg
        Ipamorelin   8 x 10mg =  80mg      Epitalon    10 x 10mg =  100mg
        CJC-1295     8 x 10mg =  80mg      NAD+        10 x 500mg = 5000mg
        BPC-157      7 x 10mg =  70mg      GHK-Cu       9 x 50mg =  450mg
        TB-500       7 x 10mg =  70mg      TA-1         6 x 10mg =   60mg
        MOTS-c       6 x 10mg =  60mg      5-AMQ        3 x  5mg =   15mg
        DSIP "have, use when required" — NO FIGURE. Semax and SLU NOT ORDERED.
      He writes these as two numbers whose ORDER VARIES ("reta 30 x 8" is size-first,
      "BPC 7 X 10" is count-first) — unambiguous only because the vial size is known.
      Do NOT write a parser that assumes an order; ask. Closes when STOCK matches.
- [ ] JON — Peptide stock now moves ONLY on a logged make-up (v4.9.300, his ruling), so
      the count is only as good as his logging: every vial he mixes must be tapped in,
      via "Made up" on a TODAY row or "+ Made up a vial" for any compound (v4.9.302/.304).
      Closes when he has run a cycle and STOCK still matches the fridge. The invariant,
      and the fact that it LOOKS like a bug, are in HANDOFF_PEPTIDES section 3.
- [ ] JON — Peptide BAC water volumes. Eight vial sizes confirmed and recorded per-field
      in `_PEP_CONFIRMED`; the water volume is still PDF-derived for everything except
      retatrutide and bpc157, and a concentration needs both. Per his ruling the app now
      shows MAKE-UP REQUIRED rather than a marked guess (v4.9.278), dismissable with
      "Not now" (v4.9.300). Closes per compound as he logs a mix or sets the volume in
      ADJUST -> tap the compound. First one he named: Epitalon in 0.5mL, not 1mL — 5mg at
      10mg/mL is 50 units; at 0.5mL it is 25u. Deliberately not hard-coded.
- [ ] JON — Tesamorelin is marked NOT STARTED (v4.9.319) rather than assumed to have begun
      on its phase date. When he actually takes the first dose: ADJUST -> Tesamorelin ->
      "Started today". That records the real start AND shifts the whole 25-day course, so a
      late start does not silently shorten it. Closes when he has started it.
- [ ] JON — Should a live WALK and the WEEKLY CHECK-IN be restored after a screen lock?
      Both are deliberately in `_neverRestoreTabs` (v4.9.264) — a walk would imply one is
      running, and the check-in form reloads EMPTY so returning to it invites a second
      submission. His call; PM will wire either properly if he wants it.

## OPEN — REPO / TOOLING

- [ ] PM — `.git` was deleted from the main checkout on 2026-09-04, orphaning all three
      worktrees. Restored from a fresh clone and worktrees re-registered; nothing was
      lost (verified byte-for-byte against origin). CAUSE UNKNOWN — `???`. Reopen with
      evidence if it recurs. Worktrees are now on detached HEADs because the branch
      bindings lived in the deleted directory.

## OPEN — NUTRITION

- [ ] NUTRITION — Servings at add-to-meal. A scanned per-serving food stores `serving_g`
      and currently goes in at exactly one serving. Jon's ruling was that the serving
      COUNT is an input at the point of adding to a meal. Closes when the picker asks
      "how many servings?" for a food with `serving_g > 0` and multiplies into `qty_g`.
      `qty_g` must stay GRAMS — the shopping list sums it as grams.
- [ ] NUTRITION — Label extraction is UNBLOCKED and not built. Vision passthrough was
      verified 2026-08-22; the scanner is manual-first and works without it. Design
      already recorded in HANDOFF_NUTRITION: the call sends THE IMAGE AND NOTHING ELSE,
      and extraction fills fields rather than bypassing the basis rule or the confirm
      step. `harness.mjs` `LABEL/EXIT` FAILS the moment a network call is added, so
      whoever builds it must declare the payload there. Closes when built, or when Jon
      says he does not want it.

- [ ] NUTRITION — **A swapped lunch protein is bought at its COOKED weight.** Chicken
      carries `yld:0.75` so 135 g cooked shops as 180 g raw; turkey, white fish and 5%
      beef have no row, so a swapped week buys **945 g instead of 1260 — 25% short**
      (measured 2026-09-05). Shelf is right, weight is not. Closes when a swapped-in
      protein carries a yield — they genuinely differ, so borrowing 0.75 for all three
      is a decision, not a default.
- [ ] NUTRITION — `nutProgSetDinnerDefault` is an ORPHAN (index.html:21889): guarded,
      tested, and **called from nowhere in index.html** (grep, 2026-09-05). It is the
      "what I shopped for" default every per-meal pick falls back to, so only a test can
      set it. Nothing is broken — per-day picks are reachable from Today and the calendar
      — but the weekly default has no control. **Eighth instance of finished code with no
      door.** Closes when the weekly setup offers it, or it is archived as unwanted.

## OPEN — CROSS-DOMAIN

- [ ] TRAINING — **origin/main is RED on gate 3, and has been since at least v4.9.317.**
      `tests/training.mjs` › "DOT: a submitted check-in clears it on the day itself":
      *shown when the check-in is outstanding — got "none", want "block"*.
      **Proven not to be Nutrition's**: it fails on origin's own index.html with origin's
      own test file, checked out clean, before any of my changes.
      **Diagnosis.** `CHECK_IN_DAYS` (index.html ~:33363) maps only
      `{friday, saturday, sunday, monday}`. The test derives the day from the REAL clock
      (`_phxBrisbaneNow()`) and forces `fqCheckInDay` to today's name, so on a Tuesday,
      Wednesday or Thursday the lookup misses, `_phxCheckInDayIndex()` falls back to 5
      (Friday), and the dot correctly stays hidden. **It is a calendar-dependent test: red
      three days in seven, green the other four.** Today is Tuesday.
      **Which is wrong is Training's call, and that is why I have not touched it:** if Jon
      can only choose those four days, the map is right and the test should not force an
      arbitrary weekday; if he can choose any day, the map is short three entries and the
      dot never shows for them. Closes either way, with the test pinned to a FIXED date so
      it stops depending on when it is run.


- [x] TRAINING — Two disagreeing week numbers on Today. **DONE v4.9.301** (60deb54).
      **Lesson:** they were never two derivations of one week — `athlete.currentWeek`
      counts the AI programme and never moves on a BLAB account, `progWeek()` counts
      calendar weeks. Three counters, three questions, one place that decides.
- [ ] TRAINING + NUTRITION — **Nutrition decides "is today a lifting day" from its OWN
      static map** (`_NUT_PROG_SESSIONS`), not training state. Since v4.9.299 that map
      gates the 04:15 intra drink, so a divergence from Jon's real training days gives
      **a wrong plan that looks right** — the worst kind here, because he preps food to
      it a week ahead. Closes when Training names a function answering "does this date
      contain a lift" and Nutrition calls it (as it now does for the week label), or both
      sides agree the map is authoritative and a gate asserts they match.

- [ ] PM — `tests/pm.mjs` "CONTRACT _phxRecordWriteError: holds for a CARELESS caller" is
      FLAKY at ~0.17% and fails as **"medical/personal value leaked: 24.8"**. Nothing leaks.
      The helper stamps `ts: new Date().toISOString()`, the assertion scans the WHOLE blob,
      and an ISO timestamp contains the literal `24.8` whenever seconds are 24 and
      milliseconds are 800-899 — 100ms in every 60,000. Measured by enumerating a full
      minute: exactly 100 of 60,000 timestamps match, e.g. `2026-09-04T19:33:24.800Z`.
      Observed once here, then 6 clean runs.
      **Why it is worth fixing rather than tolerating:** it cries wolf on a medical-data
      leak specifically. The first response to seeing it red is to hunt a leak that is not
      there; the second time, to dismiss it as flaky — which is how a real one gets waved
      through. Fix: scan `snap.payload_shape` and `snap.message`, i.e. the fields that
      carry CALLER data, not the metadata the helper adds itself. Or exclude `ts`.
      **The generalisable half:** a negative assertion over a whole serialised object also
      scans every field the code under test legitimately adds, so it can collide with
      metadata that has nothing to do with the property. Not mine to edit — PM's test.

- [ ] PM — `board_check.mjs` decides BEHIND by comparing APP_VERSION strings, so a checkout
      behind only by `docs`/`tests`/`tooling` commits reports **clean**. Measured 2026-09-04:
      the training worktree was 3 commits behind (`ada47d5`, `cb13c91`, `ea97c43`), none of
      which touched `index.html`, and the board showed no BEHIND marker. The three commits
      changed `OPEN_ITEMS.md` and `SESSION_START.md` — the record and the session rules.
      Consequence: that session read a stale OPEN_ITEMS and reported two already-closed
      items as live. Suggested fix: `git -C <path> rev-list --count HEAD..origin/main`
      instead of the version string. Written up in KNOWN_ISSUES. It is PM tooling so I have
      not changed it. **Until then the mitigation is `git fetch` BEFORE `board_check.mjs`**,
      which is the opposite of the current session-start order.

- [ ] TRAINING — `submitWeightCheckin` (index.html ~:27665) is an ORPHAN: defined once,
      called nowhere, and its `#weight-checkin-banner` is a force-hidden no-op div. Three
      comments in nutrition code describe working around it. Not removed by Nutrition
      because it is Training's. Closes when Training either wires it or archives it under
      CLAUDE.md rule 9. Nothing is broken by it today — it is dead weight plus three
      misleading comments.
- [ ] ??? — A relayed Nutrition SUMMARY and the canonical `HANDOFF_NUTRITION.md` on origin
      had DIVERGED — the summary carried a stale BLOCKING reinstall instruction the repo
      document does not. Only the repo one is authoritative. If summaries are being kept
      outside the repo, they are a second copy of a thing that must have one. Closes when
      whoever maintains it either drops it or points it at the repo file.

## RESOLVED SINCE THE LAST BOARD

- **A phase's stock figures were being treated as a COUNT.** The importer sets
  `stockCounted` from the presence of `sealedVials` — right for a paste where Jon typed his
  own numbers, wrong for a phase where PEPTIDES transcribed them from a document. Applying
  Phase 2 marked SIX of thirteen compounds counted that he had never counted, so the
  readiness gate was partly satisfied by transcription. Fixed v4.9.266: a phase-supplied
  figure never sets `stockCounted`.

## ??? — GAPS. Things nobody currently knows.

- `???` What killed `.git`. No candidate identified.
- `???` Whether the wake lock has EVER been granted on Jon's device. The outcome was
  swallowed by a bare `catch(e){}` from v4.9.118 until v4.9.264, so there is no history.
- `???` Which domain chats are live right now, and what each is mid-build on. Peer names
  rotate constantly (six rotations in one day) and `SendMessage` was unavailable to the
  PM on 2026-09-04. Derive from `board_check.mjs` CHECKOUTS, not from memory.
- `???` Whether the other reconstitution defaults match his vials. **STATE THE CUT:**
  PEPTIDES says **five** — ipamorelin, TA-1, GHK-Cu, NAD+, TB-500 — meaning *the .236-corrected
  batch minus bpc157*. The PM said **16**, meaning *every entry in `_PEP_RECON` except the one
  marked CONFIRMED BY JON*. Both are true of different populations and neither is wrong; a
  bare "five" and a bare "16" would have read as a contradiction. Five are known-suspect;
  the other eleven are merely unconfirmed.

## ARCHIVE — closed, kept only where the closing evidence matters

- [x] Auto-update after the zero-byte `sw.js` — **CONFIRMED WORKING** v4.9.252. Jon
      confirmed the version moves on its own; closed a claim unverified since v4.9.208.
- [x] **v4.9.265 SHIPPED** — `9ef505b`. **Lesson kept:** I reported the push failure as
      "GitHub unreachable (DNS)". The DNS failures were real, but the LATER ones were a
      plain non-fast-forward — origin had moved. Two causes wearing one symptom, and I
      named the first for both. Read the actual error text.
- [x] Coach-worker vision passthrough — **VERIFIED** 2026-08-22, synthetic report with
      unguessable values, all four returned exactly.
