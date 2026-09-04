# TRAINING → CENTRAL PM — HANDOFF

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
