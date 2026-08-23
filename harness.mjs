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
// ── SAFE COMMENT STRIPPING (PM, 2026-08-21 — after Training measured the damage) ──
// DO NOT use /\/\*[\s\S]*?\*\//g on this file. `/*` and `*/` occur inside strings and CSS,
// so the lazy match jumps between unrelated pairs and swallows real code: measured at
// 472,792 chars — 23.7% of index.html — and 231 `function ` declarations. Guards built on
// it scanned a file with a quarter missing: 8 of 25 _phxRecordWriteError calls and 33 of 38
// nutGetState calls were INVISIBLE, so a regression hiding in a swallowed region reported
// clean. Training found it when exactly that ate an injected test consumer.
// This strips LINE-WISE instead: a line is dropped only if it BEGINS a block comment or a
// //-comment at line start, so a `/*` or `//` appearing mid-line inside a string or a URL is
// never touched. Removes 11.4% (real comments) and loses zero real call sites.
// v4.9.191 (Peptides): also strip TRAILING //-comments, quote-aware.
// Line-start-only stripping left a hole every counting guard shared: a trailing
// `foo(); // alert("x")` survived intact and inflated the count. Proved on the
// peptide consumption guard — three comment-only mentions of _phxRecordWriteError
// turned it red, a false positive on prose. Any guard that COUNTS has this in the
// ignore-direction, including the native-dialog ratchet.
// Quote-aware because the whole reason for line-wise stripping was not to eat
// `https://` inside a string literal — so the cut only happens when the `//` is
// outside ' " and ` quotes. A regex literal containing an escaped slash (/\//)
// never presents two CONSECUTIVE slashes, so it is unaffected.
function phxStripTrailingComment(line){
  let q = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '\\') { i++; continue; }
      if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '/' && line[i + 1] === '/') return line.slice(0, i);
  }
  return line;
}

function phxStripComments(s){
  const out = []; let inBlock = false;
  for (const line of s.split('\n')) {
    const t = line.trim();
    if (inBlock) { if (line.includes('*/')) inBlock = false; out.push(''); continue; }
    if (t.startsWith('/*')) { if (!t.slice(2).includes('*/')) inBlock = true; out.push(''); continue; }
    if (t.startsWith('//')) { out.push(''); continue; }
    out.push(phxStripTrailingComment(line));
  }
  return out.join('\n');
}

// ── RULE 8 (PM, v4.9.239) ─────────────────────────────────────────────────────
// CLAUDE.md rule 8: no Supabase WRITE may report only to console — BOTH console.warn and
// console.error are invisible in the iOS PWA. The v4.9.231 version searched only `warn`,
// so it missed supabaseLogSet — every set Jon logs.
//
// TWO PARTS, BECAUSE ONE OF THEM CANNOT BE MADE PRECISE.
//
// (a) PINNED BY NAME — exact, and this is what actually protects Jon's records.
// (b) CANDIDATE COUNT — a proximity sweep, deliberately labelled as such. Training showed
//     (2026-08-22) that no line-window can separate reads from writes: widen it and
//     `.remove(` starts matching DOM nodes, narrow it and real writes sitting far from
//     their console line are missed. So this number contains READS as well as writes.
//     A FAILED READ SHOWS AN EMPTY SCREEN; A FAILED WRITE LOSES DATA SILENTLY. Same
//     console symptom, different consequence, and `_phxRecordWriteError` is the WRONG
//     helper for a read — it would record a write failure that never happened.
//     Therefore this count must NEVER be lowered by instrumenting a read. Lines whose own
//     statement is a `.select(` read are excluded so that shortcut does not go green, but
//     the exclusion is not complete and the number stays a candidate list to be READ,
//     never a target to be optimised.
{
  const src = phxStripComments(html).split('\n');
  const WRITE = /\.(update|upsert|insert|delete)\(|storage\.from\([^)]*\)\.(upload|remove)\(/;
  const READ  = /\.select\(|\.getPublicUrl\(|\.createSignedUrl\(|\.download\(/;
  const cand = [];
  for (let i = 0; i < src.length; i++) {
    if (!/console\.(warn|error)/.test(src[i])) continue;
    const stmt = src.slice(Math.max(0, i - 2), i + 2).join('\n');
    if (READ.test(stmt) && !WRITE.test(stmt)) continue;          // its own statement is a read
    if (!WRITE.test(src.slice(Math.max(0, i - 14), i + 3).join('\n'))) continue;
    if (/_phxRecordWriteError/.test(src.slice(Math.max(0, i - 3), i + 4).join('\n'))) continue;
    cand.push(i + 1);
  }
  const CAP = 23;   // candidates at v4.9.239. Training owns most of the remainder and has
                    // the heartbeat / bulk-migrate design decision open; Peptides owns one.
  cand.length <= CAP
    ? ok(`RULE 8: ${cand.length} console-only candidates (cap ${CAP}) — READ these, do not optimise the number`)
    : bad(`RULE 8: ${cand.length} console-only candidates, cap ${CAP}. Read each one: a WRITE here means Jon loses data with nothing on screen. Lines: ${cand.join(', ')}`);
}

// ── RULE 8: PINNED PATHS (exact, no proximity guessing) ───────────────────────
// The write paths that touch Jon's own records, pinned BY NAME so they cannot be traded
// away against the candidate count by instrumenting something cheaper elsewhere.
{
  const code = phxStripComments(html);
  const PINNED = [
    ['morningSave.weighIn',     'his daily weigh-in'],
    ['morningSave.photoUpload', 'his morning photo'],
    ['saveScore.insert',        'his WOD scores'],
    ['checkinPhoto.upload',     'his check-in photos'],
    ['weeklyCheckin.insert',    'his weekly check-in'],
    ['weeklyCheckin.update',    'his weekly check-in (edit)'],
    ['fullReset.update',        'Fresh Start'],
  ];
  const gone = PINNED.filter(([c]) => !code.includes(`_phxRecordWriteError('${c}'`));
  gone.length === 0
    ? ok(`RULE 8: all ${PINNED.length} pinned write paths record, not just console`)
    : bad(`RULE 8: pinned write path reports only to console: ${gone.map(g => g[0] + ' (' + g[1] + ')').join(', ')}`);
}

// ── RULE 8: THE RECORDER MUST NOT THROW WHEN IT FIRES (PM, v4.9.239) ──────────
// A ReferenceError inside an error branch fires ONLY when a write fails — exactly when the
// diagnostic is needed — and nothing else can see it: runtime_check executes top level
// only, and a presence assertion is satisfied by the broken call. Caught for real while
// writing this: a call passed `patch` in a function with no `patch` in scope, so a failed
// write would have thrown instead of recording. Silent failure PLUS a dead diagnostic.
//
// This lived in tests/pm.mjs first and was VACUOUS — it read `app.__indexSource`, which
// does not exist, so it looped over an empty string and passed unconditionally. It only
// became a real check once it read the source the harness already holds.
{
  const src = phxStripComments(html);
  const offenders = [];
  const re = /_phxRecordWriteError\(\s*'([^']*)'\s*,\s*[^,]+,\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*\)/g;
  let m;
  while ((m = re.exec(src))) {
    const [ctx, id] = [m[1], m[2]];
    if (id === 'null' || id === 'undefined' || id === 'athlete') continue;   // athlete is a known global
    const before = src.slice(0, m.index);
    const starts = [/\n\s*(?:async\s+)?function\s/g, /=\s*(?:async\s+)?function/g]
      .map(r => { let last = -1, x; while ((x = r.exec(before))) last = x.index; return last; });
    const scope = src.slice(Math.max(0, Math.max(...starts)), m.index);
    const declared = new RegExp('(?:var|let|const|function)\\s+' + id + '\\b|[(,]\\s*' + id + '\\s*[,)]').test(scope);
    if (!declared) offenders.push(`${ctx} -> ${id}`);
  }
  offenders.length === 0
    ? ok(`RULE 8: every _phxRecordWriteError payload identifier resolves in its own scope`)
    : bad(`RULE 8: payload identifier not in scope — the recorder would THROW when the write fails: ${offenders.join(' | ')}`);
}

// ── RULE 8: CONTEXT NAMES MUST BE DISTINCT (PM, v4.9.242, hardened v4.9.244) ──
// A HAZARD v4.9.240's COALESCING CREATED RATHER THAN SOLVED, predicted by Training and
// already live when it was: two call sites sharing a context string merge into ONE ring
// slot, so each failure hides the other and the merge is invisible. The live instance was
// "pep mirror keepalive" on both branches of the peptide keepalive mirror — a 4xx that
// RESOLVES and a network REJECT, which Peptides split deliberately in .228 because that
// distinction caught a column missing for 12 versions. Harmless before coalescing.
//
// Applies APP-WIDE, not per domain — the ring is shared, so a collision between two
// DOMAINS would be worse and no domain-local check could see it.
//
// v4.9.244 HARDENING, found by Peptides by TRIPPING IT: the first version matched only
// `_phxRecordWriteError("<literal>`, so a call passing a COMPUTED context was invisible —
// and the guard still printed a confident "all 80 distinct" that silently omitted those
// sites. NOT A VACUOUS PASS: A CONFIDENT WRONG ANSWER, which is worse, because the count
// looks like coverage. Skipping is what makes the number a lie. It now enumerates EVERY
// call site and FAILS on a non-literal rather than passing over it.
{
  const src = phxStripComments(html);
  const re = /_phxRecordWriteError\s*\(/g;
  const seen = new Map();
  const nonLiteral = [];
  let m, sites = 0;
  while ((m = re.exec(src))) {
    const before = src.slice(Math.max(0, m.index - 24), m.index);
    if (/function\s+$/.test(before) || /typeof\s+$/.test(before)) continue;   // definition / guard
    sites++;
    const after = src.slice(m.index + m[0].length).replace(/^\s*/, '');
    const lit = after.match(/^(["'])([^"']*)\1\s*,/);
    if (!lit) {
      nonLiteral.push(`line ${src.slice(0, m.index).split('\n').length}: ${after.slice(0, 40).replace(/\s+/g, ' ')}`);
      continue;
    }
    seen.set(lit[2], (seen.get(lit[2]) || 0) + 1);
  }

  nonLiteral.length === 0
    ? ok(`RULE 8: all ${sites} write-error call sites pass a literal context — none can hide from the uniqueness check`)
    : bad(`RULE 8: _phxRecordWriteError called with a COMPUTED context — it cannot be checked for collisions, and the distinct-count below would silently omit it: ${nonLiteral.join(' | ')}`);

  const dups = [...seen.entries()].filter(([, n]) => n > 1);
  dups.length === 0
    ? ok(`RULE 8: all ${seen.size} write-error contexts are distinct — none can silently merge in the ring`)
    : bad(`RULE 8: duplicate _phxRecordWriteError context — coalescing MERGES these and each hides the other: ${dups.map(d => `"${d[0]}" ×${d[1]}`).join(', ')}`);
}

// ── RULE 4: alert() IS NOT AN ERROR PATH (PM, v4.9.239) ───────────────────────
// iOS suppresses alert() in a PWA, so a failure path whose only user-facing output is an
// alert shows Jon NOTHING and then returns — indistinguishable from a dead button. Found
// in submitWeeklyCheckin: the check-in submit failed, the alert did not appear, the flow
// aborted, the screen did not change. Bans alert() specifically where a Supabase error is
// being reported, which is narrower than the global native-dialog ratchet below.
{
  const src = phxStripComments(html).split('\n');
  const badLines = [];
  for (let i = 0; i < src.length; i++) {
    if (!/\balert\s*\(/.test(src[i])) continue;
    if (!/\.error\b|err\.message|error\.message/.test(src.slice(Math.max(0, i - 2), i + 2).join('\n'))) continue;
    badLines.push(i + 1);
  }
  badLines.length === 0
    ? ok('RULE 4: no Supabase error is reported through alert() — suppressed on iOS')
    : bad(`RULE 4: alert() used to report a write error — invisible on Jon's phone. Lines: ${badLines.join(', ')}`);
}

// ── SELF-CHECK: needles must survive their own matcher (Peptides, 22fc1e0) ──────────
// hasCode/hasNotCode strip comments from the HAYSTACK. A needle that CONTAINS a comment is
// therefore unmatchable by construction — the guard reports green while the regression it
// names sits in the file as live code. Peptides hit exactly that: the needle
// `if(local) return; // local takes priority` could never match, so reintroducing the .158
// protocol-wipe bug passed. Within one commit that guard went from firing on prose to being
// unable to fail — the shadow the fix for prose-firing casts.
// This is mechanical, so the harness checks ITSELF rather than anyone remembering.
{
  const selfSrc = readFileSync(new URL('./harness.mjs', import.meta.url), 'utf8');
  const re = /has(?:Not)?Code\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g;
  const dead = [];
  let m, seen = 0;
  while ((m = re.exec(selfSrc))) {
    seen++;
    const needle = m[2].replace(/\\n/g, '\n').replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    if (phxStripComments(needle) !== needle) dead.push(needle.slice(0, 70));
  }
  dead.length === 0
    ? ok(`SELF: all ${seen} comment-stripped needles can actually match`)
    : bad(`SELF: ${dead.length} needle(s) contain a comment and can NEVER match — the guard cannot fail: ${dead.join(' | ')}`);
}


const has = (needle, label) => html.includes(needle) ? ok(label) : bad(`MISSING: ${label}`);
const hasNot = (needle, label) => !html.includes(needle) ? ok(label) : bad(`SHOULD BE GONE: ${label}`);

// v4.9.191 [PM]: code-only variants. has/hasNot read RAW text, correct for the
// version-label guards (a label legitimately lives in a comment) and wrong for
// anything asserting the presence or absence of CODE.
//
// v4.9.192 [TRAINING]: moved up from ~1263 to sit beside has/hasNot. They were
// declared below most Training guards, and `const` is not hoisted, so routing those
// guards through them threw "Cannot access 'hasNotCode' before initialization".
// Memoised too — 50+ call sites each re-stripping 1.9MB is a slow harness for nothing.
let _codeSrcCache = null;
const codeSrc = () => (_codeSrcCache ??= phxStripComments(html));
const hasCode    = (needle, label) => codeSrc().includes(needle) ? ok(label) : bad(`MISSING: ${label}`);
const hasNotCode = (needle, label) => !codeSrc().includes(needle) ? ok(label) : bad(`SHOULD BE GONE: ${label}`);

has("var APP_VERSION='4.9.254'", 'version is 4.9.254');

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
hasCode('function nutGetState()', 'NUT: nutGetState defined');
hasCode('function nutSaveState(s)', 'NUT: nutSaveState defined');
hasCode('function nutCalcTargets(', 'NUT: nutCalcTargets defined');
hasCode('function nutAdjustForToday(', 'NUT: nutAdjustForToday defined');
hasCode('function nutRenderTile()', 'NUT: nutRenderTile defined');
hasCode('function openNutritionScreen()', 'NUT: openNutritionScreen defined');
hasCode('function nutRenderScreen()', 'NUT: nutRenderScreen defined');
hasCode('function nutOpenSetup()', 'NUT: nutOpenSetup defined');
hasCode('function nutOpenMealLog(slot)', 'NUT: nutOpenMealLog defined');
// v4.9.222: the check-in tab is archived (blab_archive.js). It was UNREACHABLE, not
// broken — the tab router never had a 'checkin' branch — so these four went together
// as one transitive closure. Guarding the closure, not just the entry point: bringing
// back any single member resurrects code nothing routes to.
hasNotCode('function _nutTabCheckin(',      'NUT: check-in tab renderer stays archived (no router branch reaches it)');
hasNotCode('function nutSaveCheckin()',     'NUT: its save handler stays archived');
hasNotCode('function _nutWireFeelingBtns(', 'NUT: its button wiring stays archived');
hasNotCode('function _nutWeeklyAssessment(','NUT: its only callee stays archived');
hasNotCode("querySelector('#nut-save-checkin')", 'NUT: nutRenderScreen no longer wires a control nothing renders');
hasCode("id=\"screen-nutrition\"", 'NUT: #screen-nutrition HTML screen added');
hasCode("'nutrition':'screen-nutrition'", 'NUT: navigation route wired');
hasCode("if(tab==='nutrition')", 'NUT: navTo renders nutrition screen');
hasCode("nutRenderTile()", 'NUT: Today tile replaced with live render');

// ── Weekly Prep — single-serve recipes + prep aggregator (v4.9.144) ──────────
hasCode('function nutGetRecipes()', 'PREP: nutGetRecipes defined');
hasCode('function nutSaveRecipes(list)', 'PREP: nutSaveRecipes defined');
hasCode("'phx_recipes_v1_' + (uid || 'guest')", 'PREP: recipes stored under phx_recipes_v1_{uid}');
hasCode('if(!uid && typeof athlete', 'PREP: key prefers the session, falls back to athlete');
hasCode('function _nutRecipesMirrorToCloud(', 'PREP: Supabase mirror defined');
hasCode('function nutRestoreRecipesFromCloud(', 'PREP: cloud restore defined');
hasCode('nutRestoreRecipesFromCloud(row)', 'PREP: cloud restore wired into profile load');
hasCode('function _nutNormalizeRecipe(', 'PREP: legacy batch-recipe migration defined');
hasCode('function nutRecipeMacros(', 'PREP: per-serve macro calc defined');
hasCode('function nutRecipeServeWeight(', 'PREP: serve weight calc defined');
hasCode('function nutAssignRecipe(', 'PREP: week slot assignment defined');
hasCode('function nutBuildPrepPlan(', 'PREP: aggregator defined');
hasCode('function _nutPrepScale(', 'PREP: batch/yield scaling defined');
hasCode('function nutOpenPrepCard()', 'PREP: prep card overlay defined');
hasCode('function nutOpenRecipePicker(', 'PREP: recipe picker defined');
hasCode('function _nutWeekPlanView(', 'PREP: week PLAN view defined');
hasCode('function _nutPrepText(', 'PREP: plain-text export defined');
hasCode('function nutOpenRecipeBuilder(editId, onSaved)', 'PREP: builder takes an edit id + save continuation');
hasCode('data-nut-prep', 'PREP: WEEKLY PREP button rendered');
hasCode('WEEKLY PREP', 'PREP: WEEKLY PREP label present');
hasCode('data-nut-week-mode', 'PREP: week Overview/Plan toggle rendered');
hasCode('data-nut-add-recipe', 'PREP: per-slot + Recipe button rendered');
hasCode('data-nut-recipe-edit', 'PREP: recipe Edit button rendered');
hasCode("var _nutWeekMode = 'overview'", 'PREP: _nutWeekMode state var declared');
hasCode('recipeId: rec.id', 'PREP: assigned components carry recipeId for aggregation');
hasNotCode("var _recipes = (_rns && _rns.recipes) ? _rns.recipes : [];", 'PREP: food picker no longer reads legacy ns.recipes');

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
  sandbox._nutToday = () => '2026-08-19';
  // Shared PM helper, defined outside the extracted nutrition block.
  sandbox._phxLocalISO = (d) => { const x = d || new Date(); return x.getFullYear() + '-' + String(x.getMonth()+1).padStart(2,'0') + '-' + String(x.getDate()).padStart(2,'0'); };                       // a Wednesday
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
hasNotCode("if(localStorage.getItem(_nutRecipeKey()) !== null) return;", 'RESTORE: old local-wins early-return removed');
has('function _nutBackupLocal(', 'RESTORE: _bak helper defined');
has('function _nutAfterRestore(', 'RESTORE: repaint helper defined');
has('function _nutRecipesFrom(', 'RESTORE: envelope reader defined (bare array still loads)');
has("_ts: new Date().toISOString()", 'RESTORE: save stamps ISO _ts');
has("cloudWins = ct > lt", 'RESTORE: strict newer-than, so ties fall to local');
hasCode("_phxRecordWriteError('_nutRecipesMirrorToCloud'", 'MIRROR: write errors recorded, not swallowed');
hasCode('function _nutErrorSummary(', 'MIRROR: diagnostic summary helper defined');
hasCode('_nutErrorSummary(env)', 'MIRROR: payload is a count, never recipe values');
hasNotCode(".then(function(){}, function(){});", 'MIRROR: empty swallowing callbacks gone');

// ── Today screen: meal tick-off + water counter (v4.9.145) ──────────────────
hasCode('id="today-meals-tile"', 'TODAY: meals tile div on Today screen');
hasCode('id="today-water-tile"', 'TODAY: water tile div on Today screen');
hasCode('nutRenderMealsTile()', 'TODAY: meals tile is CALLED from the render hook (structural — that it DRAWS is tests/nutrition.mjs)');
hasCode('nutRenderWaterTile()', 'TODAY: water tile is CALLED from the render hook (structural — that it DRAWS is tests/nutrition.mjs)');
hasCode('function _nutEnsureEaten(', 'TICK: eaten-map seeding defined');
hasCode('function nutIsSlotEaten(', 'TICK: nutIsSlotEaten defined');
hasCode('function nutToggleMealEaten(', 'TICK: nutToggleMealEaten defined');
hasCode('function _nutEatenTotals(', 'TICK: eaten-only running totals defined');
hasCode('function _nutSlotTotals(', 'TICK: per-slot totals defined');
hasCode('data-nut-tick=', 'TICK: Today-screen tick buttons rendered');
hasCode('data-nut-tick-day=', 'TICK: nutrition-screen tick buttons rendered');
hasCode('nutToggleMealEaten(parts[0], parts[1])', 'TICK: in-screen tick buttons wired');
hasCode('var logged = _nutEatenTotals(dayData);', 'TICK: running totals follow the ticks');
hasCode("if(_e[slot] === undefined) _e[slot] = false;", 'TICK: planned recipes start unticked');
hasCode('function nutLogComponent(', 'TICK: logging (add + tick) is its own named writer');
hasNotCode('  _nutEnsureEaten(day)[slot] = true;', 'TICK: the tick no longer hides inside nutAddComponent');
hasCode("if(dateKey !== _nutToday()) return;", 'TICK: a future day is never marked eaten');
hasCode("var _nutPickerMode", 'PLAN: picker carries log-vs-plan mode');
hasCode("_nutPickerMode = (mode === 'log') ? 'log' : 'plan';", 'PLAN: omitting the mode plans — logging must be asked for');
hasCode("parts[2] === 'log' ? 'log' : 'plan'", 'PLAN: wiring honours the mode the slot card declares');
hasCode("'|' + mode + '\" style=", 'PLAN: the slot card emits its mode');
hasCode("{mode:'log', dayKcal:_dayK}", 'PLAN: the today screen asks to log');
hasCode("{mode:'plan', dayKcal:_dayK}", 'PLAN: the planner asks to plan');
hasCode('data-fp-new-recipe', 'PLAN: build-new-recipe offered in the food picker');
hasCode('data-rp-new-recipe', 'PLAN: build-new-recipe offered in the recipe picker');
hasCode("ns.daily[dk].eaten = {};", 'TICK: week templates plan without marking eaten');
hasCode('function nutRenderWaterTile()', 'WATER: tile renderer defined');
hasCode('function nutAddWater(', 'WATER: add/undo defined');
hasCode('function nutWaterTargetMl(', 'WATER: target accessor defined');
hasCode('function nutSetWaterTarget(', 'WATER: target setter defined');
hasCode('function nutOpenWaterTargetSheet(', 'WATER: target picker defined');
hasCode('var _NUT_WATER_GLASS_ML  = 250', 'WATER: 250ml glass');
hasCode('var _NUT_WATER_TARGET_ML = 2500', 'WATER: 2.5L default target');
hasCode('function _nutBindLongPress(', 'WATER: tap/long-press binding defined');
hasCode('Tap to pick a size &middot; hold to undo the last one', 'WATER: tap/hold hint shown');
hasCode('water_ml', 'WATER: per-day water stored on the daily record');

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
  // Shared PM helper, defined outside the extracted nutrition block.
  sb2._phxLocalISO = (d) => { const x = d || new Date(); return x.getFullYear() + '-' + String(x.getMonth()+1).padStart(2,'0') + '-' + String(x.getDate()).padStart(2,'0'); };
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
  sb2.nutUndoLastWater();
  sb2.nutGetWaterMl(TODAY) === 250 ? ok('long-press undo removes the last drink') : bad('undo failed');
  sb2.nutUndoLastWater(); sb2.nutUndoLastWater();
  sb2.nutGetWaterMl(TODAY) === 0 ? ok('water never goes negative') : bad('water went negative');
  sb2.nutSetWaterTarget(3000);
  sb2.nutWaterTargetMl(sb2.nutGetState()) === 3000 ? ok('water target is configurable') : bad('target not saved');
  st.daily['2099-01-01'] = { water_ml: 1000 };
  sb2.nutGetWaterMl('2099-01-01') === 1000 && sb2.nutGetWaterMl(TODAY) === 0
    ? ok('water is per date, so it resets at midnight') : bad('water not date-scoped');
} catch (e) {
  bad(`tick-off / water execution failed: ${e.message}`);
}

// ── Bodyweight, perpetual week, repeat day (v4.9.166) ───────────────────────
hasCode('function _nutCurrentWeight(', 'BW: newest-weight helper defined');
hasCode('function nutRecordWeight(', 'BW: cross-domain weight API defined');
hasCode('function nutRecalcTargets(', 'BW: target recalculation defined');
hasCode('function _nutDriftBanner(', 'BW: drift banner defined');
hasCode('data-nut-recalc', 'BW: recalculate control rendered');
hasCode("_nutSetupInput('nut-su-bw', 'BODYWEIGHT', 'kg'", 'BW: setup asks for bodyweight');
hasCode('weight_kg: bw', 'BW: setup stores the weight targets were built from');
hasNotCode("var bw = (typeof athlete !== 'undefined' && athlete && athlete.bw) ? parseFloat(athlete.bw) : 80;",
       'BW: silent athlete.bw-or-80 fallback removed from setup');
hasCode('function _nutSelectedWeekStart(', 'WEEK: selected-week helper defined');
hasCode('function _nutSelectedWeekDays(', 'WEEK: selected-week days defined');
hasCode('var _nutWeekOffset = 0', 'WEEK: offset state declared');
hasCode('data-nut-week-nav', 'WEEK: prev/next navigation rendered');
hasCode('data-nut-week-today', 'WEEK: jump-to-this-week rendered');
hasCode('var days = _nutSelectedWeekDays();', 'WEEK: views read the selected week');
hasCode('function nutCopyDay(', 'REPEAT: day copy defined');
hasCode('function nutOpenRepeatDay(', 'REPEAT: day picker defined');
hasCode('data-nut-repeat-day', 'REPEAT: control rendered on planned days');
hasCode('ns.daily[dk].eaten = {};', 'REPEAT: copied days start unticked');

// ── Local day keys (v4.9.169) ───────────────────────────────────────────────
// Brisbane is UTC+10 and Jon logs at 4:30am; a UTC day key filed his morning
// under yesterday. Nutrition uses the shared PM helper, not a private copy.
hasCode('function _nutToday(){\n  return _phxLocalISO();', 'TZ: _nutToday delegates to the shared local-date helper');
hasNotCode("return new Date().toISOString().slice(0, 10);", 'TZ: UTC day key gone from _nutToday');
hasNotCode("var nxt = d.toISOString().slice(0,10);", 'TZ: day-step navigation no longer UTC');
hasNotCode("var dk = d.toISOString().slice(0,10);", 'TZ: 14-day history no longer UTC');
hasNotCode('function _nutDateKey(', 'TZ: no private nutrition copy of the date helper');

// ── Day-surface consolidation + calendar-aware targets (v4.9.174) ───────────
hasCode('function nutTrainingForDay(', 'CAL: training day read per date');
hasCode('function nutAdjustForDay(', 'CAL: targets adjusted per date');
hasCode('window.blabTrainingStateOn(dateKey)', 'CAL: asks Training for the STATE, not raw entries');
hasNotCode('function _nutCalEntriesOn(', 'CAL: no longer interprets calendar entries itself');
hasCode("out.rest = (dateKey < _nutToday())", 'CAL: an unresolved PAST due day does not earn training targets');
hasCode("' \\u2014 not logged'", 'CAL: and says why on screen');
hasCode("out.sessions > 1", 'CAL: a second session on a day is disclosed');
hasNotCode("var nextDay = (bs.last_completed_day || 0) + 1;", 'CAL: queue-position heuristic gone');
hasCode('function _nutSlotCard(', 'DAY: one shared slot renderer');
hasCode('function _nutDaySummary(', 'DAY: one shared day summary');
hasCode('function _nutDayStamp(', 'DAY: add-sheets name the day they write to');
hasNotCode('data-nut-plan-food', 'DAY: planner-only food control folded into the shared card');

// -- Week/day mismatch + view persistence (v4.9.211) --
hasCode("else if(_nutTab === 'meals')     content = _nutTabMeals(ns);", 'BUG1: the day card is reachable from the week view');
hasCode("_nutTab === 'meals' && t.key === 'week'", 'BUG1: WEEK stays lit on the day drill-down');
hasCode('function _nutSaveView(', 'BUG2: the view inside the screen is persisted');
hasCode('function _nutRestoreView(', 'BUG2: and restored');
hasCode("if(typeof _nutRestoreView==='function') _nutRestoreView();", 'BUG2: navTo restores it instead of forcing today');
hasNotCode("if(tab==='nutrition'){ _nutTab='today';", 'BUG2: the unconditional reset to today is gone');

hasCode("localStorage.getItem('phoenix_last_weighin')", 'WEIGHT: targets read the LIVE morning weigh-in, not just athlete.bw');

hasCode('function _phxKeyboardSafe(', 'KEYBOARD: promoted to a shared helper other domains can call');
hasCode('function _nutKeyboardSafe(ov){ return _phxKeyboardSafe(ov); }', 'KEYBOARD: nutrition keeps a thin wrapper so its call sites do not churn');
hasCode("vv.addEventListener('resize', fit)", 'KEYBOARD: and follow it as it opens');
hasCode("t.scrollIntoView({block:'center'})", 'KEYBOARD: the focused field is brought into view');

// ── Water drink sizes (v4.9.199) ───────────────────────────────────────────
hasCode('var _NUT_DRINK_SIZES = [250, 330, 500, 1000, 1500];', 'WATER: the five sizes Jon asked for');
hasCode('function nutOpenDrinkSizeSheet(', 'WATER: size picker defined');
hasCode('function nutUndoLastWater(', 'WATER: undo is its own named function');
hasCode('day.water_log.push(amt)', 'WATER: each drink is logged as its own entry');
hasCode('amt = parseFloat(day.water_log.pop())', 'WATER: undo removes the ACTUAL last drink, not a fixed glass');
hasCode('if(!(amt > 0)) return false;', 'WATER: add refuses a non-positive amount rather than subtracting');
hasNotCode("function(){ nutAddWater(-glass); }", 'WATER: the fixed-glass undo is gone');

// ── Backup recovery path (v4.9.194) ────────────────────────────────────────
// The _bak copy was written from .152 and read by NOTHING while a comment called
// it recoverable. These pin the PATH, not the write.
hasCode('function nutBackupInfo(', 'BAK: the held copy can be described');
hasCode('function nutRestoreBackup(', 'BAK: and recovered');
hasCode('data-nut-restore-bak', 'BAK: the offer is rendered where Jon can press it');
hasCode('var h = bakBanner;', 'BAK: and is actually wired into the recipes tab (unreachable = a claim, not a net)');
hasCode("localStorage.setItem(key + '_bak', cur)", 'BAK: recovery SWAPS, so a wrong recovery is undoable');

// ── Training API migration (v4.9.185) ──────────────────────────────────────
hasNotCode("_BLAB_DAY_LABELS !== 'undefined' && _BLAB_DAY_LABELS[n]", 'CAL: no longer reads Training internals');
hasCode("out.state    = s.state || 'none';", 'CAL: takes the state Training reports');
hasCode("if(out.state === 'trained')   out.rest = false;", 'CAL: a completed session is a training day');
hasCode("else                          out.rest = true;", 'CAL: rest / skipped / none all take rest targets');
hasCode("out.scheduled = (out.state !== 'none');", 'CAL: a scheduled rest day stays distinct from an empty one');

// ── Priority 11 — Outstanding Bug Fixes ──────────────────────────────────────
// Bug 1: Superset per-set data
has('function ssPrevBanner(', 'P11-B1: ssPrevBanner helper defined');
has('_banA=ssPrevBanner(', 'P11-B1: _banA computed from ssPrevBanner');
has('_banB=ssPrevBanner(', 'P11-B1: _banB computed from ssPrevBanner');
has("bs.records[ex2.name+'_wt_set'+sn]", 'P11-B1: per-set weight saved by set number');
has("bs.records[ex2.name+'_reps_set'+sn]", 'P11-B1: per-set reps saved by set number');
// v4.9.254: was pinned to the literal "phxEx.prev_sets_a=_ssPA" — the old inline
// accumulator variable. That is an implementation detail, and it failed the moment the
// weight-gating bug was fixed by extracting the walk into _ssPrevSets(). Pinned to the
// ASSIGNMENT now, which is the property that matters: the renderer only shows both sets
// if these reach it. The behaviour itself is covered by SETS: cases in tests/training.mjs,
// which fail if the walk stops at a missing weight again.
hasCode("phxEx.prev_sets_a=", 'P11-B1: prev_sets_a passed to renderer');
hasCode("phxEx.prev_sets_b=", 'P11-B1: prev_sets_b passed to renderer');
hasCode("if(!wt && !rp) break;", 'SETS: per-set history counts a set with reps and no weight (max-reps supersets)');
hasNotCode("var _swtA=_ssRec[ex.movements[0].name+'_wt_set'", 'SETS: the weight-gated walk is gone — it stopped at set 1 and the banner fell back to a single value');
// Bug 2: iOS tap counter — button elements with touch-action
has("class=\"phx-tt-minus\"", 'P11-B2: phx-tt-minus exists');
has("touch-action:manipulation", 'P11-B2: touch-action:manipulation on tap counter buttons');
hasNotCode('<div class="phx-tt-minus"', 'P11-B2: phx-tt-minus is now a button (not a div)');
hasNotCode('<div class="phx-tt-plus"', 'P11-B2: phx-tt-plus is now a button (not a div)');
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
hasNotCode('st.elapsed++;', 'FIX1: BLAB tick-counter elapsed++ removed');
hasNotCode('setInterval(function(){ elapsed++;', 'FIX1: WOD tick-counter elapsed++ removed');
hasNotCode('setInterval(function(){ remain--;', 'FIX1: AMRAP tick-counter remain-- removed');
hasNotCode('setInterval(function(){ secLeft--;', 'FIX1: EMOM tick-counter secLeft-- removed');
hasNotCode('coreSecsLeft--;', 'FIX1: Core circuit tick-counter decrement removed');
// FIX 2 — wake lock held for every timed session, re-requested after a screen lock.
has('if(wakeLock && !wakeLock.released) return;', 'FIX2: released sentinel replaced, live one never duplicated');
has('requestWakeLock(); // persistent', 'FIX2: wake lock re-requested when the page becomes visible (persistent)');
has('function showCountIn(callback){\n  // Kill any prior count-in still running before we start a new one\n  _phxCancelCountIn();\n  requestWakeLock();', 'FIX2: wake lock held through the count-in');
hasNotCode("navigator.wakeLock.request('screen').then(function(lock){", 'FIX2: BLAB inline wakeLock request replaced by shared helper');
// FIX 3 — one 5-4-3-2-1-GO! count-in before every timed session, never scored.
has("numEl.textContent='5';", 'FIX3: count-in opens on 5 (not 6)');
has("var label = (el>=5) ? 'GO!' : String(5-el);", 'FIX3: 5,4,3,2,1 then GO!');
has('if(el>=6){\n      clearInterval(iv);', 'FIX3: hands over one second after GO!');
hasNotCode('st.afapCountdown', 'FIX3: BLAB afap inline 5→0 countdown removed');
hasNotCode('id="afap-countdown"', 'FIX3: afap-countdown element removed');
[
  ["showCountIn(function(){\n      // The user may have backed out of the runner during the count-in", 'BLAB runner (complex/run/interval/tabata)'],
  ["showCountIn(function(){\n    if(!document.body.contains(o)) return; // left the runner during the count-in\n    requestWakeLock();\n    _phxStampTimerStart();\n    paintTime();", 'WOD count-up'],
  ["paintAmrap();\n    window._phxLibTick=setInterval(paintAmrap,1000);", 'WOD AMRAP'],
  ["minStart=_phxStampTimerStart();", 'WOD EMOM'],
  ["_phxStampTimerStart();\n    startWork();", 'WOD sprint intervals'],
  ["showCountIn(function(){\n    if(!document.getElementById('core-timer-display')) return;", 'Core 20-min timer'],
  ["showCountIn(function(){\n          if(!cfRunning) return; // stopped / left during the count-in", 'CrossFit benchmark WOD'],
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
// v4.9.179: was pinned to the exact two-line shape `if(!window._blabDryRun){\n    supabaseStartSession`.
// Re-entry handling put a branch between them. Assert the PROPERTY — the session-row
// call is inside the dry-run guard — rather than its formatting.
{
  // Comment-stripped: prose naming the sentinel would otherwise hijack the window.
  const src = codeSrc();
  const i = src.indexOf('var aiSessionType=mapSessionType');
  const seg = src.slice(i, i + 2600);   // must reach showScreen('screen-session'); 1400 fell short
  const g = seg.indexOf('if(!window._blabDryRun){');
  const s = seg.indexOf('supabaseStartSession(aiSessionType');
  const closes = seg.indexOf('showScreen(\'screen-session\')');
  if (g > -1 && s > g && closes > s) ok('dry-run skips server session start');
  else bad(`dry-run guard no longer wraps supabaseStartSession (guard@${g}, call@${s}) — an audit dry run would write a real session row`);
}
has('if(window._blabAuditStateOverride) return window._blabAuditStateOverride;', 'audit placeholder state override');

// Dead overlay duplicates removed
hasNotCode('window.blabBuildExCard', 'blabBuildExCard removed');
hasNotCode('window.blabLaunchExercise', 'blabLaunchExercise removed');
hasNotCode('function blabRenderPct', 'blabRenderPct removed');
hasNotCode('function blabRenderSuper(', 'blabRenderSuper removed');
hasNotCode('function blabRenderMaxReps', 'blabRenderMaxReps removed');
hasNotCode('function blabRenderStd', 'blabRenderStd removed');
hasNotCode("document.getElementById('blab-session-overlay')", 'blabOpenSession overlay fallback removed');
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
  // v4.9.223: 20 -> 22. Two entries added for the paired wall-ball session, one of
  // which is hidden from the grid. Note the two counts below now DIFFER by exactly the
  // hidden entries, and that gap is asserted rather than left as an unexplained
  // discrepancy for the next reader to talk themselves out of.
  wods.length===22 ? ok('exactly 22 WODs in the library (16 Conditioning + 5 Aerobic + 1 hidden paired part)') : bad('expected 22 WODs, got '+wods.length);
  core.length===6  ? ok('exactly 6 Core sessions (v4.9.123: R1/R2/R3 + S1/S2/S3)') : bad('expected 6 Core, got '+core.length);
  all.length===28  ? ok('28 total sessions') : bad('expected 28 sessions, got '+all.length);
  // phxWodsByTier is the GRID view and excludes hidden entries, so this is what Jon
  // can actually see and start. The library total above counts the hidden part too.
  sb2.phxWodsByTier('CONDITIONING').length===16 ? ok('16 Conditioning WODs offered in the grid') : bad('Conditioning count '+sb2.phxWodsByTier('CONDITIONING').length);
  (() => {
    // The gap between the library and the grid must be exactly the entries marked
    // hidden — nothing else may quietly drop out of the grid unexplained.
    const shown = sb2.phxWodsByTier('CONDITIONING').length + sb2.phxWodsByTier('AEROBIC').length;
    const hidden = wods.filter(w => w.hidden).length;
    if (wods.length - shown === hidden) ok(`grid hides exactly the ${hidden} entry marked hidden, nothing else`);
    else bad(`library has ${wods.length} WODs and the grid shows ${shown}, a gap of ${wods.length - shown}, ` +
             `but only ${hidden} are marked hidden. Something is falling out of the grid unaccounted for.`);
  })();
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
hasNotCode("coreType:'Circuit'",         'FIX3: Circuit category removed');
hasNotCode("coreType:'Endurance Grind'", 'FIX3: Endurance Grind category removed');
hasNotCode("id:'core-ci-phoenix'",       'FIX3: Phoenix Circuit removed');
hasNotCode("id:'core-en-rowcore'",       'FIX3: Row + Core removed');
has('function _phxOpenScoreEntry',  'score entry screen');
has('function renderRecords',       'RECORDS scoreboard renderer');
has("sb.from('wod_scores')",        'scores persist to Supabase wod_scores');
has('id="screen-records"',          'RECORDS screen present');
has('navTo(\'records\')',           'RECORDS nav route wired');
has('>Records<',                    'RECORDS nav/sidebar label present');
// Legacy WOD system removed
hasNotCode('function openPhoenixWOD',        'legacy openPhoenixWOD removed');
hasNotCode('function renderDailyWOD',        'legacy renderDailyWOD removed');
hasNotCode('function _phxGenerateDailyWOD',  'legacy _phxGenerateDailyWOD removed');
hasNotCode('function _detectWODFormat',      'legacy _detectWODFormat removed');
hasNotCode('function openWODLibrary',        'legacy openWODLibrary removed');
hasNotCode('function generateCustomWOD',     'legacy generateCustomWOD removed');
hasNotCode('function openBenchmarkLibrary',  'legacy openBenchmarkLibrary removed');
hasNotCode('function phxWodTierColour',      'legacy phxWodTierColour removed');
hasNotCode('window._wlibSetFilter',          'legacy _wlib browser removed');
hasNotCode('id="screen-wod-library"',        'legacy WOD Library screen removed');

// ── BLAB TRAINING CALENDAR (v4.9.144) ───────────────────────────────────────
console.log('\nBLAB Training Calendar — static wiring:');
has('id="screen-blab-calendar"',      'CAL: calendar screen present');
has("'blab-calendar':'screen-blab-calendar'", 'CAL: navTo route wired');
has('id="prog-blab-cal-tile"',        'CAL: Programme tab entry point');
has('window.blabCalOpen',             'CAL: blabCalOpen exported');
has('window.blabCalTodayEntry',       'CAL: today-entry reader present (structural — behaviour in tests/training.mjs)');
has('window.blabCalMarkCompleted',    'CAL: completion hook present (structural — behaviour in tests/training.mjs)');
has('window._blabCalDay2RefDate',     'CAL: Day-2 reference helper present (structural — behaviour in tests/training.mjs)');
has('blabCalMarkCompleted(week, day)','CAL: hooked into blabCompleteSession');
has('blabCalHydrateFromState',        'CAL: rehydrate call present (structural — behaviour in tests/training.mjs)');
has("localStorage.setItem(_blabCalKey()", 'CAL: local key write present (structural — behaviour in tests/training.mjs)');
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

// ── SHARED — the service worker must not pin a stale version (v4.9.208) ────
// sw.js was ZERO BYTES, so registration was installing an empty script: no fetch
// handler, no version reported, no update ever detected. Jon is remote and cannot
// git pull, so he could not receive a deploy without reinstalling the PWA.
// Now it caches under APP_VERSION — which means a stale SW_VERSION would serve an
// old shell while claiming to be current. That is worse than no cache, so it is
// pinned here rather than trusted.
(() => {
  let sw = '';
  try { sw = readFileSync(new URL('./sw.js', import.meta.url), 'utf8'); }
  catch (_e) { bad('SW: STRUCTURAL sw.js is unreadable'); return; }

  sw.trim().length > 0
    ? ok('SW: STRUCTURAL sw.js is not empty')
    : bad('SW: STRUCTURAL sw.js is EMPTY — registration installs a no-op and no update is ever detected');

  const appM = html.match(/var APP_VERSION\s*=\s*'([^']+)'/);
  const swM  = sw.match(/const SW_VERSION\s*=\s*'([^']+)'/);
  if (!appM || !swM) { bad('SW: STRUCTURAL could not read APP_VERSION or SW_VERSION'); return; }
  appM[1] === swM[1]
    ? ok(`SW: STRUCTURAL sw.js version tracks APP_VERSION (${swM[1]})`)
    : bad(`SW: STRUCTURAL sw.js is pinned to ${swM[1]} but APP_VERSION is ${appM[1]} — bump SW_VERSION`);

  // Freshness is the whole point; a cache-first shell would defeat it.
  /cache:\s*'no-store'/.test(sw)
    ? ok('SW: STRUCTURAL the shell is fetched network-first with no-store')
    : bad('SW: STRUCTURAL the shell is not fetched no-store — a stale build could be served as current');
  /url\.origin !== self\.location\.origin/.test(sw)
    ? ok('SW: STRUCTURAL cross-origin requests are never cached')
    : bad('SW: STRUCTURAL cross-origin requests are not excluded — Supabase responses could be cached');
})();

// ── SHARED — the visibility comment must stay TRUE (STRUCTURAL, v4.9.204) ───
// :16474 asserted "NO visibilitychange listener exists in this app" while three
// did, one of them mine. A false claim in shared code at exactly the spot
// someone lands when diagnosing a wake-up bug. Corrected — and pinned, because
// a comment nobody checks is how it went stale in the first place. If a fourth
// listener is added this FAILS until the comment is updated to match.
(() => {
  const n = (html.match(/addEventListener\((?:'|")visibilitychange(?:'|")/g) || []).length;
  hasNot('NO visibilitychange listener exists in this app',
         'SHARED: STRUCTURAL the false "no visibilitychange listener" claim is gone');
  n === 3
    ? ok(`SHARED: STRUCTURAL visibilitychange listener count matches the comment (${n})`)
    : bad(`SHARED: STRUCTURAL ${n} visibilitychange listeners but the comment at :16474 says three — update it`);
  html.includes('THE RULE, unchanged and still binding: no visibility hook may RE-ROUTE')
    ? ok('SHARED: STRUCTURAL the no-re-route rule survived the correction')
    : bad('SHARED: STRUCTURAL the no-re-route rule was lost when the comment was corrected');
})();

// ── phxFnSpan — a span that knows whether it reached its own end ────────────
// Nutrition's v4.9.229 finding, applied here: a floor must anchor to the END of
// the span it claims to cover, not to its size. "Found enough" and "reached the
// end" are different claims and only the second is a guarantee.
//
// Every peptide guard below used to end a function span with
//   let j = blk.indexOf('\nfunction ', i + 1); if (j < 0) j = blk.length;
// which turns "I could not find where this ends" into "I will assume it ends
// far away". When I tested that by removing the anchor, the egress guard did
// fail — but only because the extra 3000 chars happened to contain visible
// keys. That is luck about the CONTENT, not a property of the guard. The same
// fallback on a span whose overshoot is quiet would have passed.
//
// Returns null when the end cannot be located, so callers fail instead of
// guessing. Never returns a span it cannot prove the extent of.
function phxFnSpan(src, name) {
  const i = src.indexOf('function ' + name);
  if (i < 0) return null;
  const j = src.indexOf('\nfunction ', i + 1);
  if (j < 0) return null;                    // no end anchor — refuse, do not extend
  return src.slice(i, j);
}

// ── PEPTIDES — cross-domain contract (STRUCTURAL) ───────────────────────────
// TWO foreign surfaces, as of v4.9.223. Listing them is the point of this block:
// an undeclared consumption is how a rename in another domain becomes a black
// screen here.
//   _phxRecordWriteError  (PM)         — every call site typeof-guarded, so a
//                                        rename degrades to "no diagnostics"
//                                        rather than throwing inside a write.
//   _phxKeyboardSafe      (Nutrition)  — NOT guarded, deliberately. It is called
//                                        at overlay-creation time, not inside a
//                                        write path, and it is pinned
//                                        provider-side in tests/nutrition.mjs.
//                                        A typeof guard here would convert a
//                                        loud break into a silent one: the
//                                        sheets would open with the keyboard
//                                        back over the field and nothing would
//                                        say why. Different call site, different
//                                        right answer.
(() => {
  const START = 'PEPTIDE BLOCK START — do not move';
  const END   = 'PEPTIDE BLOCK END — do not move';
  const i = html.indexOf(START);
  const j = html.indexOf(END);
  if (i < 0 || j < 0) { bad('PEP: STRUCTURAL peptide block sentinels missing — the guard cannot bound my code'); return; }
  // A mention in a comment is not a consumption. Naming nutAddComponent in a
  // comment explaining the boundary tripped this guard on its first run — the
  // same "a grep match is not a call" trap as renderTodayScreen. Strip
  // full-line and block comments before scanning. Full-line only, deliberately:
  // stripping from any // would eat https:// inside string literals.
  const decomment = phxStripComments; // v4.9.191: the regex form ate 23.7% of the file
  if (i < 0 || j < 0) { bad('PEP: could not isolate the peptide block'); return; }
  const blk = decomment(html.slice(i, j));
  const calls  = (blk.match(/_phxRecordWriteError\s*\(/g) || []).length;
  const guards = (blk.match(/typeof _phxRecordWriteError === "function"/g) || []).length;
  // v4.9.191: was `guards >= calls - 1`. That slack existed because the COMMENT
  // naming _phxRecordWriteError inflated the call count — but comments are
  // stripped now, so the tolerance did nothing except let exactly one unguarded
  // call through undetected. Which is the only regression this guard exists to
  // catch. Found by injecting an unguarded call and watching it report PASS at
  // 4 calls / 3 guards. Strict from here.
  calls > 0 && guards >= calls
    ? ok(`PEP: STRUCTURAL every _phxRecordWriteError call is typeof-guarded (${calls} calls, ${guards} guards)`)
    : bad(`PEP: STRUCTURAL unguarded _phxRecordWriteError call — ${calls} calls, ${guards} guards`);
  /\bblab[A-Z]/.test(blk)
    ? bad('PEP: STRUCTURAL peptide block reaches into Training state')
    : ok('PEP: STRUCTURAL peptide block consumes nothing from Training');
  /\bnut[A-Z]/.test(blk)
    ? bad('PEP: STRUCTURAL peptide block reaches into Nutrition state')
    : ok('PEP: STRUCTURAL peptide block consumes nothing from Nutrition');
  // The declared consumption, pinned by COUNT. _phxKeyboardSafe is not
  // idempotent — arming twice registers two viewport listeners that both
  // outlive the sheet — so "is it called?" is the wrong question and "how many
  // times?" is the right one. Two sheets take typed input; two calls. A third
  // means someone armed it somewhere that runs more than once, which is the
  // exact mistake the helper's own contract warns about.
  const kb = (blk.match(/_phxKeyboardSafe\s*\(/g) || []).length;
  // v4.9.247 raised this from 3 to 4 for pepOpenImport, which has a textarea.
  // Raised DELIBERATELY after the pin failed — which is the pin working. The
  // enumeration guard below would have demanded the arming anyway; this one
  // makes adding it a conscious edit rather than a silent drift.
  kb === 4
    ? ok('PEP: STRUCTURAL _phxKeyboardSafe armed at exactly 4 creation sites')
    : bad(`PEP: STRUCTURAL _phxKeyboardSafe armed ${kb} times — expected 4 (pepOpenEditStack, pepOpenCustomVial, pepOpenBloodPanel, pepOpenImport); the helper is NOT idempotent`);
  // v4.9.224: was 2, and the 2 came from a miscount I made and everyone
  // downstream inherited. The count pin is only as good as the enumeration
  // behind it, so the enumeration is now mechanical: every peptide overlay that
  // contains a typed field must be armed. That is what this pair of guards
  // checks, rather than a number I remembered.
  {
    const fns = [...blk.matchAll(/function (pepOpen[A-Za-z]+)\s*\(/g)].map(m => m[1]);
    const unbounded = [];
    const miss = fns.filter(name => {
      const body = phxFnSpan(blk, name);
      if (body === null) { unbounded.push(name); return false; }
      if (!/position:fixed;inset:0/.test(body)) return false;          // not an overlay
      // The sheet's markup may be built by a renderer it calls; follow one hop.
      const renderer = (body.match(/_pepRender[A-Za-z]+\s*\(/g) || [])
        .map(c => c.replace(/\s*\($/, ''));
      let markup = body;
      renderer.forEach(r => {
        const span = phxFnSpan(blk, r);
        if (span === null) return;
        markup += span;
      });
      const typed = /<input[^>]{0,300}type=\\"(text|number|date|email|tel|search|password)/.test(markup)
                 || /<textarea/.test(markup);
      return typed && !/_phxKeyboardSafe/.test(body);
    });
    // FLOOR (harness-only, Nutrition's finding on their own enumerator, taken back
    // the other way). Everything above is derived from `fns`. If the regex ever
    // stops matching — the pepOpen* convention changes, the sentinels move, the
    // block is reshaped — `fns` is empty, `miss` is empty, and this reports PASS
    // for having checked NOTHING. An enumerator that fails open turns every
    // assertion built on it green at once, which is the exact failure mode I
    // have spent the day hunting in other people's code and did not check in
    // my own.
    //
    // The named list is a LOWER BOUND, not the coverage — the distinction that
    // makes it legitimate after Nutrition's hand-list finding. The scan still
    // decides what gets checked; these three only prove the scan still works.
    // A new sheet raises the count and needs no edit here; losing one is a
    // deliberate harness change.
    const KNOWN_ARMED = ['pepOpenEditStack', 'pepOpenCustomVial', 'pepOpenBloodPanel', 'pepOpenImport'];
    const absent = KNOWN_ARMED.filter(n => !fns.includes(n));
    if (unbounded.length) {
      bad(`PEP: STRUCTURAL could not find the end of ${unbounded.join(', ')} — the span is unbounded, so anything scanned inside it is a guess. Refusing rather than extending to the end of the block.`);
    } else if (fns.length < 6 || absent.length) {
      bad(`PEP: STRUCTURAL the overlay enumeration itself broke — found ${fns.length} pepOpen* sheets (expected >= 6)${absent.length ? `, missing ${absent.join(', ')}` : ''}. Every keyboard guard is derived from this scan, so a silent miss here makes all of them pass vacuously.`);
    } else {
      miss.length === 0
        ? ok(`PEP: STRUCTURAL every peptide overlay with a typed field is keyboard-armed (${fns.length} sheets scanned)`)
        : bad(`PEP: STRUCTURAL typed field behind the keyboard — ${miss.join(', ')} build inputs but never call _phxKeyboardSafe`);
    }
  }
})();

// The other half of the keyboard fix, and the half the shared helper cannot do.
// It shrinks the OVERLAY to the visible area; a child sized in vh does not
// shrink with it, so an armed sheet with a vh cap is armed and still broken —
// which is exactly what v4.9.221 shipped.
//
// v4.9.226 (harness only): this was a hardcoded check that pepOpenEditStack contains
// "max-height:88%". That guarded the one sheet I had already fixed and nothing
// else — the same mistake as the count pin it sits next to, one layer along.
// Arm a fourth sheet tomorrow with an 88vh cap and every gate stayed green.
// Now it is a RULE over whatever is armed: vh units are viewport units, the
// helper resizes the overlay and not the viewport, so the two cannot be
// combined. Pairs with the enumeration guard above — that one says "has typed
// input, must be armed", this one says "is armed, must not measure in vh".
//
// Nutrition's observation on pepOpenAddStack / pepOpenOrderPicker is the reason
// this is conditional rather than a blanket ban: both still cap in vh and both
// are fine, because nothing resizes their overlay. The day either is armed this
// guard turns their vh cap into a failure, without anyone remembering to look.
(() => {
  const START = 'PEPTIDE BLOCK START — do not move';
  const END   = 'PEPTIDE BLOCK END — do not move';
  const a = html.indexOf(START), b = html.indexOf(END);
  if (a < 0 || b < 0) { bad('PEP: sentinels missing — cannot check armed sheet sizing'); return; }
  const blk = html.slice(a, b);
  const fns = [...blk.matchAll(/function (pepOpen[A-Za-z]+)\s*\(/g)].map(m => m[1]);
  const armed = [], offenders = [];
  fns.forEach(name => {
    const body = phxFnSpan(blk, name);
    if (body === null) { offenders.push(`${name} (span end not found)`); return; }
    if (!/_phxKeyboardSafe/.test(body)) return;
    armed.push(name);
    // Follow the same delegation hop the enumeration guard does: a sheet may
    // build its markup in a _pepRender* helper rather than inline.
    let markup = body;
    (body.match(/_pepRender[A-Za-z]+\s*\(/g) || []).forEach(c => {
      const span = phxFnSpan(blk, c.replace(/\s*\($/, ''));
      if (span !== null) markup += span;
    });
    // The overlay's own inset:0 is fine — the helper overwrites height/top on
    // it directly. It is the CHILDREN measured against the viewport that break.
    const vh = markup.match(/(?:max-)?height:\s*\d+(?:\.\d+)?vh/g) || [];
    if (vh.length) offenders.push(`${name} (${[...new Set(vh)].join(', ')})`);
  });
  armed.length === 0
    ? bad('PEP: no armed sheets found — the keyboard fix has been removed wholesale')
    : offenders.length === 0
      ? ok(`PEP: every keyboard-armed sheet sizes against the overlay, not the viewport (${armed.length} armed: ${armed.join(', ')})`)
      : bad(`PEP: armed but still measured in vh — ${offenders.join('; ')}. _phxKeyboardSafe resizes the OVERLAY; vh tracks the viewport, so the panel overflows upward off the top of the screen with the keyboard up. Use % of the overlay.`);
})();

// ── PEPTIDE PORTAL — recon engine / Today tile / ADJUST / BLOODS ────────────
// v4.9.141-146. Guards the peptide domain against accidental removal by other
// chats editing the shared file.
console.log('\nFeature check — Peptide Portal (v4.9.141-146):');

// harness-only — THESE PIN THE NAME, NOT THE SIGNATURE, and that is deliberate.
// They existed as `function _pepRecon(stack, c)` and so on: eighteen guards that
// would go red the moment anyone renamed a parameter, which changes nothing
// about behaviour. Training's rule, from their own .254: a guard that breaks
// when you make a correct change teaches you to edit the guard, and once
// editing guards is a habit they have stopped protecting anything.
//
// Their PURPOSE is anti-deletion — stopping another chat removing peptide code
// while editing the shared file. For that, the function name is the property
// and the parameter list is an implementation detail.
//
// One of them was carrying a real property in its parameters:
// `function _pepGetDoses(ps, dateStr)` labelled "is date-parameterised", which
// mattered because it once was not. Nothing functional called it with a date at
// all, so a parameter NAME was the entire protection. That property now has its
// own functional test and this pin no longer pretends to cover it.
// v4.9.141 reconstitution engine
has('var _PEP_RECON = {',                      'PEP: _PEP_RECON default table present');
has('function _pepRecon(',            'PEP: _pepRecon resolver present');
has('function _pepDraw(','PEP: _pepDraw units calculator present');
has('function _pepFmtDose(',        'PEP: _pepFmtDose mg/mcg formatter present');
has('function _pepGetDoses(',      'PEP: _pepGetDoses is date-parameterised');

// v4.9.142 Today screen tile
has('id="today-peptide-tile"',                 'PEP: Today tile container in screen-today');
has('function pepRenderTodayTile(',           'PEP: pepRenderTodayTile defined');
has("if(typeof pepRenderTodayTile==='function') pepRenderTodayTile();",
                                               'PEP: Today tile called from renderTodayScreen');

// v4.9.143 ADJUST tab
has('var PEP_ADVISOR_SYSTEM =',                'PEP: advisor system prompt present');
has('function _pepBuildContext(',           'PEP: advisor context builder present');
has('function _pepAdherence(',        'PEP: 14-day adherence calculator present');
has('async function pepGenerateAdvice(',      'PEP: pepGenerateAdvice present');
has('function _pepTabAdjust(',              'PEP: ADJUST tab renderer present');

// v4.9.146 BLOODS tab
has('function _pepTabBloods(',              'PEP: BLOODS tab renderer present');
has('async function pepBloodsLoad(',     'PEP: blood panel loader present');
has('async function pepExtractMarkers(',      'PEP: AI marker extraction present');
has('async function pepSaveBloodPanel(',      'PEP: blood panel save present');
has('function _pepMarkerFlag(',              'PEP: marker range flagging present');
has('function _pepDownscale(',
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
// v4.9.201 — Jon's structure: TODAY | PROTOCOL | STOCK | ADJUST | ORDER.
// BLOODS moved inside ADJUST (six tabs do not fit a phone). A functional case
// proves it is still reachable, so this pins only the bar itself. The 'overview'
// key carries the PROTOCOL label, hence the pair rather than a derived string.
// v4.9.205 — six tabs at Jon's request; the bar scrolls to fit them.
[['today','TODAY'],['overview','PROTOCOL'],['stock','STOCK'],['adjust','ADJUST'],['order','ORDER'],['bloods','BLOODS']].forEach(([k,lab]) => {
  const t = lab;
  html.includes('{key:"' + k + '",label:"' + lab + '"}')
    ? ok('PEP: ' + t.toUpperCase() + ' tab registered')
    : bad('PEP: ' + t.toUpperCase() + ' tab missing from tab bar');
});

// v4.9.152 restore rule — newest timestamp wins
has('ps._ts = new Date().toISOString();',      'PEP: pepSaveState stamps _ts');
has('function _pepBackupLocal(', 'PEP: local backup before overwrite');
// v4.9.191: hasNotCode, not hasNot. These two guard the regressions with the
// most instructive history in my domain — the .158 protocol wipe and the mirror
// that swallowed errors for 12 versions. Reading raw text meant that WRITING
// DOWN either incident broke the build, so the guard punished exactly the
// documentation a successor needs most.
// The needle must be CODE-ONLY. It used to carry the trailing comment
// `// local takes priority`, which hasNotCode strips before matching — so the
// guard could never match the very line it exists to catch. Proving the CATCH
// direction is what exposed that; the ignore direction had gone green happily.
hasNotCode('if(local) return;',                'PEP: old local-always-wins rule removed');
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
has('function _pepCloudPayload(',   'PEP: cloud payload builder present');
has('function _pepErrorSummary(',   'PEP: scrubbed diagnostic summary present');
has('window._pepFlushCloud = function()', 'PEP: pagehide flush present');
has("window.addEventListener(\"pagehide\", function(){ window._pepFlushCloud(); });",
                                       'PEP: pagehide listener wired');
hasNotCode('.then(function(){});',     'PEP: empty swallow-everything then() gone');

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

// v4.9.228: the guard above proves the SCRUBBER scrubs. It does not prove the
// scrubber is on the path — a new write doing update({peptide_state: ps})
// direct from state would ship Jon's pathology results to a jsonb column with
// every gate still green. Highest-stakes rule I own and it rested on one
// function's contents, which is the shape I had just generalised twice
// elsewhere. Found by re-reading my own guards rather than by a failure.
//
// The rule: peptide_state is written in exactly ONE place, and that place is
// fed by _pepCloudPayload. Enforce the choke point, not the scrub.
(() => {
  const START = 'PEPTIDE BLOCK START — do not move';
  const END   = 'PEPTIDE BLOCK END — do not move';
  const a = html.indexOf(START), b = html.indexOf(END);
  if (a < 0 || b < 0) { bad('PEP: sentinels missing — cannot check the mirror choke point'); return; }
  const blk = phxStripComments(html.slice(a, b));
  const send = blk.indexOf('function _pepSendCloud');
  if (send < 0) { bad('PEP: _pepSendCloud missing — the single mirror write path is gone'); return; }
  const sendEnd = blk.indexOf('\nfunction ', send + 1);
  if (sendEnd < 0) { bad('PEP: could not find the end of _pepSendCloud — cannot say which writes are inside it, and guessing here is guessing about whether blood markers reach Supabase'); return; }

  // Every place the column is WRITTEN (not read). Reads look like row.peptide_state.
  const writes = [...blk.matchAll(/peptide_state\s*:/g)].map(m => m.index);
  const outside = writes.filter(k => k < send || k >= sendEnd);
  // FLOOR, same reason as the overlay enumeration. Zero matches is not "no
  // violations", it is "this guard found nothing to check" — a renamed column
  // or a reshaped block would report the strongest privacy assurance I make
  // while verifying nothing at all. Two writes today: the keepalive PATCH body
  // and the supabase-js update.
  if (writes.length < 2) {
    bad(`PEP: the peptide_state scan found ${writes.length} write(s), expected >= 2 — the column was renamed or the mirror was restructured. This guard is the only thing standing between blood-panel markers and Supabase; it must not pass by finding nothing.`);
  } else {
    outside.length === 0
      ? ok(`PEP: peptide_state written only inside _pepSendCloud (${writes.length} writes, all behind the scrubber)`)
      : bad(`PEP: ${outside.length} peptide_state write(s) OUTSIDE _pepSendCloud — anything not fed by _pepCloudPayload mirrors blood-panel markers into Supabase`);
  }

  // And the payload _pepSendCloud receives must come from the scrubber.
  /_pepMirrorPending\s*=\s*_pepCloudPayload\(/.test(blk)
    ? ok('PEP: the mirror payload is built by _pepCloudPayload')
    : bad('PEP: the mirror payload no longer comes from _pepCloudPayload — the scrub is off the path');
})();

// ── THE OTHER EXIT ──────────────────────────────────────────────────────────
// The choke-point guard above covers Supabase. It does not cover the external
// Cloudflare worker, and blood data leaves by BOTH doors.
//
// Found by taking the PM's "this generalises to every sanitiser" seriously and
// asking where else the data goes, rather than re-reading the exit I had just
// fixed. _pepCloudPayload strips bloods from the mirror — Jon's OWN Supabase,
// RLS-protected, in his own project — on the stated grounds that pathology
// should not be duplicated into a second store. Meanwhile _pepBuildContext
// sends latest_bloods (marker names, values, units, reference ranges, lab,
// panel date) to phoenix-coach.jon-d87.workers.dev, whose source is not in this
// repo and is owned by no chat here. pepExtractMarkers sends the PHOTOGRAPH of
// the pathology report to the same place.
//
// NEITHER IS A BUG. Both are the features working as Jon asked for them — the
// scanner is a photo-to-markers scanner by his explicit request, and an advisor
// that cannot see his bloods is a worse advisor. What is wrong is only that I
// applied a strict rule to the door I built and no rule at all to the door I
// also built. Whether bloods should reach the worker is JON'S call, not mine,
// so nothing here changes behaviour.
//
// What these guards do is make the egress DELIBERATE. Today two functions talk
// to the worker and the advisor context has eight top-level fields. Adding a
// ninth, or a third caller, now fails the harness until someone changes this
// list on purpose — which is the choke-point shape applied to the second exit.
(() => {
  const START = 'PEPTIDE BLOCK START — do not move';
  const END   = 'PEPTIDE BLOCK END — do not move';
  const a = html.indexOf(START), b = html.indexOf(END);
  if (a < 0 || b < 0) { bad('PEP: sentinels missing — cannot check external egress'); return; }
  const blk = phxStripComments(html.slice(a, b));

  const WORKER = 'phoenix-coach.jon-d87.workers.dev';
  const hits = (blk.match(new RegExp(WORKER.replace(/\./g, '\\.'), 'g')) || []).length;
  hits === 2
    ? ok('PEP: exactly 2 calls leave the device for the coach worker (advisor, marker scanner)')
    : bad(`PEP: ${hits} calls to the external worker, expected 2. Every one sends Jon's data off-device to a service whose source is not in this repo — a new one must be a deliberate decision, not a diff nobody read.`);

  const ctx = phxFnSpan(blk, '_pepBuildContext');
  if (ctx === null) { bad('PEP: _pepBuildContext missing, or its end could not be located — the advisor egress cannot be checked, and an unbounded span would scan unrelated code and report it as data leaving the device'); return; }

  // Top-level keys of the object handed to the worker. Pinned by name so a new
  // field is a conscious addition. latest_bloods is on this list deliberately:
  // it documents that pathology DOES leave, rather than hiding it.
  // v4.9.235 adds stock_on_hand — counts, dates and vial numbers, no supplier
  // or price data. Updated here DELIBERATELY, which is the whole point of the
  // pin: the guard failed on the new field first and made me come here and say
  // what it is before it could ship.
  const EXPECTED = [
    'today_date', 'day_of_week', 'timezone', 'protocol', 'scheduled_today',
    'adherence_last_14_days', 'logged_responses', 'latest_bloods', 'stock_on_hand',
  ];
  // The OUTER return, at function-body indent. lastIndexOf('return {') found
  // the one inside the scheduled_today .map callback instead — caught within a
  // minute by the floor below, on the very guard that added it.
  //
  // END-ANCHORED to the object's own closing brace, not to the end of the
  // function. Scanning to end-of-function meant the span's extent was never
  // established: it happened to coincide with the object because nothing
  // follows the return. "Nothing follows it today" is not an end anchor.
  const outer = ctx.search(/\n  return \{/);
  if (outer < 0) { bad('PEP: could not locate the advisor context return — the egress pin has nothing to read'); return; }
  const close = ctx.indexOf('\n  };', outer);
  if (close < 0) { bad('PEP: found the advisor context return but not its close — refusing to scan an object whose end I cannot see, rather than reporting on however much of it I happened to read'); return; }
  const ret = ctx.slice(outer, close);
  const found = [...ret.matchAll(/^\s{4}([a-z_0-9]+):/gm)].map(m => m[1]);
  if (found.length < EXPECTED.length) {
    bad(`PEP: the advisor-context scan found ${found.length} fields, expected >= ${EXPECTED.length} — the return shape changed and this egress pin is no longer reading it.`);
  } else {
    const extra = found.filter(f => !EXPECTED.includes(f));
    const gone  = EXPECTED.filter(f => !found.includes(f));
    extra.length === 0 && gone.length === 0
      ? ok(`PEP: the advisor sends exactly the ${EXPECTED.length} pinned fields off-device, bloods included and declared`)
      : bad(`PEP: what leaves the device changed — ${extra.length ? `added ${extra.join(', ')}` : ''}${extra.length && gone.length ? '; ' : ''}${gone.length ? `removed ${gone.join(', ')}` : ''}. This is Jon's medical data going to an unowned external service; the change may well be right, but it must be intended.`);
  }
})();

// Every Supabase WRITE in the peptide block reports somewhere Jon can see.
// v4.9.232, after the PM's sweep found 24 console-only writes across the file
// and I assumed none were mine. Two were: _pepSendCloud's outer catch, and the
// whole of pepDeleteBloodPanel. console.warn is invisible on an iPhone, so a
// write that only warns is a write that fails silently.
//
// Writes only. Reads that warn are fine — a failed load leaves stale data on
// screen, which is recoverable and visible; a failed write loses the thing he
// just entered.
(() => {
  const START = 'PEPTIDE BLOCK START — do not move';
  const END   = 'PEPTIDE BLOCK END — do not move';
  const a = html.indexOf(START), b = html.indexOf(END);
  if (a < 0 || b < 0) { bad('PEP: sentinels missing — cannot check write reporting'); return; }
  const blk = phxStripComments(html.slice(a, b));
  const WRITERS = ['pepSaveBloodPanel', 'pepDeleteBloodPanel', '_pepSendCloud'];
  const missing = [], unfound = [];
  WRITERS.forEach(name => {
    const span = phxFnSpan(blk, name);
    if (span === null) { unfound.push(name); return; }
    if (!/_phxRecordWriteError/.test(span)) missing.push(name);
  });
  if (unfound.length) {
    bad(`PEP: could not bound ${unfound.join(', ')} — cannot verify their failures are reported, and will not assume it`);
  } else {
    missing.length === 0
      ? ok(`PEP: all ${WRITERS.length} Supabase-writing functions report failures beyond console.warn`)
      : bad(`PEP: ${missing.join(', ')} write to Supabase and report failures only to console.warn — invisible on iPhone, so the write fails silently`);
  }
})();

// No swallowed cloud errors, as a rule over the whole block rather than a note
// about the one that bit. v4.9.154 fixed an empty .then() and wrote a comment
// saying errors here are surfaced — while a bare .catch(function(){}) sat four
// lines below it on the keepalive PATCH, unfixed until v4.9.228. A comment
// claiming a property is not a check for it.
(() => {
  const START = 'PEPTIDE BLOCK START — do not move';
  const END   = 'PEPTIDE BLOCK END — do not move';
  const a = html.indexOf(START), b = html.indexOf(END);
  if (a < 0 || b < 0) { bad('PEP: sentinels missing — cannot check for swallowed errors'); return; }
  const blk = phxStripComments(html.slice(a, b));
  // Empty PROMISE handlers only. try/catch(_e){} around DOM and localStorage is
  // legitimate and deliberately not matched.
  const swallows = blk.match(/\.(?:then|catch)\(\s*function\s*\([^)]*\)\s*\{\s*\}\s*\)/g) || [];
  swallows.length === 0
    ? ok('PEP: no empty promise handlers in the peptide block')
    : bad(`PEP: ${swallows.length} swallowed promise result(s) — ${[...new Set(swallows)].join(' , ')}. CLAUDE.md rule 8: keepalive and pagehide paths included.`);
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
hasNotCode('Every 3rd week (45+)',      'DELOAD: age-banded scheduled rule removed');
hasNotCode('every 3rd-4th week (35-44)','DELOAD: age band 35-44 removed');
hasNotCode('every 4th week (under 35)', 'DELOAD: age band under-35 removed');
// Prompt block periodisation must name 5 and 10, never 4/8/12.
has('- Scheduled: every 5th week', 'DELOAD: prompt states the every-5th-week cadence');
has('weeks 5 and 10',              'DELOAD: prompt names weeks 5 and 10');
has('BLOCK 1 — ACCUMULATION (Weeks 1-4, deload week 5):',   'DELOAD: prompt Block 1 deloads week 5');
has('BLOCK 2 — INTENSIFICATION (Weeks 6-9, deload week 10):','DELOAD: prompt Block 2 deloads week 10');
has('BLOCK 3 — REALISATION (Weeks 11-12):',                  'DELOAD: prompt Block 3 is weeks 11-12');
hasNotCode('Deload week 8.',  'DELOAD: stale "Deload week 8" gone from prompt');
hasNotCode('Deload week 12.', 'DELOAD: stale "Deload week 12" gone from prompt');
hasNotCode('Deload week 4."', 'DELOAD: stale "Deload week 4" gone from coach-note example');
// The unscheduled triggers are independent of cadence and must survive untouched.
has('RPE average > 9.5 two consecutive weeks',   'DELOAD: unscheduled RPE trigger intact');
has('completion rate < 60% two consecutive weeks','DELOAD: unscheduled completion trigger intact');
has('overreaching triad',                         'DELOAD: overreaching triad trigger intact');

// ── v4.9.155 [PM] Write-error diagnostics + BLAB mirror instrumentation ────────
// _phxRecordWriteError must redact: shape only, no details/hint, message truncated, ring of 8.
// v4.9.191 [PM]: names corrected after Nutrition's 06da7fa — a structural guard whose NAME
// reads as a behavioural claim is worse than one that reads honestly, because an auditor
// reads the name and moves on. "recorded" / "written" / "chains" all claimed behaviour these
// assertions cannot support; they check that a line of source exists. Where the behaviour IS
// proven the name now points at where. The four BLAB MIRROR guards say NOT behaviourally
// covered — and the gap that declaration exposed is now closed: tests/pm.mjs drives
// _blabSendCloud with a failing fetch and asserts the diagnostic actually lands.
has('payload_shape: _phxShapeOf(payload)',          'DIAG: shape helper is wired in (structural — that it REDACTS is tests/pm.mjs)');
// v4.9.191 [PM]: code-only variants. `has`/`hasNot` read raw text, which is correct for the
// version-label guards (a label legitimately lives in a comment) and WRONG for anything
// asserting the presence or absence of CODE. Proven by prose probe (Training's method,
// 2026-08-21): six PM guards fired on a comment describing the very thing they guard, so
// documenting the privacy rule would have broken the build.

hasNotCode('payload_preview:',                          'DIAG: raw payload_preview removed');
hasNotCode("details: (err && err.details) || null",     'DIAG: details (value-echoing) not recorded');
hasNotCode("hint: (err && err.hint) || null",           'DIAG: hint (value-echoing) not recorded');
has("if(msg.length > 200) msg = msg.slice(0, 200)", 'DIAG: truncation present (structural — that it TRUNCATES is tests/pm.mjs)');
has("localStorage.setItem('phx_write_errors', JSON.stringify(ring))", 'DIAG: ring write present (structural — that it RETAINS 8 is tests/pm.mjs)');
has('while(ring.length > 40) ring.shift();',        'DIAG: ring cap present (structural — that it EVICTS is tests/pm.mjs)');
// v4.9.240: the ring must be RENDERED, not merely collected. It was written from v4.9.176
// and read by nothing — the panel showed one entry, so any later failure overwrote the one
// that mattered. Structural pin here; that an EARLIER failure survives a later one is
// driven in tests/pm.mjs.
has("getElementById('diag-error-ring')",             'DIAG: the write-error ring is read back for display');
has('id="diag-error-ring"',                          'DIAG: the panel has somewhere to show it');
has('prev.count = (prev.count || 1) + 1;',           'DIAG: ring coalesces by context so a loop cannot evict another domain');
// _blabSendCloud: BOTH branches record. Keepalive is the pagehide write — must not swallow.
has("_phxRecordWriteError('_blabSendCloud.keepalive'",        'BLAB MIRROR: keepalive HTTP branch calls the recorder (structural — that it RECORDS is tests/pm.mjs)');
has("_phxRecordWriteError('_blabSendCloud.keepalive.reject'", 'BLAB MIRROR: keepalive reject branch calls the recorder (structural — that it RECORDS is tests/pm.mjs)');
has("_phxRecordWriteError('_blabSendCloud.update'",           'BLAB MIRROR: update error branch calls the recorder (structural — that it RECORDS is tests/pm.mjs)');
has("_phxRecordWriteError('_blabSendCloud.update.reject'",    'BLAB MIRROR: update reject branch calls the recorder (structural — that it RECORDS is tests/pm.mjs)');
hasNot("}).catch(function(){});\n    } catch(_){}",           'BLAB MIRROR: keepalive no longer swallows');
// Shared restore hook lives in PM plumbing, exactly once, and still chains both domains.
{
  const n = (phxStripComments(html).match(/window\._phxOnProfileFetched = function\(row\)\{/g) || []).length;
  n === 1 ? ok('HOOK: _phxOnProfileFetched wrapper defined exactly once') : bad(`HOOK: wrapper defined ${n} times`);
  const idxHook = html.indexOf('SHARED RESTORE HOOK (PM-owned)');
  const idxPep  = html.indexOf('function pepGetState(');
  (idxHook > 0 && idxHook < idxPep) ? ok('HOOK: wrapper relocated to PM plumbing (before peptide block)') : bad('HOOK: wrapper still inside peptide block');
}
has('pepRestoreFromCloud(row)) _pepAfterRestore();', 'HOOK: peptide chain line present (structural — that it CHAINS is tests/peptides.mjs)');
has('nutRestoreRecipesFromCloud(row)) _nutAfterRestore();', 'HOOK: nutrition chain line present (structural — that it CHAINS is tests/nutrition.mjs)');

// ── BLAB restore resolution (v4.9.158) ──────────────────────────────────────
// Jon ruled 2026-08-18: newest _ts wins, EXCEPT it may never roll training
// progress backwards. Behaviour is covered by tests/training.mjs; these pin the
// shape so the old local-wins rule cannot creep back in.
console.log('\nBLAB restore resolution:');
has('state._ts = new Date().toISOString()',  'RESTORE: _ts stamp present (structural — behaviour in tests/training.mjs)');
has('window.blabProgressScore',              'RESTORE: progress score helper present');
has('function _blabBackupLocal',             'RESTORE: one-generation backup helper');
has("localStorage.setItem(key + '_bak', rawLocal)", 'RESTORE: _bak write present (structural — behaviour in tests/training.mjs)');
has('if(cloudScore < localScore){',          'RESTORE: progress guard present (structural — behaviour in tests/training.mjs)');
has("_phxRecordWriteError('blabRestore.progressGuard'", 'RESTORE: guard telemetry present (structural — behaviour in tests/training.mjs)');
has('cloudWins = ct > lt;',                  'RESTORE: strict newer-than present (structural — behaviour in tests/training.mjs)');
has('if(local.active !== true && cloud.active === true)', 'RESTORE: inactive-stub rule present (structural — behaviour in tests/training.mjs)');
// The pre-v4.9.158 rule: local won whenever it was active, regardless of stamps.
hasNotCode("if(cloudDay > localDay){",           'RESTORE: old local-wins tiebreak removed');
hasNotCode('blabRestoreFromCloud abort: local active and >= cloud', 'RESTORE: old local-wins log line removed');

// ── Today card reads the calendar (v4.9.161) ────────────────────────────────
// Jon device-tested the calendar: Today still showed the next sequential BLAB
// session. Behaviour is covered by tests/training.mjs; these pin the wiring.
console.log('\nToday card — calendar integration:');
has('window.blabCalHasSchedule',   'TODAY: calendar-in-use check present');
has('window.blabCalSessionsOn',    'TODAY: per-date session reader present');
has('window.blabCalTodaySessions', 'TODAY: today reader present');
has('window.blabCalNextDays',      'TODAY: next-days reader present');
has('window.blabCalEntryView',     'TODAY: entry view helper present');
has('function _blabRenderTodayFromCalendar', 'TODAY: calendar-driven card renderer');
has('function _renderTodayNextDays',         'TODAY: dated coming-up row');
has('if(_blabRenderTodayFromCalendar(_card, _inner, _week)) return;', 'TODAY: card branches to the calendar');
has('window.blabCalHasSchedule()', 'TODAY: branch is gated on the calendar being in use');
// The sequential fallback must survive for anyone who has not scheduled anything.
has('_renderTodayRemainingRow(_bs, _nextDay, _weekDone)', 'TODAY: sequential path retained when calendar empty');

// blabCalTodayEntry is BLAB-only and first-match. It is correct for the sequential
// 48h gate and wrong for anything else, so pin it to exactly one call site: a new
// caller expecting the full agenda would silently get a subset (no customs, one
// session). Counts INVOCATIONS specifically — the definition, the typeof guard and
// prose mentions all name it without calling it, so a bare name match would be noise.
(() => {
  const n = (phxStripComments(html).match(/blabCalTodayEntry\(\)/g) || []).length;
  if (n === 1) ok('TODAY: blabCalTodayEntry still has exactly one call site (the sequential 48h gate)');
  else bad(`TODAY: blabCalTodayEntry is invoked ${n}×, expected 1 (the sequential 48h gate). ` +
           `A new caller gets a BLAB-only, first-match subset — use blabCalTodaySessions() for the full agenda.`);
})();

// ── Perpetual calendar (v4.9.162) ───────────────────────────────────────────
// The calendar used to page one ISO week at a time, so scheduling a 12-week block
// meant repeated tapping. It now runs on continuously and extends as you scroll.
console.log('\nCalendar — perpetual scroll:');
has('var _blabCalDaysShown',      'PERPETUAL: rolling window size');
has('function _blabCalVisibleDays','PERPETUAL: window builder');
has('window._blabCalExtend',      'PERPETUAL: forward extend');
has('window._blabCalShowEarlier', 'PERPETUAL: backward extend');
has('window._blabCalGoToday',     'PERPETUAL: jump to today');
has('function _blabCalWireScroll','PERPETUAL: scroll watcher');
has('function _blabCalWeekOf',    'PERPETUAL: single-week context for smart recs');
has('_blabCalSmartRec(dateISO, _blabCalWeekOf(', 'PERPETUAL: smart rec gets one week, not the whole window');
// Week paging is gone entirely — no stale callers left behind in the HTML.
hasNotCode('_blabCalVisibleWeek', 'PERPETUAL: week-window builder removed');
hasNotCode('_blabCalWeekOffset',  'PERPETUAL: week offset state removed');
hasNotCode('_blabCalShiftWeek',   'PERPETUAL: week paging control removed');
hasNotCode('_blabCalThisWeek',    'PERPETUAL: this-week reset removed');

// ── Preview before adding + live suggestions (v4.9.163) ─────────────────────
console.log('\nCalendar — preview and suggestions:');
has('window._blabCalPreviewThenAdd',   'PREVIEW: inspect-then-schedule helper');
has('window._blabCalSuggestFor',       'SUGGEST: concrete session proposal');
has('window._blabCalAcceptSuggestion', 'SUGGEST: accept action');
has('window._blabCalPlaceRest',        'REST: planned rest entry');
has('function _blabCalIsRest',         'REST: rest classifier');
has('data-cal-suggest=',               'SUGGEST: provisional-entry markup present (structural — behaviour in tests/training.mjs)');
has('SUGGESTED',                       'SUGGEST: provisional entries are badged');
// The old category-only chip is gone.
hasNotCode('data-cal-rec=',                'SUGGEST: category-only chip replaced');
hasNotCode('data-cal-rec-type',            'SUGGEST: category-only chip type attribute removed');
// _phxOpenSessionDetail gained an additive third arg; the two existing call sites
// must keep working unchanged, so pin their count.
has('window._phxOpenSessionDetail = function(id, backCtx, opts)', 'PREVIEW: detail view takes an opts arg');
has("opts.actionLabel || 'Start Session →'", 'PREVIEW: default action preserved for existing callers');
(() => {
  // Exactly one caller may pass opts — the calendar's preview-then-add. Every other
  // caller (nine library back-buttons and tiles) must keep the default Start action.
  const withOpts = (phxStripComments(html).match(/_phxOpenSessionDetail\([^)]*,\s*\{/g) || []).length;
  if (withOpts === 1) ok('PREVIEW: exactly one caller overrides the detail-view action');
  else bad(`PREVIEW: ${withOpts} callers pass opts to _phxOpenSessionDetail, expected 1 (the calendar). ` +
           `Every other caller must fall through to the default Start Session action.`);
})();

// ── Jon's device test of .162/.163 — three fixes (v4.9.164) ─────────────────
console.log('\nDevice-test fixes:');

// 1. blabCompleteSession must save state BEFORE marking the calendar. The nested
//    save re-reads state and writes it back with .calendar attached; doing it first
//    meant the stale capture overwrote it and dropped the calendar from blab_state
//    on every completion. Behaviour is covered in tests/training.mjs; this pins the
//    ORDER, which is the whole bug.
(() => {
  const fn = html.slice(html.indexOf('window.blabCompleteSession = function'));
  const body = fn.slice(0, fn.indexOf('\n};'));
  const save = body.indexOf('window.blabSaveState(s)');
  const mark = body.indexOf('window.blabCalMarkCompleted(week, day)');
  if (save > -1 && mark > -1 && save < mark) ok('COMPLETE: state is saved before the calendar is marked');
  else bad(`COMPLETE: blabCalMarkCompleted runs at ${mark}, blabSaveState at ${save} — the calendar mark must come AFTER the state save or the stale capture drops blab_state.calendar.`);
})();

// 2. Suggestion rotation — the .163 picker returned list[0] forever.
has('var best = head[seed % head.length];', 'SUGGEST: rotates within the least-recent pool by date');
has('if(!pool.length) pool = list;',        'SUGGEST: falls back rather than suggesting nothing');
hasNotCode('if(v < bestT){ bestT = v; best = x; }', 'SUGGEST: first-match-forever picker removed');

// 3. Hold-to-drag must not start an iOS text selection.
has('#screen-blab-calendar,#screen-blab-calendar *', 'DRAG: selection suppressed on the calendar screen');
has('-webkit-touch-callout:none',                     'DRAG: long-press callout suppressed');

// ── Today card wiring + undefined-name sweep (v4.9.165) ─────────────────────
console.log('\nToday card wiring:');
// The bug: the renderer called _blabCalEntryView; the function is
// window.blabCalEntryView. Every call threw, the inject swallowed it, and the
// static placeholder was left with a dead Start button for four versions.
hasNotCode('_blabCalEntryView(', 'TODAY: no call to the non-existent _blabCalEntryView');
has('window.blabCalEntryView(', 'TODAY: renderer uses the real exported name');
has('No Session Today',            'TODAY: empty day says so plainly');
has('_blabCalConfirmRestToday',    'TODAY: confirm-rest action');
has('_blabCalAddSessionToday',     'TODAY: add-session action');
has('function _blabCalAfterChange','TODAY: shared repaint helper present (structural — NOT behaviourally covered)');
has("_phxRecordWriteError('todayCard.render'", 'TODAY: error telemetry present (structural — behaviour in tests/training.mjs)');
has('Could not build today',       'TODAY: error card copy present (structural — behaviour in tests/training.mjs)');
// The extraction is only safe if the catch still CALLS it. Without this, the error
// card could be perfectly tested and never reached — the builder-vs-entry gap, in the
// safety net whose whole purpose is catching that class.
hasCode('window._blabRenderTodayError(_e);', 'TODAY: the render catch actually calls the error renderer');
// Programme tab must reach the calendar while BLAB is running.
has("if(tab === 'programme' && typeof blabIsActive === 'function' && blabIsActive())", 'NAV: Programme routes to the calendar under BLAB');
has('id="nav-programme4"',         'NAV: calendar screen carries the bottom nav');

// Undefined-call sweep. The failure above was an identifier that never resolved —
// invisible to runtime_check, which only executes top level. This pins the whole
// class for the calendar surface: every _blabCal* / blabCal* name that is CALLED
// must also be DEFINED somewhere.
(() => {
  // Comment-stripped: _blabCalEntryView is the dead-reference case study in the
  // archive and the standard, so it is a name people WILL write about. On raw text a
  // prose mention counts as a call and the sweep reports it undefined.
  const cs = codeSrc();
  const called  = new Set([...cs.matchAll(/\b(_?blabCal[A-Za-z0-9_]*)\s*\(/g)].map(m => m[1]));
  const defined = new Set([
    ...[...cs.matchAll(/function\s+(_?blabCal[A-Za-z0-9_]*)\s*\(/g)].map(m => m[1]),
    ...[...cs.matchAll(/window\.(_?blabCal[A-Za-z0-9_]*)\s*=/g)].map(m => m[1]),
    ...[...cs.matchAll(/(?:var|let|const)\s+(_?blabCal[A-Za-z0-9_]*)\s*=/g)].map(m => m[1])
  ]);
  // Compared EXACTLY. An earlier draft of this guard also accepted a name with its
  // leading underscore stripped, which made _blabCalEntryView look defined because
  // blabCalEntryView exists — the precise bug it was written to catch. _blabCalX and
  // blabCalX are different identifiers and must be treated as such.
  const missing = [...called].filter(n => !defined.has(n));
  if (!missing.length) ok('TODAY: every blabCal* name that is called is also defined');
  else bad(`TODAY: called but never defined — ${missing.join(', ')}. ` +
           `runtime_check cannot see this (function bodies never run); it reaches the athlete as a dead button.`);
})();

// ── Weekly check-in feeds the nutrition weight log (v4.9.168) ───────────────
console.log('\nWeight check-in → nutrition:');
has('nutRecordWeight(w);',                  'WEIGHT: nutRecordWeight call present (structural — behaviour in tests/training.mjs)');
has("typeof nutRecordWeight === 'function'",'WEIGHT: call is typeof-guarded across domains');
has('athlete.bw=w;',                        'WEIGHT: athlete.bw write present (structural — behaviour in tests/training.mjs)');
// The call must come AFTER the athlete write, so a throw in Nutrition's code can
// never cost the weigh-in Jon just entered.
(() => {
  const fn = html.slice(html.indexOf('function submitWeightCheckin'));
  const body = fn.slice(0, fn.indexOf('\n}'));
  const bw  = body.indexOf('athlete.bw=w;');
  const nut = body.indexOf('nutRecordWeight(w);');
  if (bw > -1 && nut > -1 && bw < nut) ok('WEIGHT: athlete.bw is written before the cross-domain call');
  else bad(`WEIGHT: nutRecordWeight at ${nut}, athlete.bw at ${bw} — the athlete write must come first so a fault in another domain cannot lose the weigh-in.`);
})();

// ── v4.9.168 [PM] shared local date key ─────────────────────────────────────────
hasCode("function _phxLocalISO(d){", 'DATE: shared local-date helper defined (structural — that it returns LOCAL is tests/pm.mjs)');
{ const n=(codeSrc().match(/today_date: _phxLocalISO\(\)/g)||[]).length; n===4 ? ok('DATE: all 4 coach payloads send LOCAL today_date') : bad(`DATE: expected 4 local today_date sites, found ${n}`); }
hasNotCode("today_date: new Date().toISOString().split('T')[0]", 'DATE: coach today_date no longer UTC');
// ── Local day keys in Training (v4.9.170) ───────────────────────────────────
// PM date rule: persist instants as UTC ISO; derive day keys at read time via
// _phxLocalISO(new Date(instant)); store only BARE day keys as local Y-M-D.
console.log('\nTraining day keys:');
has('date:_phxLocalISO(),',                     'DAYKEY: set log stores a local day key');
has('_phxLocalISO(new Date(l.date))===dateStr', 'DAYKEY: walk streak converts the stored instant');
has('var dateStr=_phxLocalISO(checkDate);',     'DAYKEY: walk streak compares against a local day');
// The old forms must not come back in either place.
hasNotCode("date:new Date().toISOString().split('T')[0],\n    sessionId:sessionId,", 'DAYKEY: set log no longer stores a UTC date');
hasNotCode("if(logs.some(function(l){return l.date.split('T')[0]===dateStr;}))",     'DAYKEY: walk streak no longer string-slices the instant');
// The three walk WRITERS are correct as they stand — an instant is the right thing
// to persist. If a sweep "fixes" them the streak breaks and history is corrupted,
// so pin that they still store a full ISO instant.
(() => {
  // Matched on the walk-entry SHAPE (date immediately followed by mode), not on a
  // bare toISOString — a loose match counted 15 unrelated sites across the file and
  // would have stayed green with all three walk writers changed.
  const n = (phxStripComments(html).match(/date:\s*new Date\(\)\.toISOString\(\),\s*mode:/g) || []).length;
  if (n === 3) ok('DAYKEY: all 3 walk writers still persist a full UTC instant');
  else bad(`DAYKEY: ${n} walk writers persist a full instant, expected exactly 3. ` +
           `Converting one to a day key loses the time the read-time conversion depends on, ` +
           `and silently corrupts the streak for that entry point.`);
})();

// ── Start actions and visible failures (v4.9.171) ───────────────────────────
console.log('\nSession start:');
has("_phxStartSession('", 'START: custom sessions start via the real _phxStartSession');
has('function _phxStartSession', 'START: and that function exists');
has('function _blabSessionOpenFailed', 'START: a failed open has a visible surface');
has("_phxRecordWriteError('blabOpenSession'", 'START: failures reach Diagnostic');
// Both checks below run on CODE, not prose. A plain match counted the explanatory
// comments that describe what was removed and reported the bug as still present —
// the same guard-population mistake as the underscore-stripping sweep and the
// 15-site writer count. A guard that measures the wrong text is worse than none.
const stripComments = phxStripComments; // v4.9.191: the regex form ate 23.7% of the file
const codeOnly = stripComments(html);
(() => {
  const n = (codeOnly.match(/openPhxSession\s*\(/g) || []).length;
  if (n === 0) ok('START: the non-existent openPhxSession is never called');
  else bad(`START: openPhxSession is still called ${n}× in code. It has never been defined; the call becomes a dead onclick.`);
})();
// alert() is banned (CLAUDE.md rule 4) — iOS PWA suppresses it, so a failure that
// ends in alert() is indistinguishable from a dead button. blabOpenSession had two.
(() => {
  const fn = codeOnly.slice(codeOnly.indexOf('window.blabOpenSession = function'));
  const body = fn.slice(0, fn.indexOf('\n};'));
  const n = (body.match(/\balert\s*\(/g) || []).length;
  if (n === 0) ok('START: blabOpenSession has no suppressed native dialogs');
  else bad(`START: blabOpenSession still calls alert() ${n}× in code. iOS PWA suppresses it, so the tap looks dead. Use _blabSessionOpenFailed.`);
})();

// ── v4.9.175 [PM] native-dialog ratchet (CLAUDE.md rule 4) ──────────────────────
// alert()/confirm()/prompt() are silently suppressed in the iOS PWA: a failure shows
// the user NOTHING. That is how .172's dead Start button reached Jon with no clue —
// blabOpenSession reported via a native alert. Each domain converts its own over
// time; this ratchet only has to never go UP.
//
// 101 -> 89 at v4.9.175: Training converted its 10 session-path dialogs. The extra 2
// are NOT conversions — this regex runs over raw source, so it counts the word in
// COMMENTS too, and two comment lines describing removed dialogs were inflating the
// baseline. Anyone lowering this cap should reword their own comments rather than
// assume the delta equals the number of call sites they fixed.
{
  // v4.9.191: counted on CODE ONLY. This previously counted raw text, so 9 of the 80 were
  // comment MENTIONS — a domain could have added 9 real dialogs while deleting comments and
  // stayed green. Peptides' rule (2026-08-21): a tolerance added to work around a measurement
  // problem outlives the measurement fix and silently becomes a hole; when you correct what a
  // guard can see, re-examine every fudge that existed because it could not see properly.
  // Training had flagged the raw count as "not a site count" — with phxStripComments it now is.
  const NATIVE_DIALOG_CAP = 55;   // 71 -> 55 at v4.9.239: twelve dead alert() error paths converted to _phxNotice
  const n = (phxStripComments(html).match(/(?:^|[^.\w])(?:alert|confirm|prompt)\(/g) || []).length;
  if (n > NATIVE_DIALOG_CAP) bad(`RULE 4: native dialogs grew to ${n} (cap ${NATIVE_DIALOG_CAP}) — use a DOM modal, iOS suppresses these silently`);
  else if (n < NATIVE_DIALOG_CAP) ok(`RULE 4: native dialogs down to ${n} (cap ${NATIVE_DIALOG_CAP}) — lower the cap in harness.mjs`);
  else ok(`RULE 4: native dialogs held at ${n}, not growing`);
}

// ── Session re-entry keeps its row (v4.9.179) ───────────────────────────────
// Jon: "navigate off training today session it then wipes the session info already
// done". supabaseStartSession always INSERTS, so re-entering minted a fresh id and
// the completed-sets shadow store — keyed by that id — became unreachable.
//
// Structural, not behavioural: driving openTodaySession needs the full session DOM.
// The release side IS covered functionally in tests/training.mjs; this pins the
// branch that stops a second row being opened.
console.log('\nSession re-entry:');
has('window._phxActiveSessionKey === _sessKey', 'REENTRY: same-identity check present');
has('window._phxActiveSessionKey = _sessKey',   'REENTRY: identity assignment present (structural — NOT behaviourally covered)');
has("return 'blab:' + b.week + ':' + b.day",    'REENTRY: BLAB identity is week/day');
has('window._phxActiveSessionKey = null',       'REENTRY: key released on completion');
(() => {
  // The guard must actually gate the call, not sit beside it.
  // Located in COMMENT-STRIPPED source. indexOf on raw text finds the first textual
  // match, so a comment naming `var _sameSession =` — like the one in the block above
  // this guard's subject — hijacks the scan window and the guard fails on prose.
  // Found by testing the ignoring direction; it had only ever been proven catching.
  const code = phxStripComments(html);
  const i = code.indexOf('var _sameSession =');
  const seg = code.slice(i, i + 700);
  const guarded = /_sameSession[\s\S]{0,160}if\(!_sameSession\)\{[\s\S]{0,200}supabaseStartSession/.test(seg);
  if (guarded) ok('REENTRY: a second row is only opened when the identity differs');
  else bad('REENTRY: supabaseStartSession is no longer behind the same-session check — re-entry will mint a new row and orphan the logged sets');
})();

// ── [PM] version-comment staleness (requested by Peptides + Nutrition, 2026-08-18) ──
// A version written into a comment while building goes stale the moment a rebase moves
// APP_VERSION past it. Peptides shipped .180 with code labelled v4.9.161 (Training already
// owned .161); Nutrition is mid-build labelled .174 against a .180 main. The harness pinned
// APP_VERSION but nothing checked the references around it.
{
  const cur = parseInt((html.match(/APP_VERSION='4\.9\.(\d+)'/) || [])[1], 10);
  const refs = [...new Set([...html.matchAll(/v4\.9\.(\d+)/g)].map(m => parseInt(m[1], 10)))];
  const ahead = refs.filter(r => r > cur);
  ahead.length
    ? bad(`VERSION: comment references v4.9.${ahead.join(', v4.9.')} but APP_VERSION is 4.9.${cur} — a version that does not exist yet`)
    : ok('VERSION: no comment references a version ahead of APP_VERSION');
  // THIS IS THE LOAD-BEARING CHECK, not a "did you label it" nicety — both the PM and
  // Nutrition initially misread it as cosmetic (2026-08-21). It catches stale-after-rebase:
  // a shipping version is referenced only by the domain shipping it, so if ALL your labels
  // are stale, nothing mentions the new number and this fails. Caught Peptides' .161
  // collision and Nutrition's .174 labels, both verified by reverting them on a real tree.
  // Third failure mode, found in anger by Nutrition on .185 and NOT one either of us listed:
  // no label at all, because the version comments lived in the BUILD SCRIPT used to make the
  // edits and never reached the shipped file. Caught it cold.
  // KNOWN RESIDUE, accepted: defeated if you write ONE correct label alongside stale ones.
  // Narrower than the mechanical failure (getting them all wrong after a rebase) and not
  // worth a git-aware gate to close — revisit only if it actually bites someone.
  // NOTE: the regex needs a literal 'v', so `APP_VERSION='4.9.N'` does not satisfy itself.
  refs.includes(cur)
    ? ok(`VERSION: v4.9.${cur} is labelled in the source`)
    : bad(`VERSION: APP_VERSION is 4.9.${cur} but no comment mentions v4.9.${cur} — label the change you are shipping (stale label after a rebase?)`);
}

// ── 150 Wall Balls + public day-label accessor (v4.9.184) ───────────────────
console.log('\n150 Wall Balls / public API:');
has("id:'wb-150', name:'150 Wall Balls'", 'WB150: library entry present, named for the work');
// Jon: "named different usins description what session is". The benchmark name must
// not be the label — keeping it in parentheses would satisfy the letter and defeat
// the point. It is allowed in the coaching note, which is context, not the label.
(() => {
  const m = /\{ id:'wb-150',[\s\S]{0,900}?\},\n\n/.exec(html);
  if (!m) { bad('WB150: could not isolate the entry to check its naming'); return; }
  const entry = m[0];
  const nameMatch = /name:'([^']*)'/.exec(entry);
  const name = nameMatch ? nameMatch[1] : '';
  if (/karen/i.test(name)) bad(`WB150: entry name is "${name}" — Jon asked for it named by the work, not the benchmark`);
  else ok('WB150: benchmark name kept out of the label');
})();
has("window.blabDayLabel = function", 'API: public day-label accessor exists');
has("var _BLAB_DAY_LABELS = [", 'API: the day-label array still backs the accessor');

// CONTRACT PINS — the shape other domains depend on. Nutrition pins these too, but
// its suite failing means I have ALREADY broken it. These fail on MY side first,
// which is where a provider's contract guard belongs.
has("if(!(d >= 1 && d <= 4)) return '';",           'CONTRACT: day-range check present (structural — behaviour in tests/training.mjs)');
has("out.push({custom:true, id:c.id, cat:c.cat",    'CONTRACT: calendar entries carry cat for the REST distinction');
// blabCalGet is INTERNAL (PM ruling): being on window is packaging, not a contract,
// and freezing {sessions, customs} would lock this domain's raw storage shape. The
// supported surface is the question-shaped call below.
//
// The temporary exception that let Nutrition read blabCalGet is DISCHARGED — they
// migrated to blabTrainingStateOn in their v4.9.189 and interpret nothing. Verified
// here rather than taken on trust: the guard below fails if any consumption returns.
has('window.blabTrainingStateOn = function',        'CONTRACT: question-shaped state surface exists');
(() => {
  // Nutrition dropped its own hasNot on blabCalGet because a file-wide match fired on
  // MY legitimate use of my own function. The check still belongs on this side — I am
  // the one who would be surprised by a consumer returning — but scanning THEIR block
  // was the wrong way to do it: both sentinels were foreign, so either peer renaming a
  // header moved my window, and the not-isolatable branch called ok(), turning a peer's
  // rename into a permanent silent pass.
  //
  // Counting invocations needs no sentinel I do not own. Uses the shared
  // phxStripComments (PM, 4c98ed8) rather than a private stripper: it drops a line
  // only when the line BEGINS a comment, so a /* or // mid-line inside a string or a
  // URL is never touched.
  //
  // The naive /\/\*[\s\S]*?\*\//g form is catastrophic on this file — it removed
  // ~24% of index.html and 231 function declarations, because /* and */ occur inside
  // strings and CSS and the lazy match spans unrelated pairs. It silently ate an
  // injected test consumer here, and left 8 of 25 _phxRecordWriteError and 33 of 38
  // nutGetState call sites invisible to other domains' guards.
  //
  // Matches BOTH forms: an earlier version used (?<![.\w$])blabCalGet\( , which does
  // not match window.blabCalGet( — the form all 19 real call sites use. It could not
  // have caught the regression it claimed to, and my inversion proof passed only
  // because I injected a bare call. A guard has to bite for the RIGHT reason.
  const code = phxStripComments(html);
  const n = (code.match(/(?:window\.)?blabCalGet\s*\(/g) || []).length;
  const MINE = 19;
  if (n === MINE) ok('CONTRACT: blabCalGet has only its ' + MINE + ' Training call sites');
  else bad(`CONTRACT: blabCalGet is invoked ${n}× in code, expected ${MINE} (all Training's). ` +
           `If you added one, update the count. If a peer added one, that is my internal storage ` +
           `shape — freezing {sessions, customs} blocks restructuring this domain. Route it ` +
           `through blabTrainingStateOn instead.`);
})();
has("out.state = done.length ? 'trained' : 'due';", 'CONTRACT: trained/due branch present (structural — behaviour in tests/training.mjs)');
has('out.blabDay = (lead && lead.blabDay != null) ? lead.blabDay : 0;', 'CONTRACT: blabDay zero-default present (structural — behaviour in tests/training.mjs)');

// THE CLOSED STATUS SET. Nutrition filters on `status`, treating anything that is not
// 'skipped' as a day that counts. So the set of values is itself the contract: adding
// a fourth — 'missed', 'deferred', anything meaning "did not happen" — would silently
// be read as a training day. This fails HERE when the set changes, which forces the
// conversation before it ships rather than after.
(() => {
  // Sentinels I OWN at BOTH ends, and a loud failure if either goes missing. The
  // previous version sliced a blind 34000 chars from the opening banner: if this block
  // ever shrinks, that window spills into whatever domain follows and picks up THEIR
  // status literals ('active', 'abandoned', 'locked' all exist elsewhere), failing my
  // closed-set assertion on someone else's perfectly good code.
  // Both sentinels are CODE I own, in comment-stripped source. The previous start
  // sentinel was the '// BLAB TRAINING CALENDAR' banner — a comment, so it vanishes
  // under stripping, and on raw text prose quoting it hijacked the window.
  const src = codeSrc();
  const start = src.indexOf('window.blabCalGet = function');
  const end = src.indexOf('window.blabTrainingStateOn = function', start + 1);
  if (start < 0 || end < 0 || end < start) {
    bad('CONTRACT: cannot locate the calendar block by its own code sentinels — the ' +
        'status-set check did NOT run. Fix the sentinels rather than leaving this silently green.');
    return;
  }
  const seg = src.slice(start, end);
  const found = new Set([...seg.matchAll(/status\s*[:=]+\s*'([a-z]+)'/g)].map(m => m[1]));
  const expected = ['completed', 'pending', 'skipped'];
  const actual = [...found].sort();
  if (actual.length === 3 && expected.every((v, n) => actual[n] === v)) {
    ok('CONTRACT: calendar status set is exactly pending/completed/skipped');
  } else {
    bad(`CONTRACT: calendar status values are now [${actual.join(', ')}], expected [${expected.join(', ')}]. ` +
        `Nutrition treats anything not 'skipped' as a day that counts, so a new value meaning ` +
        `"did not happen" would silently read as a training day. Tell Nutrition before adding one.`);
  }
})();
has("cat: 'REST'",                                  'CONTRACT: REST is the marker for a planned rest day');

// ── FAILED WRITES MUST BE VISIBLE (v4.9.238) ────────────────────────────────
// Rule 8. These reported to console.error and NOWHERE else, and console is invisible
// in the iOS PWA. Named individually rather than counted, so reverting ONE fails and
// says which — a bare count goes green again the moment a recorder call is added
// somewhere else entirely.
//
// NOTE for any future ratchet: the sweep that found these originally searched
// `console.warn` only. `console.error` is equally invisible on the phone, and it is
// where the three worst sites were. Cover BOTH or the ratchet is decorative.
(() => {
  const src = codeSrc();
  const need = [
    ["_phxRecordWriteError('supabaseLogSet',", 'every set Jon logs'],
    ["_phxRecordWriteError('supabaseLogSet.throw',", 'a set insert that rejects outright (offline/CORS) and never reached the .then at all'],
    ["_phxRecordWriteError('supabaseStartSession',", 'the session row every later set depends on'],
    ["_phxRecordWriteError('supabaseCompleteSession',", 'the completion, without which the session stays in_progress forever'],
    ["_phxRecordWriteError('blockRpe.update',", 'RPE, which decides whether the next session progresses the lift'],
  ];
  const missing = need.filter(([n]) => !src.includes(n));
  if (!missing.length) {
    ok(`WRITE: all ${need.length} core training write paths route failures to the diagnostic`);
  } else {
    missing.forEach(([n, why]) =>
      bad(`WRITE: ${n.match(/'([^']+)'/)[1]} no longer records to phx_last_write_error — ${why}. ` +
          'It would fail to console only, which Jon cannot see on his phone.'));
  }
})();

// ── THE REMAINING WRITE PATHS (v4.9.241) ────────────────────────────────────
// The sixteen held back from .238. No suppression flags anywhere: the helper coalesces
// by context, so a repeating path occupies one slot however often it fires. Named
// individually — a count would go green if someone deleted one and added another.
(() => {
  const src = codeSrc();
  const ctx = ['treadmill.insert','treadmill.photoUpload','treadmill.photo.throw',
               'treadmill.save.throw','walkHeartbeat','activeRecovery.throw',
               'resumeWalk.finish','resumeWalk.discard','resumeWalk.throw',
               'weekCustomMirror','weekCustomMirror.throw','adHocSessionMirror',
               'migrate.sessions','migrate.buildSetLogs.throw','migrate.setLogs','migrate.throw'];
  const missing = ctx.filter(c => !src.includes(`_phxRecordWriteError('${c}'`));
  if (!missing.length) ok(`WRITE16: all ${ctx.length} remaining training write paths record to the diagnostic`);
  else bad(`WRITE16: ${missing.length} write path(s) no longer record — ${missing.join(', ')}. ` +
           'Each is a session, walk or migration Jon loses with nothing on screen to say so.');
  // Coalescing is BY CONTEXT, so a duplicated name silently merges two unrelated
  // failures into one entry and each hides the other.
  if (new Set(ctx).size === ctx.length) ok('WRITE16: every context name is distinct, so none can mask another');
  else bad('WRITE16: duplicate context name — two different failures would coalesce into one entry.');
})();
// The bulk path reports MAGNITUDE, not just frequency. The ring collapses repetitions
// and cannot know each carried a different quantity: "x3" cannot say 1500 rows were lost.
hasCode('failed_chunks: _mFailedChunks', 'WRITE16: the migration records how much was lost, not only that it failed');

// ── WHERE TRAINING'S DATA LEAVES ────────────────────────────────────────────
// Peptides' question, applied to Training: not "is my sanitiser right" but "HOW MANY
// EXITS does this data have?" It had pinned that blood markers are stripped from the
// Supabase mirror, then found blood leaves by a second door it had never guarded.
//
// ENUMERATION, NOT REMOVAL. Sending training history to the advisor IS the feature.
// Nothing here closes a door. The sensitive fields are deliberately ON the pinned
// lists so the list DOCUMENTS that they leave — a new field, or a new caller, then
// fails until someone edits it knowingly.
//
// Training data reaches phoenix-coach.jon-d87.workers.dev — whose source is NOT in
// this repo and is owned by no chat here — through these doors:
//
//   _mcLoadRecentDataForContext   the aggregator. FOUR callers share it.
//   generateProgramme             buildAthleteProfile()
//   _phxBuildAIWarmup             athlete
//   _phxGenerateTodaySession      athlete + session context
//
// VERIFIED CLEAN, checked rather than assumed: _phxFetchAICore (:9481) sends only
// _phxBuildCorePrompt(fmt), a static template with no athlete data in it.
//
// The item worth Jon knowing about, and the Training analogue of Peptides' bloods:
// latest_checkin carries niggle_notes — free-text injury notes — and weight_kg. Those
// leave. That is not a bug; it is what makes the advice useful. It is pinned so it is
// a decision rather than an accident.
(() => {
  const src = codeSrc();
  const i = src.indexOf('async function _mcLoadRecentDataForContext()');
  if (i < 0) {
    bad('EXITS: cannot find _mcLoadRecentDataForContext — the exit enumeration DID NOT RUN.');
    return;
  }
  // The `out` initialiser is the declared shape of everything this aggregator hands out.
  const decl = src.slice(i, i + 600);
  // END-ANCHORED, not size-anchored (Nutrition's refinement, checked by truncation
  // rather than argued): the regex below requires the literal's CLOSING brace, so a
  // window that stops mid-literal cannot satisfy it and reports DID NOT RUN. Verified
  // by shrinking this to 120 — it failed loudly instead of pinning a partial list.
  const m = decl.match(/var out = \{([^}]*)\}/);
  if (!m) {
    bad('EXITS: found the aggregator but not its `out` initialiser — the field pin DID NOT RUN. ' +
        'Fix the parse rather than leaving this silently green.');
    return;
  }
  const fields = [...m[1].matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*:/g)].map(x => x[1]).sort();
  // FLOOR. A parse that finds two fields and passes is worse than no check — it reports
  // the exit as covered while having read almost none of it.
  if (fields.length < 7) {
    bad(`EXITS: parsed only ${fields.length} fields from the aggregator, expected >= 7. ` +
        'The pin DID NOT genuinely run.');
    return;
  }
  const expected = ['exerciseSummary','lastRpe','latestCheckin','recentSessions',
                    'recentSetLogs','total_volume_kg','weightTrend'].join(',');
  if (fields.join(',') === expected) {
    ok(`EXITS: the coach aggregator hands out exactly these ${fields.length} fields — incl. latestCheckin (niggle_notes, weight_kg) and recentSetLogs (notes)`);
  } else {
    bad(`EXITS: the coach aggregator's fields changed to [${fields.join(', ')}].\n` +
        `      Expected [${expected}].\n` +
        '      Something new now leaves to an external worker that is not in this repo. ' +
        'Confirm it is intended, tell the PM, then update this list.');
  }
})();
(() => {
  // The callers. Four share the aggregator; a fifth appearing is a new exit.
  const src = codeSrc();
  // Exclude the declaration itself — `async function _mcLoadRecentDataForContext()`
  // matches a bare-name regex too. My first version claimed it did not, counted 5, and
  // failed on correct code. A guard whose comment is wrong about its own mechanism is
  // the thing this whole exercise is about.
  const callers = (src.match(/(?<!function\s)_mcLoadRecentDataForContext\(\)/g) || []).length;
  if (callers === 4) ok('EXITS: exactly 4 callers of the coach aggregator, as enumerated');
  else bad(`EXITS: ${callers} callers of the coach aggregator, expected 4. A new one is a new ` +
           'door for set_logs, weekly_checkins and session details. Enumerate it before it ships.');
})();
hasCode("content:_phxBuildCorePrompt(fmt)",
        'EXITS: the core-session fetcher still sends only its static prompt — no athlete data on that door');

// ── KEYBOARD-SAFE SHEETS (v4.9.220) ─────────────────────────────────────────
// Structural pins only. Whether the sheet that OPENS is the sheet that gets ARMED is
// a behavioural question and lives in tests/training.mjs — the _blabCalEntryView case
// is the reason that distinction is written down rather than assumed.
(() => {
  const src = codeSrc();
  const start = src.indexOf('function _phxLibOverlay(id, z)');
  const end = src.indexOf('function _phxLibHeader', start + 1);
  if (start < 0 || end < 0 || end < start) {
    bad('KEYBOARD: cannot locate _phxLibOverlay by its own code sentinels — the arming ' +
        'check did NOT run. Fix the sentinels rather than leaving this silently green.');
    return;
  }
  const seg = src.slice(start, end);
  const arms = (seg.match(/_phxKeyboardSafe\(o\)/g) || []).length;
  if (arms === 1) {
    ok('KEYBOARD: the library-sheet factory arms exactly once — every PHX_LIB sheet inherits it');
  } else {
    bad(`KEYBOARD: _phxLibOverlay arms ${arms} times, expected exactly 1. Zero means the ` +
        'score-entry notes box sits under the keyboard again; more than one means double ' +
        'listeners, because the helper is NOT idempotent.');
  }
})();
hasCode('_phxKeyboardSafe(ov); } catch(_ke){}',
        'KEYBOARD: the custom session builder arms its own overlay (it bypasses the factory)');

// ── CUSTOM SESSION TEMPLATES (v4.9.215) ─────────────────────────────────────
(() => {
  // The bug was that templates were WRITTEN and never MIRRORED — the same shape as the
  // orphaned _bak nets. So this asserts the save path reaches blabSaveState, which is
  // the only thing that stamps _ts and sends to the cloud. A guard that merely found
  // 'customTemplates' in the file would have passed against a version that still wrote
  // to the private key and nowhere else.
  const src = codeSrc();
  const start = src.indexOf('function _phxSaveCustomTemplate');
  const end = src.indexOf('function openCustomSessionBuilder', start + 1);
  if (start < 0 || end < 0 || end < start) {
    bad('TEMPLATES: cannot locate the save/delete pair by their own code sentinels — the ' +
        'mirror check did NOT run. Fix the sentinels rather than leaving this silently green.');
    return;
  }
  const seg = src.slice(start, end);
  const saves = (seg.match(/window\.blabSaveState\(s\)/g) || []).length;
  if (saves >= 2) ok('TEMPLATES: save AND delete both route through blabSaveState — mirrored, not merely written');
  else bad(`TEMPLATES: only ${saves} of the two write paths reach blabSaveState. A template ` +
           'written without it is not stamped and not mirrored, so it dies on the next ' +
           'reinstall — which is the bug this replaced.');
})();
hasCode('s.customTemplates = legacy;',
        'TEMPLATES: existing local templates migrate IN rather than being replaced by an empty list');
hasCode('if(!legacy.length) return [];',
        'TEMPLATES: nothing to migrate does not re-stamp _ts (a fresh stamp would beat a newer cloud copy)');
hasNotCode("templates.push({id:Date.now(),",
        'TEMPLATES: the colliding bare Date.now() id is gone — two saved in one millisecond shared an id, and delete removed both');

// ── RESTORE SAFE LIST (v4.9.203) ────────────────────────────────────────────
(() => {
  // Every entry in _safeRestoreTabs must resolve to a REAL navTo target. Two did not:
  // 'workout' and 'settings' had no map entry and no branch, so the restore fired
  // navTo() into a silent no-op and Jon stayed on Today — while the list READ as
  // though training screens were covered.
  //
  // Derived from source at both ends rather than hard-coded, so this catches the next
  // stale entry for ANY domain rather than only the two I removed. Nutrition, records
  // and peptide all ride on this list too.
  const src = codeSrc();
  const listM = src.match(/_safeRestoreTabs\s*=\s*\[([^\]]*)\]/);
  const mapM  = src.match(/function navTo\(tab\)\{[\s\S]{0,4000}?var map=\{([\s\S]*?)\};/);
  if (!listM || !mapM) {
    bad('SAFELIST: could not locate _safeRestoreTabs or navTo\'s map in source — the ' +
        'check did NOT run. Fix the sentinels rather than leaving this silently green.');
    return;
  }
  const tabs = [...listM[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
  const targets = new Set([...mapM[1].matchAll(/'?([A-Za-z][A-Za-z-]*)'?\s*:/g)].map(m => m[1]));
  if (!tabs.length || targets.size < 5) {
    bad(`SAFELIST: parsed ${tabs.length} tabs and ${targets.size} navTo targets — that is ` +
        'too few to be real. The check did NOT run; fix the parse.');
    return;
  }
  const dead = tabs.filter(t => !targets.has(t));
  if (dead.length) {
    bad(`SAFELIST: [${dead.join(', ')}] in _safeRestoreTabs ${dead.length > 1 ? 'are' : 'is'} not a ` +
        'navTo target. The restore fires into a no-op and Jon stays on Today, while the list ' +
        'reads as though that screen is covered.');
  } else {
    ok(`SAFELIST: all ${tabs.length} restore tabs resolve to real navTo targets`);
  }
  // The specific regression: the calendar was written to the key but never restorable.
  if (tabs.includes('blab-calendar') && tabs.includes('programme')) {
    ok('SAFELIST: the training calendar is restorable after an iOS PWA reload');
  } else {
    bad('SAFELIST: programme/blab-calendar missing from _safeRestoreTabs — a screen lock ' +
        'on the training calendar drops Jon back to Today.');
  }
})();
// The repaint that makes the calendar safe AS a restore target. Without it a cloud
// restore landing while the calendar is on screen rehydrates the key and repaints
// nothing — the caller only refreshes Today.
hasCode("_cs.classList.contains('active') && typeof _blabCalRender === 'function'",
        'SAFELIST: cloud restore repaints the calendar when it is the live screen');
(() => {
  // blabCalSessionsOn must keep putting blabDay on BLAB entries. NOTE: as of their
  // v4.9.187 Nutrition no longer calls this — it reads blabCalGet directly, because
  // this one excludes completed work and so answered "is he due to train" when they
  // needed "did he train". The consumer here is now my own Today card, so this is an
  // internal pin, not a cross-domain contract. Kept because the Today card breaks
  // just as badly, but labelled honestly so the real dependency above is not assumed
  // covered by it.
  const src = codeSrc();
  const i = src.indexOf('window.blabCalSessionsOn = function');
  const seg = src.slice(i, i + 900);
  if (/cal\.sessions\.forEach[\s\S]{0,200}out\.push\(s\)/.test(seg)) ok('CONTRACT: BLAB entries pass through whole, so blabDay survives');
  else bad('CONTRACT: blabCalSessionsOn no longer passes BLAB entries through intact — blabDay may be gone, and Nutrition names the training day from it');
})();

// ── Backup recovery: the net had no path (v4.9.196) ─────────────────────────
// blab_v1_{uid}_bak was written and read by NOTHING, while a comment called it
// "kept one generation" — which reads as recoverable. An untested net at least
// exists; an unreachable one is a claim. Behaviour is in tests/training.mjs,
// including through the real Adjust Programme screen, because reachability WAS the
// bug and a function-level test cannot see it.
console.log('\nBackup recovery:');
hasCode('window.blabBackupInfo = function',    'BACKUP: describe-what-is-held present (structural — behaviour in tests/training.mjs)');
hasCode('window.blabRestoreBackup = function', 'BACKUP: recovery present (structural — behaviour in tests/training.mjs)');
hasCode("localStorage.setItem(key + '_bak', cur)", 'BACKUP: swap keeps the replaced copy (structural — behaviour in tests/training.mjs)');
hasCode('data-act="recover"',                  'BACKUP: the offer is wired into Adjust Programme');
// The whole failure was a written-but-unread key. Pin that it is now READ.
(() => {
  const code = codeSrc();
  const reads = (code.match(/getItem\('blab_v1_'\s*\+\s*uid\s*\+\s*'_bak'\)/g) || []).length;
  if (reads >= 1) ok('BACKUP: the _bak key is actually READ, not just written');
  else bad('BACKUP: nothing reads blab_v1_{uid}_bak — the backup is a claim again. ' +
           'Bytes being written is not recoverability; there must be a path Jon can reach.');
})();

// ── Label scanner ───────────────────────────────────────────────────────────
hasCode('function _nutLabelToPer100(', 'LABEL: the basis rule exists as a pure, testable function');
hasCode('function nutOpenLabelScanner(', 'LABEL: the scanner sheet exists');
hasCode('data-nut-fp-scan',             'LABEL: and the food picker offers it');

// The refusal is the feature. A label that says "per serving (2 biscuits)" cannot
// be converted at all, and assuming 100g there is silently wrong forever.
hasCode("reason: 'serving_size_missing'", 'LABEL: per-serving without grams is REFUSED, not assumed');
hasCode("reason: 'basis_unknown'",        'LABEL: an unstated basis is REFUSED, not defaulted to per-100g');

// A downscaled label photo is 200-400KB against a ~5MB localStorage budget shared
// with every recipe and day log. Persisting a few would evict all of it, and Jon
// would experience that as "my recipes vanished".
(() => {
  const code = codeSrc();
  const m = /function nutOpenLabelScanner\(([\s\S]*?)\n\}/.exec(code);
  if (!m) { bad('LABEL: could not isolate nutOpenLabelScanner — guard below is vacuous'); return; }
  const body = m[1];
  // Floor. A regex that matches a SHORT wrong span (a .map callback, an inner
  // closure) does not fail — it silently pins a few lines and reports success.
  // A length floor alone is NOT enough here — proven: truncating the match at the
  // first closing brace still yields 3000+ chars, clears any sane floor, and
  // contains no exits, so the guard would report success having read a third of
  // the function. Anchor on a string that exists only in the LAST block instead.
  if (body.indexOf('custom_foods.push') < 0) { bad('LABEL: the isolated span does not reach the save handler — the match is wrong, not the code'); return; }
  if (/_nutLabelPhoto/.test(body)) ok('LABEL: the sheet holds the photo in memory while Jon reads it');
  else bad('LABEL: the photo variable vanished from the sheet');
  // Reading it to draw the <img> is the whole point, and clearing it on close is
  // hygiene. The bug is it ENTERING the saved object, so match an assignment into
  // ns/food whose value is the photo — not mere proximity to a save.
  if (/(?:ns\.|food\s*[=:]|[\w_]+\s*:)\s*_nutLabelPhoto\b/.test(body) ||
      /_nutLabelPhoto\s*[,}]/.test(body))
    bad('LABEL: a label PHOTO is being written into nutrition state — a few of these ' +
        'evict every recipe and day log, and it presents as data loss, not as a storage bug');
  else ok('LABEL: no label photo is written into nutrition state');
})();

// ── Recipe builder: creating an ingredient that is not in the library ──────
// Jon's report (v4.9.247): the recipe builder has its OWN picker, and it could
// only SELECT. Any ingredient not already in the library made the recipe
// unbuildable, and a filter matching nothing left the sheet with no exit but close.
hasCode('data-fpr-scan',   'RECIPE: the ingredient picker offers a label scan');
hasCode('data-fpr-custom', 'RECIPE: and a manual custom food');
// Both must hand the food BACK. Logging a recipe ingredient to today's lunch is
// the failure this design exists to avoid - writing a recipe is not eating it.
hasCode('nutOpenLabelScanner(null, null, toRecipe)',   'RECIPE: a scan from a recipe hands the food back, it does not log a meal');
hasCode('nutOpenCustomFoodModal(null, null, toRecipe)','RECIPE: and so does a custom food');

// ── Label scanner: HOW MANY EXITS does the photo have? ──────────────────────
// Peptides' question, answered while the feature is being designed rather than
// pinned afterwards. Today the answer is ZERO: the scanner is manual-first, so the
// photo is read by a FileReader, downscaled in the browser, drawn into an <img>,
// and dropped. It never touches the network and it never touches disk.
//
// That is worth ASSERTING rather than merely being true, because it is exactly the
// kind of property that stops being true quietly. When extraction is switched on,
// this guard fails — and whoever switches it on has to come here, state the exit,
// and list the payload's fields on purpose. The decision already taken, so it is
// not re-litigated under time pressure: the extraction call sends THE IMAGE AND
// NOTHING ELSE. No targets, no weight, no meal history, no recipes. Reading a
// printed label needs the label.
(() => {
  const code = codeSrc();
  const m = /function nutOpenLabelScanner\(([\s\S]*?)\n\}/.exec(code);
  if (!m) { bad('LABEL/EXIT: could not isolate nutOpenLabelScanner — every check below would be vacuous'); return; }
  const body = m[1];
  // A length floor alone is NOT enough here — proven: truncating the match at the
  // first closing brace still yields 3000+ chars, clears any sane floor, and
  // contains no exits, so the guard would report success having read a third of
  // the function. Anchor on a string that exists only in the LAST block instead.
  if (body.indexOf('custom_foods.push') < 0) { bad('LABEL/EXIT: the isolated span does not reach the save handler — the match is wrong, not the code'); return; }

  const exits = [];
  if (/\bfetch\s*\(/.test(body))            exits.push('fetch');
  if (/XMLHttpRequest/.test(body))            exits.push('XMLHttpRequest');
  if (/sendBeacon/.test(body))                exits.push('sendBeacon');
  if (/workers\.dev|phoenix-coach/.test(body)) exits.push('coach worker');
  if (/supabase|\.from\(/.test(body))         exits.push('supabase');

  if (exits.length === 0) ok('LABEL/EXIT: the label photo has ZERO exits — it never leaves the device');
  else bad('LABEL/EXIT: the scanner now sends data out via ' + exits.join(', ') +
           '. That may be correct, but it must be DECLARED: list the payload fields ' +
           'here on purpose, including the sensitive ones, so the list documents ' +
           'what leaves rather than hiding it.');
})();

// ── Keyboard safety, as a CONDITIONAL PAIR rather than a list ───────────────
// v4.9.227. Peptides' framing, and it is better than the one I shipped in .225.
// Two rules, neither implying the other:
//     has a typed field  ->  must be armed
//     is armed           ->  must not measure in vh
// An UNARMED vh cap is perfectly correct — nothing resizes its overlay — so a
// blanket "no vh" ban sends you fixing things that are fine. Only the COMBINATION
// is the bug.
//
// Enumerated MECHANICALLY, because my .225 test drove a hand-written list of ten
// openers. That is the exact shape Peptides caught in itself: a guard that reads
// like coverage but silently omits the sheet you add tomorrow. The scanner's sheet
// is covered by this before it exists. Scoped to the nut/_nut prefix — my domain's
// names — so it can never speak about another domain's markup.
(() => {
  const code = codeSrc();
  const fnRe = /\bfunction\s+(_?nut[A-Za-z0-9_]*)\s*\(/g;
  const sheets = [];
  let m;
  while ((m = fnRe.exec(code)) !== null) {
    let d = 0, started = false, end = code.length;
    for (let k = m.index; k < code.length; k++) {
      const ch = code[k];
      if (ch === '{') { d++; started = true; }
      else if (ch === '}') { d--; if (started && d === 0) { end = k; break; } }
    }
    const body = code.slice(m.index, end + 1);
    // A "sheet" is a function that builds an overlay and puts it on the page.
    if (!/appendChild\(\s*ov\s*\)/.test(body)) continue;
    sheets.push({
      name:  m[1],
      armed: /_(?:nut|phx)KeyboardSafe\s*\(/.test(body),
      vh:    (/max-height:\s*(\d+)vh/.exec(body) || [null])[0],
      typed: /<(?:input|textarea)\b/.test(body),
    });
  }

  if (sheets.length < 10) {
    bad(`KEYBOARD: only found ${sheets.length} nutrition sheets — the enumeration broke, ` +
        'which would make every assertion below vacuously true');
    return;
  }
  ok(`KEYBOARD: enumerated ${sheets.length} nutrition sheets mechanically (no hand-written list)`);

  const unarmed = sheets.filter(s => s.typed && !s.armed);
  if (unarmed.length === 0) ok('KEYBOARD: every nutrition sheet with a typed field is armed');
  else bad('KEYBOARD: ' + unarmed.map(s => s.name).join(', ') +
           ' take typed input but are not armed — the keyboard will cover the field');

  const bothWays = sheets.filter(s => s.armed && s.vh);
  if (bothWays.length === 0) ok('KEYBOARD: no armed nutrition sheet caps its panel in vh');
  else bad('KEYBOARD: ' + bothWays.map(s => `${s.name} (${s.vh})`).join(', ') +
           ' are armed AND capped in vh — the panel will not shrink with the overlay, ' +
           'so the overflow goes off the TOP of the screen, hiding the inputs while ' +
           'leaving the save button visible');

  const armedCount = sheets.filter(s => s.armed).length;
  if (armedCount >= 10) ok(`KEYBOARD: ${armedCount} nutrition sheets armed`);
  else bad(`KEYBOARD: only ${armedCount} armed — sheets lost their arming`);
})();

console.log(`\n${fail === 0 ? '\x1b[32mPASS' : '\x1b[31mFAIL'}\x1b[0m — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
