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
const OLDER = '2026-08-01T00:00:00.000Z';
const NEWER = '2026-08-17T00:00:00.000Z';

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
