# OPEN ITEMS — ARCHIVE

Resolved threads moved out of `OPEN_ITEMS.md` so that file stays readable. **Nothing here
is open.** Kept because the closing evidence is sometimes the useful part — what proved a
thing fixed, and what the fix cost.

Archived 2026-11-22 by the PM at Jon's request. `OPEN_ITEMS.md` was 925 lines against its
own 300-line budget.

**Do not work from this file.** The live list is `OPEN_ITEMS.md`.

---

- [x] **PM RULING, 22 Nov: LEAVE THE PULLS WHERE THEY ARE.** Do not move `fbSyncOnOpen`
      into `window._phxOnProfileFetched`. `renderTodayScreen` already runs on every open and
      the visibilitychange listener covers resume, so the hook would be a third trigger
      closing no gap — and it is the one piece of boot plumbing all four domains chain
      through. Declining was the right call. Revisit only if a pull is ever shown to be
      missed on a cold start.
- [x] **DONE v4.9.350** (Jon's ruling: always confirm). "Made up" always opens the sheet,
      prefilled from the open vial; "Correct the vial already open" (`pepCorrectOpenVial`)
      fixes a wrong volume without touching stock; Protocol / Stock / panel / coach context
      now draw from `_pepLiveRecon`. Edit-sheet water relabelled "for new vials".
      Original finding: **Two water figures, and screens disagree.** "Made up today" one-tap stamps the PLAN
      volume (2 mL) as the mixed vial. Correcting water in the edit sheet changes only the
      PLAN. Result: TODAY (`_pepLiveRecon`) says 10 u, while PROTOCOL / STOCK / compound
      panel / coach context (`_pepRecon`, plan) say 5 u. Only "log make-up" with 1 mL makes
      them agree. Plan-recon callers: _pepTabProtocol, _pepPanelCompounds, _pepTabStock,
      _pepBuildContext, _pepDosesPerVial, pepMarkMadeUpToday.
- [x] **DONE v4.9.351** — TODAY tab ‹ › steps back up to 7 days (`pepShiftDay`, `_pepViewISO`); tick and skip take a date; add-dose and make-up stay today-only; the view resets at midnight; the main-screen tile still ticks today. Original finding: **No previous day.** `_pepTabToday` and `pepToggleDose` are hard-wired to `_pepToday()`,
      though state (`checked{iso}`, `skipped{iso}`) and `_pepGetDoses(ps, date)` already
      take a date. A missed tick cannot be fixed.
- [x] **ADDED v4.9.352 (Jon's request)** — "Tonight · prep for tomorrow AM" on TODAY and the
      main tile: tomorrow's morning + any-time doses with draw-ups, a "prepped" tick
      (`ps.prepped[iso]`, consumes nothing), and "prepped last night" shown next morning.
- [x] **DONE v4.9.353** — 3 tabs: TODAY · MY PEPTIDES (card per compound: dose, schedule,
      next due, draw, doses left in the open vial, sealed, Made up / Edit) · MORE (list to
      the five detail screens, which keep their keys and show "‹ More"). Six-tab pins in
      harness + tests replaced with three-tab + reachable-from-MORE checks.
- [x] **RLS GATE PASSED, 2026-11-10.** All 8 tables have RLS enabled, and every SELECT/ALL
      policy is scoped `auth.uid() = user_id` (`profiles` uses `auth.uid() = id`). The three
      null `using_expression` rows are INSERT policies, which use `WITH CHECK` not `USING` —
      a blank USING there is correct, not a hole. **The database has at least three users
      and they cannot see each other's rows.** Cleared to share the anon key.
- [x] **The mechanism works, verified against live data:** `2026-11-10 | trained true |
      Upper — Max Effort | 22 sets | weighed_in true | 111.4 | kcal null`. Authoritative
      file `supabase/sql/2026-11-10d_accountability_day.sql`.
      Four corrections to get there: a `sessions.session_id` column that does not exist, a
      UTC day spine that deleted the current Brisbane day until 10:00 local, `auth.uid()`
      being NULL in the SQL Editor (so it tested empty while the data was present), and a
      caller filter added as defence in depth.
- [x] **v4.9.410 — Today card lists today's planned feeds with a tick** (Jon 14 Nov: "show on the
      today page - so can tick off from there"). Same `eaten` flag as the Plan tab; only feeds with
      food are listed; the header / numbers still open Nutrition. Test: nut2 TODAYFEEDS.
- [x] **v4.9.411 — "each" amounts** (Jon: "may just check 3 [eggs] in a recipe with no weight? Can
      this be each or g option?"). Items are {ref,g} or {ref,n}; `_nut2ItemG` is the ONE place grams
      are derived (recipes, plan, shop, copy). Size = his `ns.v2.unitG[ref]` else a default (egg 50 g,
      AU large edible) else null → 0 g and save refuses — never guessed. g ⇄ each button on foods
      (not recipes), "1 each = [50] g" editable. Tests: nut2 EACH ×4.
- [x] **v4.9.412** — recipe "Finished weight / weigh the pot" relabelled "Cooked weight of the batch (g) ·
      food only, no pot" (Jon asked what it meant). Method box font fixed.
- [x] **v4.9.413 — on-phone label reading** (Jon chose this over an AI service). Add Food: SCAN LABEL
      (camera) / FROM A PHOTO. Tesseract.js 5.1.1 + eng data lazy-loaded from jsdelivr (~10 MB first
      use, cached in IndexedDB by Tesseract). `_nut2ParseNIP`: last non-% number = per 100 g; g-read-as-9
      repair; kJ÷4.184 unless Cal shown; Atwater cross-check warns. Boxes filled, NEVER auto-saved.
      Proven on 4 rendered panels incl. a blurred/rotated JPEG + in-app end to end. **Unproven: real
      iPhone photos and Safari WASM speed** — first real label is the test. Tests: nut2 NIP ×3.
- [x] **v4.9.414 — + NEW FOOD inside the meal / recipe picker** (Jon: "can these functions work on the
      meal planner area"). Opens Add Food (scan / photo / type, name prefilled from the search);
      `nut2OpenAddFood(…, onSaved)` saves to the library AND hands the id back to the meal / recipe.
      Browser-proven both paths. Test: nut2 PICKNEW.
      **v4.9.414 was pushed with PICKNEW red** (the test's DOM stub lacked querySelectorAll; app code
      fine — browser-proven). My push command did not gate on the functional check. Fixed in v4.9.415;
      pushes are now chained `gates && push`.
- [x] **v4.9.416 — IMPORT FILE (CSV) in the Library.** Headings found by word in any order (name / kcal
      or kJ / protein / carbs-not-sugars / fat-not-saturated / fibre); comma, semicolon or tab;
      quoted names; preview with per-row skip reasons; same-name food UPDATED (cooked link kept), never
      duplicated. An image picked here goes to Add Food. Tests: nut2 CSV ×4. Browser-proven.
- [x] **v4.9.417 — Open Food Facts link / barcode in Add Food.** Paste an OFF link or barcode, or SCAN
      BARCODE (photo of the printed digits → Tesseract → EAN/UPC check digit must pass — iOS Safari
      has no BarcodeDetector). `world.openfoodfacts.org/api/v2/product/<code>.json`, per-100 g fields,
      kJ fallback. **Unverified from here: the live API response and its CORS on his phone** (sandbox
      cannot reach OFF; browser test used a stand-in). Failure says so — never fills wrong numbers.
      Woolworths links show "needs a one-time server set-up" until task #28 lands. Tests: nut2 OFF ×3.
- [x] **v4.9.419 — Nutrition / Peptides no longer revert to Today after the phone sleeps.** Cause: the
      boot restore fired on a FIXED 450 ms, started before `getSession()`. A waking phone refreshing its
      token is slower → restore ran first, boot mode ended, the app's own navTo('today') then counted as
      his choice and wiped `phx_lastTab_v1`. Reproduced (real boot path, getSession delayed 1.5 s → Today,
      key null). Now waits for boot routing to reach Today (intercept sets `_phxBootRouted`), 30 s cap,
      never restores without a session. Proven at 0 / 1.5 / 4 / 9 s (×2 — boot checks the session twice)
      for nutrition + peptide; Today stays Today. Harness: BOOTWAIT.
- [x] **v4.9.420 — screen stays on in Nutrition and Peptides.** The global wake lock was asked for once
      at load (no gesture — iOS may refuse) and on visibility; session ends released it and nothing
      re-asked. Now asked on arrival and on every tap there. Browser-proven with a counting stub
      (headless Chromium always refuses the real API). **On his iPhone it only works if iOS grants it**
      — Settings → Diagnostic shows "screen wake lock: held / REFUSED / UNSUPPORTED". Harness: AWAKE.
- [x] **v4.9.421 — a food with a serve size counts by the serve** (Jon: Helga's wraps "saved as per serve /
      1 wrap but wants g?" — it showed 0 kcal: added by grams with an empty box). `nut2UnitG` now uses the
      food's `serving_g`; meals and recipes add such foods as {n:1}; g ⇄ each converts; an empty gram box
      switched to each starts at 1. Test: nut2 SERVE.
- [x] **v4.9.422 — barcode photos decode the BARS (ZXing 0.21.3, lazy from jsdelivr).** Jon: the photo
      "kept coming up not being able to read". Reading the printed digits with Tesseract failed on a
      pack-style photo AND, turned sideways, produced digit soup that passed the check digit by chance
      (could look up the WRONG product). Now ZXing (TRY_HARDER, EAN/UPC) on the photo and turned ±90°;
      fallback reads the printed number ONLY in its 1+6+6 layout. Browser: a real EAN-13 on a tilted,
      blurred JPEG pack shot decodes in 0.14 s at every rotation; 0 false codes across all junk images.
      Tiny / heavily blurred barcodes still fail → message tells him to fill the frame. Test: nut2 BARCODE.
- [x] **v4.9.423 — targets he can change** (Plan → counter → CHANGE). Modes: Phoenix cut (unchanged
      default); Muscle-sparing cut after Helms, Aragon & Fitschen 2014 (protein 2.7 g/kg lean mass with a
      body-fat %, else 2.2 g/kg BW; fat 25% kcal; carbs rest; same 18.5 kcal/kg); his own numbers (no
      weigh-in needed). Optional training-day carbs from the calendar (+train on a session day, −rest on
      none; skipped ≠ training; no calendar → no change). Mirror + Today use the date's target.
      `ns.v2.targets`. Tests: nut2 TARGETS ×3. Browser-proven.
      Training-day detection goes through `blabTrainingStateOn` (harness CONTRACT refused a direct blabCalGet).
- [x] **v4.9.424 — scale a recipe** ("make [N] serves" / "× the batch" → SCALE). Every amount (g and each),
      cooked weight and serves move together; per-serve / per-100 g unchanged. Test: nut2 SCALE.
- [x] **v4.9.427 — P / C / F per meal** on the Plan tab (under each meal, live as he types grams) and the
      Today card (each meal + the day's eaten P/C/F against target). Test: nut2 MEALMACROS.
- [x] **v4.9.406 — FIXED (1 of 2).** `reloadOnce` now waits, uncapped, while `_phxSessionOpen()` (lib
      timer, conditioning, count-in, rest overlay, session screen, BLAB workout overlay, running lib
      tick; unknown → open). No update banner over a live session. Browser-proven: SW_UPDATED
      mid-session → 0 reloads, applied on leaving; guard removed → reload. Harness: SWRELOAD.
      **Still open (2): timer start stamp is memory-only — if iOS kills the app mid-timer the
      time is lost.** Needs a resume flow (ticked movements + start stamp), not built.
- [x] **Checked 12 Nov:** run never executed (still `queued` 35 h later); v4.9.402–406 deployed after it.
- [x] **Shipped v4.9.404** (see HANDOFF_TRAINING) — programme sessions + conditioning + lib timers.
- [x] **NUTRITION — DONE v4.9.328.** No write control drawn off today; guard inside
      `_nutProgTodayCard` so all three callers get it. The trap it surfaced — a handler
      that hardcodes `_nutToday()` — is written up in `KNOWN_ISSUES.md`; **worth ten
      minutes for TRAINING and PEPTIDES, whose Today surfaces have the same shape.**
- [x] TRAINING — Two disagreeing week numbers on Today. **DONE v4.9.301** (60deb54).
      **Lesson:** they were never two derivations of one week — `athlete.currentWeek`
      counts the AI programme and never moves on a BLAB account, `progWeek()` counts
      calendar weeks. Three counters, three questions, one place that decides.
- [x] Auto-update after the zero-byte `sw.js` — **CONFIRMED WORKING** v4.9.252. Jon
      confirmed the version moves on its own; closed a claim unverified since v4.9.208.
- [x] **v4.9.265 SHIPPED** — `9ef505b`. **Lesson kept:** I reported the push failure as
      "GitHub unreachable (DNS)". The DNS failures were real, but the LATER ones were a
      plain non-fast-forward — origin had moved. Two causes wearing one symptom, and I
      named the first for both. Read the actual error text.
- [x] Coach-worker vision passthrough — **VERIFIED** 2026-08-22, synthetic report with
      unguessable values, all four returned exactly.
- [x] **DONE 2026-11-10 — the SQL is applied and the integration is VERIFIED LIVE.**
      This item named a file that has since been superseded (and in one case deleted).
      Authoritative file: `supabase/sql/2026-11-10d_accountability_day.sql`. Proof:
      `2026-11-10 | trained true | Upper — Max Effort | 22 sets | weighed_in true |
      111.4 | kcal null`, read back from `accountability_day`. RLS confirmed on all 8
      tables with per-user policies. **An open item pointing at a deleted file is
      worse than no item — it sends the reader to a dead end.**
- [x] **DONE 2026-11-10 — the SQL is applied and the integration is VERIFIED LIVE.**
      This item named a file that has since been superseded (and in one case deleted).
      Authoritative file: `supabase/sql/2026-11-10d_accountability_day.sql`. Proof:
      `2026-11-10 | trained true | Upper — Max Effort | 22 sets | weighed_in true |
      111.4 | kcal null`, read back from `accountability_day`. RLS confirmed on all 8
      tables with per-user policies. **An open item pointing at a deleted file is
      worse than no item — it sends the reader to a dead end.**
