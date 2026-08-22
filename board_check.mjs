#!/usr/bin/env node
// PM board check. A stale board has no catching mechanism — Training's v4.9.223 sat on it as
// "open" for hours and was corrected only because Training happened to re-read it while
// reporting something else. Derive the board from git instead of carrying it in context.
//   node board_check.mjs            what shipped, per domain, newest first
//   node board_check.mjs <text>      did anything ship mentioning <text>?
import { execFileSync } from 'node:child_process';
const g = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
g('fetch', '-q', 'origin');
const log = g('log', 'origin/main', '--format=%h\t%ad\t%s', '--date=format:%d %b %H:%M', '-60').trim().split('\n');
const q = process.argv.slice(2).join(' ').toLowerCase();
if (q) {
  const hits = log.filter(l => l.toLowerCase().includes(q));
  console.log(hits.length ? `SHIPPED — "${q}" appears in ${hits.length} commit(s):` : `NOT FOUND on origin/main — "${q}" has not shipped (or is worded differently).`);
  hits.forEach(h => console.log('  ' + h));
  process.exit(0);
}
const head = g('show', 'origin/main:index.html').match(/APP_VERSION='([\d.]+)'/)[1];
console.log(`origin/main APP_VERSION ${head}\n`);
for (const d of ['TRAINING', 'NUTRITION', 'PEPTIDES', 'PM']) {
  const rows = log.filter(l => l.toUpperCase().includes(`[${d}]`)).slice(0, 5);
  console.log(`${d}:`);
  rows.forEach(r => console.log('  ' + r));
  if (!rows.length) console.log('  (nothing in the last 60 commits)');
}
