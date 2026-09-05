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

- [ ] JON — **Today screen, two session cards (v4.9.298).** From his 10:29 screenshot: the
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

- [ ] JON — **Nutrition swaps: three decisions were made FOR him and all need his eyes.**
      Everything else in v4.9.299 / .303 / .305 he asked for; these he did not.
      · **04:15 (.299)** — a lifting day now offers intra / banana / nothing, and **every
        non-lifting day LOST the banana it had.** He described the old behaviour the other
        way round; a probe showed the inverse, and this is built to what the app actually
        did (KNOWN_ISSUES, "What something CURRENTLY does is a claim to check"). A banana
        back on rest days is a one-line default change if he wants it.
      · **Cashews (.303) and grains (.305)** — both hold one macro and let others move
        UNCOMPENSATED, and both say so on the row: cashews ~6 g of carbs over; quinoa at
        lunch +5.4 g protein and +4.9 g fat against basmati, wild +4.2 g, sushi −2.8 g.
        **Nothing compensated before .305 either** — the same choice just ran for a whole
        week — so it is a property of holding a macro constant, not a regression. The
        alternative is routing the fat through the evening oil. **His call; until he makes
        it, visible-but-uncompensated stands.**
      · **Eggs (.307-.309)** — Meal 7 is OFF by default; turning it on **trims chicken,
        salmon, tuna and whey by about a fifth** so the target does not move. My reading
        of "the daily macro target and other meals adjust"; the alternative is the day
        running ~215 kcal over. It changes the Sunday batch, so it is a WEEK decision. He
        estimated Meal 7 at ~350 kcal; the foods he named come to 216.
      On the phone: pick "nothing" at 04:15 and confirm the day still hits its carbs; pick
      three grains and confirm three pots on the prep plan; turn Meal 7 on and check the
      smaller lunch portion is one he will actually eat. Nut butter's selector goes at
      week 10 by design; sushi and arborio were ALREADY selectable — .305 built their
      missing prep, .306 rebatched risotto per him.

- [ ] JON — **Two week badges, top right of Today (v4.9.301).** Was one pill reading
      "WEEK 1" under a Week 3 session. **What to watch:** it should now read `TRAIN W3`,
      matching the session card. **The nutrition pill is EXPECTED TO BE ABSENT until
      7 Sept** — the cut opens then, and Nutrition's contract says an unopened programme
      has no week and the label must be omitted rather than shown as "Week 0". So one
      pill before the 7th and two from the 7th is correct behaviour, not a half-built
      feature. Closes when he confirms the training number matches the session card.

- [ ] JON — Wake lock: does the screen still sleep on v4.9.264? Settings → Diagnostic now
      prints `screen wake lock` as `held` / `REFUSED: …` / `UNSUPPORTED`. Closes when he
      reports the line. Note: iOS Low Power Mode disables wake locks outright.
- [ ] JON — Peptide stock: enter his stock take via STOCK → "Count stock by total mg"
      (v4.9.268). He reports stock as TOTAL MG, not vial counts, so the sheet takes mg
      and does the division. Fixes for context: `pepApplyPhase` used to replace ps.stacks
      wholesale, so applying a phase overwrote counted stock (fixed v4.9.266).
      HIS FULL STOCK TAKE, given 2026-09-04 — recorded here because it exists nowhere
      else. 12 of the 13 Phase 2 compounds; only DSIP is outstanding.
        Retatrutide  8 x 30mg = 240mg      Tesamorelin  5 x 10mg =   50mg
        Ipamorelin   8 x 10mg =  80mg      Epitalon    10 x 10mg =  100mg
        CJC-1295     8 x 10mg =  80mg      NAD+        10 x 500mg = 5000mg
        BPC-157      7 x 10mg =  70mg      GHK-Cu       9 x 50mg =  450mg
        TB-500       7 x 10mg =  70mg      TA-1         6 x 10mg =   60mg
        MOTS-c       6 x 10mg =  60mg      5-AMQ        3 x  5mg =   15mg
        DSIP — "have, use when required", NO FIGURE. Still open.
        Semax and SLU — NOT ORDERED. Neither is in Phase 2.
      NOTE ON FORMAT: he writes these as two numbers whose ORDER VARIES — "reta 30 x 8"
      is size-then-count, "BPC 7 X 10" is count-then-size. It is unambiguous only
      because the vial size is known in each case. Do NOT write a parser that assumes
      an order; ask.
      Where Phase 2 already carried a figure his count agrees EXACTLY (tesa, epi, nad,
      mots, 5amq, cjc). That confirms the TOTALS. It is not independent confirmation of
      the VIAL SIZES — both trace to his own ordering document — but he has now stated
      the sizes directly, which is, and they are recorded in `_PEP_CONFIRMED` (v4.9.269).
      Closes when the STOCK screen reads what he counted.
- [ ] JON — Reconstitution: WATER volumes. He has confirmed EIGHT vial sizes directly
      (retatrutide 30mg, bpc157, tb500, ipamorelin, cjc1295, ta1 10mg, ghkcu 50mg,
      nad 500mg), recorded per-field in `_PEP_CONFIRMED` with the date he said it. The
      BAC VOLUME is still PDF-derived for everything except retatrutide and bpc157, and
      a concentration needs both numbers.
      HIS RULING (2026-09-04): "keep blank with make up required note to complete the
      daily dose." So as of v4.9.278 the app WITHHOLDS the unit count rather than
      printing a marked guess — a gold "assumed" caption still puts a number in front of
      him at 4:30am, and the number is what he acts on. Most of his protocol now reads
      MAKE-UP REQUIRED until he logs each vial.
      He CLOSES IT PER COMPOUND, in the app, three ways: log the actual mix; or set the
      volume in ADJUST -> tap the compound -> Save (which stamps `waterConfirmedAt`); or
      tell PM/PEPTIDES the volume so it goes in `_PEP_CONFIRMED` — never from the
      document, which is the thing that table exists to outrank.
      FIRST ONE HE NAMED: Epitalon in 0.5mL rather than 1mL, because 5mg at 10mg/mL is
      50 units and that is a lot to push. At 0.5mL it is 25u. Deliberately NOT hard-coded
      — "i want to edit in app not from this note".
      A note he does not want to act on now can be silenced with "Not now" (v4.9.300)
      without claiming a vial was mixed — the units stay withheld either way.
- [ ] JON — **Peptide stock now moves ONLY when he logs a make-up** (v4.9.300, his
      ruling). Ticking a dose no longer opens a vial or decrements the sealed count.
      So the count is only as right as his make-up logging: **every vial he mixes has
      to be tapped in**, via "Made up" on a TODAY row or "+ Made up a vial" for any
      compound (v4.9.302). Closes when he has used it for a cycle and the STOCK numbers
      still match the fridge. The invariant and the trap it creates — it looks exactly
      like a bug — are written up in HANDOFF_PEPTIDES section 3, invariant 4.
- [ ] PEPTIDES — The EDIT SHEET's water field does not clear "make-up required", only the
      compound panel and a logged make-up do. Deliberate: water is one of twelve fields
      there and is written on every save, so correcting a typo in the notes would bless a
      volume nobody checked — the shape of the phase figures that were silently marking
      stock as counted before v4.9.266. Recorded because the asymmetry is not obvious at
      the call site. Revisit if Jon edits water there and reports the note persisting.
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

- [x] TRAINING — Two disagreeing week numbers on Today. **DONE v4.9.301.** Two pills:
      `TRAIN W3` from `blabTrainingWeek()`, `CUT W1` from `nutProgWeekLabel()` — called,
      not derived, `null` omits. **The lesson, which is why this line survives at all:**
      they were never two derivations of one week. `athlete.currentWeek` counts the AI
      programme and never moves on a BLAB account; `progWeek()` counts calendar weeks
      from `startDate`. Three counters, three questions, one place that decides.
      Compressed from Training's fuller entry to hold the 300-line budget — the original
      is in the history at fd4517b, and Training should restore it if the detail is
      still wanted.
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

- [x] Auto-update after the zero-byte `sw.js` — **CONFIRMED WORKING**, v4.9.252. Jon
      answered directly that the version at the bottom of Today moves on its own after a
      normal open. Closed a claim that sat UNVERIFIED from v4.9.208.
- [x] **v4.9.265 SHIPPED** — `9ef505b`, 2026-09-04. Training's superset-history fix, Jon's
      THIRD report of that bug. Training left it mid-rebase and could not be messaged; the
      PM finished it using their own documented resolution, rebased onto current origin
      twice as it moved, and pushed. All four gates green each time.
      **A correction on my own report of it:** I recorded the first push failure as "GitHub
      unreachable (DNS)". The DNS failures were real, but the LATER failures were a plain
      non-fast-forward — origin had moved under it. Two different causes wearing one
      symptom, and I named the first one for both. Check the actual error text.
- [x] Coach-worker vision passthrough — **VERIFIED**, 2026-08-22, by posting a synthetic
      report with unguessable values and getting all four back exactly.
