#!/usr/bin/env node
// ── PHOENIX BOARD ────────────────────────────────────────────────────────────
// Derives current state. Holds nothing.
//
//   node board_check.mjs           the board
//   node board_check.mjs <text>    did anything ship mentioning <text>?
//
// WHY THIS EXISTS. A chat's memory has no staleness signal — nothing announces
// that it has drifted. The PM's board reported Training's paired wall balls and
// keyboard sheets as OPEN hours after both had shipped, and was corrected only
// because a peer happened to mention one while reporting something else.
//
// RULES THIS OBEYS, each of which cost a real error here:
//   · reads origin/main, never the working tree — worktrees sit on whatever was
//     last checked out and will report files missing that exist
//   · fetches first; a stale ref makes every line below it a lie
//   · prints names and presence, never secret values
//   · read-only throughout
//   · reports on its OWN staleness — see the OPEN ITEMS block
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, statSync } from 'node:fs';

const g = (...a) => { try { return execFileSync('git', a, { encoding: 'utf8', maxBuffer: 64*1024*1024 }); } catch (e) { return ''; } };
const line = (s='') => console.log(s);

try { execFileSync('git', ['fetch', '-q', 'origin'], { stdio: 'ignore' }); }
catch { line('!! FETCH FAILED — every figure below may be stale. Fix this before trusting it.'); }

const log = g('log', 'origin/main', '--format=%h\t%ad\t%s', '--date=format:%d %b %H:%M', '-80').trim().split('\n').filter(Boolean);

// ── search mode ──────────────────────────────────────────────────────────────
const q = process.argv.slice(2).join(' ').toLowerCase();
if (q) {
  const hits = log.filter(l => l.toLowerCase().includes(q));
  line(hits.length ? `SHIPPED — "${q}" appears in ${hits.length} of the last ${log.length} commits:`
                   : `NOT FOUND in the last ${log.length} commits on origin/main — "${q}" has not shipped, or is worded differently.`);
  hits.forEach(h => line('  ' + h));
  process.exit(0);
}

const ver = src => (src.match(/APP_VERSION='([\d.]+)'/) || [])[1] || '???';
const originVer = ver(g('show', 'origin/main:index.html'));

line('════════════════════════════════════════════════════════════════');
line(`  PHOENIX BOARD — derived ${new Date().toLocaleString()}`);
line('════════════════════════════════════════════════════════════════');
line();
line(`origin/main   ${(log[0]||'').split('\t')[0]}   APP_VERSION ${originVer}`);

// ── checkouts: the main tree and every worktree ──────────────────────────────
// Matching the instrument to the tense: "did it ship" is the merged diff, "is it
// dirty" is the working tree. Both are shown because they answer different questions.
line();
line('CHECKOUTS');
const wt = g('worktree', 'list', '--porcelain').split('\n\n').filter(Boolean);
if (!wt.length) line('  !! git worktree list returned nothing — is .git intact?');
for (const block of wt) {
  const p = (block.match(/^worktree (.+)$/m) || [])[1];
  if (!p) continue;
  const name = p.split('/').pop();
  const branch = (block.match(/^branch (.+)$/m) || [])[1] || (/detached/.test(block) ? 'detached' : '???');
  const dirty = g('-C', p, 'status', '--short').trim();
  const n = dirty ? dirty.split('\n').length : 0;
  const v = existsSync(`${p}/index.html`) ? ver(readFileSync(`${p}/index.html`, 'utf8')) : '???';
  const behind = v !== originVer ? `  BEHIND origin (${v})` : '';
  line(`  ${name.padEnd(12)} ${branch.replace('refs/heads/','').padEnd(10)} ${n ? n + ' uncommitted' : 'clean'}${behind}`);
  if (n) dirty.split('\n').slice(0, 4).forEach(d => line(`      ${d.trim()}`));
}

// ── what shipped, per domain ─────────────────────────────────────────────────
line();
line('SHIPPED (last 80 commits, newest first)');
for (const d of ['PM', 'TRAINING', 'NUTRITION', 'PEPTIDES']) {
  const rows = log.filter(l => l.toUpperCase().includes(`[${d}]`)).slice(0, 4);
  line(`  ${d}:`);
  rows.forEach(r => line('    ' + r));
  if (!rows.length) line('    (nothing in the last 80 commits)');
}

// ── OPEN ITEMS, and this board's own staleness ───────────────────────────────
// A version number agreeing is not a record agreeing. The unarguable measure is
// commits-since-last-write; nobody can define a "content gap", so this measures
// something plain and lets the reader judge.
line();
line('OPEN ITEMS');
if (!existsSync('OPEN_ITEMS.md')) {
  line('  !! OPEN_ITEMS.md is MISSING — open threads are being held in someone\'s context.');
} else {
  const txt = readFileSync('OPEN_ITEMS.md', 'utf8');
  const lastTouch = g('log', 'origin/main', '-1', '--format=%h %ad', '--date=format:%d %b %H:%M', '--', 'OPEN_ITEMS.md').trim();
  const since = lastTouch ? g('rev-list', '--count', `${lastTouch.split(' ')[0]}..origin/main`).trim() : '???';
  const open = (txt.match(/^- \[ \]/gm) || []).length;
  const gaps = (txt.match(/\?\?\?/g) || []).length;
  const lines = txt.split('\n').length;
  line(`  ${open} open · ${gaps} marked unknown (???) · ${lines} lines`);
  line(`  last WRITTEN ${lastTouch || '(never on origin)'} — ${since} commits since`);
  if (Number(since) > 12) line(`  ⚠ ${since} COMMITS SINCE THIS WAS WRITTEN. Read it as possibly behind the board above.`);
  if (lines > 300) line(`  ⚠ ${lines} lines — past the 300-line budget. Archive resolved threads rather than accumulating.`);
  (txt.match(/^- \[ \] .*/gm) || []).slice(0, 8).forEach(t => line('    ' + t.slice(0, 100)));
}

line();
line('────────────────────────────────────────────────────────────────');
line('Source of truth is the repo, the live app and Supabase. Not this');
line('script, not any chat. If a figure here disagrees with something a');
line('chat told you — including the PM — THE CHAT IS WRONG.');
line('Gates are not run here: node runtime_check.mjs && node harness.mjs && node functional_check.mjs');
