// BLAB TRAINING — functional tests. Run: node functional_check.mjs training
//
// These call the real functions in index.html. Every case corresponds to a rule
// Jon set or a bug that actually shipped:
//   · restore resolution  — the common 7-row table (Peptides/Nutrition/Training)
//   · progress guard      — Jon's ruling, 18 Aug 2026: "progress wins" for BLAB
//   · inactive-stub rule  — preserves v4.9.100; a dead local stub must not shadow
//                           a real cloud programme
//   · calendar carry      — the training calendar rides inside blab_state.calendar
//
// Note the sandbox never supplies the key under test: we signIn(UID) and let
// blabRestoreFromCloud derive blab_v1_<uid> itself. Nutrition shipped a
// fresh-install bug precisely because its stub handed the key over.

const UID = 'test-user';
const KEY = `blab_v1_${UID}`;
const OLDER = '2026-08-01T00:00:00.000Z';
const NEWER = '2026-08-17T00:00:00.000Z';

// W5 D2 — score (5*4)+2 = 22. The "real" training position in most cases below.
const AHEAD = { active: true, week: 5, last_completed_day: 2, maxes: { bench: 130, squat: 150, deadlift: 170 } };
// W2 D1 — score (2*4)+1 = 9. A device that is behind.
const BEHIND = { active: true, week: 2, last_completed_day: 1, maxes: { bench: 130, squat: 150, deadlift: 170 } };

export default function ({ test, assert, app, signIn, seed, read, reset }) {

  // restore() deliberately seeds ONLY the local raw value and the cloud row, then
  // lets the app derive the storage key from the signed-in user.
  const restore = (localValue, cloudState) => {
    reset();
    signIn(UID);
    if (localValue !== null) seed(KEY, localValue);
    const changed = app.blabRestoreFromCloud({ blab_state: cloudState });
    return { changed, state: read(KEY), backup: read(`${KEY}_bak`) };
  };

  // ── The common resolution table, all seven rows ────────────────────────────

  test('row 1 — a fresh install pulls the programme down (the lost-phone case)', () => {
    const r = restore(null, { ...AHEAD, _ts: OLDER });
    assert.equal(r.state.week, 5, 'cloud programme restored');
    assert.equal(r.changed, true, 'restore reports it replaced local');
  });

  test('row 2 — unreadable local state is replaced by the cloud copy', () => {
    const r = restore('{ not json', { ...AHEAD, _ts: OLDER });
    assert.equal(r.state.week, 5, 'cloud applied over corrupt local');
    assert.equal(r.changed, true, 'restore reported');
  });

  test('row 3 — a newer cloud copy wins when it is not behind', () => {
    const r = restore({ ...BEHIND, _ts: OLDER }, { ...AHEAD, _ts: NEWER });
    assert.equal(r.state.week, 5, 'cloud copy applied');
    assert.equal(r.changed, true, 'restore reported');
  });

  test('row 4 — an older cloud copy never clobbers newer local state', () => {
    const r = restore({ ...AHEAD, _ts: NEWER }, { ...BEHIND, _ts: OLDER });
    assert.equal(r.state.week, 5, 'local survived');
    assert.equal(r.changed, false, 'no restore reported');
  });

  test('row 4 — equal timestamps keep local, so two devices cannot ping-pong', () => {
    const r = restore({ ...AHEAD, _ts: NEWER }, { ...AHEAD, week: 9, _ts: NEWER });
    assert.equal(r.state.week, 5, 'local kept on a tie');
    assert.equal(r.changed, false, 'no restore reported');
  });

  test('row 5 — a stamped cloud copy beats unstamped legacy local state', () => {
    const r = restore({ ...BEHIND }, { ...AHEAD, _ts: NEWER });
    assert.equal(r.state.week, 5, 'cloud applied over legacy local');
  });

  test('row 6 — stamped local beats an unstamped legacy cloud copy', () => {
    const r = restore({ ...AHEAD, _ts: OLDER }, { ...BEHIND });
    assert.equal(r.state.week, 5, 'local kept');
    assert.equal(r.changed, false, 'no restore reported');
  });

  test('row 7 — with neither side stamped, local is kept', () => {
    const r = restore({ ...AHEAD }, { ...BEHIND });
    assert.equal(r.state.week, 5, 'local kept');
    assert.equal(r.changed, false, 'no restore reported');
  });

  // ── Jon's progress guard — BLAB only ──────────────────────────────────────
  // "A newer timestamp can never move last_completed_day backwards."

  test('a stale second device cannot wipe a logged session even with a newer stamp', () => {
    // The scenario: Jon trains on his phone to W5 D2. An iPad holding W2 D1 opens
    // the app, its mirror fires, and it carries a NEWER timestamp. Under pure
    // newest-wins that would roll him back three weeks.
    const r = restore({ ...AHEAD, _ts: OLDER }, { ...BEHIND, _ts: NEWER });
    assert.equal(r.state.week, 5, 'training progress survived the newer stale copy');
    assert.equal(r.state.last_completed_day, 2, 'last_completed_day not rolled back');
    assert.equal(r.changed, false, 'blocked restore reports false, so no repaint');
  });

  test('the guard also covers row 5 — newer-but-behind cloud over unstamped local', () => {
    const r = restore({ ...AHEAD }, { ...BEHIND, _ts: NEWER });
    assert.equal(r.state.week, 5, 'unstamped local progress still protected');
    assert.equal(r.changed, false, 'no restore reported');
  });

  test('a blocked restore is recorded so it is visible in Diagnostic', () => {
    restore({ ...AHEAD, _ts: OLDER }, { ...BEHIND, _ts: NEWER });
    const last = read('phx_last_write_error');
    assert.ok(last, 'a write-error record was written');
    assert.equal(last.context, 'blabRestore.progressGuard', 'recorded under the guard context');
  });

  test('the guard blocks only strictly-behind cloud — equal progress still restores', () => {
    // Same position, newer stamp: nothing to lose, so it must NOT be blocked.
    const r = restore({ ...AHEAD, _ts: OLDER }, { ...AHEAD, chin_max: 14, _ts: NEWER });
    assert.equal(r.changed, true, 'equal progress restores normally');
    assert.equal(r.state.chin_max, 14, 'newer cloud content applied');
  });

  test('the guard can only decline to overwrite, never make cloud win a row it would lose', () => {
    // Cloud is AHEAD but OLDER — row 4 keeps local. The guard must not flip that.
    const r = restore({ ...BEHIND, _ts: NEWER }, { ...AHEAD, _ts: OLDER });
    assert.equal(r.state.week, 2, 'row 4 still keeps local even though cloud is further ahead');
    assert.equal(r.changed, false, 'no restore reported');
  });

  // ── v4.9.100 rule the generic table would otherwise drop ──────────────────

  test('an inactive local stub does not shadow a real cloud programme', () => {
    const r = restore({ active: false, week: 0, last_completed_day: 0, _ts: NEWER }, { ...AHEAD, _ts: OLDER });
    assert.equal(r.state.week, 5, 'cloud programme applied over the dead stub');
    assert.equal(r.changed, true, 'restore reported');
  });

  // ── Backup, calendar carry, and the no-op paths ───────────────────────────

  test('whatever gets replaced is kept as a backup, never silently dropped', () => {
    const r = restore({ ...BEHIND, _ts: OLDER }, { ...AHEAD, _ts: NEWER });
    assert.ok(r.backup, 'backup written');
    assert.equal(r.backup.week, 2, 'backup holds the replaced copy');
  });

  test('a blocked restore writes no backup, because nothing was replaced', () => {
    const r = restore({ ...AHEAD, _ts: OLDER }, { ...BEHIND, _ts: NEWER });
    assert.equal(r.backup, null, 'no backup written when nothing changed');
  });

  test('the training calendar rides along inside blab_state', () => {
    const cal = { sessions: [{ blabWeek: 5, blabDay: 3, scheduledDate: '2026-08-20', status: 'pending' }], customs: [] };
    const r = restore(null, { ...AHEAD, calendar: cal, _ts: NEWER });
    assert.equal(r.state.calendar.sessions.length, 1, 'calendar restored with the state');
    assert.equal(read(`blab_calendar_v1_${UID}`).sessions[0].blabDay, 3, 'calendar hydrated to its own key');
  });

  test('a cloud copy stored as a JSON string is still honoured', () => {
    // blab_state has been written as both an object and a string over its life.
    const r = restore(null, JSON.stringify({ ...AHEAD, _ts: NEWER }));
    assert.equal(r.state.week, 5, 'string-encoded cloud state parsed and applied');
  });

  test('a signed-out session restores nothing', () => {
    reset();
    signIn(null);
    const changed = app.blabRestoreFromCloud({ blab_state: { ...AHEAD, _ts: NEWER } });
    assert.equal(changed, false, 'no uid, no restore');
  });

  test('an absent cloud column restores nothing', () => {
    reset();
    signIn(UID);
    seed(KEY, AHEAD);
    assert.equal(app.blabRestoreFromCloud({}), false, 'no blab_state, no restore');
    assert.equal(read(KEY).week, 5, 'local untouched');
  });

  // ── Stamping happens on write, in the one function every mutation funnels through ──

  test('saving stamps _ts so the next device can compare', () => {
    reset();
    signIn(UID);
    app.blabSaveState({ active: true, week: 3, last_completed_day: 1 });
    const saved = read(KEY);
    assert.ok(saved._ts, 'state carries a stamp');
    assert.ok(!isNaN(Date.parse(saved._ts)), '_ts is a parseable ISO 8601 string');
  });

  test('the progress score is the forward-only BLAB position', () => {
    assert.equal(app.blabProgressScore({ week: 5, last_completed_day: 2 }), 22, 'W5 D2 scores 22');
    assert.equal(app.blabProgressScore({ week: 2, last_completed_day: 1 }), 9, 'W2 D1 scores 9');
    assert.ok(app.blabProgressScore({ week: 6, last_completed_day: 0 }) >
              app.blabProgressScore({ week: 5, last_completed_day: 4 }) - 1, 'week rollover does not go backwards');
  });
}
