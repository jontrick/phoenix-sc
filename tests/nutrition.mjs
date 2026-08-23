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
    // Listeners are RECORDED, not just accepted. Without this a test can only read
    // the markup a sheet renders, which proves the fields exist and nothing about
    // what the save button does with them — and "the validator validates" is not
    // the same claim as "the validator is on the save path".
    const listeners = new Map();
    const arm = (el) => {
      const orig = el.addEventListener ? el.addEventListener.bind(el) : null;
      el.addEventListener = (ev, fn) => {
        if (!listeners.has(el)) listeners.set(el, {});
        const m = listeners.get(el);
        (m[ev] = m[ev] || []).push(fn);
        if (orig) { try { orig(ev, fn); } catch (_e) {} }
      };
      return el;
    };
    // querySelectorAll on a detached element returns EMPTY, so every control a
    // sheet wires through it was silently inert in these tests — the basis toggle,
    // every category pill, every delegated button in the domain. A markup
    // assertion cannot see that, which is exactly the gap this closes: derive the
    // matching elements from the markup the sheet actually rendered, and arm them.
    const qsa = (host, sel) => {
      const attr = /^\[([\w-]+)\]$/.exec(sel);
      const html = String(host.innerHTML || '');
      const out = [];
      if (attr) {
        const re = new RegExp(attr[1] + '(?:="([^"]*)")?', 'g');
        let m;
        while ((m = re.exec(html)) !== null) {
          const el = arm(origCreate('button'));
          const val = m[1] === undefined ? '' : m[1];
          el.getAttribute = (a) => (a === attr[1] ? val : null);
          out.push(el);
        }
      }
      return out;
    };
    app.document.createElement = (t) => {
      const e = arm(origCreate(t));
      const found = {}, foundAll = {};
      e.querySelector = (sel) => (found[sel] || (found[sel] = arm(origCreate('div'))));
      e.querySelectorAll = (sel) => (foundAll[sel] || (foundAll[sel] = qsa(e, sel)));
      created.push(e);
      return e;
    };
    const fire = (el, ev) => {
      const m = listeners.get(el);
      if (!m || !m[ev] || !m[ev].length) {
        throw new Error('nothing is listening for "' + ev + '" on that element — ' +
                        'the control is inert, which no markup assertion would reveal');
      }
      m[ev].forEach((fn) => fn({ target: el }));
    };
    return {
      node: (id) => nodes[id] || (nodes[id] = make()),
      html: (id) => String((nodes[id] || {}).innerHTML || ''),
      lastCreatedHtml: () => String((created[created.length - 1] || {}).innerHTML || ''),
      lastCreated: () => created[created.length - 1] || null,
      fire,
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

  // ── Label scanner: the basis rule ────────────────────────────────────────
  // A wrong basis is SILENT, permanent once saved as a custom food, and invisible
  // downstream — 250 kcal per serving and 250 kcal per 100g are the same shape.
  // So the refusal cases matter more than the happy path here.

  test('LABEL per-100g values are used exactly as printed', () => {
    setUp(90);
    const r = app._nutLabelToPer100({ k: 380, p: 8.2, c: 62, f: 11.5 }, 'per100');
    assert.equal(r.ok, true, 'per 100g needs no conversion');
    assert.equal(r.per100.k, 380, 'kcal unchanged');
    assert.equal(r.per100.p, 8.2, 'protein unchanged');
    assert.equal(r.serving_g, 0, 'and there is no serving size to remember');
  });

  test('LABEL per-serving WITH a gram weight converts, and remembers the serving', () => {
    setUp(90);
    // A 40g serving reading 152 kcal is a 380 kcal/100g food.
    const r = app._nutLabelToPer100({ k: 152, p: 3.28, c: 24.8, f: 4.6 }, 'serving', 40);
    assert.equal(r.ok, true, 'grams make the conversion possible');
    assert.equal(r.per100.k, 380, '152 kcal per 40g is 380 per 100g');
    assert.equal(r.per100.p, 8.2, 'protein scales by the same factor');
    assert.equal(r.serving_g, 40,
      'the serving size is KEPT — it is what turns "2 servings" into grams later');
  });

  test('LABEL per-serving with NO gram weight is REFUSED, never assumed to be 100g', () => {
    setUp(90);
    // "Per serving (2 biscuits)" — no gram weight anywhere on the label.
    [undefined, null, '', 0, -5, 'two biscuits', NaN].forEach((bad) => {
      const r = app._nutLabelToPer100({ k: 250, p: 4, c: 30, f: 12 }, 'serving', bad);
      assert.equal(r.ok, false,
        'refused for serving size ' + JSON.stringify(bad) +
        ' — guessing 100g here is silently wrong forever, and nothing downstream can detect it');
      assert.equal(r.reason, 'serving_size_missing', 'and says why, so the sheet can ask');
    });
  });

  test('LABEL an unknown basis is REFUSED rather than defaulted to per-100g', () => {
    setUp(90);
    [undefined, null, '', 'per_100', '100g', 'serving_size'].forEach((bad) => {
      const r = app._nutLabelToPer100({ k: 250, p: 4, c: 30, f: 12 }, bad, 40);
      assert.equal(r.ok, false,
        'basis ' + JSON.stringify(bad) + ' refused — defaulting to per100 would be the ' +
        'silent-wrong-basis bug arriving through the back door');
      assert.equal(r.reason, 'basis_unknown', 'named distinctly from a missing serving size');
    });
  });

  test('LABEL junk macro values become 0 rather than NaN reaching the day total', () => {
    setUp(90);
    const r = app._nutLabelToPer100({ k: 'abc', p: -3, c: null, f: undefined }, 'per100');
    assert.equal(r.ok, true, 'a bad macro is not a reason to refuse the whole food');
    assert.equal(r.per100.k, 0, 'unparseable becomes 0');
    assert.equal(r.per100.p, 0, 'negative becomes 0 — a negative macro is never real');
    assert.ok(!isNaN(r.per100.c + r.per100.f), 'nothing NaN escapes into the totals');
  });

  // ── Label scanner: the rule must be ON THE SAVE PATH ─────────────────────
  // Peptides' finding, applied to my own feature before it ships. Their guard
  // proved a sanitiser sanitises; it could not prove the sanitiser was on the
  // write path, so a new write bypassing it would have kept every gate green.
  // The tests above prove _nutLabelToPer100 refuses correctly. They prove NOTHING
  // about whether the save button consults it. These drive the button.

  const scanner = () => {
    const d = dom();
    app.nutOpenLabelScanner('lunch', app._nutToday());
    const ov = d.lastCreated();
    const set = (sel, v) => { ov.querySelector(sel).value = v; };
    return {
      ov, d, set,
      basis: (which) => {
        const all = ov.querySelectorAll('[data-nut-lb-basis]');
        const hit = all.filter((b) => b.getAttribute('data-nut-lb-basis') === which)[0];
        if (!hit) throw new Error('no basis button rendered for ' + which);
        return hit;
      },
      save:  () => d.fire(ov.querySelector('#nut-lb-save'), 'click'),
      err:   () => String(ov.querySelector('#nut-lb-err').textContent || ''),
      foods: () => (app.nutGetState().custom_foods || []),
    };
  };

  test('CHOKE POINT the save button REFUSES a per-serving label with no gram weight', () => {
    setUp(90);
    const s = scanner();
    s.set('#nut-lb-name', 'Biscuits');
    s.set('#nut-lb-kcal', '250'); s.set('#nut-lb-prot', '4');
    s.set('#nut-lb-carb', '30');  s.set('#nut-lb-fat', '12');
    // Choose per-serving, leave the serving size empty — "per serving (2 biscuits)".
    s.d.fire(s.basis('serving'), 'click');
    s.save();
    assert.equal(s.foods().length, 0,
      'NOTHING was saved — the refusal is enforced at the save, not merely available ' +
      'in a helper the save could have skipped');
    assert.ok(s.err().indexOf('serving size') >= 0,
      'and Jon is told what is missing and where to find it: got "' + s.err() + '"');
  });

  test('CHOKE POINT the save button REFUSES when no basis has been chosen', () => {
    setUp(90);
    const s = scanner();
    s.set('#nut-lb-name', 'Granola');
    s.set('#nut-lb-kcal', '380');
    s.save();                                   // never touched the basis toggle
    assert.equal(s.foods().length, 0,
      'no basis means no save — defaulting to per-100g here would be the silent ' +
      'wrong-basis bug arriving through the UI instead of the helper');
    assert.ok(s.err().length > 0, 'with a message rather than a dead button');
  });

  test('CHOKE POINT a per-serving label WITH grams saves converted, and keeps the serving', () => {
    setUp(90);
    const s = scanner();
    s.set('#nut-lb-name', 'Granola');
    s.set('#nut-lb-kcal', '152'); s.set('#nut-lb-prot', '3.28');
    s.set('#nut-lb-carb', '24.8'); s.set('#nut-lb-fat', '4.6');
    s.d.fire(s.basis('serving'), 'click');
    s.set('#nut-lb-serve', '40');
    s.save();
    const f = s.foods()[0];
    assert.ok(f, 'the food saved once the label could actually be interpreted');
    assert.equal(f.k, 380, 'stored PER 100G, because every consumer multiplies qty_g/100');
    assert.equal(f.serving_g, 40, 'and the serving size is kept for the servings input');
    assert.equal(f.defaultQty, 40, 'so adding it defaults to exactly one serving');
  });

  test('CHOKE POINT a per-100g label saves untouched', () => {
    setUp(90);
    const s = scanner();
    s.set('#nut-lb-name', 'Oats');
    s.set('#nut-lb-kcal', '389'); s.set('#nut-lb-prot', '17');
    s.d.fire(s.basis('per100'), 'click');
    s.save();
    const f = s.foods()[0];
    assert.ok(f, 'saved');
    assert.equal(f.k, 389, 'no conversion applied to a per-100g label');
    assert.equal(f.serving_g, 0, 'and no serving concept — this one is weighed');
  });

  test('CHOKE POINT a saved label food lands in the meal with the right macros', () => {
    setUp(90);
    const s = scanner();
    s.set('#nut-lb-name', 'Granola');
    s.set('#nut-lb-kcal', '152');
    s.d.fire(s.basis('serving'), 'click');
    s.set('#nut-lb-serve', '40');
    s.save();
    // The whole point of storing per-100g: the six existing consumers keep working.
    const day = app.nutGetState().daily[app._nutToday()];
    const comp = day.meals.lunch.components[0];
    assert.equal(comp.qty_g, 40, 'one serving went in as 40 GRAMS, not as "1"');
    assert.equal(Math.round(comp.k * comp.qty_g / 100), 152,
      'and the standard qty_g/100 maths gives back the 152 kcal printed on the label');
  });

  // ── Building a recipe: an ingredient that is not in the library yet ──────
  // Jon's report: adding an ingredient to a new recipe gave no way to photograph
  // a label. The recipe builder uses its OWN picker (_nutOpenPickerForRecipe),
  // separate from the day view's food picker, and it could only SELECT — so any
  // ingredient not already in the library made the recipe unbuildable, and with
  // no foods matching the filter the sheet was a dead end.

  test('ENTRY the recipe ingredient picker offers a label scan and a custom food', () => {
    setUp(90);
    const d = dom();
    app._nutOpenPickerForRecipe(() => {});
    const html = String(d.lastCreated().querySelector('#nut-fpr-list').innerHTML || '');
    assert.ok(html.length > 0, 'the list rendered at all — otherwise the checks below are vacuous');
    assert.ok(html.indexOf('data-fpr-scan') >= 0,
      'the recipe picker offers SCAN FOOD LABEL — this is the gap Jon reported');
    assert.ok(String(html).indexOf('data-fpr-custom') >= 0,
      'and a manual custom food, so the picker is never a dead end');
  });

  test('ENTRY the empty recipe picker is not a dead end', () => {
    setUp(90);
    const d = dom();
    app._nutOpenPickerForRecipe(() => {});
    const ov = d.lastCreated();
    // Filter to something that matches nothing.
    const search = ov.querySelector('#nut-fpr-search');
    search.value = 'zzzz-no-such-food';
    d.fire(search, 'input');
    const html = String(ov.querySelector('#nut-fpr-list').innerHTML || '');
    assert.ok(html.indexOf('No foods found') >= 0, 'the empty state really is showing');
    assert.ok(html.indexOf('data-fpr-scan') >= 0,
      'and it STILL offers a way to create one — previously this was a dead end ' +
      'with no exit but closing the sheet');
  });

  test('ENTRY a label scanned FROM a recipe goes into the recipe, not into lunch', () => {
    setUp(90);
    let handedBack = null;
    const d = dom();
    app._nutOpenPickerForRecipe((food, qty) => { handedBack = { food, qty }; });
    const picker = d.lastCreated();
    d.fire(picker.querySelector('[data-fpr-scan]'), 'click');

    // The scanner is now the most recently created overlay, stacked over the picker.
    const ov = d.lastCreated();
    const set = (sel, v) => { ov.querySelector(sel).value = v; };
    set('#nut-lb-name', 'Tahini');
    set('#nut-lb-kcal', '178');
    const basis = ov.querySelectorAll('[data-nut-lb-basis]')
                    .filter((b) => b.getAttribute('data-nut-lb-basis') === 'per100')[0];
    d.fire(basis, 'click');
    d.fire(ov.querySelector('#nut-lb-save'), 'click');

    assert.ok(handedBack, 'the food was handed back to the recipe builder');
    assert.equal(handedBack.food.n, 'Tahini', 'and it is the one just scanned');
    assert.equal(handedBack.food.k, 178, 'with its macros intact');

    // The bug this design avoids: a recipe ingredient silently logged as eaten.
    const day = app.nutGetState().daily[app._nutToday()] || {};
    const lunch = (day.meals && day.meals.lunch && day.meals.lunch.components) || [];
    assert.equal(lunch.length, 0,
      'and NOTHING was logged to lunch — an ingredient of a recipe being written ' +
      'is not something Jon has eaten today');
  });

  test('ENTRY a custom food added FROM a recipe also goes into the recipe', () => {
    setUp(90);
    let handedBack = null;
    const d = dom();
    app._nutOpenPickerForRecipe((food, qty) => { handedBack = { food, qty }; });
    const picker = d.lastCreated();
    d.fire(picker.querySelector('[data-fpr-custom]'), 'click');
    const ov = d.lastCreated();
    ov.querySelector('#nut-cf-name').value = 'Miso paste';
    ov.querySelector('#nut-cf-kcal').value = '199';
    d.fire(ov.querySelector('#nut-cf-save'), 'click');
    assert.ok(handedBack, 'handed back rather than logged');
    assert.equal(handedBack.food.n, 'Miso paste', 'the food just entered');
    const day = app.nutGetState().daily[app._nutToday()] || {};
    const lunch = (day.meals && day.meals.lunch && day.meals.lunch.components) || [];
    assert.equal(lunch.length, 0, 'and again nothing was logged as eaten');
  });

  test('ENTRY the day view still LOGS a scanned food, unchanged by the recipe path', () => {
    setUp(90);
    const d = dom();
    app.nutOpenLabelScanner('lunch', app._nutToday());   // no callback = the day path
    const ov = d.lastCreated();
    ov.querySelector('#nut-lb-name').value = 'Oats';
    ov.querySelector('#nut-lb-kcal').value = '389';
    const basis = ov.querySelectorAll('[data-nut-lb-basis]')
                    .filter((b) => b.getAttribute('data-nut-lb-basis') === 'per100')[0];
    d.fire(basis, 'click');
    d.fire(ov.querySelector('#nut-lb-save'), 'click');
    const comps = app.nutGetState().daily[app._nutToday()].meals.lunch.components;
    assert.equal(comps.length, 1,
      'adding the callback did not divert the day path — the meal write still happens');
    assert.equal(comps[0].n, 'Oats', 'and it is the scanned food');
  });

  // ── Panel caps: the half of the keyboard fix the helper cannot do ─────────
  // Peptides found this by shipping it. _phxKeyboardSafe shrinks the OVERLAY to
  // the visible area, but a panel capped in `vh` is measured against the FULL
  // viewport and does not shrink with it. With align-items:flex-end pinning the
  // panel's bottom to the overlay's bottom, the excess overflows UPWARD, off the
  // top of the screen — taking the inputs with it and leaving the save button
  // perfectly visible. The sheet looks fine and "is the helper armed?" passes.
  //
  // Driving the openers rather than grepping the file, so this only ever speaks
  // about nutrition's own sheets and cannot fail on another domain's markup.
  const noVhCap = (html, who) => {
    const m = /max-height:\s*(\d+)vh/.exec(html || '');
    assert.equal(m ? m[0] : 'none', 'none',
      who + ' caps its panel in vh — it will not shrink when the overlay does, ' +
      'and the overflow goes off the TOP of the screen, not the bottom');
  };

  // NOT THE COVERAGE GUARD — the hand-written list below is a sample, and a sheet
  // added tomorrow will not appear in it. The authority is the mechanical
  // enumeration in harness.mjs (KEYBOARD:), which walks every nut/_nut function
  // that appends an overlay. This case earns its place by inspecting the markup
  // these openers REALLY render, which reading the source cannot do.
  test('ENTRY armed nutrition sheets cap their panel in %, never vh', () => {
    setUp(90);
    app.nutSaveRecipes([rec('Chilli Sauce')]);
    const days = app._nutSelectedWeekDays();
    app.nutAssignRecipe('r_Chilli Sauce', 'lunch', days[0], 2);
    const today = app._nutToday();
    const d = dom();
    const drive = [
      ['nutOpenSetup',       () => app.nutOpenSetup()],
      ['nutOpenPrepCard',    () => app.nutOpenPrepCard()],
      ['nutOpenShopList',    () => app.nutOpenShopList()],
      ['nutOpenFoodPicker',  () => app.nutOpenFoodPicker('lunch', today, 'log')],
      ['nutOpenRecipePicker',() => app.nutOpenRecipePicker('lunch', today)],
      ['nutOpenMealLog',     () => app.nutOpenMealLog('lunch')],
      ['nutOpenSuppModal',   () => app.nutOpenSuppModal(today)],
      ['nutOpenRepeatDay',   () => app.nutOpenRepeatDay(days[0])],
      ['nutOpenRecipeBuilder',   () => app.nutOpenRecipeBuilder()],
      ['nutOpenCustomFoodModal', () => app.nutOpenCustomFoodModal('lunch', today)],
    ];
    let drawn = 0;
    drive.forEach(([name, open]) => {
      open();
      const html = d.lastCreatedHtml();
      assert.ok(html && html.length > 0, name + ' produced no markup — it did not open');
      noVhCap(html, name);
      drawn++;
    });
    assert.equal(drawn, 10, 'every armed sheet was actually opened and inspected');
  });

  // ══ CONTRACT — _phxKeyboardSafe, called by Training and Peptides ═══════════
  // Provider-side, because a consumer's suite going red means the break already
  // shipped past the owner. Meanings, not just shapes.

  const kbViewport = (visibleHeight) => {
    const listeners = {};
    app.visualViewport = {
      height: visibleHeight, offsetTop: 0,
      addEventListener: (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); },
      removeEventListener: (ev, fn) => { listeners[ev] = (listeners[ev] || []).filter(f => f !== fn); },
      _fire: (ev) => (listeners[ev] || []).forEach(f => f()),
      _count: () => (listeners.resize || []).length,
    };
    return app.visualViewport;
  };

  test('CONTRACT _phxKeyboardSafe: sizes any overlay, knowing nothing of its contents', () => {
    setUp(90);
    kbViewport(400);
    app.document.body.contains = () => true;
    const ov = app.document.createElement('div');     // bare element, no structure
    app._phxKeyboardSafe(ov);
    assert.equal(ov.style.height, '400px', 'sized to the visible area');
    assert.equal(ov.style.bottom, 'auto', 'so a flex-end panel clears the keyboard');
    delete app.visualViewport;
  });

  test('CONTRACT _phxKeyboardSafe: SELF-DETACHES — the listener outlives the element', () => {
    setUp(90);
    const vv = kbViewport(400);
    let present = true;
    app.document.body.contains = () => present;
    app._phxKeyboardSafe(app.document.createElement('div'));
    assert.equal(vv._count(), 1, 'listening while the sheet is open');
    present = false;
    vv._fire('resize');
    assert.equal(vv._count(), 0,
      'and gone once it closes — visualViewport is a GLOBAL, so a caller that ' +
      'opens sheets repeatedly would otherwise leak one listener per open, each ' +
      'firing against a detached node');
    delete app.visualViewport;
  });

  test('CONTRACT _phxKeyboardSafe: no visualViewport is a NO-OP, not an error', () => {
    setUp(90);
    delete app.visualViewport;
    const ov = app.document.createElement('div');
    ov.style.height = '';
    app._phxKeyboardSafe(ov);
    assert.equal(ov.style.height, '', 'older WebViews keep the normal sheet');
  });

  test('CONTRACT _phxKeyboardSafe: never throws, whatever it is handed', () => {
    setUp(90);
    kbViewport(400);
    app._phxKeyboardSafe(null);
    app._phxKeyboardSafe(undefined);
    app._phxKeyboardSafe({});
    assert.ok(true, 'no throw reached the caller');
    delete app.visualViewport;
  });

  // Training asked whether two overlays armed at once fight over the viewport —
  // its score-entry sheet can have an RPE flow and a rest overlay open together.
  // It offered to establish this itself; it is the helper's contract, so it is
  // mine to answer, and with a test rather than reasoning.
  test('CONTRACT _phxKeyboardSafe: stacked overlays size independently, no fight', () => {
    setUp(90);
    const vv = kbViewport(844);
    app.document.body.contains = () => true;
    const a = app.document.createElement('div');
    const b = app.document.createElement('div');
    app._phxKeyboardSafe(a);
    app._phxKeyboardSafe(b);
    vv.height = 400;
    vv._fire('resize');
    assert.equal(a.style.height, '400px', 'the first sheet clears the keyboard');
    assert.equal(b.style.height, '400px', 'and so does the second');
    assert.equal(vv._count(), 2, 'each holds its own listener, bound to its own element');
    delete app.visualViewport;
  });

  test('CONTRACT _phxKeyboardSafe: closing one stacked overlay does not deafen the other', () => {
    setUp(90);
    const vv = kbViewport(844);
    const a = app.document.createElement('div');
    const b = app.document.createElement('div');
    const gone = new Set();
    app.document.body.contains = (el) => !gone.has(el);
    app._phxKeyboardSafe(a);
    app._phxKeyboardSafe(b);
    gone.add(a);                                  // the top sheet closes
    vv.height = 400;
    vv._fire('resize');
    assert.equal(vv._count(), 1, 'only the closed sheet detached');
    vv.height = 300;
    vv._fire('resize');
    assert.equal(b.style.height, '300px', 'the one still open keeps tracking the keyboard');
    delete app.visualViewport;
  });

  test('CONTRACT _phxKeyboardSafe: call it ONCE per overlay', () => {
    setUp(90);
    const vv = kbViewport(400);
    app.document.body.contains = () => true;
    const ov = app.document.createElement('div');
    app._phxKeyboardSafe(ov);
    app._phxKeyboardSafe(ov);
    assert.equal(vv._count(), 2,
      'a second call registers a second listener — it does not de-duplicate, so ' +
      'callers must not re-arm an overlay they have already armed');
    delete app.visualViewport;
  });

  // ══ KEYBOARD — the field being typed into must not sit under it ════════════
  // Jon: "the keyboard and other heads up things cover what I'm trying to type at
  // the bottom of the screen." Every sheet is position:fixed; inset:0 with
  // align-items:flex-end, so with the keyboard up the panel's lower half renders
  // underneath it. Scrolling inside the panel cannot help — the container itself
  // extends below the keyboard.

  // A visualViewport that reports the shrunken area, as iOS does with the
  // keyboard up. The sandbox has none, which is why this must be injected.
  const withKeyboard = (visibleHeight) => {
    const listeners = {};
    app.visualViewport = {
      height: visibleHeight,
      offsetTop: 0,
      addEventListener: (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); },
      removeEventListener: (ev, fn) => {
        listeners[ev] = (listeners[ev] || []).filter(f => f !== fn);
      },
      _fire: (ev) => (listeners[ev] || []).forEach(f => f()),
      _count: () => (listeners.resize || []).length,
    };
    return app.visualViewport;
  };

  test('KEYBOARD a sheet is sized to the visible area, not the whole screen', () => {
    setUp(90);
    const vv = withKeyboard(400);                 // 844pt screen, keyboard up
    app.document.body.contains = () => true;
    const ov = app.document.createElement('div');
    ov.style.height = ''; ov.style.bottom = '0';
    app._nutKeyboardSafe(ov);
    assert.equal(ov.style.height, '400px', 'the overlay ends where the keyboard begins');
    assert.equal(ov.style.bottom, 'auto', 'so flex-end puts the panel above it');
    delete app.visualViewport;
  });

  test('KEYBOARD the sheet re-fits when the keyboard appears mid-edit', () => {
    setUp(90);
    const vv = withKeyboard(844);                 // no keyboard yet
    app.document.body.contains = () => true;
    const ov = app.document.createElement('div');
    app._nutKeyboardSafe(ov);
    assert.equal(ov.style.height, '844px', 'full height to start');
    vv.height = 400;                              // keyboard comes up
    vv._fire('resize');
    assert.equal(ov.style.height, '400px', 'and it follows');
    delete app.visualViewport;
  });

  test('KEYBOARD listeners detach once the sheet is gone', () => {
    setUp(90);
    const vv = withKeyboard(400);
    let present = true;
    app.document.body.contains = () => present;
    const ov = app.document.createElement('div');
    app._nutKeyboardSafe(ov);
    assert.equal(vv._count(), 1, 'listening while open');
    present = false;                              // sheet closed
    vv._fire('resize');
    assert.equal(vv._count(), 0, 'and not after — these outlive the element otherwise');
    delete app.visualViewport;
  });

  test('KEYBOARD no visualViewport means no change and no throw', () => {
    setUp(90);
    delete app.visualViewport;
    const ov = app.document.createElement('div');
    ov.style.height = '';
    app._nutKeyboardSafe(ov);
    assert.equal(ov.style.height, '', 'older WebViews keep the normal sheet');
  });

  test('KEYBOARD every nutrition sheet that takes typing is wired', () => {
    setUp(90);
    const vv = withKeyboard(400);
    app.document.body.contains = () => true;
    ['nutOpenSetup', 'nutOpenFoodPicker', 'nutOpenCustomFoodModal',
     'nutOpenRecipeBuilder', 'nutOpenRecipePicker'].forEach((fn) => {
      const d = dom();
      app[fn]('lunch', app._nutToday());
      const created = d.lastCreated();
      assert.equal(created && created.style.bottom, 'auto',
        `${fn} sizes its sheet to the visible area`);
    });
    delete app.visualViewport;
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

  // v4.9.212: the weigh-in Jon actually does each morning (_phxMorningSave) writes
  // Supabase daily_weigh_ins and caches it locally — it does NOT call
  // nutRecordWeight, whose only caller (submitWeightCheckin) is orphaned behind a
  // force-hidden banner. Without reading that cache, every weight-derived number
  // here runs off athlete.bw, which the morning save does not touch either.
  test('WEIGHT the live morning weigh-in reaches the targets', () => {
    start();
    app.nutSaveState({ setup_done: true, daily: {} });
    app.athlete = { id: UID, bw: 95 };                         // stale onboarding weight
    seed('phoenix_last_weighin', { date: '2026-08-22', weight_kg: 88.4 });
    const cur = app._nutCurrentWeight();
    assert.equal(cur.kg, 88.4, 'this morning, not the profile snapshot');
    assert.equal(cur.source, 'check-in', 'and it knows where it came from');
  });

  test('WEIGHT the drift prompt fires off the live weigh-in', () => {
    setUp(90);                                                  // targets built at 90kg
    seed('phoenix_last_weighin', { date: '2026-08-22', weight_kg: 85.5 });
    app._nutTab = 'today';
    const d = dom();
    app.nutRenderScreen();
    const html = d.html('nut-screen-body');
    assert.ok(html.indexOf('Targets out of date') >= 0, 'the banner appears');
    assert.ok(html.indexOf('85.5') >= 0, 'showing the weight he actually logged');
    app._nutTab = 'today';
  });

  test('WEIGHT no live weigh-in still falls back rather than breaking', () => {
    start();
    app.nutSaveState({ setup_done: true, daily: {} });
    app.athlete = { id: UID, bw: 88 };
    seed('phoenix_last_weighin', null);
    assert.equal(app._nutCurrentWeight().kg, 88, 'profile weight still used when there is nothing newer');
  });

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

  // v4.9.251 [TRAINING — cross-domain, see commit message]. Both cases below took
  // _nutWeekDays(today)[6] — index 6 of a MONDAY-START week, i.e. Sunday — and called
  // it "a future day". On Sundays that IS today.
  //
  // The consequence differed, and the passing one is the more interesting:
  //   · the nutLogComponent case FAILED, because logging today correctly ticks the
  //     slot. Red one day in seven, blocking all four domains when it lands.
  //   · the nutAddComponent case PASSED — but for the wrong reason. nutAddComponent
  //     never ticks on any day, so on Sundays it asserted nothing about future days
  //     while still reading green. Vacuous six days out of seven is invisible; vacuous
  //     on the seventh is invisible too, because it still passes.
  //
  // Derived from today so it is genuinely future on every day of the week. This file's
  // own header warns about precisely this decay class.
  const futureDay = () => {
    const d = new Date(app._nutToday() + 'T12:00:00');
    d.setDate(d.getDate() + 1);
    const k = app._phxLocalISO ? app._phxLocalISO(d) : d.toISOString().slice(0, 10);
    // Self-verifying: if this ever stops being future, the cases below are asserting
    // something other than what they claim and must fail LOUDLY rather than quietly
    // passing. That is the whole defect being repaired — the nutAddComponent case went
    // green on Sundays while testing today.
    if (k <= app._nutToday()) throw new Error(`futureDay() returned ${k}, which is not after ${app._nutToday()}`);
    return k;
  };

  test('adding a food to a FUTURE day does not mark it eaten', () => {
    setUp(90);
    const future = futureDay();
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
    const future = futureDay();
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
