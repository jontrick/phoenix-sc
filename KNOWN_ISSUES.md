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
  the other passed while asserting nothing at all.
- **An inversion that never applied.** The fixture's own assertion failed before the edit
  landed, the gate ran against the good file, and printed a tick. **A no-op inversion is
  indistinguishable from a passing guard.** Confirm the file actually changed —
  `git diff --stat` between applying and running.

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
