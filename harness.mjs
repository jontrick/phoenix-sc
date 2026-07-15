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

has("var APP_VERSION='4.9.110'", 'version is 4.9.110');

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
// Day 4 power + conditioning, not deadlift
has("name:'Power + Conditioning'", 'Day4 is Power + Conditioning');
has("name:'Conditioning Finisher', format:'tabata'", 'Day4 conditioning finisher (tabata)');
has("name:'Power + Conditioning — Deload'", 'Day4 deload variant (no conditioning finisher)');

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
has('function blabPrevBestBanner(value)', 'prev-best banner helper present');

console.log(`\n${fail === 0 ? '\x1b[32mPASS' : '\x1b[31mFAIL'}\x1b[0m — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
