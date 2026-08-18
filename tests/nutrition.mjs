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
}
