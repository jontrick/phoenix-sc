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

const _NUT_SIZES = [250, 330, 500, 1000, 1500];

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
      { ...rec('Chilli Sauce'), components: [{ n: 'Chilli', qty_g: 137 }] },
    ] };
    const summary = app._nutErrorSummary(payload);
    assert.notIncludes(summary, 'Chilli Sauce', 'recipe name leaked to diagnostics');
    assert.notIncludes(summary, 'Chilli', 'ingredient name leaked to diagnostics');
    assert.notIncludes(summary, '137', 'ingredient weight leaked to diagnostics');
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

  // ══ THE CLOUD WRITE — behaviour, not a source-string match ═════════════════
  // The guard "write errors recorded, not swallowed" was a has() on source with
  // the behaviour proven NOWHERE: the write lived inside a setTimeout callback,
  // and setTimeout is a no-op in the sandbox, so the body never ran in any test.
  // Extracted to _nutRecipesWriteNow in v4.9.190 so it can be driven.

  // _phxRecordWriteError is a function DECLARATION, so it cannot be stubbed by
  // assignment — which is for the best: these assert the diagnostic Jon would
  // actually read in Settings, not that a stub was called.
  const failingWrite = (error) => {
    app.sb = { from: () => ({ update: () => ({ eq: () => ({
      then: (ok, bad) => (error instanceof Error ? Promise.reject(error).then(ok, bad)
                                                 : Promise.resolve({ error }).then(ok, bad)),
    }) }) }) };
  };
  const lastWriteError = () => read('phx_last_write_error');

  test('a failed cloud write is RECORDED, not swallowed', async () => {
    start();
    failingWrite({ message: 'column missing', code: '42703' });
    await app._nutRecipesWriteNow({ _ts: NEWER, recipes: [rec('Sauce')] });
    const snap = lastWriteError();
    assert.ok(snap, 'a diagnostic was written');
    assert.equal(snap.context, '_nutRecipesMirrorToCloud', 'named by its source');
    assert.equal(snap.code, '42703', 'carrying the error code');
    assert.ok(snap.message.indexOf('column missing') >= 0, 'and the message');
  });

  test('a rejected cloud write is recorded under its own context', async () => {
    start();
    failingWrite(new Error('offline'));
    await app._nutRecipesWriteNow({ _ts: NEWER, recipes: [rec('Sauce')] });
    assert.equal(lastWriteError().context, '_nutRecipesMirrorToCloud.rejected',
      'distinguishable from a returned error');
  });

  test('what reaches diagnostics is SHAPE — no recipe name or gram weight', async () => {
    start();
    failingWrite({ message: 'nope', code: 'X' });
    await app._nutRecipesWriteNow({ _ts: NEWER, recipes: [
      { ...rec('Chilli Sauce'), components: [{ n: 'Chilli', qty_g: 137 }] },
    ] });
    const snap = lastWriteError();
    // Peptides, 2026-08-22: this failed about 1 run in 20. `snap` carries
    // ts: new Date().toISOString(), and '30' appears in an ISO timestamp ~5.2%
    // of the time (minute or second 30-39, day 30, or milliseconds) - measured
    // independently. The failure text read 'no gram weight - found 30', pointing
    // at the redaction logic rather than at the assertion, which is the
    // expensive part.
    //
    // Two changes, not one. Dropping ts removes the only clock-dependent field
    // while keeping the assertion BROAD - a leak in context or message still
    // fails, which narrowing to payload_shape would have missed. And 137
    // replaces 30 because a two-character numeric needle against a serialised
    // object is fragile by construction, whatever it is matched against.
    const { ts, ...body } = snap;
    assert.ok(ts, 'the snapshot is stamped');
    assert.notIncludes(body, 'Chilli Sauce', 'no recipe name in the diagnostic');
    assert.notIncludes(body, 'Chilli', 'no ingredient name');
    assert.notIncludes(body, '137', 'no gram weight');
  });

  // Regression guard for the flakiness itself: force a timestamp that CONTAINS the
  // needle. Under the previous assertion (whole snapshot, needle '30') this is the
  // ~1-in-20 run that failed, and it failed pointing at the redaction logic rather
  // than at the test. Now it must pass deterministically.
  test('the privacy check survives a timestamp containing the needle', async () => {
    start();
    const Real = app.Date;
    function Colliding(...a) {
      if (a.length) return new Real(...a);
      return { toISOString: () => '2026-08-22T00:30:11.304Z', getTime: () => 0,
               getFullYear: () => 2026, getMonth: () => 7, getDate: () => 22 };
    }
    Colliding.parse = Real.parse; Colliding.now = Real.now; Colliding.UTC = Real.UTC;
    app.Date = Colliding;
    try {
      failingWrite({ message: 'nope', code: 'X' });
      await app._nutRecipesWriteNow({ _ts: NEWER, recipes: [
        { ...rec('Chilli Sauce'), components: [{ n: 'Chilli', qty_g: 137 }] },
      ] });
      const snap = lastWriteError();
      assert.ok(String(snap.ts).indexOf('30') >= 0, 'the timestamp really does contain the needle');
      const { ts, ...body } = snap;
      assert.notIncludes(body, '137', 'and the privacy check is unaffected by it');
    } finally { app.Date = Real; }
  });

  test('a successful write records nothing', async () => {
    start();
    app.sb = { from: () => ({ update: () => ({ eq: () => ({
      then: (ok) => Promise.resolve({ error: null }).then(ok),
    }) }) }) };
    await app._nutRecipesWriteNow({ _ts: NEWER, recipes: [rec('Sauce')] });
    assert.equal(lastWriteError(), null, 'no diagnostic on success');
  });

  test('signed out, the write does not happen at all', () => {
    reset(); signIn(null); app.athlete = null;
    failingWrite({ message: 'should not reach here', code: 'X' });
    assert.equal(app._nutRecipesWriteNow({ _ts: NEWER, recipes: [] }), null, 'no write attempted');
    assert.equal(lastWriteError(), null, 'and nothing recorded');
  });

  // ══ BUG 1 — the week view and the day card must agree ══════════════════════
  // Jon: the week view indicated food on a day; opening that day showed "Empty".
  // Cause: the day handler sets _nutTab='meals' and the router had no 'meals'
  // branch, so it fell through to the else and rendered TODAY. _nutTabMeals was
  // written, working, and referenced nowhere.

  test('BUG1 opening a day from the week view shows THAT day, not today', () => {
    setUp(90);
    app.nutSaveRecipes([rec('Bowl')]);
    const days = app._nutSelectedWeekDays();
    const other = days.find(d => d !== app._nutToday());
    app.nutAssignRecipe('r_Bowl', 'lunch', other, 1);   // food on another day, none today

    app._nutMealDate = other;
    app._nutTab = 'meals';
    const d = dom();
    app.nutRenderScreen();
    const html = d.html('nut-screen-body');
    assert.ok(html.indexOf('Bowl') >= 0, 'the meal logged on that day is on screen');
    assert.ok(html.indexOf(other) >= 0, 'and the card is showing that date');
    app._nutTab = 'today';
  });

  test('BUG1 the week view and the day card read the same slot data', () => {
    setUp(90);
    app.nutSaveRecipes([{ ...rec('Bowl'), components: [
      { n: 'Chicken', cat: 'protein', k: 110, p: 23, c: 0, f: 2, qty_g: 200, cooked_g: 0, state: 'raw' },
    ] }]);
    const days = app._nutSelectedWeekDays();
    const other = days.find(d => d !== app._nutToday());
    app.nutAssignRecipe('r_Bowl', 'lunch', other, 1);

    const slot = app._nutSlotTotals(app.nutGetState().daily[other], 'lunch');
    assert.ok(slot.kcal > 0, 'the week view has something to indicate');

    app._nutMealDate = other;
    app._nutTab = 'meals';
    const d = dom();
    app.nutRenderScreen();
    const html = d.html('nut-screen-body');
    assert.equal(html.indexOf('Empty') >= 0 && html.indexOf('Bowl') === -1, false,
      'the day card does not report Empty for a slot the week view shows as filled');
    app._nutTab = 'today';
  });

  // ══ BUG 2 — a resume lands where he was, not on the first tab ══════════════
  // The screen-level restore worked; navTo then reset _nutTab to 'today'.

  test('BUG2 the view he left is restored, not reset to today', () => {
    setUp(90);
    app._nutTab = 'week';
    app._nutWeekMode = 'plan';
    app._nutWeekOffset = 1;
    const d = dom();
    app.nutRenderScreen();                    // renders and persists

    app._nutTab = 'today';                    // as if arriving fresh
    app._nutWeekMode = 'overview';
    app._nutWeekOffset = 0;
    app.navTo('nutrition');                   // the path Jon actually takes on resume
    assert.equal(app._nutTab, 'week', 'back on the week tab');
    assert.equal(app._nutWeekMode, 'plan', 'in plan mode');
    assert.equal(app._nutWeekOffset, 1, 'on the week he was planning');
    app._nutWeekOffset = 0; app._nutWeekMode = 'overview'; app._nutTab = 'today';
  });

  test('BUG2 the day he was editing is restored too', () => {
    setUp(90);
    const days = app._nutSelectedWeekDays();
    app._nutMealDate = days[3];
    app._nutTab = 'meals';
    const d = dom();
    app.nutRenderScreen();
    app._nutTab = 'today'; app._nutMealDate = null;
    app._nutRestoreView();
    assert.equal(app._nutTab, 'meals', 'back on the day card');
    assert.equal(app._nutMealDate, days[3], 'showing the same day');
    app._nutTab = 'today';
  });

  test('BUG2 a day card with no date falls back rather than rendering an empty day', () => {
    setUp(90);
    seed('phx_nut_view_v1', { tab: 'meals', mealDate: null, weekMode: 'overview', weekOffset: 0 });
    app._nutRestoreView();
    assert.equal(app._nutTab, 'week', 'falls back to the week it came from');
    app._nutTab = 'today';
  });

  test('BUG2 no saved view means today, not a crash', () => {
    setUp(90);
    seed('phx_nut_view_v1', null);
    app._nutRestoreView();
    assert.equal(app._nutTab, 'today', 'clean default');
  });

  // ══ WATER — variable drink sizes ═══════════════════════════════════════════
  // Undo used to subtract a hard-coded 250ml, correct only while every entry WAS
  // 250ml. The cases that matter are the ones that fail under THAT behaviour, not
  // the ones that pass under this one — a test written against the new code
  // passes either way (Training's warning, and it was the right one).

  test('WATER a big drink is undone in full, not by a fixed 250ml', () => {
    setUp(90);
    app.nutAddWater(1500);
    assert.equal(app.nutGetWaterMl(app._nutToday()), 1500, 'logged');
    app.nutUndoLastWater();
    assert.equal(app.nutGetWaterMl(app._nutToday()), 0,
      'the whole 1.5L came off — subtracting 250 would leave 1250 and look fine');
  });

  test('WATER undo removes the LAST drink, not the largest or the first', () => {
    setUp(90);
    app.nutAddWater(1000);
    app.nutAddWater(330);
    app.nutUndoLastWater();
    assert.equal(app.nutGetWaterMl(app._nutToday()), 1000, 'the 330 went, the 1000 stayed');
  });

  test('WATER repeated undo unwinds the day in reverse order', () => {
    setUp(90);
    [250, 500, 1500].forEach(app.nutAddWater);
    assert.equal(app.nutGetWaterMl(app._nutToday()), 2250, 'three drinks');
    app.nutUndoLastWater();
    assert.equal(app.nutGetWaterMl(app._nutToday()), 750, 'minus the 1500');
    app.nutUndoLastWater();
    assert.equal(app.nutGetWaterMl(app._nutToday()), 250, 'minus the 500');
    app.nutUndoLastWater();
    assert.equal(app.nutGetWaterMl(app._nutToday()), 0, 'empty');
    assert.equal(app.nutUndoLastWater(), false, 'and nothing left to undo');
  });

  test('WATER every offered size logs the amount it says', () => {
    _NUT_SIZES.forEach((ml) => {
      setUp(90);
      app.nutAddWater(ml);
      assert.equal(app.nutGetWaterMl(app._nutToday()), ml, `${ml}ml logged as ${ml}ml`);
    });
  });

  test('WATER add refuses a non-positive amount rather than subtracting', () => {
    setUp(90);
    app.nutAddWater(500);
    assert.equal(app.nutAddWater(-250), false, 'a negative is not an add');
    assert.equal(app.nutAddWater(0), false, 'nor is zero');
    assert.equal(app.nutGetWaterMl(app._nutToday()), 500, 'the total is untouched');
  });

  // A day logged before v4.9.197 has a total and no entries. Undo cannot be exact
  // there; it must degrade rather than corrupt or refuse.
  test('WATER a pre-existing day without entries still undoes by the default size', () => {
    setUp(90);
    const ns = app.nutGetState();
    ns.daily[app._nutToday()] = { water_ml: 750 };          // legacy shape
    app.nutSaveState(ns);
    assert.equal(app.nutUndoLastWater(), true, 'still does something');
    assert.equal(app.nutGetWaterMl(app._nutToday()), 500, 'falls back to 250ml');
  });

  test('WATER the tile offers a size picker, not a fixed glass', () => {
    setUp(90);
    app.nutAddWater(330);
    const d = dom();
    app.nutRenderWaterTile();
    const html = d.html('today-water-tile');
    assert.ok(html.indexOf('LOG A DRINK') >= 0, 'the control invites a choice');
    assert.equal(html.indexOf('+ 250 ML'), -1, 'and no longer hard-codes one size');
    assert.ok(html.indexOf('1 drink') >= 0, 'counts drinks, not glasses');
  });

  test('WATER the size sheet offers exactly the sizes Jon asked for', () => {
    setUp(90);
    let opts = null;
    app._phxOpenBottomSheet = (cfg) => { opts = cfg.options; };
    app.nutOpenDrinkSizeSheet();
    assert.deepEqual(opts.map(o => Number(o.value)), _NUT_SIZES, 'all five, in order');
    opts.forEach((o) => assert.ok(o.label.length > 0, 'each is labelled'));
  });

  test('WATER picking a size from the sheet logs that size', () => {
    setUp(90);
    app._phxOpenBottomSheet = (cfg) => cfg.onSelect('500');
    app.nutOpenDrinkSizeSheet();
    assert.equal(app.nutGetWaterMl(app._nutToday()), 500, 'the chosen size landed');
  });

  // ══ THE BACKUP IS REACHABLE ════════════════════════════════════════════════
  // phx_recipes_v1_{uid}_bak was written from .152 and read by NOTHING, while the
  // comment beside it called the copy recoverable. No test could have caught that
  // — there was nothing to call. Driven through the RECIPES tab, not the builder.

  const losingRestore = () => {
    setUp(90);
    seed(KEY, { recipes: [rec('mine-A'), rec('mine-B')] });      // legacy, unstamped
    const changed = app.nutRestoreRecipesFromCloud({ nut_recipes: env(NEWER, 'cloud-only') });
    assert.equal(changed, true, 'precondition: the restore actually replaced the library');
  };

  test('after a restore replaces the library, the previous one is offered', () => {
    losingRestore();
    const info = app.nutBackupInfo();
    assert.ok(info, 'there is something to offer');
    assert.equal(info.count, 2, 'the replaced list had two recipes');
    assert.equal(info.curCount, 1, 'the live list has one');
  });

  test('the offer is REACHABLE — it renders in the recipes tab', () => {
    losingRestore();
    app._nutTab = 'recipes';
    const d = dom();
    app.nutRenderScreen();
    const html = d.html('nut-screen-body');
    assert.ok(html.indexOf('Previous recipe list kept') >= 0, 'the offer is on screen');
    assert.ok(html.indexOf('data-nut-restore-bak') >= 0, 'with a control Jon can press');
  });

  test('recovering swaps, so a wrong recovery is itself undoable', () => {
    losingRestore();
    assert.equal(app.nutRestoreBackup(), true, 'recovered');
    assert.deepEqual(app.nutGetRecipes().map(r => r.name), ['mine-A', 'mine-B'], 'the old list is back');
    assert.equal(app.nutRestoreBackup(), true, 'and can be swapped again');
    assert.deepEqual(app.nutGetRecipes().map(r => r.name), ['cloud-only'], 'returning to the cloud copy');
  });

  test('a recovered library is stamped, so it wins the next comparison', () => {
    losingRestore();
    app.nutRestoreBackup();
    const saved = read(KEY);
    assert.ok(saved && !isNaN(Date.parse(saved._ts)), 'recovery stamps _ts');
  });

  test('no offer when there is nothing to recover', () => {
    start();
    app.nutSaveRecipes([rec('only')]);
    assert.equal(app.nutBackupInfo(), null, 'no backup, no offer');
    app._nutTab = 'recipes';
    const d = dom();
    app.nutRenderScreen();
    assert.equal(d.html('nut-screen-body').indexOf('Previous recipe list kept'), -1, 'and nothing on screen');
  });

  test('no offer when the backup matches what is already live', () => {
    start();
    app.nutSaveRecipes([rec('same')]);
    seed(`${KEY}_bak`, read(KEY));
    assert.equal(app.nutBackupInfo(), null, 'a no-op recovery is not offered');
  });

  // ══ ENTRY POINTS — the layer a test observes ═══════════════════════════════
  // Audit after the PM's .165 note: every water, tick and prep case below was
  // BUILDER-level — nutAddWater, nutToggleMealEaten, nutBuildPrepPlan. Those
  // prove the maths and say nothing about whether the screen calls them. All
  // five of these renderers had ZERO entry-point coverage, so the water counter
  // could have been absent from Today and this suite would have stayed green.

  test('ENTRY the Today nutrition tile draws the day\'s numbers', () => {
    setUp(90);
    const d = dom();
    app.nutRenderTile();
    const html = d.html('today-nutrition-tile');
    assert.ok(html.length > 0, 'the tile drew something');
    assert.ok(html.indexOf('Nutrition') >= 0, 'and is the nutrition tile');
    assert.ok(html.indexOf('kcal') >= 0, 'showing calories');
  });

  test('ENTRY the Today meals tile draws the planned slots with their ticks', () => {
    setUp(90);
    app.nutSaveRecipes([rec('Bowl')]);
    app.nutAssignRecipe('r_Bowl', 'lunch', app._nutToday(), 1);
    const d = dom();
    app.nutRenderMealsTile();
    const html = d.html('today-meals-tile');
    assert.ok(html.indexOf('Lunch') >= 0, 'the planned slot is on screen');
    assert.ok(html.indexOf('data-nut-tick') >= 0, 'with a tick control');
    assert.ok(html.indexOf('Bowl') >= 0, 'naming what is in it');
  });

  test('ENTRY the water counter draws its target and its add control', () => {
    setUp(90);
    app.nutAddWater(500);
    const d = dom();
    app.nutRenderWaterTile();
    const html = d.html('today-water-tile');
    assert.ok(html.indexOf('Water') >= 0, 'the tile drew');
    assert.ok(html.indexOf('nut-water-add') >= 0, 'with the add control');
    assert.ok(html.indexOf('0.50') >= 0, 'and the litres actually consumed');
  });

  test('ENTRY the prep card draws a recipe that is assigned this week', () => {
    setUp(90);
    app.nutSaveRecipes([rec('Chilli Sauce')]);
    const days = app._nutSelectedWeekDays();
    app.nutAssignRecipe('r_Chilli Sauce', 'lunch', days[0], 2);
    const d = dom();
    app.nutOpenPrepCard();
    const html = d.lastCreatedHtml();
    assert.ok(html.indexOf('Weekly Prep') >= 0, 'the prep card drew');
    assert.ok(html.indexOf('Chilli Sauce') >= 0, 'naming the recipe to prep');
    assert.ok(html.indexOf('2 serves') >= 0, 'and how many serves are needed');
  });

  test('ENTRY the shopping list draws the week\'s ingredients', () => {
    setUp(90);
    const days = app._nutSelectedWeekDays();
    app.nutLogComponent('lunch', days[0], { n: 'Chicken breast', cat: 'protein', k: 110, p: 23, c: 0, f: 2 }, 200);
    const d = dom();
    app.nutOpenShopList();
    const html = d.lastCreatedHtml();
    assert.ok(html.indexOf('Shopping List') >= 0, 'the list drew');
    assert.ok(html.indexOf('Chicken breast') >= 0, 'naming the ingredient');
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

  // The same principle as the writer split, one level up: a caller who opens the
  // picker without saying which mode it is in must not get the ticking path.
  test('opening the picker without a mode plans rather than logs', () => {
    setUp(90);
    const d = dom();
    app.nutOpenFoodPicker('lunch', app._nutToday());     // no mode given
    assert.equal(app._nutPickerMode, 'plan', 'omission is the safe path');
  });

  test('the daily builder still logs — it asks for it explicitly', () => {
    setUp(90);
    const d = dom();
    app.nutOpenFoodPicker('lunch', app._nutToday(), 'log');
    assert.equal(app._nutPickerMode, 'log', 'logging is available when stated');
  });

  // ══ CONTRACT — nutRecordWeight, called by Training's submitWeightCheckin ═══
  // The PROVIDER pins the contract. A consumer's suite going red means the break
  // already shipped past the owner, so these live here rather than in Training's.
  // Meanings, not just shapes — `false` is a NORMAL state, not an error.

  test('CONTRACT nutRecordWeight: returns true and writes the dated weight', () => {
    start();
    app.nutSaveState({ setup_done: true, daily: {} });
    assert.equal(app.nutRecordWeight(84.5, '2026-08-19'), true, 'reports written');
    assert.equal(read(`phx_nut_v1_${UID}`).daily['2026-08-19'].weight_kg, 84.5, 'under that exact date');
  });

  test('CONTRACT nutRecordWeight: the date defaults to the LOCAL today', () => {
    start();
    app.nutSaveState({ setup_done: true, daily: {} });
    at0430Brisbane(() => { app.nutRecordWeight(84.5); });
    assert.ok(read(`phx_nut_v1_${UID}`).daily['2026-08-19'], 'local date, not the UTC day before');
  });

  test('CONTRACT nutRecordWeight: idempotent — same date overwrites, never appends', () => {
    start();
    app.nutSaveState({ setup_done: true, daily: {} });
    app.nutRecordWeight(84.5, '2026-08-19');
    app.nutRecordWeight(85.1, '2026-08-19');
    assert.equal(read(`phx_nut_v1_${UID}`).daily['2026-08-19'].weight_kg, 85.1, 'one value, last wins');
  });

  test('CONTRACT nutRecordWeight: false means NOT SET UP — a normal state, not an error', () => {
    reset(); signIn(UID); app.athlete = { id: UID };
    assert.equal(app.nutRecordWeight(84.5, '2026-08-19'), false, 'no nutrition state yet');
    assert.equal(read(`phx_nut_v1_${UID}`), null, 'and no state blob manufactured');
  });

  test('CONTRACT nutRecordWeight: refuses a non-weight rather than storing it', () => {
    start();
    app.nutSaveState({ setup_done: true, daily: {} });
    [0, -5, NaN, null, undefined, 'heavy'].forEach((bad) => {
      assert.equal(app.nutRecordWeight(bad, '2026-08-19'), false, `rejects ${String(bad)}`);
    });
    assert.equal(read(`phx_nut_v1_${UID}`).daily['2026-08-19'], undefined, 'nothing written');
  });

  test('CONTRACT nutRecordWeight: never throws, whatever it is handed', () => {
    start();
    app.nutSaveState({ setup_done: true, daily: {} });
    app.nutRecordWeight({}, {});
    app.nutRecordWeight(84.5, 12345);
    assert.ok(true, 'no throw reached the caller');
  });

  // ── Training day comes from the calendar, not the queue ───────────────────
  // This reported "Upper Body" on a day with nothing scheduled, because it read
  // blabGetState().last_completed_day + 1 — the next UNDONE session — instead of
  // what Training's calendar actually has on that date.
  // status matters: a PENDING session on a past date is unresolved, not proof he
  // trained. Tests state the date and the status they mean rather than relying on
  // whichever day the suite happens to run.
  const schedule = (dateISO, blabDay, status) => seed(`blab_calendar_v1_${UID}`, {
    sessions: [{ blabWeek: 1, blabDay, scheduledDate: dateISO, status: status || 'pending' }], customs: [],
  });
  const TODAY = () => app._nutToday();
  const PAST = '2026-08-19';

  test('an empty day is rest even when a session sits unfinished in the queue', () => {
    start();
    seed(`blab_calendar_v1_${UID}`, { sessions: [], customs: [] });
    app.blabGetState = () => ({ active: true, last_completed_day: 0 });   // Day 1 still undone
    const t = app.nutTrainingForDay(PAST);
    assert.equal(t.label, 'Rest day', 'reads the calendar, not the queue');
    assert.equal(t.rest, true, 'rest');
    assert.equal(t.scheduled, false, 'nothing scheduled');
  });

  test('the label comes from what is scheduled on that date', () => {
    start();
    schedule(TODAY(), 2);
    const t = app.nutTrainingForDay(TODAY());
    assert.equal(t.dayNum, 2, 'BLAB day 2');
    assert.equal(t.label, 'Lower Body', 'named from the calendar');
    assert.equal(t.rest, false, 'not a rest day');
  });

  test('a session scheduled on Monday does not label Wednesday', () => {
    start();
    schedule('2026-08-17', 1, 'completed');          // Monday, done
    assert.equal(app.nutTrainingForDay('2026-08-17').label, 'Upper Body', 'Monday is Upper Body');
    assert.equal(app.nutTrainingForDay('2026-08-19').rest, true, 'Wednesday is untouched by it');
  });

  test('targets follow the scheduled day — lower body gets the carb bump', () => {
    start();
    const base = { kcal: 2600, protein_g: 180, carbs_g: 300, fat_g: 70 };
    schedule(TODAY(), 2);
    const lower = app.nutAdjustForDay(base, TODAY());
    seed(`blab_calendar_v1_${UID}`, { sessions: [], customs: [] });
    const restDay = app.nutAdjustForDay(base, TODAY());
    assert.equal(lower.carbs_g, 340, 'lower body +40g carbs');
    assert.equal(restDay.carbs_g, 270, 'rest day −30g carbs');
    assert.ok(lower.kcal > restDay.kcal, 'and a training day is not the same as a rest day');
  });

  // v4.9.185, from Training: a calendar entry may be a PLANNED rest day, which is
  // scheduled but is still rest. .182 only checked for a BLAB session, so a
  // planned rest day fell through to the custom branch and took STANDARD targets
  // — the opposite of what a rest day should get.
  test('a planned rest day takes rest-day targets, not training ones', () => {
    start();
    seed(`blab_calendar_v1_${UID}`, {
      sessions: [],
      customs: [{ id: 'r1', cat: 'REST', label: 'Rest', scheduledDate: PAST, status: 'pending' }],
    });
    const t = app.nutTrainingForDay(PAST);
    assert.equal(t.rest, true, 'rest');
    assert.equal(t.scheduled, true, 'but it IS on the calendar — not the same as an empty day');
    const base = { kcal: 2600, protein_g: 180, carbs_g: 300, fat_g: 70 };
    assert.equal(app.nutAdjustForDay(base, PAST).carbs_g, 270, 'carbs come down like any rest day');
  });

  test('the day label comes from Training public API, not its internals', () => {
    start();
    schedule(TODAY(), 3);
    assert.equal(app.blabDayLabel(3), 'Upper Body — Chins', 'the public accessor answers');
    assert.equal(app.nutTrainingForDay(TODAY()).label, 'Upper Body — Chins', 'and that is what nutrition shows');
    assert.equal(app.blabDayLabel(9), '', 'out-of-range returns empty rather than throwing');
  });

  // Training, v4.9.186: blabCalSessionsOn is an AGENDA, not history — it excludes
  // completed and skipped entries. So the moment Jon finishes his 4:30am session
  // the day looks empty, and his targets silently drop to rest-day levels ON THE
  // DAY HE TRAINED. Macro targets want "did he train", not "is he due to".
  test('finishing the session does not turn a training day into a rest day', () => {
    start();
    seed(`blab_calendar_v1_${UID}`, {
      sessions: [{ blabWeek: 1, blabDay: 2, scheduledDate: PAST, status: 'completed', completedDate: PAST }],
      customs: [],
    });
    const t = app.nutTrainingForDay(PAST);
    assert.equal(t.rest, false, 'still a training day after it is done');
    assert.equal(t.label, 'Lower Body', 'and still named');
    const base = { kcal: 2600, protein_g: 180, carbs_g: 300, fat_g: 70 };
    assert.equal(app.nutAdjustForDay(base, PAST).carbs_g, 340, 'keeps the training-day carbs');
  });

  // Training, v4.9.188: nothing ages an unattended session into 'skipped', so a PAST
  // day can read 'due' forever. That is "was scheduled, never resolved" — not
  // evidence he trained. Crediting it would inflate a historical day's targets on
  // the strength of a session there is no record of.
  test('an unresolved past session does not earn training targets', () => {
    start();
    schedule(PAST, 2, 'pending');
    const t = app.nutTrainingForDay(PAST);
    assert.equal(t.state, 'due', 'the calendar still says due');
    assert.equal(t.rest, true, 'but nutrition will not credit it');
    assert.ok(t.label.indexOf('not logged') >= 0, 'and says why on screen');
    const base = { kcal: 2600, protein_g: 180, carbs_g: 300, fat_g: 70 };
    assert.equal(app.nutAdjustForDay(base, PAST).carbs_g, 270, 'rest-day carbs');
  });

  test('the same session TODAY is still due and still earns training targets', () => {
    start();
    schedule(TODAY(), 2, 'pending');
    const t = app.nutTrainingForDay(TODAY());
    assert.equal(t.rest, false, 'today has not happened yet');
    assert.equal(t.label, 'Lower Body', 'named plainly, no caveat');
  });

  test('a second session on a day is disclosed rather than hidden by one label', () => {
    start();
    seed(`blab_calendar_v1_${UID}`, {
      sessions: [{ blabWeek: 1, blabDay: 2, scheduledDate: TODAY(), status: 'pending' }],
      customs: [{ id: 'c1', cat: 'WOD', label: 'Murph', scheduledDate: TODAY(), status: 'pending' }],
    });
    const t = app.nutTrainingForDay(TODAY());
    assert.equal(t.sessions, 2, 'both counted');
    assert.ok(t.label.indexOf('+1 more') >= 0, 'the label admits it is not the whole day');
  });

  test('a corrupt calendar degrades to rest rather than throwing', () => {
    start();
    seed(`blab_calendar_v1_${UID}`, { sessions: null, customs: null });
    const t = app.nutTrainingForDay(TODAY());
    assert.equal(t.rest, true, 'rest');
    assert.equal(t.state, 'none', 'and honestly reports nothing known');
  });

  test('a skipped session does not count as training', () => {
    start();
    seed(`blab_calendar_v1_${UID}`, {
      sessions: [{ blabWeek: 1, blabDay: 2, scheduledDate: PAST, status: 'skipped' }],
      customs: [],
    });
    assert.equal(app.nutTrainingForDay(PAST).rest, true, 'skipped is not trained');
  });

  test('a custom session counts as training rather than rest', () => {
    start();
    seed(`blab_calendar_v1_${UID}`, {
      sessions: [], customs: [{ id: 'c1', cat: 'WOD', label: 'Murph', scheduledDate: TODAY(), status: 'pending' }],
    });
    const t = app.nutTrainingForDay(TODAY());
    assert.equal(t.rest, false, 'not a rest day');
    assert.equal(t.label, 'Murph', 'named from the custom entry');
  });

  // ── The three day surfaces must not drift apart again ─────────────────────

  const renderTab = (tab, weekMode) => {
    app._nutTab = tab;
    if (weekMode) app._nutWeekMode = weekMode;
    const d = dom();
    app.nutRenderScreen();
    return d.html('nut-screen-body');
  };

  test('every day-editing surface offers the same controls', () => {
    setUp(90);
    app.nutSaveRecipes([rec('Sauce')]);
    const days = app._nutSelectedWeekDays();
    app.nutAssignRecipe('r_Sauce', 'lunch', days[0], 1);
    app.nutAssignRecipe('r_Sauce', 'lunch', app._nutToday(), 1);

    ['today', 'meals'].forEach((tab) => {
      const html = renderTab(tab);
      assert.ok(html.indexOf('data-nut-pick') >= 0, `${tab}: + Food present`);
      assert.ok(html.indexOf('data-nut-add-recipe') >= 0, `${tab}: + Recipe present`);
      assert.ok(html.indexOf('data-nut-tick-day') >= 0, `${tab}: tick present`);
      assert.ok(html.indexOf('data-nut-rm') >= 0, `${tab}: remove present`);
    });
    const plan = renderTab('week', 'plan');
    assert.ok(plan.indexOf('data-nut-pick') >= 0, 'planner: + Food present');
    assert.ok(plan.indexOf('data-nut-add-recipe') >= 0, 'planner: + Recipe present');
    app._nutWeekMode = 'overview';
  });

  test('every day-editing surface shows what the day is meant to add up to', () => {
    setUp(90);
    const dk = app._nutToday();
    schedule(dk, 2);
    const target = String(app.nutAdjustForDay(app.nutGetState().targets, dk).kcal);
    ['today', 'meals'].forEach((tab) => {
      assert.ok(renderTab(tab).indexOf(target) >= 0, `${tab}: shows the ${target} kcal target`);
    });
    const plan = renderTab('week', 'plan');
    assert.ok(plan.indexOf(target) >= 0, `planner: shows the ${target} kcal target — it never had one before`);
    assert.ok(plan.indexOf('Lower Body') >= 0, 'planner: names the scheduled session for that day');
    app._nutWeekMode = 'overview';
  });

  test('the planner plans and the today screen logs', () => {
    setUp(90);
    app.nutSaveRecipes([rec('Sauce')]);
    app.nutAssignRecipe('r_Sauce', 'lunch', app._nutToday(), 1);
    assert.ok(renderTab('today').indexOf('|log"') >= 0, 'today asks to log');
    const plan = renderTab('week', 'plan');
    assert.equal(plan.indexOf('|log"'), -1, 'the planner never logs');
    app._nutWeekMode = 'overview';
  });

  // Jon: "need day and date on the card adding to in any of the views" — opened
  // from the planner, every add-sheet looked identical to opening it from Today,
  // so nothing on screen said which day the food was about to land on.
  test('the add sheet names the day it is writing to', () => {
    setUp(90);
    const days = app._nutSelectedWeekDays();
    schedule(days[2], 2, 'completed');
    const stamp = app._nutDayStamp(days[2]);
    assert.ok(stamp.indexOf('Wednesday') >= 0, 'names the weekday');
    assert.ok(stamp.indexOf('Lower Body') >= 0, 'and what is trained that day');
    assert.equal(stamp.indexOf('today'), -1, 'a future day is not marked today');
  });

  test('the add sheet marks today as today', () => {
    setUp(90);
    assert.ok(app._nutDayStamp(app._nutToday()).indexOf('today') >= 0, 'today is called out');
  });

  test('the food picker renders the day it is adding to', () => {
    setUp(90);
    const days = app._nutSelectedWeekDays();
    const d = dom();
    app.nutOpenFoodPicker('lunch', days[2], 'plan');
    const html = d.lastCreatedHtml();
    assert.ok(html.indexOf('Add to Lunch') >= 0, 'slot named');
    assert.ok(html.indexOf('Wednesday') >= 0, 'and the day it lands on');
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
    assert.ok(html.indexOf('data-nut-pick') >= 0, '+ Food control drawn');
    assert.ok(html.indexOf('data-nut-add-recipe') >= 0, '+ Recipe control drawn');
    assert.ok(html.indexOf("|plan\"") >= 0, 'and the planner asks for plan mode, not log');
    assert.equal(html.indexOf("|log\""), -1, 'nothing in the planner logs');
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
