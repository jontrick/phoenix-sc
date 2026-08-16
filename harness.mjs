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

has("var APP_VERSION='4.9.140'", 'version is 4.9.140');

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

console.log(`\n${fail === 0 ? '\x1b[32mPASS' : '\x1b[31mFAIL'}\x1b[0m — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
