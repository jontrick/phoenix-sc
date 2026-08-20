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
import { readFileSync } from 'node:fs';
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
    let threw = false, r;
    try { r = fn(); } catch { threw = true; }
    // An async fn rejects rather than throwing; a silent pass here would be the same
    // class of fake green the runner had (v4.9.177). Reject the usage instead.
    if (r && typeof r.then === 'function') throw new Error('assert.throws does not support async functions — await the call inside a try/catch and assert on the caught error');
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

  // v4.9.177: AWAIT the body. Previously `fn()` was called and never awaited, so an async
  // test body was recorded as passing before a single assertion ran — an async test could
  // not fail. Found by Training, 2026-08-18; it had silently faked a pass in tests/pm.mjs.
  // Suites must therefore be awaited too (mod.default is already awaited below), and a
  // test that returns a promise now blocks the next one, which is what we want for order.
  const pending = [];
  const test = (name, fn) => { const p = runOne(name, fn); pending.push(p); return p; };
  const runOne = async (name, fn) => {
    try {
      await fn();
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
    // Domain files call test() without awaiting. Draining here makes the accounting
    // guaranteed rather than dependent on the microtask queue happening to be empty.
    await Promise.all(pending);
  } catch (e) {
    totalFail++;
    failures.push(`${domain}: suite threw outside a test — ${e.message}`);
    console.log(`  ${RED}✗${OFF} suite threw outside a test — ${e.message}`);
  }
}

// ── v4.9.174 [PM] dead-reference sweep — runs for every domain, no test file needed ──
// The class that shipped .165 (_blabCalEntryView), .172 (openPhxSession) and the dead
// custom-session-builder call: handler code emitted into a STRING, naming a function that
// does not exist. runtime_check passes (never executes it), harness passes (the NAME is
// present), and functional tests pass when they call the helper instead of the renderer.
// So: find string literals that look like a call to an app-convention function, and check
// the loaded app actually has it.
{
  process.stdout.write('\ndead-reference sweep\n');
  const srcHtml = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  const probe = createSandbox();
  const mute = () => {};
  probe.console = { log:mute, warn:mute, error:mute, info:mute, debug:mute, trace:mute, table:mute, group:mute, groupEnd:mute, time:mute, timeEnd:mute, assert:mute, dir:mute };
  const loaded = await runBlocks(probe, loadBlocks(), { quiet: true });
  if (loaded.failed) {
    totalFail++; failures.push('dead-reference sweep: app did not load — run runtime_check.mjs');
    console.log(`  ${RED}\u2717${OFF} app did not load — run runtime_check.mjs first`);
  } else {
    const CONV = /^(_?(blab|pep|nut|phx|fq)|_phx|open|close|render|show|start|submit|save|toggle|pick|adjust|add)/i;
    const strRe = /(["'])((?:\\.|(?!\1)[^\\\n])*)\1/g;
    const dead = new Map();
    let m;
    while ((m = strRe.exec(srcHtml))) {
      const lit = m[2];
      const callRe = /(?:^|[^.\w$])([A-Za-z_$][\w$]*)\(/g;
      let c;
      while ((c = callRe.exec(lit))) {
        const n = c[1];
        if (!CONV.test(n) || typeof probe[n] === 'function') continue;
        if (!dead.has(n)) dead.set(n, html_line(srcHtml, m.index));
      }
    }
    if (dead.size) {
      totalFail += dead.size;
      for (const [n, line] of dead) {
        failures.push(`dead reference: ${n}() at index.html:${line} — named in a string, never defined`);
        console.log(`  ${RED}\u2717${OFF} ${n}() index.html:${line} — named in a string, no such function`);
      }
    } else {
      totalPass++;
      console.log(`  ${GREEN}\u2713${OFF} every app-function named inside a string literal exists`);
    }
  }
}
function html_line(src, idx) { return src.slice(0, idx).split('\n').length; }

console.log('');
if (totalFail) {
  console.log(`${RED}FUNCTIONAL CHECK FAILED${OFF} — ${totalPass} passed, ${totalFail} failed. DO NOT PUSH.`);
  failures.forEach(f => console.log(`  · ${f}`));
  process.exit(1);
}
console.log(`${GREEN}FUNCTIONAL CHECK CLEAN${OFF} — ${totalPass} passed, 0 failed (${files.length} domain${files.length === 1 ? '' : 's'})`);
process.exit(0);
