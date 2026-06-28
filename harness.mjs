#!/usr/bin/env node
// Phoenix node harness — static validation of the single-file PWA.
// 1. Syntax-checks every inline <script> block via vm (compile, no execute).
// 2. Asserts the v4.9.103 session-library feature is present and wired.
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
console.log('\nFeature check — v4.9.103 session library:');
const has = (needle, label) => html.includes(needle) ? ok(label) : bad(`MISSING: ${label}`);

has("var APP_VERSION='4.9.103'", 'version bumped to 4.9.103');
has('onclick="_phxOpenSessionLibrary()"', 'Add Session button wired to library');
has('window.PHX_WOD_LIBRARY', 'WOD library defined');
has('window.PHX_CORE_LIBRARY', 'Core library defined');
has('window._phxOpenSessionLibrary', 'category picker (WOD/Core) defined');
has('window._phxOpenLibraryList', 'session list step defined');
has('window._phxOpenLibrarySession', 'session detail step defined');
has('window._phxLibStartSession', 'Start handler defined');
has('window._phxLibCompleteSession', 'Complete handler defined');

// Content of the libraries — confirm the three WOD + three Core sessions exist.
['AMRAP 20', 'EMOM 12', 'The Chipper'].forEach(n => has("name: '" + n + "'", 'WOD: ' + n));
['Anti-Rotation Circuit', 'Loaded Strength', 'Rotational Power'].forEach(n => has("name: '" + n + "'", 'Core: ' + n));

// Spot-check a few prescribed movements/reps.
[['Air Squats', "15"], ['Kettlebell Swings', "10"], ['Wall Balls', "40"],
 ['Ab Wheel Rollout', '4'], ['Pallof Press', '10 each side']].forEach(([nm]) =>
  has("name: '" + nm + "'", 'movement present: ' + nm));

console.log(`\n${fail === 0 ? '\x1b[32mPASS' : '\x1b[31mFAIL'}\x1b[0m — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
