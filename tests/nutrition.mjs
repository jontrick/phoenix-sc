// NUTRITION — functional tests. Run: node functional_check.mjs nutrition
//
// These call the real functions in index.html. Every case here corresponds to a
// bug that actually shipped, or a rule Jon set:
//   · restore resolution — Jon's ruling, 18 Aug 2026: newest timestamp wins
//   · storage envelope   — {_ts, recipes:[]}; a bare array cannot carry a stamp
//   · migration age      — migrated legacy recipes must not outrank the cloud
//   · the .151 race      — an empty read must not persist and block restore
//   · mirror scrubbing   — diagnostics get counts, never recipe names or weights

const UID = 'test-user';
const KEY = `phx_recipes_v1_${UID}`;
const OLDER = '2026-08-01T00:00:00.000Z';
const NEWER = '2026-08-17T00:00:00.000Z';

const rec = (name) => ({
  id: `r_${name}`, name, cat: 'other', yield_serves: 1,
  components: [], yield_note: '', prep_method: '', macros_manual: null,
});
const env = (ts, name) => (ts ? { _ts: ts, recipes: [rec(name)] } : { recipes: [rec(name)] });

export default function ({ test, assert, app, signIn, seed, read, reset }) {

  // The app derives the recipe key from the signed-in user. Both identity
  // sources are set here so the tests exercise the real key, not the guest one.
  const start = () => {
    reset();
    signIn(UID);
    app.athlete = { id: UID };
  };

  const restore = (localValue, cloudValue) => {
    start();
    if (localValue !== null) seed(KEY, localValue);
    const changed = app.nutRestoreRecipesFromCloud({ nut_recipes: cloudValue });
    return { changed, state: read(KEY), backup: read(`${KEY}_bak`) };
  };

  const names = (state) => (app._nutRecipesFrom(state) || []).map(r => r.name);

  // ── Restore resolution — newest timestamp wins ─────────────────────────────
  // The old rule was "local always wins", so a replacement device that had
  // written any recipe could never pull the library back down from Supabase.

  test('a fresh install pulls the recipe library down from the cloud', () => {
    const r = restore(null, env(NEWER, 'cloud'));
    assert.deepEqual(names(r.state), ['cloud'], 'library restored');
    assert.equal(r.changed, true, 'restore reports that it changed local');
  });

  test('a newer cloud copy wins', () => {
    const r = restore(env(OLDER, 'local'), env(NEWER, 'cloud'));
    assert.deepEqual(names(r.state), ['cloud'], 'cloud applied');
    assert.equal(r.changed, true, 'restore reported');
  });

  test('a newer local copy is not clobbered by an older cloud copy', () => {
    const r = restore(env(NEWER, 'local'), env(OLDER, 'cloud'));
    assert.deepEqual(names(r.state), ['local'], 'local survived');
    assert.equal(r.changed, false, 'no restore reported');
  });

  test('equal timestamps keep local — a tie must not ping-pong between devices', () => {
    const r = restore(env(NEWER, 'local'), env(NEWER, 'cloud'));
    assert.deepEqual(names(r.state), ['local'], 'local kept on a tie');
    assert.equal(r.changed, false, 'no restore on a tie');
  });

  test('a stamped cloud copy beats unstamped legacy local recipes', () => {
    const r = restore(env(null, 'local'), env(OLDER, 'cloud'));
    assert.deepEqual(names(r.state), ['cloud'], 'cloud applied over legacy local');
  });

  test('stamped local beats an unstamped legacy cloud copy', () => {
    const r = restore(env(OLDER, 'local'), env(null, 'cloud'));
    assert.deepEqual(names(r.state), ['local'], 'local kept');
  });

  test('with neither side stamped, local is kept', () => {
    const r = restore(env(null, 'local'), env(null, 'cloud'));
    assert.deepEqual(names(r.state), ['local'], 'local kept');
  });

  test('unreadable local recipes are replaced by the cloud copy', () => {
    const r = restore('{ not json', env(OLDER, 'cloud'));
    assert.deepEqual(names(r.state), ['cloud'], 'cloud applied over corrupt local');
    assert.equal(r.changed, true, 'restore reported');
  });

  // The case Jon actually cares about. A new handset has no local copy at all,
  // and a cloud copy written before stamping existed is still worth restoring.
  test('lost phone: no local and an UNSTAMPED cloud copy still restores', () => {
    const r = restore(null, [rec('cloud')]);           // legacy bare array
    assert.deepEqual(names(r.state), ['cloud'], 'restored from a legacy cloud copy');
    assert.equal(r.changed, true, 'restore reported');
  });

  test('two legacy bare arrays keep local — no basis to overwrite', () => {
    const r = restore(JSON.stringify([rec('local')]), [rec('cloud')]);
    assert.deepEqual(names(r.state), ['local'], 'local kept');
  });

  // ── The replaced copy is recoverable ──────────────────────────────────────

  test('the replaced copy is kept as a backup, never silently dropped', () => {
    const r = restore(env(OLDER, 'local'), env(NEWER, 'cloud'));
    assert.ok(r.backup, 'backup written');
    assert.deepEqual(names(r.backup), ['local'], 'backup holds the replaced copy');
  });

  test('a no-op restore leaves no backup behind', () => {
    const r = restore(env(NEWER, 'local'), env(OLDER, 'cloud'));
    assert.equal(r.backup, null, 'no stray backup');
  });

  test('the backup is one generation and is never chained', () => {
    start();
    seed(KEY, env(OLDER, 'first'));
    app.nutRestoreRecipesFromCloud({ nut_recipes: env(NEWER, 'second') });
    app.nutRestoreRecipesFromCloud({ nut_recipes: env('2026-08-19T00:00:00.000Z', 'third') });
    assert.deepEqual(names(read(`${KEY}_bak`)), ['second'], 'backup holds only the last replaced copy');
  });

  test('a profile row without nut_recipes is ignored', () => {
    start();
    seed(KEY, env(NEWER, 'local'));
    assert.equal(app.nutRestoreRecipesFromCloud({ name: 'Jon' }), false, 'reports no change');
    assert.deepEqual(names(read(KEY)), ['local'], 'untouched');
  });

  // ── Storage envelope ──────────────────────────────────────────────────────
  // A property hung off an Array is dropped by JSON.stringify, so the wrapper is
  // load-bearing: without it the stamp cannot survive a save.

  test('every save stamps _ts, which is what the comparison relies on', () => {
    start();
    app.nutSaveRecipes([rec('saved')]);
    const saved = read(KEY);
    assert.ok(saved && saved._ts, '_ts present');
    assert.ok(!isNaN(Date.parse(saved._ts)), '_ts is a parseable ISO date');
    assert.deepEqual(names(saved), ['saved'], 'recipes round-trip');
  });

  test('a legacy bare array still loads', () => {
    start();
    seed(KEY, [rec('legacy')]);
    assert.deepEqual(app.nutGetRecipes().map(r => r.name), ['legacy'], 'bare array read');
  });

  test('a malformed envelope reads as empty rather than throwing', () => {
    start();
    seed(KEY, { _ts: NEWER, recipes: 'not-an-array' });
    assert.deepEqual(app.nutGetRecipes(), [], 'empty, not a crash');
  });

  // ── Migration age ─────────────────────────────────────────────────────────
  // Migration runs on READ. Stamping it `now` would let stale local recipes
  // outrank a genuinely newer cloud copy, so it must write unstamped.

  test('migrated legacy recipes are written UNSTAMPED', () => {
    start();
    app.nutSaveState({ setup_done: true, targets: {}, daily: {}, recipes: [
      { id: 'r_old', name: 'Legacy', components: [{ n: 'C', cat: 'protein', k: 100, p: 20, c: 0, f: 2, qty_g: 100, state: 'raw' }] },
    ] });
    app.nutGetRecipes();
    const stored = read(KEY);
    assert.ok(stored, 'migration persisted');
    assert.equal(stored._ts, undefined, 'no stamp — migrated recipes are of unknown age');
  });

  test('a stamped cloud copy therefore beats freshly migrated legacy recipes', () => {
    start();
    app.nutSaveState({ setup_done: true, targets: {}, daily: {}, recipes: [
      { id: 'r_old', name: 'Legacy', components: [] },
    ] });
    app.nutGetRecipes();
    app.nutRestoreRecipesFromCloud({ nut_recipes: env(OLDER, 'cloud') });
    assert.deepEqual(names(read(KEY)), ['cloud'], 'cloud won over migrated legacy');
  });

  // ── The v4.9.151 race ─────────────────────────────────────────────────────
  // nutGetRecipes used to persist [] on every read. That made the key exist, and
  // restore is local-wins, so opening the Nutrition screen before the profile
  // row landed blocked cloud restore permanently.

  test('an empty read does not persist the key', () => {
    start();
    assert.deepEqual(app.nutGetRecipes(), [], 'nothing to return');
    assert.equal(read(KEY), null, 'and nothing written');
  });

  test('cloud restore still works after the Nutrition screen was opened first', () => {
    start();
    app.nutGetRecipes();                                  // screen opened pre-profile
    app.nutRestoreRecipesFromCloud({ nut_recipes: env(NEWER, 'cloud') });
    assert.deepEqual(names(read(KEY)), ['cloud'], 'early read did not block restore');
  });

  // ── Identity ──────────────────────────────────────────────────────────────
  // The restore hook fires from _loadProfileAndRouteInner BEFORE `athlete` is
  // assigned on the awaited (fresh install / new device) path. If the key were
  // derived from `athlete` alone it would fall back to the guest key, and the
  // restored library would be written somewhere later reads never look.

  test('restore writes under the signed-in user even before athlete is populated', () => {
    reset();
    signIn(UID);
    app.athlete = null;                                   // exactly the fresh-install window
    app.nutRestoreRecipesFromCloud({ nut_recipes: env(NEWER, 'cloud') });
    assert.equal(read('phx_recipes_v1_guest'), null, 'nothing written to the guest key');
    assert.deepEqual(names(read(KEY)), ['cloud'], 'written under the real user id');
  });

  // Both nutrition keys must agree on who the user is. _nutKey holds the daily
  // logs, targets, meal ticks and water; if it ever resolved to 'guest' during
  // the pre-athlete window, a whole day of logging could land somewhere later
  // reads never look.
  test('both nutrition keys resolve to the session uid before athlete is set', () => {
    reset();
    signIn(UID);
    app.athlete = null;
    app.nutSaveState({ setup_done: true, targets: { kcal: 2000 }, daily: {} });
    app.nutSaveRecipes([rec('saved')]);
    assert.ok(read(`phx_nut_v1_${UID}`), 'nutrition state under the real user id');
    assert.ok(read(KEY), 'recipes under the real user id');
    assert.equal(read('phx_nut_v1_guest'), null, 'no guest state key');
    assert.equal(read('phx_recipes_v1_guest'), null, 'no guest recipe key');
  });

  test('restore is a no-op when signed out', () => {
    reset();
    signIn(null);
    app.athlete = null;
    assert.equal(app.nutRestoreRecipesFromCloud({ nut_recipes: env(NEWER, 'cloud') }), false, 'reports no change');
    assert.equal(read(KEY), null, 'nothing written under the user key');
    assert.equal(read('phx_recipes_v1_guest'), null, 'and nothing dumped in the guest key either');
  });

  // ── Mirror scrubbing ──────────────────────────────────────────────────────
  // The diagnostic snapshot lands in localStorage and is readable from the URL
  // bar via phxLastError(), so it must never carry what Jon eats.

  test('the diagnostic summary is a count only', () => {
    assert.deepEqual(app._nutErrorSummary(env(NEWER, 'Chilli Sauce')), { count: 1 }, 'summary shape');
  });

  test('no recipe name or weight reaches the diagnostic summary', () => {
    const payload = { _ts: NEWER, recipes: [
      { ...rec('Chilli Sauce'), components: [{ n: 'Chilli', qty_g: 30 }] },
    ] };
    const summary = app._nutErrorSummary(payload);
    assert.notIncludes(summary, 'Chilli Sauce', 'recipe name leaked to diagnostics');
    assert.notIncludes(summary, 'Chilli', 'ingredient name leaked to diagnostics');
    assert.notIncludes(summary, '30', 'ingredient weight leaked to diagnostics');
  });

  test('the diagnostic summary survives empty and null payloads', () => {
    assert.deepEqual(app._nutErrorSummary({}), { count: 0 }, 'empty object');
    assert.deepEqual(app._nutErrorSummary(null), { count: 0 }, 'null');
  });

  // ── Day keys are LOCAL, not UTC ───────────────────────────────────────────
  // Jon is in Brisbane (UTC+10) and trains at 4:30am. With a UTC day key,
  // everything he logged before 10:00 local landed under YESTERDAY.
  //
  // Asserting against the runner's own clock would be useless — on a UTC
  // machine the broken and fixed implementations agree. So pin the instant:
  // 2026-08-19 04:30 +10:00 is 2026-08-18 18:30 UTC. Local says the 19th, UTC
  // says the 18th, and the test is the same in every timezone.
  const at0430Brisbane = (fn) => {
    const Real = app.Date;
    function Fixed(...a) {
      if (a.length) return new Real(...a);
      return {
        getFullYear: () => 2026, getMonth: () => 7, getDate: () => 19, getDay: () => 3,
        getHours: () => 4, getMinutes: () => 30,
        toISOString: () => '2026-08-18T18:30:00.000Z',
        getTime: () => Real.parse('2026-08-18T18:30:00.000Z'),
      };
    }
    Fixed.parse = Real.parse; Fixed.now = Real.now; Fixed.UTC = Real.UTC;
    app.Date = Fixed;
    try { return fn(); } finally { app.Date = Real; }
  };

  test('a day key is built from local date parts, not a UTC string', () => {
    assert.equal(
      app._phxLocalISO({ getFullYear: () => 2026, getMonth: () => 7, getDate: () => 9 }),
      '2026-08-09', 'zero-padded local components');
  });

  test('at 4:30am Brisbane, today is the local date — not yesterday in UTC', () => {
    at0430Brisbane(() => {
      assert.equal(app._nutToday(), '2026-08-19', 'the 19th, not the UTC 18th');
    });
  });

  test('a 4:30am weigh-in lands on the local day, not the one before', () => {
    start();
    app.nutSaveState({ setup_done: true, daily: {} });
    at0430Brisbane(() => { app.nutRecordWeight(91.2); });
    const daily = read(`phx_nut_v1_${UID}`).daily;
    assert.ok(daily['2026-08-19'], 'filed under the local date');
    assert.equal(daily['2026-08-19'].weight_kg, 91.2, 'with the right weight');
    assert.equal(daily['2026-08-18'], undefined, 'and nothing under yesterday');
  });

  test('the week containing a 4:30am moment is the local week', () => {
    at0430Brisbane(() => {
      const days = app._nutWeekDays(app._nutToday());
      assert.equal(days.length, 7, 'seven days');
      assert.ok(days.indexOf('2026-08-19') >= 0, 'the local day is in its own week');
    });
  });

  // ── Renderers ─────────────────────────────────────────────────────────────
  // The sandbox hands out a fresh element per getElementById call, so nothing
  // written by a renderer can be read back. Memoise by id and capture created
  // elements, then drive the real entry points and assert on what they DREW.
  // (Training v4.9.165: 43 tests passed while the renderer threw on every call,
  // because they only ever exercised the helpers underneath it.)
  const dom = () => {
    const nodes = {}, created = [];
    const make = () => app.document.createDocumentFragment();
    app.document.getElementById = (id) => (nodes[id] || (nodes[id] = make()));
    const origCreate = app.document.createElement;
    // The bare stub returns null from querySelector, so any renderer that wires
    // its own controls throws before finishing. Hand back a memoised stub per
    // selector instead, so the entry point runs to completion the way it does on
    // device — otherwise "the renderer was driven" would be a half-truth.
    app.document.createElement = (t) => {
      const e = origCreate(t);
      const found = {};
      e.querySelector = (sel) => (found[sel] || (found[sel] = origCreate('div')));
      created.push(e);
      return e;
    };
    return {
      node: (id) => nodes[id] || (nodes[id] = make()),
      html: (id) => String((nodes[id] || {}).innerHTML || ''),
      lastCreatedHtml: () => String((created[created.length - 1] || {}).innerHTML || ''),
    };
  };

  const setUp = (weightKg) => {
    start();
    app.nutSaveState({
      setup_done: true,
      goal: 'hypertrophy',
      profile: { height_cm: 180, age: 40, sex: 'm', weight_kg: weightKg },
      targets: app.nutCalcTargets(weightKg, 180, 40, 'm', 'hypertrophy'),
      daily: {},
    });
  };

  test('the setup screen asks for bodyweight, prefilled from the latest weigh-in', () => {
    setUp(90);
    app.nutRecordWeight(94.2, '2026-08-18');
    const d = dom();
    app.nutOpenSetup();
    const html = d.lastCreatedHtml();
    assert.ok(html.indexOf('nut-su-bw') >= 0, 'bodyweight input rendered');
    assert.ok(html.indexOf('BODYWEIGHT') >= 0, 'bodyweight labelled');
    assert.ok(html.indexOf('94.2') >= 0, 'prefilled with the latest weigh-in');
  });

  test('the drift banner renders once the latest weigh-in has moved 1kg+', () => {
    setUp(90);
    app.nutRecordWeight(86.4, '2026-08-18');
    app._nutTab = 'today';
    const d = dom();
    app.nutRenderScreen();
    const html = d.html('nut-screen-body');
    assert.ok(html.indexOf('Targets out of date') >= 0, 'banner drawn');
    assert.ok(html.indexOf('data-nut-recalc') >= 0, 'recalculate control drawn');
    assert.ok(html.indexOf('86.4') >= 0, 'shows the current weight');
  });

  test('no drift banner for a sub-1kg wobble', () => {
    setUp(90);
    app.nutRecordWeight(90.4, '2026-08-18');
    app._nutTab = 'today';
    const d = dom();
    app.nutRenderScreen();
    assert.equal(d.html('nut-screen-body').indexOf('Targets out of date'), -1, 'no banner');
  });

  test('the week view renders navigation and follows the selected week', () => {
    setUp(90);
    app._nutTab = 'week';
    app._nutWeekOffset = 1;
    const d = dom();
    app.nutRenderScreen();
    const html = d.html('nut-screen-body');
    assert.ok(html.indexOf('data-nut-week-nav') >= 0, 'week arrows drawn');
    assert.ok(html.indexOf('NEXT WEEK') >= 0, 'label reflects the offset');
    assert.ok(html.indexOf('data-nut-week-today') >= 0, 'jump-back control drawn when off-week');
    app._nutWeekOffset = 0;
  });

  // ── Bodyweight → targets ──────────────────────────────────────────────────

  test('the latest weigh-in wins over an undated profile weight', () => {
    start();
    app.nutSaveState({ setup_done: true, daily: {} });
    app.athlete = { id: UID, bw: 80 };
    app.nutRecordWeight(93.5, '2026-08-18');
    const cur = app._nutCurrentWeight();
    assert.equal(cur.kg, 93.5, 'check-in weight chosen');
    assert.equal(cur.source, 'check-in', 'and it knows where it came from');
  });

  test('the profile weight is used only when no weigh-in exists', () => {
    start();
    app.nutSaveState({ setup_done: true, daily: {} });
    app.athlete = { id: UID, bw: 88 };
    assert.equal(app._nutCurrentWeight().kg, 88, 'falls back to profile');
  });

  test('nutRecordWeight is date-keyed and idempotent', () => {
    start();
    app.nutSaveState({ setup_done: true, daily: {} });
    assert.equal(app.nutRecordWeight(91, '2026-08-18'), true, 'reports written');
    app.nutRecordWeight(91, '2026-08-18');
    assert.equal(read(`phx_nut_v1_${UID}`).daily['2026-08-18'].weight_kg, 91, 'single value, not appended');
    assert.equal(app.nutRecordWeight(0, '2026-08-18'), false, 'rejects a non-weight');
  });

  // Training calls this from submitWeightCheckin, which can fire before Jon has
  // ever opened Nutrition. It must degrade, not throw — athlete.bw still carries
  // the weight in that case, and _nutCurrentWeight falls back to it.
  test('recording a weight before nutrition is set up fails soft, never throws', () => {
    reset();
    signIn(UID);
    app.athlete = { id: UID };
    assert.equal(app.nutRecordWeight(92, '2026-08-18'), false, 'reports it did not store');
    assert.equal(read(`phx_nut_v1_${UID}`), null, 'and wrote no state blob');
  });

  // The bug Jon spotted: targets were silently built for an 80kg stranger.
  test('80kg never reaches targets when a weigh-in exists', () => {
    setUp(90);
    app.nutRecordWeight(95, '2026-08-18');
    assert.equal(app.nutRecalcTargets(), true, 'recalculated');
    const t = read(`phx_nut_v1_${UID}`).targets;
    assert.deepEqual(t, app.nutCalcTargets(95, 180, 40, 'm', 'hypertrophy'), 'targets match the real weight');
    const eighty = app.nutCalcTargets(80, 180, 40, 'm', 'hypertrophy');
    assert.ok(t.kcal !== eighty.kcal, 'and are not the 80kg fallback');
  });

  test('recalculating keeps goal, height, age and sex — only weight moves', () => {
    setUp(90);
    app.nutRecordWeight(84, '2026-08-18');
    app.nutRecalcTargets();
    const ns = read(`phx_nut_v1_${UID}`);
    assert.equal(ns.goal, 'hypertrophy', 'goal kept');
    assert.deepEqual(
      { h: ns.profile.height_cm, a: ns.profile.age, s: ns.profile.sex },
      { h: 180, a: 40, s: 'm' }, 'profile kept');
    assert.equal(ns.profile.weight_kg, 84, 'weight targets were built from is updated');
  });

  test('recalculating is refused when there is no weight to use', () => {
    start();
    app.athlete = { id: UID };
    app.nutSaveState({ setup_done: true, goal: 'strength', profile: { height_cm: 180, age: 40, sex: 'm' }, daily: {} });
    assert.equal(app.nutRecalcTargets(), false, 'no guess made');
  });

  // ── Perpetual week ────────────────────────────────────────────────────────

  test('the selected week shifts by whole weeks and returns 7 days', () => {
    app._nutWeekOffset = 0;
    const thisWeek = app._nutSelectedWeekDays();
    app._nutWeekOffset = 1;
    const nextWeek = app._nutSelectedWeekDays();
    app._nutWeekOffset = 0;
    assert.equal(nextWeek.length, 7, 'seven days');
    const gap = (Date.parse(nextWeek[0]) - Date.parse(thisWeek[0])) / 86400000;
    assert.equal(gap, 7, 'exactly one week later');
  });

  test('prep for a future week ignores this week, and vice versa', () => {
    setUp(90);
    app.nutSaveRecipes([rec('Sauce')]);
    app._nutWeekOffset = 1;
    const nextWeek = app._nutSelectedWeekDays();
    app.nutAssignRecipe('r_Sauce', 'lunch', nextWeek[0], 2);
    assert.equal(app.nutBuildPrepPlan(app._nutSelectedWeekDays()).length, 1, 'next week has prep');
    app._nutWeekOffset = 0;
    assert.equal(app.nutBuildPrepPlan(app._nutSelectedWeekDays()).length, 0, 'this week has none');
    app._nutWeekOffset = 1;
    assert.equal(app.nutBuildPrepPlan(app._nutSelectedWeekDays())[0].serves, 2, 'serves counted in the right week');
    app._nutWeekOffset = 0;
  });

  // ── Planning is not eating ────────────────────────────────────────────────
  // The tick used to live inside nutAddComponent. That was right while today's
  // builder was the only caller, and silently wrong the moment the week planner
  // reused the same picker: filling next Thursday's lunch would have marked it
  // eaten on a day that has not happened.

  const FOOD = { n: 'Chicken', cat: 'protein', k: 110, p: 23, c: 0, f: 2, state: 'raw' };

  test('adding a food to a FUTURE day does not mark it eaten', () => {
    setUp(90);
    const future = app._nutWeekDays(app._nutToday())[6];
    app.nutAddComponent('lunch', future, FOOD, 200);
    const day = read(`phx_nut_v1_${UID}`).daily[future];
    assert.equal(day.meals.lunch.components.length, 1, 'the food was planned');
    assert.deepEqual(day.eaten || {}, {}, 'and nothing was marked eaten');
  });

  test('logging a food today still ticks the slot — the .145 behaviour survives', () => {
    setUp(90);
    const today = app._nutToday();
    app.nutLogComponent('lunch', today, FOOD, 200);
    const day = read(`phx_nut_v1_${UID}`).daily[today];
    assert.equal(day.meals.lunch.components.length, 1, 'food logged');
    assert.equal(day.eaten.lunch, true, 'and counted as eaten');
  });

  test('even the logging writer refuses to mark a future day eaten', () => {
    setUp(90);
    const future = app._nutWeekDays(app._nutToday())[6];
    app.nutLogComponent('dinner', future, FOOD, 200);
    const day = read(`phx_nut_v1_${UID}`).daily[future];
    assert.equal(day.meals.dinner.components.length, 1, 'still planned');
    assert.deepEqual(day.eaten || {}, {}, 'eating on a future day is incoherent');
  });

  test('the plain writer never ticks, whatever the day', () => {
    setUp(90);
    const today = app._nutToday();
    app.nutAddComponent('breakfast', today, FOOD, 100);
    const day = read(`phx_nut_v1_${UID}`).daily[today];
    assert.deepEqual(day.eaten || {}, {}, 'nutAddComponent is a pure write');
  });

  test('the week planner offers both a food and a recipe control per slot', () => {
    setUp(90);
    app.nutSaveRecipes([rec('Sauce')]);
    const days = app._nutSelectedWeekDays();
    app.nutAssignRecipe('r_Sauce', 'lunch', days[0], 1);
    app._nutTab = 'week';
    app._nutWeekMode = 'plan';
    const d = dom();
    app.nutRenderScreen();
    const html = d.html('nut-screen-body');
    assert.ok(html.indexOf('data-nut-plan-food') >= 0, '+ Food control drawn');
    assert.ok(html.indexOf('data-nut-add-recipe') >= 0, '+ Recipe control drawn');
    app._nutWeekMode = 'overview';
  });

  // ── Repeat day ────────────────────────────────────────────────────────────

  test('repeating a day copies its meals onto the chosen days', () => {
    setUp(90);
    app.nutSaveRecipes([rec('Bowl')]);
    const days = app._nutSelectedWeekDays();
    app.nutAssignRecipe('r_Bowl', 'lunch', days[0], 1);
    assert.equal(app.nutCopyDay(days[0], [days[2], days[4]]), 2, 'two days written');
    const ns = read(`phx_nut_v1_${UID}`);
    assert.equal(ns.daily[days[2]].meals.lunch.components[0].n, 'Bowl', 'Wed got it');
    assert.equal(ns.daily[days[4]].meals.lunch.components[0].n, 'Bowl', 'Fri got it');
  });

  test('a repeated day is not marked as already eaten', () => {
    setUp(90);
    app.nutSaveRecipes([rec('Bowl')]);
    const days = app._nutSelectedWeekDays();
    app.nutAssignRecipe('r_Bowl', 'lunch', days[0], 1);
    app.nutToggleMealEaten('lunch', days[0]);
    app.nutCopyDay(days[0], [days[2]]);
    const ns = read(`phx_nut_v1_${UID}`);
    assert.equal(ns.daily[days[0]].eaten.lunch, true, 'source stays eaten');
    assert.deepEqual(ns.daily[days[2]].eaten, {}, 'copy starts unticked');
  });

  test('repeating onto itself, or from an empty day, does nothing', () => {
    setUp(90);
    app.nutSaveRecipes([rec('Bowl')]);
    const days = app._nutSelectedWeekDays();
    app.nutAssignRecipe('r_Bowl', 'lunch', days[0], 1);
    assert.equal(app.nutCopyDay(days[0], [days[0]]), 0, 'self-copy is a no-op');
    assert.equal(app.nutCopyDay(days[5], [days[6]]), 0, 'empty source is a no-op');
  });
}
