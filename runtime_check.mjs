#!/usr/bin/env node
// PHOENIX RUNTIME CHECK — v4.9.156 [PM]
// Executes EVERY inline <script> block of index.html in document order under browser stubs.
// Replaces the CLAUDE.md snippet that ran only the largest block (50.3% coverage — the auth /
// profile / _phxRecordWriteError / shared-restore-hook block was never executed by any gate).
//
// Usage:  node runtime_check.mjs [path-to-index.html]
// Exit 0 + "RUNTIME CHECK CLEAN" = clean.  Anything else = do not push.

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';

// v4.9.156: sandbox + block loading are exported so functional_check.mjs can reuse
// them instead of maintaining a second, drifting copy of the browser stubs.
export function loadBlocks(file) {
  const target = file || new URL('./index.html', import.meta.url).pathname;
  const html = readFileSync(target, 'utf8');
  const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  if (!blocks.length) throw new Error('no inline <script> blocks found in ' + target);
  return blocks;
}

// ── Browser stubs — enough for top-level execution, not a DOM emulation ────────────────
// Returns a FRESH context each call so separate runs cannot leak state into each other.
export function createSandbox() {
function el() {
  const e = {
    style: {}, dataset: {}, classList: { add(){}, remove(){}, contains(){ return false; }, toggle(){} },
    children: [], childNodes: [], innerHTML: '', textContent: '', value: '', className: '', id: '',
    appendChild(){ return e; }, removeChild(){}, insertBefore(){}, remove(){}, cloneNode(){ return el(); },
    setAttribute(){}, getAttribute(){ return null; }, removeAttribute(){}, hasAttribute(){ return false; },
    addEventListener(){}, removeEventListener(){}, dispatchEvent(){ return true; },
    querySelector(){ return null; }, querySelectorAll(){ return []; }, closest(){ return null; },
    getBoundingClientRect(){ return { top:0, left:0, width:0, height:0, bottom:0, right:0 }; },
    insertAdjacentHTML(){}, insertAdjacentElement(){}, focus(){}, blur(){}, click(){}, scrollIntoView(){},
    getContext(){ return { fillRect(){}, clearRect(){}, beginPath(){}, moveTo(){}, lineTo(){}, stroke(){}, fill(){}, arc(){}, fillText(){}, measureText(){ return { width:0 }; }, save(){}, restore(){}, translate(){}, scale(){}, rotate(){}, setTransform(){}, createLinearGradient(){ return { addColorStop(){} }; } }; },
    contentWindow: null, offsetWidth: 0, offsetHeight: 0, clientWidth: 0, clientHeight: 0, scrollTop: 0, scrollHeight: 0,
    parentNode: null, parentElement: null, firstChild: null, lastChild: null, nextSibling: null,
  };
  return e;
}
const noop = () => {};
const storage = () => { const d = {}; return { getItem: k => (k in d ? d[k] : null), setItem: (k, v) => { d[k] = String(v); }, removeItem: k => { delete d[k]; }, clear: () => { for (const k in d) delete d[k]; }, key: i => Object.keys(d)[i] ?? null, get length(){ return Object.keys(d).length; } }; };
const thenable = () => { const p = Promise.resolve({ data: null, error: null }); return p; };
const sbQuery = () => { const q = { select(){ return q; }, eq(){ return q; }, neq(){ return q; }, in(){ return q; }, order(){ return q; }, limit(){ return q; }, gte(){ return q; }, lte(){ return q; }, gt(){ return q; }, lt(){ return q; }, is(){ return q; }, single(){ return thenable(); }, maybeSingle(){ return thenable(); }, update(){ return q; }, upsert(){ return q; }, insert(){ return q; }, delete(){ return q; }, then(a, b){ return thenable().then(a, b); }, catch(b){ return thenable().catch(b); } }; return q; };

const sandbox = {
  console, Promise, Date, Math, JSON, Object, Array, String, Number, Boolean, RegExp, Error, TypeError, RangeError, Map, Set, WeakMap, WeakSet, Symbol, parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent, encodeURI, decodeURI, escape, unescape, Intl,
  setTimeout: () => 0, setInterval: () => 0, clearTimeout: noop, clearInterval: noop,
  requestAnimationFrame: () => 0, cancelAnimationFrame: noop, queueMicrotask: (f) => Promise.resolve().then(f),
  alert: noop, confirm: () => false, prompt: () => null,
  atob: s => Buffer.from(s, 'base64').toString('binary'), btoa: s => Buffer.from(s, 'binary').toString('base64'),
  URL, URLSearchParams, TextEncoder, TextDecoder, Blob: class { constructor(){ this.size = 0; } }, FileReader: class { readAsDataURL(){} readAsText(){} addEventListener(){} },
  Image: class { constructor(){ this.style = {}; } addEventListener(){} }, FormData: class { append(){} },
  fetch: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}), text: () => Promise.resolve(''), blob: () => Promise.resolve({}) }),
  performance: { now: () => 0, mark: noop, measure: noop },
  matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop, addListener: noop, removeListener: noop }),
  history: { pushState: noop, replaceState: noop, back: noop, state: null, length: 1 },
  location: { href: 'https://projectphoenix-app.com/', origin: 'https://projectphoenix-app.com', pathname: '/', search: '', hash: '', hostname: 'projectphoenix-app.com', protocol: 'https:', reload: noop, replace: noop, assign: noop },
  screen: { width: 390, height: 844, orientation: { type: 'portrait-primary', addEventListener: noop } },
  innerWidth: 390, innerHeight: 844, devicePixelRatio: 3, scrollY: 0, scrollX: 0, scrollTo: noop, scroll: noop, open: noop, close: noop, focus: noop, blur: noop, getComputedStyle: () => ({ getPropertyValue: () => '' }),
  localStorage: storage(), sessionStorage: storage(), indexedDB: undefined, caches: undefined,
  addEventListener: noop, removeEventListener: noop, dispatchEvent: () => true,
  navigator: {
    onLine: true, userAgent: 'RuntimeCheck', language: 'en-AU', platform: 'iPhone', standalone: true, maxTouchPoints: 5,
    serviceWorker: { register: () => Promise.resolve({ addEventListener: noop, update: noop, unregister: () => Promise.resolve(true), waiting: null, installing: null, active: null }), getRegistration: () => Promise.resolve(undefined), getRegistrations: () => Promise.resolve([]), addEventListener: noop, controller: null, ready: Promise.resolve({ addEventListener: noop }) },
    clipboard: { writeText: () => Promise.resolve() }, wakeLock: { request: () => Promise.resolve({ release: () => Promise.resolve(), addEventListener: noop }) },
    vibrate: noop, share: () => Promise.resolve(), sendBeacon: () => true, geolocation: { getCurrentPosition: noop, watchPosition: () => 0, clearWatch: noop }, mediaDevices: { getUserMedia: () => Promise.reject(new Error('stub')) },
  },
  supabase: { createClient: () => ({ auth: { getSession: () => Promise.resolve({ data: { session: null }, error: null }), getUser: () => Promise.resolve({ data: { user: null }, error: null }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe: noop } } }), signInWithPassword: () => Promise.resolve({ data: { session: null }, error: null }), signOut: () => Promise.resolve({ error: null }), refreshSession: () => Promise.resolve({ data: { session: null }, error: null }) }, from: () => sbQuery(), storage: { from: () => ({ upload: () => Promise.resolve({ data: null, error: null }), getPublicUrl: () => ({ data: { publicUrl: '' } }), createSignedUrl: () => Promise.resolve({ data: { signedUrl: '' }, error: null }), remove: () => Promise.resolve({ data: null, error: null }) }) }, rpc: () => thenable(), channel: () => ({ on(){ return this; }, subscribe(){ return this; } }), removeChannel: noop }) },
  emailjs: { init: noop, send: () => Promise.resolve({ status: 200 }) },
  L: { map: () => ({ setView(){ return this; }, addLayer(){ return this; }, on(){ return this; }, remove: noop, invalidateSize: noop, fitBounds(){ return this; } }), tileLayer: () => ({ addTo(){ return this; } }), polyline: () => ({ addTo(){ return this; }, getBounds(){ return {}; } }), marker: () => ({ addTo(){ return this; }, bindPopup(){ return this; } }), circleMarker: () => ({ addTo(){ return this; } }) },
};
sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox; sandbox.top = sandbox; sandbox.parent = sandbox;
sandbox.document = Object.assign(el(), {
  readyState: 'complete', visibilityState: 'visible', hidden: false, title: '', cookie: '', referrer: '',
  documentElement: el(), body: el(), head: el(), activeElement: null, fonts: { ready: Promise.resolve(), load: () => Promise.resolve([]) },
  getElementById: () => el(), createElement: () => el(), createTextNode: () => el(), createDocumentFragment: () => el(), createEvent: () => ({ initEvent: noop }),
  querySelector: () => null, querySelectorAll: () => [], getElementsByClassName: () => [], getElementsByTagName: () => [],
  addEventListener: noop, removeEventListener: noop, execCommand: () => false, hasFocus: () => true,
});
sandbox.MutationObserver = class { observe(){} disconnect(){} };
sandbox.IntersectionObserver = class { observe(){} disconnect(){} unobserve(){} };
sandbox.ResizeObserver = class { observe(){} disconnect(){} unobserve(){} };
sandbox.Notification = { permission: 'default', requestPermission: () => Promise.resolve('default') };
sandbox.AudioContext = class { constructor(){ this.state = 'suspended'; this.currentTime = 0; this.destination = {}; } resume(){ return Promise.resolve(); } createOscillator(){ return { connect(){}, start(){}, stop(){}, frequency: { value: 0, setValueAtTime(){} }, type: '' }; } createGain(){ return { connect(){}, gain: { value: 0, setValueAtTime(){}, exponentialRampToValueAtTime(){}, linearRampToValueAtTime(){} } }; } };
sandbox.webkitAudioContext = sandbox.AudioContext;
sandbox.Audio = class { play(){ return Promise.resolve(); } pause(){} load(){} addEventListener(){} };
sandbox.speechSynthesis = { speak: noop, cancel: noop, getVoices: () => [] };
sandbox.SpeechSynthesisUtterance = class {};
sandbox.CustomEvent = class { constructor(t, o){ this.type = t; this.detail = o && o.detail; } };
sandbox.Event = class { constructor(t){ this.type = t; } preventDefault(){} stopPropagation(){} };
sandbox.KeyboardEvent = sandbox.Event; sandbox.TouchEvent = sandbox.Event; sandbox.PointerEvent = sandbox.Event;
sandbox.DOMParser = class { parseFromString(){ return sandbox.document; } };
sandbox.crypto = { randomUUID: () => '00000000-0000-4000-8000-000000000000', getRandomValues: a => a, subtle: {} };
sandbox.structuredClone = v => JSON.parse(JSON.stringify(v));

vm.createContext(sandbox);
return sandbox;
}

// ── Run every block, in order, in ONE context ─────────────────────────────────────────
// Returns { failed, hardRejections }. Callers decide how to report.
export async function runBlocks(sandbox, blocks, opts = {}) {
const quiet = !!opts.quiet;
let failed = false;
const unhandled = [];
const onRejection = (r) => { unhandled.push(r); };
process.on('unhandledRejection', onRejection);

for (let i = 0; i < blocks.length; i++) {
  const src = blocks[i];
  try {
    vm.runInContext(src, sandbox, { filename: `index.html#script${i + 1}`, timeout: 60_000 });
  } catch (e) {
    failed = true;
    if (!quiet) {
      console.error(`\n✗ script block ${i + 1}/${blocks.length} (${src.length} chars) THREW at top level:`);
      console.error('  ' + String(e && e.stack ? e.stack.split('\n').slice(0, 6).join('\n  ') : e));
    }
  }
}

// Let queued microtasks (auth flows etc.) settle so async top-level throws surface.
await new Promise(r => setImmediate(r));
await new Promise(r => setImmediate(r));
process.removeListener('unhandledRejection', onRejection);

let hard = [];
if (unhandled.length) {
  // Report but do not fail: stubbed promises legitimately reject in places the real app guards
  // with UI. Fail only if a rejection is a ReferenceError/TypeError from our own code.
  hard = unhandled.filter(r => r instanceof ReferenceError || r instanceof TypeError || r instanceof SyntaxError);
  if (hard.length) {
    failed = true;
    if (!quiet) {
      console.error(`\n✗ ${hard.length} unhandled ${hard.length === 1 ? 'rejection' : 'rejections'} that look like code errors:`);
      hard.slice(0, 5).forEach(r => console.error('  ' + String(r && r.stack ? r.stack.split('\n').slice(0, 4).join('\n  ') : r)));
    }
  }
}

return { failed, hardRejections: hard };
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────
// Guarded so `import`ing this file (functional_check.mjs does) does not run the check
// or call process.exit().
const isEntry = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntry) {
  let blocks;
  try { blocks = loadBlocks(process.argv[2]); }
  catch (e) { console.error('RUNTIME CHECK: ' + e.message); process.exit(2); }
  const total = blocks.reduce((n, b) => n + b.length, 0);
  const { failed } = await runBlocks(createSandbox(), blocks);
  if (failed) {
    console.error(`\nRUNTIME CHECK FAILED — ${blocks.length} blocks, ${total}/${total} chars attempted. DO NOT PUSH.`);
    process.exit(1);
  }
  console.log(`RUNTIME CHECK CLEAN — ${blocks.length}/${blocks.length} script blocks executed in document order (${total} chars, 100% coverage)`);
  process.exit(0);
}
