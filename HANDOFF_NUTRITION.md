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

### Blocked, spec ready: nutrition-label scanner

**Not started. Blocked on Jon: the photo probe and the blood_panels SQL.** Nutrition owns
the **food label** scanner; Peptides owns the **blood panel** scanner. Same Cloudflare
Worker / Claude vision path, different domains — a food label has nothing to do with
pathology and must not be routed here as one.

**Jon's ruling, 22 Aug 2026 — capture PER SERVING, do NOT convert to per-100g.**

This resolves rather than inherits the conversion trap. Labels routinely print a serving
with no gram weight ("per serving (2 biscuits)", "per slice"), which makes a per-100g
conversion *impossible* rather than merely hard. Capturing what the label actually prints
sidesteps it entirely.

**The serving count is an input at the point of ADDING TO A MEAL, not at the point of
scanning.** Scan once, capture per-serving macros as printed. Then each time that food goes
into a day or week slot, Jon enters how many servings, and the day/week views show macros
× servings.

**The engineering consequence, which is where this can still go silently wrong.**
`_NUT_FOODS` is per-100g throughout and `nutAddComponent` computes `value × qty_g / 100`.
A per-serving food **cannot flow through that path unchanged** — it would be wrong by the
serving ratio, invisibly, and permanently once saved as a custom food. There is no point
downstream where a wrong basis becomes visible.

So a scanned food needs its basis carried explicitly (e.g. `basis: 'serving'` with
`serving_label`) and a separate multiply path — servings × per-serving macros — rather than
being coerced into the per-100g field and multiplied by grams. **Do not reuse `qty_g` to
mean servings.** That is the same shape as every silent-wrong-value bug this domain has
shipped: a field that looks right, means something else, and cannot be told apart downstream.

Recipes already carry per-serve macros and a serving count, so the existing per-serve
machinery (`nutRecipeMacros`, `nutAssignRecipe`'s `serves`) is the closer model to follow
than the per-100g food path.

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

## CONTEXT: WHERE THINGS STAND (August 2026)

- Tabs restructured to TODAY | RECIPES | WEEK (v4.9.137)
- Raw/cooked filter + recipe cooked-weight mode just shipped (v4.9.140)
- Recipe flow: build from raw ingredients → enter cooked dish weight + serve size → per-serve macros auto-calculated (the lasagne problem, solved)
- Shopping list aggregates the week's ingredients
- Known gaps: editing qty of an already-logged component, editing saved recipes, barcode/API food search — all candidates for future tasks
