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

## WAITING ON JON

- [ ] JON — **Upper 2, morning session of 2026-09-05.** Six Training fixes land together
      and NONE has been used by him yet. All are verified by gates only, and three fixes
      this week passed clean gates while still being broken for him — each time the tests
      covered the piece just written rather than the route he takes. So this session is
      the only real check. Live on v4.9.276, confirmed serving.
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
      verified 2026-08-22; the scanner is manual-first and works without it. The design
      decision is already recorded in HANDOFF_NUTRITION: the call sends THE IMAGE AND
      NOTHING ELSE, and extraction fills fields in rather than bypassing the basis rule
      or the confirm step. `harness.mjs` `LABEL/EXIT` FAILS the moment a network call is
      added, so whoever builds it must declare the payload there. Closes when built, or
      when Jon says he does not want it.

## OPEN — CROSS-DOMAIN

- [ ] TRAINING — Today header shows two week numbers that disagree ("WEEK 1" top right
      vs "Week 3" on the session card), and Jon wants the NUTRITION week shown beside
      the training one. The header is Training's; the nutrition half is ready to use.
      **Call `nutProgWeekLabel()`** &mdash; do NOT derive a week from the start date.
      Returns `'CUT · TRIAL'`, `'CUT W1'`&hellip;`'CUT W15'`, or **`null` meaning omit**.
      Week 0 is the rehearsal and sits outside the count of fifteen, so any independent
      formula gets it wrong plausibly. Contract and meanings in HANDOFF_NUTRITION under
      "API other domains may call"; pinned in tests/nutrition.mjs under
      `CONTRACT nutProgWeekLabel`. Nutrition could not message Training this session
      (no peer messaging available) &mdash; Jon is relaying. Closes when the header shows
      both weeks distinguishably.



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
