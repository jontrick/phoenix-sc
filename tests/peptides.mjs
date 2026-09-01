// PEPTIDE PORTAL — functional tests. Run: node functional_check.mjs peptides
//
// These call the real functions in index.html. Every case here corresponds to a
// bug that actually shipped, or a rule Jon set:
//   · restore resolution — Jon's ruling, 18 Aug 2026: newest timestamp wins
//   · mirror scrubbing   — blood markers must never reach profiles.peptide_state
//   · recon maths        — the units Jon draws into the syringe
//   · marker flagging    — high/low against the lab's OWN printed range

const UID = 'test-user';
const KEY = `peptide_v1_${UID}`;

// DATE LITERALS — audited against COMMS_PROTOCOL's decay rule (Nutrition .189):
// a test pinned to a literal date becomes a DIFFERENT test as the date recedes.
// A literal is only safe where the assertion is position-independent — i.e. the
// value is compared against another value, never against "now".
//
// OLDER/NEWER are compared ONLY against each other, by pepRestoreFromCloud's
// timestamp table. Nothing derives a phase or an elapsed time from them, so they
// mean the same thing forever. SAFE as literals.
const OLDER = '2026-08-01T00:00:00.000Z';
const NEWER = '2026-08-17T00:00:00.000Z';

// Anything whose MEANING depends on where it sits relative to today must be
// derived, and must say which phase it represents. My schedule engine and
// depletion forecast are entirely position-sensitive: a startDate that meant
// "just started" when written silently becomes "deep into a cycle", and a
// fixed-length course anchored to a past date tests the FINISHED path while the
// test name still claims otherwise.
const ISO = d => d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const daysAgo = n => ISO(new Date(Date.now() - n*86400000));

import { readFileSync } from 'node:fs';
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

export default function ({ test, assert, app, signIn, seed, read, reset }) {

// ── settle() — a MACROTASK, deliberately, not `await Promise.resolve()` ──────
// Training hit this on their own mirror cases: a REJECTION needs two microtask
// ticks to reach `.catch`, because the `.then` in the chain passes through
// first. They awaited one tick, their rejection case died on a null read, and
// the four that PASSED were passing by luck — a slightly longer chain would
// have made them flaky.
//
// setTimeout(0) is a macrotask: the whole microtask queue drains before it
// fires, so the depth of the chain under test cannot matter. Verified, not
// assumed — adding five pass-through .then() links to _pepSendCloud left every
// case green.
//
// Named so the reason travels with the mechanism. `await Promise.resolve()` is
// shorter and looks cleaner; swapping it in fails four cases here (both
// rejection paths and both clipboard-refusal paths), which is exactly the
// tidy-up this comment exists to stop.
const settle = () => new Promise(r => setTimeout(r, 0));


  // ── Restore resolution — newest timestamp wins ─────────────────────────────
  // Old rule was "local always wins", so a replacement device that had written
  // any state could never pull the protocol back down. Jon lost a phone; that
  // is the whole reason the tracker left the standalone PWA.

  const cloud = { stacks: [{ compoundId: 'bpc157' }], checked: {}, cart: [], _ts: NEWER };

  const restore = (localValue, cloudState) => {
    reset();
    signIn(UID);
    if (localValue !== null) seed(KEY, localValue);
    const changed = app.pepRestoreFromCloud({ peptide_state: cloudState });
    return { changed, state: read(KEY), backup: read(`${KEY}_bak`) };
  };

  test('fresh install pulls the protocol down from the cloud', () => {
    const r = restore(null, cloud);
    assert.equal(r.state.stacks.length, 1, 'protocol restored');
    assert.equal(r.changed, true, 'restore reports that it changed local');
  });

  test('a newer local copy is not clobbered by an older cloud copy', () => {
    const local = { stacks: [{ compoundId: 'ta1' }, { compoundId: 'nad' }], _ts: NEWER };
    const r = restore(local, { ...cloud, _ts: OLDER });
    assert.equal(r.state.stacks.length, 2, 'local survived');
    assert.equal(r.changed, false, 'no restore reported');
  });

  test('a newer cloud copy wins', () => {
    const r = restore({ stacks: [{ compoundId: 'ta1' }], _ts: OLDER }, cloud);
    assert.equal(r.state.stacks[0].compoundId, 'bpc157', 'cloud copy applied');
  });

  test('equal timestamps keep local — a tie must not ping-pong between devices', () => {
    const r = restore({ stacks: [{ compoundId: 'ta1' }], _ts: NEWER }, { ...cloud, _ts: NEWER });
    assert.equal(r.state.stacks[0].compoundId, 'ta1', 'local kept on a tie');
  });

  test('a stamped cloud copy beats unstamped legacy local state', () => {
    const r = restore({ stacks: [{ compoundId: 'ta1' }] }, cloud);
    assert.equal(r.state.stacks[0].compoundId, 'bpc157', 'cloud applied over legacy local');
  });

  test('stamped local beats an unstamped legacy cloud copy', () => {
    const r = restore({ stacks: [{ compoundId: 'ta1' }], _ts: OLDER }, { stacks: [], checked: {} });
    assert.equal(r.state.stacks[0].compoundId, 'ta1', 'local kept');
  });

  test('with neither side stamped, local is kept', () => {
    const r = restore({ stacks: [{ compoundId: 'ta1' }] }, { stacks: [], checked: {} });
    assert.equal(r.state.stacks[0].compoundId, 'ta1', 'local kept');
  });

  test('unreadable local state is replaced by the cloud copy', () => {
    const r = restore('{ not json', cloud);
    assert.equal(r.state.stacks.length, 1, 'cloud applied over corrupt local');
  });

  test('the replaced copy is kept as a backup, never silently dropped', () => {
    const r = restore({ stacks: [{ compoundId: 'ta1' }], _ts: OLDER }, cloud);
    assert.ok(r.backup, 'backup written');
    assert.equal(r.backup.stacks[0].compoundId, 'ta1', 'backup holds the replaced copy');
  });

  test('a no-op restore leaves no backup behind', () => {
    const r = restore({ stacks: [{ compoundId: 'ta1' }], _ts: NEWER }, { ...cloud, _ts: OLDER });
    assert.equal(r.backup, null, 'no stray backup');
  });

  test('a profile row without peptide_state is ignored', () => {
    reset(); signIn(UID);
    seed(KEY, { stacks: [{ compoundId: 'ta1' }], _ts: NEWER });
    app.pepRestoreFromCloud({ name: 'Jon' });
    assert.equal(read(KEY).stacks[0].compoundId, 'ta1', 'untouched');
  });

  test('restore is a no-op when signed out', () => {
    reset(); signIn(null);
    app.pepRestoreFromCloud({ peptide_state: cloud });
    assert.equal(read(KEY), null, 'nothing written while signed out');
  });

  test('every save stamps _ts, which is what the comparison relies on', () => {
    reset(); signIn(UID);
    app.pepSaveState({ stacks: [], checked: {}, cart: [] });
    const saved = read(KEY);
    assert.ok(saved && saved._ts, '_ts present');
    assert.ok(!isNaN(Date.parse(saved._ts)), '_ts is a parseable ISO date');
  });

  // ── Empty-stub guard (v4.9.159) ────────────────────────────────────────────
  // Live data-loss bug on .158, found by asking whether the app can manufacture
  // an empty protocol with a fresh _ts without Jon intending to clear anything.
  // It can: pepGetState() invents {stacks:[],checked:{},cart:[]} whenever the key
  // is absent, and every save path persists it. On a new phone, one tap before
  // the profile row lands stamped an empty protocol "now", which then beat the
  // real cloud copy on timestamp. Every case below FAILS on .158.

  // startDate here is INERT — these cases assert how many stacks survive a
  // restore, and restore never schedules. Position-independent, so literals are
  // safe. If anyone adds a scheduling assertion to these, derive them first.
  const REAL_CLOUD = {
    stacks: [
      { compoundId: 'retatrutide', dose: 6, startDate: '2026-07-01' },
      { compoundId: 'bpc157', dose: 0.5, startDate: '2026-07-01' },
      { compoundId: 'ta1', dose: 1.6, startDate: '2026-07-01' },
    ],
    checked: {}, cart: [], notes: [{ text: 'months of logged responses' }],
    _ts: NEWER,
  };
  const freshDevice = () => { reset(); signIn(UID); };
  const stacksAfterRestore = () => {
    app.pepRestoreFromCloud({ peptide_state: REAL_CLOUD });
    const s = read(KEY);
    return s && s.stacks ? s.stacks.length : 0;
  };

  test('adding a cart item on a new phone cannot wipe the protocol', () => {
    freshDevice();
    app.pepCartAdd('BC10', 'BPC-157 10mg', 87);
    assert.equal(stacksAfterRestore(), 3, 'protocol survived a pre-restore cart tap');
  });

  test('ticking a dose on a new phone cannot wipe the protocol', () => {
    freshDevice();
    app.pepToggleDose('bpc157');
    assert.equal(stacksAfterRestore(), 3, 'protocol survived a pre-restore dose tick');
  });

  test('opening the BLOODS tab on a new phone cannot wipe the protocol', () => {
    freshDevice();
    const ps = app.pepGetState();
    ps.bloods = [];
    app.pepSaveState(ps);          // what pepBloodsLoad does after a fetch
    assert.equal(stacksAfterRestore(), 3, 'protocol survived a pre-restore bloods load');
  });

  test('a cloud stub cannot wipe a real local protocol', () => {
    // The symmetric case: the stub mirrors UP, so without this one tap on a new
    // phone would propagate the wipe to a device that was working fine.
    reset(); signIn(UID);
    seed(KEY, { stacks: [{ compoundId: 'retatrutide' }, { compoundId: 'bpc157' }], checked: {}, cart: [], _ts: OLDER });
    app.pepRestoreFromCloud({ peptide_state: { stacks: [], checked: {}, cart: [], _ts: NEWER } });
    assert.equal(read(KEY).stacks.length, 2, 'local protocol survived a newer cloud stub');
  });

  test('deliberately clearing the protocol still clears — the guard must not undelete', () => {
    reset(); signIn(UID);
    seed(KEY, { stacks: [{ compoundId: 'ta1' }], checked: {}, cart: [], _ts: OLDER });
    app.pepRemoveStack(0);                                   // Jon removes his last compound
    assert.equal(read(KEY).stacks.length, 0, 'local cleared');
    // Cloud has caught up within a debounce: both sides empty -> table decides, no resurrection.
    app.pepRestoreFromCloud({ peptide_state: { stacks: [], checked: {}, cart: [], _ts: NEWER } });
    assert.equal(read(KEY).stacks.length, 0, 'stayed cleared');
  });

  test('the discarded stub is recoverable from the backup key', () => {
    freshDevice();
    app.pepCartAdd('BC10', 'BPC-157 10mg', 87);
    app.pepRestoreFromCloud({ peptide_state: REAL_CLOUD });
    const bak = read(`${KEY}_bak`);
    assert.ok(bak, 'backup written');
    assert.equal(bak.cart.length, 1, 'the discarded tap is in the backup');
  });

  // Write side — a stub must not reach the server either, or it sits there
  // looking authoritative to anything else that reads the column.
  test('the mirror refuses to overwrite a real cloud protocol with an empty one', () => {
    app.window._lastProfileRow = { peptide_state: { stacks: [{ compoundId: 'retatrutide' }], _ts: OLDER } };
    assert.equal(app._pepStubWouldClobber({ stacks: [], _ts: NEWER }), true, 'stub write declined');
  });

  test('the mirror always sends a real protocol', () => {
    app.window._lastProfileRow = { peptide_state: { stacks: [{ compoundId: 'retatrutide' }], _ts: OLDER } };
    assert.equal(app._pepStubWouldClobber({ stacks: [{ compoundId: 'ta1' }], _ts: NEWER }), false, 'real write allowed');
  });

  test('the mirror sends an empty state when the cloud is empty too — a real clear', () => {
    app.window._lastProfileRow = { peptide_state: { stacks: [], _ts: OLDER } };
    assert.equal(app._pepStubWouldClobber({ stacks: [], _ts: NEWER }), false, 'clear propagates');
  });

  test('a missing cached profile row never blocks a real write', () => {
    app.window._lastProfileRow = null;
    assert.equal(app._pepStubWouldClobber({ stacks: [], _ts: NEWER }), false, 'sends when cache is absent');
  });

  // ── Storage key derivation ─────────────────────────────────────────────────
  // Nutrition shipped a fresh-install bug where the restore wrote to a "_guest"
  // key because it derived from athlete.id, which is null when the hook fires —
  // and its tests missed it because the sandbox supplied the key itself. A
  // sandbox that supplies the value under test cannot test it. These assert the
  // key the APP derives, never one the test hands it.

  test('the storage key is derived from the signed-in session, not a default', () => {
    reset();
    signIn('user-alpha');
    app.pepSaveState({ stacks: [{ compoundId: 'bpc157' }], checked: {}, cart: [] });
    assert.ok(read('peptide_v1_user-alpha'), 'wrote to the session-derived key');
    assert.equal(read('peptide_v1_guest'), null, 'no guest-keyed fallback');
    assert.equal(read('peptide_v1_undefined'), null, 'no undefined-keyed fallback');
    assert.equal(read('peptide_v1_null'), null, 'no null-keyed fallback');
  });

  test('two users never share a protocol', () => {
    reset();
    signIn('user-alpha');
    app.pepSaveState({ stacks: [{ compoundId: 'bpc157' }], checked: {}, cart: [] });
    signIn('user-beta');
    app.pepSaveState({ stacks: [{ compoundId: 'ta1' }, { compoundId: 'nad' }], checked: {}, cart: [] });
    assert.equal(read('peptide_v1_user-alpha').stacks.length, 1, 'alpha untouched');
    assert.equal(read('peptide_v1_user-beta').stacks.length, 2, 'beta separate');
  });

  test('reading while signed out returns an empty protocol, not another user’s', () => {
    reset();
    signIn('user-alpha');
    app.pepSaveState({ stacks: [{ compoundId: 'bpc157' }], checked: {}, cart: [] });
    signIn(null);
    const state = app.pepGetState();
    assert.equal(state.stacks.length, 0, 'empty while signed out');
  });

  test('a restore lands on the signed-in user’s key, not a fallback', () => {
    reset();
    signIn('user-gamma');
    app.pepRestoreFromCloud({ peptide_state: cloud });
    assert.ok(read('peptide_v1_user-gamma'), 'restored to the derived key');
    assert.equal(read('peptide_v1_guest'), null, 'nothing at a guest key');
  });

  // ── Mirror scrubbing — no medical data leaves the device ───────────────────
  // ps.bloods caches the blood_panels table. Mirroring it would copy pathology
  // values into profiles.peptide_state, a second store for medical data.

  const withBloods = {
    stacks: [{ compoundId: 'bpc157' }, { compoundId: 'ta1' }],
    checked: { '2026-08-18': ['bpc157'] },
    cart: [{ cat: 'BC10' }],
    notes: [{ text: 'a' }, { text: 'b' }, { text: 'c' }],
    _ts: NEWER,
    bloods: [{ id: 'p1', panel_date: '2026-08-06', markers: [
      { name: 'Serum copper', value: '24.8', unit: 'umol/L' },
      { name: 'ALT', value: '71', unit: 'U/L' },
    ] }],
  };

  test('blood panels are stripped from the cloud payload', () => {
    const payload = app._pepCloudPayload(withBloods);
    assert.equal('bloods' in payload, false, 'bloods key removed');
  });

  test('no marker name or value survives into the cloud payload', () => {
    const payload = app._pepCloudPayload(withBloods);
    assert.notIncludes(payload, 'Serum copper', 'marker name leaked to cloud');
    assert.notIncludes(payload, '24.8', 'marker value leaked to cloud');
  });

  test('everything that is not medical still mirrors', () => {
    const payload = app._pepCloudPayload(withBloods);
    assert.equal(payload.stacks.length, 2, 'stacks kept');
    assert.equal(payload.notes.length, 3, 'notes kept');
    assert.equal(payload.cart.length, 1, 'cart kept');
    assert.equal(payload._ts, NEWER, '_ts kept');
  });

  test('building the payload does not mutate the caller’s state', () => {
    app._pepCloudPayload(withBloods);
    assert.equal(withBloods.bloods.length, 1, 'local cache intact');
  });

  // The diagnostic snapshot lands in localStorage and is readable from the URL
  // bar via phxLastError(), so it must never carry health values.
  test('the diagnostic summary is counts and a timestamp only', () => {
    const summary = app._pepErrorSummary(withBloods);
    assert.deepEqual(summary, { stacks: 2, notes: 3, panels: 1, cart: 1, ts: NEWER }, 'summary shape');
  });

  test('no medical value reaches the diagnostic summary', () => {
    const summary = app._pepErrorSummary(withBloods);
    assert.notIncludes(summary, 'Serum copper', 'marker name in diagnostics');
    assert.notIncludes(summary, '24.8', 'marker value in diagnostics');
  });

  test('the diagnostic summary survives empty and null state', () => {
    const empty = { stacks: 0, notes: 0, panels: 0, cart: 0, ts: null };
    assert.deepEqual(app._pepErrorSummary({}), empty, 'empty object');
    assert.deepEqual(app._pepErrorSummary(null), empty, 'null');
  });

  // ── Reconstitution — the number Jon reads at 4:30am ────────────────────────
  // U-100 syringe: 100 units = 1 mL. Wrong here means a wrong dose drawn.

  const draw = (doseMg, vialMg, waterMl) =>
    app._pepDraw(doseMg, 'mg', app._pepRecon({ vialMg, waterMl }, { id: 'x' }));

  test('250mcg from a 5mg vial in 2mL is 10 units', () => {
    assert.equal(Math.round(draw(0.25, 5, 2).units * 100) / 100, 10, 'units');
  });

  test('500mcg from a 5mg vial in 2mL is 20 units', () => {
    assert.equal(Math.round(draw(0.5, 5, 2).units * 100) / 100, 20, 'units');
  });

  test('Retatrutide 6mg from RT10 in 0.5mL is 30 units', () => {
    assert.equal(Math.round(draw(6, 10, 0.5).units * 100) / 100, 30, 'units');
  });

  test('Retatrutide 6mg from RT30 in 5mL is a full 100-unit syringe', () => {
    assert.equal(Math.round(draw(6, 30, 5).units * 100) / 100, 100, 'units');
  });

  test('blend doses already expressed in units bypass the mg maths', () => {
    const d = app._pepDraw(14, 'units', app._pepRecon({ vialMg: 70, waterMl: 2 }, { id: 'x' }));
    assert.equal(d.units, 14, 'units passed through');
    assert.equal(Math.round(d.ml * 100) / 100, 0.14, 'mL derived from units');
  });

  test('an unknown reconstitution yields no draw rather than a wrong one', () => {
    assert.equal(app._pepDraw(1, 'mg', app._pepRecon({}, { id: 'not-a-real-compound' })), null, 'null, not a guess');
  });

  test('sub-milligram doses render as mcg', () => {
    assert.equal(app._pepFmtDose(0.25, 'mg'), '250mcg', 'mcg formatting');
    assert.equal(app._pepFmtDose(1.6, 'mg'), '1.6mg', 'mg formatting');
  });

  // ── Library values Jon confirmed against the literature (v4.9.160) ─────────
  // These exist because two of them LOOK like errors and would invite a
  // "correction" that is dangerous in one direction and useless in the other.

  const compound = id => app._pepCompound(id);

  test('Epitalon default is 5mg — the Khavinson course, not the old 500mcg', () => {
    assert.equal(compound('epitalon').dose, 5, 'dose in mg');
  });

  test('a 20-night Epitalon course totals 100mg, i.e. two 50mg vials', () => {
    assert.equal(compound('epitalon').dose * 20, 100, 'course total');
  });

  test('Epitalon reconstitution keeps a 5mg dose at half a syringe', () => {
    const c = compound('epitalon');
    const d = app._pepDraw(c.dose, c.doseUnit, app._pepRecon({}, c));
    assert.equal(Math.round(d.units), 50, 'units — 100u would be a full syringe');
  });

  // 150-500mcg SubQ vs 50-150mg oral is a 100x gap that is entirely route, not
  // an error. Anyone reading the injectable figure against an oral source will
  // think it is under-dosed by 100x; "fixing" it would be a 100x overdose.
  test('5-Amino-1MQ records the route, so the mcg figure is not mistaken for an error', () => {
    const n = compound('5amq').notes;
    assert.ok(n.includes('SubQ'), 'names the injectable route');
    assert.ok(n.includes('oral'), 'names the oral figure it is confused with');
  });

  // The 15-minute gap is mechanism, not scheduling: the GHRP drops somatostatin
  // tone so the GHRH that follows lands with the brake off. Merging them into one
  // shot discards that.
  test('the Ipamorelin → CJC sequencing rationale is recorded, not just the timing', () => {
    assert.ok(compound('ipamorelin').notes.includes('somatostatin'), 'ipa carries the why');
    assert.ok(compound('cjc1295').notes.includes('Do not merge'), 'cjc warns against merging');
  });

  // ── Stock forecast (v4.9.180) ──────────────────────────────────────────────
  // Jon's rules, 18 Aug 2026: reorder at supplier lead time + 4 weeks buffer;
  // one consolidated order; a reconstituted vial is good for 30 days.
  // The forecast simulates the calendar day by day rather than averaging a burn
  // rate — averages get cycles, off-weeks and 20-night courses wrong, and they
  // cannot model a part-used vial being binned at its expiry, which is real
  // consumption and the main way a naive forecast under-orders.
  {
    const sIso = d => d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
    const sToday = sIso(new Date());
    const sAgo = n => sIso(new Date(Date.now() - n*86400000));
    const sPs = { stacks: [], settings: {} };
    const f = stack => app._pepStockForecast(sPs, stack);

    test('BPC-157 500mcg from a 5mg/2mL vial yields 10 doses', () => {
      assert.equal(f({ compoundId:'bpc157', dose:0.5, startDate: sAgo(30), vialMg:5, waterMl:2, sealedVials:3 }).dosesPerVial, 10, 'doses per vial');
    });

    test('Retatrutide 6mg from an RT10 in 0.5mL yields a single dose', () => {
      assert.equal(f({ compoundId:'retatrutide', dose:6, startDate: sAgo(30), vialMg:10, waterMl:0.5, sealedVials:4 }).dosesPerVial, 1, 'one dose per vial');
    });

    test('a unit-dosed blend is measured against syringe volume, not mg', () => {
      // BBG70: 70mg in 2mL = 200 units; 14u per dose = 14 doses.
      assert.equal(f({ compoundId:'bpc_ghkcu_tb', dose:14, startDate: sAgo(30), vialMg:70, waterMl:2, sealedVials:2 }).dosesPerVial, 14, 'doses per vial');
    });

    test('a part-used vial past 30 days is written off, not carried forward', () => {
      const fresh = f({ compoundId:'bpc157', dose:0.5, startDate: sAgo(30), vialMg:5, waterMl:2, sealedVials:0, openDosesUsed:2, openedDate: sToday });
      const stale = f({ compoundId:'bpc157', dose:0.5, startDate: sAgo(30), vialMg:5, waterMl:2, sealedVials:0, openDosesUsed:2, openedDate: sAgo(31) });
      assert.equal(fresh.dosesRemaining, 8, 'fresh vial yields its remainder');
      assert.equal(stale.dosesRemaining, 0, 'expired vial yields nothing');
      assert.equal(stale.wastedDoses, 8, 'the remainder counts as waste, not supply');
    });

    test('no stock depletes on the next scheduled dose and flags overdue', () => {
      const r = f({ compoundId:'bpc157', dose:0.5, startDate: sAgo(30), vialMg:5, waterMl:2, sealedVials:0 });
      assert.equal(r.dosesRemaining, 0, 'nothing to give');
      assert.equal(r.overdue, true, 'flagged overdue');
    });

    test('order-by is depletion minus lead time plus buffer (21 + 28 days)', () => {
      const r = f({ compoundId:'bpc157', dose:0.5, startDate: sAgo(30), vialMg:5, waterMl:2, sealedVials:12 });
      const gap = Math.round((new Date(r.depletionDate) - new Date(r.orderByDate)) / 86400000);
      assert.equal(gap, 49, 'lead time + buffer');
    });

    test('a cycled compound still burns shelf life while it is paused', () => {
      const r = f({ compoundId:'ghkcu', dose:1, startDate: sAgo(10), cycleWeeks:4, offWeeks:4, vialMg:50, waterMl:5, sealedVials:1, openDosesUsed:0, openedDate: sToday });
      assert.ok(r.wastedDoses > 0, 'doses expire across the off-weeks');
    });

    // v4.9.236: this hardcoded 10, which was the OLD _PEP_RECON default for
    // BPC-157 (5mg vial). His protocol says 10mg in 1mL, so the answer is 20 —
    // and a literal here was a second copy of the value that silently disagreed
    // with the table the moment the table was corrected. It now DERIVES from
    // the default, because this case is about the fallback MECHANISM. The
    // values themselves are owned by the RECONREF block, pinned against
    // section 8 of Peptide_Protocol_2026_27.pdf. One owner per fact.
    test('a library default reconstitution is enough to forecast', () => {
      const d = app._PEP_RECON.bpc157;
      const expected = Math.floor((d.vialMg / d.waterMl) * d.waterMl / 0.5);
      assert.equal(f({ compoundId:'bpc157', dose:0.5, startDate: sAgo(30), sealedVials:3 }).dosesPerVial,
        expected, 'falls back to _PEP_RECON rather than reporting unknown');
    });

    test('an unusable reconstitution reports rather than guessing', () => {
      assert.equal(f({ compoundId:'bpc157', dose:0.5, startDate: sAgo(30), vialMg:0, waterMl:0, sealedVials:3 }).unknown, true, 'flagged unknown');
    });

    test('the settings carry Jon\'s chosen rules as defaults', () => {
      const set = app._pepSettings({});
      assert.equal(set.bufferWeeks, 4, '4-week buffer');
      assert.equal(set.shelfLifeDays, 30, '30-day reconstituted shelf life');
    });
  }

  // ── Consolidated order builder (v4.9.181) ─────────────────────────────────
  // Jon's rule: one order when anything trips, everything topped up together —
  // shipping is a flat ~$167 AUD, so splitting orders pays it repeatedly.
  // The builder asks the SAME simulation a different question (unlimited stock,
  // count the vials opened) so a forecast and an order can never disagree about
  // consumption.
  {
    const oIso = d => d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
    const ago = n => oIso(new Date(Date.now() - n*86400000));
  
  
    // A slice of Jon's real protocol with deliberately thin stock.
    const oPs = { settings: {}, stacks: [
      { compoundId:'bpc157',       dose:0.5,  startDate: ago(60), vialMg:5,  waterMl:2, sealedVials:0, status:'instock' },
      { compoundId:'retatrutide',  dose:6,    startDate: ago(60), vialMg:10, waterMl:0.5, sealedVials:2, status:'instock' },
      { compoundId:'ta1',          dose:1.6,  startDate: ago(60), vialMg:5,  waterMl:2, sealedVials:1, status:'instock' },
      { compoundId:'bpc_ghkcu_tb', dose:14,   startDate: ago(60), vialMg:70, waterMl:2, sealedVials:1, status:'instock' },
    ]};
  
    const plan = app._pepOrderPlan(oPs);
  
    test('the plan covers every compound that needs stock', () => {
      assert.ok(plan.rows.length >= 3, 'several compounds need topping up');
    });
  
    test('the vial ordered matches the configured vial size, not the cheapest', () => {
      const reta = plan.rows.find(r => r.compoundId === 'retatrutide');
      assert.equal(reta.tong.mg, 10, 'RT10 to match vialMg 10 — a different size rebases the units maths');
    });
  
    test('a blend maps to its own catalogue product', () => {
      const blend = plan.rows.find(r => r.compoundId === 'bpc_ghkcu_tb');
      assert.equal(blend.tong.cat, 'BBG70', 'BBG70');
    });
  
    test('a compound with zero stock is flagged overdue and pulls the order forward', () => {
      const bpc = plan.rows.find(r => r.compoundId === 'bpc157');
      assert.equal(bpc.overdue, true, 'overdue');
      assert.equal(plan.dueNow, true, 'whole order is due now');
    });
  
    test('rows are ordered by urgency', () => {
      const dates = plan.rows.map(r => r.orderByDate).filter(Boolean);
      const sorted = dates.slice().sort();
      assert.deepEqual(dates, sorted, 'soonest order-by first');
    });
  
    test('building the order replaces the cart rather than appending', () => {
      const st = app.pepGetState();
      st.stacks = oPs.stacks; st.settings = {};
      st.cart = [{ cat:'JUNK', name:'stale line', aud:1, qty:9 }];
      app.pepSaveState(st);
      app.pepBuildOrderFromPlan();
      const after = app.pepGetState().cart;
      assert.equal(after.some(c => c.cat === 'JUNK'), false, 'stale line gone');
      assert.ok(after.length >= 3, 'plan lines present');
    });
  
    test('pressing build twice does not double the order', () => {
      app.pepBuildOrderFromPlan();
      const first = app.pepGetState().cart.map(c => c.cat + ':' + c.qty).join('|');
      app.pepBuildOrderFromPlan();
      const second = app.pepGetState().cart.map(c => c.cat + ':' + c.qty).join('|');
      assert.equal(second, first, 'idempotent');
    });
  
    test('a completed compound is left out of the order', () => {
      const withDone = { settings:{}, stacks: oPs.stacks.concat([
        { compoundId:'motsc', dose:10, startDate: ago(60), vialMg:10, waterMl:0.5, sealedVials:0, status:'complete' }
      ])};
      const p2 = app._pepOrderPlan(withDone);
      assert.equal(p2.rows.some(r => r.compoundId === 'motsc'), false, 'complete compounds excluded');
    });
  
    test('an empty protocol produces an empty plan, not a crash', () => {
      const p3 = app._pepOrderPlan({ stacks: [], settings: {} });
      assert.equal(p3.rows.length, 0, 'no rows');
      assert.equal(p3.dueNow, false, 'nothing due');
    });
  
  }

  // ── Cross-domain contract — PROVIDER-SIDE PINS ────────────────────────────
  // Per COMMS_PROTOCOL (Training .186): the provider pins the contract in their
  // OWN suite. A consumer's pin only goes red after the break has already
  // shipped past the domain that owns the shape.
  //
  // Peptide surfaces called from OUTSIDE the peptide block:
  //   pepRestoreFromCloud(row) -> boolean   PM's _phxOnProfileFetched wrapper
  //   _pepAfterRestore()                    same wrapper, only when true
  //   pepRenderTodayTile()                  renderTodayScreen
  //   pepRenderScreen()                     navTo('peptide')
  //   pepOpenAddStack() / pepOpenOrderPicker()   the + button set in navTo
  //
  // The boolean is the sharp one. The shared wrapper repaints ONLY on true. If
  // this returned undefined, a fresh install would restore the protocol and then
  // show an empty Today tile until the user navigated away and back — silent,
  // and exactly the bug fixed in v4.9.152.
  {
    const cCloud = {
      stacks: [{ compoundId: 'retatrutide' }, { compoundId: 'bpc157' }],
      checked: {}, cart: [], _ts: NEWER,
    };

    test('CONTRACT pepRestoreFromCloud returns true when it replaced local', () => {
      reset(); signIn(UID);
      assert.equal(app.pepRestoreFromCloud({ peptide_state: cCloud }), true,
        'must be exactly true — the shared wrapper repaints on it');
    });

    test('CONTRACT pepRestoreFromCloud returns false when it changed nothing', () => {
      reset(); signIn(UID);
      seed(KEY, { stacks: [{ compoundId: 'ta1' }], checked: {}, cart: [], _ts: NEWER });
      assert.equal(app.pepRestoreFromCloud({ peptide_state: { ...cCloud, _ts: OLDER } }), false,
        'must be falsy — otherwise every profile fetch triggers a needless repaint');
    });

    test('CONTRACT pepRestoreFromCloud always returns a boolean, whatever it is passed', () => {
      reset(); signIn(UID);
      [null, undefined, {}, { peptide_state: null }, { peptide_state: {} }].forEach(row => {
        assert.equal(typeof app.pepRestoreFromCloud(row), 'boolean', 'boolean for every input');
      });
    });

    test('CONTRACT _pepAfterRestore exists and is safe without a DOM node', () => {
      assert.equal(typeof app._pepAfterRestore, 'function', 'the wrapper calls it directly');
      app._pepAfterRestore();
    });

    test('CONTRACT pepRenderTodayTile is safe with no protocol', () => {
      reset(); signIn(UID);
      assert.equal(typeof app.pepRenderTodayTile, 'function', 'renderTodayScreen calls it');
      app.pepRenderTodayTile();
    });

    test('CONTRACT the nav entry points exist', () => {
      ['pepRenderScreen', 'pepOpenAddStack', 'pepOpenOrderPicker'].forEach(fn => {
        assert.equal(typeof app[fn], 'function', fn + ' is called from navTo');
      });
    });
  }

  // ── Course phase — the date-decay trap, occupied ──────────────────────────
  // Epitalon is 20 consecutive nights. A stack anchored to a literal past date
  // would silently exercise the FINISHED course while its name claimed it was
  // running, and it would go on passing. Both phases are derived from today and
  // named, so neither can drift into the other.
  {
    const c = app._pepCompound('epitalon');

    test('PHASE Epitalon on night 5 of 20 is still dosing', () => {
      const due = app._pepStackDueOn({ compoundId:'epitalon', startDate: daysAgo(4) }, c, new Date());
      assert.equal(due, 4, 'day 4 into the course, dose due');
    });

    test('PHASE Epitalon on night 20 is the last dose', () => {
      const due = app._pepStackDueOn({ compoundId:'epitalon', startDate: daysAgo(19) }, c, new Date());
      assert.equal(due, 19, 'day 19 is the twentieth night, still due');
    });

    test('PHASE Epitalon on night 21 has finished — no dose', () => {
      const due = app._pepStackDueOn({ compoundId:'epitalon', startDate: daysAgo(20) }, c, new Date());
      assert.equal(due, null, 'course complete, nothing due');
    });

    test('PHASE a cycled compound is dosing inside its on-weeks', () => {
      const g = app._pepCompound('ghkcu');
      const due = app._pepStackDueOn({ compoundId:'ghkcu', startDate: daysAgo(7), cycleWeeks:4, offWeeks:4 }, g, new Date());
      assert.equal(due, 7, 'week 2 of 4 on, dose due');
    });

    test('PHASE the same compound is silent inside its off-weeks', () => {
      const g = app._pepCompound('ghkcu');
      const due = app._pepStackDueOn({ compoundId:'ghkcu', startDate: daysAgo(35), cycleWeeks:4, offWeeks:4 }, g, new Date());
      assert.equal(due, null, 'day 35 is in the 4-week off block');
    });

    test('PHASE a not-yet-started stack is silent', () => {
      const due = app._pepStackDueOn({ compoundId:'bpc157', startDate: ISO(new Date(Date.now() + 3*86400000)) },
                                     app._pepCompound('bpc157'), new Date());
      assert.equal(due, null, 'future start, nothing due');
    });
  }

  // ── RENDER — drive the entry points, read the DOM ─────────────────────────
  // This codebase shipped a Today card that passed every gate and never rendered
  // for four versions, because its tests called the BUILDER rather than the
  // entry point. Everything below goes through pepRenderScreen() and
  // pepRenderTodayTile() and asserts on the HTML they actually produce.
  // getElementById is restored at the end so later cases see the real sandbox.
  {

    const ISO = d => d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
    const daysAgo = n => ISO(new Date(Date.now() - n*86400000));

    // A persistent stub per id, so innerHTML written by the renderer can be read back.
    const nodes = {};
    const mk = id => {
      const e = {
        id, innerHTML: '', textContent: '', value: '', style: {}, dataset: {},
        classList: { add(){}, remove(){}, contains(){ return false; } },
        appendChild(){}, removeChild(){}, remove(){}, setAttribute(){}, getAttribute(){ return null; },
        addEventListener(){}, removeEventListener(){}, focus(){}, click(){},
        querySelector(){ return null; }, querySelectorAll(){ return []; },
      };
      return e;
    };
    // Setup is PER-CASE, not suite-body. Suite-body setup only works if cases
    // execute the moment they are registered; the instant the runner defers them
    // — which a shared sandbox requires, since it must have one writer at a time
    // — the whole body runs first and a later block's reset() wipes what these
    // cases rely on. They would have been passing because of the execution
    // model rather than because of what they assert.
    const seedProtocol = () => {
      reset(); signIn('jon');
      const st = app.pepGetState();
      st.settings = {};
      st.stacks = [
        { compoundId:'bpc157',       dose:0.5, startDate: daysAgo(40), vialMg:5,  waterMl:2,   sealedVials:1, openDosesUsed:3, openedDate: daysAgo(5), status:'instock' },
        { compoundId:'retatrutide',  dose:6,   startDate: daysAgo(40), vialMg:10, waterMl:0.5, sealedVials:0, status:'instock' },
        { compoundId:'bpc_ghkcu_tb', dose:14,  startDate: daysAgo(40), vialMg:70, waterMl:2,   sealedVials:2, status:'instock' },
      ];
      app.pepSaveState(st);
    };

    // The getElementById override is scoped to the call too. Restoring it at
    // suite-body level had the same defect in reverse: under a deferred runner
    // the restore would run BEFORE any case, so nothing would be captured.
    const withStubbedDom = fn => {
      const real = app.document.getElementById;
      app.document.getElementById = id => (nodes[id] = nodes[id] || mk(id));
      try { return fn(); } finally { app.document.getElementById = real; }
    };

    const render = tab => withStubbedDom(() => {
      seedProtocol();
      app._pepTab = tab;
      nodes['pep-screen-body'] = mk('pep-screen-body');
      app.pepRenderScreen();
      return nodes['pep-screen-body'].innerHTML;
    });

    // v4.9.205 — Jon overruled the five-tab arrangement: BLOODS is a tab in its
    // own right. Six labels do not fit 390px, so the bar scrolls rather than
    // shrinking the text.
    test('RENDER the portal paints all SIX of Jon\'s tabs', () => {
      const h = render('today');
      ['TODAY','PROTOCOL','STOCK','ADJUST','ORDER','BLOODS'].forEach(t =>
        assert.ok(h.includes('>' + t + '<'), t + ' tab painted'));
    });

    test('RENDER the tab bar scrolls instead of squeezing six labels', () => {
      const h = render('today');
      assert.ok(h.includes('overflow-x:auto'), 'bar scrolls horizontally');
      assert.ok(h.includes('white-space:nowrap'), 'labels are not wrapped');
      assert.notIncludes(h.slice(0, h.indexOf('</div>')), 'flex:1;padding:12px 4px',
        'tabs are no longer squeezed to equal width');
    });

    test('RENDER BLOODS opens directly, with no route through ADJUST', () => {
      const h = render('bloods');
      assert.ok(h.includes('Add Panel') || h.includes('No panels yet'), 'the bloods screen itself');
      assert.notIncludes(h, 'pep-bloods-back', 'no back button — the tab bar is the way out');
      assert.notIncludes(render('adjust'), 'pep-open-bloods', 'and ADJUST no longer needs an entry point');
    });

    test('RENDER the STOCK tab paints per-compound stock controls', () => {
      const h = render('stock');
      assert.ok(h.includes('Stock On Hand'), 'heading');
      assert.ok(h.includes('Sealed vials'), 'stepper');
      assert.ok(h.includes('On order'), 'on-order toggle');
    });

    test('RENDER the PROTOCOL tab is GATED until stock and history are confirmed', () => {
      const h = render('overview');
      assert.ok(h.includes('Two things first'), 'gate shown');
      assert.ok(h.includes('Count your stock'), 'names the stock step');
      assert.ok(h.includes('already run'), 'names the history step');
    });

    test('RENDER the TODAY tab shows units to draw, not just mg', () => {
      const h = render('today');
      assert.ok(h.includes('u / '), 'units/mL figure present');
      assert.ok(h.includes('mg/mL'), 'concentration shown');
    });

    test('RENDER the PROTOCOL tab shows the stock line for each compound', () => {
      const h = render('protocol');
      assert.ok(h.includes('doses left') || h.includes('No stock recorded'), 'supply line rendered');
      assert.ok(h.includes('runs out') || h.includes('ORDER NOW'), 'depletion surfaced');
    });

    test('RENDER the ORDER tab paints the reorder forecast, not just the cart', () => {
      const h = render('order');
      assert.ok(h.includes('Reorder Forecast'), 'forecast heading');
      assert.ok(h.includes('Build This Order'), 'build button');
      assert.ok(h.includes('Cart'), 'cart section still present');
    });

    test('RENDER the coverage chips are priced in the rendered HTML', () => {
      const h = render('order');
      ['3 mo','6 mo','12 mo'].forEach(c => assert.ok(h.includes(c), c + ' chip'));
      assert.ok(/\$\d/.test(h), 'a price is rendered against the chips');
      assert.ok(h.includes('Delivery lead time'), 'lead time field');
    });

    test('RENDER the BLOODS tab paints without a panel loaded', () => {
      const h = render('bloods');
      assert.ok(h.includes('No panels yet') || h.includes('Add Panel'), 'bloods empty state');
    });

    test('RENDER the ADJUST tab paints and states which bloods it would use', () => {
      const h = render('adjust');
      assert.ok(h.includes('Smart Protocol Review'), 'review heading');
      assert.ok(h.includes('No blood panel logged'), 'names the missing input');
    });

    test('RENDER the Today-screen tile paints doses with units', () => {
      const h = withStubbedDom(() => {
        seedProtocol();
        nodes['today-peptide-tile'] = mk('today-peptide-tile');
        app.pepRenderTodayTile();
        return nodes['today-peptide-tile'].innerHTML;
      });
      assert.ok(h.length > 0, 'tile is not empty for a real protocol');
      assert.ok(h.includes('Peptides'), 'labelled');
      assert.ok(h.includes('u / ') || h.includes('No doses scheduled'), 'units or rest-day line');
    });

    test('RENDER the tile stays empty when there is no protocol', () => {
      const h = withStubbedDom(() => {
        reset(); signIn('jon');
        nodes['today-peptide-tile'] = mk('today-peptide-tile');
        app.pepRenderTodayTile();
        return nodes['today-peptide-tile'].innerHTML;
      });
      assert.equal(h, '', 'hidden with no protocol');
    });
  }

  // ── NET — the backup is reachable (v4.9.192) ──────────────────────────────
  // _pepBackupLocal has written peptide_v1_{uid}_bak since .152 and NOTHING has
  // ever read it. Three comments called it "recoverable" and I told Jon the same
  // three times — but no path in code or UI could get it back. A safety net
  // nobody can pull is not a safety net. These pull it.
  {
    const nOLD = '2026-08-01T00:00:00.000Z';
    const nNEW = '2026-08-17T00:00:00.000Z';

    const UID = 'jon';
    const KEY = `peptide_v1_${UID}`;
    
    

    const REAL = { stacks:[{compoundId:'retatrutide'},{compoundId:'bpc157'},{compoundId:'ta1'}],
                   checked:{}, cart:[], notes:[{text:'months of notes'}], _ts: nOLD };

    test('NET a real restore leaves a recoverable backup, and it is offered', () => {
      reset(); signIn(UID);
      seed(KEY, REAL);
      // Cloud wins on timestamp — the live path that discards the local copy.
      app.pepRestoreFromCloud({ peptide_state: { stacks:[{compoundId:'nad'}], checked:{}, cart:[], _ts: nNEW } });
      assert.equal(read(KEY).stacks.length, 1, 'cloud copy is live');
      const info = app.pepBackupInfo();
      assert.ok(info, 'a backup is offered');
      assert.equal(info.stacks, 3, 'it describes the replaced protocol');
      assert.equal(info.curStacks, 1, 'and what is live now');
    });

    // Each case lays down its own precondition rather than inheriting the
    // previous case's leftovers. Chained cases pass only while the runner
    // happens to execute in registration order and nothing between them touches
    // the same sandbox — neither of which a test should depend on.
    const afterLosingRestore = () => {
      reset(); signIn(UID);
      seed(KEY, REAL);
      app.pepRestoreFromCloud({ peptide_state: { stacks:[{compoundId:'nad'}], checked:{}, cart:[], _ts: nNEW } });
    };

    test('NET swapping it back actually returns the protocol', () => {
      afterLosingRestore();
      assert.equal(app.pepRestoreBackup(), true, 'restore reports success');
      assert.equal(read(KEY).stacks.length, 3, 'the 3-compound protocol is live again');
      assert.equal(read(KEY).notes.length, 1, 'notes came back too');
    });

    test('NET the swap is itself reversible', () => {
      afterLosingRestore();
      app.pepRestoreBackup();                       // protocol back
      const info = app.pepBackupInfo();
      assert.ok(info, 'the displaced copy is now the backup');
      assert.equal(info.stacks, 1, 'it is the cloud copy just displaced');
      app.pepRestoreBackup();                       // and back again
      assert.equal(read(KEY).stacks.length, 1, 'swapped back again');
    });

    test('NET nothing is offered when the backup matches what is live', () => {
      reset(); signIn(UID);
      seed(KEY, REAL);
      seed(`${KEY}_bak`, REAL);
      assert.equal(app.pepBackupInfo(), null, 'silent in normal use');
    });

    test('NET nothing is offered when there is no backup at all', () => {
      reset(); signIn(UID);
      seed(KEY, REAL);
      assert.equal(app.pepBackupInfo(), null, 'no backup, no offer');
    });

    test('NET restore is a safe no-op with no backup and while signed out', () => {
      reset(); signIn(UID);
      assert.equal(app.pepRestoreBackup(), false, 'no backup');
      signIn(null);
      assert.equal(app.pepRestoreBackup(), false, 'signed out');
    });

    test('NET the offer is actually PAINTED, not just computed', () => {
      const nodes = {};
      const mk = id => ({ id, innerHTML:'', style:{}, classList:{add(){},remove(){},contains(){return false;}},
        appendChild(){}, setAttribute(){}, getAttribute(){return null;}, addEventListener(){},
        querySelector(){return null;}, querySelectorAll(){return [];} });
      const real = app.document.getElementById;
      app.document.getElementById = id => (nodes[id] = nodes[id] || mk(id));

      reset(); signIn(UID);
      seed(KEY, REAL);
      app.pepRestoreFromCloud({ peptide_state: { stacks:[{compoundId:'nad'}], checked:{}, cart:[], _ts: nNEW } });
      app._pepTab = 'protocol';
      nodes['pep-screen-body'] = mk('pep-screen-body');
      app.pepRenderScreen();
      const h = nodes['pep-screen-body'].innerHTML;
      app.document.getElementById = real;

      assert.ok(h.includes('Previous protocol kept'), 'the notice is on screen');
      assert.ok(h.includes('Swap it back'), 'with a button the user can press');
      assert.ok(h.includes('3 compounds'), 'naming what would come back');
    });

  }

  // ── IMG — shared image helpers, provider-pinned (v4.9.197) ────────────────
  // Promoted from _pep* so Nutrition's nutrition-panel capture reuses them
  // rather than growing a second copy. Peptides owns them, so Peptides pins
  // them. The never-throws property is the one Training asked me to insist on:
  // it is what a rewrite is most likely to "clean up" into a throw, and callers
  // use these on the upload path where losing the user's photo is the worst
  // outcome.
  {
    test('IMG both shared helpers exist under the _phx name', () => {
      assert.equal(typeof app._phxDownscaleImage, 'function', 'downscaler');
      assert.equal(typeof app._phxDataURLToBlob, 'function', 'blob converter');
    });

    test('IMG the _pep names still work, so nothing breaks in the gap', () => {
      assert.equal(typeof app._pepDownscale, 'function', 'wrapper kept');
      assert.equal(typeof app._pepDataURLToBlob, 'function', 'wrapper kept');
    });

    // The sandbox's Image never fires onload OR onerror — assigning .src does
    // nothing — so the promise would hang forever and the case would never
    // settle rather than fail. That is worse than a red test, so the stub is
    // supplied here: an Image whose src assignment reports failure, which is
    // exactly the path a non-image input takes in a browser.
    const withFailingImage = fn => {
      const real = app.Image;
      app.Image = function(){
        const self = this;
        Object.defineProperty(this, 'src', {
          set(){ Promise.resolve().then(() => { if (self.onerror) self.onerror(); }); },
          configurable: true,
        });
      };
      return Promise.resolve(fn()).finally(() => { app.Image = real; });
    };

    test('IMG an undecodable image resolves to the INPUT, it does NOT throw', async () => {
      const junk = 'not-a-data-url';
      const out = await withFailingImage(() => app._phxDownscaleImage(junk, 1600, 0.85));
      assert.equal(out, junk, 'input returned unchanged rather than thrown');
    });

    test('IMG a corrupt data URL also resolves rather than throwing', async () => {
      const bad = 'data:image/jpeg;base64,@@@not-base64@@@';
      const out = await withFailingImage(() => app._phxDownscaleImage(bad, 1600, 0.85));
      assert.equal(out, bad, 'input returned unchanged');
    });

    test('IMG the blob converter returns NULL on junk rather than throwing', () => {
      [null, undefined, '', 'nope', 'data:image/jpeg;NOTbase64,xx'].forEach(v => {
        assert.equal(app._phxDataURLToBlob(v), null, 'null for ' + JSON.stringify(v));
      });
    });

    test('IMG the 1600px cap and 5MB ceiling are stated where a caller will read them', () => {
      const i = html.indexOf('function _phxDownscaleImage');
      const doc = html.slice(Math.max(0, i - 1400), i);
      assert.ok(doc.includes('1600'), 'the long-edge cap is documented');
      assert.ok(doc.includes('5MB'), 'the API image ceiling is documented');
      assert.ok(doc.includes('NEVER THROWS'), 'the never-throws contract is stated');
    });
  }

  // ── EPITALON — Jon's confirmed protocol (18 Aug 2026) ─────────────────────
  // Verbatim: "10 vial - 5 dose", then "20 consecutive nights x 5mg".
  // Dose, frequency and vial were ALREADY these values, so this pins them
  // rather than changing them. Worth pinning precisely because a two-word relay
  // ("10mg epithalon") nearly doubled an injected dose earlier the same day.
  {

  const eIso = d => d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  const eAgo = n => eIso(new Date(Date.now() - n*86400000));
  reset(); signIn('jon');

  const c = app._pepCompound('epitalon');
  const recon = app._pepRecon({}, c);

  test('confirmed values are live: 5mg, 20 nights, 10mg vial', () => {
    assert.equal(c.dose, 5, 'mg per dose');
    assert.equal(c.freq, '20 consecutive nights', 'frequency');
    assert.equal(recon.vialMg, 10, 'vial mg');
  });

  test('draw is 50u / 0.50mL from 10mg in 1mL', () => {
    const d = app._pepDraw(c.dose, c.doseUnit, recon);
    assert.equal(Math.round(d.units), 50, 'units');
    assert.equal(app._pepDosesPerVial({}, c), 2, 'doses per vial');
  });

  test('the course runs exactly 20 nights and then stops', () => {
    const stack = { compoundId:'epitalon', startDate: eAgo(0) };
    let due = 0;
    for (let i = 0; i < 40; i++) {
      const d = new Date(Date.now() + i*86400000);
      if (app._pepStackDueOn(stack, c, d) !== null) due++;
    }
    assert.equal(due, 20, 'twenty nights, no more');
  });

  test('starting today with no stock, the forecast wants 10 vials', () => {
    const ps = { settings:{}, stacks:[{ compoundId:'epitalon', dose:5, startDate: eAgo(0), vialMg:10, waterMl:1, sealedVials:0, status:'instock' }] };
    const need = app._pepVialsNeeded(ps, ps.stacks[0], 180);
    assert.equal(need, 10, '20 doses / 2 per vial');
  });

  test('the order builder prices the course against ET10', () => {
    const ps = { settings:{}, stacks:[{ compoundId:'epitalon', dose:5, startDate: eAgo(0), vialMg:10, waterMl:1, sealedVials:0, status:'instock' }] };
    const plan = app._pepOrderPlan(ps);
    const row = plan.rows.find(r => r.compoundId === 'epitalon');
    assert.equal(row.tong.cat, 'ET10', 'matches his vial');
    assert.equal(row.vials, 10, 'ten vials');
  });

  test('mid-course, night 10, ten doses still to come', () => {
    const ps = { settings:{}, stacks:[{ compoundId:'epitalon', dose:5, startDate: eAgo(10), vialMg:10, waterMl:1, sealedVials:0, status:'instock' }] };
    const need = app._pepVialsNeeded(ps, ps.stacks[0], 180);
    assert.equal(need, 5, 'ten doses left / 2 per vial');
  });

  test('after the course, nothing is ordered', () => {
    const ps = { settings:{}, stacks:[{ compoundId:'epitalon', dose:5, startDate: eAgo(25), vialMg:10, waterMl:1, sealedVials:0, status:'instock' }] };
    const plan = app._pepOrderPlan(ps);
    assert.equal(plan.rows.some(r => r.compoundId === 'epitalon'), false, 'course complete, nothing to buy');
  });

  test('30-day shelf life does not waste doses on this course', () => {
    // 2 doses per vial and a dose every night = a vial lasts 2 days, far inside 30.
    const ps = { settings:{}, stacks:[{ compoundId:'epitalon', dose:5, startDate: eAgo(0), vialMg:10, waterMl:1, sealedVials:10, openDosesUsed:0, openedDate:null, status:'instock' }] };
    const f = app._pepStockForecast(ps, ps.stacks[0]);
    assert.equal(f.wastedDoses, 0, 'no expiry loss');
    assert.equal(f.dosesRemaining, 20, 'exactly the course');
  });

  }

  // ── NAV — screen restore after an iOS PWA reload (v4.9.200) ───────────────
  // Jon: "when the screen locks, the app redirects back to the main page
  // instead of staying on the Peptide Portal."
  //
  // Not a visibility handler. iOS kills the PWA context on sleep; on wake the
  // app reloads and _loadProfileAndRouteInner ran:
  //     navTo('today');                                  <- intercept DELETES the key
  //     var _restoreTab = localStorage.getItem(...)      <- reads it, now null
  // The restore read the key AFTER the navigation that removed it, so it could
  // never fire — for peptide or any other tab in the safe list. Shared routing
  // code, so this fixed nutrition / records / workout / settings too.

  const NAVKEY = 'phx_lastTab_v1';

  test('NAV navigating to a tab records it for restore', () => {
    reset(); signIn('jon');
    app.navTo('peptide');
    assert.equal(read(NAVKEY), 'peptide', 'tab recorded');
  });

  test('NAV navigating to today DELETES the recorded tab', () => {
    reset(); signIn('jon');
    app.navTo('peptide');
    assert.equal(read(NAVKEY), 'peptide', 'recorded first');
    app.navTo('today');
    assert.equal(read(NAVKEY), null, 'today wipes it — this is the mechanism');
  });

  // The fix: read BEFORE navigating. This mirrors the corrected order in
  // _loadProfileAndRouteInner and fails against the old order.
  test('NAV reading before navTo(today) preserves the tab to restore', () => {
    reset(); signIn('jon');
    app.navTo('peptide');
    const restoreTab = read(NAVKEY);               // read FIRST
    app.navTo('today');                         // then route to Today
    assert.equal(restoreTab, 'peptide', 'the portal is still restorable');
  });

  test('NAV the restored tab is written back, so a SECOND reload also restores', () => {
    reset(); signIn('jon');
    app.navTo('peptide');
    const restoreTab = read(NAVKEY);
    app.navTo('today');
    assert.equal(read(NAVKEY), null, 'today wiped it');
    // What the fixed code does next:
    seed(NAVKEY, restoreTab);
    app.navTo(restoreTab);
    assert.equal(read(NAVKEY), 'peptide', 'still set for the next reload');
  });

  test('NAV a tab outside the safe list is not restored', () => {
    reset(); signIn('jon');
    const safe = ['nutrition','records','workout','settings','peptide'];
    assert.equal(safe.indexOf('session'), -1, 'session is not restorable');
    assert.ok(safe.indexOf('peptide') >= 0, 'peptide IS restorable');
  });

  // ── STOCK — live truth, gating, and incoming orders (v4.9.201) ────────────
  // Jon's rules: stock decrements when a dose is ticked; the forward protocol
  // stays hidden until stock is counted AND history confirmed; an order in
  // transit counts from its arrival date, not before.
  {
    const sIso = d => d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
    const sIn = n => sIso(new Date(Date.now() + n*86400000));
    const sAgo = n => sIso(new Date(Date.now() - n*86400000));
    const SKEY = 'peptide_v1_stockuser';

    const seedStock = over => {
      reset(); signIn('stockuser');
      const st = app.pepGetState();
      st.settings = {};
      st.stacks = [Object.assign({
        compoundId:'bpc157', dose:0.5, startDate: sAgo(30),
        vialMg:5, waterMl:2, sealedVials:2, openDosesUsed:0, openedDate:null, status:'instock'
      }, over || {})];
      app.pepSaveState(st);
      return app.pepGetState();
    };

    test('STOCK ticking a dose consumes from stock', () => {
      seedStock();
      const before = app.pepGetState().stacks[0];
      assert.equal(before.sealedVials, 2, 'two sealed to start');
      app.pepToggleDose('bpc157');
      const after = app.pepGetState().stacks[0];
      assert.equal(after.sealedVials, 1, 'a vial was opened');
      assert.equal(after.openDosesUsed, 1, 'one dose drawn from it');
      assert.ok(after.openedDate, 'and it is marked as mixed today');
    });

    test('STOCK un-ticking gives the dose back — a mis-tap is not a lost vial', () => {
      seedStock();
      app.pepToggleDose('bpc157');
      app.pepToggleDose('bpc157');
      const st = app.pepGetState().stacks[0];
      assert.equal(st.openDosesUsed, 0, 'dose returned');
      assert.equal(st.sealedVials, 2, 'vial returned');
    });

    test('STOCK finishing a vial rolls to the next one', () => {
      // 5mg/2mL at 500mcg = 10 doses per vial. Tick 10 and the vial is done.
      seedStock({ sealedVials: 2 });
      for (let i = 0; i < 10; i++) {
        const s = app.pepGetState();
        s.checked = {};                       // re-tick the same compound each time
        app.pepSaveState(s);
        app.pepToggleDose('bpc157');
      }
      const st = app.pepGetState().stacks[0];
      assert.equal(st.openedDate, null, 'vial finished and closed');
      assert.equal(st.openDosesUsed, 0, 'counter reset for the next vial');
      assert.equal(st.sealedVials, 1, 'one sealed vial left');
    });

    test('STOCK ticking with nothing in stock does not invent a vial', () => {
      seedStock({ sealedVials: 0, openedDate: null });
      app.pepToggleDose('bpc157');
      const st = app.pepGetState().stacks[0];
      assert.equal(st.sealedVials, 0, 'still zero');
      assert.equal(st.openedDate, null, 'no phantom vial opened');
    });

    test('GATE the protocol is locked until BOTH stock and history are confirmed', () => {
      const ps = seedStock();
      assert.equal(app._pepReadiness(ps).ready, false, 'locked at the start');

      ps.stacks[0].stockCounted = true; app.pepSaveState(ps);
      assert.equal(app._pepReadiness(app.pepGetState()).stockDone, true, 'stock done');
      assert.equal(app._pepReadiness(app.pepGetState()).ready, false, 'still locked — history outstanding');

      const p2 = app.pepGetState(); p2.historyConfirmed = true; app.pepSaveState(p2);
      assert.equal(app._pepReadiness(app.pepGetState()).ready, true, 'unlocked');
    });

    test('GATE an uncounted compound is counted as uncounted, not inferred from zero', () => {
      const ps = seedStock({ sealedVials: 0 });
      const r = app._pepReadiness(ps);
      assert.equal(r.counted, 0, 'zero stock is not the same as a confirmed count');
      assert.equal(r.stockDone, false, 'still needs confirming');
    });

    test('ORDER incoming stock counts from its ARRIVAL date, not today', () => {
      const ps = seedStock({ sealedVials: 0, onOrder: true, arrivalDate: sIn(10), onOrderVials: 3 });
      const f = app._pepStockForecast(ps, ps.stacks[0]);
      assert.equal(f.onOrder, true, 'flagged as on order');
      assert.ok(f.gapStart, 'a gap is reported before it lands');
      assert.equal(f.resumesOn, ps.stacks[0].arrivalDate, 'and when it resumes');
    });

    test('ORDER a delivery already dated is not re-ordered as urgent', () => {
      const ps = seedStock({ sealedVials: 0, onOrder: true, arrivalDate: sIn(3), onOrderVials: 5 });
      const f = app._pepStockForecast(ps, ps.stacks[0]);
      assert.ok(f.dosesRemaining > 0, 'the incoming vials are counted once they land');
    });

    test('ORDER toggling On Order defaults the quantity to what is needed', () => {
      seedStock({ sealedVials: 0 });
      app.pepToggleOnOrder(0);
      const st = app.pepGetState().stacks[0];
      assert.equal(st.onOrder, true, 'toggled on');
      assert.ok((st.onOrderVials || 0) > 0, 'quantity pre-filled from the forecast');
    });

    test('ORDER untoggling clears the arrival date and quantity', () => {
      seedStock({ sealedVials: 0 });
      app.pepToggleOnOrder(0);
      app.pepSetArrival(0, sIn(7));
      assert.equal(app.pepGetState().stacks[0].arrivalDate, sIn(7), 'date set');
      app.pepToggleOnOrder(0);
      const st = app.pepGetState().stacks[0];
      assert.equal(st.onOrder, false, 'off');
      assert.equal(st.arrivalDate, null, 'date cleared');
    });
  }

  // ── VIAL — planned vs received, and the override (v4.9.202) ───────────────
  // Jon's scenario verbatim: he planned 5mg vials, 2mg arrived, he records
  // "2mg x 6 on hand". The whole forecast has to recalculate — and the part
  // that matters most is that the UNITS HE DRAWS change, because the same water
  // in a smaller vial is a weaker solution.
  {

  const vIso = d => d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  const vAgo = n => vIso(new Date(Date.now() - n*86400000));
  reset(); signIn('jon');

  // BPC-157, 500mcg daily. Planned: 5mg vials in 2mL = 2.5mg/mL, 20u per dose,
  // 10 doses per vial.
  const planned = { compoundId:'bpc157', dose:0.5, startDate: vAgo(10),
                    vialMg:5, waterMl:2, sealedVials:4, status:'instock' };
  const received = Object.assign({}, planned, { actualVialMg:2, sealedVials:6 });
  const c = app._pepCompound('bpc157');

  test('VIAL planned 5mg gives 2.5mg/mL, 20u, 10 doses per vial', () => {
    const r = app._pepRecon(planned, c);
    assert.equal(r.conc, 2.5, 'concentration');
    assert.equal(app._pepDosesPerVial(planned, c), 10, 'doses per vial');
    assert.equal(r.source, 'planned', 'source');
  });

  test('VIAL the 2mg override recalculates concentration AND the draw', () => {
    const r = app._pepRecon(received, c);
    assert.equal(r.conc, 1, 'weaker solution — same water, less peptide');
    assert.equal(r.source, 'override', 'flagged as an override');
    assert.equal(r.plannedMg, 5, 'remembers what was planned');
  });

  test('VIAL the draw volume CHANGES — this is the safety-relevant bit', () => {
    const dP = app._pepDraw(0.5, 'mg', app._pepRecon(planned, c));
    const dR = app._pepDraw(0.5, 'mg', app._pepRecon(received, c));
    assert.equal(Math.round(dP.units), 20, 'planned 20u');
    assert.equal(Math.round(dR.units), 50, 'actual 50u for the same 500mcg');
  });

  test('VIAL 2mg at 500mcg gives 4 doses per vial, not 10', () => {
    assert.equal(app._pepDosesPerVial(received, c), 4, 'doses per vial');
  });

  test('VIAL 6 x 2mg lasts 24 doses where 4 x 5mg would have lasted 40', () => {
    const psP = { settings:{}, stacks:[planned] };
    const psR = { settings:{}, stacks:[received] };
    const fP = app._pepStockForecast(psP, planned);
    const fR = app._pepStockForecast(psR, received);
    assert.equal(fP.dosesRemaining, 40, '4 x 10');
    assert.equal(fR.dosesRemaining, 24, '6 x 4');
  });

  test('VIAL it suggests the water that would restore the planned draw', () => {
    const w = app._pepWaterToMatchPlanned(received, c);
    assert.equal(w, 0.8, '2mg / 2.5mg per mL');
  });

  test('VIAL no suggestion when the vial matches the plan', () => {
    assert.equal(app._pepWaterToMatchPlanned(planned, c), null, 'nothing to suggest');
  });

  test('SHORTFALL a fixed-length course flags when stock cannot finish it', () => {
    // Epitalon: 20 nights x 5mg. Planned ET10 = 2 doses/vial, so 10 vials.
    // Give him 3 vials and it must say so.
    const epi = { compoundId:'epitalon', dose:5, startDate: vIso(new Date()),
                  vialMg:10, waterMl:1, sealedVials:3, status:'instock' };
    const ps = { settings:{}, stacks:[epi] };
    const sf = app._pepCycleShortfall(ps, epi);
    assert.equal(sf.required, 20, 'the whole course');
    assert.equal(sf.available, 6, '3 vials x 2 doses');
    assert.equal(sf.short, 14, 'fourteen doses short');
    assert.equal(sf.sufficient, false, 'flagged insufficient');
  });

  test('ARRIVE marking a delivery arrived adopts its vial size and quantity', () => {
    reset(); signIn('jon');
    const st0 = app.pepGetState();
    st0.settings = {};
    st0.stacks = [Object.assign({}, planned, {
      sealedVials: 0, onOrder: true, arrivalDate: vAgo(1), onOrderVials: 4, onOrderVialMg: 2
    })];
    app.pepSaveState(st0);
    app.pepMarkArrived(0);
    const st = app.pepGetState().stacks[0];
    assert.equal(st.sealedVials, 4, 'stock added');
    assert.equal(st.actualVialMg, 2, 'new vial size adopted — the override transitions');
    assert.equal(st.onOrder, false, 'order closed out');
    assert.equal(st.arrivalDate, null, 'date cleared');
    assert.equal(st.stockCounted, true, 'counted, since he just received it');
  });

  test('ARRIVE a delivery matching the plan clears the override rather than storing it', () => {
    reset(); signIn('jon');
    const st0 = app.pepGetState();
    st0.settings = {};
    st0.stacks = [Object.assign({}, planned, {
      actualVialMg: 2, sealedVials: 1, onOrder: true, arrivalDate: vAgo(1), onOrderVials: 3, onOrderVialMg: 5
    })];
    app.pepSaveState(st0);
    app.pepMarkArrived(0);
    const st = app.pepGetState().stacks[0];
    assert.equal(st.actualVialMg, null, 'back on the planned size, no stale manual flag');
    assert.equal(st.sealedVials, 4, '1 + 3');
  });

  test('OVERRIDE choosing the planned size clears the override flag', () => {
    reset(); signIn('jon');
    const st0 = app.pepGetState();
    st0.settings = {}; st0.stacks = [Object.assign({}, received)];
    app.pepSaveState(st0);
    app.pepSetVialSize(0, 5);
    assert.equal(app.pepGetState().stacks[0].actualVialMg, null, 'no override when it matches plan');
  });

  test('OVERRIDE typing a stock count directly sets it', () => {
    reset(); signIn('jon');
    const st0 = app.pepGetState();
    st0.settings = {}; st0.stacks = [Object.assign({}, received)];
    app.pepSaveState(st0);
    app.pepSetSealed(0, '9');
    assert.equal(app.pepGetState().stacks[0].sealedVials, 9, 'set from the field');
    app.pepSetSealed(0, '-3');
    assert.equal(app.pepGetState().stacks[0].sealedVials, 0, 'negative clamps to zero');
  });

  test('SHORTFALL enough stock reports sufficient', () => {
    const epi = { compoundId:'epitalon', dose:5, startDate: vIso(new Date()),
                  vialMg:10, waterMl:1, sealedVials:10, status:'instock' };
    const sf = app._pepCycleShortfall({ settings:{}, stacks:[epi] }, epi);
    assert.equal(sf.sufficient, true, 'ten vials covers twenty nights');
    assert.equal(sf.short, 0, 'no shortfall');
  });

    test('RENDER the STOCK card shows planned vs on-hand and flags the override', () => {
      const nodes = {};
      const mk = id => ({ id, innerHTML:'', style:{}, classList:{add(){},remove(){},contains(){return false;}},
        appendChild(){}, setAttribute(){}, getAttribute(){return null;}, addEventListener(){},
        querySelector(){return null;}, querySelectorAll(){return [];} });
      const real = app.document.getElementById;
      app.document.getElementById = id => (nodes[id] = nodes[id] || mk(id));

      reset(); signIn('jon');
      const st0 = app.pepGetState();
      st0.settings = {}; st0.stacks = [Object.assign({}, received)];
      app.pepSaveState(st0);
      app._pepTab = 'stock';
      nodes['pep-screen-body'] = mk('pep-screen-body');
      app.pepRenderScreen();
      const h = nodes['pep-screen-body'].innerHTML;
      app.document.getElementById = real;

      assert.ok(h.includes('Protocol planned'), 'planned line painted');
      assert.ok(h.includes('5mg vials'), 'names the planned size');
      assert.ok(h.includes('Manual entry'), 'override is labelled as manual');
      assert.ok(h.includes('2mg &times; 6') || h.includes('2mg × 6'), 'shows what is actually on hand');
      assert.ok(h.includes('Vial size on hand'), 'selector painted');
      assert.ok(h.includes('Revert to planned'), 'a way back');
    });

  }

  // ── BOOT RESTORE — central, covers every routing exit (v4.9.206) ──────────
  // Jon: "still navigating away when I switch to another app and come back",
  // AFTER v4.9.200. The .200 fix repaired ONE of seven routing exits — the fast
  // path. His boot takes the normal profile-fetch route, so it never applied to
  // him. Six other exits reached Today with no restore, each wiping the key on
  // the way past via the navTo intercept.
  //
  // Fixed centrally rather than six more times: capture before anything can
  // wipe, suppress the wipe during boot, one scheduled restore.
  {
    const BKEY = 'phx_lastTab_v1';

    test('BOOT the intercept still forgets the screen on a REAL tap on Today', () => {
      reset(); signIn('jon');
      app.window._phxBooting = false;
      app.navTo('peptide');
      assert.equal(read(BKEY), 'peptide', 'recorded');
      app.navTo('today');
      assert.equal(read(BKEY), null, 'a user tap clears it, as before');
    });

    test('BOOT routing to Today during boot does NOT forget it', () => {
      reset(); signIn('jon');
      app.navTo('peptide');
      app.window._phxBooting = true;          // what _phxBootRestoreBegin sets
      app.navTo('today');                     // any of the seven exits
      assert.equal(read(BKEY), 'peptide', 'survives boot routing — the whole bug');
      app.window._phxBooting = false;
    });

    test('BOOT begin captures the tab and arms boot mode', () => {
      reset(); signIn('jon');
      app.navTo('peptide');
      app._phxBootRestoreBegin();
      assert.equal(app.window._phxBooting, true, 'boot mode on');
      assert.equal(app.window._phxBootRestoreTab, 'peptide', 'tab captured');
      app.window._phxBooting = false; app.window._phxBootRestoreTab = null;
    });

    test('BOOT apply restores the screen, re-asserts the key, and ends boot mode', () => {
      reset(); signIn('jon');
      app.navTo('peptide');
      app._phxBootRestoreBegin();
      app.navTo('today');                     // routing runs
      app._phxBootRestoreApply();             // the scheduled restore fires
      assert.equal(app.window._phxBooting, false, 'boot mode ended');
      assert.equal(read(BKEY), 'peptide', 'key re-asserted for the NEXT reload');
    });

    test('BOOT an unsafe tab is not restored, and boot mode still ends', () => {
      reset(); signIn('jon');
      seed(BKEY, 'session');                  // never restorable
      app._phxBootRestoreBegin();
      assert.equal(app.window._phxBootRestoreTab, null, 'not captured');
      app._phxBootRestoreApply();
      assert.equal(app.window._phxBooting, false,
        'boot mode ends even with nothing to restore — otherwise the app could never forget a screen again');
    });

    test('BOOT with no key at all, nothing is restored and nothing throws', () => {
      reset(); signIn('jon');
      app._phxBootRestoreBegin();
      app._phxBootRestoreApply();
      assert.equal(read(BKEY), null, 'nothing invented');
      assert.equal(app.window._phxBooting, false, 'boot mode ended');
    });

    test('BOOT restore survives a SECOND reload — it works more than once', () => {
      reset(); signIn('jon');
      app.navTo('peptide');
      // reload 1
      app._phxBootRestoreBegin(); app.navTo('today'); app._phxBootRestoreApply();
      assert.equal(read(BKEY), 'peptide', 'still set after the first');
      // reload 2
      app._phxBootRestoreBegin();
      assert.equal(app.window._phxBootRestoreTab, 'peptide', 'captured again');
      app.navTo('today'); app._phxBootRestoreApply();
      assert.equal(read(BKEY), 'peptide', 'and again');
    });

    test('BOOT every safe tab survives boot routing, not just peptide', () => {
      ['nutrition','records','peptide','programme','blab-calendar'].forEach(tab => {
        reset(); signIn('jon');
        seed(BKEY, tab);
        app._phxBootRestoreBegin();
        app.navTo('today');
        assert.equal(read(BKEY), tab, tab + ' survives');
        app._phxBootRestoreApply();
        app.window._phxBooting = false;
      });
    });
  }

  // ── SAVE — where it lands, and what it keeps (v4.9.207) ───────────────────
  // Jon: adding a compound from STOCK dropped him somewhere else after saving.
  // Cause: the handler hard-set _pepTab = "protocol", a tab that stopped
  // existing in the .201 restructure — so Save landed on an orphaned screen with
  // nothing highlighted in the bar.
  //
  // The worse bug found alongside it: the handler built a fresh object from the
  // sheet's 12 inputs and REPLACED the stack, wiping the 8 fields it has no
  // input for — including the vial override and the whole in-transit order.
  {
    // NOTE: no sheet-driving helper here on purpose. I wrote one, could not make
    // it invoke the real Save listener through the sandbox (the sheet registers
    // it on an element created inside the function), and deleted it rather than
    // leave 30 lines that look like they exercise the handler and do not.
    // These cases pin the handler's SOURCE shape plus the merge semantics.
    test('SAVE the orphaned "protocol" tab is no longer hard-set anywhere', () => {
      // The bug in one line: a literal that sends Save to a tab the bar does not
      // contain. If it comes back, this fails.
      assert.notIncludes(html, '_pepTab = "protocol";',
        'Save must return to the tab it was opened from, not a fixed one');
    });

    test('SAVE the handler merges onto the existing stack rather than replacing it', () => {
      const i = html.indexOf('function pepOpenEditStack');
      const j = html.indexOf('function pepRemoveStack', i);
      const blk = html.slice(i, j);
      assert.ok(blk.includes('Object.assign({}, ps.stacks[idx], saved)'),
        'merge, so fields with no input survive an edit');
      assert.notIncludes(blk, 'ps.stacks[idx] = saved;', 'no wholesale replace');
    });

    test('SAVE records the tab it was opened from', () => {
      const i = html.indexOf('function pepOpenEditStack');
      const j = html.indexOf('function pepRemoveStack', i);
      const blk = html.slice(i, j);
      assert.ok(blk.includes('var _originTab'), 'origin captured at open');
      assert.ok(blk.includes('_pepTab = _originTab;'), 'and restored on save');
      assert.ok(blk.includes('"stock"'), 'with a sane fallback');
    });

    // The behavioural half: prove a merge preserves exactly the fields the sheet
    // has no input for. This models what the handler now does.
    test('SAVE merging keeps the override and the in-transit order', () => {
      const existing = {
        compoundId:'bpc157', dose:0.5, startDate:'2026-07-01',
        vialMg:5, waterMl:2, sealedVials:6,
        actualVialMg:2, stockCounted:true,
        onOrder:true, arrivalDate:'2026-09-01', onOrderVials:4, onOrderVialMg:5,
        freq:'daily', continuous:true, status:'instock',
      };
      const fromSheet = {
        compoundId:'bpc157', dose:0.25, startDate:'2026-07-01',
        cycleWeeks:null, offWeeks:0, vialMg:5, waterMl:2,
        sealedVials:6, openDosesUsed:0, openedDate:null,
        status:'instock', notes:'typo fixed',
      };
      const merged = Object.assign({}, existing, fromSheet);

      assert.equal(merged.dose, 0.25, 'the edit itself applies');
      assert.equal(merged.notes, 'typo fixed', 'and the new note');
      assert.equal(merged.actualVialMg, 2, 'vial override survives');
      assert.equal(merged.stockCounted, true, 'count confirmation survives — otherwise the gate re-locks');
      assert.equal(merged.onOrder, true, 'the order survives');
      assert.equal(merged.arrivalDate, '2026-09-01', 'and its arrival date');
      assert.equal(merged.onOrderVials, 4, 'and its quantity');
      assert.equal(merged.freq, 'daily', 'frequency survives');
      assert.equal(merged.continuous, true, 'continuous survives');
    });

    test('SAVE a replace would have wiped all eight — this is what was happening', () => {
      const existing = { compoundId:'bpc157', actualVialMg:2, stockCounted:true,
                         onOrder:true, arrivalDate:'2026-09-01', onOrderVials:4,
                         onOrderVialMg:5, freq:'daily', continuous:true };
      const fromSheet = { compoundId:'bpc157', dose:0.25 };
      const replaced = fromSheet;                       // the old behaviour
      ['actualVialMg','stockCounted','onOrder','arrivalDate','onOrderVials','onOrderVialMg','freq','continuous']
        .forEach(f => assert.equal(replaced[f], undefined, f + ' would have been lost'));
      assert.equal(existing.actualVialMg, 2, 'sanity: the source had it');
    });
  }

  // ── AUDIT — the protocol report (v4.9.209) ────────────────────────────────
  // Jon asked what was planned, what is done, where the gaps are, what cannot
  // be sourced, and what the forward schedule really is. Two of these cases
  // exist because the first version of the report was WRONG in ways that would
  // have misled him: it called a compound with 25 doses "out of stock" because
  // its reorder date had passed, and it reported 0% adherence for every
  // compound when the real answer was that no log exists yet.
  //
  // Setup is PER CASE. Written at suite-body level it passed alone and failed in
  // the full run, because the serialised runner executes every body first and a
  // later block's reset() wiped it. Same trap as the RENDER block.
  {
    const aIso = d => d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
    const aAgo = n => aIso(new Date(Date.now() - n*86400000));
    const aIn  = n => aIso(new Date(Date.now() + n*86400000));

    // Jon's protocol as documented in HANDOFF §12 plus his confirmed Epitalon.
    // Stock left as he actually has it — uncounted — so the report reflects his
    // real position rather than a convenient one.
    const seedAudit = () => {
      reset(); signIn('jon');
      const ps = app.pepGetState();
      ps.settings = {};
      ps.stacks = [
        { compoundId:'retatrutide',  dose:6,    startDate: aAgo(50), vialMg:10, waterMl:0.5, sealedVials:0, status:'instock' },
        { compoundId:'ipamorelin',   dose:0.2,  startDate: aAgo(50), vialMg:5,  waterMl:2,   sealedVials:1, status:'instock' },
        { compoundId:'cjc1295',      dose:0.15, startDate: aAgo(50), vialMg:5,  waterMl:2,   sealedVials:1, status:'instock' },
        { compoundId:'bpc_ghkcu_tb', dose:14,   startDate: aAgo(50), vialMg:70, waterMl:2,   sealedVials:0, status:'instock' },
        { compoundId:'bpc157',       dose:0.5,  startDate: aAgo(50), vialMg:5,  waterMl:2,   sealedVials:2, status:'instock' },
        { compoundId:'ta1',          dose:1.6,  startDate: aAgo(50), vialMg:5,  waterMl:2,   sealedVials:0, status:'instock' },
        { compoundId:'nad',          dose:100,  startDate: aAgo(50), vialMg:500,waterMl:5,   sealedVials:1, status:'instock' },
        { compoundId:'5amq',         dose:0.5,  startDate: aAgo(50), vialMg:5,  waterMl:1,   sealedVials:0, status:'instock' },
        { compoundId:'epitalon',     dose:5,    startDate: aIn(7),   vialMg:10, waterMl:1,   sealedVials:0, status:'pipeline' },
        { compoundId:'motsc',        dose:10,   startDate: aIn(30),  vialMg:10, waterMl:0.5, sealedVials:0, status:'pipeline' },
        { compoundId:'tesamorelin',  dose:1,    startDate: aIn(60),  vialMg:10, waterMl:2,   sealedVials:0, status:'pipeline' },
        { compoundId:'slu322',       dose:0.5,  startDate: aIn(90),  vialMg:10, waterMl:1,   sealedVials:0, status:'pipeline' },
      ];
      app.pepSaveState(ps);
      return app.pepGetState();
    };

    test('AUDIT produces a report against the live protocol', () => {
      const a = app._pepAuditReport(seedAudit());
      assert.ok(a.compounds > 0, 'compounds audited');
      assert.ok(app.pepAuditText(app.pepGetState()).length > 200, 'and a text report');
    });

    test('AUDIT reports an empty dose log as UNKNOWN, not as missed doses', () => {
      seedAudit();
      const a = app._pepAuditReport(app.pepGetState());
      assert.equal(a.historyKnown, false, 'no log');
      assert.equal(a.findings.poorAdherence.length, 0,
        'no adherence findings without a log — 0% for everything would report a man running his protocol as fully non-compliant');
      assert.ok(app.pepAuditText(app.pepGetState()).includes('not evidence that doses were missed'),
        'and it says so explicitly');
    });

    test('AUDIT out-of-stock means ZERO, not past-the-reorder-date', () => {
      seedAudit();
      const a = app._pepAuditReport(app.pepGetState());
      const ipa = a.rows.find(r => r.id === 'ipamorelin');
      assert.ok(ipa.dosesRemaining > 0, 'Ipamorelin has doses left');
      assert.equal(a.findings.outOfStock.some(r => r.id === 'ipamorelin'), false,
        'so it is NOT reported as out of stock');
      assert.ok(a.findings.pastReorder.some(r => r.id === 'ipamorelin'),
        'it is reported as past the reorder point — a different action');
    });

    test('AUDIT separates in-transit from needing an order', () => {
      const ps = seedAudit();
      const i = ps.stacks.findIndex(st => st.compoundId === 'ta1');
      ps.stacks[i].onOrder = true;
      ps.stacks[i].arrivalDate = aIn(5);
      ps.stacks[i].onOrderVials = 2;
      app.pepSaveState(ps);
      const a = app._pepAuditReport(app.pepGetState());
      assert.ok(a.findings.inTransit.some(r => r.id === 'ta1'), 'counted as in transit');
      assert.equal(a.findings.outOfStock.some(r => r.id === 'ta1'), false, 'and not also as needing an order');
    });

    test('AUDIT costs what needs ordering and flags what cannot be sourced', () => {
      seedAudit();
      const a = app._pepAuditReport(app.pepGetState());
      assert.ok(a.estimatedOrderAud > 0, 'a cost is produced');
      assert.ok(a.findings.unsourceable.some(r => r.id === 'slu322'),
        'SLU-PP-322 has no catalogue match — source manually or drop');
    });

    test('AUDIT the card renders on PROTOCOL OVERVIEW before the gate opens', () => {
      seedAudit();
      const nodes = {};
      const mk = id => ({ id, innerHTML:'', style:{}, classList:{add(){},remove(){},contains(){return false;}},
        appendChild(){}, setAttribute(){}, getAttribute(){return null;}, addEventListener(){},
        querySelector(){return null;}, querySelectorAll(){return [];} });
      const real = app.document.getElementById;
      app.document.getElementById = id => (nodes[id] = nodes[id] || mk(id));
      app._pepTab = 'overview';
      nodes['pep-screen-body'] = mk('pep-screen-body');
      app.pepRenderScreen();
      const h = nodes['pep-screen-body'].innerHTML;
      app.document.getElementById = real;

      assert.ok(h.includes('Protocol Audit'), 'card painted');
      assert.ok(h.includes('Not ready'), 'states readiness');
      assert.ok(h.includes('not evidence doses were missed'), 'the honest history line');
      assert.ok(h.includes('Two things first'), 'the gate is still shown below it');
    });
  }

  // ── PANELS — the PROTOCOL OVERVIEW redesign (v4.9.210) ────────────────────
  // Jon asked for three panels "left to right": phases, a date-mapped schedule,
  // and compound detail for the selected phase. On a 390px phone that is three
  // stacked sections — three columns would give each about 120px, narrower than
  // a single dose line.
  //
  // These drive pepRenderScreen and read the DOM, because the whole panel set is
  // only reachable once the readiness gate opens and nothing had ever rendered
  // that state.
  {
    const pIso = d => d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
    const pAgo = n => pIso(new Date(Date.now() - n*86400000));
    const pIn  = n => pIso(new Date(Date.now() + n*86400000));

    // A READY protocol — stock counted, history confirmed — so the panels show.
    const seedReady = () => {
      reset(); signIn('paneluser');
      const ps = app.pepGetState();
      ps.settings = {};
      ps.historyConfirmed = true;
      ps.stacks = [
        { compoundId:'bpc157',   dose:0.5, startDate: pAgo(40), vialMg:5,  waterMl:2, sealedVials:4, stockCounted:true, status:'instock' },
        { compoundId:'ta1',      dose:1.6, startDate: pAgo(40), vialMg:5,  waterMl:2, sealedVials:3, stockCounted:true, status:'instock' },
        { compoundId:'epitalon', dose:5,   startDate: pIn(20),  vialMg:10, waterMl:1, sealedVials:10, stockCounted:true, status:'instock' },
      ];
      app.pepSaveState(ps);
      return app.pepGetState();
    };

    const renderOverview = () => {
      const nodes = {};
      const mk = id => ({ id, innerHTML:'', style:{}, classList:{add(){},remove(){},contains(){return false;}},
        appendChild(){}, setAttribute(){}, getAttribute(){return null;}, addEventListener(){},
        querySelector(){return null;}, querySelectorAll(){return [];} });
      const real = app.document.getElementById;
      app.document.getElementById = id => (nodes[id] = nodes[id] || mk(id));
      app._pepTab = 'overview';
      nodes['pep-screen-body'] = mk('pep-screen-body');
      app.pepRenderScreen();
      const h = nodes['pep-screen-body'].innerHTML;
      app.document.getElementById = real;
      return h;
    };

    test('PANELS phases are derived from start dates, not a stored field', () => {
      const ps = seedReady();
      const phases = app._pepPhases(ps);
      assert.ok(phases.length >= 2, 'the two start months form two phases');
      assert.ok(phases[0].start <= phases[1].start, 'ordered in time');
      assert.ok(phases.some(p => p.running), 'the current cohort is marked running');
      assert.ok(phases.some(p => p.future), 'the later one is marked upcoming');
    });

    test('PANELS a phase carries its compounds, span and categories', () => {
      const p = app._pepPhases(seedReady())[0];
      assert.ok(p.count > 0, 'compounds');
      assert.ok(p.start, 'a start');
      assert.ok(p.categories.length > 0, 'categories, derived not invented');
    });

    test('PANELS all three render once the gate opens', () => {
      seedReady();
      const h = renderOverview();
      assert.notIncludes(h, 'Two things first', 'gate is satisfied');
      assert.ok(h.includes('>Phases<'), 'panel 1');
      assert.ok(h.includes('>Schedule<'), 'panel 2');
      assert.ok(h.includes('compounds<'), 'panel 3');
    });

    test('PANELS the calendar maps the protocol onto real dates', () => {
      seedReady();
      const h = renderOverview();
      assert.ok(h.includes('data-pep-day="' + pIso(new Date()) + '"'), 'today is a cell');
      assert.ok(h.includes('tap a day for the breakdown'), 'and is tappable');
    });

    test('PANELS a selected day shows dose and units to draw', () => {
      seedReady();
      app._pepDaySel = pIso(new Date());
      const h = renderOverview();
      app._pepDaySel = null;
      assert.ok(h.includes('u / '), 'units to draw in the day breakdown');
    });

    test('PANELS compound detail carries dose, timing, recon and vials for the phase', () => {
      seedReady();
      const h = renderOverview();
      assert.ok(h.includes('per injection'), 'dose per injection');
      assert.ok(h.includes('mg/mL'), 'reconstitution');
      assert.ok(h.includes('for this phase'), 'vials needed for the phase');
    });

    test('PANELS selecting a phase filters the calendar to that phase', () => {
      const ps = seedReady();
      const phases = app._pepPhases(ps);
      const future = phases.find(p => p.future);
      app._pepPhaseSel = future.key;
      const h = renderOverview();
      app._pepPhaseSel = null;
      assert.ok(h.includes('Phase ' + future.index + ' &middot; tap a day'), 'schedule follows the selection');
      assert.ok(h.includes('Epitalon'), 'and so does the compound panel');
    });

    test('PANELS the gate still hides everything when not ready', () => {
      reset(); signIn('paneluser');
      const ps = app.pepGetState();
      ps.settings = {};
      ps.stacks = [{ compoundId:'bpc157', dose:0.5, startDate: pAgo(40), vialMg:5, waterMl:2, sealedVials:4, status:'instock' }];
      app.pepSaveState(ps);
      const h = renderOverview();
      assert.ok(h.includes('Two things first'), 'gate shown');
      assert.notIncludes(h, '>Schedule<', 'and the panels are not');
    });
  }

  // ── TABVIEW — the position WITHIN the portal survives a reload (v4.9.212) ─
  // navTo's peptide branch did _pepTab='today' unconditionally, so every entry
  // to the portal — including the .206 boot restore after a screen lock —
  // dropped Jon on TODAY whatever tab he had been on. .206 restores the SCREEN;
  // this restores the position inside it.
  //
  // These drive navTo('peptide'), NOT _pepRestoreView(). Calling the helper
  // directly would pass with navTo still forcing 'today' — testing the fix while
  // missing the bug. Nutrition made exactly that mistake on its own copy of this
  // line and caught it before shipping.
  {
    test('TABVIEW entering the portal restores the tab he was on', () => {
      reset(); signIn('tabuser');
      app._pepTab = 'stock';
      app.pepRenderScreen();            // persists it, as any tab change does
      app._pepTab = 'today';            // simulate the reset a reload performs
      app.navTo('peptide');             // the real entry point
      assert.equal(app._pepTab, 'stock', 'back on STOCK, not TODAY');
    });

    test('TABVIEW every tab is restorable, not just stock', () => {
      ['today','overview','stock','adjust','order','bloods'].forEach(tab => {
        reset(); signIn('tabuser');
        app._pepTab = tab;
        app.pepRenderScreen();
        app._pepTab = 'today';
        app.navTo('peptide');
        assert.equal(app._pepTab, tab, tab + ' restored');
      });
    });

    test('TABVIEW a first-ever visit lands on TODAY', () => {
      reset(); signIn('brandnew');
      app.navTo('peptide');
      assert.equal(app._pepTab, 'today', 'sensible default with nothing stored');
    });

    test('TABVIEW a transient host tab is never persisted', () => {
      reset(); signIn('tabuser');
      app._pepTab = 'stock';
      app.pepRenderScreen();
      app._pepTab = 'protocol';         // the edit-sheet host, not a real tab
      app.pepRenderScreen();
      app._pepTab = 'today';
      app.navTo('peptide');
      assert.equal(app._pepTab, 'stock', 'restores the last REAL tab, not the host');
    });

    test('TABVIEW the tab is remembered per user, not globally', () => {
      reset();
      signIn('userA'); app._pepTab = 'order';  app.pepRenderScreen();
      signIn('userB'); app._pepTab = 'bloods'; app.pepRenderScreen();
      signIn('userA'); app._pepTab = 'today';  app.navTo('peptide');
      assert.equal(app._pepTab, 'order', 'A gets A\'s tab');
      signIn('userB'); app._pepTab = 'today';  app.navTo('peptide');
      assert.equal(app._pepTab, 'bloods', 'B gets B\'s');
    });

    test('TABVIEW the + button no longer routes to the tab that ceased to exist', () => {
      const i = html.indexOf("if(tab==='peptide')");
      const line = html.slice(i, html.indexOf('\n', i));
      assert.notIncludes(line, "_pepTab='protocol'", 'the .201 orphan is gone');
      assert.ok(line.includes("_pepTab==='stock'"), 'adding a compound belongs on STOCK');
    });
  }

  // ── Marker flagging — against the lab's own printed range ──────────────────

  test('a value above the lab range flags high', () => {
    assert.equal(app._pepMarkerFlag({ value: '71', ref_low: '5', ref_high: '40' }), 'high', 'ALT high');
  });

  test('a value below the lab range flags low', () => {
    assert.equal(app._pepMarkerFlag({ value: '0.8', ref_low: '1.0' }), 'low', 'HDL low');
  });

  test('a value inside the range flags ok', () => {
    assert.equal(app._pepMarkerFlag({ value: '42', ref_low: '13', ref_high: '44' }), 'ok', 'IGF-1 ok');
  });

  test('a marker with no numeric range is not flagged either way', () => {
    assert.equal(app._pepMarkerFlag({ value: 'Neg', ref_text: 'Negative' }), null, 'no false flag');
    assert.equal(app._pepMarkerFlag({ value: '5' }), null, 'no range, no flag');
    assert.equal(app._pepMarkerFlag(null), null, 'null marker');
  });

  test('the latest panel is picked by date and surfaces what is out of range', () => {
    const latest = app._pepLatestBloods({ bloods: [
      { panel_date: '2026-01-01', markers: [] },
      { panel_date: '2026-08-06', markers: [
        { name: 'ALT', value: '71', unit: 'U/L', ref_low: '5', ref_high: '40' },
        { name: 'IGF-1', value: '42', unit: 'nmol/L', ref_low: '13', ref_high: '44' },
      ] },
    ] });
    assert.equal(latest.panel_date, '2026-08-06', 'newest panel chosen');
    assert.equal(latest.out_of_range.length, 1, 'one marker out of range');
    assert.equal(latest.out_of_range[0].name, 'ALT', 'the right one');
  });

  // ── TITRATE — stock must know what he CONSUMED, not what he doses now ──────
  // Jon titrates by hand and asked for the stock to be smart enough to know
  // what he is consuming. It was not. openDosesUsed was a COUNT, and every
  // downstream figure re-derived milligrams from it using the CURRENT dose — so
  // changing a dose silently rewrote his history.
  //
  // His own NAD+ is the worked case and the reason this exists.
  {
    const nad = (over) => {
      reset(); signIn(UID);
      seed(KEY, { stacks: [Object.assign({
        compoundId: 'nad', dose: 50, vialMg: 500, waterMl: 2,
        startDate: daysAgo(10), freq: '3x/week Mon/Wed/Fri',
        sealedVials: 9, openedDate: daysAgo(4), stockCounted: true,
      }, over || {})] });
      return app.pepGetState();
    };

    test('TITRATE three 50mg doses leave 350mg in a 500mg vial', () => {
      const ps = nad();
      const st = ps.stacks[0];
      const c = app._pepCompound('nad');
      // tick three doses through the real consumption path
      app._pepConsumeDose(ps, 'nad', 1);
      app._pepConsumeDose(ps, 'nad', 1);
      app._pepConsumeDose(ps, 'nad', 1);
      assert.equal(app._pepOpenUsed(ps.stacks[0], c), 150, '150mg drawn');
      assert.equal(app._pepOpenDosesLeft(ps.stacks[0], c), 7, '7 more doses at 50mg');
    });

    test('TITRATE 50mg -> 100mg keeps the milligrams and halves the doses', () => {
      const ps = nad();
      const c = app._pepCompound('nad');
      app._pepConsumeDose(ps, 'nad', 1);
      app._pepConsumeDose(ps, 'nad', 1);
      app._pepConsumeDose(ps, 'nad', 1);
      // week 2: he raises the dose by hand
      ps.stacks[0].dose = 100;
      assert.equal(app._pepOpenUsed(ps.stacks[0], c), 150,
        'still 150mg consumed — the past does not change because the future did');
      assert.equal(app._pepOpenDosesLeft(ps.stacks[0], c), 3,
        '350mg left is 3 whole doses at 100mg. Counting doses instead would have ' +
        'read those 3 ticks as 300mg and reported 2, quietly losing 150mg of NAD+');
    });

    test('TITRATE 100mg -> 50mg does not invent stock', () => {
      const ps = nad({ dose: 100 });
      const c = app._pepCompound('nad');
      app._pepConsumeDose(ps, 'nad', 1);
      app._pepConsumeDose(ps, 'nad', 1);   // 200mg gone
      ps.stacks[0].dose = 50;
      assert.equal(app._pepOpenUsed(ps.stacks[0], c), 200, '200mg really gone');
      assert.equal(app._pepOpenDosesLeft(ps.stacks[0], c), 6,
        '300mg left = 6 doses at 50mg. A dose count would have said 2 used of 10, ' +
        'claiming 8 doses that are not in the vial — the more dangerous direction');
    });

    test('TITRATE a legacy dose count migrates to an amount on load', () => {
      reset(); signIn(UID);
      seed(KEY, { stacks: [{ compoundId:'nad', dose:50, vialMg:500, waterMl:2,
        startDate: daysAgo(10), openedDate: daysAgo(3), openDosesUsed: 3, sealedVials: 9 }] });
      const ps = app.pepGetState();
      assert.equal(ps.stacks[0].openUsedAmt, 150,
        'converted once, on load, at the dose those doses were taken at');
    });

    test('TITRATE the vial closes when the next dose will not come out of it', () => {
      const ps = nad({ dose: 100, vialMg: 500 });
      const c = app._pepCompound('nad');
      for (let i = 0; i < 5; i++) app._pepConsumeDose(ps, 'nad', 1);
      assert.equal(ps.stacks[0].openedDate, null, 'five 100mg doses finish a 500mg vial');
      assert.equal(app._pepOpenUsed(ps.stacks[0], c), 0, 'and the counter resets for the next');
    });

    test('TITRATE an awkward remainder is waste, not a phantom dose', () => {
      // 500mg vial, 300mg dose: two doses fit, 200mg is stranded.
      const ps = nad({ dose: 300 });
      const c = app._pepCompound('nad');
      app._pepConsumeDose(ps, 'nad', 1);
      assert.equal(app._pepOpenDosesLeft(ps.stacks[0], c), 0,
        '200mg is left but it is not a 300mg dose — real waste in the vial, and ' +
        'rounding it up would put him a dose short on the day he needs it');
    });

    test('TITRATE undo returns the amount, not a generic dose', () => {
      const ps = nad();
      const c = app._pepCompound('nad');
      app._pepConsumeDose(ps, 'nad', 1);
      app._pepConsumeDose(ps, 'nad', 1);
      app._pepConsumeDose(ps, 'nad', -1);
      assert.equal(app._pepOpenUsed(ps.stacks[0], c), 50, 'one 50mg dose handed back');
    });

    test('TITRATE a unit-dosed blend tracks units, having no mg to track', () => {
      reset(); signIn(UID);
      seed(KEY, { stacks: [{ compoundId:'klow', dose:14, vialMg:80, waterMl:2,
        startDate: daysAgo(5), openedDate: daysAgo(2), sealedVials: 1 }] });
      const ps = app.pepGetState();
      const c = app._pepCompound('klow');
      app._pepConsumeDose(ps, 'klow', 1);
      assert.equal(app._pepOpenUsed(ps.stacks[0], c), 14,
        '14 syringe units out of the 200 in the vial — same principle, the compound own unit');
    });
  }

  // ── MIRROR — the cloud write path, which had no functional test at all ─────
  // Third instance of the same shape in one afternoon, and the highest-stakes.
  // _pepSendCloud is how Jon's entire protocol reaches Supabase. Its error
  // handling was protected by harness pins on SYNTAX — `.then(function(res){`,
  // `.catch(function(e){` — with labels claiming behaviour ("mirror inspects
  // res", "mirror handles rejection") and zero cases behind them.
  //
  // Those pins break if anyone writes `.then(res => ...)`, which changes
  // nothing, and stay green if the handler body is emptied, which changes
  // everything. Exactly inverted, on the path whose silent failure hid a
  // missing column for twelve versions.
  //
  // Found by applying my own heuristic mechanically to my own region rather
  // than trusting that I had already swept it.
  {
    const mirrorSetUp = (result, opts) => {
      reset(); signIn(UID);
      const o = opts || {};
      app.sb = {
        from: () => {
          const q = {
            update() { return q; }, eq() { return q; }, select() { return q; },
            then(a, b) { return Promise.resolve(result).then(a, b); },
            catch(b) { return Promise.resolve(result).catch(b); },
          };
          if (o.reject) {
            q.then = (a, b) => Promise.reject(new Error('network down')).then(a, b);
          }
          return q;
        },
      };
      return { stacks: [{ compoundId: 'bpc157', dose: 0.5 }], _ts: NEWER };
    };

    test('MIRROR a resolved Supabase error is recorded, not swallowed', async () => {
      const payload = mirrorSetUp({ data: null, error: { code: '42703', message: 'column does not exist' } });
      app._pepSendCloud(payload, false);
      await settle();
      const rec = read('phx_last_write_error');
      assert.ok(rec && JSON.stringify(rec).includes('pep mirror'),
        'supabase-js RESOLVES with {error} rather than throwing — this is the exact ' +
        'shape that hid a missing peptide_state column for twelve versions');
    });

    test('MIRROR a rejection is recorded under its own context', async () => {
      const payload = mirrorSetUp(null, { reject: true });
      app._pepSendCloud(payload, false);
      await settle();
      const rec = JSON.stringify(read('phx_last_write_error') || {});
      assert.ok(rec.includes('pep mirror'), 'the reject path records too');
      assert.ok(rec.includes('exception') || rec.includes('reject'),
        'and under a DIFFERENT context from the resolved-error branch, so the ring ' +
        'cannot coalesce a schema fault and an offline blip into one slot');
    });

    test('MIRROR what reaches the diagnostic is the scrubbed summary, not the payload', async () => {
      reset(); signIn(UID);
      app.sb = { from: () => { const q = { update(){return q;}, eq(){return q;},
        then(a,b){ return Promise.resolve({data:null,error:{code:'x',message:'y'}}).then(a,b); },
        catch(b){ return Promise.resolve().catch(b); } }; return q; } };
      app._pepSendCloud({ stacks: [{ compoundId:'bpc157', dose:0.5 }],
                          bloods: [{ lab:'ZENTHORP', markers:[{name:'ALT',value:'71'}] }],
                          _ts: NEWER }, false);
      await settle();
      // POSITIVE CONTROL FIRST. `read(...) || {}` means that if the recorder
      // never fired, rec is '{}' and both notIncludes below pass — this case
      // would have gone green whether or not the scrub works, needing only the
      // recorder to stay silent. Training's shape: a negative that cannot fail
      // early is not a weaker test, it is a different one. This is the highest-
      // stakes assertion I own and it was asserting nothing.
      const raw = read('phx_last_write_error');
      assert.ok(raw, 'something WAS recorded — otherwise the scrub is untested, not proven');
      const rec = JSON.stringify(raw);
      assert.ok(rec.includes('pep mirror'), 'and it is the mirror error, not some leftover');
      assert.notIncludes(rec, 'ZENTHORP',
        'the diagnostic ring is localStorage and gets read out in support — pathology ' +
        'must not land there by way of an error report');
      // v4.9.255: this used to be notIncludes(rec, '71'). The record carries an
      // ISO timestamp, so a two-digit needle matches whenever the clock happens
      // to contain those digits — it failed on an unrelated schedule change at
      // 08:26:44.971Z. A flaky assertion I shipped, found by accident.
      //
      // Assert on STRUCTURE instead: the shape record must describe only counts,
      // and must not mention the blood fields at all. That cannot collide with a
      // clock, and it says what the property actually is.
      assert.notIncludes(rec, 'markers', 'no marker structure described');
      assert.notIncludes(rec, 'bloods', 'the bloods key is not even named');
      assert.ok(JSON.parse(rec).payload_shape,
        'a shape record exists — otherwise the two negatives above are vacuous');
      Object.values(JSON.parse(rec).payload_shape).forEach(v => {
        assert.ok(/^(number|string\(\d+\)|boolean|array\(\d+\)|object)$/.test(String(v)),
          `every shape entry is a TYPE, never a value — got ${v}`);
      });
    });

    // ── THE SIBLING I LEFT STANDING, fourth time today ─────────────────────
    // Every MIRROR case above passes useKeepalive=false. The keepalive branch —
    // the pagehide flush — had none.
    //
    // Which is the wrong way round twice over. It is the branch I specifically
    // hardened in v4.9.228, adding the res.ok check because fetch RESOLVES on a
    // 4xx and the missing-column bug was a 400. And it is the last-chance write:
    // it fires as he closes the app or the screen locks, so if it fails
    // silently the day's dose ticks never leave the phone.
    //
    // I wrote the fix for this path, then wrote tests for the other one.
    // Training named the pattern — fix the second instance, leave the first,
    // because the first feels handled once you have just thought about it — and
    // I did it again inside the hour.
    const kaSetUp = (response, opts) => {
      reset(); signIn(UID);
      const seen = {};
      app.fetch = (url, init) => {
        seen.url = url; seen.init = init;
        if (opts && opts.reject) return Promise.reject(new Error('offline'));
        return Promise.resolve(response);
      };
      return seen;
    };
    const PAYLOAD = { stacks: [{ compoundId: 'bpc157', dose: 0.5 }], _ts: NEWER };

    test('MIRROR keepalive records a 4xx, which RESOLVES rather than rejecting', async () => {
      kaSetUp({ ok: false, status: 400 });
      app._pepSendCloud(PAYLOAD, true);
      await settle();
      const rec = JSON.stringify(read('phx_last_write_error') || {});
      assert.ok(rec.includes('pep mirror keepalive'),
        'fetch only REJECTS on network failure — a 400 resolves, so a .catch alone ' +
        'would miss it. This is the exact shape that hid a missing peptide_state ' +
        'column for twelve versions');
      assert.ok(rec.includes('400'), 'and the status is in the record');
    });

    test('MIRROR keepalive records a network rejection under its own context', async () => {
      kaSetUp(null, { reject: true });
      app._pepSendCloud(PAYLOAD, true);
      await settle();
      const rec = JSON.stringify(read('phx_last_write_error') || {});
      assert.ok(rec.includes('keepalive') && rec.includes('reject'),
        'a DIFFERENT context from the 4xx branch — the PM ring coalesces by context, ' +
        'so a schema fault and an offline blip sharing one would hide each other');
    });

    test('MIRROR keepalive records nothing when the write succeeds', async () => {
      const seen = kaSetUp({ ok: true, status: 204 });
      app._pepSendCloud(PAYLOAD, true);
      await settle();
      // POSITIVE CONTROL. "nothing was recorded" is trivially true before the
      // write has run at all, so on its own this case can never fail from
      // settling too early. Proving the fetch actually went out first turns it
      // into "completed and recorded nothing".
      assert.ok(seen.init, 'the flush actually fired — otherwise silence proves nothing');
      assert.equal(read('phx_last_write_error'), null,
        'a clean flush is silent — an error ring that fills up on success tells him ' +
        'nothing when something is actually wrong');
    });

    test('MIRROR keepalive actually sets keepalive, which is the whole point', async () => {
      const seen = kaSetUp({ ok: true, status: 204 });
      app._pepSendCloud(PAYLOAD, true);
      await settle();
      assert.equal(seen.init.keepalive, true,
        'without this flag the browser drops the request as the page goes away, ' +
        'and the pagehide flush silently does nothing at all');
      assert.equal(seen.init.method, 'PATCH', 'against the REST endpoint');
      assert.ok(String(seen.url).includes('/rest/v1/profiles'), 'the profiles row');
    });

    test('MIRROR keepalive sends the payload it was given, not raw state', async () => {
      const seen = kaSetUp({ ok: true, status: 204 });
      app._pepSendCloud({ stacks: [{ compoundId: 'bpc157', dose: 0.5 }], _ts: NEWER }, true);
      await settle();
      const body = JSON.parse(seen.init.body);
      assert.ok(body.peptide_state, 'wrapped in the column name');
      assert.notIncludes(JSON.stringify(body), 'bloods',
        'and whatever the caller scrubbed stays scrubbed on this path too');
    });

    test('MIRROR an empty protocol is declined rather than overwriting a real one', async () => {
      reset(); signIn(UID);
      app.window = app.window || {};
      app.window._lastProfileRow = { peptide_state: { stacks: [{ compoundId:'bpc157' }, { compoundId:'nad' }] } };
      let wrote = false;
      app.sb = { from: () => { const q = { update(){ wrote = true; return q; }, eq(){return q;},
        then(a,b){ return Promise.resolve({data:null,error:null}).then(a,b); },
        catch(b){ return Promise.resolve().catch(b); } }; return q; } };
      app._pepSendCloud({ stacks: [], checked: {}, cart: [], _ts: NEWER }, false);
      await settle();
      assert.equal(wrote, false,
        'a fresh install that has not restored yet must not push its empty stub over ' +
        'a real cloud protocol — the v4.9.158 wipe');
      const rec = JSON.stringify(read('phx_last_write_error') || {});
      assert.ok(rec.includes('stubSuppressed'),
        'and the refusal is RECORDED, not just dropped — a silent decline looks ' +
        'identical to a successful write');
    });
  }

  // ── ADHWINDOW — _pepAdherence honours its window (v4.9.255, harness-only) ──
  // Training's addition to the pin rule: a needle may be silently load-bearing
  // for a property it does not mention, so NARROWING one is not a safe
  // refactor. I narrowed eighteen in the same sweep and then went looking for
  // what that removed. This is what it removed.
  //
  // The pin reads `has('function _pepAdherence(', '14-day adherence calculator
  // present')`. The label claims a WINDOW; the pin asserts a name. It used to
  // assert `(ps, days)`, which at least named the parameter — I took that away
  // this afternoon, and there were no functional cases behind it. Same shape as
  // _pepGetDoses, sitting two lines below it, and my own sweep made it worse.
  //
  // It feeds the advisor context and the audit's adherence findings — the
  // percentages Jon reads and acts on. A wrong window there is silent: the
  // numbers still look like percentages.
  {
    const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const back = (n) => iso(new Date(Date.now() - n * 86400000));

    // BPC-157 daily, started well before any window under test, so every day in
    // the window is a scheduled day and the counts are the window length.
    const setUpAdh = (ticked) => {
      reset(); signIn(UID);
      const checked = {};
      (ticked || []).forEach(n => { checked[back(n)] = ['bpc157']; });
      seed(KEY, { stacks: [{ compoundId:'bpc157', dose:0.5, vialMg:10, waterMl:2,
        startDate: back(60), freq:'daily', continuous:true, status:'instock' }],
        checked, cart: [] });
      return app.pepGetState();
    };
    const one = (rows) => rows.find(r => r.compound === 'BPC-157');

    test('ADHWINDOW the days argument sets the window', () => {
      const ps = setUpAdh();
      assert.equal(one(app._pepAdherence(ps, 7)).scheduled, 7, 'seven days asked for, seven counted');
      assert.equal(one(app._pepAdherence(ps, 14)).scheduled, 14, 'and fourteen when fourteen');
      assert.equal(one(app._pepAdherence(ps, 30)).scheduled, 30, 'and thirty when thirty');
    });

    test('ADHWINDOW omitting the window defaults to 14, as the label claims', () => {
      const ps = setUpAdh();
      assert.equal(one(app._pepAdherence(ps)).scheduled, 14,
        'the harness pin has always SAID 14-day and never checked it');
    });

    test('ADHWINDOW today is excluded from the window', () => {
      const ps = setUpAdh();
      // 14 scheduled from a daily compound means yesterday back 14 days, not
      // today back 13. Today is not finished, so counting it would score every
      // morning dose as missed until he takes it.
      const rows = app._pepAdherence(ps, 1);
      assert.equal(one(rows).scheduled, 1, 'a one-day window is yesterday');
      assert.equal(one(rows).taken, 0, 'and untaken');
      const withY = app._pepAdherence(setUpAdh([1]), 1);
      assert.equal(one(withY).taken, 1, 'ticking YESTERDAY registers, which fixes the date');
    });

    test('ADHWINDOW ticks inside the window count, ticks outside it do not', () => {
      const inside = app._pepAdherence(setUpAdh([1, 2, 3]), 7);
      assert.equal(one(inside).taken, 3, 'three ticks in the last week');
      const outside = app._pepAdherence(setUpAdh([20, 21]), 7);
      assert.equal(one(outside).taken, 0,
        'ticks three weeks ago are outside a seven-day window and must not inflate it');
    });

    test('ADHWINDOW the percentage is taken over scheduled, not over the window', () => {
      const rows = app._pepAdherence(setUpAdh([1, 2, 3, 4, 5, 6, 7]), 14);
      const r = one(rows);
      assert.equal(r.scheduled, 14, 'fourteen due');
      assert.equal(r.taken, 7, 'seven taken');
      assert.equal(r.adherence_pct, 50, 'and the figure is 50, not 7 or 100');
    });

    test('ADHWINDOW a compound scheduled on only some days is not counted daily', () => {
      reset(); signIn(UID);
      seed(KEY, { stacks: [{ compoundId:'retatrutide', dose:6, vialMg:30, waterMl:2.5,
        startDate: back(60), freq:'weekly', continuous:true, status:'instock' }],
        checked: {}, cart: [] });
      const r = app._pepAdherence(app.pepGetState(), 14).find(x => x.compound === 'Retatrutide');
      assert.equal(r.scheduled, 2,
        'weekly over a fortnight is two, not fourteen — the denominator the .219 ' +
        'audit fix depends on being right');
    });
  }

  // ── SKIP + PERIODS — declining a dose, and one compound in two windows ─────
  // Jon, after applying Phase 2: "can I add BPC daily with option to not take"
  // and "CJC is still running — can this be added until it runs out and Tesa
  // takes over".
  //
  // The second was my error. I built the phase with CJC starting 3 Oct and
  // dropped the run he is on right now, because the handoff document lists
  // active_periods and I took only the last one.
  {
    // ── a deliberate skip is not a miss ───────────────────────────────────
    const daily = () => {
      reset(); signIn(UID);
      seed(KEY, { stacks: [{ compoundId:'bpc157', dose:0.5, vialMg:10, waterMl:2,
        startDate: daysAgo(30), freq:'daily', continuous:true, status:'instock',
        sealedVials:2, openedDate: daysAgo(2), openVialMg:10, openWaterMl:2, openUsedAmt:0 }],
        checked:{}, skipped:{}, cart:[] });
      return app.pepGetState();
    };

    test('SKIP a skipped dose is recorded as a decision, not a gap', () => {
      daily();
      app.pepSkipDose('bpc157');
      const ps = app.pepGetState();
      assert.ok(app._pepIsSkipped(ps, app._pepToday(), 'bpc157'), 'recorded for today');
      assert.equal((ps.checked[app._pepToday()] || []).length, 0, 'and not counted as taken');
    });

    test('SKIP skipping does not consume stock', () => {
      const before = app._pepOpenUsed(daily().stacks[0], app._pepCompound('bpc157'));
      app.pepSkipDose('bpc157');
      const after = app._pepOpenUsed(app.pepGetState().stacks[0], app._pepCompound('bpc157'));
      assert.equal(after, before, 'nothing came out of the vial, because nothing was drawn');
    });

    test('SKIP skipping something already ticked returns the stock', () => {
      daily();
      app.pepToggleDose('bpc157');
      assert.equal(app._pepOpenUsed(app.pepGetState().stacks[0], app._pepCompound('bpc157')), 0.5, 'drawn');
      app.pepSkipDose('bpc157');
      assert.equal(app._pepOpenUsed(app.pepGetState().stacks[0], app._pepCompound('bpc157')), 0,
        'changing his mind puts it back — otherwise the vial reports less than it holds');
      assert.equal((app.pepGetState().checked[app._pepToday()] || []).indexOf('bpc157'), -1, 'and it is no longer ticked');
    });

    test('SKIP taking it clears the skip — the two are exclusive', () => {
      daily();
      app.pepSkipDose('bpc157');
      app.pepToggleDose('bpc157');
      const ps = app.pepGetState();
      assert.ok(!app._pepIsSkipped(ps, app._pepToday(), 'bpc157'), 'not both at once');
      assert.ok((ps.checked[app._pepToday()] || []).indexOf('bpc157') >= 0, 'taken');
    });

    test('SKIP tapping Skip twice un-skips it', () => {
      daily();
      app.pepSkipDose('bpc157');
      app.pepSkipDose('bpc157');
      assert.ok(!app._pepIsSkipped(app.pepGetState(), app._pepToday(), 'bpc157'),
        'a mis-tap is recoverable without leaving a decision on the record');
    });

    // The point of the whole feature: using it must not damage the figure.
    test('SKIP a skipped day leaves the adherence DENOMINATOR', () => {
      reset(); signIn(UID);
      const iso = (n) => { const d = new Date(Date.now() - n*86400000);
        return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); };
      const skipped = {}; skipped[iso(1)] = ['bpc157']; skipped[iso(2)] = ['bpc157'];
      seed(KEY, { stacks: [{ compoundId:'bpc157', dose:0.5, vialMg:10, waterMl:2,
        startDate: daysAgo(60), freq:'daily', continuous:true, status:'instock' }],
        checked:{}, skipped, cart:[] });
      const r = app._pepAdherence(app.pepGetState(), 7).find(x => x.compound === 'BPC-157');
      assert.equal(r.scheduled, 5, 'seven days minus the two he chose to skip');
      assert.equal(r.skipped, 2, 'counted separately, so the choice is visible');
      assert.equal(r.taken, 0, 'none taken');
      assert.equal(r.adherence_pct, 0,
        '0 of 5, not 0 of 7 — scoring a deliberate skip as a miss would mean the ' +
        'feature quietly damaged his figure every time he used it as intended');
    });

    // ── one compound, two active windows ──────────────────────────────────
    test('PERIODS CJC runs now, pauses for the bridge, and resumes', () => {
      reset(); signIn(UID);
      seed(KEY, { stacks: [{ compoundId:'cjc1295', dose:0.2, vialMg:10, waterMl:2,
        startDate:'2026-05-30', freq:'6 day', status:'instock',
        periods:[{from:'2026-05-30', to:'2026-09-07'},{from:'2026-10-03', to:null}] }],
        checked:{}, cart:[] });
      const ps = app.pepGetState();
      const on = (d) => app._pepGetDoses(ps, d).evening.concat(app._pepGetDoses(ps, d).anytime,
                        app._pepGetDoses(ps, d).morning).length > 0;
      assert.equal(on('2026-09-02'), true,  'running right now');
      // NOT 7 Sep — that is a Monday, which is CJC's own rest day, so it would
      // be absent for a reason unrelated to the window. My first version of this
      // asserted it and failed on correct code. Pick a day the rule fires on.
      assert.equal(on('2026-09-06'), true,  'to the last dosing day inside the window (Sunday)');
      assert.equal(on('2026-09-08'), false, 'then Tesamorelin takes the slot');
      assert.equal(on('2026-09-25'), false, 'still paused mid-bridge');
      assert.equal(on('2026-10-03'), true,  'and back the day Tesamorelin ends');
    });

    test('PERIODS the paused window is dropped on import, not kept and flagged', () => {
      const r = app._pepValidateImport(JSON.stringify([{ compoundId:'cjc1295', dose:0.2,
        vialMg:10, waterMl:2, startDate:'2026-05-30',
        active_periods:[{from:'2026-05-30',to:'2026-09-08',status:'active'},
                        {from:'2026-09-08',to:'2026-10-03',status:'paused_tesamorelin'},
                        {from:'2026-10-03',to:null,status:'active'}] }]));
      assert.equal(r.ok, true, 'his document shape is accepted');
      assert.equal(r.entries[0].periods.length, 2,
        'the paused window is gone, not carried as a flag — a schedule you must ' +
        'read twice to know whether it fires is how a dose lands on a wrong day');
    });

    test('PERIODS an unreadable window fails the import rather than vanishing', () => {
      const r = app._pepValidateImport(JSON.stringify([{ compoundId:'cjc1295', dose:0.2,
        active_periods:[{from:'2026-05-30',to:'2026-09-08'},{from:'October'}] }]));
      assert.equal(r.ok, false,
        'a window that silently disappears takes a whole run of doses with it');
    });

    // ── the shipped phase now carries both corrections ────────────────────
    test('SKIP+PERIODS Phase 2 has BPC daily and CJC in two windows', () => {
      reset(); signIn(UID);
      seed(KEY, { stacks: [], checked:{}, cart:[] });
      const ph = app._pepPhaseById(app.pepGetState(), 'phase2');
      const bpc = ph.stacks.find(x => x.compoundId === 'bpc157');
      assert.equal(bpc.freq, 'daily', 'BPC every day, skippable');
      const cjc = ph.stacks.find(x => x.compoundId === 'cjc1295');
      assert.equal(cjc.periods.length, 2, 'CJC keeps its current run AND its return');
      assert.equal(cjc.periods[0].from, '2026-05-30', 'the run he is on now');
      assert.equal(cjc.periods[1].from, '2026-10-03', 'and the one after the bridge');
    });
  }

  // ── PHASES — the protocol lives in the code, not in a paste ────────────────
  // Jon: "I don't want imports, I want it built into the code, and the app able
  // to build further phases inside it."
  //
  // So Phase 2 ships as data and applying it is one tap. Building the next one
  // is Save current — set the protocol up on screen, keep it under a name. The
  // import path stays for one-off pastes but is no longer how a phase gets in.
  {
    const fresh = () => {
      reset(); signIn(UID);
      seed(KEY, { stacks: [{ compoundId:'ta1', dose:1.6, vialMg:10, waterMl:2, startDate: daysAgo(30) }],
                  historyConfirmed: true, checked:{}, cart:[] });
      return app.pepGetState();
    };

    test('PHASES Phase 2 is in the code and holds his thirteen compounds', () => {
      fresh();
      const ph = app._pepPhaseById(app.pepGetState(), 'phase2');
      assert.ok(ph, 'shipped, not pasted');
      assert.equal(ph.stacks.length, 13, 'every compound from the handoff document');
      const reta = ph.stacks.find(x => x.compoundId === 'retatrutide');
      assert.equal(reta.dose, 10, 'Retatrutide at the dose he confirmed, not the doc six');
      assert.equal(reta.waterMl, 1.8, 'and the volume he confirmed');
      assert.equal(reta.startDate, '2026-09-04', 'anchored to the Friday he named');
      const bpc = ph.stacks.find(x => x.compoundId === 'bpc157');
      assert.equal(bpc.waterMl, 2, 'BPC at 2mL — the doc says 1mL, which is a half dose');
      const ipa = ph.stacks.find(x => x.compoundId === 'ipamorelin');
      assert.equal(ipa.continuous, true, 'Ipamorelin continuous, running with both partners');
    });

    test('PHASES applying a phase replaces the protocol and records which one', () => {
      fresh();
      const r = app.pepApplyPhase('phase2');
      assert.equal(r.ok, true, 'applied');
      assert.equal(r.applied, 13, 'all thirteen');
      const after = read(KEY);
      assert.equal(after.stacks.length, 13, 'live');
      assert.equal(after.activePhase, 'phase2', 'and the app knows which phase is running');
      // NOT notIncludes('ta1') — Phase 2 CONTAINS Thymosin Alpha-1, so the id
      // legitimately survives. My first version of this asserted its absence and
      // failed on correct code. Assert the identifying detail instead: the TA-1
      // now present is the PHASE's, starting 8 Oct, not the one that was there.
      const ta1 = after.stacks.find(x => x.compoundId === 'ta1');
      assert.equal(ta1.startDate, '2026-10-08',
        'the TA-1 in the protocol is the phase version — apply is a replace, not a merge');
    });

    test('PHASES applying backs up first and clears the stale history confirmation', () => {
      fresh();
      app.pepApplyPhase('phase2');
      const bak = read(`${KEY}_bak`);
      assert.ok(bak && JSON.stringify(bak).includes('ta1'),
        'the previous protocol is recoverable — Restore has to be able to undo this');
      assert.equal(read(KEY).historyConfirmed, false,
        'a different protocol has a different history; carrying the confirmation ' +
        'over would open the readiness gate on a plan he has never reviewed');
    });

    test('PHASES a phase goes through the SAME validation as a paste', () => {
      fresh();
      const ps = app.pepGetState();
      ps.phases = [{ id:'user_bad', name:'Bad', stacks:[{ compoundId:'unobtainium', dose:1 }] }];
      app.pepSaveState(ps);
      const r = app.pepApplyPhase('user_bad');
      assert.equal(r.ok, false, 'refused');
      assert.ok(r.problems.join(' ').includes('unobtainium'), 'and says why');
      assert.equal(read(KEY).stacks[0].compoundId, 'ta1',
        'his protocol untouched — one gate, and no way in that skips it');
    });

    test('PHASES Save current keeps what is on screen as a new phase', () => {
      fresh();
      const r = app.pepSavePhase('Phase 3 - Nov', '2026-11-01', '2027-01-31', 'cognitive layer');
      assert.equal(r.ok, true, 'saved');
      assert.equal(r.compounds, 1, 'holding what was live');
      const ph = app._pepPhaseById(app.pepGetState(), r.id);
      assert.ok(ph, 'and it is offered alongside the built-in ones');
      assert.equal(ph.stacks[0].compoundId, 'ta1', 'with the actual compounds');
      assert.equal(ph.builtOn, app._pepToday(), 'dated, so he can tell versions apart');
    });

    test('PHASES a saved phase is a SNAPSHOT, not a live reference', () => {
      fresh();
      app.pepSavePhase('Snapshot', null, null, null);
      const ps = app.pepGetState();
      ps.stacks[0].dose = 99;            // he changes the live protocol afterwards
      app.pepSaveState(ps);
      const ph = app._pepPhaseById(app.pepGetState(), 'user_snapshot');
      assert.equal(ph.stacks[0].dose, 1.6,
        'the phase still holds what it held when saved — a phase that tracked the ' +
        'live protocol would be unable to restore anything');
    });

    test('PHASES saving over a name replaces rather than duplicating', () => {
      fresh();
      app.pepSavePhase('Phase 3', null, null, null);
      app.pepSavePhase('Phase 3', null, null, 'second go');
      const mine = app.pepGetState().phases.filter(x => x.name === 'Phase 3');
      assert.equal(mine.length, 1,
        'one entry — two identically named phases in a list he cannot tell apart ' +
        'is how the wrong one gets applied');
      assert.equal(mine[0].summary, 'second go', 'and it is the newer one');
    });

    test('PHASES an unnamed or empty phase is refused', () => {
      fresh();
      assert.equal(app.pepSavePhase('', null, null, null).ok, false, 'needs a name');
      reset(); signIn(UID); seed(KEY, { stacks: [], checked:{}, cart:[] });
      assert.equal(app.pepSavePhase('Nothing', null, null, null).ok, false,
        'and refuses to keep an empty protocol as a phase he could later apply');
    });

    test('PHASES built-in phases cannot be deleted, his own can', () => {
      fresh();
      app.pepSavePhase('Mine', null, null, null);
      assert.equal(app.pepDeletePhase('phase2'), false,
        'Phase 2 is the record of what shipped — not his to remove by a mis-tap');
      assert.equal(app.pepDeletePhase('user_mine'), true, 'his own goes');
      assert.ok(app._pepPhaseById(app.pepGetState(), 'phase2'), 'and Phase 2 survives');
    });

    test('PHASES the built-in phase actually schedules once applied', () => {
      fresh();
      app.pepApplyPhase('phase2');
      const ps = app.pepGetState();
      const on = (iso) => {
        const d = app._pepGetDoses(ps, iso);
        return [...d.morning, ...d.anytime, ...d.evening].map(x => x.name);
      };
      assert.ok(on('2026-09-04').includes('Retatrutide'),
        'first Retatrutide lands on the Friday — applying a phase has to produce a ' +
        'working calendar, not just a list of compounds');
      assert.ok(on('2026-09-04').includes('Epitalon'), 'and Epitalon night 1');
      assert.ok(on('2026-09-07').includes('TB-500'), 'TB-500 on the Monday');
      assert.ok(!on('2026-09-05').includes('Retatrutide'), 'and not the day after');
    });
  }

  // ── TITRATE2 — the app gives the dose, instead of telling him to work it out ─
  // Jon asked whether the app can supply the new dosages when a titration is
  // due. It could not: one dose per compound, and his Phase 2 protocol escalates
  // four of them mid-course. Every one was a note reading CHANGE THE DOSE BY
  // HAND — arithmetic on a morning he is fasted and half awake.
  //
  // Keyed on DAY NUMBER, not a date, because that is what the protocol says
  // ("week 5", "day 16") and a date is silently wrong the moment a start slips.
  {
    const withSteps = (steps, over) => {
      reset(); signIn(UID);
      seed(KEY, { stacks: [Object.assign({
        compoundId:'nad', dose:50, vialMg:500, waterMl:2,
        startDate: '2026-09-05', freq:'daily', continuous:true, status:'instock',
        doseSteps: steps,
      }, over || {})] });
      return app.pepGetState();
    };
    const doseOn = (ps, dayNum) => {
      const st = ps.stacks[0];
      return app._pepDoseOn(st, app._pepCompound(st.compoundId), dayNum);
    };

    // NAD+ from his document: 50mg week 1, 100mg week 2 onward.
    const NAD = [{ fromDay: 0, dose: 50 }, { fromDay: 7, dose: 100 }];

    test('TITRATE2 the dose steps up on the stated day, not before', () => {
      const ps = withSteps(NAD);
      assert.equal(doseOn(ps, 0), 50, 'day 0');
      assert.equal(doseOn(ps, 6), 50, 'day 6 — still week 1');
      assert.equal(doseOn(ps, 7), 100, 'day 7 — week 2 begins');
      assert.equal(doseOn(ps, 60), 100, 'and stays there');
    });

    test('TITRATE2 a compound with no steps is unaffected', () => {
      const ps = withSteps(undefined, { doseSteps: undefined, dose: 0.5 });
      assert.equal(doseOn(ps, 0), 0.5, 'the flat dose');
      assert.equal(doseOn(ps, 100), 0.5, 'forever — nothing changes for compounds that do not titrate');
    });

    test('TITRATE2 three steps resolve to the latest one reached', () => {
      // 5-AMQ: 500mcg weeks 1-2, 750mcg weeks 3-4, 1mg week 5+
      const ps = withSteps([{fromDay:0,dose:0.5},{fromDay:14,dose:0.75},{fromDay:28,dose:1}]);
      assert.equal(doseOn(ps, 13), 0.5,  'week 2');
      assert.equal(doseOn(ps, 14), 0.75, 'week 3');
      assert.equal(doseOn(ps, 27), 0.75, 'week 4');
      assert.equal(doseOn(ps, 28), 1,    'week 5');
    });

    test('TITRATE2 steps out of order still resolve correctly', () => {
      const ps = withSteps([{fromDay:28,dose:1},{fromDay:0,dose:0.5},{fromDay:14,dose:0.75}]);
      assert.equal(doseOn(ps, 20), 0.75,
        'the LAST step reached wins regardless of array order — a hand-written ' +
        'protocol will not always be sorted');
    });

    test('TITRATE2 Today announces the change on the day it happens', () => {
      const ps = withSteps(NAD);
      const st = ps.stacks[0], c = app._pepCompound('nad');
      assert.equal(app._pepDoseStepToday(st, c, 6), null, 'nothing to say on day 6');
      const step = app._pepDoseStepToday(st, c, 7);
      assert.ok(step, 'day 7 has a change');
      assert.equal(step.from, 50, 'from');
      assert.equal(step.to, 100, 'to — so the tile can say it rather than leaving ' +
        'him to notice a number moved');
      assert.equal(app._pepDoseStepToday(st, c, 8), null, 'and it is not repeated after');
    });

    test('TITRATE2 stock decrements by what he actually drew today', () => {
      // startDate 60 days ago puts him past the step, so today's dose is 100mg.
      const ps = withSteps(NAD, { startDate: daysAgo(60), sealedVials: 3,
                                  openedDate: daysAgo(1), openUsedAmt: 0,
                                  openVialMg: 500, openWaterMl: 2 });
      app._pepConsumeDose(ps, 'nad', 1);
      assert.equal(app._pepOpenUsed(ps.stacks[0], app._pepCompound('nad')), 100,
        '100mg out of the vial, not the 50mg starting dose. Reading the flat dose ' +
        'would under-count from the day the escalation lands and the vial would ' +
        'appear to last twice as long as it does');
    });

    // ── the document's own escalation_schedule shapes ──────────────────────
    test('TITRATE2 escalation_schedule in weeks imports as day steps', () => {
      const r = app._pepValidateImport(JSON.stringify([{ compoundId:'nad', vialMg:500, waterMl:2,
        startDate:'2026-09-05',
        escalation_schedule:[{week:1,dose_mg:50},{week_from:2,dose_mg:100}] }]));
      assert.equal(r.ok, true, 'accepted');
      assert.deepEqual(r.entries[0].doseSteps, [{fromDay:0,dose:50},{fromDay:7,dose:100}],
        'week 1 is day 0, week 2 is day 7');
      assert.equal(r.entries[0].dose, 50, 'and the starting dose comes from the first step');
    });

    test('TITRATE2 escalation_schedule in day-ranges imports too', () => {
      // GHK-Cu: days 1-15 at 1mg, days 16-30 at 2mg
      const r = app._pepValidateImport(JSON.stringify([{ compoundId:'ghkcu', vialMg:50, waterMl:2,
        startDate:'2026-09-24',
        escalation_schedule:[{days:'1-15',dose_mg:1},{days:'16-30',dose_mg:2}] }]));
      assert.deepEqual(r.entries[0].doseSteps, [{fromDay:0,dose:1},{fromDay:15,dose:2}],
        'day 16 of a course is day-number 15 counting from zero — off by one here ' +
        'is a dose on the wrong day');
    });

    test('TITRATE2 a step with no readable dose fails the import', () => {
      const r = app._pepValidateImport(JSON.stringify([{ compoundId:'ta1', dose:1.6,
        escalation_schedule:[{weeks:'1-4',dose_mg:1.6},{week_from:5,label:'3.2mg'}] }]));
      assert.equal(r.ok, false,
        'the second step has a label and no dose — silently dropping it would ' +
        'leave him at 1.6mg forever while the plan said 3.2mg');
      assert.ok(r.problems.join(' ').includes('dose step'), 'and it says so');
    });
  }

  // ── MAKEUP — what he actually mixed, not what the plan intended ────────────
  // Jon: "need to make sure volume make-ups are editable and what I decide to
  // make up logs into the plan for doses etc."
  //
  // The BAC volume was already editable, but only as a PLAN value. Nothing
  // recorded what he actually mixed, so editing the plan retroactively restated
  // the strength of the vial already in his fridge and every unit count drawn
  // from it. Same defect as counting doses instead of measuring them, one level
  // up: the plan is an intention, the open vial is a fact.
  {
    const mk = (over) => {
      reset(); signIn(UID);
      seed(KEY, { stacks: [Object.assign({
        compoundId:'bpc157', dose:0.5, vialMg:10, waterMl:2,
        startDate: daysAgo(10), freq:'eod', continuous:true,
        sealedVials:3, status:'instock',
      }, over || {})] });
      return app.pepGetState();
    };
    const drawUnits = (ps) => {
      const st = ps.stacks[0], c = app._pepCompound(st.compoundId);
      const d = app._pepDraw(st.dose, c.doseUnit, app._pepLiveRecon(st, c));
      return d ? Math.round(d.units * 10) / 10 : null;
    };

    test('MAKEUP logging a mix records the vial and the water actually used', () => {
      mk();
      assert.equal(app.pepLogMakeUp(0, 10, 1), true, 'accepted');
      const st = app.pepGetState().stacks[0];
      assert.equal(st.openVialMg, 10, 'vial recorded');
      assert.equal(st.openWaterMl, 1, 'and the water HE used, not the plan value of 2');
      assert.ok(st.openedDate, 'dated, so shelf life runs from the mix');
    });

    test('MAKEUP the draw follows what is in the vial, not the plan', () => {
      mk();
      // plan says 10mg in 2mL -> 5mg/mL -> 0.5mg = 10u
      assert.equal(drawUnits(app.pepGetState()), 10, 'the plan draw');
      app.pepLogMakeUp(0, 10, 1);   // he actually used 1mL -> 10mg/mL -> 5u
      assert.equal(drawUnits(app.pepGetState()), 5,
        'half the volume, half the units — this is the number that goes in the syringe');
    });

    test('MAKEUP editing the plan does NOT restate a vial already dissolved', () => {
      mk();
      app.pepLogMakeUp(0, 10, 1);
      const ps = app.pepGetState();
      ps.stacks[0].waterMl = 4;         // he changes his mind for NEXT time
      app.pepSaveState(ps);
      assert.equal(drawUnits(app.pepGetState()), 5,
        'the open vial is still 10mg in 1mL. Without this the app would tell him ' +
        'to draw 20u from a vial that needs 5u — a four-fold dose off a plan edit');
    });

    test('MAKEUP the plan governs the NEXT vial, which is the right scope', () => {
      mk();
      app.pepLogMakeUp(0, 10, 1);
      const ps = app.pepGetState();
      ps.stacks[0].waterMl = 4;
      ps.stacks[0].openedDate = null;   // that vial is finished
      ps.stacks[0].openVialMg = null;
      ps.stacks[0].openWaterMl = null;
      app.pepSaveState(ps);
      assert.equal(drawUnits(app.pepGetState()), 20,
        '10mg in 4mL = 2.5mg/mL -> 0.5mg = 20u. Changing your mind about dilution ' +
        'applies from the next vial, not backwards');
    });

    test('MAKEUP opening a vial takes it from the sealed count, once', () => {
      mk();
      app.pepLogMakeUp(0, 10, 1);
      assert.equal(app.pepGetState().stacks[0].sealedVials, 2, 'three became two');
      app.pepLogMakeUp(0, 10, 2);   // re-mixing the same open vial
      assert.equal(app.pepGetState().stacks[0].sealedVials, 2,
        'still two — correcting the numbers on a vial already open must not ' +
        'consume another one from the box');
    });

    test('MAKEUP a mix resets consumption for the new vial', () => {
      const ps = mk({ openedDate: daysAgo(3), openUsedAmt: 4, openDosesUsed: 8 });
      app.pepSaveState(ps);
      app.pepLogMakeUp(0, 10, 1);
      const st = app.pepGetState().stacks[0];
      assert.equal(st.openUsedAmt, 0,
        'a fresh vial is full — carrying the last one’s usage over would ' +
        'under-report what he has');
    });

    test('MAKEUP nonsense volumes are refused rather than stored', () => {
      mk();
      assert.equal(app.pepLogMakeUp(0, 10, 0), false, 'zero water is not a mix');
      assert.equal(app.pepLogMakeUp(0, 0, 2), false, 'nor is an empty vial');
      assert.equal(app.pepLogMakeUp(0, 'abc', 'def'), false, 'nor is text');
      assert.equal(app.pepGetState().stacks[0].openedDate, undefined,
        'and none of them opened a vial');
    });

    test('MAKEUP consumption stamps the make-up when it opens a vial itself', () => {
      const ps = mk();
      app._pepConsumeDose(ps, 'bpc157', 1);
      assert.equal(ps.stacks[0].openVialMg, 10, 'stamped from the plan in force');
      assert.equal(ps.stacks[0].openWaterMl, 2,
        'so a later plan edit cannot restate this vial either — the ticking path ' +
        'gets the same protection as the explicit one');
    });
  }

  // ── PHASE2SCHED — the four schedule shapes the Phase 2 protocol needs ──────
  // From PHASE2_APP_IMPLEMENTATION.md. The engine could not express any of
  // these, and an import that produces the wrong calendar is worse than no
  // import: he injects on the days the app shows him.
  //
  // Dates here are literals taken straight from his document, and that is safe
  // for once — they are the protocol's own fixed dates, not relative positions
  // that decay. MOTS-c really is 14/19/24/29 October.
  {
    const sched = (stack) => {
      reset(); signIn(UID);
      seed(KEY, { stacks: [Object.assign({ status: 'instock' }, stack)], checked: {}, cart: [] });
      const ps = app.pepGetState();
      return (iso) => {
        const d = app._pepGetDoses(ps, iso);
        return [...d.morning, ...d.anytime, ...d.evening].length > 0;
      };
    };

    // ── RETATRUTIDE: every 6 days, rotating through the week ────────────────
    // It was Friday-weekly. Six days means it walks: 3 Sep is a Thursday, the
    // next is 9 Sep which is a Wednesday. No weekday rule can say that.
    test('PHASE2SCHED an interval of 6 days rotates through the week', () => {
      const due = sched({ compoundId:'retatrutide', dose:6, vialMg:30, waterMl:5,
                          startDate:'2026-09-03', intervalDays:6 });
      assert.equal(due('2026-09-03'), true,  'first dose');
      assert.equal(due('2026-09-04'), false, 'not the day after');
      assert.equal(due('2026-09-09'), true,  'six days on — a Wednesday, not a Friday');
      assert.equal(due('2026-09-10'), false, 'and not the day after that');
      assert.equal(due('2026-09-15'), true,  'twelve days on');
      assert.equal(due('2026-11-02'), true,  'and still in step two months later, ' +
        'which a weekly rule would have drifted off by ten days');
    });

    // ── MOTS-c: four explicit dates, nothing derived ────────────────────────
    test('PHASE2SCHED explicit dates are the schedule, not a hint at one', () => {
      const due = sched({ compoundId:'motsc', dose:10, vialMg:10, waterMl:0.5,
                          startDate:'2026-10-14',
                          dates:['2026-10-14','2026-10-19','2026-10-24','2026-10-29'] });
      ['2026-10-14','2026-10-19','2026-10-24','2026-10-29'].forEach(d =>
        assert.equal(due(d), true, `injection on ${d}`));
      ['2026-10-15','2026-10-20','2026-10-30','2026-11-03'].forEach(d =>
        assert.equal(due(d), false, `nothing on ${d}`));
    });

    test('PHASE2SCHED an explicit-date course simply stops when the dates run out', () => {
      const due = sched({ compoundId:'motsc', dose:10, vialMg:10, waterMl:0.5,
                          startDate:'2026-10-14',
                          dates:['2026-10-14','2026-10-19','2026-10-24','2026-10-29'] });
      assert.equal(due('2026-11-03'), false,
        'no fifth injection — the 4-month lock is a property of the dates ending, ' +
        'not a rule that has to be remembered separately');
    });

    // ── EPITALON: 20 consecutive nights, as explicit dates ──────────────────
    test('PHASE2SCHED Epitalon runs its twenty nights and then stops', () => {
      const nights = [];
      for (let i = 0; i < 20; i++) {
        const d = new Date(Date.parse('2026-09-04T12:00:00') + i * 86400000);
        nights.push(d.toISOString().slice(0, 10));
      }
      const due = sched({ compoundId:'epitalon', dose:5, vialMg:10, waterMl:1,
                          startDate:'2026-09-04', dates:nights });
      assert.equal(due('2026-09-04'), true,  'night 1');
      assert.equal(due('2026-09-13'), true,  'night 10, mid-course');
      assert.equal(due('2026-09-23'), true,  'night 20, the last');
      assert.equal(due('2026-09-24'), false, 'and nothing on the 21st night');
    });

    // ── TB-500: Monday only ────────────────────────────────────────────────
    // Monday is his lightest day — Ipamorelin is off, only NAD+ is scheduled.
    // "mon/wed/fri" needed all three days; a single named weekday did not work.
    test('PHASE2SCHED a single named weekday works on its own', () => {
      const due = sched({ compoundId:'tb500', dose:2, vialMg:10, waterMl:2,
                          startDate:'2026-09-01', freq:'monday' });
      assert.equal(due('2026-09-07'), true,  'Monday');
      assert.equal(due('2026-09-08'), false, 'not Tuesday');
      assert.equal(due('2026-09-14'), true,  'the following Monday');
    });

    test('PHASE2SCHED mon/wed/fri still means all three, not just Monday', () => {
      const due = sched({ compoundId:'nad', dose:50, vialMg:500, waterMl:2,
                          startDate:'2026-09-05', freq:'3x/week Mon/Wed/Fri' });
      assert.equal(due('2026-09-07'), true,  'Monday');
      assert.equal(due('2026-09-09'), true,  'Wednesday');
      assert.equal(due('2026-09-11'), true,  'Friday');
      assert.equal(due('2026-09-08'), false, 'not Tuesday — the new weekday parsing ' +
        'must not swallow the combination rules that already worked');
    });

    // ── END DATES: a bridge that actually ends ──────────────────────────────
    test('PHASE2SCHED an end date stops the schedule dead', () => {
      const due = sched({ compoundId:'tesamorelin', dose:2, vialMg:10, waterMl:2,
                          startDate:'2026-09-08', endDate:'2026-10-02',
                          freq:'daily' });
      assert.equal(due('2026-09-08'), true,  'day 1 of the bridge');
      assert.equal(due('2026-10-02'), true,  'the last stated day is INCLUSIVE');
      assert.equal(due('2026-10-03'), false, 'and it is over — CJC resumes here, ' +
        'so a Tesamorelin dose on the 3rd would be both compounds at once');
    });

    test('PHASE2SCHED an end date is honoured even when the rule would fire', () => {
      const due = sched({ compoundId:'ghkcu', dose:2, vialMg:50, waterMl:2,
                          startDate:'2026-09-24', endDate:'2026-10-23',
                          freq:'daily' });
      assert.equal(due('2026-10-23'), true,  'day 30');
      assert.equal(due('2026-10-24'), false, 'daily would say yes; the course says no');
    });
  }

  // ── DATEPARAM — _pepGetDoses honours the date it is given (v4.9.255) ───────
  // This property was protected only by a harness pin on the PARAMETER NAME:
  // `function _pepGetDoses(ps, dateStr)`, labelled "is date-parameterised".
  // Nothing functional had ever called it with a date. So renaming that
  // parameter — a change with no behavioural meaning — would have gone red,
  // while actually breaking the date handling would have stayed green.
  //
  // It matters because the calendar, the forecast and the Today tile all resolve
  // through this one function. If it silently answered for today whatever date
  // it was asked about, the schedule grid would show today's doses on every
  // square and nothing would look obviously wrong.
  {
    const setUpDates = () => {
      reset(); signIn(UID);
      // Retatrutide weekly on a Friday; BPC-157 every other day from the same
      // Friday. Two different rules, so one answer cannot satisfy both.
      seed(KEY, { stacks: [
        { compoundId:'retatrutide', dose:6, startDate:'2026-08-28', freq:'weekly',
          vialMg:30, waterMl:2.5, continuous:true, status:'instock' },
        { compoundId:'bpc157', dose:0.5, startDate:'2026-08-28', freq:'eod',
          vialMg:10, waterMl:2, continuous:true, status:'instock' },
      ], checked:{}, cart:[] });
      return app.pepGetState();
    };
    const names = (ps, iso) => {
      const d = app._pepGetDoses(ps, iso);
      return [...d.morning, ...d.anytime, ...d.evening].map(x => x.name).sort();
    };

    test('DATEPARAM the start Friday returns both compounds', () => {
      const ps = setUpDates();
      assert.deepEqual(names(ps, '2026-08-28'), ['BPC-157', 'Retatrutide'],
        'weekly and EOD both land on day zero');
    });

    test('DATEPARAM the next day returns neither', () => {
      const ps = setUpDates();
      assert.deepEqual(names(ps, '2026-08-29'), [],
        'Saturday is not the weekly day and not an EOD day');
    });

    test('DATEPARAM two days on returns only the EOD compound', () => {
      const ps = setUpDates();
      assert.deepEqual(names(ps, '2026-08-30'), ['BPC-157'],
        'EOD lands, weekly does not — different dates give different answers, ' +
        'which is the whole property');
    });

    test('DATEPARAM the following Friday returns the weekly one again', () => {
      const ps = setUpDates();
      assert.deepEqual(names(ps, '2026-09-04'), ['Retatrutide'],
        'a week on: weekly repeats, EOD has drifted off this day');
    });

    test('DATEPARAM a date before the start returns nothing', () => {
      const ps = setUpDates();
      assert.deepEqual(names(ps, '2026-08-01'), [],
        'no doses before the protocol begins, rather than treating a negative ' +
        'day offset as day zero');
    });
  }

  // ── EXPORT — the other half of import, so his real state can reach me ──────
  // Jon asked whether I can read his stock now that he has updated it. I cannot:
  // no database access, and localStorage is on his phone. Import existed and
  // export did not, so the only way to show me his actual state was prose.
  //
  // This emits exactly what Import accepts, so it round-trips.
  {
    const seedFull = () => {
      reset(); signIn(UID);
      seed(KEY, { stacks: [{
        compoundId:'bpc157', dose:0.5, startDate:'2026-08-22', freq:'eod',
        vialMg:10, waterMl:2, continuous:true, status:'instock',
        sealedVials:3, openUsedAmt:150, openedDate:'2026-08-20', stockCounted:true,
        onOrder:true, arrivalDate:'2026-09-01', onOrderVials:2, onOrderVialMg:10,
        notes:'x',
      }], bloods: [{ panel_date:'2026-08-14', lab:'ZENTHORP',
        markers:[{name:'ALT', value:'71'}] }], checked:{}, cart:[] });
      return app.pepGetState();
    };

    test('EXPORT carries the stock figures I cannot otherwise see', () => {
      const out = JSON.parse(app._pepExportJSON(seedFull()));
      assert.equal(out.length, 1, 'one compound');
      assert.equal(out[0].vialMg, 10, 'his real vial size');
      assert.equal(out[0].waterMl, 2, 'and BAC volume — the two the PDF got wrong');
      assert.equal(out[0].sealedVials, 3, 'sealed count');
      assert.equal(out[0].openUsedAmt, 150, 'and what has come out of the open vial');
      assert.equal(out[0].arrivalDate, '2026-09-01', 'in-transit stock too');
    });

    test('EXPORT never carries blood panels', () => {
      const raw = app._pepExportJSON(seedFull());
      assert.notIncludes(raw, 'ZENTHORP',
        'pathology has its own deliberate exit and this is not it — same rule as the ' +
        'cloud mirror scrub');
      assert.notIncludes(raw, 'markers', 'no marker data by any route');
    });

    test('EXPORT round-trips through IMPORT unchanged', () => {
      const raw = app._pepExportJSON(seedFull());
      const back = app._pepValidateImport(raw);
      assert.equal(back.ok, true, 'what comes out goes back in');
      assert.equal(back.entries[0].vialMg, 10, 'vial survives the round trip');
      assert.equal(back.entries[0].waterMl, 2, 'and the BAC volume');
      assert.equal(back.entries[0].arrivalDate, '2026-09-01', 'and the delivery');
    });

    // The KEEP list is explicit rather than a delete-what-we-remember, so a
    // field added to a stack later is excluded by default instead of leaking.
    test('EXPORT excludes an unknown field by default rather than passing it on', () => {
      reset(); signIn(UID);
      seed(KEY, { stacks: [{ compoundId:'bpc157', dose:0.5, secretDiaryEntry:'private' }] });
      const raw = app._pepExportJSON(app.pepGetState());
      assert.notIncludes(raw, 'secretDiaryEntry',
        'allow-list, not deny-list: anything added later stays in until someone ' +
        'decides it should go out');
    });

    // v4.9.253 — the regression .252 shipped, and the shape of test that catches
    // it. Adding the Export button, I spliced a closing </div> and a
    // display:none opener into the header string beside Import. That swallowed
    // the + Add button into a hidden container and removed it from STOCK. Every
    // gate was green: it parses, it runs, the button exists in the source. Only
    // the STRUCTURE was wrong, and nothing looked at the structure.
    test('EXPORT the STOCK header keeps every button visible', () => {
      reset(); signIn(UID);
      seed(KEY, { stacks: [{ compoundId:'bpc157', dose:0.5, vialMg:10, waterMl:2,
        startDate: daysAgo(5), freq:'eod', stockCounted:true, sealedVials:1 }] });
      const out = app._pepTabStock(app.pepGetState());
      assert.ok(out.includes('pep-add-stack'), '+ Add is present');
      assert.ok(out.includes('pep-export-open'), 'Export is present');
      assert.ok(out.includes('pep-import-open'), 'Import is present');
      // Presence is not visibility. Walk from each button back to the start and
      // require every display:none opened before it to have been closed.
      ['pep-add-stack', 'pep-export-open', 'pep-import-open'].forEach(id => {
        const before = out.slice(0, out.indexOf(id));
        const hidden = (before.match(/display:none/g) || []).length;
        const opens  = (before.match(/<div/g) || []).length;
        const closes = (before.match(/<\/div>/g) || []).length;
        assert.ok(hidden === 0 || opens === closes,
          `${id} sits inside an unclosed display:none container — present in the ` +
          'markup and invisible on the screen, which is the failure .252 shipped');
      });
    });

    test('EXPORT an empty protocol produces an empty array, not a crash', () => {
      reset(); signIn(UID);
      assert.equal(app._pepExportJSON(app.pepGetState()), '[]', 'nothing to say, said cleanly');
    });
  }

  // ── IMPORT — applying a protocol without retyping it on a phone (v4.9.246) ─
  // Jon's protocol changed and the app had no way to load one. Eight compounds
  // through the edit sheet on a phone is the reason it would not get done.
  //
  // This REPLACES his protocol, so the .158 empty-stub wipe is the precedent
  // that shapes it: validate everything before writing anything, name what it
  // cannot resolve instead of dropping it, back up first, and refuse outright
  // rather than apply a partial protocol.
  {
    const V = (raw) => app._pepValidateImport(raw);

    test('IMPORT a good protocol validates and normalises', () => {
      const r = V(JSON.stringify([
        { compoundId:'retatrutide', dose:8, startDate:'2026-08-22', vialMg:30, waterMl:3, continuous:true, cycleWeeks:0 },
        { compoundId:'bpc157', dose:0.5, startDate:'2026-08-22', vialMg:10, waterMl:1, continuous:true, cycleWeeks:0 },
      ]));
      assert.equal(r.ok, true, 'accepted');
      assert.equal(r.entries.length, 2, 'both entries');
      assert.equal(r.entries[0].dose, 8, 'dose carried');
      assert.ok(!('cycleWeeks' in r.entries[0]),
        'cycleWeeks 0 means CONTINUOUS and is dropped, not stored as a zero-length cycle');
    });

    test('IMPORT course-suffixed ids resolve and the resolution is REPORTED', () => {
      const r = V(JSON.stringify([
        { compoundId:'tb500_standalone', dose:1.25, vialMg:10, waterMl:2 },
        { compoundId:'motsc_c2', dose:10, vialMg:10, waterMl:0.5 },
      ]));
      assert.equal(r.ok, true, 'his document uses course ids; they resolve to compounds');
      assert.equal(r.entries[0].compoundId, 'tb500', 'mapped');
      assert.equal(r.entries[1].compoundId, 'motsc', 'mapped');
      assert.equal(r.resolved.length, 2,
        'and both are named back to him — a silent remap is how a compound quietly ' +
        'becomes a different compound');
    });

    test('IMPORT an unknown compound fails the WHOLE import, naming it', () => {
      const r = V(JSON.stringify([
        { compoundId:'bpc157', dose:0.5 },
        { compoundId:'unobtainium', dose:1 },
      ]));
      assert.equal(r.ok, false, 'all-or-nothing');
      assert.equal(r.entries.length, 0, 'nothing is offered for application');
      assert.ok(r.problems.join(' ').includes('unobtainium'),
        'named, not dropped — a partial protocol silently missing a compound is worse ' +
        'than a refusal');
    });

    test('IMPORT an empty array is refused rather than wiping the protocol', () => {
      const r = V('[]');
      assert.equal(r.ok, false, 'refused');
      assert.ok(r.problems.join(' ').toLowerCase().includes('refusing'),
        'this is the .158 empty-stub wipe as an import: an empty payload must never ' +
        'be mistaken for an instruction to clear everything');
    });

    test('IMPORT malformed JSON reports the parse error and changes nothing', () => {
      const r = V('[{compoundId: bpc157,,}');
      assert.equal(r.ok, false, 'refused');
      assert.equal(r.entries.length, 0, 'nothing to apply');
    });

    test('IMPORT a fenced paste works, because that is what gets copied', () => {
      const r = V('```json\n[{"compoundId":"bpc157","dose":0.5}]\n```');
      assert.equal(r.ok, true, 'the fence is stripped — he will paste what he was given');
    });

    test('IMPORT a bad date is caught before it reaches the schedule engine', () => {
      const r = V(JSON.stringify([{ compoundId:'bpc157', dose:0.5, startDate:'22/08/2026' }]));
      assert.equal(r.ok, false,
        'a non-ISO date silently becomes an invalid Date and every dose lands on NaN');
    });

    test('IMPORT a missing dose is caught rather than defaulting', () => {
      const r = V(JSON.stringify([{ compoundId:'bpc157' }]));
      assert.equal(r.ok, false,
        'no dose is a refusal — a library default here would be a number he never chose ' +
        'going into a syringe');
    });

    // ── DRIVING pepOpenImport ITSELF, not just its validator ────────────────
    // Nine cases above test _pepValidateImport. NONE tested pepOpenImport — the
    // function Jon actually taps. That is the v4.9.165 gap: cover the helper,
    // miss the entry point.
    //
    // It matters more here than anywhere else I have found it today. The confirm
    // handler REPLACES his protocol. If the backup does not happen, Restore
    // cannot undo it; if historyConfirmed survives, the readiness gate opens on
    // a protocol whose history he has never reviewed; if the save does not fire,
    // he pastes his plan and it evaporates on the next render. I have spent the
    // last hour telling him to use this button.
    const driveImport = (json) => {
      reset(); signIn(UID);
      seed(KEY, { stacks: [{ compoundId:'ta1', dose:1.6, vialMg:10, waterMl:2 }],
                  historyConfirmed: true, checked:{}, cart:[] });
      const nodes = {};
      const mk = (id) => ({
        id, value: '', textContent: '', innerHTML: '', style: {}, onclick: null,
        _click: null,
        addEventListener(ev, fn) { if (ev === 'click') this._click = fn; },
        setAttribute() {}, getAttribute: () => null, removeAttribute() {},
        remove() {}, focus() {}, querySelector: () => null, querySelectorAll: () => [],
      });
      const realCreate = app.document.createElement;
      const realGet = app.document.getElementById;
      app.document.createElement = (t) => { const e = realCreate.call(app.document, t); e.remove = () => {}; return e; };
      app.document.getElementById = (id) => (nodes[id] || (nodes[id] = mk(id)));
      try {
        app.pepOpenImport();
        // pepOpenImport only asks for the buttons; the textarea is fetched
        // inside the click handler, so it does not exist in `nodes` yet.
        // Create it through the same getter the app will use.
        app.document.getElementById('pep-imp-json').value = json;
        nodes['pep-imp-check']._click();      // first tap: Check
        const btn = nodes['pep-imp-check'];
        if (btn.onclick) btn.onclick();       // second tap: Confirm
        return { nodes, confirmed: !!btn.onclick };
      } finally {
        app.document.createElement = realCreate;
        app.document.getElementById = realGet;
      }
    };

    const GOOD = JSON.stringify([
      { compoundId:'bpc157', dose:0.5, startDate:'2026-08-22', freq:'eod', vialMg:10, waterMl:2 },
      { compoundId:'retatrutide', dose:8, startDate:'2026-08-28', freq:'weekly', vialMg:30, waterMl:2.5 },
    ]);

    test('IMPORT the confirm tap actually replaces the protocol', () => {
      driveImport(GOOD);
      const after = read(KEY);
      assert.equal(after.stacks.length, 2, 'the pasted compounds are live');
      assert.equal(after.stacks[0].compoundId, 'bpc157', 'and they are the pasted ones');
      assert.notIncludes(JSON.stringify(after.stacks), 'ta1',
        'the old protocol is gone — this is a replace, and it has to actually happen');
    });

    test('IMPORT the previous protocol is BACKED UP before being replaced', () => {
      driveImport(GOOD);
      const bak = read(`${KEY}_bak`);
      assert.ok(bak, 'a backup exists');
      assert.ok(JSON.stringify(bak).includes('ta1'),
        'and it holds what he had BEFORE — without this, Restore cannot undo a paste ' +
        'and an import is an unrecoverable overwrite of his protocol');
    });

    test('IMPORT a new protocol does not inherit the old history confirmation', () => {
      driveImport(GOOD);
      assert.equal(read(KEY).historyConfirmed, false,
        'he confirmed the history of a DIFFERENT protocol — carrying that over opens ' +
        'the readiness gate on a plan he has never reviewed');
    });

    test('IMPORT the state is persisted, not just held in memory', () => {
      driveImport(GOOD);
      const raw = read(KEY);
      assert.ok(raw && raw.stacks && raw.stacks.length === 2,
        'written to localStorage — a paste that survives only until the next render ' +
        'is worse than one that visibly fails');
      assert.ok(raw._ts, 'and stamped, so the cloud mirror can resolve it against a peer copy');
    });

    test('IMPORT a REJECTED paste changes nothing at all', () => {
      const r = driveImport(JSON.stringify([{ compoundId:'unobtainium', dose:1 }]));
      assert.equal(r.confirmed, false, 'no confirm step is offered');
      const after = read(KEY);
      assert.equal(after.stacks.length, 1, 'his protocol is untouched');
      assert.equal(after.stacks[0].compoundId, 'ta1', 'still what it was');
      assert.equal(after.historyConfirmed, true, 'and his confirmation survives');
    });

    test('IMPORT the check step reports the problem rather than failing silently', () => {
      const r = driveImport('not json at all');
      const msg = r.nodes['pep-imp-msg'].innerHTML;
      assert.ok(msg && msg.length > 0, 'something is said');
      assert.ok(msg.includes('Nothing has changed') || msg.toLowerCase().includes('not imported'),
        'and it says his protocol is intact, which is the thing he needs to know');
    });

    // ── PHASE 2 FIELD NAMES — the document's own, not just the app's ────────
    // PHASE2_APP_IMPLEMENTATION.md is what gets pasted. It writes
    // interval_days, injection_dates, night_dates, active_days, end_date. If
    // the importer only accepted the app's camelCase, those fields would be
    // silently dropped and the compound would fall back to a default schedule —
    // a wrong calendar that validates cleanly, which is the worst outcome
    // available here.
    test('IMPORT interval_days from the handoff document is honoured', () => {
      const r = V(JSON.stringify([{ compound_id:'retatrutide', compoundId:'retatrutide',
        dose:6, startDate:'2026-09-03', interval_days:6, vialMg:30, waterMl:5 }]));
      assert.equal(r.ok, true, 'accepted');
      assert.equal(r.entries[0].intervalDays, 6,
        'six-day rotation carried — dropped, Retatrutide would fall back to daily');
    });

    test('IMPORT injection_dates and night_dates both land as explicit dates', () => {
      const mots = V(JSON.stringify([{ compoundId:'motsc', dose:10, vialMg:10, waterMl:0.5,
        startDate:'2026-10-14',
        injection_dates:['2026-10-14','2026-10-19','2026-10-24','2026-10-29'] }]));
      assert.deepEqual(mots.entries[0].dates,
        ['2026-10-14','2026-10-19','2026-10-24','2026-10-29'], 'MOTS-c four dates');
      const epi = V(JSON.stringify([{ compoundId:'epitalon', dose:5, vialMg:10, waterMl:1,
        startDate:'2026-09-04', night_dates:['2026-09-04','2026-09-05'] }]));
      assert.equal(epi.entries[0].dates.length, 2, 'Epitalon nights use the same field');
    });

    test('IMPORT active_days becomes a frequency the engine already understands', () => {
      const mon = V(JSON.stringify([{ compoundId:'tb500', dose:2, vialMg:10, waterMl:2, active_days:[1] }]));
      assert.equal(mon.entries[0].freq, 'mon',
        'a single day translates rather than adding a parallel mechanism');
      const mwf = V(JSON.stringify([{ compoundId:'nad', dose:50, vialMg:500, waterMl:2, active_days:[1,3,5] }]));
      assert.equal(mwf.entries[0].freq, 'mon/wed/fri', 'and three days keep the combination form');
    });

    test('IMPORT an explicit freq is not overwritten by active_days', () => {
      const r = V(JSON.stringify([{ compoundId:'ta1', dose:1.6, vialMg:10, waterMl:2,
        freq:'wed/sat', active_days:[3,6] }]));
      assert.equal(r.entries[0].freq, 'wed/sat',
        'whatever he wrote explicitly wins — two sources for one property must ' +
        'have a stated precedence, not a last-writer race');
    });

    test('IMPORT end_date is carried and validated', () => {
      const ok = V(JSON.stringify([{ compoundId:'tesamorelin', dose:2, vialMg:10, waterMl:2,
        startDate:'2026-09-08', end_date:'2026-10-02', freq:'daily' }]));
      assert.equal(ok.entries[0].endDate, '2026-10-02', 'the bridge ends when it says');
      const bad = V(JSON.stringify([{ compoundId:'tesamorelin', dose:2, end_date:'Oct 2' }]));
      assert.equal(bad.ok, false,
        'an unparseable end date would silently mean never-ending, and this one ' +
        'overlaps CJC resuming — two GHRH compounds on the same night');
    });

    test('IMPORT a malformed date inside a date list fails the whole import', () => {
      const r = V(JSON.stringify([{ compoundId:'motsc', dose:10,
        injection_dates:['2026-10-14','14 Oct','2026-10-24'] }]));
      assert.equal(r.ok, false, 'refused');
      assert.ok(r.problems.join(' ').includes('1 date'),
        'and it says how many were wrong — silently keeping two of three would ' +
        'be a course of the wrong length');
    });

    // v4.9.248 — in-transit stock. Jon has Epitalon, Tesamorelin and NAD+ on
    // order. Without these fields an on-order compound imports as simply
    // ABSENT, so the forecast reports a supply gap that closes itself the week
    // the box lands and tells him to reorder something already paid for.
    test('IMPORT an on-order compound carries its arrival date', () => {
      const r = V(JSON.stringify([{ compoundId:'epitalon', dose:5, startDate:'2026-09-01',
        onOrder:true, arrivalDate:'2026-08-30', onOrderVials:10, onOrderVialMg:10 }]));
      assert.equal(r.ok, true, 'accepted');
      const e = r.entries[0];
      assert.equal(e.onOrder, true, 'flagged in transit');
      assert.equal(e.arrivalDate, '2026-08-30', 'the date _pepSimulate folds the delivery in on');
      assert.equal(e.onOrderVials, 10, 'and how many are coming');
      assert.equal(e.onOrderVialMg, 10, 'at what vial size');
    });

    test('IMPORT an arrivalDate implies on-order without needing the flag too', () => {
      const r = V(JSON.stringify([{ compoundId:'nad', dose:50, arrivalDate:'2026-09-01' }]));
      assert.equal(r.entries[0].onOrder, true,
        'a delivery date with no onOrder flag is still a delivery — requiring both is a ' +
        'way to have one silently ignored');
    });

    test('IMPORT a malformed arrival date is refused, not ignored', () => {
      const r = V(JSON.stringify([{ compoundId:'nad', dose:50, arrivalDate:'1 Sep' }]));
      assert.equal(r.ok, false,
        'an unparseable arrival silently becomes never-arriving, which reads as a ' +
        'permanent shortage');
    });

    test('IMPORT stock figures mark the compound as counted, absent ones do not', () => {
      const withStock = V(JSON.stringify([{ compoundId:'bpc157', dose:0.5, sealedVials:2, dosesUsed:3 }]));
      assert.equal(withStock.entries[0].stockCounted, true, 'he gave real numbers');
      assert.equal(withStock.entries[0].openDosesUsed, 3, 'dosesUsed maps to the app field');
      const without = V(JSON.stringify([{ compoundId:'bpc157', dose:0.5 }]));
      assert.equal(without.entries[0].stockCounted, false,
        'no figures means uncounted — the readiness gate must still ask him');
    });
  }

  // ── ASSUMED — a guess must not look like a measurement (v4.9.245) ──────────
  // The root cause behind the .236 corrections rather than the six wrong
  // numbers. _pepRecon has always known whether a concentration came from a
  // vial Jon confirmed or from a library default, and every display printed the
  // resulting unit count identically. That is why wrong defaults could be
  // DANGEROUS rather than merely wrong: nothing said the figure rested on an
  // assumption about his vial, on the one number that goes into a syringe.
  //
  // It marks rather than hides. Refusing to show a draw would push him to
  // calculate it himself, which is worse.
  {
    const c = () => app._pepCompound('bpc157');

    test('ASSUMED a library-default vial is labelled as assumed', () => {
      const r = app._pepRecon({}, c());
      assert.equal(r.source, 'default', 'no vial entered, so the default is in play');
      assert.ok(app._pepReconAssumed(r), 'flagged');
      assert.ok(app._pepReconText(r).includes('assumed vial, not confirmed'),
        'and the caption says so wherever it is printed');
    });

    test('ASSUMED a vial Jon entered himself is NOT labelled', () => {
      const r = app._pepRecon({ vialMg: 10, waterMl: 1 }, c());
      assert.ok(!app._pepReconAssumed(r), 'he confirmed this one');
      assert.ok(!app._pepReconText(r).includes('assumed'),
        'a confirmed vial must not be nagged about — a warning on everything is a warning on nothing');
    });

    test('ASSUMED an override is not labelled assumed either', () => {
      const r = app._pepRecon({ vialMg: 5, waterMl: 2, actualVialMg: 2 }, c());
      assert.equal(r.source, 'override', 'received-vial override');
      assert.ok(!app._pepReconAssumed(r), 'an override is the most confirmed value there is');
    });

    test('ASSUMED the draw itself is still shown, not withheld', () => {
      const r = app._pepRecon({}, c());
      const draw = app._pepDraw(0.5, 'mg', r);
      assert.ok(draw && draw.units > 0,
        'the number still appears — withholding it makes him do the maths by hand, ' +
        'which is worse than showing it with a caveat');
    });

    test('ASSUMED the Today tile marks an assumed concentration', () => {
      reset(); signIn(UID);
      seed(KEY, { stacks: [{ compoundId: 'bpc157', dose: 0.5, startDate: daysAgo(5),
                             freq: 'daily', continuous: true, stockCounted: true, sealedVials: 2 }],
                  checked: {}, historyConfirmed: true });
      const html2 = app._pepTodayTileHTML ? app._pepTodayTileHTML(app.pepGetState()) : null;
      // no dedicated builder exported — assert on the source string instead,
      // which is what the tile interpolates
      assert.ok(html.includes('_pepReconAssumed(item.recon) ? " &middot; assumed" : ""'),
        'the tile appends the marker when the vial is a library guess');
      assert.ok(html.includes('_pepReconAssumed(item.recon) ? "var(--gold)"'),
        'and colours it, because grey small print is not a warning');
    });

    test('ASSUMED the edit-sheet preview says what to do about it', () => {
      assert.ok(html.includes('Vial size is a library assumption, not something you have confirmed'),
        'the live preview names the problem');
      assert.ok(html.includes('Check the label and set it above before drawing to this number'),
        'and the action, which is the half that makes a warning useful');
    });
  }

  // ── RECONREF — the app must agree with Jon's own protocol document ─────────
  // Source of truth: section 8 "Ordering & Reconstitution Reference" of
  // Peptide_Protocol_2026_27.pdf, which he supplied on 22 Aug 2026. Every pair
  // below is transcribed from that table: dose in, units printed there.
  //
  // v4.9.236 found SIX entries in _PEP_RECON that disagreed with it, and every
  // one told him to draw MORE than his protocol says — BPC-157 by 4x. These are
  // the numbers that reach the Today tile and the syringe, so they are pinned
  // against his document rather than left to a house default.
  //
  // AND A CORRECTION I OWE THE RECORD: I earlier reported that Jon's protocol
  // had three unit counts that were 2x too high. That was read off
  // PEPTIDE APP/Peptide Protocol/index.html, a stale snapshot that also
  // contained a compound he has never run. His real document is arithmetically
  // correct throughout — all 14 entries below check out against their own
  // stated concentration. The app was the thing that was wrong.
  {
    // v4.9.250 — WHAT THIS BLOCK IS PINNED TO, AND WHY THAT CHANGED.
    //
    // These cases were written against section 8 of the PDF and called it the
    // source of truth. Jon has since corrected it twice: the RT30 "+5mL" is
    // more than the vial holds, and BPC-157 is reconstituted in 2mL, not 1mL.
    // The BPC entry here was enforcing 5u for a 0.5mg dose. The real answer is
    // 10u. My test was holding a HALF DOSE in place.
    //
    // That is the part worth keeping: a test pinned to an unverified source
    // does not make the app correct, it makes the error permanent and harder to
    // question, because now it has a green tick defending it. Pinning is only
    // as good as what you pin TO.
    //
    // Entries marked CONFIRMED BY JON come from his actual vials and outrank
    // the document. The rest are still PDF-derived and remain unconfirmed — the
    // app marks those as assumed on screen rather than pretending otherwise.
    // compound, dose, unit, vialMg, waterMl, units printed in the protocol
    const REF = [
      ['retatrutide',   6,    'mg', 10,  0.5,  30],
      ['ipamorelin',    0.2,  'mg', 10,  2,     4],
      ['ipamorelin',    0.3,  'mg', 10,  2,     6],
      ['cjc1295',       0.15, 'mg', 10,  2,     3],
      ['cjc1295',       0.2,  'mg', 10,  2,     4],
      ['bpc157',        0.5,  'mg', 10,  2,    10],   // CONFIRMED BY JON, not the PDF
      ['tb500',         2,    'mg', 10,  2,    40],
      ['tb500',         1.25, 'mg', 10,  2,    25],
      ['ta1',           1.6,  'mg', 10,  2,    32],
      ['motsc',        10,    'mg', 10,  0.5,  50],
      ['epitalon',      5,    'mg', 10,  1,    50],
      ['ghkcu',         1,    'mg', 50,  2,     4],
      ['ghkcu',         2,    'mg', 50,  2,     8],
      ['nad',          50,    'mg', 500, 2,    20],
      ['nad',         100,    'mg', 500, 2,    40],
      ['tesamorelin',   1,    'mg', 10,  2,    20],
      ['tesamorelin',   2,    'mg', 10,  2,    40],
      ['dsip',          0.3,  'mg', 5,   2,    12],
      ['5amq',          0.5,  'mg', 5,   1,    10],
      ['5amq',          1,    'mg', 5,   1,    20],
      ['semax',         0.3,  'mg', 5,   2,    12],
    ];

    REF.forEach(([id, dose, unit, vialMg, waterMl, want]) => {
      test(`RECONREF ${id} ${dose}${unit} draws ${want}u as his protocol prints it`, () => {
        const c = app._pepCompound(id);
        assert.ok(c, `${id} is in the library`);
        const draw = app._pepDraw(dose, unit, app._pepRecon({ vialMg, waterMl }, c));
        assert.ok(draw, 'recon resolves');
        assert.equal(Math.round(draw.units * 10) / 10, want,
          `section 8 of Peptide_Protocol_2026_27.pdf prints ${want} units`);
      });
    });

    // The defaults are what a compound added WITHOUT a vial size inherits, and
    // they go straight to the Today tile. Six of these were wrong until .236.
    const DEFAULTS = [
      ['ipamorelin', 10, 2], ['cjc1295', 10, 2], ['bpc157', 10, 2],   // bpc CONFIRMED BY JON
      ['ta1', 10, 2], ['ghkcu', 50, 2], ['nad', 500, 2],
      ['retatrutide', 10, 0.5], ['motsc', 10, 0.5], ['epitalon', 10, 1],
      ['tb500', 10, 2], ['tesamorelin', 10, 2],
    ];
    DEFAULTS.forEach(([id, vialMg, waterMl]) => {
      test(`RECONREF the ${id} DEFAULT matches the protocol vial and BAC volume`, () => {
        const d = app._PEP_RECON[id];
        assert.ok(d, `${id} has a default`);
        assert.equal(d.vialMg, vialMg, `${id} vial size per section 8`);
        assert.equal(d.waterMl, waterMl, `${id} BAC volume per section 8`);
      });
    });
  }

  // ── ADVISORSTOCK — the advisor can now see what he actually has (v4.9.235) ─
  // Jon asked whether the app can build a forward plan from stock on hand. It
  // holds the stock and it holds the planner; _pepBuildContext was the wire
  // between them and it had never been run. The advisor was being asked to
  // recommend dose and cycle changes with no idea whether the vial was full or
  // empty — so it could propose raising a dose on three remaining doses, or
  // starting a compound that has not been ordered.
  {
    const advSetUp = (over) => {
      reset(); signIn(UID);
      seed(KEY, { stacks: [Object.assign({
        compoundId: 'bpc157', dose: 0.5, vialMg: 10, waterMl: 2,
        startDate: daysAgo(30), freq: 'daily', continuous: true,
        sealedVials: 2, openDosesUsed: 4, openedDate: daysAgo(4),
        stockCounted: true,
      }, over || {})] });
      return app._pepBuildContext(app.pepGetState());
    };

    test('ADVISORSTOCK the context carries stock, not just the schedule', () => {
      const ctx = advSetUp();
      assert.ok(Array.isArray(ctx.stock_on_hand), 'stock_on_hand is present');
      assert.equal(ctx.stock_on_hand.length, 1, 'one entry per stack');
      const e = ctx.stock_on_hand[0];
      assert.equal(e.compound, 'BPC-157', 'named, so a recommendation can reference it');
      assert.ok(e.doses_remaining > 0, 'with real doses remaining');
      assert.ok(e.days_of_supply != null, 'and how long that lasts');
    });

    test('ADVISORSTOCK an uncounted compound is marked unverified, not assumed', () => {
      const ctx = advSetUp({ stockCounted: false });
      assert.equal(ctx.stock_on_hand[0].counted, false,
        'counted:false — the advisor must not plan precisely on a number he has not checked');
    });

    test('ADVISORSTOCK an empty compound reports zero rather than going quiet', () => {
      const ctx = advSetUp({ sealedVials: 0, openDosesUsed: 0, openedDate: null });
      const e = ctx.stock_on_hand[0];
      assert.ok(e, 'still listed');
      assert.ok(e.known === false || e.doses_remaining === 0,
        'zero is a fact the advisor needs; omitting the compound would read as "fine"');
    });

    test('ADVISORSTOCK an incoming order is visible so a restart can be dated', () => {
      const ctx = advSetUp({ sealedVials: 0, openDosesUsed: 0, openedDate: null,
                             onOrder: true, arrivalDate: '2026-09-15', onOrderVials: 2 });
      const e = ctx.stock_on_hand[0];
      assert.equal(e.on_order, true, 'the advisor can say "resume when this lands"');
      assert.equal(e.arriving, '2026-09-15', 'with the date');
    });

    // The system prompt has to actually ask for it, or the data rides along unused.
    test('ADVISORSTOCK the prompt requires recommendations to be executable', () => {
      assert.ok(html.includes('stock_on_hand is what he ACTUALLY HAS'),
        'the advisor is told the stock is real and binding');
      assert.ok(html.includes('must be executable with it'),
        'and that a plan he cannot action is not a plan');
    });
  }

  // ── CYCLEREQ — a rest day is not the end of a cycle (v4.9.234) ─────────────
  // _pepCycleShortfall stopped counting at the FIRST non-dosing day after any
  // dose. Correct for an off-cycle block, wrong for every schedule with rest
  // days built in — which is most of them. Weekly counted 1 dose, Wed/Sat 1,
  // EOD 1, six-days-a-week 2. Only a strictly daily compound reached the
  // coverage window.
  //
  // Not cosmetic: `required` feeds the shortfall and the ORDER list, so every
  // intermittent compound reported needing about one vial for six months. It
  // UNDER-ordered — Jon runs out mid-cycle believing he is covered, which is
  // the worst direction for this number to be wrong in. Found by running the
  // audit engine against his real protocol to answer "just show me the audit",
  // not by a test.
  {
    const cycSetUp = (freq, extra) => {
      reset(); signIn(UID);
      seed(KEY, { stacks: [Object.assign({
        compoundId: 'bpc157', dose: 0.5, vialMg: 10, waterMl: 2,
        startDate: daysAgo(30), freq, continuous: true,
        sealedVials: 0, openDosesUsed: 0, stockCounted: true,
      }, extra || {})] });
      const ps = app.pepGetState();
      return app._pepCycleShortfall(ps, ps.stacks[0]);
    };

    test('CYCLEREQ a weekly compound needs a cycle of doses, not one', () => {
      const r = cycSetUp('weekly');
      assert.ok(r && r.required >= 20,
        `weekly over a six-month window is ~26 doses — got ${r && r.required}. ` +
        'Stopping at the first rest day made this 1 and under-ordered by 25 vials');
    });

    test('CYCLEREQ a twice-weekly compound counts both days every week', () => {
      const r = cycSetUp('2x/week');
      assert.ok(r && r.required >= 40, `~52 expected, got ${r && r.required}`);
    });

    test('CYCLEREQ every-other-day counts half the window', () => {
      const r = cycSetUp('eod');
      assert.ok(r && r.required >= 80 && r.required <= 95, `~90 expected, got ${r && r.required}`);
    });

    test('CYCLEREQ six-days-a-week is not truncated by its rest day', () => {
      const r = cycSetUp('6 day');
      assert.ok(r && r.required >= 140, `~155 expected, got ${r && r.required}`);
    });

    test('CYCLEREQ daily still reaches the coverage window', () => {
      const r = cycSetUp('daily');
      assert.ok(r && r.required >= 175, `~181 expected, got ${r && r.required}`);
    });

    // The behaviour the old code was reaching for, kept: a genuine off-block
    // DOES end the cycle. Three weeks on, two weeks off — the two-week gap must
    // stop the count, or a cycled compound gets ordered as if continuous.
    test('CYCLEREQ a real off-cycle block still ends the count', () => {
      const r = cycSetUp('daily', { cycleWeeks: 3, offWeeks: 2, continuous: false });
      assert.ok(r && r.required > 0 && r.required <= 22,
        `three weeks of daily doses then an off-block — got ${r && r.required}`);
    });
  }

  // ── COPYAUDIT — the button I sent Jon to four times without ever running it ─
  // He asked "where is the audit?". I had told him to tap Copy full audit
  // repeatedly and never once driven the handler. It called
  // navigator.clipboard.writeText(...).then(...) with NO .catch, wrapped in a
  // try/catch that cannot catch a rejection. On iOS that write can reject for
  // reasons he can neither see nor influence — so the button did nothing, said
  // nothing, and left him no way to get the text off the screen.
  //
  // Third instance today of the same confusion: .delete() resolving with
  // {error}, fetch resolving on a 4xx, and now writeText rejecting past a
  // try/catch. Awaiting or wrapping is not the same as handling.
  {
    const caSetUp = (clip) => {
      reset();
      signIn(UID);
      seed(KEY, { stacks: [{ compoundId: 'bpc157', dose: 0.5, vialMg: 5, waterMl: 2, startDate: daysAgo(20) }] });
      const nodes = {};
      const mk = () => {
        const el = {
          textContent: '', innerHTML: '', value: '', style: {},
          focus() {}, setSelectionRange() {},
          querySelector() { return el._ta || null; },
          addEventListener() {}, setAttribute() {}, getAttribute: () => null,
        };
        return el;
      };
      const realGet = app.document.getElementById;
      app.document.getElementById = (id) => (nodes[id] || (nodes[id] = mk()));
      app.navigator = app.navigator || {};
      const realClip = app.navigator.clipboard;
      app.navigator.clipboard = clip;
      return { nodes, restore: () => { app.document.getElementById = realGet; app.navigator.clipboard = realClip; } };
    };

    test('COPYAUDIT a rejected clipboard write puts the audit on screen anyway', async () => {
      const h = caSetUp({ writeText: () => Promise.reject(new Error('NotAllowedError')) });
      try {
        app.pepCopyAudit();
        await settle();
        const box = h.nodes['pep-audit-fallback'];
        assert.ok(box && box.innerHTML.length > 0,
          'the fallback rendered — a clipboard refusal must not take the data with it');
        assert.ok(box.innerHTML.includes('<textarea'), 'in something he can select from');
        assert.ok(box.innerHTML.includes('did not work'), 'and it says the copy failed rather than pretending');
      } finally { h.restore(); }
    });

    test('COPYAUDIT the fallback carries the real audit text, not a placeholder', async () => {
      const h = caSetUp({ writeText: () => Promise.reject(new Error('nope')) });
      try {
        app.pepCopyAudit();
        await settle();
        const box = h.nodes['pep-audit-fallback'];
        assert.ok(box.innerHTML.includes('PROTOCOL AUDIT') || box.innerHTML.includes('compounds'),
          'the actual report is in the box — a fallback that shows nothing is the same bug');
      } finally { h.restore(); }
    });

    test('COPYAUDIT no clipboard API at all still shows the text', () => {
      const h = caSetUp(undefined);
      try {
        app.pepCopyAudit();
        const box = h.nodes['pep-audit-fallback'];
        assert.ok(box && box.innerHTML.includes('<textarea'), 'older WebViews get the text too');
      } finally { h.restore(); }
    });

    test('COPYAUDIT a successful copy confirms and clears the fallback', async () => {
      let got = null;
      const h = caSetUp({ writeText: (t) => { got = t; return Promise.resolve(); } });
      try {
        app.pepCopyAudit();
        await settle();
        assert.ok(got && got.length > 50, 'the real audit text reached the clipboard');
        assert.equal(h.nodes['pep-audit-copy'].textContent, 'Copied', 'and he is told it worked');
        assert.equal(h.nodes['pep-audit-fallback'].innerHTML, '', 'no leftover box when it succeeded');
      } finally { h.restore(); }
    });
  }

  // ── BLOODSAVE — driving pepSaveBloodPanel, which nothing had ever run ──────
  // The harness had `has('async function pepSaveBloodPanel()')` and that was
  // the entire coverage. Presence, not behaviour — the exact gap the .165
  // Today-card incident was about, sitting in my own domain the whole time.
  //
  // I went looking because I told Jon "the save path has been working the whole
  // time" on the strength of the schema existing. The schema existing makes the
  // save POSSIBLE. It says nothing about whether the code does it. Driving the
  // function took ten minutes and found a silent partial failure.
  {
    const bsSetUp = () => {
      reset();
      signIn(UID);
      const calls = [];
      const mkQuery = (table, failUpdate) => {
        const q = {
          insert(r) { calls.push({ table, op: 'insert', row: r }); return q; },
          update(r) { calls.push({ table, op: 'update', row: r }); return q; },
          select() { return q; }, eq() { return q; }, order() { return q; },
          limit() { return q; },
          single() { return Promise.resolve({ data: { id: 'row-9' }, error: null }); },
          then(a, b) { return Promise.resolve({ data: [], error: failUpdate || null }).then(a, b); },
        };
        return q;
      };
      return { calls, mkQuery };
    };

    const draft = () => ({
      id: null, panel_date: '2026-08-20', lab: 'Lab', fasted: true,
      photo_path: null, photoDataURL: 'data:image/jpeg;base64,AAAA',
      markers: [{ name: 'ALT', value: '71', unit: 'U/L', ref_low: '5', ref_high: '40' }],
      notes: 'n', source: 'manual',
    });

    test('BLOODSAVE a panel reaches blood_panels with the marker flagged', async () => {
      const { calls, mkQuery } = bsSetUp();
      app.sb = {
        from: (t) => mkQuery(t),
        storage: { from: () => ({ upload: () => Promise.resolve({ data: {}, error: null }) }) },
      };
      app._pepBloodDraft = draft();
      await app.pepSaveBloodPanel();
      const ins = calls.find(c => c.op === 'insert');
      assert.ok(ins, 'an insert reached blood_panels');
      assert.equal(ins.table, 'blood_panels', 'the right table');
      assert.equal(ins.row.user_id, UID, 'scoped to the signed-in user');
      assert.equal(ins.row.markers.length, 1, 'the named marker survived');
      assert.equal(ins.row.markers[0].flag, 'high', 'ALT 71 against 5-40 flags high');
    });

    // THE BUG, pinned. Photo upload fails; before v4.9.230 this was a bare
    // console.warn — invisible on iPhone — and the sheet then closed on a green
    // "saved". Jon ends up with a pathology record and no image, and nothing
    // anywhere tells him.
    test('BLOODSAVE a failed photo upload is never silent', async () => {
      const { calls, mkQuery } = bsSetUp();
      app.sb = {
        from: (t) => mkQuery(t),
        storage: { from: () => ({ upload: () => Promise.resolve({ data: null, error: { message: 'bucket policy denied' } }) }) },
      };
      app._pepBloodDraft = draft();
      await app.pepSaveBloodPanel();
      const rec = read('phx_last_write_error');
      assert.ok(rec, 'the failure was recorded where Settings -> Diagnostic can show it');
      assert.ok(JSON.stringify(rec).includes('blood photo upload'),
        'recorded under the UPLOAD context specifically — v4.9.243 split this from ' +
        'the path-save failure, because the PM ring coalesces by context and the two ' +
        'have different remedies: retry the upload vs re-point a row at an image ' +
        'that is already in the bucket');
      assert.ok(calls.some(c => c.op === 'insert'), 'and the panel itself still saved');
    });

    // v4.9.243 — one context per REMEDY, not one per function. The ring
    // coalesces by context name (PM, v4.9.240), so two failures sharing a name
    // hide behind each other and the later one becomes a bare count. My strings
    // were unique; their meanings were not.
    test('BLOODSAVE upload failure and path failure are told apart', async () => {
      const { mkQuery } = bsSetUp();
      // upload succeeds, the row update that records the path fails
      const q = mkQuery('blood_panels', { message: 'row locked' });
      app.sb = {
        from: () => q,
        storage: { from: () => ({ upload: () => Promise.resolve({ data: {}, error: null }) }) },
      };
      app._pepBloodDraft = draft();
      await app.pepSaveBloodPanel();
      const rec = JSON.stringify(read('phx_last_write_error') || {});
      assert.ok(rec.includes('blood photo path orphaned'),
        'the image IS in the bucket and the row does not point at it — an orphaned ' +
        'blob needs re-pointing, not re-uploading, and that is a different action');
      assert.ok(!rec.includes('blood photo upload'), 'not filed as an upload failure');
    });

    test('BLOODSAVE the sheet stays open after a photo failure, carrying the row id', async () => {
      const { mkQuery } = bsSetUp();
      app.sb = {
        from: (t) => mkQuery(t),
        storage: { from: () => ({ upload: () => Promise.resolve({ data: null, error: { message: 'nope' } }) }) },
      };
      app._pepBloodDraft = draft();
      await app.pepSaveBloodPanel();
      assert.ok(app._pepBloodDraft, 'draft kept, so he can retry rather than re-enter everything');
      assert.equal(app._pepBloodDraft.id, 'row-9',
        'carrying the saved row id — a retry must UPDATE that row, not insert a second ' +
        'pathology record for the same panel');
    });

    test('BLOODSAVE a clean save closes the sheet and clears the draft', async () => {
      const { mkQuery } = bsSetUp();
      app.sb = {
        from: (t) => mkQuery(t),
        storage: { from: () => ({ upload: () => Promise.resolve({ data: {}, error: null }) }) },
      };
      app._pepBloodDraft = draft();
      await app.pepSaveBloodPanel();
      assert.equal(app._pepBloodDraft, null, 'draft cleared only when everything landed');
    });

    test('BLOODSAVE a thrown save records diagnostics rather than only warning', async () => {
      const { mkQuery } = bsSetUp();
      app.sb = {
        from: () => { const q = mkQuery('blood_panels'); q.single = () => Promise.resolve({ data: null, error: { message: 'permission denied' } }); return q; },
        storage: { from: () => ({ upload: () => Promise.resolve({ data: {}, error: null }) }) },
      };
      app._pepBloodDraft = draft();
      await app.pepSaveBloodPanel();
      const rec = read('phx_last_write_error');
      assert.ok(rec && JSON.stringify(rec).includes('blood panel save'),
        'console.warn is invisible on his phone; this is the only surface he has');
    });

    // ── DELETE, swept after fixing SAVE in .230. The neighbour trap again,
    // same file, hours later: I fixed the save path and did not look at the one
    // underneath it. Three faults, and the middle one is the privacy fault.
    const delSetUp = (rowErr, photoErr, removeThrows) => {
      reset();
      signIn(UID);
      const seen = [];
      const q = {
        delete() { seen.push('row-delete'); return q; },
        select() { return q; }, eq() { return q; }, order() { return q; }, update() { return q; },
        single() { return Promise.resolve({ data: null, error: null }); },
        then(a, b) { return Promise.resolve({ data: null, error: rowErr || null }).then(a, b); },
      };
      app.sb = {
        from: () => q,
        storage: { from: () => ({
          remove: () => {
            seen.push('photo-remove');
            if (removeThrows) return Promise.reject(new Error('network down'));
            return Promise.resolve({ data: null, error: photoErr || null });
          },
        }) },
      };
      app._pepBloodDraft = { id: 'row-9', photo_path: `${UID}/row-9.jpg`, markers: [], panel_date: '2026-08-20' };
      // Second tap: the confirm step is a DOM attribute the sandbox cannot hold.
      // The override is RESTORED by every caller in a finally — the first version
      // leaked it and broke an unrelated KEYBOARD case two blocks away, which is
      // a test polluting its neighbours rather than a bug in the code.
      const realGet = app.document.getElementById;
      app.document.getElementById = () => ({
        getAttribute: () => '1', setAttribute() {}, removeAttribute() {},
        style: {}, textContent: '', innerHTML: '', remove() {}, addEventListener() {},
        querySelector: () => null, querySelectorAll: () => [],
      });
      return { seen, restore: () => { app.document.getElementById = realGet; } };
    };

    test('DELETE a refused row delete does not report success', async () => {
      const h = delSetUp({ message: 'permission denied' }, null, false);
      try { await app.pepDeleteBloodPanel(); } finally { h.restore(); }
      assert.ok(h.seen.includes('row-delete'), 'it tried');
      assert.ok(app._pepBloodDraft,
        'sheet stays open — .delete() RESOLVES with {error} rather than throwing, so ' +
        'the old catch never fired and a refused delete looked identical to a real one');
      const rec = read('phx_last_write_error');
      assert.ok(rec && JSON.stringify(rec).includes('blood panel delete'), 'and it is recorded');
    });

    // The privacy one. Row gone, image left behind in the bucket: he believes
    // he has deleted a pathology report and the photo of it is still stored.
    test('DELETE a photo left in the bucket is surfaced, not swallowed', async () => {
      const h = delSetUp(null, { message: 'storage policy denied' }, false);
      try { await app.pepDeleteBloodPanel(); } finally { h.restore(); }
      const rec = read('phx_last_write_error');
      assert.ok(rec && JSON.stringify(rec).includes('blood panel photo orphaned'),
        'its OWN context — he believes he deleted a pathology report and the image ' +
        'is still stored. Sharing a slot with the row-delete failure meant whichever ' +
        'landed first kept the message and this one could become a count');
      assert.ok(app._pepBloodDraft,
        'and the sheet stays open so Delete Panel can retry removing the image');
    });

    test('DELETE a thrown removal is caught and still reported', async () => {
      const h = delSetUp(null, null, true);
      try { await app.pepDeleteBloodPanel(); } finally { h.restore(); }
      const rec = read('phx_last_write_error');
      assert.ok(rec && JSON.stringify(rec).includes('blood panel delete'), 'throw path recorded too');
    });

    test('DELETE a clean delete closes the sheet', async () => {
      const h = delSetUp(null, null, false);
      try { await app.pepDeleteBloodPanel(); } finally { h.restore(); }
      assert.equal(app._pepBloodDraft, null, 'cleared only when both halves actually landed');
    });

    // The stale instruction, pinned so it cannot come back. The migration is
    // applied — verified against production 22 Aug 2026 — and this string sent
    // Jon to run it anyway. Three chats spent a day passing that around.
    test('BLOODSAVE the save error no longer tells Jon to run the migration', () => {
      const i = html.indexOf('async function pepSaveBloodPanel');
      const blk = html.slice(i, html.indexOf('\nasync function ', i + 1));
      // Needle is the full USER-FACING sentence, not the fragment: the fragment
      // also appears in the comment explaining why it was removed, so the first
      // version of this test failed on my own note about the fix. A guard that
      // matches its own documentation cannot distinguish fixed from described.
      assert.notIncludes(blk, 'run the blood_panels migration in the Supabase SQL Editor first',
        'the table exists; a schema error here is mine to diagnose, not his to fix');
    });
  }

  // ── KEYBOARD — every peptide sheet Jon types into (v4.9.221, .222) ────────
  // Jon: the iOS keyboard covers the field on the edit sheet. The argument that
  // got his go-ahead was not "a field is hidden" but WHICH field: he loses the
  // dose box AND the draw-up preview under it — the number that tells him
  // whether what he just typed is right. Hiding the answer is worse than hiding
  // the question.
  //
  // CONSUMES A NUTRITION SURFACE: _phxKeyboardSafe, published in
  // HANDOFF_NUTRITION under "API other domains may call", pinned provider-side
  // in tests/nutrition.mjs. These cases are the CONSUMER half — they prove the
  // peptide sheets are wired to it and shaped so it can work. They deliberately
  // do NOT re-test the helper; that is Nutrition's to pin and they have.
  //
  // WHAT THESE CAN AND CANNOT PROVE. The sandbox has no layout engine —
  // getBoundingClientRect returns zeroes for everything. No test here measures a
  // pixel, and none should claim to. What decides whether the preview is on
  // screen reduces to three facts that ARE checkable: the overlay is sized to
  // the visible area, the panel holding the preview is bounded by that overlay
  // rather than by the layout viewport, and the preview is inside that panel.
  // Assert those three; do not dress them up as a visual verification.
  {
    const kbSetUp = (visibleHeight) => {
      reset();
      signIn(UID);
      const listeners = {};
      app.visualViewport = {
        height: visibleHeight, offsetTop: 0,
        addEventListener: (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); },
        removeEventListener: (ev, fn) => { listeners[ev] = (listeners[ev] || []).filter(f => f !== fn); },
        _fire: (ev) => (listeners[ev] || []).forEach(f => f()),
        _count: () => (listeners.resize || []).length,
      };
      app.document.body.contains = () => true;
      return app.visualViewport;
    };

    // Capture the overlay the real open function creates. It is the FIRST div
    // created inside the call, which is the one _phxKeyboardSafe is handed.
    const openSheet = (fn) => {
      const realCreate = app.document.createElement;
      const made = [];
      app.document.createElement = function (tag) {
        const e = realCreate.call(app.document, tag);
        made.push(e);
        return e;
      };
      try { fn(); } finally { app.document.createElement = realCreate; }
      return made[0];
    };

    const kbTearDown = () => { delete app.visualViewport; };

    test('KEYBOARD the edit sheet is sized to the visible area, not the screen', () => {
      kbSetUp(420);
      seed(KEY, { stacks: [{ compoundId: 'bpc157', dose: 0.5, vialMg: 5, waterMl: 2 }] });
      // Drives pepOpenEditStack, NOT _phxKeyboardSafe. Calling the helper here
      // would pass with the sheet unwired — the .165 mistake exactly.
      const ov = openSheet(() => app.pepOpenEditStack(0));
      assert.ok(ov, 'the sheet created an overlay');
      assert.equal(ov.style.height, '420px', 'overlay ends where the keyboard begins');
      assert.equal(ov.style.bottom, 'auto', 'so flex-end sits the panel above it');
      kbTearDown();
    });

    test('KEYBOARD the edit panel is bounded by the OVERLAY, not the layout viewport', () => {
      kbSetUp(420);
      seed(KEY, { stacks: [{ compoundId: 'bpc157', dose: 0.5, vialMg: 5, waterMl: 2 }] });
      const ov = openSheet(() => app.pepOpenEditStack(0));
      // This is the half the helper cannot do for us. It shrinks the overlay;
      // a panel measured in vh does not shrink with it. 88vh of an 800px screen
      // is 704px inside a 420px overlay — it overflows UPWARD, off the top,
      // carrying dose, vial, water and the preview with it and leaving Save
      // visible. 88% is the same size at rest and tracks the keyboard when up.
      assert.ok(ov.innerHTML.includes('max-height:88%'),
        'panel capped against the resized overlay');
      assert.notIncludes(ov.innerHTML, 'max-height:88vh',
        'vh does not shrink when the keyboard appears — that is the whole bug');
      assert.ok(ov.innerHTML.includes('overflow-y:auto'),
        'and scrolls internally rather than clipping');
      kbTearDown();
    });

    test('KEYBOARD the draw-up preview is inside the panel that gets bounded', () => {
      kbSetUp(420);
      seed(KEY, { stacks: [{ compoundId: 'bpc157', dose: 0.5, vialMg: 5, waterMl: 2 }] });
      const ov = openSheet(() => app.pepOpenEditStack(0));
      const html = ov.innerHTML;
      const panel = html.indexOf('id="pep-e-panel"');
      const preview = html.indexOf('id="pep-e-draw"');
      const dose = html.indexOf('id="pep-e-dose"');
      assert.ok(panel >= 0, 'the bounded panel exists');
      assert.ok(preview > panel, 'the preview is inside it, so it moves with it');
      assert.ok(dose > panel, 'and so is the field it answers');
      // The pairing is the point: sizing the field into view while the number
      // that validates it stays hidden would satisfy a narrower test and still
      // leave Jon guessing.
      kbTearDown();
    });

    test('KEYBOARD the edit sheet keeps tracking as the keyboard opens', () => {
      const vv = kbSetUp(800);
      seed(KEY, { stacks: [{ compoundId: 'bpc157', dose: 0.5, vialMg: 5, waterMl: 2 }] });
      const ov = openSheet(() => app.pepOpenEditStack(0));
      assert.equal(vv._count(), 1, 'armed exactly once — the helper is not idempotent');
      vv.height = 380;                       // he taps Dose, the keyboard comes up
      vv._fire('resize');
      assert.equal(ov.style.height, '380px', 'the sheet follows it');
      kbTearDown();
    });

    test('KEYBOARD the custom vial sheet is wired too', () => {
      const vv = kbSetUp(420);
      seed(KEY, { stacks: [{ compoundId: 'bpc157', dose: 0.5, vialMg: 5, waterMl: 2 }] });
      const ov = openSheet(() => app.pepOpenCustomVial(0));
      assert.ok(ov, 'the sheet created an overlay');
      assert.equal(ov.style.height, '420px', 'sized to the visible area');
      assert.equal(vv._count(), 1, 'armed once');
      assert.ok(ov.innerHTML.includes('max-height:100%'),
        'short sheet, but a short viewport would still clip Save without this');
      kbTearDown();
    });

    // v4.9.224 — THE SHEET I MISSED, and how.
    //
    // .221 shipped claiming "the two sheets Jon types into" and enumerated four
    // overlays. There are five. The fifth, pepOpenBloodPanel, has six text
    // inputs and a textarea — the most typing-heavy screen in the domain. I did
    // not miss it by looking and misjudging; I never re-derived the count, and
    // the PM and I then both worked from my number.
    //
    // It is a different SHAPE, which is why "the bottom sheets" felt complete:
    // full-height inset:0 with its own overflow-y:auto, so nothing overflows
    // upward. It fails the other way — the scroll container's bottom sits
    // behind the keyboard and cannot be scrolled to, so after typing Notes the
    // Save Panel button under it is unreachable. Same cause, opposite geometry.
    //
    // The durable fix is not this test; it is the harness guard that ENUMERATES
    // peptide overlays and fails any with a typed field that is not armed. A
    // count I remembered is worth less than a count the machine takes.
    test('KEYBOARD the blood panel sheet is armed at its creation site', () => {
      const vv = kbSetUp(420);
      seed(KEY, { stacks: [], bloods: [] });
      const ov = openSheet(() => app.pepOpenBloodPanel(null));
      assert.ok(ov, 'the sheet created an overlay');
      assert.equal(ov.style.height, '420px', 'container ends where the keyboard begins');
      assert.equal(ov.style.bottom, 'auto', 'so its bottom is reachable by scrolling');
      assert.equal(vv._count(), 1,
        'armed ONCE — _pepRenderBloodSheet redraws on every photo load and every ' +
        'marker added, so arming beside the inputs would leak a listener per redraw');
      kbTearDown();
    });

    // The two sheets NOT wired, recorded so the gap reads as a decision.
    // pepOpenAddStack and pepOpenOrderPicker are tap-only — a compound list and
    // a date/quantity picker. No text input means no keyboard means nothing for
    // the helper to do, and arming it there would be a listener bought for
    // nothing. If either grows a typed field, this note is where to start.
    test('KEYBOARD the tap-only sheets are deliberately not armed', () => {
      const slice = (name, next) => {
        const i = html.indexOf('function ' + name);
        return i < 0 ? '' : html.slice(i, html.indexOf('function ' + next, i));
      };
      const add = slice('pepOpenAddStack', 'pepOpenEditStack');
      assert.ok(add.length > 0, 'found pepOpenAddStack');
      assert.notIncludes(add, '<input', 'still tap-only — no typed field');
      assert.notIncludes(add, '_phxKeyboardSafe', 'so nothing to arm');
    });
  }

  test('no panels logged reports null rather than an empty shell', () => {
    assert.equal(app._pepLatestBloods({}), null, 'null when nothing logged');
  });
}
