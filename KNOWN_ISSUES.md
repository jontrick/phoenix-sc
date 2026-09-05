# KNOWN ISSUES — a pattern library, not a bug log

**Every entry here cost a real error. Record THE MECHANISM THAT HID IT, not just the fix.**
The fix is in the commit. What belongs here is why nobody saw it — that is the part that
generalises, and the part that is invisible in a diff.

**SIZE BUDGET: 250 lines.** If an entry no longer describes a live hazard, delete it. A
file of stale warnings trains people to skim it, which costs more than the file saves.

**What goes where — one job per file:**
| file | job |
|---|---|
| `CLAUDE.md` | rules that override the assistant's defaults. Loaded automatically. |
| `COMMS_PROTOCOL.md` | how the chats work together — isolation, gates, ownership, comms |
| `KNOWN_ISSUES.md` | traps in THIS codebase, and what hid each one |
| `OPEN_ITEMS.md` | the single list of open threads |

**A CODE COMMENT IS NOT THE RECORD.** Comment for the next editor of that file; record here
for the next person with the question. Several entries below were written up well, in the
right place in the source, and still cost a full rediscovery because a comment is invisible
to anyone who does not already have that file open.

---

## The one that recurs most: a check that cannot fail

Five distinct instances, all green, all worthless:

- **A needle that matched its own explanatory comment.** The guard could not tell *fixed*
  from *described*. Strip comments before matching.
- **A test reading a variable that does not exist.** `app.__indexSource` was never defined,
  so the loop ran over an empty string and passed unconditionally — in a test written
  specifically to catch a bug that had just been made.
- **An assertion on `document.getElementById(...)` truthiness.** The shared sandbox returns
  a fresh truthy element for ANY id, so it passed for an element never created.
- **A case whose subject left the scope of what it asserted.** "A future day" was computed
  as index 6 of a Monday-start week — which IS today, on a Sunday. One sibling went red;
  the other passed. **Correction (NUTRITION, on review of its own file): the passing one
  was not asserting nothing — it had become an exact DUPLICATE of a test three cases
  below it**, which does the same write on today and asserts the same absence of a tick.
  So the file held one assertion under two names, and the name that claimed to cover
  future days no longer did. **That shape is more dangerous than vacuity:** a vacuous test
  can look odd — no real assertion, an empty fixture — whereas a duplicate exercises real
  code, writes real state, asserts a real property, and never moves the suite count.
  Nothing about the run looks wrong; a guarantee you believe is covered twice is covered
  once. Ask of a decayed case *what is it asserting NOW*, not merely whether it still
  passes.
- **An inversion that never applied.** The fixture's own assertion failed before the edit
  landed, the gate ran against the good file, and printed a tick. **A no-op inversion is
  indistinguishable from a passing guard.** Confirm the file actually changed —
  `git diff --stat` between applying and running.
- **A test helper that could not reach the control.** `dom()` armed the elements a renderer
  CREATES but not the screen body it writes into, so no case could tap anything wired via
  `body.querySelector(...)` — where most controls are wired. Deleting one such handler
  turned nothing red. The markup assertion beside it passed the whole time, which is why
  it read as covered. **Ask what a passing case would still pass on.**

> **A CHECK THAT HAS NEVER FIRED IS UNTESTED, NOT CLEAN.** Break it, watch it go red, and
> confirm it can still go green.

## A verifier built on the assumption it is testing cannot fail

The PM's uniqueness guard skipped computed contexts and printed a confident count that
omitted them. Before fixing it, the PM wrote a scan to check whether any were live. **The
scan reported zero — it tested only whether the argument STARTS with a quote**, so
`'prefix.' + event` passed. The verifier carried the identical defect as the code under
test, returned the answer the author wanted, and had no way to return another.

Standing question: *if the thing I am testing is wrong, would this check be wrong in the
same direction?* If yes it is not a check, it is the same claim twice.

## Not a vacuous pass — a confident wrong answer

Worse than an inert check. A count reads as coverage, so a number that silently omits its
blind spot does not merely fail to inform, it argues against looking further. The guard
above said "all 80 distinct" while two sites were unlisted.

## Three green gates prove parse and top level, never behaviour

`runtime_check.mjs` executes every script block's TOP LEVEL. It does not execute function
bodies. An undefined reference inside a function passes CLEAN (verified by injection).

- A Today-card renderer called `_blabCalEntryView` — the real name has no underscore.
  Runtime clean, harness green, 43 functional tests green, because they tested the helpers
  and never the renderer. **The feature had never once run.**
- A blood panel could save without its photo. Its entire coverage was
  `has('async function pepSaveBloodPanel()')` — presence, not behaviour.

> **Functional tests must invoke the entry point that draws the UI, not only its helpers.**
> "Live" means executed, not present in the file.

## A test pinned to an unverified source makes the error permanent

21 dose→unit pairs were pinned to a PDF and the pin was described as making the app
trustworthy. It held a **half dose of BPC-157** in place from v4.9.236 to v4.9.250 and gave
it a green tick to hide behind. When the default was corrected, the test failed demanding
the wrong value back.

**Pinning is only as good as what you pin TO.** The document records intent; the vial in
the fridge is the fact. Mark confirmed-by-Jon values explicitly so they are never "tidied"
back toward the document.

## A wrong number, published, travels without its cut

The PM reported "24 console-only write paths, 22 mine". The real number was **41**. Two
independent errors: only `console.warn` was searched (`console.error` is equally invisible
on iOS, and that omission hid `supabaseLogSet` — every set Jon logs); and one "hit" was a
peer's explanatory comment. Then the gate's own output was read through `cut -c1-135` and
the visible seven treated as all of them; there were twelve.

**Re-derive counts, never remember them.** Do not read a gate's output through a truncating
pipe and then trust the visible rows.

## A contradiction in a source document produces several confident readers, disagreeing

`CLAUDE.md` asserted **both** "ONE MORE MANUAL REINSTALL IS STILL REQUIRED" and
"AUTO-UPDATE IS CONFIRMED WORKING" — on adjacent lines, the stale one first.

**Two handoffs written weeks apart each copied the stale half out.** Training's caveated
three open bug reports on auto-update being unconfirmed — offering "he may not have the
build" as an out for three reproducible failures. A relayed Nutrition summary carried it as
a **BLOCKING** item that would have sent Jon to delete and reinstall his PWA for no reason.

**Scope, stated honestly:** Nutrition's *canonical* handoff on origin does NOT contain it —
they had already corrected theirs. The stale claim was in a scratchpad summary, which is its
own lesson: the summary and the repo document had diverged, and only the repo one was right.
Neither chat was careless; both read the source and took the first claim.

> **When you supersede a claim, DELETE it.** Leaving it standing above the correction and
> relying on the reader reaching the second half is not a correction — it is a coin flip,
> and it resolves independently for every reader.

A stale handoff is worse than none, because it gets followed. A stale *rules* file is worse
again, because it gets copied into handoffs and then followed at one remove.

## An instrument reports on its proxy, not its subject

- **A version number agreeing is not a record agreeing.**
- **Present is not enforcing.** `sw.js` existed and was ZERO BYTES from v4.9.74 to v4.9.208
  — 135 versions in which no deploy ever reached Jon automatically, while the update
  machinery inside index.html was complete and correct the whole time.
- **A rotated socket is not a dead session**, and a name that answered an hour ago may now
  be a different domain.
- **A negative result confirms a capability only if its absence would have looked
  different.** The blood reader correctly rejecting a non-blood photo looked like proof
  vision worked. It was not: the prompt's rule 6 hands the model that same error string,
  so a model receiving NO image returns it too. Only the positive case settled it.

## The board reads the checkout it runs in, so half of it can be stale

`board_check.mjs` derives CHECKOUTS from git — which is why it correctly said
`nutrition ... BEHIND origin`. But it reads OPEN ITEMS by opening `OPEN_ITEMS.md`
**from the working tree it is run in**. Run from a BEHIND worktree it prints the stale
list, including items closed on origin, and prints it directly under the line saying
you are behind.

2026-09-04, NUTRITION: the session-start ritual says run the board *first*, then pull.
Doing exactly that produced a board asserting an unresolved-merge-conflict item that
had been closed two commits earlier, and I read three closed items as open.

> **The instrument was not wrong — it was answering about the local checkout while I
> read it as answering about the project.** Its CHECKOUTS block was simultaneously
> telling me the answer was stale. Two halves of one output, disagreeing, with nothing
> marking which half to trust.

**Pull, THEN read the board's content sections.** Treat a board printed from a BEHIND
checkout as a report on your own directory, not on the project. Only CHECKOUTS is
meaningful before pulling — which is the one thing you need it for at that moment.

## Silent failure: the console does not exist on the phone

`console.warn` and `console.error` are both invisible in the iOS PWA. A Supabase write that
reports only to the console fails with nothing on screen and nothing in Diagnostic — and
**`alert()` is worse**, because iOS suppresses it, so the failure path runs, shows nothing,
and returns. Twelve such paths looked exactly like a dead button, including onboarding's
"Build my plan" and the Diagnostic's own force-save tool, which reported neither success
nor failure on the one screen that exists to explain failures.

Route failures through `_phxRecordWriteError`; use `_phxNotice`, never `alert()`.

## Collected and never displayed

The write-error ring was written from v4.9.176 and **read by nothing** — the Diagnostic
panel showed a single entry, so any later failure overwrote the one that mattered. Four
domains spent a day designing rationing schemes for slots in a buffer nobody could open.
The comment above the helper claimed the ring kept writers "visible"; it was false when
written.

**Before optimising against a constraint, verify the constraint exists.**

## A shared-plumbing change can break correct code without touching it

Coalescing the ring by context merged two failures Peptides had deliberately split — a 4xx
that RESOLVES and a network REJECT. Their code was right when written. The collision was
harmless until coalescing made it harmful.

Corollary from that fix: **split error contexts by REMEDY, not by which branch produced
them.** Two contexts can be unique as strings and identical in meaning.

## What something CURRENTLY does is a claim to check, never a premise to build on (2026-09-05)

Three times in one day, from three different sources, all in the same shape.

- **Jon's own description was inverted.** He asked for the 04:15 slot to become a choice,
  describing it as "banana on lifting days, nothing otherwise". A thirty-second probe found
  the exact **inverse** — the intra drink already carried that block. He was not careless:
  a drink appears at 04:30 either way, so the screen genuinely reads as he said. **The user
  reports the SYMPTOM accurately and the mechanism from inference.**
- **He asked for two things that already existed.** "Add sushi rice and arborio" — both had
  been selectable for twenty versions. What was missing was the *prep* he described in the
  next clause. Building the stated request would have shipped nothing.
- **A test was measuring a plate nobody eats.** `nutProgDayTotals(d)` with no grain left a
  food called "Rice" on it carrying generic macros; every screen passes a real grain and
  sees 4.7 g more protein. It reported the phase-1 day as on target for as long as it
  existed. **An unused default is not a simplification, it is a second implementation
  with no users and no scrutiny.**

Where a request restates how something works, run it and look. Where it states what he
WANTS, it is binding and needs no checking.

## A step that did not run looks exactly like a step that did (2026-09-05)

Harness guards for v4.9.307 were written, reported as added, and never landed. The shell
step was `grep -c "INVERSION" index.html && python3 <<'PY' ... PY`. The grep correctly
found **zero** matches, zero is exit status **1**, and `&&` stopped the chain. Three
versions shipped with no harness cover for the feature they added.

Two things let it through. The command's own confirmation (`print('guards added')`) never
appeared and I did not miss it, because I was reading the *gate's* output further down —
which was red for unrelated reasons and gave me something else to fix. And `grep -c`
returning 1 on a legitimate zero is a trap in any `&&` chain.

> **Never chain a mutating step behind a `grep`/`test` whose zero-result is normal.** Run
> it on its own line, and read the step's OWN output before the gate's.

Related: twice in the same session a version label went into the build script's `#`
comments instead of the source. The `VERSION` guard failed the build both times — that one
works.

## Encode your own judgement as a NOTE, not as STRUCTURE (2026-09-05)

Asked for per-meal grains, I decided risotto could not be batch-cooked — a defensible call
he had not asked for — and built it as structure: a `to_order` flag, a filter, a second
card shape, a fresh-list branch, three guards and two tests. He batches it. Unwinding took
a whole version; as one line of text on the card his correction would have been a string
edit. **The cost of being wrong is proportional to how deeply you encoded it** — when the
opinion is yours rather than his, take the cheapest representation that still says it.

## A guard can only see the defect it was shaped for

`SAFELIST` checked that every restorable screen resolves to a real navTo target — a
dead-entry check. The live bug was a **MISSING** entry: the writer saved fifteen screens and
the reader restored five, so Stats, Profile and My Coach were recorded on every navigation
and silently refused at boot. **An absent entry looks exactly like a screen nobody wanted
restored.** Fixed by requiring every screen to appear in exactly one of two lists.

## `git checkout <file>` and `git stash` both destroy work here

`git checkout index.html` to undo a scratch edit wiped uncommitted work three times in one
day. **And `git stash` is NOT the safe alternative** — the stash stack is SHARED across the
main checkout and every worktree, and three sessions run concurrently, so a bare pop can
take another session's entry.

**Copy the file aside and restore by copy.** Or make a WIP commit.

### …and its CHECKOUTS half can be wrong too, which breaks the mitigation above

The entry above concludes: *only CHECKOUTS is meaningful before pulling*. **It is not
always meaningful either.** `board_check.mjs` decides BEHIND by comparing APP_VERSION
strings:

`const behind = v !== originVer`, where `v` is the APP_VERSION read out of that
worktree's `index.html`.

So a checkout behind only by commits that never touch `index.html` — every `docs`, `tests`
and `tooling` commit — reports **clean, no marker**.

**2026-09-04, TRAINING, the same hour.** The worktree was 3 commits behind (`ada47d5`,
`cb13c91`, `ea97c43`) — none touching `index.html`, between them changing `OPEN_ITEMS.md`
and `SESSION_START.md`. Both APP_VERSIONs read `4.9.265`, so the board printed
`training  detached  clean`.

**The two compose into something worse than either.** Nutrition was told it was BEHIND
and read the stale list anyway; Training was **not told**, because the only commits it was
missing were the ones that change the record and the rules — precisely the commits whose
staleness matters and the only ones this check cannot see. Two closed items were reported
as live, and `SESSION_START.md` was silently withheld.

**So: fetch before running the board at all** — not "read CHECKOUTS first", since that
half is silently wrong in exactly the case where the content half is stale. Fix logged in
OPEN_ITEMS: count commits behind, rather than compare a version string.

## The main `.git` can vanish and take every worktree with it

2026-09-04: `.git` disappeared from the main checkout. Working files were untouched, but
every worktree's `.git` file points into `.git/worktrees/<name>`, so all three were
orphaned at once and a session refused to resume rather than run without isolation.

Recovery, in order: clone origin to scratch → diff every worktree against it to prove
nothing is unique → copy the clone's `.git` into place → recreate `.git/worktrees/<name>/`
with `gitdir` (bare path to the worktree's `.git` FILE), `commondir` (`../..`) and `HEAD` →
`git worktree repair` → `git reset` in each worktree to rebuild its index.

**This is survivable only because everything is pushed.** That is the whole reason for the
push-after-every-clean-build rule.

## A BLANKET VERSION-LABEL `sed` REWRITES OTHER DOMAINS' HISTORY (2026-09-04)

`harness.mjs` fails a push whose APP_VERSION is not mentioned by any comment. The quick
way to satisfy it is `sed 's/v4.9.OLD/v4.9.NEW/g' index.html` — and that rewrites EVERY
comment carrying the old number, including other domains' and your own from earlier
versions. PEPTIDES did it at v4.9.275 and moved **7 Training comments** off v4.9.272.
Caught by reading `git diff` before committing, not by any gate: the labels stay
syntactically valid, so all four gates pass on a file whose history now lies.

Evidence it is not a one-off: peptide comments written at v4.9.269 were already reading
v4.9.272 before that sed ran — an earlier release did the same thing in the other
direction.

**Do this instead:** relabel only the comment blocks the change actually adds, by their
own text. If a blanket replace is unavoidable, invert it afterwards and re-apply to your
own blocks individually — and check `git diff -U0 index.html | grep '^[-+].*v4\.9\.'`
before staging. A version label is a claim about WHEN something was decided; a gate that
only checks a number is present cannot tell a true one from a laundered one.
