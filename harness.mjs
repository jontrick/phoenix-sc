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

has("var APP_VERSION='4.9.105'", 'version is 4.9.105');

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
has("ex.prev_wt_a?'<div style=\"font-size:11px;font-weight:700;color:var(--gold)", 'superset renderer shows Prev A weight (gold)');
has("ex.prev_wt_b?'<div style=\"font-size:11px;font-weight:700;color:var(--gold)", 'superset renderer shows Prev B weight (gold)');
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

console.log(`\n${fail === 0 ? '\x1b[32mPASS' : '\x1b[31mFAIL'}\x1b[0m — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
