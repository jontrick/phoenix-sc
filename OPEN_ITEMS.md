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

- [ ] JON — Wake lock: does the screen still sleep on v4.9.264? Settings → Diagnostic now
      prints `screen wake lock` as `held` / `REFUSED: …` / `UNSUPPORTED`. Closes when he
      reports the line. Note: iOS Low Power Mode disables wake locks outright.
- [ ] JON — Peptide stock figures. PEPTIDES is blocked on these; it has no DB access and
      localStorage is on his phone, so Import/Export (v4.9.252) is the only route in.
- [ ] JON — Reconstitution: only `bpc157` is marked CONFIRMED BY JON. The other 16 entries
      in `_PEP_RECON` are transcribed from Peptide_Protocol_2026_27.pdf and unconfirmed
      against a real vial. Two have already been wrong in opposite directions. Closes
      compound-by-compound as he checks labels; each one confirmed should be marked in
      the source the way bpc157 is.
- [ ] JON — Should a live WALK and the WEEKLY CHECK-IN be restored after a screen lock?
      Both are deliberately in `_neverRestoreTabs` (v4.9.264) — a walk would imply one is
      running, and the check-in form reloads EMPTY so returning to it invites a second
      submission. His call; PM will wire either properly if he wants it.

## OPEN — REPO / TOOLING

- [ ] **URGENT — v4.9.265 IS COMMITTED AND UNPUSHED. GitHub was unreachable (DNS) at the
      moment of pushing.** Training's superset-history fix — Jon's THIRD report of the same
      bug. Rebase resolved by the PM, all four gates green (runtime 6/6 100%, harness 748/0,
      functional 750/750, version clean). Commit `3ddc2f2` in `.claude/worktrees/training`,
      HEAD of that worktree, working tree clean. **Nothing is lost; it just is not on
      origin.** To finish when the network is back:
      `cd ~/Desktop/phoenix-sc/.claude/worktrees/training && git push origin HEAD:main`
      Pre-resolution copies of all four files are in the PM session scratchpad — treat those
      as gone; the commit is the artefact.

- [ ] ??? — The `training` worktree has UNRESOLVED MERGE CONFLICTS (`UU` on harness.mjs,
      index.html, sw.js), found by board_check on 2026-09-04. Either a live TRAINING
      session is mid-rebase, or one died in one. NOT touched — it may be live work.
      Whoever owns that session: finish or abort the rebase. Closes when the worktree is
      clean.
- [ ] ??? — `peptides` worktree was on 4.9.263 while origin was 4.9.264. Stale checkouts
      are how one chat ships another's old code. Closes when it pulls.
      (`nutrition` was on 4.9.254; it pulled and is on 4.9.264 as of 2026-09-04.)
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
- [x] Coach-worker vision passthrough — **VERIFIED**, 2026-08-22, by posting a synthetic
      report with unguessable values and getting all four back exactly.
