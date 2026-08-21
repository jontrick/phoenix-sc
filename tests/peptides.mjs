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

export default function ({ test, assert, app, signIn, seed, read, reset }) {

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

    test('a library default reconstitution is enough to forecast', () => {
      assert.equal(f({ compoundId:'bpc157', dose:0.5, startDate: sAgo(30), sealedVials:3 }).dosesPerVial, 10, 'falls back to _PEP_RECON');
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

  test('no panels logged reports null rather than an empty shell', () => {
    assert.equal(app._pepLatestBloods({}), null, 'null when nothing logged');
  });
}
