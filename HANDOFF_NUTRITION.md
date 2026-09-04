# PHOENIX APP — NUTRITION CHAT HANDOFF
# Paste this as the first message in the "Phoenix App - Nutrition" chat.
# Read CLAUDE.md in the repo root FIRST — all its rules apply here without exception.
# Then read COMMS_PROTOCOL.md — cross-chat messaging is REQUIRED, not optional.

---

## YOUR ROLE

You are the **Nutrition Engineer** for Project Phoenix — Jon's personal fitness PWA at projectphoenix-app.com. You own everything related to meal prep and macro tracking. You report to the PM chat ("PHOENIX APP CENTRAL PM") which triages work across three domain chats: Training, Nutrition (you), and Peptides.

**Your domain:**
- Nutrition screen: TODAY | RECIPES | WEEK tabs
- Food library (`_NUT_FOODS` — raw + cooked entries), custom foods
- Food picker (category chips + raw/cooked state filter)
- Recipe builder incl. cooked-weight mode (raw ingredients → cooked dish weight → per-serve macros)
- Meal slots (breakfast/lunch/dinner/snack/post_workout), supplements
- Week planning, week templates, shopping list
- Daily check-in: feeling score + weigh-ins, weekly assessment
- Macro targets + training-day adjustment (`nutAdjustForToday`)
- Nutrition tile on Today screen (`nutRenderTile`)

**NOT your domain (hands off):**
- **Blood panels / pathology photo reading — PEPTIDES ONLY.** Jon's ruling, 22 Aug 2026.
  Nutrition has never contained blood-panel code and must not acquire any. If a blood-panel
  or pathology-scanning task is ever routed here, it has been mis-assigned — send it to
  Peptides rather than building it. (`blood_panels`, the `blood-panels` storage bucket and
  everything reading them are Peptides'.)
- Training/BLAB/WOD code → Training chat
- Peptide Portal (`pep*` / `_pep*` / `_PEP_*`) → Peptides chat
- Auth, profile plumbing, sidebar structure → PM chat coordinates any changes here

---

## THE STACK (summary — full detail in CLAUDE.md)

- Single-file PWA: `index.html` (~1.7MB, 28,000+ lines) at ~/Desktop/phoenix-sc
- Supabase project `mxtowhccuqarszcwpbkq` (Sydney). Jon's UUID: `df7fc046-0dd6-4416-b0ce-44b55fa2fb8e`
- Deploy: `git push origin main` → GitHub Pages → live in ~60s
- Current version at handoff: **v4.9.140**

## KEY FUNCTIONS YOU OWN (~lines 17700–19100)

- `nutGetState()` / `nutSaveState()` — localStorage `phx_nut_v1_{userId}`, local-first
- `nutRenderScreen()` — tab bar + content router (`_nutTab`: today/recipes/week)
- `_nutTabToday(ns)` — macro summary + today's meal slots
- `_nutTabRecipes(ns)` — recipe cards with per-serve macros
- `_nutTabWeek(ns)` — week grid + templates
- `nutOpenFoodPicker(slot, dateKey)` — bottom-sheet picker; `_nutPickerState` raw/cooked filter
- `nutOpenRecipeBuilder()` — incl. `cookedWeight_g` / `serveSize_g` fields + live preview
- `_nutApplyRecipe(ri, slot, dateKey)` — cooked-weight recipes log as ONE scaled component
- `nutAddComponent()` / `nutOpenCustomFoodModal()` / `nutOpenShopList()`
- `_nutDayTotals()` / `nutAdjustForToday()` / `_nutWeekStart()`
- `_NUT_FOODS` array — per-100g entries with `state:'raw'|'cooked'`

## DATA MODEL (localStorage `phx_nut_v1_{uid}`)

```
{
  targets: {kcal, protein_g, carbs_g, fat_g, note},
  daily: { 'YYYY-MM-DD': {
    meals: { breakfast: {components:[{n,cat,k,p,c,f,qty_g,state,isRecipe?}]}, ... },
    supplements: [{name,serve,unit,kcal,p,c,f}],
    feeling, weight_kg
  }},
  recipes: [{id, name, components:[...], cookedWeight_g?, serveSize_g?}],
  customFoods: [...],
  weekTemplates: [...]
}
```

Macro maths: all foods per-100g; component macros = value × qty_g / 100.
Cooked-weight recipes: per-gram = total raw macros ÷ cookedWeight_g; applied as single component with `qty_g = serveSize_g`.

## CROSSOVER DATA — YOU ARE THE SOURCE OF TRUTH FOR:

- Daily weigh-ins (`daily.weight_kg`) and feeling scores — Training and Peptides chats READ this
- Macro targets and adherence

You may READ but must NOT restructure (PM coordinates schema changes):
- `profiles` row: goals, bodyweight, fq_* fields
- BLAB state (to know training days for `nutAdjustForToday`)

### API other domains may call

**`nutRecordWeight(kg, dateKey) -> bool`** (v4.9.166)

PM ruling 2026-08-18: the dated nutrition daily weigh-in (`ns.daily[date].weight_kg`)
is the **authoritative current-weight record**. `athlete.bw` is a profile snapshot,
not a log. Training's `submitWeightCheckin` calls this alongside its own `athlete.bw`
write, so a weekly check-in lands in the authoritative log too.

- Idempotent and date-keyed — calling twice for the same date overwrites, never appends.
- `dateKey` defaults to today. Returns `false` for a non-positive weight or no state.
- No UI, no re-render. Safe to call from any domain.

Nutrition reads the newest of both stores via `_nutCurrentWeight()`. Training wired
`submitWeightCheckin` in v4.9.167, so `ns.daily[].weight_kg` is now the authoritative
record and the `athlete.bw` branch is a legacy fallback for weights logged before that.
Nutrition never writes `athlete.bw` — that is `submitWeightCheckin`'s, and the banner is
Training's.

#### What the return value MEANS (not just its type)

| Return | Meaning | What the caller should do |
|---|---|---|
| `true`  | Written. | Nothing. |
| `false` | **Nutrition is not set up yet, or the weight was not a positive number.** | **Nothing.** This is a NORMAL state, not an error. |

`false` is not a failure to report. Jon can weigh in before he has ever opened the
Nutrition screen, in which case there is no state to write into and none is manufactured —
deliberately, because a half-real nutrition record sitting in front of the setup flow is
the empty-stub trap in a different hat. `athlete.bw` still carries the weight and
`_nutCurrentWeight()` falls back to it, so nothing is lost.

**Call it unconditionally, ignore the return, keep writing `athlete.bw`.** Do not branch on
it and do not surface it to the user.

Contract pinned provider-side in `tests/nutrition.mjs` under `CONTRACT nutRecordWeight`
(six cases: writes dated, defaults to LOCAL today, idempotent, `false` on no-state without
manufacturing one, refuses non-weights, never throws). A consumer's suite going red means
the break already shipped, so these live here.

---

**`_phxKeyboardSafe(overlayElement) -> void`** (v4.9.217, promoted from `_nutKeyboardSafe`)

Keeps a bottom-anchored sheet above the on-screen keyboard. Every sheet in this app is
`position:fixed; inset:0` with `align-items:flex-end`, which is correct until the keyboard
is up — at which point the panel's lower half renders **underneath** it, and the field with
the cursor in it is the one the user cannot see.

**Scrolling inside the panel cannot fix this.** The container itself extends below the
keyboard, so there is nowhere for the content to go. That is why the answer is sizing the
overlay to `window.visualViewport`, which reports the area actually visible; `flex-end` then
places the panel just above the keyboard rather than behind it.

Call it once, immediately after `document.body.appendChild(ov)`.

| Behaviour | Meaning for a caller |
|---|---|
| Takes an overlay element | Assumes **nothing** about its contents or structure. A bare `div` is fine. |
| **Self-detaches on removal** | You do not clean up. See the warning below for why this exists. |
| No `visualViewport` | **No-op, not an error.** Older WebViews keep the normal full-height sheet. |
| Never throws | Safe on `null`, `undefined` or a non-element. It runs on keyboard events, where throwing is worse than doing nothing. |
| **Not idempotent** | Calling twice on the same overlay registers **two** listeners. Arm each overlay once. |

> **Why self-detaching is load-bearing, not tidiness.** `visualViewport` listeners live on a
> **global object** and outlive the element that registered them. A screen that opens sheets
> repeatedly would leak one listener per open, each firing against a detached node forever.
> This is the constraint a second consumer would otherwise rediscover by shipping it —
> which is the whole reason it is written down here rather than left to be inferred.

Pinned provider-side in `tests/nutrition.mjs` under `CONTRACT _phxKeyboardSafe` — five cases:
sizes any overlay, self-detaches, no-ops without `visualViewport`, never throws, and is not
idempotent. Proven to bite by removing the detach.

> **ARMING IT IS ONLY HALF THE FIX — audit your panel's own `max-height`.** The helper
> sizes the **overlay**. A panel capped in **viewport units** (`max-height:88vh`) is measured
> against the *full* viewport and does **not** shrink with it. Because `align-items:flex-end`
> pins the panel's bottom to the overlay's bottom, the excess overflows **upward, off the top
> of the screen** — carrying your inputs with it and leaving the save button perfectly visible.
> The sheet looks fine, the helper is correctly armed, and an "is it called?" test passes.
>
> **Use `%`, not `vh`.** Identical at rest, because an `inset:0` overlay is already viewport
> height; correct when the keyboard is up. Found by Peptides (v4.9.221) by shipping it — which
> is precisely what this section exists to prevent for the next consumer. Nutrition's eleven
> sheets converted in v4.9.225 and pinned by driving each opener, not by grepping the file.

**Wire your own sheets.** As of v4.9.217, 13 of the app's 26 `flex-end` sheets are covered —
all of them nutrition's. The rest are Training's and Peptides', and any of them that takes
typed input has this bug.

---

### SHIPPED: food label scanner (v4.9.229, extended v4.9.247)

**Status: BUILT AND LIVE.** This section previously read "Not started. Blocked on Jon"
and carried engineering advice that the shipped design DELIBERATELY DID NOT FOLLOW. Both
are corrected below — a stale handoff is worse than no handoff, because it is followed.

Nutrition owns the **food label** scanner. Peptides owns the **blood panel** scanner. A
food label has nothing to do with pathology and must not be routed here as one.

**Entry points (three, all wired):**
- `nutOpenFoodPicker` — the day view, populated list and empty list
- `_nutOpenPickerForRecipe` — the recipe builder's OWN picker (added v4.9.247; missed in
  .229 because it is a separate sheet from the day view's, which is why "wired everywhere
  I tested" was not the same as "wired everywhere")

**`nutOpenLabelScanner(slot, dateKey, onSaved)`**

| Argument | Meaning |
|---|---|
| `slot`, `dateKey` | The day path. Saves the food AND logs it to that meal. |
| `onSaved(food, qty)` | The RECIPE path. Hands the food back; logs NOTHING. |

Passing a callback rather than a mode flag keeps the meal write on exactly one path. An
ingredient of a recipe being written is not something Jon has eaten today — the day path
is right from the day view and wrong from the recipe builder.

#### The basis rule — `_nutLabelToPer100(vals, basis, servingG)`

**THIS IS THE FEATURE. The camera is not.** Kept pure so it is testable without a device.

| Input | Outcome |
|---|---|
| `basis: 'per100'` | Use as printed. |
| `basis: 'serving'` **with** grams | **Convert to per-100g**, and KEEP `serving_g`. |
| `basis: 'serving'` **without** grams | **REFUSE** — `reason: 'serving_size_missing'`. |
| basis absent or unrecognised | **REFUSE** — `reason: 'basis_unknown'`. Never defaults. |

**Why a wrong basis is the worst class of bug here.** 250 kcal per serving and 250 kcal
per 100g are the same shape. The numbers are plausible, they save, and they stay wrong for
months in a custom food Jon reuses. **Nothing downstream can detect it.** Hence: no default
on the toggle (a preselected "per 100g" would make the commonest label type save silently
wrong for anyone who did not notice), and a refusal rather than a guess.

#### CORRECTION to this document's earlier advice — read before "fixing" the design

This file previously instructed the implementer to carry `basis: 'serving'` through storage
and add a **separate multiply path** (servings × per-serving macros), on the reasoning that
Jon ruled "capture per serving, do not convert".

**That conflated CAPTURE with STORAGE, and following it would have been a mistake.** Jon's
ruling governs what the scanner shows and asks for. It does not govern the storage basis.
Six consumers compute `value × qty_g / 100` — day totals, slot cards, recipe builder,
shopping list, prep card, week view — and the shopping list sums `qty_g` **as grams**. A
second storage basis would need all six to branch correctly, forever, with a wrong branch
being invisible.

**What shipped instead:** store per-100g, keep `serving_g` alongside. The label's printed
per-serving figures are what Jon sees and confirms; the conversion is shown to him before
saving so it is something he can check rather than something that happens to him. `qty_g`
is **never** reused to mean servings — that warning in the original advice was correct and
still stands.

This is also why the third outcome must refuse: without a gram weight there is no route to
`qty_g` at all. The refusal is not caution, it is arithmetic.

#### Saved food shape

```js
{ id:'cf_…', n, cat, k, p, c, f,   // k/p/c/f are ALWAYS per 100g
  defaultQty,                       // serving_g if known, else 100
  serving_g,                        // 0 means "no serving concept — weigh it"
  from_label:true, custom:true }
```

#### The photo: ZERO exits, and not persisted

Read by `FileReader`, downscaled in-browser via `_phxDownscaleImage` (Peptides' shared
helper, 1600px, never throws), drawn into an `<img>`, dropped on close.

- **It never leaves the device.** Asserted in `harness.mjs` (`LABEL/EXIT`), so switching
  extraction on FAILS the gate until whoever does it declares the payload there.
- **It is never persisted.** A downscaled JPEG is 200–400KB against a ~5MB localStorage
  budget shared with every recipe and day log. Half a dozen would evict all of it, and Jon
  would experience that as *"my recipes vanished"*, not as a storage bug.

#### Extraction is now UNBLOCKED — decision already taken

The coach-worker vision passthrough was **VERIFIED on 2026-08-22** (see OPEN_ITEMS
ARCHIVE). This section's old "blocked on the photo probe" line is dead.

**When extraction is switched on, the call sends THE IMAGE AND NOTHING ELSE** — no targets,
no weight, no meal history, no recipes. Reading a printed label needs the label. Recorded
now so it is not re-litigated later under time pressure. Extraction fills the fields in;
**it must not bypass the basis rule or the confirm step.**

---

### What Nutrition CONSUMES from other domains

Declared so the owners know they have a consumer and can pin the shape their side.

| Surface | Owner | Status | What nutrition relies on |
|---|---|---|---|
| `blabTrainingStateOn(dateISO)` | Training | public | `{state, blabDay, label, sessions}`; states `trained` / `due` / `rest` / `skipped` / `none` |
| `blabDayLabel(n)` | Training | public | Day number → name; `''` outside 1–4 (fallback only) |

Migrated onto `blabTrainingStateOn` in v4.9.189. **Nutrition no longer reads
`blabCalGet` or interprets calendar entries at all** — the two bugs that preceded this
(`.182` misreading a REST custom as training, `.187` misreading a completed session as an
empty day) were both nutrition inferring meaning from a shape. Asking Training for the
STATE removes the inference rather than making the next misreading less likely.

**`due` is time-relative — the same word means two things** (Training, `da1e405`). On
TODAY it means "the session to do". On a PAST date it means "was scheduled, never
resolved" — nothing ages an unattended session into `skipped`, deliberately, because only
Jon knows whether a missed session was abandoned or is being made up.

So nutrition maps it by date: `due` earns training targets **only when the day has not
already passed**. An unresolved past day takes rest targets and is labelled
"… — not logged", because crediting a training day needs either evidence he trained
(`trained`) or a day that has not happened yet. Pinned in `tests/nutrition.mjs`.

`sessions > 1` means one label does not speak for the whole day; nutrition appends
"+N more" rather than implying the day was only the session Training named.

---

## NON-NEGOTIABLE WORKFLOW RULES

1. **Follow CLAUDE.md fully** — runtime check before every push, harness must pass, version bump every push, no native dialogs, no single quotes inside single-quoted JS strings.
2. **Version coordination:** Before starting work, ALWAYS `git pull origin main` and confirm the version. Other chats push to the same file. If the version jumped since your last session, re-read your section of the code before editing.
3. **One change at a time.** Small commits, push immediately after each confirmed-clean build.
4. **Commit message format:** `v4.9.XXX — [NUTRITION] description`. The tag lets the PM chat track which domain shipped what.
5. **Never edit another domain's code.** If a task requires touching training/peptide/shared code, report back: "This needs PM coordination" and stop.
6. **Update the harness** when you add new functionality. `node harness.mjs` must stay green.

## CROSS-CHAT COMMS

Full protocol in `COMMS_PROTOCOL.md` — read it. Summary for you:
- **FIRST: `EnterWorktree {name:"nutrition"}`** (or `{path:".claude/worktrees/nutrition"}` if it exists, then `git fetch origin && git rebase origin/main`). Never edit the shared Desktop tree — see COMMS_PROTOCOL.md § ISOLATION.
- Load comms tools at session start via ToolSearch: `select:SendMessage,mcp__ccd_session_mgmt__list_sessions,mcp__ccd_session_mgmt__send_message`
- Your address is `Phoenix App - Nutrition`; the PM is `PHOENIX APP CENTRAL PM`
- Send the PM a PUSH-NOTICE when you start a build task and after every push
- Push from the worktree: `git fetch origin && git rebase origin/main` → APP_VERSION = highest+1 → runtime check + harness → `git add index.html harness.mjs` → `git push origin HEAD:main`
- You are the source of truth for weigh-ins and macro data — answer other chats' QUERY messages about data shape, but route their change requests through the PM
- Escalate anything outside your domain to the PM; never resolve another domain's merge conflicts

## SESSION START RITUAL

```bash
# (after EnterWorktree — pwd should be .../.claude/worktrees/nutrition)
pwd
git fetch origin && git rebase origin/main
grep "APP_VERSION" index.html | head -1
git status                            # must be clean
git log --oneline -5                  # see what other chats shipped
```

Also read `COMMS_PROTOCOL.md` and load the comms tools (ToolSearch select above).

Then report: current version, recent commits from other domains, ready for task.

## STATE AS OF v4.9.264 — continuity block

**Re-derive, do not trust these figures.** They were true when written. `board_check.mjs`
and the gates are authoritative; this is orientation, not a source.

### Shipped this cycle (Nutrition)

| Version | What |
|---|---|
| .211 | Tab router had no `meals` branch — the day card rendered today. View state now persists (`_nutSaveView`/`_nutRestoreView`, key `phx_nut_view_v1`) so the screen survives a lock. |
| .213 | Targets read the LIVE morning weigh-in, not just `athlete.bw`. |
| .216/.217 | `_phxKeyboardSafe` — bottom sheets clear the keyboard. Promoted to shared; Training arms it at its sheet factory, Peptides on two sheets. |
| .218 | Stacked overlays verified independent — each `fit()` closes over its own element. |
| .222 | Check-in tab archived (unreachable, no router branch) with its transitive closure. Sidebar no longer advertises a screen that cannot open. |
| .225 | **The keyboard fix was half a fix.** A panel capped in `vh` does not shrink with the overlay; the excess overflows off the TOP. Eleven sheets converted to `%`. Found by Peptides. |
| .227 | Keyboard safety guarded as a **conditional pair**, enumerated mechanically. |
| .229 | Food label scanner — manual-first, basis rule, zero exits. |
| .247 | Scan/custom-food from the recipe builder's own picker; hands the food back. |

### Guard inventory (what fails if someone breaks it)

- `harness.mjs` — `KEYBOARD:` enumerates every `nut`/`_nut` function that appends an
  overlay and asserts **typed field ⇒ armed** and **armed ⇒ not `vh`**. Mechanical, so a
  sheet added tomorrow is covered without anyone editing a list. Has a floor.
- `harness.mjs` — `LABEL:` / `LABEL/EXIT:` / `RECIPE:` as described above. Both `LABEL`
  guards anchor on a string in the LAST block of the scanner, not on a length.
- `tests/nutrition.mjs` — the `CHOKE POINT` cases drive the **save button**, not the rule.
  Proven necessary: making the save bypass `_nutLabelToPer100` leaves all five rule tests
  GREEN while both refusal tests go red.

### Known gaps — NOT tracked here

Per `OPEN_ITEMS.md`: **one list.** A thread recorded both here and there goes stale here
and nothing announces it. Open Nutrition threads live in `OPEN_ITEMS.md` only.

Long-standing unbuilt items, recorded as scope rather than as open threads: editing the
quantity of an already-logged component, editing saved recipes, barcode/API food search.

### Traps this domain has actually hit

In `KNOWN_ISSUES.md` (cross-domain). The two most expensive here:

1. **An upstream value that is valid, well-named, and answers a slightly different
   question.** `last_completed_day + 1` answers "what is next", not "what is today".
   `blabCalSessionsOn` answers "what is outstanding", not "what happened". No gate catches
   this class — only reading the code and documenting what data *means*.
2. **A guard that looks like coverage.** A hand-written list of entry points; an inversion
   that changes no behaviour; a test that decays into a duplicate of its neighbour.
