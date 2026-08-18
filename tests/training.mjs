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

  // ── Preview before adding, live suggestions, planned rest (v4.9.163) ──────
  // Jon: "can the session wod and core actually open to see what they are before
  // accepting - also can the suggested update to the calendar live as selecting
  // sessions - even suggested rest day?"

  const REST = (date) => ({ id: 'r1', cat: 'REST', libId: null, label: 'Rest Day', scheduledDate: date, status: 'pending' });

  test('a planned rest day is an entry, but never a session you can start', () => {
    schedule({ sessions: [], customs: [REST(dayFromToday(0))] });
    const t = app.blabCalTodaySessions();
    assert.equal(t.length, 1, 'the planned rest is on the day');
    const v = app.blabCalEntryView(t[0]);
    assert.equal(v.rest, true, 'flagged as rest');
    assert.equal(v.title, 'Rest Day', 'titled as rest');
    assert.equal(v.onStart, '', 'no start action — there is nothing to start');
  });

  test('a planned rest does not satisfy the 48h gate the way a session would', () => {
    // Day 2 today, rest tomorrow, Day 4 the day after. The rest must not be mistaken
    // for the lower-body session when the gate measures back to Day 2.
    schedule({
      sessions: [S(5, 2, dayFromToday(0)), S(5, 4, dayFromToday(1))],
      customs: [REST(dayFromToday(1))]
    });
    const day4 = app.blabCalSessionsOn(dayFromToday(1)).find(e => e.blabDay === 4);
    assert.equal(app.blabCalEntryView(day4).blocked, true, 'Day 4 still blocked one day after Day 2');
  });

  test('a planned rest does not count towards the strength warnings', () => {
    schedule({
      sessions: [S(5, 1, dayFromToday(0)), S(5, 2, dayFromToday(1))],
      customs: [REST(dayFromToday(2))]
    });
    const days = [0, 1, 2].map(n => new Date(new Date().setDate(new Date().getDate() + n)));
    const w = app._blabCalWarnings(days);
    assert.equal(w.byDate[dayFromToday(2)].consecutive, false,
      'a rest day breaks the run rather than extending it to three');
  });

  test('a planned rest counts as the calendar being in use', () => {
    schedule({ sessions: [], customs: [REST(dayFromToday(1))] });
    assert.equal(app.blabCalHasSchedule(), true, 'deciding to rest is still a plan');
  });

  test('an unaccepted suggestion is never stored, so it cannot reach the Today card', () => {
    schedule({ sessions: [], customs: [] });
    const sug = app._blabCalSuggestFor(dayFromToday(0));
    assert.ok(sug, 'a suggestion is offered for an empty day');
    assert.equal(app.blabCalTodaySessions().length, 0, 'but nothing is on the calendar until accepted');
    assert.equal(app.blabCalHasSchedule(), false, 'and it does not put the calendar in charge');
  });

  test('a suggestion names a real library session, not just a category', () => {
    // Asserted unconditionally on purpose. An `if (sug.kind === 'session')` wrapper
    // would let this pass silently the day the suggestion engine starts returning
    // null or rest here — a test that can quietly stop testing is worse than none.
    schedule({ sessions: [], customs: [] });
    const sug = app._blabCalSuggestFor(dayFromToday(3));
    assert.ok(sug, 'a suggestion is produced');
    assert.equal(sug.kind, 'session', 'an empty week with no core logged suggests a session');
    assert.ok(sug.libId, 'carries a library id');
    assert.ok(sug.label && sug.label.length > 1, 'and a real session name');
    assert.ok(['WOD', 'CORE'].includes(sug.cat), 'categorised');
    const real = app.phxSessionById(sug.libId);
    assert.ok(real, 'the id resolves to an actual PHX_LIB session');
    assert.equal(real.name, sug.label, 'and the name matches the library');
  });

  test('accepting a rest suggestion puts a real rest entry on the day', () => {
    schedule({ sessions: [], customs: [] });
    app._blabCalPlaceRest(dayFromToday(2));
    const on = app.blabCalSessionsOn(dayFromToday(2));
    assert.equal(on.length, 1, 'rest entry placed');
    assert.equal(on[0].cat, 'REST', 'stored as a rest entry');
    assert.equal(app.blabCalEntryView(on[0]).rest, true, 'and reads back as rest');
  });

  test('a rest day can be unscheduled again like any other entry', () => {
    schedule({ sessions: [], customs: [REST(dayFromToday(1))] });
    app._blabCalUnschedule('c:r1');
    assert.equal(app.blabCalSessionsOn(dayFromToday(1)).length, 0, 'rest removed');
  });
  // ── Completion must not drop the calendar mirror (v4.9.164) ───────────────
  // Jon: "todays upper not in there that completed - giving a recommended".
  // blabCompleteSession captured state, then blabCalMarkCompleted saved the
  // calendar into a FRESH copy of that state, then the stale capture was written
  // back — silently discarding calendar from blab_state on every completion.
  // Invisible on the device that did the work, fatal on the next reinstall:
  // blabCalHydrateFromState rebuilds the local calendar from blab_state.calendar,
  // which was empty, so the whole schedule came back blank.

  test('completing a session keeps the calendar in the cloud mirror', () => {
    reset();
    signIn(UID);
    seed(KEY, { active: true, week: 5, last_completed_day: 0, maxes: { bench: 130, squat: 150, deadlift: 170 } });
    seed(`blab_calendar_v1_${UID}`, { sessions: [], customs: [] });

    app.blabCompleteSession(5, 1);

    const state = read(KEY);
    assert.ok(state.calendar, 'blab_state carries the calendar after a completion');
    assert.equal(state.calendar.sessions.length, 1, 'the completed session is in the mirror');
    assert.equal(state.calendar.sessions[0].status, 'completed', 'and it is marked completed');
  });

  test('a reinstall after completing rebuilds the same calendar', () => {
    // The exact sequence that lost Jon's schedule: complete, wipe local (reinstall),
    // restore from the cloud row, rehydrate the calendar.
    reset();
    signIn(UID);
    seed(KEY, { active: true, week: 5, last_completed_day: 0, maxes: { bench: 130, squat: 150, deadlift: 170 } });
    seed(`blab_calendar_v1_${UID}`, { sessions: [S(5, 2, dayFromToday(2))], customs: [] });

    app.blabCompleteSession(5, 1);
    const mirrored = read(KEY);

    // Reinstall: everything local is gone.
    reset();
    signIn(UID);
    app.blabRestoreFromCloud({ blab_state: mirrored });

    const cal = read(`blab_calendar_v1_${UID}`);
    assert.ok(cal, 'calendar rebuilt after reinstall');
    assert.equal(cal.sessions.length, 2, 'both the completed session and the scheduled one survived');
  });

  test('a completed session still shows on its own calendar day', () => {
    schedule({ sessions: [{ ...S(5, 1, dayFromToday(0)), status: 'completed' }], customs: [] });
    const cal = read(`blab_calendar_v1_${UID}`);
    const onDay = app._blabCalAllEntries(cal).filter(e => e.scheduledDate === dayFromToday(0) && e.status !== 'skipped');
    assert.equal(onDay.length, 1, 'the day cell still has the finished session — history is visible there');
  });

  test('a day whose only session is completed is not offered a suggestion', () => {
    schedule({ sessions: [{ ...S(5, 1, dayFromToday(1)), status: 'completed' }], customs: [] });
    const cal = read(`blab_calendar_v1_${UID}`);
    const onDay = app._blabCalAllEntries(cal).filter(e => e.scheduledDate === dayFromToday(1) && e.status !== 'skipped');
    assert.equal(onDay.length, 1, 'the day is not empty, so the render never reaches the suggestion branch');
  });

  // ── Suggestions must vary (v4.9.165) ──────────────────────────────────────
  // Jon: "all recommended are rotational power". With no training history every
  // candidate ranked equal, the running-best comparison never fired a second time,
  // and the picker returned list[0] on every day forever.

  test('a week of suggestions is not the same session over and over', () => {
    schedule({ sessions: [], customs: [] });
    const ids = [];
    for (let n = 0; n < 7; n++) {
      const s = app._blabCalSuggestFor(dayFromToday(n));
      if (s && s.kind === 'session') ids.push(s.libId);
    }
    assert.ok(ids.length >= 5, 'suggestions were produced across the week');
    assert.ok(new Set(ids).size > 1, `expected variety, got only ${[...new Set(ids)].join(', ')}`);
  });

  test('the same day always suggests the same thing, so a re-render does not flicker', () => {
    schedule({ sessions: [], customs: [] });
    const a = app._blabCalSuggestFor(dayFromToday(3));
    const b = app._blabCalSuggestFor(dayFromToday(3));
    assert.equal(a.libId, b.libId, 'stable for a given date');
  });

  test('a session already on the calendar is not suggested again elsewhere', () => {
    schedule({ sessions: [], customs: [] });
    const first = app._blabCalSuggestFor(dayFromToday(1));
    assert.ok(first && first.libId, 'a suggestion exists to begin with');
    // Accept it, then check no other day proposes the same session.
    app._blabCalPlace({ custom: true, id: 'x1', cat: first.cat, libId: first.libId, label: first.label }, dayFromToday(1));
    const others = [];
    for (let n = 2; n < 9; n++) {
      const s = app._blabCalSuggestFor(dayFromToday(n));
      if (s && s.kind === 'session') others.push(s.libId);
    }
    assert.ok(!others.includes(first.libId), 'the scheduled session is not proposed a second time');
  });

  test('a session finished this week is not immediately suggested again', () => {
    schedule({ sessions: [], customs: [] });
    const pick = app._blabCalSuggestFor(dayFromToday(2));
    app._blabCalPlace({ custom: true, id: 'x2', cat: pick.cat, libId: pick.libId, label: pick.label }, dayFromToday(-1));
    // Mark it done yesterday.
    const cal = read(`blab_calendar_v1_${UID}`);
    cal.customs[0].status = 'completed';
    cal.customs[0].completedDate = dayFromToday(-1);
    seed(`blab_calendar_v1_${UID}`, cal);

    const after = [];
    for (let n = 0; n < 6; n++) {
      const s = app._blabCalSuggestFor(dayFromToday(n));
      if (s && s.kind === 'session') after.push(s.libId);
    }
    assert.ok(!after.includes(pick.libId), 'something done yesterday is not proposed again this week');
  });

  // ── The Today card renderer must actually RUN (v4.9.165) ──────────────────
  // Jon: "today screen not showing what is in calandar - just todays session start
  // that doesnt work". Cause: the renderer called _blabCalEntryView, but the
  // function is window.blabCalEntryView. Every call threw ReferenceError, the Today
  // inject swallowed it, and the static "Today's Session / Start training"
  // placeholder was left on screen with a dead button.
  //
  // Nothing caught it for four versions because runtime_check only executes top
  // level (an undefined name inside a function body is invisible to it) and every
  // functional test called window.blabCalEntryView directly instead of going
  // through the renderer. These tests invoke the renderer itself.

  const stubEl = () => {
    const el = {
      style: {}, innerHTML: '', _attrs: {},
      setAttribute(k, v) { this._attrs[k] = v; },
      removeAttribute(k) { delete this._attrs[k]; },
      querySelector: () => null
    };
    return el;
  };

  test('the Today renderer runs without throwing when a session is scheduled', () => {
    schedule({ sessions: [S(5, 3, dayFromToday(0))], customs: [] });
    const card = stubEl(), inner = stubEl();
    const handled = app._blabRenderTodayFromCalendar(card, inner, 5);
    assert.equal(handled, true, 'renderer took over the card');
    assert.ok(inner.innerHTML.includes('Upper Body — Chins'), 'it rendered the scheduled session');
    assert.ok(inner.innerHTML.includes('Start'), 'with a start action');
  });

  test('the Today card start action targets the scheduled session', () => {
    schedule({ sessions: [S(5, 3, dayFromToday(0))], customs: [] });
    const card = stubEl(), inner = stubEl();
    app._blabRenderTodayFromCalendar(card, inner, 5);
    assert.ok(inner.innerHTML.includes('blabOpenSession(5,3)'), 'start opens W5 D3, not a sequential guess');
  });

  test('two sessions today both render, each with its own start', () => {
    schedule({ sessions: [S(5, 3, dayFromToday(0))], customs: [C('Kronos', dayFromToday(0))] });
    const card = stubEl(), inner = stubEl();
    app._blabRenderTodayFromCalendar(card, inner, 5);
    assert.ok(inner.innerHTML.includes('2 Sessions'), 'card says there are two');
    assert.ok(inner.innerHTML.includes('blabOpenSession(5,3)'), 'BLAB start present');
    assert.ok(inner.innerHTML.includes('openPhxSession'), 'custom start present');
    assert.equal(card._attrs.onclick, undefined, 'no whole-card tap when it is ambiguous');
  });

  test('an empty day offers Confirm Rest and Add Session', () => {
    schedule({ sessions: [S(5, 3, dayFromToday(4))], customs: [] });
    const card = stubEl(), inner = stubEl();
    const handled = app._blabRenderTodayFromCalendar(card, inner, 5);
    assert.equal(handled, true, 'renderer handled the empty day');
    assert.ok(inner.innerHTML.includes('No Session Today'), 'says so plainly');
    assert.ok(inner.innerHTML.includes('_blabCalConfirmRestToday'), 'offers confirm rest');
    assert.ok(inner.innerHTML.includes('_blabCalAddSessionToday'), 'offers add session');
  });

  test('confirming rest from Today writes straight to the calendar', () => {
    schedule({ sessions: [], customs: [] });
    app._blabCalConfirmRestToday();
    const on = app.blabCalSessionsOn(dayFromToday(0));
    assert.equal(on.length, 1, 'rest entry created for today');
    assert.equal(on[0].cat, 'REST', 'stored as rest');
    const card = stubEl(), inner = stubEl();
    app._blabRenderTodayFromCalendar(card, inner, 5);
    assert.ok(inner.innerHTML.includes('You planned this one'), 'and Today reflects it immediately');
  });

  test('a planned rest day renders as planned, not as an empty day', () => {
    schedule({ sessions: [], customs: [REST(dayFromToday(0))] });
    const card = stubEl(), inner = stubEl();
    app._blabRenderTodayFromCalendar(card, inner, 5);
    assert.ok(inner.innerHTML.includes('Rest Day'), 'reads as a rest day');
    assert.ok(!inner.innerHTML.includes('No Session Today'), 'not the empty-day wording');
    assert.ok(!inner.innerHTML.includes('Start'), 'nothing to start');
  });

  test('every name the Today renderer reaches for actually exists', () => {
    // The specific failure was an identifier that did not resolve. Exercise all four
    // branches — one session, two sessions, planned rest, empty — so any further
    // undefined name in the renderer throws here rather than on Jon's phone.
    const cases = [
      { sessions: [S(5, 3, dayFromToday(0))], customs: [] },
      { sessions: [S(5, 3, dayFromToday(0))], customs: [C('Kronos', dayFromToday(0))] },
      { sessions: [], customs: [REST(dayFromToday(0))] },
      { sessions: [S(5, 4, dayFromToday(6))], customs: [] }
    ];
    cases.forEach((c, i) => {
      schedule(c);
      const card = stubEl(), inner = stubEl();
      app._blabRenderTodayFromCalendar(card, inner, 5);
      assert.ok(inner.innerHTML.length > 50, `branch ${i} rendered real content`);
    });
  });

  // ── Weekly check-in feeds the nutrition weight log (v4.9.167) ─────────────
  // PM ruling 2026-08-18: the dated nutrition daily weigh-in is the authoritative
  // weight record — macro targets are recalculated from it. Nutrition found that
  // the weight Jon logs never reached targets at all. athlete.bw stays as the
  // snapshot the rest of the app reads, so this is an addition, not a swap.
  //
  // These drive submitWeightCheckin itself, not nutRecordWeight — per the standard
  // that came out of .165, calling the helper a function uses does not cover the
  // function. That means stubbing the input element it reads, because the sandbox's
  // getElementById hands back a fresh object on every call.

  const driveCheckin = (kg, { withNutrition = true } = {}) => {
    reset();
    signIn(UID);
    app.athlete = { id: UID, name: 'Jon', bw: 0, weightLog: [] };
    if (withNutrition) {
      // Minimal nutrition state — enough for nutGetState() to return an object.
      seed(`phx_nut_v1_${UID}`, { profile: { weight_kg: 80, height_cm: 180, age: 40, sex: 'male' }, goal: 'maintain', daily: {}, targets: {} });
    }
    const input = { value: String(kg), style: {} };
    const realGet = app.document.getElementById;
    app.document.getElementById = (id) => (id === 'weight-checkin-input' ? input : realGet.call(app.document, id));
    try { app.submitWeightCheckin(); }
    finally { app.document.getElementById = realGet; }
  };

  // Nutrition's own date convention — nutRecordWeight defaults to _nutToday(), which
  // is toISOString().slice(0,10), i.e. UTC. Asserted against the same expression on
  // purpose: this test must track what the app actually does, not what I assume.
  const nutTodayKey = () => app._phxLocalISO();

  test('a weekly weigh-in reaches the nutrition daily log', () => {
    driveCheckin(84.5);
    const ns = read(`phx_nut_v1_${UID}`);
    assert.ok(ns.daily[nutTodayKey()], 'a daily record exists for today');
    assert.equal(ns.daily[nutTodayKey()].weight_kg, 84.5, 'and it holds the submitted weight');
  });

  test('the weekly weigh-in still updates athlete.bw as well', () => {
    driveCheckin(84.5);
    assert.equal(app.athlete.bw, 84.5, 'athlete.bw remains the snapshot');
    assert.equal(app.athlete.weightLog.length, 1, 'and the weight log still gets its entry');
  });

  test('with no nutrition state, the check-in still works and does not throw', () => {
    // Jon may never have opened Nutrition. nutRecordWeight returns false and writes
    // nothing — deliberate, per Nutrition's contract. The check-in must not care.
    driveCheckin(84.5, { withNutrition: false });
    assert.equal(app.athlete.bw, 84.5, 'athlete.bw updated regardless');
    assert.equal(read(`phx_nut_v1_${UID}`), null, 'and no nutrition state was invented');
  });

  test('an out-of-range weight writes nothing anywhere', () => {
    driveCheckin(500);
    assert.equal(app.athlete.bw, 0, 'athlete.bw untouched');
    const ns = read(`phx_nut_v1_${UID}`);
    assert.equal(Object.keys(ns.daily).length, 0, 'and nothing reached the nutrition log');
  });
}
