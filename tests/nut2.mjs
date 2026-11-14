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

  // ── STAGE 2: recipes ──
  const findOne = (q, filt) => app.nut2Search(q, filt || 'all')[0];

  test('RECIPE serves: pancakes make 8 — per-serve macros are the whole divided by 8', () => {
    start();
    const oats = findOne('oats rolled uncooked'), egg = findOne('egg chicken whole raw');
    const id = app.nut2SaveRecipe({ name: 'Protein pancakes', kind: 'serves', serves: 8, items: [{ ref: oats.id, g: 200 }, { ref: egg.id, g: 300 }] });
    const tot = app.nut2RecipeTotals(app._nut2State().v2.recipes[id]);
    assert.equal(tot.g, 500);
    assert.equal(tot.kcal, Math.round(oats.kcal * 2 + egg.kcal * 3), 'whole recipe = sum of grams x per-100 g');
    const ps = app.nut2RecipePerServe(id);
    assert.equal(ps.kcal, Math.round(tot.kcal / 8));
    assert.equal(ps.g, Math.round(500 / 8), 'serve weight falls back to ingredients / serves');
    assert.equal(ps.weighed, false, 'and says it was not weighed');
  });

  test('RECIPE batch: a 400 g finished sauce — per 100 g uses the FINISHED weight, not the ingredients', () => {
    start();
    const tom = findOne('tomato raw'), oil = findOne('oil olive');
    const id = app.nut2SaveRecipe({ name: 'Tomato sauce', kind: 'batch', finishedG: 400, items: [{ ref: tom.id, g: 600 }, { ref: oil.id, g: 20 }] });
    const tot = app.nut2RecipeTotals(app._nut2State().v2.recipes[id]);
    const p100 = app.nut2RecipePer100(id);
    assert.equal(p100.kcal, Math.round(tot.kcal * 100 / 400), '620 g of ingredients cooked down to 400 g');
    assert.ok(p100.kcal > Math.round(tot.kcal * 100 / 620), 'denser than the raw mix');
  });

  test('RECIPE nesting: the sauce goes into a dish; cycles and missing refs never crash', () => {
    start();
    const tom = findOne('tomato raw'), mince = findOne('beef mince lower fat raw');
    const sauce = app.nut2SaveRecipe({ name: 'Sauce', kind: 'batch', finishedG: 400, items: [{ ref: tom.id, g: 600 }] });
    const dish = app.nut2SaveRecipe({ name: 'Bolognese', kind: 'serves', serves: 4, items: [{ ref: mince.id, g: 500 }, { ref: sauce, g: 200 }] });
    const t = app.nut2RecipeTotals(app._nut2State().v2.recipes[dish]);
    assert.equal(t.kcal, Math.round(mince.kcal * 5 + app.nut2RecipePer100(sauce).kcal * 2));
    assert.deepEqual(app.nut2RecipeUsedBy(sauce), ['Bolognese'], 'deleting the sauce warns');
    const ns = app._nut2State(); ns.v2.recipes[sauce].items.push({ ref: dish, g: 10 }); app._nut2Save(ns);   // a cycle
    assert.ok(app.nut2RecipeTotals(app._nut2State().v2.recipes[dish]).kcal > 0, 'cycle bounded');
    app.nut2DeleteRecipe(sauce);
    assert.equal(app.nut2RecipeTotals(app._nut2State().v2.recipes[dish]).missing, 1, 'a deleted sauce is counted missing, not zeroed silently');
  });

  test('RECIPE save rules: needs a name, a kind, serves >= 1 and a weighed ingredient', () => {
    start();
    const egg = findOne('egg chicken whole raw');
    const id = app.nut2SaveRecipe({ name: '  Eggs  ', kind: 'serves', serves: 0, items: [{ ref: egg.id, g: 0 }, { ref: egg.id, g: 120 }] });
    const r = app._nut2State().v2.recipes[id];
    assert.equal(r.name, 'Eggs'); assert.equal(r.serves, 1, 'serves floor 1');
    assert.equal(r.items.length, 1, 'a zero-gram line is dropped');
  });

  test('RECIPE screen: the tab lists recipes with the right line for each kind', () => {
    start();
    const egg = findOne('egg chicken whole raw');
    app.nut2SaveRecipe({ name: 'A pancakes', kind: 'serves', serves: 8, items: [{ ref: egg.id, g: 400 }] });
    app.nut2SaveRecipe({ name: 'B sauce', kind: 'batch', finishedG: 300, items: [{ ref: egg.id, g: 400 }] });
    const h = app._nut2RecipesTab();
    assert.ok(/Makes 8 &middot; per serve/.test(h) && /300 g batch &middot; per 100 g/.test(h), h.slice(0, 300));
  });

  test('TODAY: old kcal tile and generated meals tile are replaced by one v2 card (entry points, not helpers)', () => {
    signIn('u-today'); reset();
    seed('phx_nut_v1_u-today', { setup_done: true, targets: { kcal: 2703, protein_g: 246, carbs_g: 270, fat_g: 71 }, daily: {} });
    const els = {};
    const mk = id => ({ id, innerHTML: 'OLD', querySelector: () => ({ addEventListener(){} }), querySelectorAll: () => [] });
    els['today-nutrition-tile'] = mk('today-nutrition-tile'); els['today-meals-tile'] = mk('today-meals-tile');
    const orig = app.document.getElementById;
    app.document.getElementById = id => els[id] || (orig ? orig.call(app.document, id) : null);
    try {
      app.nutRenderTile(); app.nutRenderMealsTile();
      assert.ok(/data-n2-today/.test(els['today-nutrition-tile'].innerHTML), els['today-nutrition-tile'].innerHTML.slice(0, 200));
      assert.ok(!/kcal remaining/.test(els['today-nutrition-tile'].innerHTML), 'legacy kcal tile still drawn');
      assert.equal(els['today-meals-tile'].innerHTML, '');
    } finally { app.document.getElementById = orig; }
  });

  test('TARGET: assessed from the LATEST weigh-in; none logged → no target, never a default', () => {
    signIn('u-tgt'); reset();
    seed('phx_nut_v1_u-tgt', { setup_done: true, daily: { '2026-11-01': { weight_kg: 114 }, '2026-11-09': { weight_kg: 112 }, '2026-11-10': { feeling: 4 } } });
    const t = app.nut2Targets();
    assert.equal(t.fromKg, 112); assert.equal(t.kcal, 2070);
    assert.equal(t.protein_g, 202); assert.equal(t.fat_g, 73); assert.equal(t.carbs_g, 151);
    seed('phx_nut_v1_u-tgt', { setup_done: true, daily: {} });
    assert.equal(app.nut2Targets(), null);
    const tile = { innerHTML: '', querySelector: () => ({ addEventListener(){} }) };
    app._nut2TodayTile(tile);
    assert.ok(/Log a weigh-in/.test(tile.innerHTML), tile.innerHTML.slice(0, 200));
  });

  // ── STAGE 3 — day planner + counter ──
  const plan = () => {
    start({ setup_done: true, daily: { '2026-11-09': { weight_kg: 112 } } });
    const d = app._nutToday();
    const egg = findOne('egg chicken whole raw');
    const pid = app.nut2SaveRecipe({ name: 'Pancakes', kind: 'serves', serves: 4, items: [{ ref: egg.id, g: 400 }] });
    return { d, egg, pid };
  };
  test('PLAN defaults: 5 feeds at his times plus the morning drinks; an untouched day is not stored', () => {
    const { d } = plan();
    const day = app.nut2Day(d);
    assert.deepEqual(day.feeds.map((f) => f.time + ' ' + f.name), ['06:00 Morning drinks', '07:00 Breakfast', '12:00 Lunch', '15:30 Snack', '18:30 Dinner', '20:00 Greens shake']);
    assert.equal(read(KEY).v2.days[d], undefined, 'viewing a day writes nothing');
  });
  test('PLAN totals: grams for foods, serves for a serves recipe; eaten = ticked feeds; without drinks excludes them', () => {
    const { d, egg, pid } = plan();
    const i1 = app.nut2AddItem(d, 'F1', egg.id); app.nut2SetItemQty(d, 'F1', i1, '200');
    const i2 = app.nut2AddItem(d, 'F1', pid);
    assert.equal(app.nut2Day(d).feeds[1].items[i2].serves, 1, 'a serves recipe is added as 1 serve');
    app.nut2SetItemQty(d, 'F1', i2, '2');
    const i3 = app.nut2AddItem(d, 'F0', egg.id); app.nut2SetItemQty(d, 'F0', i3, '100');
    const T = app.nut2DayTotals(d);
    const eggK = egg.kcal;
    assert.equal(T.planned.kcal, Math.round(eggK * 2 + eggK * 2 + eggK * 1), 'pancakes: 2 of 4 serves of 400 g egg = 200 g egg');
    assert.equal(T.noDrinks.kcal, Math.round(eggK * 4));
    assert.equal(T.eaten.kcal, 0);
    app.nut2SetFeed(d, 'F1', { eaten: true });
    assert.equal(app.nut2DayTotals(d).eaten.kcal, Math.round(eggK * 4));
  });
  test('PLAN flags: over / under / on against the weight-based target', () => {
    assert.equal(app.nut2Flag(2300, 2070, 'kcal').state, 'over');
    assert.equal(app.nut2Flag(2070, 2070, 'kcal').state, 'on');
    assert.equal(app.nut2Flag(150, 202, 'p').state, 'under');
    assert.equal(app.nut2Flag(150, 202, 'p').diff, -52);
    assert.equal(app.nut2Flag(5, 0, 'p').state, 'none');
  });
  test('PLAN feeds: retime re-sorts; add and remove a feed; a deleted recipe is counted missing, not zero', () => {
    const { d, pid } = plan();
    app.nut2SetFeed(d, 'F5', { time: '05:30' });
    assert.equal(app.nut2Day(d).feeds[0].name, 'Greens shake');
    const nf = app.nut2AddFeed(d);
    assert.equal(app.nut2Day(d).feeds.length, 7);
    assert.ok(app.nut2DelFeed(d, nf)); assert.equal(app.nut2Day(d).feeds.length, 6);
    app.nut2AddItem(d, 'F2', pid); app.nut2DeleteRecipe(pid);
    assert.equal(app.nut2DayTotals(d).planned.missing, 1);
  });
  test('PLAN screen: the plan tab draws the counter with flags and every feed', () => {
    const { d, egg } = plan();
    const i = app.nut2AddItem(d, 'F1', egg.id); app.nut2SetItemQty(d, 'F1', i, '300');
    const h = app._nut2PlanTab();
    assert.ok(/id="n2-counter"/.test(h) && /data-n2-flag="kcal" data-state="under"/.test(h), 'counter with kcal flag');
    assert.ok(/data-n2-flag="p" data-state="under"/.test(h));
    ['Morning drinks', 'Breakfast', 'Lunch', 'Snack', 'Dinner', 'Greens shake'].forEach((n) => assert.ok(h.includes('value="' + n + '"'), n));
    assert.ok(h.includes('data-n2-qty="F1:0"') && h.includes('value="300"'));
  });
  test('PLAN Today card: eaten / target and planned, from the real tile entry point', () => {
    const { d, egg } = plan();
    const i = app.nut2AddItem(d, 'F1', egg.id); app.nut2SetItemQty(d, 'F1', i, '200'); app.nut2SetFeed(d, 'F1', { eaten: true });
    const tile = { innerHTML: '', querySelector: () => ({ addEventListener(){} }) };
    app._nut2TodayTile(tile);
    assert.ok(tile.innerHTML.includes(Math.round(egg.kcal * 2) + ' <span') && /\/ 2070 kcal eaten/.test(tile.innerHTML), tile.innerHTML.slice(0, 300));
    assert.ok(/Planned \d+ kcal/.test(tile.innerHTML));
  });
  test('PLAN mirror: the daily row is the EATEN v2 day against the weight target; null while foods are unloaded', () => {
    const { d, egg } = plan();
    const i = app.nut2AddItem(d, 'F1', egg.id); app.nut2SetItemQty(d, 'F1', i, '200'); app.nut2SetFeed(d, 'F1', { eaten: true });
    const row = app._nutDailyRow(d);
    assert.equal(row.kcal, Math.round(egg.kcal * 2)); assert.equal(row.target_kcal, 2070);
    app.window.NUT_AFCD = undefined;
    assert.equal(app._nutDailyRow(d), null, 'unknown must not be written as a low day');
    app.window.NUT_AFCD = AFCD;
  });

  test('SEARCH: a word must start a word — "rice white cooked" never returns uncooked rice', () => {
    start();
    const r = app.nut2Search('rice white cooked', 'all');
    assert.ok(r.length, 'some cooked white rice');
    assert.ok(r.every((f) => !/uncooked/i.test(f.name)), r.slice(0, 4).map((f) => f.name).join(' | '));
    assert.ok(app.nut2Search('chick breast', 'all').length > 0, 'a word prefix still matches');
  });

  // ── STAGE 4 — copy ──
  test('COPY meal: replaces the same-named feed on each target day, un-ticked; source untouched', () => {
    const { d, egg } = plan();
    const i = app.nut2AddItem(d, 'F1', egg.id); app.nut2SetItemQty(d, 'F1', i, '150'); app.nut2SetFeed(d, 'F1', { eaten: true });
    const d1 = app._nut2ShiftDate(d, 1), d2 = app._nut2ShiftDate(d, 2);
    const j = app.nut2AddItem(d1, 'F1', egg.id); app.nut2SetItemQty(d1, 'F1', j, '999');
    assert.equal(app.nut2CopyFeed(d, 'F1', [d1, d2, d]), 2, 'never onto itself');
    [d1, d2].forEach((x) => {
      const b = app.nut2Day(x).feeds.find((f) => f.name === 'Breakfast');
      assert.deepEqual(b.items.map((it) => it.g), [150], x + ' replaced, not appended');
      assert.equal(b.eaten, false);
    });
    assert.equal(app.nut2Day(d).feeds[1].eaten, true);
  });
  test('COPY day: the whole day is replaced, recipe serves carried', () => {
    const { d, egg, pid } = plan();
    const i = app.nut2AddItem(d, 'F4', pid); app.nut2SetItemQty(d, 'F4', i, '2');
    app.nut2SetFeed(d, 'F4', { name: 'Curry dinner' });
    const d3 = app._nut2ShiftDate(d, 3);
    assert.equal(app.nut2CopyDay(d, [d3]), 1);
    const f = app.nut2Day(d3).feeds.find((x) => x.name === 'Curry dinner');
    assert.ok(f && f.items[0].serves === 2 && f.items[0].ref === pid);
    assert.equal(app.nut2DayTotals(d3).planned.kcal, app.nut2DayTotals(d).planned.kcal);
  });
  test('COPY week: Monday-based; unplanned days in the source leave the target alone', () => {
    start({ setup_done: true, daily: {} });
    const egg = findOne('egg chicken whole raw');
    const mon = '2026-11-09', tue = '2026-11-10', nextTue = '2026-11-17', nextWed = '2026-11-18';
    const i = app.nut2AddItem(tue, 'F1', egg.id); app.nut2SetItemQty(tue, 'F1', i, '100');
    const k = app.nut2AddItem(nextWed, 'F1', egg.id); app.nut2SetItemQty(nextWed, 'F1', k, '55');
    assert.equal(app._nut2Monday('2026-11-15'), mon, 'Sunday belongs to the week that began Monday');
    assert.equal(app.nut2CopyWeek('2026-11-12', 1), 1);
    assert.deepEqual(app.nut2Day(nextTue).feeds[1].items.map((x) => x.g), [100]);
    assert.deepEqual(app.nut2Day(nextWed).feeds[1].items.map((x) => x.g), [55], 'untouched');
  });
  test('COPY screen: every feed has Copy, the day has COPY DAY / COPY WEEK', () => {
    plan();
    const h = app._nut2PlanTab();
    assert.equal((h.match(/data-n2-fcopy=/g) || []).length, 6);
    assert.ok(h.includes('data-n2-dcopy') && h.includes('data-n2-wcopy'));
  });

  // ── STAGE 5 — shopping list ──
  test('SHOP: cooked food is bought as RAW by yield; same food across days adds up', () => {
    const { d } = plan();
    const ck = app.nut2Search('chicken breast grilled', 'cooked')[0];
    const d1 = app._nut2ShiftDate(d, 1);
    [d, d1].forEach((x) => { const i = app.nut2AddItem(x, 'F3', ck.id); app.nut2SetItemQty(x, 'F3', i, '150'); });
    const L = app.nut2ShopList([d, d1]);
    const row = L.items.find((x) => x.ref === ck.rawRef);
    assert.ok(row, 'listed under the raw food: ' + JSON.stringify(L.items));
    assert.equal(row.g, Math.round(300 / ck.yield));
    assert.ok(!L.items.find((x) => x.ref === ck.id), 'never the cooked one');
  });
  test('SHOP: recipes expand to ingredients; whole batches round UP, exact mode does not', () => {
    const { d, egg, pid } = plan();   // pancakes: 4 serves from 400 g egg
    const i = app.nut2AddItem(d, 'F1', pid); app.nut2SetItemQty(d, 'F1', i, '1');
    const d1 = app._nut2ShiftDate(d, 1); const j = app.nut2AddItem(d1, 'F1', pid); app.nut2SetItemQty(d1, 'F1', j, '2');
    const W = app.nut2ShopList([d, d1]);
    assert.deepEqual([W.cook[0].need, W.cook[0].batches], [0.75, 1]);
    assert.equal(W.items.find((x) => x.ref === egg.id).g, 400, 'one whole batch of egg');
    const X = app.nut2ShopList([d, d1], { wholeBatches: false });
    assert.equal(X.items.find((x) => x.ref === egg.id).g, 300, '3 of 4 serves');
  });
  test('SHOP: a batch eaten by weight and a recipe nested in a recipe expand through', () => {
    start({ setup_done: true, daily: {} });
    const egg = findOne('egg chicken whole raw'), d = app._nutToday();
    const sauce = app.nut2SaveRecipe({ name: 'Sauce', kind: 'batch', finishedG: 200, items: [{ ref: egg.id, g: 400 }] });
    const dish = app.nut2SaveRecipe({ name: 'Dish', kind: 'batch', finishedG: 400, items: [{ ref: sauce, g: 100 }, { ref: egg.id, g: 100 }] });
    const i = app.nut2AddItem(d, 'F4', dish); app.nut2SetItemQty(d, 'F4', i, '400');
    const L = app.nut2ShopList([d], { wholeBatches: false });
    assert.equal(L.items.find((x) => x.ref === egg.id).g, 300, '100 g sauce = half the 200 g batch = 200 g egg, + 100 g');
  });
  test('SHOP screen: the tab draws Cook + Buy with raw weights, and ticks persist', () => {
    const { d, egg, pid } = plan();
    const i = app.nut2AddItem(d, 'F1', pid); app.nut2SetItemQty(d, 'F1', i, '1');
    const k = app.nut2AddItem(d, 'F2', egg.id); app.nut2SetItemQty(d, 'F2', k, '1200');
    let h = app._nut2ShopTab();
    assert.ok(/>Cook</.test(h) && h.includes('Pancakes') && /Buy &middot; raw weights/.test(h), h.slice(0, 200));
    assert.ok(h.includes('1.6 kg'), '400 g + 1200 g egg = 1.6 kg');
    assert.equal(app._nut2ShopClick({ getAttribute: (a) => a === 'data-n2s-tick' ? egg.id : null }), true);
    assert.equal(read(KEY).v2.shop.ticks[egg.id], true, 'tick saved');
    h = app._nut2ShopTab();
    assert.ok(/0 of 1 left/.test(h));
  });

  test('TODAYFEEDS: the Today card lists only planned feeds, each with a tick that reflects eaten', () => {
    const { d, egg } = plan();
    const i = app.nut2AddItem(d, 'F1', egg.id); app.nut2SetItemQty(d, 'F1', i, '150');
    const k = app.nut2AddItem(d, 'F4', egg.id); app.nut2SetItemQty(d, 'F4', k, '100');
    app.nut2SetFeed(d, 'F1', { eaten: true });
    const tile = { innerHTML: '', querySelector: () => ({ addEventListener(){} }) };
    app._nut2TodayTile(tile);
    const ticks = tile.innerHTML.match(/data-n2t-eat="[^"]+" aria-pressed="(true|false)"/g) || [];
    assert.deepEqual(ticks.map((x) => x.replace(/.*eat="([^"]+)" aria-pressed="(\w+)"/, '$1:$2')), ['F1:true', 'F4:false']);
    assert.ok(tile.innerHTML.includes('Breakfast') && tile.innerHTML.includes('Dinner') && !tile.innerHTML.includes('Greens shake'), 'empty feeds hidden');
    start({ setup_done: true, daily: { '2026-11-09': { weight_kg: 112 } } });
    app._nut2TodayTile(tile);
    assert.ok(/Nothing planned today/.test(tile.innerHTML));
  });

  // ── v4.9.411 — "each" amounts ──
  test('EACH: 3 eggs in a recipe = 150 g; a meal counts eggs by number; the shop list buys the grams', () => {
    const { d, egg } = plan();
    assert.equal(app.nut2UnitG(egg.id), 50, 'standard egg');
    const rid = app.nut2SaveRecipe({ name: 'Omelette', kind: 'serves', serves: 1, items: [{ ref: egg.id, n: 3 }] });
    const r = read(KEY).v2.recipes[rid];
    assert.deepEqual(r.items, [{ ref: egg.id, n: 3 }], 'stored as a count, not converted');
    assert.equal(app.nut2RecipeTotals(r).g, 150);
    assert.equal(app.nut2RecipeTotals(r).kcal, Math.round(egg.kcal * 1.5));
    const i = app.nut2AddItem(d, 'F1', egg.id); app.nut2SetItemUnit(d, 'F1', i); app.nut2SetItemQty(d, 'F1', i, '2');
    assert.deepEqual(app.nut2Day(d).feeds[1].items[i], { ref: egg.id, n: 2 });
    assert.equal(app.nut2DayTotals(d).planned.kcal, Math.round(egg.kcal));
    assert.equal(app.nut2ShopList([d]).items.find((x) => x.ref === egg.id).g, 100);
  });
  test('EACH toggle: g ⇄ each converts with the size; his own size wins; copies keep the count', () => {
    const { d, egg } = plan();
    const i = app.nut2AddItem(d, 'F1', egg.id); app.nut2SetItemQty(d, 'F1', i, '150');
    app.nut2SetItemUnit(d, 'F1', i);
    assert.deepEqual(app.nut2Day(d).feeds[1].items[i], { ref: egg.id, n: 3 });
    app.nut2SetUnitG(egg.id, 60);
    assert.equal(app.nut2DayTotals(d).planned.kcal, Math.round(egg.kcal * 1.8), '3 × 60 g');
    app.nut2SetItemUnit(d, 'F1', i);
    assert.deepEqual(app.nut2Day(d).feeds[1].items[i], { ref: egg.id, g: 180 });
    app.nut2SetItemUnit(d, 'F1', i);
    const d1 = app._nut2ShiftDate(d, 1); app.nut2CopyFeed(d, 'F1', [d1]);
    assert.deepEqual(app.nut2Day(d1).feeds.find((f) => f.name === 'Breakfast').items, [{ ref: egg.id, n: 3 }]);
  });
  test('EACH unknown size: counts as 0 g (never guessed), save refuses until the size is set', () => {
    start({ setup_done: true, daily: {} });
    const mince = findOne('beef mince raw');
    assert.equal(app.nut2UnitG(mince.id), null);
    assert.equal(app.nut2RecipeTotals({ items: [{ ref: mince.id, n: 2 }] }).g, 0);
    app.nut2SaveRecipe({ name: 'Bad', kind: 'serves', serves: 1, items: [{ ref: mince.id, n: 2 }] });
    const saved = Object.values(read(KEY).v2.recipes).find((r) => r.name === 'Bad');
    assert.deepEqual(saved.items, [], 'an each with no size is dropped like a zero-gram line');
    app.nut2SetUnitG(mince.id, 125);
    assert.equal(app.nut2RecipeTotals({ items: [{ ref: mince.id, n: 2 }] }).g, 250);
  });
  test('EACH screens: the unit button shows on foods, never on recipes; the size row appears for each', () => {
    const { d, egg, pid } = plan();
    const i = app.nut2AddItem(d, 'F1', egg.id); app.nut2SetItemUnit(d, 'F1', i); app.nut2SetItemQty(d, 'F1', i, '2');
    app.nut2AddItem(d, 'F1', pid);
    const h = app._nut2PlanTab();
    assert.ok(h.includes('data-n2-unit="F1:0"') && />each<\/button>/.test(h), 'egg has an each button');
    assert.ok(!h.includes('data-n2-unit="F1:1"'), 'a recipe has no unit button');
    assert.ok(h.includes('data-n2-ug="F1:0"') && h.includes('value="50"'), '1 each = 50 g row');
  });

  // ── v4.9.413 — label reading. Inputs are the ACTUAL text Tesseract produced from test panels. ──
  test('NIP: per-100 g column, g-read-as-9 repaired, wrapped Cal line, %DI column skipped', () => {
    const wrap = 'NUTRITION INFORMATION\nServing size: 30g\nPer Serve Per 100g\nEnergy 481kJ 1600kJ\n(115Cal) (382cCal)\nProtein 3.99 13.09\nFat - Total 2.49 8.09\n- Saturated 0.5¢ 1.69\nCarbohydrate 18.0g 60.09\n- Sugars 0.39 1.09\nDietary Fibre 3.09 10.09\nSodium <5mg <5mg';
    const r = app._nut2ParseNIP(wrap);
    assert.deepEqual([r.kcal, r.p, r.f, r.c, r.fib, r.basis, r.serving_g, r.ok, r.mismatch], [382, 13, 8, 60, 10, 'per100', 30, true, false]);
    const di = 'Avg Qty per Serving  % Daily Intake* per Serving Avg Qty per 100g\nEnergy 612kJ 7% 360kJ\nProtein 15.39 31% 9.09\nFat, total 0.39 0.4% 0.29\n- saturated 0.29 1% 0.19\nCarbohydrate 10.29 3% 6.09\n- sugars 7.09 8% 4.19\nSodium 75mg 3% 44mg';
    const d = app._nut2ParseNIP(di);
    assert.deepEqual([d.kcal, d.p, d.f, d.c, d.sodium_mg], [86, 9, 0.2, 6, 44], 'kJ ÷ 4.184; % column ignored; saturated / sugars rows never taken');
  });
  test('NIP: impossible >100 g per 100 g loses the misread 9; per-serve-only panel is flagged serve; junk fails', () => {
    const r = app._nut2ParseNIP('Per 100g\nEnergy 1500kJ\nProtein 129\nFat, total 5g\nCarbohydrate 609');
    assert.equal(r.p, 12); assert.equal(r.c, 60);
    const s = app._nut2ParseNIP('Serving size: 40g\nQuantity per serving\nEnergy 600kJ\nProtein 8.0g\nFat, total 4.0g\nCarbohydrate 20.0g');
    assert.equal(s.basis, 'serve'); assert.equal(s.serving_g, 40); assert.equal(s.p, 8);
    const bad = app._nut2ParseNIP('A blurry photo of a cat');
    assert.equal(bad.ok, false);
  });
  test('NIP screen: Add Food offers SCAN LABEL (camera) and FROM A PHOTO (library)', () => {
    start({ setup_done: true, daily: {} });
    let html = ''; const orig = app._nut2Sheet;
    app._nut2Sheet = (h) => { html = h; return { querySelector: () => null, querySelectorAll: () => [] }; };
    try { try { app.nut2OpenAddFood(); } catch (_e) {} } finally { app._nut2Sheet = orig; }
    assert.ok(/id="n2f-cam" type="file" accept="image\/\*" capture="environment"/.test(html), 'camera input');
    assert.ok(/id="n2f-pic" type="file" accept="image\/\*" style/.test(html), 'photo-library input, no capture');
  });

  test('PICKNEW: the meal / recipe food picker offers + NEW FOOD (scan, photo or type)', () => {
    start({ setup_done: true, daily: {} });
    let html = ''; const orig = app._nut2Sheet;
    const el = () => ({ addEventListener(){}, focus(){}, querySelectorAll: () => [], value: '', innerHTML: '' });
    app._nut2Sheet = (h) => { html = h; return { querySelector: el, querySelectorAll: () => [] }; };
    try { app.nut2OpenPicker('Add to Breakfast', () => {}); } finally { app._nut2Sheet = orig; }
    assert.ok(/id="n2p-new"[^>]*>\+ NEW FOOD/.test(html), html.slice(0, 400));
  });

  // ── v4.9.416 — import foods from a CSV file ──
  test('CSV: headings found in any order; quoted names with commas; kJ-only converts; bad rows skipped with a reason', () => {
    const csv = '﻿Food,Protein (g),Fat,Carbohydrate,Sugars,Fibre,Energy kJ\n"Muesli, toasted",10.5,12,60,20,8,1800\nBad row,abc,1,2,,,500\nToo much,150,1,1,,,100\n';
    const P = app.nut2ParseFoodsCsv(csv);
    assert.deepEqual(P.missing, []); assert.equal(P.kj, true);
    assert.deepEqual([P.rows[0].name, P.rows[0].kcal, P.rows[0].p, P.rows[0].c, P.rows[0].f, P.rows[0].fib, P.rows[0].ok], ['Muesli, toasted', 430, 10.5, 60, 12, 8, true], 'carbs not sugars; kJ ÷ 4.184');
    assert.equal(P.rows[1].ok, false); assert.ok(/protein/.test(P.rows[1].why));
    assert.equal(P.rows[2].ok, false); assert.ok(/over 100/.test(P.rows[2].why));
  });
  test('CSV: semicolon / tab files; wrong headings name what is missing', () => {
    assert.equal(app.nut2ParseFoodsCsv('Name;kcal;Protein;Carbs;Fat\nOats;379;13,2;60;7\n').rows[0].p, 13.2, 'semicolon + decimal comma');
    assert.equal(app.nut2ParseFoodsCsv('Name\tCalories\tProtein\tCarbs\tFat\nRice\t130\t2.7\t28\t0.3\n').rows[0].kcal, 130);
    assert.deepEqual(app.nut2ParseFoodsCsv('Item,Price\nMilk,2\n').missing, ['kcal (or kJ)', 'protein', 'carbs', 'fat']);
  });
  test('CSV import: adds new foods, UPDATES a same-named one (keeps its cooked link), never duplicates', () => {
    start({ setup_done: true, daily: {} });
    const raw = findOne('beef mince raw');
    const old = app.nut2SaveUserFood({ name: 'Mince patty', kcal: 200, p: 20, c: 0, f: 12, cooked: true, rawRef: raw.id, yield: 0.7 });
    const P = app.nut2ParseFoodsCsv('Name,kcal,Protein,Carbs,Fat\nmince patty,220,22,1,13\nGreek yoghurt,60,10,4,0.2\n');
    assert.deepEqual(app.nut2ImportFoods(P.rows), { added: 1, updated: 1 });
    const foods = read(KEY).v2.foods;
    assert.equal(Object.keys(foods).length, 2);
    assert.deepEqual([foods[old].kcal, foods[old].cooked, foods[old].rawRef, foods[old].yield, foods[old].source], [220, true, raw.id, 0.7, 'import']);
  });
  test('CSV screen: the Library has an IMPORT FILE picker for CSV', () => {
    start({ setup_done: true, daily: {} });
    const h = app._nut2LibraryShell();
    assert.ok(/IMPORT FILE<input data-n2-import type="file" accept="\.csv/.test(h), h.slice(0, 300));
  });

  // ── v4.9.417 — Open Food Facts link / barcode ──
  test('OFF barcode: check digit validated; pulled from a pasted link or loose text; a misread digit is refused', () => {
    assert.equal(app.nut2ValidBarcode('9300652010015'), true);
    assert.equal(app.nut2ValidBarcode('9300652010016'), false, 'one digit off');
    assert.equal(app.nut2ValidBarcode('4006381333931'), true);
    assert.equal(app.nut2BarcodeFrom('https://au.openfoodfacts.org/product/9300652010015/weet-bix-sanitarium'), '9300652010015');
    assert.equal(app.nut2BarcodeFrom('https://world.openfoodfacts.org/cgi/x/product/4006381333931'), '4006381333931');
    assert.equal(app.nut2BarcodeFrom('9 300652 010015'), '9300652010015', 'spaced as printed under the bars');
    assert.equal(app.nut2BarcodeFrom('9300652010016'), null);
    assert.equal(app.nut2BarcodeFrom('https://www.woolworths.com.au/shop/productdetails/12345/weet-bix'), null);
  });
  test('OFF mapping: per-100 g fields; kJ-only converts; brand prefixed once; no panel → null', () => {
    const f = app.nut2FromOFF({ status: 1, code: '9300652010015', product: { product_name: 'Weet-Bix', brands: 'Sanitarium,Weet-Bix', serving_quantity: '30',
      nutriments: { 'energy-kcal_100g': 362, proteins_100g: 12.1, carbohydrates_100g: 66.9, fat_100g: 1.4, fiber_100g: 11 } } });
    assert.deepEqual([f.name, f.kcal, f.p, f.c, f.f, f.fib, f.serving_g], ['Sanitarium Weet-Bix', 362, 12.1, 66.9, 1.4, 11, 30]);
    assert.equal(app.nut2FromOFF({ status: 1, product: { product_name: 'X', nutriments: { energy_100g: 1515, proteins_100g: 1, carbohydrates_100g: 2, fat_100g: 3 } } }).kcal, 362);
    assert.equal(app.nut2FromOFF({ status: 1, product: { product_name: 'Water', nutriments: {} } }), null);
    assert.equal(app.nut2FromOFF({ status: 0 }), null);
  });
  test('OFF lookup: calls the v2 product endpoint; not found and offline give plain messages', async () => {
    const real = app.fetch; let url = '';
    const done = (fn) => new Promise((res) => app.nut2LookupOFF('9300652010015', res));
    try {
      app.fetch = (u) => { url = u; return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ status: 1, code: '9300652010015', product: { product_name: 'Weet-Bix', nutriments: { 'energy-kcal_100g': 362, proteins_100g: 12, carbohydrates_100g: 67, fat_100g: 1.4 } } }) }); };
      const ok = await done();
      assert.ok(/^https:\/\/world\.openfoodfacts\.org\/api\/v2\/product\/9300652010015\.json\?fields=/.test(url), url);
      assert.equal(ok.ok, true); assert.equal(ok.food.kcal, 362);
      app.fetch = () => Promise.resolve({ ok: false, status: 404 });
      const nf = await done(); assert.equal(nf.ok, false); assert.ok(/not in Open Food Facts/.test(nf.error));
      app.fetch = () => Promise.reject(new Error('offline'));
      const off = await done(); assert.ok(/Could not reach/.test(off.error));
    } finally { app.fetch = real; }
  });

  // ── v4.9.418 — Woolworths link (server reply shape UNVERIFIED — two plausible shapes tested) ──
  test('WOOLIES: product number from the link; only digits ever reach the server', () => {
    assert.equal(app.nut2WooliesCode('https://www.woolworths.com.au/shop/productdetails/36059/sanitarium-weet-bix'), '36059');
    assert.equal(app.nut2WooliesCode('https://www.woolworths.com.au/shop/productdetails/abc/x'), null);
    assert.equal(app.nut2WooliesCode('https://evil.example/shop/productdetails/1'), null);
  });
  test('WOOLIES parse: Name/Value rows held in a JSON string, AND a nested per-100 g object; serve rows never used', () => {
    const A = { Product: { DisplayName: 'Sanitarium Weet-Bix', Barcode: '9300652010015' }, AdditionalAttributes: { nutritionalinformation: JSON.stringify({ Attributes: [
      { Name: 'Energy Per Serve', Value: '455kJ' }, { Name: 'Energy Per 100g', Value: '1515kJ' }, { Name: 'Protein Per 100g', Value: '12.1g' },
      { Name: 'Fat Total Per 100g', Value: '1.4g' }, { Name: 'Fat Saturated Per 100g', Value: '0.3g' }, { Name: 'Carbohydrate Per 100g', Value: '66.9g' },
      { Name: 'Sugars Per 100g', Value: '2.8g' }, { Name: 'Dietary Fibre Per 100g', Value: '11g' }, { Name: 'Protein Per Serve', Value: '3.6g' } ] }) } };
    const a = app.nut2FromWoolies(A);
    assert.deepEqual([a.ok, a.kcal, a.p, a.f, a.c, a.fib, a.name, a.barcode], [true, 362, 12.1, 1.4, 66.9, 11, 'Sanitarium Weet-Bix', '9300652010015']);
    const B = { name: 'Pauls Plus Protein Milk', nutritionPerServe: { energyKj: 849, proteinG: 18 }, nutritionPer100g: { energyKj: 283, proteinG: 6, fatTotalG: 1.3, fatSaturatedG: 0.9, carbohydrateG: 7.2, sugarsG: 7.2 } };
    const b = app.nut2FromWoolies(B);
    assert.deepEqual([b.ok, b.kcal, b.p, b.f, b.c], [true, 68, 6, 1.3, 7.2]);
    const C = app.nut2FromWoolies({ Product: { Name: 'Bananas', Barcode: '9300652010015' } });
    assert.equal(C.ok, false); assert.equal(C.barcode, '9300652010015', 'no panel → barcode kept for the Open Food Facts fallback');
    assert.equal(app.nut2FromWoolies(null), null);
  });
}
