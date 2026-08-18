#!/usr/bin/env node
// Phoenix node harness — static + executable validation of the single-file PWA.
// 1. Syntax-checks every inline <script> block via vm (compile, no execute).
// 2. Extracts blabGetSessionData + blabToPhoenixSession and RUNS them across all
//    48 week/day combinations (x2 state fixtures) asserting no errors + invariants.
// 3. Feature assertions for the v4.9.108 BLAB rebuild.
// Usage: node harness.mjs [path-to-index.html]
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const file = process.argv[2] || new URL('./index.html', import.meta.url).pathname;
const html = readFileSync(file, 'utf8');

let pass = 0, fail = 0;
const ok = (msg) => { pass++; console.log('  \x1b[32m✓\x1b[0m ' + msg); };
const bad = (msg) => { fail++; console.log('  \x1b[31m✗ ' + msg + '\x1b[0m'); };

// ── 1. Syntax-check inline scripts ──────────────────────────────────────────
console.log('\nSyntax check — inline <script> blocks:');
const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
let m, idx = 0, inlineCount = 0;
while ((m = re.exec(html)) !== null) {
  const attrs = m[1] || '', code = m[2] || '';
  idx++;
  if (/\bsrc\s*=/.test(attrs)) continue;
  if (!code.trim()) continue;
  inlineCount++;
  const line = html.slice(0, m.index).split('\n').length;
  try {
    new vm.Script(code, { filename: `inline-script@line${line}` });
    ok(`script #${idx} (line ${line}) parses — ${code.length.toLocaleString()} chars`);
  } catch (e) {
    bad(`script #${idx} (line ${line}) SYNTAX ERROR: ${e.message}`);
  }
}
if (inlineCount === 0) bad('no inline scripts found — extraction regex broke');

// ── 2. Execute the session pipeline across all 48 combos ────────────────────
console.log('\nExecution check — blabGetSessionData → blabToPhoenixSession × 48 combos:');
function extract(startMarker, endMarker) {
  const i = html.indexOf(startMarker);
  const j = html.indexOf(endMarker, i + startMarker.length);
  if (i < 0 || j < 0) throw new Error(`extract failed for ${startMarker}`);
  return html.slice(i, j);
}
const KNOWN_FORMATS = new Set(['percentage_sets','superset','total_rep_goal','afap','max_reps_sets','interval','steady_state','tabata','standard_sets']);
try {
  const srcGet = extract('window.blabGetSessionData = function(week, day){', '\nwindow.blabCompleteSession = function');
  const srcMap = extract('window.blabToPhoenixSession = function(sess, week, day){', '\nwindow.blabRunWorkout = function');
  // Two state fixtures: fresh (no records, chin unset) and populated (records + chin).
  const fixtures = [
    { label: 'fresh',     st: { maxes:{bench:100,squat:140,deadlift:180}, chin_max:0,  records:{} } },
    { label: 'populated', st: { maxes:{bench:100,squat:140,deadlift:180}, chin_max:12, records:{
        'squat_amrap_w0':6, 'bench_amrap_w5':4, 'Flat DB Press_max':22, 'Flat DB Press_maxwt':30,
        'Barbell Complex_time':240, '100_pushups_time':300, 'tabata_rounds':10, '1.6km':420, 'steady_state':1500 } } }
  ];
  let errors = 0, combos = 0;
  const seen = new Set();
  for (const fx of fixtures) {
    const sandbox = { window:{}, console };
    sandbox.window.blabPct = (maxKg,pct)=>Math.round((maxKg*pct/100)/2.5)*2.5;
    sandbox.window.blabGetState = ()=>fx.st;
    vm.createContext(sandbox);
    new vm.Script(srcGet + '\n' + srcMap).runInContext(sandbox);
    for (let w=1; w<=12; w++) for (let d=1; d<=4; d++) {
      combos++;
      try {
        const sess = sandbox.window.blabGetSessionData(w,d);
        if (!sess || !Array.isArray(sess.exercises) || !sess.exercises.length) { errors++; console.log(`  \x1b[31m✗ [${fx.label}] W${w}D${d}: no session/exercises\x1b[0m`); continue; }
        const phx = sandbox.window.blabToPhoenixSession(sess, w, d);
        if (!phx || !Array.isArray(phx.exercises) || phx.exercises.length !== sess.exercises.length) { errors++; console.log(`  \x1b[31m✗ [${fx.label}] W${w}D${d}: mapper mismatch\x1b[0m`); continue; }
        sess.exercises.forEach((e,ei)=>{
          seen.add(e.format);
          const pe = phx.exercises[ei];
          if (!e.name) { errors++; console.log(`  \x1b[31m✗ [${fx.label}] W${w}D${d} ex${ei}: no name\x1b[0m`); }
          if (!KNOWN_FORMATS.has(e.format)) { errors++; console.log(`  \x1b[31m✗ [${fx.label}] W${w}D${d} (${e.name}): unknown format ${e.format}\x1b[0m`); }
          if (e.format==='percentage_sets' && !(Array.isArray(e.sets)&&e.sets.length)) { errors++; console.log(`  \x1b[31m✗ [${fx.label}] W${w}D${d} (${e.name}): empty %sets\x1b[0m`); }
          if (e.format==='superset' && !(e.movements&&e.movements.length===2)) { errors++; console.log(`  \x1b[31m✗ [${fx.label}] W${w}D${d} (${e.name}): bad superset\x1b[0m`); }
          if (e.format==='afap' && !(e.movements&&e.movements.length)) { errors++; console.log(`  \x1b[31m✗ [${fx.label}] W${w}D${d} (${e.name}): afap no movements\x1b[0m`); }
          if (pe && pe.format && !pe._blabFmt) { errors++; console.log(`  \x1b[31m✗ [${fx.label}] W${w}D${d} (${e.name}): mapper dropped _blabFmt\x1b[0m`); }
        });
      } catch(err) { errors++; console.log(`  \x1b[31m✗ [${fx.label}] W${w}D${d}: THREW ${err.message}\x1b[0m`); }
    }
  }
  if (errors===0) ok(`${combos} combos executed cleanly (2 fixtures × 48)`);
  else bad(`${errors} execution errors across ${combos} combos`);
  const want = ['afap','interval','max_reps_sets','percentage_sets','standard_sets','steady_state','superset','tabata','total_rep_goal'];
  const missing = want.filter(f=>!seen.has(f));
  missing.length ? bad(`formats not exercised: ${missing.join(', ')}`) : ok(`all 9 formats exercised: ${want.join(', ')}`);
} catch(e) { bad(`pipeline execution setup failed: ${e.message}`); }

// ── 3. Feature assertions — v4.9.108 BLAB rebuild ───────────────────────────
console.log('\nFeature check — v4.9.108 architecture + content:');
const has = (needle, label) => html.includes(needle) ? ok(label) : bad(`MISSING: ${label}`);
const hasNot = (needle, label) => !html.includes(needle) ? ok(label) : bad(`SHOULD BE GONE: ${label}`);

has("var APP_VERSION='4.9.159'", 'version is 4.9.159');

// ── Nordic Planks timed holds (v4.9.131) ─────────────────────────────────────
has('hold_secs:20', 'NP: W1 hold_secs:20');
has('hold_secs:25', 'NP: W2 hold_secs:25');
has('hold_secs:30', 'NP: W3/W8 hold_secs:30');
has('hold_secs:35', 'NP: W4/W9 hold_secs:35');
has('hold_secs:40', 'NP: W11 hold_secs:40');
has('hold_secs:45', 'NP: W12 hold_secs:45');
has('if(ex.hold_secs){ phxEx._holdSecs = ex.hold_secs', 'NP: _holdSecs carried through blabToPhoenixSession');
has('window._phxStartHoldTimer = function(secs)', 'NP: _phxStartHoldTimer function defined');
has("'s Hold</button>'", 'NP: hold timer button injected in session block');
has("lbl.textContent     = 'HOLD'", 'NP: rest overlay label changed to HOLD');
has("skipBtn.textContent = 'Done'", 'NP: skip button relabelled Done for holds');

// ── Nutrition Engine (v4.9.132) ───────────────────────────────────────────────
has('function nutGetState()', 'NUT: nutGetState defined');
has('function nutSaveState(s)', 'NUT: nutSaveState defined');
has('function nutCalcTargets(', 'NUT: nutCalcTargets defined');
has('function nutAdjustForToday(', 'NUT: nutAdjustForToday defined');
has('function nutRenderTile()', 'NUT: nutRenderTile defined');
has('function openNutritionScreen()', 'NUT: openNutritionScreen defined');
has('function nutRenderScreen()', 'NUT: nutRenderScreen defined');
has('function nutOpenSetup()', 'NUT: nutOpenSetup defined');
has('function nutOpenMealLog(slot)', 'NUT: nutOpenMealLog defined');
has('function nutSaveCheckin()', 'NUT: nutSaveCheckin defined');
has("id=\"screen-nutrition\"", 'NUT: #screen-nutrition HTML screen added');
has("'nutrition':'screen-nutrition'", 'NUT: navigation route wired');
has("if(tab==='nutrition')", 'NUT: navTo renders nutrition screen');
has("nutRenderTile()", 'NUT: Today tile replaced with live render');

// ── Weekly Prep — single-serve recipes + prep aggregator (v4.9.144) ──────────
has('function nutGetRecipes()', 'PREP: nutGetRecipes defined');
has('function nutSaveRecipes(list)', 'PREP: nutSaveRecipes defined');
has("'phx_recipes_v1_' + (uid || 'guest')", 'PREP: recipes stored under phx_recipes_v1_{uid}');
has('if(!uid && typeof athlete', 'PREP: key prefers the session, falls back to athlete');
has('function _nutRecipesMirrorToCloud(', 'PREP: Supabase mirror defined');
has('function nutRestoreRecipesFromCloud(', 'PREP: cloud restore defined');
has('nutRestoreRecipesFromCloud(row)', 'PREP: cloud restore wired into profile load');
has('function _nutNormalizeRecipe(', 'PREP: legacy batch-recipe migration defined');
has('function nutRecipeMacros(', 'PREP: per-serve macro calc defined');
has('function nutRecipeServeWeight(', 'PREP: serve weight calc defined');
has('function nutAssignRecipe(', 'PREP: week slot assignment defined');
has('function nutBuildPrepPlan(', 'PREP: aggregator defined');
has('function _nutPrepScale(', 'PREP: batch/yield scaling defined');
has('function nutOpenPrepCard()', 'PREP: prep card overlay defined');
has('function nutOpenRecipePicker(', 'PREP: recipe picker defined');
has('function _nutWeekPlanView(', 'PREP: week PLAN view defined');
has('function _nutPrepText(', 'PREP: plain-text export defined');
has('function nutOpenRecipeBuilder(editId)', 'PREP: builder takes an edit id');
has('data-nut-prep', 'PREP: WEEKLY PREP button rendered');
has('WEEKLY PREP', 'PREP: WEEKLY PREP label present');
has('data-nut-week-mode', 'PREP: week Overview/Plan toggle rendered');
has('data-nut-add-recipe', 'PREP: per-slot + Recipe button rendered');
has('data-nut-recipe-edit', 'PREP: recipe Edit button rendered');
has("var _nutWeekMode = 'overview'", 'PREP: _nutWeekMode state var declared');
has('recipeId: rec.id', 'PREP: assigned components carry recipeId for aggregation');
hasNot("var _recipes = (_rns && _rns.recipes) ? _rns.recipes : [];", 'PREP: food picker no longer reads legacy ns.recipes');

// ── Execute the prep aggregator against the two spec scenarios ───────────────
console.log('\nExecution check — Weekly Prep aggregator:');
try {
  const srcPrep = extract('var _NUT_REC_CATS = [', '\n// ── Week planner view');
  const sandbox = { console, athlete: { id: 'harness' }, currentSession: { user: { id: 'harness' } } };
  sandbox.localStorage = {
    _d: {},
    getItem(k){ return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
    setItem(k, v){ this._d[k] = String(v); },
    removeItem(k){ delete this._d[k]; }
  };
  sandbox.setTimeout = () => 0;
  sandbox.clearTimeout = () => {};
  let _ns = { setup_done: true, targets: {}, daily: {} };
  sandbox.nutGetState = () => _ns;
  sandbox.nutSaveState = (s) => { _ns = s; };
  sandbox.nutRenderTile = () => {};
  sandbox._nutToday = () => '2026-08-19';                       // a Wednesday
  sandbox._nutWeekStart = () => '2026-08-17';                   // that week's Monday
  vm.createContext(sandbox);
  const srcText = extract('// Plain-text export of the prep plan', '\n// PEPTIDE PORTAL');
  new vm.Script(srcPrep + '\n' + srcText).runInContext(sandbox);

  const sauce = { id:'r_sauce', name:'Chilli Sauce', cat:'sauce', yield_serves:4, yield_note:'', prep_method:'Blend',
    components:[{n:'Chilli',cat:'veg',k:40,p:2,c:9,f:0.4,qty_g:30,cooked_g:0,state:'raw'},
                {n:'Garlic',cat:'veg',k:149,p:6.4,c:33,f:0.5,qty_g:10,cooked_g:0,state:'raw'}], macros_manual:null };
  const bowl  = { id:'r_bowl', name:'Chicken Bowl', cat:'protein', yield_serves:1, yield_note:'', prep_method:'Grill',
    components:[{n:'Chicken',cat:'protein',k:110,p:23,c:0,f:2,qty_g:200,cooked_g:150,state:'raw'}], macros_manual:null };
  sandbox.nutSaveRecipes([sauce, bowl]);

  const days = sandbox._nutWeekDays();
  days.length === 7 ? ok('week resolves to 7 day keys') : bad(`week resolved to ${days.length} days`);

  // Scenario 1: a sauce on Mon / Wed / Fri lunch
  sandbox.nutAssignRecipe('r_sauce','lunch',days[0],1);
  sandbox.nutAssignRecipe('r_sauce','lunch',days[2],1);
  sandbox.nutAssignRecipe('r_sauce','lunch',days[4],1);
  // Scenario 2: a second recipe on the same day (Mon dinner)
  sandbox.nutAssignRecipe('r_bowl','dinner',days[0],1);

  const plan = sandbox.nutBuildPrepPlan(days);
  const ps = plan.filter(p => p.id === 'r_sauce')[0];
  const pb = plan.filter(p => p.id === 'r_bowl')[0];

  plan.length === 2 ? ok('two different recipes both reach the prep card') : bad(`expected 2 prep entries, got ${plan.length}`);
  ps && ps.serves === 3 ? ok('sauce counted 3 serves across Mon/Wed/Fri') : bad(`sauce serves = ${ps && ps.serves}`);
  ps && ps.batches === 1 && ps.servesMade === 4 && ps.leftover === 1
    ? ok('yield 4 vs need 3 → 1 batch, 4 serves, 1 spare')
    : bad(`sauce batching wrong: ${JSON.stringify(ps && {b:ps.batches,m:ps.servesMade,l:ps.leftover})}`);
  ps && sandbox._nutPrepBatchLine(ps) === 'Make 1 batch (4 serves, use 3) — 1 spare'
    ? ok('batch line reads "Make 1 batch (4 serves, use 3) — 1 spare"')
    : bad(`batch line: ${ps && sandbox._nutPrepBatchLine(ps)}`);
  ps && ps.ingredients[0].perBatch_g === 120 && ps.ingredients[1].perBatch_g === 40
    ? ok('single-batch raw weights scale by yield (30g→120g, 10g→40g)')
    : bad(`batch weights wrong: ${JSON.stringify(ps && ps.ingredients)}`);
  pb && pb.batchMode === false && sandbox._nutPrepBatchLine(pb) === 'Make 1 individual serve'
    ? ok('single-serve recipe reports individual serves, not batches')
    : bad(`single-serve line: ${pb && sandbox._nutPrepBatchLine(pb)}`);

  // Multi-batch rounding: 7 serves of a yield-4 recipe → 2 batches
  sandbox.nutAssignRecipe('r_sauce','snack',days[0],4);
  const ps2 = sandbox.nutBuildPrepPlan(days).filter(p => p.id === 'r_sauce')[0];
  ps2 && ps2.batches === 2 && ps2.ingredients[0].total_g === 240
    ? ok('7 serves of a yield-4 recipe → 2 batches, 240g total chilli')
    : bad(`multi-batch wrong: ${JSON.stringify(ps2 && {b:ps2.batches,t:ps2.ingredients[0].total_g})}`);

  // Legacy batch recipe migrates to the per-serve model
  sandbox.localStorage.removeItem('phx_recipes_v1_harness');
  _ns.recipes = [{ id:'r_old', name:'Old Bowl',
    components:[{n:'Chicken',cat:'protein',k:110,p:23,c:0,f:2,qty_g:800,state:'raw'}],
    cookedWeight_g:1200, serveSize_g:300 }];
  const mig = sandbox.nutGetRecipes();
  mig.length === 1 && mig[0].yield_serves === 4 && mig[0].components[0].qty_g === 200
    ? ok('legacy cooked-weight recipe migrates to per-serve (800g/4 = 200g, yield 4)')
    : bad(`legacy migration wrong: ${JSON.stringify(mig)}`);

  const txt = sandbox._nutPrepText([ps], 'Mon – Sun');
  txt.includes('CHILLI SAUCE') && txt.includes('Chilli — 120g') && txt.includes('Blend')
    ? ok('plain-text export carries name, weights and method')
    : bad('text export missing content');

  // ── Cloud restore vs the migration write (regression guard, v4.9.149) ─────
  // nutRestoreRecipesFromCloud is local-wins. If nutGetRecipes() persisted an
  // empty array on a read that happens before the profile row lands (fast-path
  // boot), the key would exist and restore would be blocked forever.
  const CLOUD = { nut_recipes: [{ id:'r_cloud', name:'Cloud Sauce', cat:'sauce', yield_serves:4,
    components:[{n:'Chilli',cat:'veg',k:40,p:2,c:9,f:0.4,qty_g:30,cooked_g:0,state:'raw'}],
    yield_note:'', prep_method:'', macros_manual:null }] };
  const RKEY = 'phx_recipes_v1_harness';

  sandbox.localStorage.removeItem(RKEY);
  delete _ns.recipes;
  sandbox.nutRestoreRecipesFromCloud(CLOUD);
  sandbox.nutGetRecipes().length === 1
    ? ok('cloud restore hydrates recipes on a fresh install')
    : bad('cloud restore did not hydrate');

  sandbox.localStorage.removeItem(RKEY);
  sandbox.nutSaveRecipes([{ id:'r_local', name:'Local Only', cat:'other', yield_serves:1,
    components:[], yield_note:'', prep_method:'', macros_manual:null }]);
  sandbox.nutRestoreRecipesFromCloud(CLOUD);
  sandbox.nutGetRecipes()[0].name === 'Local Only'
    ? ok('cloud restore never overwrites existing local recipes')
    : bad('cloud clobbered local recipes');

  sandbox.localStorage.removeItem(RKEY);
  delete _ns.recipes;
  const early = sandbox.nutGetRecipes();                        // Nutrition screen opened first
  early.length === 0 && sandbox.localStorage.getItem(RKEY) === null
    ? ok('an empty read does NOT persist the key (restore stays possible)')
    : bad(`empty read persisted the key: ${sandbox.localStorage.getItem(RKEY)}`);
  sandbox.nutRestoreRecipesFromCloud(CLOUD);
  sandbox.nutGetRecipes().length === 1
    ? ok('cloud restore still works after an early read (race guard)')
    : bad('early read blocked cloud restore — the v4.9.149 regression is back');

  sandbox.localStorage.removeItem(RKEY);
  _ns.recipes = [{ id:'r_old', name:'Legacy', components:[{n:'C',cat:'protein',k:100,p:20,c:0,f:2,qty_g:100,state:'raw'}] }];
  sandbox.nutGetRecipes();
  sandbox.localStorage.getItem(RKEY) !== null
    ? ok('a read WITH legacy data still persists the migration')
    : bad('migration no longer persists real legacy recipes');
  // v4.9.156: migration must NOT stamp. Migrated recipes are of unknown age, so
  // stamping them `now` would let stale local data beat a genuinely newer cloud.
  (function(){
    const env = JSON.parse(sandbox.localStorage.getItem(RKEY));
    !Array.isArray(env) && env.recipes && env._ts === undefined
      ? ok('migration writes the envelope UNSTAMPED (cannot outrank a real cloud copy)')
      : bad(`migration stamped or wrote a bare array: ${JSON.stringify(env).slice(0,120)}`);
  })();
  delete _ns.recipes;
  sandbox.localStorage.removeItem(RKEY);

  // ── Restore rule: newest timestamp wins — full 7-row table (v4.9.156) ─────
  const OLD = '2026-08-01T00:00:00.000Z', NEW = '2026-08-18T00:00:00.000Z';
  const rec  = (n) => [{ id:'r_'+n, name:n, cat:'other', yield_serves:1, components:[], yield_note:'', prep_method:'', macros_manual:null }];
  const envq = (ts, n) => ts ? { _ts: ts, recipes: rec(n) } : { recipes: rec(n) };
  // rawLocal: null = absent, a string = written verbatim (lets us test unparseable)
  const table = [
    { row:1, name:'no local -> CLOUD',                    local:null,                        cloud:envq(OLD,'cloud'), win:'cloud', restored:true  },
    { row:2, name:'local unparseable -> CLOUD',           local:'{not json',                  cloud:envq(OLD,'cloud'), win:'cloud', restored:true  },
    { row:3, name:'both stamped, cloud newer -> CLOUD',   local:JSON.stringify(envq(OLD,'local')), cloud:envq(NEW,'cloud'), win:'cloud', restored:true  },
    { row:4, name:'both stamped, local newer -> LOCAL',   local:JSON.stringify(envq(NEW,'local')), cloud:envq(OLD,'cloud'), win:'local', restored:false },
    { row:4, name:'both stamped, TIE -> LOCAL',           local:JSON.stringify(envq(OLD,'local')), cloud:envq(OLD,'cloud'), win:'local', restored:false },
    { row:5, name:'cloud stamped, local not -> CLOUD',    local:JSON.stringify(envq(null,'local')), cloud:envq(OLD,'cloud'), win:'cloud', restored:true  },
    { row:6, name:'local stamped, cloud not -> LOCAL',    local:JSON.stringify(envq(OLD,'local')), cloud:envq(null,'cloud'), win:'local', restored:false },
    { row:7, name:'neither stamped -> LOCAL',             local:JSON.stringify(envq(null,'local')), cloud:envq(null,'cloud'), win:'local', restored:false },
    { row:7, name:'legacy bare arrays both sides -> LOCAL', local:JSON.stringify(rec('local')), cloud:rec('cloud'),   win:'local', restored:false }
  ];
  let tableFails = 0;
  table.forEach(t => {
    sandbox.localStorage.removeItem(RKEY);
    sandbox.localStorage.removeItem(RKEY + '_bak');
    if (t.local !== null) sandbox.localStorage.setItem(RKEY, t.local);
    const returned = sandbox.nutRestoreRecipesFromCloud({ nut_recipes: t.cloud });
    const winner = sandbox.nutGetRecipes()[0] ? sandbox.nutGetRecipes()[0].name : '(none)';
    const bak = sandbox.localStorage.getItem(RKEY + '_bak');
    const bakOK = t.restored && t.local !== null ? bak === t.local : bak === null;
    if (winner !== t.win)          { tableFails++; bad(`row ${t.row}: ${t.name} — winner was ${winner}`); }
    else if (returned !== t.restored) { tableFails++; bad(`row ${t.row}: ${t.name} — returned ${returned}, expected ${t.restored}`); }
    else if (!bakOK)               { tableFails++; bad(`row ${t.row}: ${t.name} — _bak wrong: ${String(bak).slice(0,40)}`); }
  });
  tableFails === 0
    ? ok(`restore table: all ${table.length} cases resolve, return value and _bak correct`)
    : bad(`${tableFails}/${table.length} restore-table cases wrong`);

  // The case Jon actually cares about: lost phone, brand-new device, no local at
  // all. Must be cloud regardless of stamping — asserted so it reads as intended.
  sandbox.localStorage.removeItem(RKEY);
  sandbox.nutRestoreRecipesFromCloud({ nut_recipes: rec('cloud') }) === true &&
  sandbox.nutGetRecipes()[0].name === 'cloud'
    ? ok('lost-phone case: no local + UNSTAMPED cloud still restores')
    : bad('unstamped cloud did not restore onto a fresh device');

  // _bak is one generation, never chained.
  sandbox.localStorage.removeItem(RKEY); sandbox.localStorage.removeItem(RKEY + '_bak');
  sandbox.localStorage.setItem(RKEY, JSON.stringify(envq(OLD, 'first')));
  sandbox.nutRestoreRecipesFromCloud({ nut_recipes: envq(NEW, 'second') });
  sandbox.nutRestoreRecipesFromCloud({ nut_recipes: envq('2026-08-19T00:00:00.000Z', 'third') });
  JSON.parse(sandbox.localStorage.getItem(RKEY + '_bak')).recipes[0].name === 'second'
    ? ok('_bak holds one generation only, never chained')
    : bad('_bak chained or held the wrong generation');

  // Saving stamps; the mirror receives the same envelope it wrote locally.
  sandbox.localStorage.removeItem(RKEY);
  sandbox.nutSaveRecipes(rec('saved'));
  (function(){
    const env = JSON.parse(sandbox.localStorage.getItem(RKEY));
    const t = Date.parse(env._ts || '');
    !isNaN(t) && Array.isArray(env.recipes) && env.recipes[0].name === 'saved'
      ? ok('nutSaveRecipes stamps _ts as a parseable ISO string')
      : bad(`save did not stamp correctly: ${JSON.stringify(env).slice(0,120)}`);
  })();
  sandbox.localStorage.removeItem(RKEY);
  sandbox.localStorage.removeItem(RKEY + '_bak');
} catch (e) {
  bad(`prep aggregator execution failed: ${e.message}`);
}

// The old rule is gone — a local copy must no longer win by merely existing.
hasNot("if(localStorage.getItem(_nutRecipeKey()) !== null) return;", 'RESTORE: old local-wins early-return removed');
has('function _nutBackupLocal(', 'RESTORE: _bak helper defined');
has('function _nutAfterRestore(', 'RESTORE: repaint helper defined');
has('function _nutRecipesFrom(', 'RESTORE: envelope reader defined (bare array still loads)');
has("_ts: new Date().toISOString()", 'RESTORE: save stamps ISO _ts');
has("cloudWins = ct > lt", 'RESTORE: strict newer-than, so ties fall to local');
has("_phxRecordWriteError('_nutRecipesMirrorToCloud'", 'MIRROR: write errors recorded, not swallowed');
has('function _nutErrorSummary(', 'MIRROR: diagnostic summary helper defined');
has('_nutErrorSummary(env)', 'MIRROR: payload is a count, never recipe values');
hasNot(".then(function(){}, function(){});", 'MIRROR: empty swallowing callbacks gone');

// ── Today screen: meal tick-off + water counter (v4.9.145) ──────────────────
has('id="today-meals-tile"', 'TODAY: meals tile div on Today screen');
has('id="today-water-tile"', 'TODAY: water tile div on Today screen');
has('nutRenderMealsTile()', 'TODAY: meals tile rendered from the Today render hook');
has('nutRenderWaterTile()', 'TODAY: water tile rendered from the Today render hook');
has('function _nutEnsureEaten(', 'TICK: eaten-map seeding defined');
has('function nutIsSlotEaten(', 'TICK: nutIsSlotEaten defined');
has('function nutToggleMealEaten(', 'TICK: nutToggleMealEaten defined');
has('function _nutEatenTotals(', 'TICK: eaten-only running totals defined');
has('function _nutSlotTotals(', 'TICK: per-slot totals defined');
has('data-nut-tick=', 'TICK: Today-screen tick buttons rendered');
has('data-nut-tick-day=', 'TICK: nutrition-screen tick buttons rendered');
has('nutToggleMealEaten(parts[0], parts[1])', 'TICK: in-screen tick buttons wired');
has('var logged = _nutEatenTotals(dayData);', 'TICK: running totals follow the ticks');
has("if(_e[slot] === undefined) _e[slot] = false;", 'TICK: planned recipes start unticked');
has('_nutEnsureEaten(day)[slot] = true;', 'TICK: ad-hoc logging ticks the slot');
has("ns.daily[dk].eaten = {};", 'TICK: week templates plan without marking eaten');
has('function nutRenderWaterTile()', 'WATER: tile renderer defined');
has('function nutAddWater(', 'WATER: add/undo defined');
has('function nutWaterTargetMl(', 'WATER: target accessor defined');
has('function nutSetWaterTarget(', 'WATER: target setter defined');
has('function nutOpenWaterTargetSheet(', 'WATER: target picker defined');
has('var _NUT_WATER_GLASS_ML  = 250', 'WATER: 250ml glass');
has('var _NUT_WATER_TARGET_ML = 2500', 'WATER: 2.5L default target');
has('function _nutBindLongPress(', 'WATER: tap/long-press binding defined');
has('Tap to add a glass &middot; hold to undo', 'WATER: tap/hold hint shown');
has('water_ml', 'WATER: per-day water stored on the daily record');

// ── Execute the tick-off + water logic ──────────────────────────────────────
console.log('\nExecution check — meal tick-off + water counter:');
try {
  const srcPrep2 = extract('var _NUT_REC_CATS = [', '\n// ── Week planner view');
  const srcToday = extract('var _NUT_WATER_GLASS_ML', '\n// ── Today screen: planned meals')
                 + extract('// ── Today screen: water counter', '\nfunction nutRenderWaterTile()');
  const sb2 = { console, athlete: { id: 'harness2' }, currentSession: { user: { id: 'harness2' } } };
  sb2.localStorage = {
    _d: {},
    getItem(k){ return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
    setItem(k, v){ this._d[k] = String(v); },
    removeItem(k){ delete this._d[k]; }
  };
  sb2.setTimeout = () => 0;
  sb2.clearTimeout = () => {};
  sb2.document = { getElementById: () => null };
  let st = { setup_done: true, targets: { kcal: 2000, protein_g: 150 }, daily: {} };
  sb2.nutGetState = () => st;
  sb2.nutSaveState = (s) => { st = s; };
  sb2.nutRenderTile = () => {};
  sb2.nutRenderScreen = () => {};
  sb2.nutRenderWaterTile = () => {};
  sb2.nutRenderMealsTile = () => {};
  sb2.nutAdjustForToday = (t) => t;
  sb2._nutDayTotals = (day) => {
    const t = { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };
    const meals = (day && day.meals && !Array.isArray(day.meals)) ? day.meals : {};
    Object.keys(meals).forEach(sl => (meals[sl].components || []).forEach(c => {
      const f = (c.qty_g || 0) / 100;
      t.kcal += Math.round((c.k || 0) * f); t.protein_g += (c.p || 0) * f;
    }));
    return t;
  };
  sb2._nutToday = () => '2026-08-19';
  sb2._nutWeekStart = () => '2026-08-17';
  vm.createContext(sb2);
  new vm.Script(srcPrep2 + '\n' + srcToday).runInContext(sb2);

  const rec = { id:'r1', name:'Oats', cat:'carb', yield_serves:1, yield_note:'', prep_method:'',
    components:[{n:'Oats',cat:'carb',k:400,p:14,c:60,f:8,qty_g:100,cooked_g:0,state:'raw'}], macros_manual:null };
  sb2.nutSaveRecipes([rec]);
  const TODAY = '2026-08-19';
  sb2.nutAssignRecipe('r1', 'breakfast', TODAY, 1);
  const day = () => sb2.nutGetState().daily[TODAY];

  sb2.nutIsSlotEaten(day(), 'breakfast') === false
    ? ok('a planned meal starts unticked') : bad('planned meal was already ticked');
  sb2._nutEatenTotals(day()).kcal === 0
    ? ok('running total ignores unticked meals') : bad(`unticked meal counted: ${sb2._nutEatenTotals(day()).kcal}`);
  sb2.nutToggleMealEaten('breakfast', TODAY);
  sb2.nutIsSlotEaten(day(), 'breakfast') === true && sb2._nutEatenTotals(day()).kcal === 400
    ? ok('ticking a meal adds it to the running total (400 kcal)')
    : bad(`tick did not update totals: ${sb2._nutEatenTotals(day()).kcal}`);
  sb2.nutToggleMealEaten('breakfast', TODAY);
  sb2._nutEatenTotals(day()).kcal === 0
    ? ok('unticking removes it again') : bad('untick did not reverse');

  // A day with no eaten map at all predates tick-off — it must still count.
  st.daily['2026-01-05'] = { meals: { lunch: { components: [{n:'X',cat:'carb',k:300,p:10,c:50,f:5,qty_g:100}] } } };
  sb2._nutEatenTotals(st.daily['2026-01-05']).kcal === 300
    ? ok('pre-tick-off days still count as eaten (no silent zeroing)')
    : bad('legacy day zeroed out');

  // Water
  sb2.nutWaterTargetMl(sb2.nutGetState()) === 2500 ? ok('water target defaults to 2.5L') : bad('bad default water target');
  sb2.nutAddWater(250); sb2.nutAddWater(250);
  sb2.nutGetWaterMl(TODAY) === 500 ? ok('two taps = 500ml') : bad(`water = ${sb2.nutGetWaterMl(TODAY)}`);
  sb2.nutAddWater(-250);
  sb2.nutGetWaterMl(TODAY) === 250 ? ok('long-press undo removes a glass') : bad('undo failed');
  sb2.nutAddWater(-250); sb2.nutAddWater(-250);
  sb2.nutGetWaterMl(TODAY) === 0 ? ok('water never goes negative') : bad('water went negative');
  sb2.nutSetWaterTarget(3000);
  sb2.nutWaterTargetMl(sb2.nutGetState()) === 3000 ? ok('water target is configurable') : bad('target not saved');
  st.daily['2099-01-01'] = { water_ml: 1000 };
  sb2.nutGetWaterMl('2099-01-01') === 1000 && sb2.nutGetWaterMl(TODAY) === 0
    ? ok('water is per date, so it resets at midnight') : bad('water not date-scoped');
} catch (e) {
  bad(`tick-off / water execution failed: ${e.message}`);
}

// ── Priority 11 — Outstanding Bug Fixes ──────────────────────────────────────
// Bug 1: Superset per-set data
has('function ssPrevBanner(', 'P11-B1: ssPrevBanner helper defined');
has('_banA=ssPrevBanner(', 'P11-B1: _banA computed from ssPrevBanner');
has('_banB=ssPrevBanner(', 'P11-B1: _banB computed from ssPrevBanner');
has("bs.records[ex2.name+'_wt_set'+sn]", 'P11-B1: per-set weight saved by set number');
has("bs.records[ex2.name+'_reps_set'+sn]", 'P11-B1: per-set reps saved by set number');
has("phxEx.prev_sets_a=_ssPA", 'P11-B1: prev_sets_a passed to renderer');
has("phxEx.prev_sets_b=_ssPB", 'P11-B1: prev_sets_b passed to renderer');
// Bug 2: iOS tap counter — button elements with touch-action
has("class=\"phx-tt-minus\"", 'P11-B2: phx-tt-minus exists');
has("touch-action:manipulation", 'P11-B2: touch-action:manipulation on tap counter buttons');
hasNot('<div class="phx-tt-minus"', 'P11-B2: phx-tt-minus is now a button (not a div)');
hasNot('<div class="phx-tt-plus"', 'P11-B2: phx-tt-plus is now a button (not a div)');
// Bug 3: Persistent wake lock
has("requestWakeLock(); // persistent", 'P11-B3: persistent wake lock requested on load');
has("function _phxReleaseWakeLockIfIdle", 'P11-B3: _phxReleaseWakeLockIfIdle still present');
has("releaseWakeLock(); requestWakeLock();", 'P11-B3: re-acquires lock after idle release');
// Bug 4: Week 2 superset reps — verified correct
has("var a12 = (w === 1) ? 15 : 12", 'P11-B4: Week 2 superset reps = 12 (not 15)');

// ── Priority 10 — Records Tab Enhancement ────────────────────────────────────
has("var _phxRecTab = 'wod'", 'P10: _phxRecTab tab state variable');
has('function _phxRecTabWod()', 'P10: _phxRecTabWod defined');
has('function _phxRecTabStrength()', 'P10: _phxRecTabStrength defined');
has('function _phxRecTabBlab()', 'P10: _phxRecTabBlab defined');
has('function _phxAmrapChart(', 'P10: _phxAmrapChart bar chart helper defined');
has("data-rec-tab", 'P10: tab buttons use data-rec-tab attribute');
has("key:'wod'", 'P10: WOD / CORE tab defined');
has("key:'strength'", 'P10: STRENGTH tab defined');
has("key:'blab'", 'P10: BLAB tab defined');
has("_maxwt", 'P10: heaviest set reads _maxwt records');
has("chin_max", 'P10: chin-up max shown in BLAB tab');
has("100_pushups_time", 'P10: 100 push-up time benchmark in BLAB tab');
has("Barbell Complex_time", "P10: Barbell Complex time benchmark in BLAB tab");
has("1.6km", "P10: 1.6km run benchmark in BLAB tab");
has("_amrap_w", 'P10: AMRAP per-week data used in charts');
has("HEAVIEST SET LOGGED", 'P10: heaviest set section header');
has("BLAB BENCHMARKS", 'P10: BLAB benchmarks section header');
has("1-REP MAXES", 'P10: 1RM section header in STRENGTH tab');

// ── Priority 9 — Holiday Reset Mechanism ─────────────────────────────────────
has('function openBlabAdjust()', 'P9: openBlabAdjust defined');
has('window._blabPause=function()', 'P9: _blabPause defined');
has('window._blabResume=function()', 'P9: _blabResume defined');
has('window._blabOpenReset=function()', 'P9: _blabOpenReset defined');
has("closeSidebar();openBlabAdjust()", 'P9: sidebar Adjust Programme wired');
has("bs.paused=true", 'P9: pause flag set in _blabPause');
has("bs.paused=false", 'P9: paused cleared in _blabResume and reset');
has("if(_bs.paused)", 'P9: paused state branch in Today card');
has("Programme Paused", 'P9: paused card title renders');
has("_blabResume()", 'P9: Resume button calls _blabResume');
has("_blabOpenReset()", 'P9: Reset button calls _blabOpenReset');
has("confirm-reset", 'P9: confirm-reset action in reset overlay');
has("rst-bench", 'P9: bench input in reset form');
has("records:bs.records", 'P9: records preserved on reset');

// ── Priority 8 — Smart Add Session Recommendation Engine ─────────────────────
has('function _phxSmartRecommend()', 'P8: _phxSmartRecommend defined');
has('function _phxOpenSmartAddSession()', 'P8: _phxOpenSmartAddSession defined');
has('_phxOpenSmartAddSession()', 'P8: _phxOpenSessionLibrary delegates to smart overlay');
has("rec.type==='BLAB'", 'P8: BLAB recommendation type handled');
has("isDeload", 'P8: deload week detection present');
has("blabDoneToday", 'P8: blabDoneToday signal present');
has("coreDays>=7", 'P8: core frequency check present');
has("wodDays>=2", 'P8: WOD frequency check present');
has("data-act=\"start-rec\"", 'P8: start-rec action wired in overlay');
has("data-act=\"choose\"", 'P8: choose action wired for alternatives');

// ── Priority 6 — Standalone Timer ────────────────────────────────────────────
has('function openStandaloneTimer()', 'P6: openStandaloneTimer defined (full implementation)');
has("activeTab='stopwatch'", 'P6: stopwatch tab mode present');
has("activeTab==='countdown'", 'P6: countdown tab mode present');
has("activeTab==='tabata'", 'P6: tabata tab mode present');
has('function tbTick()', 'P6: tbTick — tabata phase engine defined');
has('function cdAdd(ms)', 'P6: cdAdd — countdown +1min/+30s defined');
has("data-act=\"tab-'+key+'\"", 'P6: tab delegation — data-act tab buttons built dynamically');

// ── Priority 7 — Custom Session Builder ──────────────────────────────────────
has('function openCustomSessionBuilder(', 'P7: openCustomSessionBuilder defined');
has('function _phxOpenExPicker(', 'P7: _phxOpenExPicker defined');
has('function _phxLoadCustomTemplates(', 'P7: _phxLoadCustomTemplates defined');
has('function _phxSaveCustomTemplate(', 'P7: _phxSaveCustomTemplate defined');
has("var _phxExLib = [", 'P7: exercise library array defined');
has("key==='CUSTOM'", 'P7: CUSTOM (Build Your Own) wired in session chooser');
has("window._todaySession = sess;", 'P7: custom session assigned to _todaySession on start');
has("phx_custom_templates", 'P7: template storage key in localStorage');

// ── v4.9.118 TIMER FIXES (screen lock / wake lock / count-in) ────────────────
// FIX 1 — timestamp-derived clocks + visibility resync.
has('function _phxStampTimerStart(){ window._phxTimerStart = Date.now();', 'FIX1: _phxStampTimerStart stamps window._phxTimerStart');
has('function _phxElapsedSince(from)', 'FIX1: _phxElapsedSince derives seconds from a timestamp');
has('Math.floor((Date.now() - t)/1000)', 'FIX1: elapsed = floor((now - start)/1000)');
has('function _phxRegisterTimer(resync)', 'FIX1: resync handler registry');
has('function _phxUnregisterTimer()', 'FIX1: resync handler teardown');
has("if(document.visibilityState !== 'visible') return;\n  requestWakeLock();", 'FIX1: visibilitychange→visible hook for timed sessions');
has('var fn = window._phxTimerResync;\n  if(fn){ try{ fn(); }', 'FIX1: visible → active session recalculates elapsed');
// every timed renderer must be timestamp-driven + registered
has('function _blabElapsedNow(st)', 'FIX1: BLAB runner elapsed from timestamps');
has('_phxRegisterTimer(function(){\n    var s = window._blabWoState;', 'FIX1: BLAB runner registers a resync');
has('function paintTime(){ elapsed=_phxElapsedSince();', 'FIX1: WOD count-up clock from timestamp');
has('remain = plan.durationSec - _phxElapsedSince();', 'FIX1: AMRAP remaining from timestamp');
has('var gone=_phxElapsedSince(minStart);', 'FIX1: EMOM minute from timestamp');
has('clk=_phxElapsedSince(phStart)', 'FIX1: interval work phase from timestamp');
has('coreAmrapEnd = Date.now() + (coreSecsLeft*1000);', 'FIX1: Core circuit runs off an end timestamp');
has('_phxRegisterTimer(_phxUpdateCoreAmrap);', 'FIX1: Core circuit registers a resync');
has('_phxRegisterTimer(paintAmrap);', 'FIX1: AMRAP registers a resync');
has('_phxRegisterTimer(paintEmom);', 'FIX1: EMOM registers a resync');
has('_phxRegisterTimer(paintInt);', 'FIX1: intervals register a resync');
has('_phxRegisterTimer(updateCoreTimer);', 'FIX1: 20-min core registers a resync');
// the old tick-counter clocks must be gone
hasNot('st.elapsed++;', 'FIX1: BLAB tick-counter elapsed++ removed');
hasNot('setInterval(function(){ elapsed++;', 'FIX1: WOD tick-counter elapsed++ removed');
hasNot('setInterval(function(){ remain--;', 'FIX1: AMRAP tick-counter remain-- removed');
hasNot('setInterval(function(){ secLeft--;', 'FIX1: EMOM tick-counter secLeft-- removed');
hasNot('coreSecsLeft--;', 'FIX1: Core circuit tick-counter decrement removed');
// FIX 2 — wake lock held for every timed session, re-requested after a screen lock.
has('if(wakeLock && !wakeLock.released) return;', 'FIX2: released sentinel replaced, live one never duplicated');
has('requestWakeLock(); // persistent', 'FIX2: wake lock re-requested when the page becomes visible (persistent)');
has('function showCountIn(callback){\n  // Kill any prior count-in still running before we start a new one\n  _phxCancelCountIn();\n  requestWakeLock();', 'FIX2: wake lock held through the count-in');
hasNot("navigator.wakeLock.request('screen').then(function(lock){", 'FIX2: BLAB inline wakeLock request replaced by shared helper');
// FIX 3 — one 5-4-3-2-1-GO! count-in before every timed session, never scored.
has("numEl.textContent='5';", 'FIX3: count-in opens on 5 (not 6)');
has("var label = (el>=5) ? 'GO!' : String(5-el);", 'FIX3: 5,4,3,2,1 then GO!');
has('if(el>=6){\n      clearInterval(iv);', 'FIX3: hands over one second after GO!');
hasNot('st.afapCountdown', 'FIX3: BLAB afap inline 5→0 countdown removed');
hasNot('id="afap-countdown"', 'FIX3: afap-countdown element removed');
[
  ["showCountIn(function(){\n      // The user may have backed out of the runner during the count-in", 'BLAB runner (complex/run/interval/tabata)'],
  ["showCountIn(function(){\n    if(!document.body.contains(o)) return; // left the runner during the count-in\n    requestWakeLock();\n    _phxStampTimerStart();\n    paintTime();", 'WOD count-up'],
  ["paintAmrap();\n    window._phxLibTick=setInterval(paintAmrap,1000);", 'WOD AMRAP'],
  ["minStart=_phxStampTimerStart();", 'WOD EMOM'],
  ["_phxStampTimerStart();\n    startWork();", 'WOD sprint intervals'],
  ["showCountIn(function(){\n    if(!document.getElementById('core-timer-display')) return;", 'Core 20-min timer'],
  ["showCountIn(function(){\n          if(!cfRunning) return; // stopped / left during the count-in", 'CrossFit benchmark WOD'],
  ["showCountIn(function(){\n          if(!karenRunning) return; // stopped / left during the count-in", 'Karen benchmark WOD'],
].forEach(([needle, label]) => has(needle, 'FIX3: count-in gates the clock — ' + label));
// rest is a phase inside a live session — the lock must survive it
has('function _phxReleaseWakeLockIfIdle(){\n  if(!window._phxTimerResync){ releaseWakeLock(); requestWakeLock(); }', 'FIX2: rest end keeps the lock while a session is registered');
has('    _phxReleaseWakeLockIfIdle();\n    // v4.9.97: fire-and-clear the completion callback', 'FIX2: rest-overlay completion uses the guarded release');
// a cancelled count-in must never leave a runner frozen at 0:00
has('if(!window._blabWoTimer && !window._countInState && !st.resting && !st._finished) _blabStartClock();', 'FIX3: BLAB runner self-heals if its count-in was cancelled');
has('window._blabWoState._finished = true', 'FIX3: finished/exited runner cannot restart its clock');
// the count-in itself must never stamp the session clock
{
  const i = html.indexOf('function showCountIn(callback){');
  const j = html.indexOf('window.showCountIn = showCountIn;', i);
  (i > 0 && j > i && !html.slice(i, j).includes('_phxTimerStart'))
    ? ok('FIX3: showCountIn never stamps _phxTimerStart (count-in is unscored)')
    : bad('FIX3: showCountIn must not touch _phxTimerStart');
}

// ── v4.9.117 session-launch regression guards ────────────────────────────────
// sessTypeStr must be declared in openTodaySession (its removal in v4.9.112 made every
// session launch throw ReferenceError before reaching the renderer).
has("var sessTypeStr = String(sess.session_type||'').toLowerCase();", 'openTodaySession declares sessTypeStr');
// The routing that reads sessTypeStr must exist (proves the guard above covers the real usage).
has("if(sessTypeStr === 'core_circuit'){", 'sessTypeStr routing present');
// blabOpenSession wraps the renderer launch so downstream errors surface, not silently swallowed.
has('[PHX] blabOpenSession → openTodaySession threw', 'blabOpenSession try/catch logs renderer errors');

// ── v4.9.115 PHX_LIB prescribed-load audit (Category A + B) ──────────────────
has("_phxMv('Wall Ball','50 reps · 9kg')",           'Kronos Wall Ball load');
has("_phxMv('Sandbag Over Shoulder','30 reps · 25kg')", 'Kronos Sandbag Over Shoulder load');
has("_phxMv('Sandbag Carry','200m · 30kg')",         'Atlas/Ragnarok Sandbag Carry load');
has("id:'wod-ragnar'",                                'Ragnar AMRAP 25 present');
has("id:'wod-hammerfall'",                            'Hammerfall 21-15-9 present');
has("id:'aerobic-the-row'",                           'Aerobic: The Row present');
has("id:'aerobic-long-run'",                          'Aerobic: The Long Run present');

// ── v4.9.110 Programme Audit ────────────────────────────────────────────────
has('window.blabOpenAudit = function', 'audit entry blabOpenAudit present');
has("onclick=\"closeSidebar();window.blabOpenAudit()\"", 'sidebar item wired to audit');
has('>Programme Audit<', 'sidebar labelled "Programme Audit"');
has('window.blabOpenAuditDay = function', 'per-day audit opener present');
has('window._blabDecorateAuditSession = function', 'audit session decorator present');
has('window._blabAuditDryRun = function', 'dry-run switch present');
has('window._blabExitAuditSession = function', 'audit exit handler present');
has('window._blabAuditWeekStatus = function', 'week status helper (COMPLETED/IN PROGRESS/UPCOMING)');
// test-mode short-circuits — no logging / no state change
has('if(window._blabDryRun) return;', 'dry-run guard neutralises saves/complete');
has('if(!window.blabIsActive() && !window._blabDryRun)', 'openTodaySession bypasses programme guard in dry run');
has('if(!window._blabDryRun){\n    supabaseStartSession', 'dry-run skips server session start');
has('if(window._blabAuditStateOverride) return window._blabAuditStateOverride;', 'audit placeholder state override');

// Dead overlay duplicates removed
hasNot('window.blabBuildExCard', 'blabBuildExCard removed');
hasNot('window.blabLaunchExercise', 'blabLaunchExercise removed');
hasNot('function blabRenderPct', 'blabRenderPct removed');
hasNot('function blabRenderSuper(', 'blabRenderSuper removed');
hasNot('function blabRenderMaxReps', 'blabRenderMaxReps removed');
hasNot('function blabRenderStd', 'blabRenderStd removed');
hasNot("document.getElementById('blab-session-overlay')", 'blabOpenSession overlay fallback removed');
// Live runner kept
has('window.blabRunWorkout = function', 'live runner blabRunWorkout kept');
has('function blabRenderAfap', 'blabRenderAfap kept');
has('function blabRenderTR', 'blabRenderTR kept');
has('function blabRenderRun', 'blabRenderRun kept');

// Day 2 main lift by block
has("w <= 5 ? 'Free Back Squat' : w <= 10 ? 'Conventional Deadlift' : 'Squat or Deadlift (your choice)'", 'Day2 main lift by block (squat/deadlift/choice)');
// Day 4 Lower Power — full 12-week spec
has("name:'Lower Power'", 'Day4 is Lower Power');
has("name:'Prowler Push'", 'Day4 Prowler Push finisher present');
has("name:'Lower Power — Deload'", 'Day4 deload variant (Lower Power)');

// Complex sets override
has("({1:2,2:2,3:2,4:4,5:1,6:3,7:3,8:3,9:3,10:1,11:4,12:5})[w]", 'complexSets override array (spec)');
has("var complexRest = (w <= 3) ? 90 : 60", 'complex rest 90s (W1-3) else 60s');
has("({5:[8],6:[7,8,9],7:[8,9,10],8:[8,9,10],9:[10,9,8],10:[8],11:[10,9,8,7],12:[10,9,8,7,6]})[w]", 'complex per-set reps (W6 asc 7/8/9, W7-8 asc 8/9/10, W9/W11/W12 desc, deload 1×8)');

// Day 1 content fixes
has("Standing Rope 'J' Pulldowns", 'Day1 W8/W9 Rope J-Pulldowns');
has("3-Way 'Shoulder Shocker'", 'Day1 W8/W9 Shoulder Shocker');
has("name:'DB Floor Press (palms in)'", 'Day1 W11 DB Floor Press');

// Day 3 content fixes + deload chin
has("var dTgt = C > 0 ? Math.round(C * 0.5) : 0", 'deload chin = 50% OF max (not +50%)');
has('function bwComplex(rounds)', 'Bodyweight Complex builder present');
has("w === 4 ? bwComplex(3) : pushups100()", 'W4 finisher = Bodyweight Complex ×3');
has('bbPushupsDescending(18)', 'W8 finisher = Barbell Push-ups 18→1');
has('bbPushupsDescending(19)', 'W9 finisher = Barbell Push-ups 19→1');
has('bbPushupsDescending(20)', 'W11 finisher = Barbell Push-ups 20→1');
has("name:'Push-Up Max Test'", 'W12 Day3 Push-Up test (no descending)');
has("name:'Chin-Up Max Test', format:'total_rep_goal', target:0, chin_test:true", 'W12 Day3 fresh chin max test');

// Data fixes: new formats + timed + capture
has("phxEx._blabFmt = 'steady_state'", 'mapper: steady_state format');
has("phxEx._blabFmt = 'tabata'", 'mapper: tabata format');
has("bs.records['steady_state']=t", 'steady_state saves its own record');
has("bs.records['tabata_rounds']=r", 'tabata saves tabata_rounds');
has("_timeRecordKey:'100_pushups_time'", '100 push-ups timed via afap (own key)');
has("_timeRecordKey:'bw_complex_time'", 'Bodyweight Complex timed via afap (own key)');
has('var k=st.ex._timeRecordKey', 'afap completion uses per-exercise time key');
has("_bs.records['bench_test_reps']=_rp", 'W12 bench test saves bench_test_reps');
has("_bs.records['bench_test_load']=_wt", 'W12 bench test saves bench_test_load');
has("_bs.records[_bex.blab_lift+'_amrap_w'+_bex._blabWeek]=_rp", 'main-lift AMRAP top set captured per week');
has('window._blabLogResult=function', 'standard-set result capture handler');
has("records[ex.name+'_result']", 'result capture prev surfaced');

// Previous-best surfacing
has("ex._blabFmt === 'percentage_sets' && (ex.prev_amrap_reps||0)", 'percentage_sets shows last-week top set');
has("ex._blabFmt === 'max_reps_sets' && (ex.prev_best||0)", 'max_reps_sets prev-best banner');
has('function blabPrevBestBanner(value, label, suffix)', 'prev-best banner helper present (labelled + suffix variant)');

// ── v4.9.111 Weekly progression wording ──────────────────────────────────────
has("blabPrevBestBanner(ex.prev_amrap_reps+' reps'+(ex.prev_amrap_wt?' @ '+ex.prev_amrap_wt+'kg':''), 'Last week')", '#1 percentage_sets banner labelled "Last week:"');
has("phxEx.coaching_note = 'Beat last week: '+phxEx.prev_best+' reps'", '#2 max_reps dynamic "Beat last week:" note');
has('Last session: ', '#3 superset A/B prev banner shows last session data');
has("(fmt==='interval'?' — beat it.':'')", '#5 interval run appends "— beat it."');
has("var _pbSuffix = (ex._timeRecordKey==='100_pushups_time') ? ' — beat it.' : ''", '#6 100 Push-ups afap banner suffix (complexes stay plain)');

// ── 4. v4.9.112 STATIC LIBRARY — execute PHX_LIB + phxBuildSessionPlan × 70 ──
console.log('\nLibrary check — v4.9.112 static WOD + Core library (executes all 70 sessions):');
try {
  const libSlice = extract('function _phxMv(name, detail){', 'var PHX_SCORE_KEY=');
  const sb2 = { console };
  vm.createContext(sb2);
  new vm.Script(libSlice).runInContext(sb2);
  const wods = sb2.phxAllWods(), core = sb2.phxAllCore(), all = sb2.phxAllSessions();
  wods.length===19 ? ok('exactly 19 WODs (14 Conditioning + 5 Aerobic)') : bad('expected 19 WODs, got '+wods.length);
  core.length===6  ? ok('exactly 6 Core sessions (v4.9.123: R1/R2/R3 + S1/S2/S3)') : bad('expected 6 Core, got '+core.length);
  all.length===25  ? ok('25 total sessions') : bad('expected 25 sessions, got '+all.length);
  sb2.phxWodsByTier('CONDITIONING').length===14 ? ok('14 Conditioning WODs') : bad('Conditioning count '+sb2.phxWodsByTier('CONDITIONING').length);
  sb2.phxWodsByTier('AEROBIC').length===5       ? ok('5 Aerobic sessions') : bad('Aerobic count '+sb2.phxWodsByTier('AEROBIC').length);
  const ctExpect={'Rotational Focus':3,'Core Strength':3};
  const ct={}; core.forEach(c=>ct[c.coreType]=(ct[c.coreType]||0)+1);
  JSON.stringify(ct)===JSON.stringify(ctExpect) ? ok('Core types 3/3 (Rotational Focus + Core Strength)') : bad('Core types wrong: '+JSON.stringify(ct));
  // every remaining core session is trunk-only — no running / rowing-machine / assault-bike
  // (resistance "Row" moves like Cable Row / Plank Row are core work, not conditioning)
  const cardio=/\b(run|running|assault bike|bike|erg|jog|swim|treadmill|sprint|rowing machine)\b/i;
  const cardioHit=core.filter(c=> (c.movements||[]).some(m=>cardio.test(m.name)));
  cardioHit.length===0 ? ok('no conditioning (run/row-machine/bike) movements in Core') : bad('Core has cardio movements: '+cardioHit.map(c=>c.id).join(', '));
  // Unique ids + every session builds a renderer plan without throwing
  const ids=new Set(); let dup=0, built=0, perr=0; const rSeen=new Set();
  for(const s of all){ if(ids.has(s.id)) dup++; ids.add(s.id); rSeen.add(s.renderer);
    try { const p=sb2.phxBuildSessionPlan(s); if(p&&p.id) built++; }
    catch(e){ perr++; console.log('  \x1b[31m✗ '+s.id+' plan build: '+e.message+'\x1b[0m'); } }
  dup===0 ? ok('all session ids unique') : bad(dup+' duplicate session ids');
  (built===all.length&&perr===0) ? ok('all '+all.length+' sessions build a renderer plan without errors') : bad(built+'/'+all.length+' built, '+perr+' errors');
  ['time','amrap','intervals','core'].forEach(r=> rSeen.has(r)?ok('renderer exercised: '+r):bad('renderer never used: '+r));
  sb2.phxFmtTime(754)==='12:34' ? ok('phxFmtTime 754→12:34') : bad('phxFmtTime broken');
  sb2.phxIsBetter('time',700,800)===true ? ok('time score: lower is better') : bad('time compare broken');
  sb2.phxIsBetter('load',120,100)===true ? ok('load score: higher is better') : bad('load compare broken');
} catch(e){ bad('library execution failed: '+e.message); }

// Feature assertions — v4.9.112 rebuild present
has('window._phxOpenSessionLibrary = function', 'session library entry (Add Session)');
has('window._phxOpenSessionDetail = function', 'session detail screen');
has('function _phxRenderTime',      'renderer: AFAP / FOR TIME');
has('function _phxRenderAmrap',     'renderer: AMRAP');
has('function _phxRenderLoad',      'renderer: FOR LOAD');
has('function _phxRenderEmom',      'renderer: EMOM');
has('function _phxRenderIntervals', 'renderer: SPRINT INTERVALS');
has('function _phxRenderCore',      'renderer: CORE');
// v4.9.113 FIX 1 — chipper per-movement blocks (load chip + rep counter, in-order)
has('function _phxParseMoveDetail', 'FIX1: chipper movement parser (reps/load/dist)');
has("class=\"phx-tt-count\"", 'FIX1: per-movement rep counter');
has("class=\"phx-step-done\"", 'FIX1: per-movement Done — Next (in-order)');
// v4.9.113 FIX 2 — core set-by-set logging
has('function _phxParseCoreDetail', 'FIX2: core set parser');
has('function _phxCorePrevBest',    'FIX2: core per-exercise previous best');
has("class=\"phx-cs-load\"", 'FIX2: per-set load input');
has("class=\"phx-cs-reps\"", 'FIX2: per-set reps input');
// v4.9.114 — Core + FOR-LOAD WOD sets route inter-set rest through the shared full-screen
// #rest-overlay (gold countdown) via startRestTimer(), not the legacy mini bottom bar.
has("startRestTimer(90, 'Next set'", 'FIX2: core rest fires full-screen 90s overlay');
has("startRestTimer(180, 'Next set'", 'FIX2: FOR-LOAD WOD set rest fires full-screen 3-min overlay');
has("class=\"phx-load-tick\"", 'FIX2: FOR-LOAD per-set tick to confirm');
has("sets:(extra&&extra.sets)||null", 'FIX2: per-set data saved to record');
// v4.9.113 FIX 3 — Circuit + Endurance Grind categories dropped
hasNot("coreType:'Circuit'",         'FIX3: Circuit category removed');
hasNot("coreType:'Endurance Grind'", 'FIX3: Endurance Grind category removed');
hasNot("id:'core-ci-phoenix'",       'FIX3: Phoenix Circuit removed');
hasNot("id:'core-en-rowcore'",       'FIX3: Row + Core removed');
has('function _phxOpenScoreEntry',  'score entry screen');
has('function renderRecords',       'RECORDS scoreboard renderer');
has("sb.from('wod_scores')",        'scores persist to Supabase wod_scores');
has('id="screen-records"',          'RECORDS screen present');
has('navTo(\'records\')',           'RECORDS nav route wired');
has('>Records<',                    'RECORDS nav/sidebar label present');
// Legacy WOD system removed
hasNot('function openPhoenixWOD',        'legacy openPhoenixWOD removed');
hasNot('function renderDailyWOD',        'legacy renderDailyWOD removed');
hasNot('function _phxGenerateDailyWOD',  'legacy _phxGenerateDailyWOD removed');
hasNot('function _detectWODFormat',      'legacy _detectWODFormat removed');
hasNot('function openWODLibrary',        'legacy openWODLibrary removed');
hasNot('function generateCustomWOD',     'legacy generateCustomWOD removed');
hasNot('function openBenchmarkLibrary',  'legacy openBenchmarkLibrary removed');
hasNot('function phxWodTierColour',      'legacy phxWodTierColour removed');
hasNot('window._wlibSetFilter',          'legacy _wlib browser removed');
hasNot('id="screen-wod-library"',        'legacy WOD Library screen removed');

// ── BLAB TRAINING CALENDAR (v4.9.144) ───────────────────────────────────────
console.log('\nBLAB Training Calendar — static wiring:');
has('id="screen-blab-calendar"',      'CAL: calendar screen present');
has("'blab-calendar':'screen-blab-calendar'", 'CAL: navTo route wired');
has('id="prog-blab-cal-tile"',        'CAL: Programme tab entry point');
has('window.blabCalOpen',             'CAL: blabCalOpen exported');
has('window.blabCalTodayEntry',       'CAL: Today card reads scheduled session');
has('window.blabCalMarkCompleted',    'CAL: completion stamps the calendar entry');
has('window._blabCalDay2RefDate',     'CAL: 48h gate reads scheduled Day 2');
has('blabCalMarkCompleted(week, day)','CAL: hooked into blabCompleteSession');
has('blabCalHydrateFromState',        'CAL: cloud mirror rehydrated on restore');
has("localStorage.setItem(_blabCalKey()", 'CAL: writes blab_calendar_v1_{uid}');
has('s.calendar = c',                 'CAL: mirrors into blab_state.calendar');

console.log('\nBLAB Training Calendar — rule execution:');
try {
  const srcCal = extract('var _BLAB_CAL_DAYS =', '// ── Screen open / week navigation');
  const store = {};
  const sandbox = {
    window: {}, console,
    currentSession: { user: { id: 'u1' } },
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = v; },
      removeItem: (k) => { delete store[k]; }
    },
    isDeload: (w) => w === 5 || w === 10 || w === 15,
    _phxWeekSmartRec: () => null,
    _phxRecoveryNoteForAdd: () => ({ kind: 'warn', text: 'two strength' })
  };
  let blabState = { active: true, week: 1, last_completed_day: 0, maxes:{bench:100,squat:140,deadlift:180} };
  sandbox.window.blabGetState = () => blabState;
  sandbox.window.blabSaveState = (s) => { blabState = s; };
  sandbox.window.blabGetSessionData = () => ({ exercises: [{ name: 'Bench Press' }] });
  vm.createContext(sandbox);
  new vm.Script(srcCal).runInContext(sandbox);
  const W = sandbox.window;

  // ── 48h hard gate, including across an ISO week boundary ──
  // Day 2 scheduled Sunday 2026-08-23 → Day 4 blocked Sun + Mon, allowed Tue.
  W.blabCalSave({ sessions: [{ blabWeek:1, blabDay:2, scheduledDate:'2026-08-23', status:'pending' }], customs: [] });
  const d4 = { blabWeek:1, blabDay:4 };
  W._blabCalCanDrop(d4, '2026-08-23').ok === false ? ok('CAL: Day 4 blocked on the Day 2 date itself') : bad('CAL: Day 4 should be blocked same-day');
  W._blabCalCanDrop(d4, '2026-08-24').ok === false ? ok('CAL: Day 4 blocked 24h after Day 2 (crosses week boundary)') : bad('CAL: Day 4 should be blocked at +1 day');
  W._blabCalCanDrop(d4, '2026-08-25').ok === true  ? ok('CAL: Day 4 allowed at +48h (Sun → Tue across weeks)') : bad('CAL: Day 4 should be allowed at +2 days');
  (W._blabCalCanDrop(d4, '2026-08-24').reason === 'Day 4 requires 48h after lower body')
    ? ok('CAL: blocking reason text matches spec') : bad('CAL: wrong blocking reason text');
  // Non-Day-4 sessions are never gated.
  W._blabCalCanDrop({ blabWeek:1, blabDay:3 }, '2026-08-23').ok === true
    ? ok('CAL: gate only applies to Day 4') : bad('CAL: gate wrongly applied to Day 3');
  // No Day 2 reference at all → no gate.
  W.blabCalSave({ sessions: [], customs: [] });
  W._blabCalCanDrop(d4, '2026-08-23').ok === true
    ? ok('CAL: no Day 2 scheduled → Day 4 ungated') : bad('CAL: ungated case wrongly blocked');

  // ── Queue: sequential, skips scheduled, stops at W12D4 ──
  W.blabCalSave({ sessions: [{ blabWeek:1, blabDay:2, scheduledDate:'2026-08-20', status:'pending' }], customs: [] });
  const q = W._blabCalQueue(4);
  (q[0].blabDay === 1 && q[1].blabDay === 3 && q[2].blabDay === 4)
    ? ok('CAL: queue skips already-scheduled sessions, keeps order') : bad('CAL: queue order/skip wrong — ' + JSON.stringify(q));
  blabState = { active:true, week:12, last_completed_day:3, maxes:{bench:100,squat:140,deadlift:180} };
  W.blabCalSave({ sessions: [], customs: [] });
  const qEnd = W._blabCalQueue(5);
  (qEnd.length === 1 && qEnd[0].blabWeek === 12 && qEnd[0].blabDay === 4)
    ? ok('CAL: queue terminates at W12 D4') : bad('CAL: queue overran the 12-week block — ' + JSON.stringify(qEnd));
  blabState = { active:true, week:1, last_completed_day:0, maxes:{bench:100,squat:140,deadlift:180} };

  // ── Warnings: 3-in-a-row, same-day double, deload badge ──
  const mkWeek = (isoMon) => { const out = []; const [y,mo,dd] = isoMon.split('-').map(Number);
    for (let i=0;i<7;i++){ const d = new Date(y, mo-1, dd+i); out.push(d); } return out; };
  W.blabCalSave({ sessions: [
    { blabWeek:1, blabDay:1, scheduledDate:'2026-08-17', status:'pending' },
    { blabWeek:1, blabDay:2, scheduledDate:'2026-08-18', status:'pending' },
    { blabWeek:1, blabDay:3, scheduledDate:'2026-08-19', status:'pending' }
  ], customs: [] });
  const warn = W._blabCalWarnings(mkWeek('2026-08-17'));
  (warn.byDate['2026-08-17'].consecutive && warn.byDate['2026-08-18'].consecutive && warn.byDate['2026-08-19'].consecutive)
    ? ok('CAL: 3 consecutive strength days flagged amber') : bad('CAL: consecutive-strength run not flagged');
  warn.byDate['2026-08-20'].consecutive === false
    ? ok('CAL: non-consecutive day left unflagged') : bad('CAL: false positive on consecutive run');
  W.blabCalSave({ sessions: [
    { blabWeek:1, blabDay:1, scheduledDate:'2026-08-17', status:'pending' },
    { blabWeek:1, blabDay:2, scheduledDate:'2026-08-17', status:'pending' }
  ], customs: [] });
  const warn2 = W._blabCalWarnings(mkWeek('2026-08-17'));
  warn2.byDate['2026-08-17'].sameDay ? ok('CAL: two strength sessions on one day flagged') : bad('CAL: same-day double not flagged');
  warn2.byDate['2026-08-17'].sameDayNote ? ok('CAL: same-day note reuses _phxRecoveryNoteForAdd') : bad('CAL: same-day note missing');
  W.blabCalSave({ sessions: [{ blabWeek:5, blabDay:1, scheduledDate:'2026-08-17', status:'pending' }], customs: [] });
  W._blabCalWarnings(mkWeek('2026-08-17')).byDate['2026-08-17'].deload
    ? ok('CAL: deload week 5 badges the tile') : bad('CAL: deload badge missing for week 5');
  W.blabCalSave({ sessions: [{ blabWeek:4, blabDay:1, scheduledDate:'2026-08-17', status:'pending' }], customs: [] });
  W._blabCalWarnings(mkWeek('2026-08-17')).byDate['2026-08-17'].deload === false
    ? ok('CAL: non-deload week not badged') : bad('CAL: false deload badge');

  // ── Today integration + completion ──
  const todayISO = (() => { const d = new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); })();
  W.blabCalSave({ sessions: [{ blabWeek:2, blabDay:3, scheduledDate:todayISO, status:'pending' }], customs: [] });
  const te = W.blabCalTodayEntry();
  (te && te.blabWeek === 2 && te.blabDay === 3)
    ? ok('CAL: Today card resolves the session scheduled for today') : bad('CAL: blabCalTodayEntry did not resolve todays session');
  W.blabCalMarkCompleted(2, 3);
  W.blabCalTodayEntry() === null ? ok('CAL: completed session drops off the Today card') : bad('CAL: completed session still returned as today');
  W._blabCalQueue(3).some(x => x.blabWeek === 2 && x.blabDay === 3) === false
    ? ok('CAL: completed session leaves the queue') : bad('CAL: completed session still queued');
} catch (e) {
  bad('CAL: calendar rule execution failed — ' + e.message);
}

// ── PEPTIDE PORTAL — recon engine / Today tile / ADJUST / BLOODS ────────────
// v4.9.141-146. Guards the peptide domain against accidental removal by other
// chats editing the shared file.
console.log('\nFeature check — Peptide Portal (v4.9.141-146):');

// v4.9.141 reconstitution engine
has('var _PEP_RECON = {',                      'PEP: _PEP_RECON default table present');
has('function _pepRecon(stack, c)',            'PEP: _pepRecon resolver present');
has('function _pepDraw(dose, doseUnit, recon)','PEP: _pepDraw units calculator present');
has('function _pepFmtDose(dose, unit)',        'PEP: _pepFmtDose mg/mcg formatter present');
has('function _pepGetDoses(ps, dateStr)',      'PEP: _pepGetDoses is date-parameterised');

// v4.9.142 Today screen tile
has('id="today-peptide-tile"',                 'PEP: Today tile container in screen-today');
has('function pepRenderTodayTile()',           'PEP: pepRenderTodayTile defined');
has("if(typeof pepRenderTodayTile==='function') pepRenderTodayTile();",
                                               'PEP: Today tile called from renderTodayScreen');

// v4.9.143 ADJUST tab
has('var PEP_ADVISOR_SYSTEM =',                'PEP: advisor system prompt present');
has('function _pepBuildContext(ps)',           'PEP: advisor context builder present');
has('function _pepAdherence(ps, days)',        'PEP: 14-day adherence calculator present');
has('async function pepGenerateAdvice()',      'PEP: pepGenerateAdvice present');
has('function _pepTabAdjust(ps)',              'PEP: ADJUST tab renderer present');

// v4.9.146 BLOODS tab
has('function _pepTabBloods(ps)',              'PEP: BLOODS tab renderer present');
has('async function pepBloodsLoad(force)',     'PEP: blood panel loader present');
has('async function pepExtractMarkers()',      'PEP: AI marker extraction present');
has('async function pepSaveBloodPanel()',      'PEP: blood panel save present');
has('function _pepMarkerFlag(m)',              'PEP: marker range flagging present');
has('function _pepDownscale(dataURL, maxDim, quality)',
                                               'PEP: image downscale before upload/vision');
has('sb.storage.from("blood-panels")',         'PEP: uses the blood-panels bucket');
has('createSignedUrl',                         'PEP: private bucket read via signed URL');

// Blood images must NOT go to the public checkin-photos bucket.
(() => {
  const i = html.indexOf('// ── BLOODS tab');
  const j = html.indexOf('// ── ORDER tab', i + 1);
  if (i < 0 || j < 0) { bad('PEP: could not isolate BLOODS block for privacy check'); return; }
  const blk = html.slice(i, j);
  blk.includes('checkin-photos')
    ? bad('PEP: BLOODS block references the PUBLIC checkin-photos bucket')
    : ok('PEP: BLOODS block never touches the public checkin-photos bucket');
  blk.includes('getPublicUrl')
    ? bad('PEP: BLOODS block uses getPublicUrl on medical images')
    : ok('PEP: BLOODS block never calls getPublicUrl');
})();

// All five portal tabs wired
['today','protocol','bloods','adjust','order'].forEach(t => {
  html.includes('{key:"' + t + '",label:"' + t.toUpperCase() + '"}')
    ? ok('PEP: ' + t.toUpperCase() + ' tab registered')
    : bad('PEP: ' + t.toUpperCase() + ' tab missing from tab bar');
});

// v4.9.152 restore rule — newest timestamp wins
has('ps._ts = new Date().toISOString();',      'PEP: pepSaveState stamps _ts');
has('function _pepBackupLocal(key, rawLocal)', 'PEP: local backup before overwrite');
hasNot('if(local) return; // local takes priority',
                                               'PEP: old local-always-wins rule removed');
(() => {
  const i = html.indexOf('function pepRestoreFromCloud(profileRow)');
  const j = html.indexOf('function _pepBackupLocal', i + 1);
  if (i < 0 || j < 0) { bad('PEP: could not isolate pepRestoreFromCloud'); return; }
  const blk = html.slice(i, j);
  blk.includes('cloudWins = ct > lt')
    ? ok('PEP: restore compares cloud _ts against local _ts')
    : bad('PEP: restore does not compare timestamps');
  blk.includes('_pepBackupLocal(key, rawLocal)')
    ? ok('PEP: restore backs up local before overwriting')
    : bad('PEP: restore overwrites local without a backup');
})();

// Restore resolution table — mirrors the live branch logic.
(() => {
  const resolve = (localTs, cloudTs, hasLocal) => {
    if (!hasLocal) return 'cloud';
    const lt = Date.parse(localTs || ''), ct = Date.parse(cloudTs || '');
    const ls = !isNaN(lt), cs = !isNaN(ct);
    if (ls && cs) return ct > lt ? 'cloud' : 'local';
    if (cs && !ls) return 'cloud';
    return 'local';
  };
  const A = '2026-08-01T00:00:00Z', B = '2026-08-17T00:00:00Z';
  const cases = [
    ['no local -> cloud',                resolve(null, A, false), 'cloud'],
    ['cloud newer -> cloud',             resolve(A, B, true),     'cloud'],
    ['local newer -> local',             resolve(B, A, true),     'local'],
    ['equal timestamps -> local',        resolve(B, B, true),     'local'],
    ['cloud stamped, local not -> cloud',resolve(null, B, true),  'cloud'],
    ['local stamped, cloud not -> local',resolve(A, null, true),  'local'],
    ['neither stamped -> local',         resolve(null, null, true),'local'],
  ];
  cases.forEach(([label, got, want]) => got === want
    ? ok('PEP: restore ' + label)
    : bad('PEP: restore ' + label + ' — got ' + got));
})();

// v4.9.155 mirror hygiene — no medical data to the cloud, no swallowed errors
has('function _pepCloudPayload(ps)',   'PEP: cloud payload builder present');
has('function _pepErrorSummary(ps)',   'PEP: scrubbed diagnostic summary present');
has('window._pepFlushCloud = function()', 'PEP: pagehide flush present');
has("window.addEventListener(\"pagehide\", function(){ window._pepFlushCloud(); });",
                                       'PEP: pagehide listener wired');
hasNot('.then(function(){});',         'PEP: empty swallow-everything then() gone');

(() => {
  const i = html.indexOf('function _pepSendCloud(payload, useKeepalive)');
  const j = html.indexOf('window._pepFlushCloud', i + 1);
  if (i < 0 || j < 0) { bad('PEP: could not isolate _pepSendCloud'); return; }
  const blk = html.slice(i, j);
  blk.includes('.then(function(res){')  ? ok('PEP: mirror inspects res')          : bad('PEP: mirror ignores res');
  blk.includes('.catch(function(e){')   ? ok('PEP: mirror handles rejection')     : bad('PEP: mirror has no .catch — unhandled rejection');
  blk.includes('_phxRecordWriteError("pep mirror"') ? ok('PEP: mirror records write errors') : bad('PEP: mirror does not record write errors');
  blk.includes('keepalive: true')       ? ok('PEP: flush uses a keepalive PATCH') : bad('PEP: flush has no keepalive path');
  blk.includes('_pepErrorSummary(payload)') ? ok('PEP: diagnostics get the scrubbed summary') : bad('PEP: diagnostics get a raw payload');
})();

// The mirrored payload must never carry blood markers.
(() => {
  const i = html.indexOf('function _pepCloudPayload(ps)');
  const j = html.indexOf('function _pepErrorSummary', i + 1);
  const blk = html.slice(i, j);
  blk.includes('k !== "bloods"')
    ? ok('PEP: bloods stripped from the mirrored payload')
    : bad('PEP: bloods NOT stripped — medical data would reach profiles.peptide_state');
})();

// Diagnostic summary must be counts only — no field that could hold a value.
(() => {
  const i = html.indexOf('function _pepErrorSummary(ps)');
  const j = html.indexOf('function _pepMirrorToCloud', i + 1);
  const blk = html.slice(i, j);
  /markers|value|name:/.test(blk)
    ? bad('PEP: error summary references marker values')
    : ok('PEP: error summary is counts and timestamp only');
})();

// Recon maths — the numbers Jon draws up. 100 units = 1 mL.
(() => {
  const conc = (vialMg, waterMl) => vialMg / waterMl;
  const units = (doseMg, vialMg, waterMl) => (doseMg / conc(vialMg, waterMl)) * 100;
  const near = (a, b) => Math.abs(a - b) < 0.001;
  near(units(0.25, 5, 2), 10)   ? ok('PEP: 250mcg from 5mg/2mL = 10u')    : bad('PEP: 250mcg recon maths wrong');
  near(units(0.5,  5, 2), 20)   ? ok('PEP: 500mcg from 5mg/2mL = 20u')    : bad('PEP: 500mcg recon maths wrong');
  near(units(6,   10, 0.5), 30) ? ok('PEP: Reta 6mg from RT10/0.5mL = 30u'): bad('PEP: RT10 recon maths wrong');
  near(units(6,   30, 5),  100) ? ok('PEP: Reta 6mg from RT30/5mL = 100u') : bad('PEP: RT30 recon maths wrong');
  near(units(100,500, 5),  100) ? ok('PEP: NAD+ 100mg from 500mg/5mL = 100u') : bad('PEP: NAD+ recon maths wrong');
})();

// ── Deload cadence — code and coaching prompt must agree (v4.9.152) ─────────
// Jon ruled 2026-08-18: deload runs as the base programme, weeks 5 and 10.
// Before this, PHOENIX_COACHING_PROMPT contained TWO contradictory schedules
// (block periodisation 4/8/12, and an age-banded "every 3rd week (45+)") which
// disagreed with each other and with BLAB. These pin all three surfaces.
console.log('\nDeload cadence — code vs coaching prompt:');
has('function isDeload(w){return w===5||w===10||w===15;}', 'DELOAD: isDeload() pins weeks 5/10/15');
has('var isDeload = (week === 5 || week === 10);',          'DELOAD: BLAB session builder pins weeks 5/10');
has('var isDeload = blabWeek===5 || blabWeek===10;',        'DELOAD: smart-recommend pins weeks 5/10');
// The age-banded rule is dead — it must not come back in any form.
hasNot('Every 3rd week (45+)',      'DELOAD: age-banded scheduled rule removed');
hasNot('every 3rd-4th week (35-44)','DELOAD: age band 35-44 removed');
hasNot('every 4th week (under 35)', 'DELOAD: age band under-35 removed');
// Prompt block periodisation must name 5 and 10, never 4/8/12.
has('- Scheduled: every 5th week', 'DELOAD: prompt states the every-5th-week cadence');
has('weeks 5 and 10',              'DELOAD: prompt names weeks 5 and 10');
has('BLOCK 1 — ACCUMULATION (Weeks 1-4, deload week 5):',   'DELOAD: prompt Block 1 deloads week 5');
has('BLOCK 2 — INTENSIFICATION (Weeks 6-9, deload week 10):','DELOAD: prompt Block 2 deloads week 10');
has('BLOCK 3 — REALISATION (Weeks 11-12):',                  'DELOAD: prompt Block 3 is weeks 11-12');
hasNot('Deload week 8.',  'DELOAD: stale "Deload week 8" gone from prompt');
hasNot('Deload week 12.', 'DELOAD: stale "Deload week 12" gone from prompt');
hasNot('Deload week 4."', 'DELOAD: stale "Deload week 4" gone from coach-note example');
// The unscheduled triggers are independent of cadence and must survive untouched.
has('RPE average > 9.5 two consecutive weeks',   'DELOAD: unscheduled RPE trigger intact');
has('completion rate < 60% two consecutive weeks','DELOAD: unscheduled completion trigger intact');
has('overreaching triad',                         'DELOAD: overreaching triad trigger intact');

// ── v4.9.155 [PM] Write-error diagnostics + BLAB mirror instrumentation ────────
// _phxRecordWriteError must redact: shape only, no details/hint, message truncated, ring of 8.
has('payload_shape: _phxShapeOf(payload)',          'DIAG: snapshot stores payload SHAPE not values');
hasNot('payload_preview:',                          'DIAG: raw payload_preview removed');
hasNot("details: (err && err.details) || null",     'DIAG: details (value-echoing) not recorded');
hasNot("hint: (err && err.hint) || null",           'DIAG: hint (value-echoing) not recorded');
has("if(msg.length > 200) msg = msg.slice(0, 200)", 'DIAG: message truncated to 200');
has("localStorage.setItem('phx_write_errors', JSON.stringify(ring))", 'DIAG: ring buffer written');
has('while(ring.length > 8) ring.shift();',         'DIAG: ring capped at 8');
// _blabSendCloud: BOTH branches record. Keepalive is the pagehide write — must not swallow.
has("_phxRecordWriteError('_blabSendCloud.keepalive'",        'BLAB MIRROR: keepalive HTTP failure recorded');
has("_phxRecordWriteError('_blabSendCloud.keepalive.reject'", 'BLAB MIRROR: keepalive rejection recorded');
has("_phxRecordWriteError('_blabSendCloud.update'",           'BLAB MIRROR: update res.error recorded');
has("_phxRecordWriteError('_blabSendCloud.update.reject'",    'BLAB MIRROR: update rejection recorded');
hasNot("}).catch(function(){});\n    } catch(_){}",           'BLAB MIRROR: keepalive no longer swallows');
// Shared restore hook lives in PM plumbing, exactly once, and still chains both domains.
{
  const n = (html.match(/window\._phxOnProfileFetched = function\(row\)\{/g) || []).length;
  n === 1 ? ok('HOOK: _phxOnProfileFetched wrapper defined exactly once') : bad(`HOOK: wrapper defined ${n} times`);
  const idxHook = html.indexOf('SHARED RESTORE HOOK (PM-owned)');
  const idxPep  = html.indexOf('function pepGetState(');
  (idxHook > 0 && idxHook < idxPep) ? ok('HOOK: wrapper relocated to PM plumbing (before peptide block)') : bad('HOOK: wrapper still inside peptide block');
}
has('pepRestoreFromCloud(row)) _pepAfterRestore();', 'HOOK: chains peptide restore + repaint');
has('nutRestoreRecipesFromCloud(row)) _nutAfterRestore();', 'HOOK: chains nutrition restore + repaint');

// ── BLAB restore resolution (v4.9.158) ──────────────────────────────────────
// Jon ruled 2026-08-18: newest _ts wins, EXCEPT it may never roll training
// progress backwards. Behaviour is covered by tests/training.mjs; these pin the
// shape so the old local-wins rule cannot creep back in.
console.log('\nBLAB restore resolution:');
has('state._ts = new Date().toISOString()',  'RESTORE: blabSaveState stamps _ts on write');
has('window.blabProgressScore',              'RESTORE: progress score helper present');
has('function _blabBackupLocal',             'RESTORE: one-generation backup helper');
has("localStorage.setItem(key + '_bak', rawLocal)", 'RESTORE: backup writes to _bak key');
has('if(cloudScore < localScore){',          'RESTORE: progress guard blocks a behind-but-newer cloud');
has("_phxRecordWriteError('blabRestore.progressGuard'", 'RESTORE: blocked restore is recorded for Diagnostic');
has('cloudWins = ct > lt;',                  'RESTORE: strict newer-wins, ties keep local');
has('if(local.active !== true && cloud.active === true)', 'RESTORE: inactive local stub cannot shadow active cloud');
// The pre-v4.9.158 rule: local won whenever it was active, regardless of stamps.
hasNot("if(cloudDay > localDay){",           'RESTORE: old local-wins tiebreak removed');
hasNot('blabRestoreFromCloud abort: local active and >= cloud', 'RESTORE: old local-wins log line removed');

console.log(`\n${fail === 0 ? '\x1b[32mPASS' : '\x1b[31mFAIL'}\x1b[0m — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
