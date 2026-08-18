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

  // ── Today card reads the calendar (v4.9.161) ──────────────────────────────
  // Jon device-tested the calendar and found Today still showed the next
  // sequential BLAB session. Three defects behind that: customs were ignored,
  // only the first match was returned, and an unscheduled day fell through to a
  // guess. These pin the readers the Today card is built on.

  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const dayFromToday = (n) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n); return iso(d); };

  const schedule = (cal) => {
    reset();
    signIn(UID);
    seed(KEY, { ...AHEAD, _ts: NEWER });
    seed(`blab_calendar_v1_${UID}`, cal);
  };
  const S = (w, d, date) => ({ blabWeek: w, blabDay: d, scheduledDate: date, status: 'pending' });
  const C = (label, date) => ({ id: 'c1', cat: 'WOD', libId: 'titan-kronos', label, scheduledDate: date, status: 'pending' });

  test("tomorrow's session does not surface as today's — the thing Jon asked to confirm", () => {
    schedule({ sessions: [S(5, 3, dayFromToday(1))], customs: [] });
    assert.equal(app.blabCalTodaySessions().length, 0, 'nothing scheduled for today');
    const next = app.blabCalNextDays(3);
    assert.equal(next.length, 1, 'it shows up in the coming-up row instead');
    assert.equal(next[0].label, 'Tomorrow', 'labelled Tomorrow');
    assert.equal(next[0].entries[0].blabDay, 3, 'and it is the right session');
  });

  test("a session dated today does surface, so tomorrow it will be tomorrow's", () => {
    schedule({ sessions: [S(5, 3, dayFromToday(0))], customs: [] });
    const t = app.blabCalTodaySessions();
    assert.equal(t.length, 1, 'today resolves by calendar date');
    assert.equal(t[0].blabDay, 3, 'the scheduled day, not the sequential guess');
  });

  test('two sessions on one day both come back, in order', () => {
    schedule({ sessions: [S(5, 3, dayFromToday(0))], customs: [C('Kronos', dayFromToday(0))] });
    const t = app.blabCalTodaySessions();
    assert.equal(t.length, 2, 'both sessions returned');
    assert.equal(t[0].blabDay, 3, 'BLAB first');
    assert.equal(t[1].custom, true, 'custom second');
  });

  test('a custom WOD scheduled today reaches the card — it used to be invisible', () => {
    schedule({ sessions: [], customs: [C('Kronos', dayFromToday(0))] });
    const t = app.blabCalTodaySessions();
    assert.equal(t.length, 1, 'custom session surfaced');
    const v = app.blabCalEntryView(t[0]);
    assert.equal(v.title, 'Kronos', 'titled by the library session');
    assert.ok(v.onStart.includes('openPhxSession'), 'and it can be started');
  });

  test('each session gets its own start action', () => {
    schedule({ sessions: [S(5, 3, dayFromToday(0))], customs: [C('Kronos', dayFromToday(0))] });
    const [a, b] = app.blabCalTodaySessions().map(app.blabCalEntryView);
    assert.ok(a.onStart.includes('blabOpenSession(5,3)'), 'BLAB start targets W5 D3');
    assert.ok(b.onStart.includes('openPhxSession'), 'custom start opens the library session');
    assert.ok(a.onStart !== b.onStart, 'the two starts are distinct');
  });

  test('completed and skipped sessions drop off the agenda', () => {
    schedule({
      sessions: [{ ...S(5, 3, dayFromToday(0)), status: 'completed' },
                 { ...S(5, 4, dayFromToday(0)), status: 'skipped' }],
      customs: []
    });
    assert.equal(app.blabCalTodaySessions().length, 0, 'history is not an agenda');
  });

  test('coming-up skips empty days and stops at the number asked for', () => {
    schedule({
      sessions: [S(5, 1, dayFromToday(2)), S(5, 2, dayFromToday(5)), S(5, 3, dayFromToday(9)), S(5, 4, dayFromToday(12))],
      customs: []
    });
    const next = app.blabCalNextDays(3);
    assert.equal(next.length, 3, 'three days returned');
    assert.equal(next[0].dateISO, dayFromToday(2), 'blank days between are skipped');
    assert.equal(next[2].dateISO, dayFromToday(9), 'and it stops at three');
  });

  test('coming-up never includes today', () => {
    schedule({ sessions: [S(5, 3, dayFromToday(0)), S(5, 4, dayFromToday(3))], customs: [] });
    const next = app.blabCalNextDays(3);
    assert.equal(next.length, 1, "today's session is not repeated below the card");
    assert.equal(next[0].dateISO, dayFromToday(3), 'only the future day listed');
  });

  test('the 48h gate still blocks a Day 4 scheduled too close to Day 2', () => {
    schedule({ sessions: [S(5, 2, dayFromToday(0)), S(5, 4, dayFromToday(1))], customs: [] });
    const v = app.blabCalEntryView(app.blabCalNextDays(3)[0].entries[0]);
    assert.equal(v.blocked, true, 'Day 4 one day after Day 2 is blocked');
    assert.ok(v.blockNote.includes('48hrs'), 'and says why');
  });

  test('a Day 4 clear of the 48h window is startable', () => {
    schedule({ sessions: [S(5, 2, dayFromToday(0)), S(5, 4, dayFromToday(2))], customs: [] });
    const v = app.blabCalEntryView(app.blabCalNextDays(3)[0].entries[0]);
    assert.equal(v.blocked, false, 'two days later is fine');
    assert.ok(v.onStart, 'and it has a start action');
  });

  test('an empty calendar leaves the old sequential Today card alone', () => {
    schedule({ sessions: [], customs: [] });
    assert.equal(app.blabCalHasSchedule(), false, 'no schedule in use');
  });

  test('a calendar holding only finished work also counts as not in use', () => {
    schedule({ sessions: [{ ...S(5, 1, dayFromToday(-2)), status: 'completed' }], customs: [] });
    assert.equal(app.blabCalHasSchedule(), false, 'finished history does not hijack the card');
  });

  test('one pending entry anywhere puts the calendar in charge', () => {
    schedule({ sessions: [S(5, 3, dayFromToday(4))], customs: [] });
    assert.equal(app.blabCalHasSchedule(), true, 'calendar takes over the Today card');
  });
}
