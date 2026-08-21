#!/usr/bin/env node
// PHOENIX VERSION CHECK — [PM], added 2026-08-21 after v4.9.182 shipped TWICE.
//
// The other three gates read index.html only, so they cannot see that the version you are
// about to ship was already used by the commit you just rebased onto. That is exactly what
// happened: 452c34f [NUTRITION] and 8ea40d2 [PEPTIDES] both set APP_VERSION to 4.9.182.
// Jon reads that number to confirm the PWA updated (CLAUDE.md rule 7); two builds sharing
// it defeats his only check.
//
// This is git-aware by necessity. It NEVER passes silently when it cannot do its job — if
// the base ref is missing it exits 2 and says so, because a gate that skips quietly is the
// class of fake-green this project has spent a lot of effort removing.
//
// Usage:  node version_check.mjs [base-ref]      (default origin/main)
// Exit 0 = your APP_VERSION is strictly ahead of the base. 1 = collision. 2 = cannot check.

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const base = process.argv[2] || 'origin/main';
const parse = (src, where) => {
  const m = src.match(/APP_VERSION='(\d+)\.(\d+)\.(\d+)'/);
  if (!m) throw new Error(`no APP_VERSION found in ${where}`);
  return { text: `${m[1]}.${m[2]}.${m[3]}`, n: Number(m[3]), major: `${m[1]}.${m[2]}` };
};

let mine, theirs;
try {
  mine = parse(readFileSync(new URL('./index.html', import.meta.url), 'utf8'), 'working tree');
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
  console.log(`VERSION CHECK CLEAN — ${mine.text} is ahead of ${theirs.text} at ${base}`);
  process.exit(0);
}
console.error(`VERSION COLLISION — you are shipping ${mine.text} but ${base} is already at ${theirs.text}.`);
console.error(`Set APP_VERSION to 4.9.${theirs.n + 1}, sync the harness assertion, re-run the gates, amend. DO NOT PUSH.`);
process.exit(1);
