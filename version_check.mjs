#!/usr/bin/env node
// PHOENIX VERSION CHECK — [PM], added 2026-08-21 after v4.9.182 shipped TWICE.
//
// The other three gates read index.html only, so they cannot see that the version you are
// about to ship was already used by the commit you just rebased onto. That is exactly what
// happened: 452c34f [NUTRITION] and 8ea40d2 [PEPTIDES] both set APP_VERSION to 4.9.182.
// Mechanism, established afterwards and NOT what it looks like: there was no merge conflict.
// Both commits changed the same line .181 -> .182, git takes byte-identical edits silently,
// the rebase reported success, and re-reading the file showed the author's exact intent.
// Every signal available in the working tree said correct. Hence a gate that reads elsewhere.
// Jon reads that number to confirm the PWA updated (CLAUDE.md rule 7); two builds sharing
// it defeats his only check.
//
// This is git-aware by necessity. It NEVER passes silently when it cannot do its job — if
// the base ref is missing it exits 2 and says so, because a gate that skips quietly is the
// class of fake-green this project has spent a lot of effort removing.
//
// Usage:  node version_check.mjs [base-ref]      (default origin/main)
// RUN IT UNPIPED — `node version_check.mjs | tail` reports tail's exit status, not this
// tool's. Most likely of the four gates to be piped, because its output is a single line.
// Exit 0 = your APP_VERSION is strictly ahead of the base. 1 = collision. 2 = cannot check.

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const base = process.argv[2] || 'origin/main';
const parse = (src, where) => {
  const m = src.match(/APP_VERSION='(\d+)\.(\d+)\.(\d+)'/);
  if (!m) throw new Error(`no APP_VERSION found in ${where}`);
  return { text: `${m[1]}.${m[2]}.${m[3]}`, n: Number(m[3]), major: `${m[1]}.${m[2]}` };
};

// Only enforce when there is something to ship. A gate that goes red on every idle,
// rebased tree — the normal resting state between tasks — teaches everyone that a red
// version_check means "just the idle false positive", which is how the real collision then
// gets waved through. Raised independently by Nutrition and Peptides, 2026-08-21.
// The wording below is deliberate: "nothing to compare" must read as DID NOT APPLY, never
// as verified. Fixing a false positive by printing a reassuring green is the same fake-green
// this gate exists to avoid, arrived at from the opposite direction.
let ahead = null;
try {
  ahead = Number(execFileSync('git', ['rev-list', '--count', `${base}..HEAD`], { encoding: 'utf8' }).trim());
} catch { /* not a git dir, or base unresolvable — fall through to the read below, which reports it */ }
if (ahead === 0) {
  console.log(`VERSION CHECK: nothing to compare — no commits ahead of ${base}. This check DID NOT RUN.`);
  console.log(`(It applies at push time, after your commit. An idle rebased tree has nothing to ship.)`);
  process.exit(0);
}
// Second false positive, found by using the tool on a docs/tooling commit: APP_VERSION only
// needs to move when index.html ships. A commit touching only harness/tests/docs legitimately
// leaves it alone, and demanding a bump there would force churn in the number Jon reads.
if (ahead !== null) {
  let touched = '';
  try {
    touched = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { encoding: 'utf8' });
  } catch { touched = 'index.html'; /* cannot tell — assume it matters and check properly */ }
  if (!touched.split('\n').some(f => f.trim() === 'index.html')) {
    console.log(`VERSION CHECK: nothing to compare — no commit ahead of ${base} touches index.html.`);
    console.log(`(APP_VERSION only moves when index.html ships. This check DID NOT RUN.)`);
    process.exit(0);
  }
}

let mine, theirs;
try {
  // v4.9.225: read what will actually be PUSHED, not the working tree. Peptides shipped
  // .221 with a commit message saying 4.9.221 and a committed index.html saying 4.9.220 —
  // the edits sat unstaged after a `git commit --amend -F msg.txt` (which amends the message
  // and stages nothing). This gate then printed "CLEAN — 4.9.221 is ahead of 4.9.220" about
  // a file that was not in the commit, and two trees shipped as 4.9.220. Its words:
  // "a gate that validates a different artefact from the one you ship is not a gate, it is
  // a second opinion about your intentions."
  const headSrc = execFileSync('git', ['show', 'HEAD:index.html'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  mine = parse(headSrc, 'HEAD (the commit you are about to push)');
  // And say so loudly when the working tree disagrees — those edits are NOT shipping.
  try {
    const wt = parse(readFileSync(new URL('./index.html', import.meta.url), 'utf8'), 'working tree');
    if (wt.text !== mine.text) {
      console.error(`VERSION CHECK FAILED — your working tree says ${wt.text} but the COMMIT says ${mine.text}.`);
      console.error(`Unstaged or unamended edits are not in the commit. Stage them (git add index.html) and amend. DO NOT PUSH.`);
      process.exit(1);
    }
  } catch { /* unreadable working tree is not this gate's problem; HEAD is authoritative */ }
} catch (e) {
  console.error(`VERSION CHECK CANNOT RUN — ${e.message}`);
  process.exit(2);
}
try {
  const src = execFileSync('git', ['show', `${base}:index.html`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  theirs = parse(src, base);
} catch {
  console.error(`VERSION CHECK CANNOT RUN — could not read index.html at '${base}'.`);
  console.error(`Run 'git fetch origin' first, or pass a base ref explicitly. NOT treating this as a pass.`);
  process.exit(2);
}

if (mine.major !== theirs.major) {
  console.log(`VERSION CHECK: major/minor differs (${mine.text} vs ${theirs.text} at ${base}) — nothing to compare, treating as intentional.`);
  process.exit(0);
}
if (mine.n > theirs.n) {
  // Training, .195: a rebase that resolves APP_VERSION leaves the commit SUBJECT saying the
  // old number — a record Jon reads, claiming something the build does not. Same correction
  // as APP_VERSION and the in-file labels, and mechanical, so it is checked rather than
  // remembered. Only warns: a subject may legitimately omit a version (docs/tooling commits).
  try {
    const subject = execFileSync('git', ['log', '-1', '--format=%s'], { encoding: 'utf8' }).trim();
    const claimed = (subject.match(/v(\d+)\.(\d+)\.(\d+)/) || [])[0];
    if (claimed && claimed !== 'v' + mine.text) {
      console.error(`VERSION CHECK FAILED — your commit SUBJECT says ${claimed} but APP_VERSION is ${mine.text}.`);
      console.error(`Amend the subject (git commit --amend) so the log matches the build. DO NOT PUSH.`);
      process.exit(1);
    }
  } catch { /* not a git dir, or no commit yet — the version comparison above still stands */ }
  console.log(`VERSION CHECK CLEAN — ${mine.text} is ahead of ${theirs.text} at ${base}`);
  process.exit(0);
}
console.error(`VERSION COLLISION — you are shipping ${mine.text} but ${base} is already at ${theirs.text}.`);
console.error(`Set APP_VERSION to 4.9.${theirs.n + 1}, sync the harness assertion, re-run the gates, amend. DO NOT PUSH.`);
process.exit(1);
