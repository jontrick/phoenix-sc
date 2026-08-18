#!/usr/bin/env node
// PHOENIX FUNCTIONAL CHECK — v4.9.156
// Calls the app's real functions with real data and asserts what they return.
//
// WHY THIS EXISTS, alongside runtime_check.mjs and harness.mjs:
//   runtime_check.mjs  proves every block parses and its TOP LEVEL runs.
//                      It never calls a function body. A bug inside a callback
//                      passes it cleanly — that is how the peptide cloud mirror
//                      stayed broken for 12 versions.
//   harness.mjs        greps index.html for expected source strings. Proves code
//                      is PRESENT, not that it BEHAVES.
//   functional_check   loads the whole app into one sandbox and actually invokes
//                      pepRestoreFromCloud(), _pepCloudPayload() and friends.
//
// Usage:
//   node functional_check.mjs               run every tests/*.mjs
//   node functional_check.mjs peptides      run only tests/peptides.mjs
// Exit 0 = all passed. Exit 1 = a failure. Exit 2 = could not run.
//
// NOTE ON EXIT CODES: piping this (`| tail`) replaces $? with the pipe's exit
// code. Check the tool's own status, or do not pipe.
//
// ── WRITING TESTS ────────────────────────────────────────────────────────────
// One file per domain in tests/ — tests/peptides.mjs, tests/nutrition.mjs, …
// Each default-exports a function that receives one object:
//
//   export default function ({ test, assert, app, signIn, seed, read, reset }) {
//     test('cloud restores onto a fresh install', () => {
//       signIn('user-1');                        // sets currentSession
//       seed('peptide_v1_user-1', null);         // clear this key
//       app.pepRestoreFromCloud({ peptide_state: { stacks: [1], _ts: '...' } });
//       assert.equal(read('peptide_v1_user-1').stacks.length, 1, 'protocol restored');
//     });
//   }
//
//   app     the loaded application — every top-level `function` and `var` in
//           index.html is a property on it (`let`/`const` are not, by JS rules)
//   test    test(name, fn) — fn throwing marks a failure, everything else runs
//   assert  .ok .equal .deepEqual .notIncludes .throws  (all take a message)
//   signIn  signIn(uid) sets currentSession; signIn(null) signs out
//   seed    seed(key, value) writes localStorage (object → JSON, null → remove)
//   read    read(key) returns the parsed value, or the raw string if not JSON
//   reset   reset() empties localStorage
//
// Each test file gets a FRESH sandbox, so one domain cannot corrupt another.

import { readdirSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { createSandbox, loadBlocks, runBlocks } from './runtime_check.mjs';

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const TESTS_DIR = path.join(ROOT, 'tests');
const only = process.argv[2] || null;

const GREEN = '\x1b[32m', RED = '\x1b[31m', DIM = '\x1b[2m', OFF = '\x1b[0m';

if (!existsSync(TESTS_DIR)) {
  console.error(`FUNCTIONAL CHECK: no tests/ directory at ${TESTS_DIR}`);
  process.exit(2);
}
let files = readdirSync(TESTS_DIR).filter(f => f.endsWith('.mjs')).sort();
if (only) files = files.filter(f => f === `${only}.mjs` || f === only);
if (!files.length) {
  console.error(`FUNCTIONAL CHECK: no test files${only ? ` matching "${only}"` : ''} in tests/`);
  process.exit(2);
}

// ── assertions ───────────────────────────────────────────────────────────────
const fmt = v => { try { return JSON.stringify(v); } catch { return String(v); } };
const assert = {
  ok(value, msg) {
    if (!value) throw new Error(`${msg || 'expected truthy'} — got ${fmt(value)}`);
  },
  equal(actual, expected, msg) {
    if (actual !== expected) throw new Error(`${msg || 'not equal'} — got ${fmt(actual)}, want ${fmt(expected)}`);
  },
  deepEqual(actual, expected, msg) {
    const a = fmt(actual), b = fmt(expected);
    if (a !== b) throw new Error(`${msg || 'not deep-equal'}\n      got  ${a}\n      want ${b}`);
  },
  notIncludes(haystack, needle, msg) {
    const s = typeof haystack === 'string' ? haystack : fmt(haystack);
    if (s.includes(needle)) throw new Error(`${msg || 'should not contain'} — found ${fmt(needle)}`);
  },
  throws(fn, msg) {
    let threw = false;
    try { fn(); } catch { threw = true; }
    if (!threw) throw new Error(msg || 'expected a throw, got none');
  },
};

// ── run one domain file against its own freshly loaded app ───────────────────
let totalPass = 0, totalFail = 0;
const failures = [];

for (const file of files) {
  const domain = file.replace(/\.mjs$/, '');
  process.stdout.write(`\n${domain}\n`);

  let mod;
  try {
    mod = await import(pathToFileURL(path.join(TESTS_DIR, file)).href);
  } catch (e) {
    totalFail++; failures.push(`${domain}: could not import — ${e.message}`);
    console.log(`  ${RED}✗${OFF} could not import test file — ${e.message}`);
    continue;
  }
  if (typeof mod.default !== 'function') {
    totalFail++; failures.push(`${domain}: no default-exported function`);
    console.log(`  ${RED}✗${OFF} test file must default-export a function`);
    continue;
  }

  const app = createSandbox();
  // The app logs freely ([PHX] …). That noise would bury the test results, so the
  // sandbox gets a silent console. The runner prints through Node's real console.
  const silent = () => {};
  app.console = { log: silent, warn: silent, error: silent, info: silent, debug: silent, trace: silent, table: silent, group: silent, groupEnd: silent, time: silent, timeEnd: silent, assert: silent, dir: silent };
  const { failed } = await runBlocks(app, loadBlocks(), { quiet: true });
  if (failed) {
    totalFail++; failures.push(`${domain}: app failed to load — run runtime_check.mjs`);
    console.log(`  ${RED}✗${OFF} app did not load cleanly — run runtime_check.mjs first`);
    continue;
  }

  // Helpers bound to this domain's sandbox.
  const signIn = uid => {
    app.currentSession = uid ? { user: { id: uid }, access_token: 'functional-check-token' } : null;
  };
  const seed = (key, value) => {
    if (value === null || value === undefined) app.localStorage.removeItem(key);
    else app.localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
  };
  const read = key => {
    const raw = app.localStorage.getItem(key);
    if (raw === null) return null;
    try { return JSON.parse(raw); } catch { return raw; }
  };
  const reset = () => app.localStorage.clear();

  const test = (name, fn) => {
    try {
      fn();
      totalPass++;
      console.log(`  ${GREEN}✓${OFF} ${name}`);
    } catch (e) {
      totalFail++;
      failures.push(`${domain} › ${name}: ${e.message}`);
      console.log(`  ${RED}✗ ${name}${OFF}`);
      console.log(`    ${DIM}${String(e.message).split('\n').join('\n    ')}${OFF}`);
    }
  };

  try {
    await mod.default({ test, assert, app, signIn, seed, read, reset });
  } catch (e) {
    totalFail++;
    failures.push(`${domain}: suite threw outside a test — ${e.message}`);
    console.log(`  ${RED}✗${OFF} suite threw outside a test — ${e.message}`);
  }
}

console.log('');
if (totalFail) {
  console.log(`${RED}FUNCTIONAL CHECK FAILED${OFF} — ${totalPass} passed, ${totalFail} failed. DO NOT PUSH.`);
  failures.forEach(f => console.log(`  · ${f}`));
  process.exit(1);
}
console.log(`${GREEN}FUNCTIONAL CHECK CLEAN${OFF} — ${totalPass} passed, 0 failed (${files.length} domain${files.length === 1 ? '' : 's'})`);
process.exit(0);
