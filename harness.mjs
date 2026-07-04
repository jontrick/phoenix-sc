#!/usr/bin/env node
// Phoenix node harness — static validation of the single-file PWA.
// 1. Syntax-checks every inline <script> block via vm (compile, no execute).
// 2. Asserts the v4.9.103 prominent "PREVIOUS BEST" feature is present and wired.
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
  const attrs = m[1] || '';
  const code = m[2] || '';
  idx++;
  if (/\bsrc\s*=/.test(attrs)) continue;        // external script, nothing to parse
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

// ── 2. Feature assertions ───────────────────────────────────────────────────
console.log('\nFeature check — v4.9.103 prominent PREVIOUS BEST banner:');
const has = (needle, label) => html.includes(needle) ? ok(label) : bad(`MISSING: ${label}`);

has("var APP_VERSION='4.9.107'", 'version is 4.9.107');

// v4.9.104: blabToPhoenixSession must carry prev_best fields onto the mapped phxEx
// object, otherwise the renderers (which read ex.prev_best) show a blank banner.
has('phxEx.prev_best = ex.prev_best || 0', 'mapper carries prev_best onto phxEx (afap + max-reps)');
has('phxEx.prev_best_wt = ex.prev_best_wt || 0', 'mapper carries prev_best_wt onto phxEx (max-reps)');

// v4.9.105: max_reps_sets renders through the GENERIC Phoenix set-row block (no dedicated
// builder), which previously ignored prev_best. The banner must be injected there.
console.log('\nFeature check — v4.9.105 prev-best across all BLAB formats:');
has("ex._blabFmt === 'max_reps_sets' && (ex.prev_best||0)", 'max-reps generic block gates on prev_best');
has('prevBestSection = blabPrevBestBanner(ex.prev_best', 'max-reps generic block builds prev-best banner');
has("'</div></div>'+\n      prevBestSection+\n      setsHTML", 'max-reps banner injected between header and set rows');

// v4.9.105: max_reps_sets raw exercise must carry prev_best/prev_best_wt from records
// BEFORE mapping (blabGetSessionData), else there is nothing for the mapper to carry.
has('prev_best:dbRecord, prev_best_wt:dbRecordWt', 'blabGetSessionData sets prev_best on raw max-reps ex');

// v4.9.105: superset — mapper reads previous A/B weights from records (keyed by movement name).
has('phxEx.prev_wt_a = _ssRec[ex.movements[0].name', 'mapper carries superset prev weight for A');
has('phxEx.prev_wt_b = _ssRec[ex.movements[1].name', 'mapper carries superset prev weight for B');
// Superset renderer shows the previous weight as small gold text under each movement.
// v4.9.106: gate widened to (prev_wt||prev_reps) so bodyweight movements still surface reps.
has("(ex.prev_wt_a||ex.prev_reps_a)?'<div style=\"font-size:11px;font-weight:700;color:var(--gold)", 'superset renderer shows Prev A (gold)');
has("(ex.prev_wt_b||ex.prev_reps_b)?'<div style=\"font-size:11px;font-weight:700;color:var(--gold)", 'superset renderer shows Prev B (gold)');
// Superset persists the last weight used per movement so next session can read it back.
has("bs.records[ex2.name+'_wt'] = last.ka", 'superset persists A weight to records');
has("bs.records[partner.name+'_wt'] = last.kb", 'superset persists B weight to records');

// Shared banner helper — the gold, top-pinned PREVIOUS BEST strip.
has('function blabPrevBestBanner(value)', 'blabPrevBestBanner helper defined');
has("Previous Best: '+value", 'banner renders "Previous Best:" label');
has('background:var(--gold-dim)', 'banner uses theme-aware gold tint');
has('color:var(--gold);">Previous Best', 'banner text is gold');

// AFAP: banner on the countdown screen AND the main runner screen (so it stays
// visible through the countdown, every set, and the completion screen).
has('blabPrevBestBanner((ex.prev_best||0)?blabFmt(ex.prev_best)', 'AFAP countdown shows banner (formatted time)');
has('h+=blabPrevBestBanner(prevBest?blabFmt(prevBest):', 'AFAP runner shows banner at top');

// Max-reps: banner shows reps AND the weight it was done at ("22 reps @ 27.5kg").
has("prevBest+' reps'+(prevBestWt?' @ '+prevBestWt+'kg':'')", 'max-reps banner shows "reps @ kg"');
has('var prevBestWt=ex.prev_best_wt||0', 'max-reps reads prev_best_wt');
has('prev_best_wt:dbRecordWt', 'max-reps exercise carries prev_best_wt');
has("records[dbName+'_maxwt']", 'prev weight sourced from records');
has("id=\"mr-wt\"", 'max-reps has a weight input');
has("bs.records[st.ex.name+'_maxwt']=wt", 'max-reps persists the weight at PR');

// ── v4.9.106 audit fixes ─────────────────────────────────────────────────────
console.log('\nFeature check — v4.9.106 BLAB session-data audit fixes:');

// Issue #1: superset reps are per-week (match the source progression), not one flat value
// per exercise band. Superset A: W1 15 / W2 12 / W3 10 / W4 8 / W6 12 / W7 10.
has('var ssaReps = ({1:15,2:12,3:10,4:8,6:12,7:10,8:8,9:6,11:8})[w]', 'superset A reps are per-week');
has('var ssbA = ({1:15,2:12,3:10,4:8,6:12,7:10,8:8,9:6,11:8})[w]', 'superset B shrug/face-pull reps per-week');
has('var ssbB = ({1:15,2:12,3:12,4:10,6:12,7:10,8:8,9:6,11:8})[w]', 'superset B lateral/flye reps per-week (W3/W4 asymmetric)');
has('reps:ssaReps+\' reps\'', 'superset A movement reps driven by ssaReps');

// Issue #2: max_reps_sets (DB Press) persists rep PR + weight in the LIVE generic path
// (autoLogSet), not the dead blabRenderMaxReps. Keyed by exerciseName so the banner reads back.
has("e._blabFmt==='max_reps_sets'", 'autoLogSet detects BLAB max-reps exercise');
has("_bs.records[exerciseName+'_maxwt']=_wt", 'autoLogSet persists max-reps weight (issue #2)');
has("var _mk=exerciseName+'_max'", 'autoLogSet persists max-reps PR keyed by exerciseName');

// Issue #3: superset PREVIOUS BEST shows LOAD × REPS (persist reps + carry + render).
has("bs.records[ex2.name+'_reps'] = last.a", 'superset persists A reps');
has("bs.records[partner.name+'_reps'] = last.b", 'superset persists B reps');
has("phxEx.prev_reps_a = _ssRec[ex.movements[0].name+'_reps']", 'mapper carries superset prev reps A');
has("ex.prev_reps_a?ex.prev_reps_a+' reps'", 'superset renderer shows prev reps A (load × reps)');
has("ex.prev_reps_b?ex.prev_reps_b+' reps'", 'superset renderer shows prev reps B (load × reps)');

// Issue #4: complex identity + per-set rep schemes match the source.
has("var complexName = w <= 5 ? 'Barbell Complex' : w <= 8 ? 'DB Complex' : 'BeZercher Complex'", 'complex name: Barbell/DB/BeZercher by week');
has("name:'DB Front Squats'", 'DB Complex movements present for W6-8');
has('var complexReps = {6:[7,8,9],7:[7,8,9,10],8:[6,7,8,9,10],9:[10,9,8],11:[10,9,8,7],12:[10,9,8,7,6]}[w]', 'complex per-set rep schemes present');
has('reps_per_set:complexReps', 'complex push carries reps_per_set');
has('phxEx.reps_per_set = ex.reps_per_set || null', 'mapper carries reps_per_set so AFAP renderer shows per-set reps');

// ── v4.9.107 deload reconciliation (Weeks 5 & 10 vs source) ──────────────────
console.log('\nFeature check — v4.9.107 deload weeks reconciled to source:');

// Day 1: W5 Flat DB Press 2×15; W10 Push-Ups/Rows superset + Bicep 21s; complex 1×8 empty bar.
has("name:'Flat DB Press', format:'standard_sets', sets:2, reps:15", 'deload W5 Day1: Flat DB Press 2×15');
has("name:'Push-Ups / Seated Cable Rows (neutral grip)'", 'deload W10 Day1: Push-Ups/Rows superset');
has("Bicep '21s' (version 2.0)", 'deload W10 Day1: Bicep 21s');
has('reps_per_set:[8]', 'deload complex is 1 set × 8 reps (empty bar)');

// Day 2: W10 Kneeling Jumps (not DB Squat Jumps) + accessory superset restored.
has("name:'45° Back Raises (BW only)'", 'deload W5 Day2: back raises/MB twists superset');
has("name:'Stability Ball Hamstring Curls / Stability Ball Plank'", 'deload W10 Day2: ball curls/plank superset');

// Day 3: accessories restored; source deload ends on the core circuit (no push-up finisher).
has("name:'Empty Barbell Curls'", 'deload W5 Day3: empty barbell curls 100 total');
has("name:'Blackburns'", 'deload W10 Day3: Blackburns');
has('source deload Day 3 ends with the core circuit', 'deload Day3 skips the 100 push-up / barbell push-up finisher');

console.log(`\n${fail === 0 ? '\x1b[32mPASS' : '\x1b[31mFAIL'}\x1b[0m — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
