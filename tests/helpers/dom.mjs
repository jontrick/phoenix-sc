// Shared DOM test helpers. PM-owned once merged; written for tests/training.mjs and
// pulled out because every domain now has modals to test and three private copies
// would drift.
//
// PATH NOTE: this deliberately lives in tests/helpers/ rather than tests/_helpers.mjs.
// functional_check discovers domains with `readdirSync(TESTS_DIR).filter(f =>
// f.endsWith('.mjs'))` — no underscore exclusion — so a helper module sitting directly
// in tests/ is loaded as a domain and fails for having no default export. A
// subdirectory is invisible to that scan. Move it up if the runner ever skips
// underscore-prefixed files.

// A document.createElement that records what the code under test builds, so a modal
// can be driven for real: find its button, fire the handler, assert on the effect.
//
// Usage:
//   const dom = recordingDom(app);
//   try { app._phxConfirm('T', 'M', 'Yes'); dom.byButton('Yes').handlers.click(); }
//   finally { dom.restore(); }
export function recordingDom(app) {
  const made = [];
  const realCreate = app.document.createElement;

  const el = () => {
    const e = {
      style: {}, textContent: '', innerHTML: '', children: [], handlers: {},
      appendChild(c) { this.children.push(c); return c; },
      addEventListener(ev, fn) { this.handlers[ev] = fn; },
      removeAttribute() {}, setAttribute() {}, querySelector: () => null,
      remove() { this.removed = true; }
    };
    made.push(e);
    return e;
  };

  app.document.createElement = el;

  return {
    made,
    restore: () => { app.document.createElement = realCreate; },

    // Match on text alone. Fine for headings; NOT enough for buttons — see below.
    byText: (t) => made.find((m) => m.textContent === t),

    // A button is text AND a click handler. Matching on text alone finds a modal's
    // TITLE when the title and the button share wording, which they often do
    // ("Start Week 6"). That made one Training case fail and another pass for the
    // wrong reason before this existed.
    byButton: (t) => made.find((m) => m.textContent === t && typeof m.handlers.click === 'function'),

    byId: (id) => made.find((m) => m.id === id)
  };
}
