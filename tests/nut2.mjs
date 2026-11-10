// NUTRITION v2 — functional tests (the rebuild, Jon 10 Nov 2026).
// Run: node functional_check.mjs nut2
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const AFCD_SRC = readFileSync(join(HERE, '..', 'nut_afcd.js'), 'utf8');
const AFCD = JSON.parse(AFCD_SRC.slice(AFCD_SRC.indexOf('{'), AFCD_SRC.lastIndexOf('}') + 1));
const UID = 'jon-nut2';
const KEY = `phx_nut_v1_${UID}`;

export default function ({ test, assert, app, signIn, seed, read, reset }) {
  const start = (state) => {
    reset(); signIn(UID);
    if (state !== undefined) seed(KEY, state);
    app.window.NUT_AFCD = AFCD;
    app._nut2Index = null;
    app._nut2BuildIndex();
  };

  test('LIB: all 1,588 AFCD foods load, per 100 g, with the right macros', () => {
    start();
    assert.equal(AFCD.foods.length, 1588);
    const r = app.nut2Search('chicken breast grilled', 'all');
    const g = r.find((f) => f.name === 'Chicken, breast, lean flesh, grilled, no added fat');
    assert.ok(g, 'found: ' + r.slice(0, 3).map((x) => x.name).join(' | '));
    assert.deepEqual([g.kcal, g.p, g.c, g.f], [143, 29.8, 0, 2.5]);
    assert.equal(g.cooked, true);
  });

  test('LIB: raw <-> cooked pairs carry a yield, and the shopping maths uses it', () => {
    start();
    const ck = app.nut2Search('chicken breast grilled', 'cooked')[0];
    assert.ok(ck.rawRef && ck.yield > 0.6 && ck.yield < 0.9, 'grilled chicken yield ~0.75: ' + ck.yield);
    const raw = app.nut2Food(ck.rawRef);
    assert.ok(/raw/i.test(raw.name), raw.name);
    assert.ok(raw.cookedForms.includes(ck.id), 'raw lists its cooked forms');
    const buy = app.nut2RawEquivalent(ck.id, 150);
    assert.equal(buy.ref, ck.rawRef);
    assert.equal(buy.g, Math.round(150 / ck.yield), '150 g grilled -> ~199 g raw to buy');
    const rice = app.nut2Search('rice white boiled', 'cooked')[0];
    assert.ok(rice.yield > 2 && rice.yield < 3.2, 'rice roughly doubles: ' + rice.yield);
    assert.equal(app.nut2RawEquivalent(raw.id, 200).g, 200, 'a raw food is bought as weighed');
  });

  test('LIB: search — every word must match; synonyms; filters; his foods lead', () => {
    start();
    assert.ok(app.nut2Search('hommus', 'all').some((f) => /hummus/i.test(f.name)), 'hommus finds hummus');
    assert.ok(app.nut2Search('coconut milk', 'all').every((f) => /coconut/i.test(f.name) && /milk/i.test(f.name)));
    assert.ok(app.nut2Search('rice', 'raw').every((f) => f.raw));
    app.nut2SaveUserFood({ name: 'Rice crackers — my brand', kcal: 390, p: 8, c: 82, f: 3 });
    const r = app.nut2Search('rice', 'all');
    assert.equal(r[0].name, 'Rice crackers — my brand', 'his own food first');
    assert.deepEqual(app.nut2Search('rice', 'mine').map((f) => f.name), ['Rice crackers — my brand']);
  });

  test('ADD: per-serve converts to per 100 g; no serve weight is refused, never guessed', () => {
    start();
    const r = app.nut2Per100({ kcal: 250, p: 20, c: 10, f: 12 }, 'serve', 50);
    assert.deepEqual([r.kcal, r.p, r.c, r.f], [500, 40, 20, 24]);
    assert.equal(app.nut2Per100({ kcal: 250 }, 'serve', '').reason, 'serving_size_missing');
    assert.equal(app.nut2Per100({ kcal: 250 }, '', 50).reason, 'basis_unknown', 'no default basis');
  });

  test('ADD: a cooked food of his own links to a raw form and converts back for shopping', () => {
    start();
    const rawRice = app.nut2Search('rice white uncooked', 'raw')[0];
    const id = app.nut2SaveUserFood({ name: 'Jasmine rice, cooked (my pot)', kcal: 140, p: 2.7, c: 31, f: 0.3, cooked: true, rawRef: rawRice.id, yield: 2.8 });
    const f = app.nut2Food(id);
    assert.equal(f.cooked, true); assert.equal(f.rawRef, rawRice.id);
    assert.deepEqual(app.nut2RawEquivalent(id, 280), { ref: rawRice.id, g: 100 });
    assert.equal(app.nut2DeleteUserFood(id), true);
    assert.equal(app.nut2Food(id), null);
  });

  test('CLEAR-OUT: first open wipes old foods/recipes/logs but KEEPS weigh-ins and targets', () => {
    start({
      targets: { kcal: 2050, protein_g: 202, carbs_g: 153, fat_g: 70 },
      customFoods: [{ id: 'cf_1', n: 'Old food' }], recipes: [{ id: 'r1' }], weekTemplates: [{ id: 'w' }],
      daily: { '2026-11-01': { weight_kg: 111.2, feeling: 4, meals: { breakfast: { components: [{ n: 'x', k: 100, qty_g: 100 }] } }, supplements: [{ name: 's', kcal: 10 }] } },
    });
    const ns = app._nut2State();
    assert.deepEqual(ns.customFoods, []); assert.deepEqual(ns.recipes, []); assert.deepEqual(ns.weekTemplates, []);
    const d = read(KEY).daily['2026-11-01'];
    assert.equal(d.weight_kg, 111.2, 'weigh-in kept'); assert.equal(d.feeling, 4, 'feeling kept');
    assert.equal(d.meals, undefined, 'old food log gone'); assert.equal(d.supplements, undefined);
    assert.equal(read(KEY).targets.kcal, 2050, 'cut targets kept');
    assert.ok(read(KEY).v2.created, 'v2 created');
    // a second open does not wipe what he has built since
    app.nut2SaveUserFood({ name: 'Keep me', kcal: 1 });
    const n2 = app._nut2State();
    assert.equal(Object.keys(n2.v2.foods).length, 1, 'his new foods survive the next open');
  });

  test('ROUTE: navTo("nutrition") opens the rebuild; the legacy flag still reaches the old screen', () => {
    start();
    app.window._nut2Enabled = undefined;
    const shown = [];
    const realShow = app.showScreen; app.showScreen = (id) => shown.push(id);
    try { app.navTo('nutrition'); app.window._nut2Enabled = false; app.navTo('nutrition'); }
    finally { app.showScreen = realShow; app.window._nut2Enabled = undefined; }
    assert.deepEqual(shown, ['screen-nut2', 'screen-nutrition']);
  });
}
