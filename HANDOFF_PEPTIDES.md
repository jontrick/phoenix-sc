# PHOENIX — PEPTIDES DOMAIN HANDOFF
# Rewritten 2026-09-01 at v4.9.263. Supersedes the previous version entirely.
# Read CLAUDE.md first — every rule in it applies here. Then COMMS_PROTOCOL.md.
#
# The previous handoff described "TODAY | PROTOCOL | ORDER" and pointed at line
# ~19100. Neither had been true for weeks. Everything below was verified against
# the shipped file on the day it was written, not recalled — if you are reading
# this more than a few days later, re-derive before relying on any number in it.

---

## 1. WHAT THIS DOMAIN IS

The Peptide Portal: `#screen-peptide`, six tabs, backed by `profiles.peptide_state`
(jsonb) and `localStorage['peptide_v1_{uid}']`.

**Tabs — label vs key.** The key is what persists and restores; the label is
cosmetic and has changed. Do not rename keys.

| key        | label     | what it is |
|------------|-----------|------------|
| `today`    | TODAY     | today's doses, tick / skip / add |
| `overview` | SCHEDULE  | the calendar, and nothing else |
| `stock`    | STOCK     | counts, vial sizes, mix log, import/export |
| `adjust`   | ADJUST    | Protocol info + AI review + bloods |
| `order`    | ORDER     | Tong cart |
| `bloods`   | BLOODS    | blood panels |

`overview` carries the label SCHEDULE since v4.9.263. The key stayed so his
persisted tab and every restore path still resolve.

**Not yours:** `blab*` / WOD (Training), `nut*` (Nutrition), auth and profile
plumbing (PM). A harness guard fails if the peptide block references either
prefix.

---

## 2. STATE SHAPE

`localStorage['peptide_v1_{uid}']`, mirrored to `profiles.peptide_state`.

```
stacks[]           the protocol — one entry per compound
checked{iso:[id]}  doses ticked
skipped{iso:[id]}  doses DELIBERATELY declined  (v4.9.259)
extra{iso:[{compoundId,dose,at}]}  doses added by hand  (v4.9.260)
phases[]           phases he built in the app     (v4.9.258)
activePhase        id of the phase last applied
historyConfirmed   readiness gate, half 2
bloods[]           blood panels — NEVER mirrored to the cloud
notes[] cart[] advice settings
```

### Stack fields

Scheduling — `_pepStackDueOn` reads these, in this precedence:

```
dates[]        explicit ISO dates. If present these ARE the schedule.
endDate        no doses after it, whatever the rule says
periods[]      [{from,to}] several active windows for ONE compound
intervalDays   every N days from startDate (Reta = 6, rotates the week)
freq           string, see below
cycleWeeks / offWeeks / continuous
```

`freq` understands: `daily`, `eod`, `weekly`, `2x/week`, `3x/week`,
`mon/wed/fri`, `wed`+`sat`, `6 day` (Monday off), `every 5 day`,
`20 consecutive nights`, `10 day`, `as needed`, and any single weekday name
(`mon`, `tue`…) — the last added v4.9.263 for TB-500 Monday-only.

Dosing and stock:

```
dose            flat dose
doseSteps[]     [{fromDay,dose}] titration; last step reached wins  (v4.9.257)
vialMg waterMl  the PLAN's reconstitution
actualVialMg    override for a differently-sized vial received
openVialMg openWaterMl  what he ACTUALLY mixed into the open vial  (v4.9.256)
openedDate      when, for shelf life
openUsedAmt     amount drawn from the open vial, in mg (or units)   (v4.9.249)
openDosesUsed   legacy count, kept for the edit sheet only
sealedVials, onOrder, arrivalDate, onOrderVials, onOrderVialMg
stockCounted    he has physically counted this one
status          instock | pipeline | onorder | complete
```

---

## 3. THREE INVARIANTS THAT COST REAL DOSES WHEN BROKEN

Each of these was a shipped bug. They are not style preferences.

**1. Consumption is MEASURED, not counted.** `openUsedAmt` holds the amount
drawn. A count of doses is only meaningful beside the dose it was counted at, so
counting them means a titration silently rewrites history — three 50mg doses
became "300mg used" the moment he stepped to 100mg. Fixed v4.9.249.

**2. The open vial is a fact; the plan is an intention.** `_pepLiveRecon` returns
the mixed vial when one is open, the plan otherwise. Editing the plan must not
restate the strength of a vial already dissolved. Fixed v4.9.256.

**3. A guessed vial size must never look like a measured one.** `_pepRecon`
returns `source`; `_pepReconAssumed` flags a library default; every display
marks it. Six wrong defaults were dangerous rather than merely wrong because
nothing said the number rested on an assumption. Fixed v4.9.245 / .250.

---

## 4. WHAT THE APP DOES NOW (all shipped, all tested)

- **Phase library** — Phase 2 lives in `_PEP_PHASES` as code. `pepApplyPhase()`
  installs it in one tap; `pepSavePhase()` keeps the current protocol as a new
  phase. Both go through `_pepValidateImport`, so there is ONE gate and no way in
  that skips it.
- **Titration** — `_pepDoseOn(stack,c,dayNum)`. Today and the calendar announce
  the change on the first DOSING day at or after the step, not its calendar day.
- **Make-up log** — `pepLogMakeUp()` records vial + water actually used.
- **Skip** — `pepSkipDose()`. A skipped day leaves the adherence DENOMINATOR; it
  is not a miss.
- **Add a dose** — `pepAddExtraDose()` on TODAY and on the main-screen tile.
  Appears with its draw-up, ticks, and comes out of the vial. Undo returns stock.
- **Compound panels** — ADJUST → tap a compound → make-up, dose, draw, doses per
  vial, editable vial and water. Editing maps through everything because one
  compound is one stack.
- **Calendar** — SCHEDULE, day by day, compounds with dose AND units.

---

## 5. WHERE THE GATE IS AND WHY IT MOVED

`_pepGateCard` lives on **ADJUST**, with the forecast it protects. SCHEDULE is
never gated.

The line is what a thing CLAIMS. A forecast asserts he has stock and needs the
count to be true. A calendar states the plan — true whether or not anything is
counted, and the thing he reads to know what to count. Gating it inverted the
dependency and made the calendar unreachable the moment he applied a phase
(applying clears `historyConfirmed`, correctly). Fixed v4.9.262.

---

## 6. OPEN — NOT DONE, NEEDS JON

1. **Five vial sizes unconfirmed.** Ipamorelin, TA-1, GHK-Cu, NAD+, TB-500 are
   still PDF-derived. That document has been **wrong twice** (RT30 "+5mL" the
   vial cannot hold; BPC-157 1mL when he uses 2mL — which shipped a HALF DOSE
   from .236 to .250). Do not "correct" a value marked CONFIRMED BY JON back
   toward the document.
2. **Photo scanner untested on a real report.** Vision passthrough is proven
   (PM, against the live worker). His end is not. Real panel due ~week of 8 Sep.
3. **Stock counts likely read high.** Until .261 the main Today tile ticked doses
   without decrementing. Tell him to physically recount.
4. **Blood data leaves by two doors.** `_pepCloudPayload` strips bloods from the
   Supabase mirror; `_pepBuildContext` sends `latest_bloods` and
   `pepExtractMarkers` sends the PHOTO to the coach worker, whose source is not
   in this repo. **Neither is a bug** — both are features he asked for. He was
   told and has not objected. The egress is pinned at 2 worker calls and 9
   context fields; adding either fails the harness deliberately.

---

## 7. TRAPS — EVERY ONE OF THESE COST A REAL BUG TODAY

- **A pin whose LABEL claims behaviour is redundant or lying.** A pin can only
  assert text exists. Found three: `_pepGetDoses` "is date-parameterised",
  `_pepAdherence` "14-day", the mirror's "inspects res" — all zero coverage.
- **Narrowing a needle is not a safe refactor.** It can remove protection
  somewhere else. My own sweep of 18 pins stripped the `_pepAdherence` guard.
- **A negative that cannot fail early asserts nothing.** `read(x) || {}` turns
  absent into empty, and empty satisfies every "does not contain". My pathology
  assertion passed whether or not the scrub worked. Put a POSITIVE control first.
- **A probe that fails to match reports "nothing wrong" in the same words as a
  probe that worked.** Three false cleans today. Feed the probe a known-bad case.
- **Fix the second instance, leave the first.** Four times. Proximity does not
  help — mine were two lines apart.
- **A test helper that ignores its caller reads exactly like a product bug.**
- **`git checkout <file>` destroyed uncommitted work three times.** Copy aside.
  Never `git stash` — the stack is shared across worktrees.

---

## 8. GATES

```
node runtime_check.mjs      every block parses and its top level runs
node harness.mjs            source assertions
node functional_check.mjs   calls the real functions, 4 domains
node version_check.mjs      reads the STAGED file, not the working tree
```

Deliberately no assertion counts here. I wrote them, and they were stale within
the minute — another domain pushed while this file was being saved. A number
that decays that fast is a thing you check, not a thing you record.

All four, unpiped, before every push. `version_check` compares against
origin/main and refuses a collision — three domains ship concurrently and the
number moves under you.

---

*Verified against origin/main at v4.9.263, 2026-09-01. Peptides domain.*
