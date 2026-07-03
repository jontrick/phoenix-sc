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

has("var APP_VERSION='4.9.104'", 'version is 4.9.104');

// v4.9.104: blabToPhoenixSession must carry prev_best fields onto the mapped phxEx
// object, otherwise the renderers (which read ex.prev_best) show a blank banner.
has('phxEx.prev_best = ex.prev_best || 0', 'mapper carries prev_best onto phxEx (afap + max-reps)');
has('phxEx.prev_best_wt = ex.prev_best_wt || 0', 'mapper carries prev_best_wt onto phxEx (max-reps)');

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
