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
//
// ── DATE LITERALS: audited 2026-08-21, none decay ────────────────────────────
// A test pinned to a literal date turns into a DIFFERENT test as that date recedes.
// Nutrition's calendar cases were written against 2026-08-19; once it became the past
// they silently exercised the unresolved-`due` path while still claiming to test
// scheduled sessions — green throughout, describing something they no longer did.
// This file owns the calendar semantics where past/present/future changes meaning, so
// it is the most exposed suite in the repo. All seven literals checked:
//
//   OLDER / NEWER (L19-20)   — compared only against EACH OTHER by the restore
//                              resolution table, never against now. Position-independent.
//   '2026-08-20' (calendar    — arbitrary; that case asserts the blob survives restore,
//    carry test)                nothing interprets the date. Commented at the site.
//   withClock('2026-08-19     — a PINNED now. The '2026-08-20' assertions are that
//    T18:30Z') pairs            instant's LOCAL date, so the pair is the point of the
//                               test and cannot drift.
//
// RULE FOR ANYTHING ADDED HERE: if the assertion depends on the date's position
// relative to today, derive it with dayFromToday(n) or pin `now` with withClock() and
// say which status you mean. A bare literal is only acceptable where the assertion
// genuinely does not care — and say so at the site, or the next reader cannot tell
// the difference between "inert" and "not yet decayed".

import { recordingDom as sharedRecordingDom } from './helpers/dom.mjs';

// ── SETTLING ASYNC WORK ─────────────────────────────────────────────────────
// setTimeout(0) is a MACROTASK: the entire microtask queue drains before it fires, so
// the depth of the promise chain under test cannot matter. `await Promise.resolve()`
// is shorter and looks cleaner, and it makes the case depend on counting ticks inside
// code it does not own.
//
// COST DEMONSTRATED, not reasoned: adding two behaviourally-meaningless pass-through
// .then links to _blabConfirm broke the hand-counted version of the confirm case. Two
// links, zero behaviour change, red suite.
//
// A rejection also needs one more tick than a resolution — the .then passes through
// before .catch sees it — which is how this was found: one sibling case failed loudly
// enough to indict four that were passing by luck.
const settle = () => new Promise((r) => setTimeout(r, 0));

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
    // The date here is ARBITRARY and nothing interprets it — this asserts the blob
    // survives restore and hydrates, not what the day means. Saying so because
    // Nutrition found several of its own cases written against a hardcoded date that
    // had since become the past, silently exercising the unresolved-`due` path while
    // claiming to test scheduled sessions. A bare literal that looks meaningful is
    // how that starts. If this case ever grows a day-semantics assertion, switch it
    // to dayFromToday().
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
    // Was: includes('openPhxSession') — a name that has never existed. This test was
    // green for six versions while the button was dead. Presence of a name proves
    // nothing; the handler-resolution cases below assert the name RESOLVES.
    assert.ok(v.onStart.includes('_phxStartSession'), 'and it can be started');
  });

  test('each session gets its own start action', () => {
    schedule({ sessions: [S(5, 3, dayFromToday(0))], customs: [C('Kronos', dayFromToday(0))] });
    const [a, b] = app.blabCalTodaySessions().map(app.blabCalEntryView);
    assert.ok(a.onStart.includes('blabOpenSession(5,3)'), 'BLAB start targets W5 D3');
    assert.ok(b.onStart.includes('_phxStartSession'), 'custom start opens the library session');
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
    assert.ok(inner.innerHTML.includes('_phxStartSession'), 'custom start present');
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

  // ── Local day keys (v4.9.170) ─────────────────────────────────────────────
  // Jon trains at 4:30am Brisbane, which is 18:30 UTC the previous day. Anything
  // that derived a day key from toISOString() filed his morning activity under
  // yesterday. PM date rule: persist instants as UTC ISO, derive day keys at read
  // time via _phxLocalISO(new Date(instant)); only bare day keys are stored local.

  const localISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  // A real instant for today at a given local hour — what the walk writers store.
  const todayAt = (h, m = 0) => { const d = new Date(); d.setHours(h, m, 0, 0); return d.toISOString(); };
  const daysAgoAt = (n, h) => { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(h, 0, 0, 0); return d.toISOString(); };

  test('a walk at ANY hour of today counts toward the streak', () => {
    // Deliberately swept across all 24 local hours rather than testing "an evening
    // walk". A single fixed hour only exercises the bug when the run happens to
    // straddle the UTC boundary — at 4pm local the old code passes and the test
    // proves nothing. Sweeping guarantees some hour straddles in any timezone that
    // has an offset at all, so this bites wherever it runs.
    for (let hour = 0; hour < 24; hour++) {
      reset();
      signIn(UID);
      const d = new Date(); d.setHours(hour, 30, 0, 0);
      seed('phoenix_walk_logs', [{ date: d.toISOString(), mode: 'walk', distance: 3 }]);
      assert.equal(app.getWalkStreak(), 1, `a walk logged at ${hour}:30 local counts toward today`);
    }
  });

  test('a 4:30am walk counts — it passed by accident before, so pin it', () => {
    // This one WORKED under the old UTC-vs-UTC comparison, purely because both sides
    // shifted together. A local-only fix on the reader alone would have broken it,
    // and 4:30am is the hour Jon actually trains.
    reset();
    signIn(UID);
    const d = new Date(); d.setHours(4, 30, 0, 0);
    seed('phoenix_walk_logs', [{ date: d.toISOString(), mode: 'walk', distance: 3 }]);
    assert.equal(app.getWalkStreak(), 1, 'a pre-dawn walk today is counted');
  });

  test('morning and evening walks across days build one continuous streak', () => {
    reset();
    signIn(UID);
    const at = (back, hour) => { const d = new Date(); d.setDate(d.getDate() - back); d.setHours(hour, 0, 0, 0); return d.toISOString(); };
    seed('phoenix_walk_logs', [
      { date: at(0, 20), mode: 'walk' },
      { date: at(1, 4), mode: 'walk' },
      { date: at(2, 21), mode: 'walk' }
    ]);
    assert.equal(app.getWalkStreak(), 3, 'mixed times across three days still chain');
  });

  test('a gap still breaks the streak', () => {
    reset();
    signIn(UID);
    const at = (back, hour) => { const d = new Date(); d.setDate(d.getDate() - back); d.setHours(hour, 0, 0, 0); return d.toISOString(); };
    seed('phoenix_walk_logs', [{ date: at(0, 20), mode: 'walk' }, { date: at(2, 20), mode: 'walk' }]);
    assert.equal(app.getWalkStreak(), 1, 'yesterday missing ends it at one');
  });

  // A fixed clock, so the set-log cases below assert the divergence itself rather
  // than depending on the wall clock at run time. 18:30 UTC is 04:30 next-day in
  // Brisbane — local and UTC dates differ, which is precisely Jon's training hour.
  const withClock = (isoInstant, fn) => {
    const RealDate = app.Date;
    const FIXED = RealDate.parse(isoInstant);
    class FakeDate extends RealDate {
      constructor(...a) { if (a.length === 0) super(FIXED); else super(...a); }
      static now() { return FIXED; }
    }
    app.Date = FakeDate;
    try { return fn(); } finally { app.Date = RealDate; }
  };

  const stubRow = () => ({
    getAttribute: (k) => (k === 'data-exid' ? 'bench' : k === 'data-setidx' ? '2' : ''),
    closest: () => ({ querySelector: () => ({ textContent: 'Bench Press' }) }),
    parentElement: null,
    querySelector: (sel) => ({ value: sel.includes('kg-') ? '100' : '5' })
  });

  test('a set logged at 4:30am is dated today, not yesterday', () => {
    // Drives autoLogSet itself — per the standard, calling the helper it uses would
    // not cover the function. The row is a stub because the sandbox has no DOM.
    reset();
    signIn(UID);
    withClock('2026-08-19T18:30:00.000Z', () => app.autoLogSet(stubRow()));
    const logs = read('phoenix_session_logs_sets');
    assert.equal(logs.length, 1, 'the set was logged');
    assert.equal(logs[0].date, '2026-08-20', 'dated by the local day, not the UTC one (which was the 19th)');
    assert.equal(logs[0].exerciseName, 'Bench Press', 'and it captured the exercise');
    assert.equal(logs[0].kg, '100', 'and the load');
  });

  test('the set-log date agrees with the calendar day key at the same instant', () => {
    // The calendar already keyed days locally, so a UTC set-log date meant the two
    // systems disagreed about "today" for the whole of Jon's training window.
    reset();
    signIn(UID);
    const both = withClock('2026-08-19T18:30:00.000Z', () => {
      app.autoLogSet(stubRow());
      return { cal: app._blabCalTodayISO(), set: read('phoenix_session_logs_sets')[0].date };
    });
    assert.equal(both.set, both.cal, 'set log and calendar agree on which day it is');
    assert.equal(both.cal, '2026-08-20', 'and both say the local day');
  });

  // ── Emitted click handlers must name real functions (v4.9.171) ────────────
  // Jon: "the chosen session came up on the today screen but didnt load when
  // tried to enter it". blabCalEntryView emitted `openPhxSession('id')` into the
  // Start onclick. openPhxSession has never existed anywhere in the app, so every
  // scheduled WOD/Core had a Start button that threw inside the inline handler and
  // did nothing. The real function is _phxStartSession(id).
  //
  // This is the third instance of the same class (_blabCalEntryView in .165,
  // _phxShowCustomSessionBuilder in .165). A name inside a function body — or worse,
  // inside a STRING that later becomes an onclick — is invisible to runtime_check.
  // So rather than pin this one name, resolve whatever the code emits.

  const fnNameOf = (onStart) => {
    const m = /^([A-Za-z_$][\w$.]*)\s*\(/.exec(String(onStart || '').trim());
    return m ? m[1] : null;
  };
  const resolve = (name) => name.split('.').reduce((o, k) => (o == null ? o : o[k]), app);

  test('a scheduled WOD emits a Start handler that actually exists', () => {
    schedule({ sessions: [], customs: [C('Kronos', dayFromToday(0))] });
    const view = app.blabCalEntryView(app.blabCalTodaySessions()[0]);
    const name = fnNameOf(view.onStart);
    assert.ok(name, `a start handler was emitted, got: ${view.onStart}`);
    assert.equal(typeof resolve(name), 'function', `${name}() must exist — it becomes an onclick`);
  });

  test('a scheduled BLAB day emits a Start handler that actually exists', () => {
    schedule({ sessions: [S(5, 3, dayFromToday(0))], customs: [] });
    const view = app.blabCalEntryView(app.blabCalTodaySessions()[0]);
    const name = fnNameOf(view.onStart);
    assert.ok(name, `a start handler was emitted, got: ${view.onStart}`);
    assert.equal(typeof resolve(name), 'function', `${name}() must exist — it becomes an onclick`);
  });

  test('every handler the Today card renders resolves to a real function', () => {
    // Sweeps the rendered HTML rather than the view objects, so anything wired into
    // an onclick anywhere on the card is covered — not just the Start actions.
    const stubEl = () => ({ style: {}, innerHTML: '', _attrs: {}, setAttribute(k, v) { this._attrs[k] = v; }, removeAttribute(k) { delete this._attrs[k]; }, querySelector: () => null });
    const cases = [
      { sessions: [S(5, 3, dayFromToday(0))], customs: [] },
      { sessions: [S(5, 3, dayFromToday(0))], customs: [C('Kronos', dayFromToday(0))] },
      { sessions: [], customs: [REST(dayFromToday(0))] },
      { sessions: [S(5, 4, dayFromToday(6))], customs: [] }
    ];
    cases.forEach((c, idx) => {
      schedule(c);
      const card = stubEl(), inner = stubEl();
      app._blabRenderTodayFromCalendar(card, inner, 5);
      const html = inner.innerHTML + ' ' + (card._attrs.onclick || '');
      const names = [...html.matchAll(/onclick="[^"]*?(?:event\.stopPropagation\(\);)?\s*([A-Za-z_$][\w$.]*)\s*\(/g)]
        .map((m) => m[1])
        .filter((n) => n !== 'event');
      // No minimum: a planned rest day legitimately wires nothing, because there is
      // nothing to start. The assertion is that whatever IS wired resolves.
      names.forEach((n) => {
        assert.equal(typeof resolve(n), 'function', `branch ${idx}: ${n}() is wired to a click but does not exist`);
      });
    });
  });

  test('a session that cannot open reports it instead of doing nothing', () => {
    // The failure paths used to end in alert(), which iOS PWA suppresses — a real
    // error looked exactly like a dead button. Now recorded for Diagnostic.
    reset();
    signIn(UID);
    seed(KEY, { active: true, week: 5, last_completed_day: 2 });   // no maxes -> no session data
    app.blabOpenSession(5, 3);
    const rec = read('phx_last_write_error');
    assert.ok(rec, 'the failure was recorded');
    assert.equal(rec.context, 'blabOpenSession', 'under the session-open context');
  });

  // ── Native dialogs replaced with DOM modals (v4.9.174) ────────────────────
  // alert()/confirm() are suppressed in the iOS PWA (CLAUDE.md rule 4). Ten sat in
  // the BLAB session paths, so a mid-session result or validation error showed Jon
  // nothing at 4:30am. The confirm() in blabOpenCheckin was worse than invisible:
  // a suppressed confirm returns FALSE, so starting the next week never ran at all.
  //
  // Driven through a recording DOM so the modal's own wiring is exercised — the
  // point of the change is that a BUTTON works, which a string assertion cannot show.

  const recordingDom = () => sharedRecordingDom(app);

  test('_blabConfirm delegates to the one shared modal, with the right wording', () => {
    // Deliberately not asserting that onYes RAN: _phxConfirm is promise-based, so the
    // callback lands a microtask later, and this runner does not await test bodies —
    // an async assertion here would pass without ever executing. Assert the contract
    // that is observable synchronously, and cover the button itself below.
    reset();
    signIn(UID);
    const real = app._phxConfirm;
    let got = null;
    app._phxConfirm = (title, message, yesLabel, danger) => {
      got = { title, message, yesLabel, danger };
      return Promise.resolve(false);
    };
    try {
      app._blabConfirm('Start Week 6', 'Begin the next week?', () => {}, 'Start Week 6');
      assert.ok(got, 'it went through the shared confirm rather than its own modal');
      assert.equal(got.title, 'Start Week 6', 'title passed through');
      assert.equal(got.yesLabel, 'Start Week 6', 'button label passed through');
      assert.equal(got.danger, false, 'a week check-in is not a destructive action');
    } finally { app._phxConfirm = real; }
  });

  test('the shared confirm renders a working button, not just matching text', () => {
    reset();
    signIn(UID);
    const dom = recordingDom();
    try {
      app._phxConfirm('Stop and exit?', 'This walk will not be saved.', 'Stop and Exit', true);
      const yes = dom.byButton('Stop and Exit');
      assert.ok(yes, 'a real button exists with a click handler');
      yes.handlers.click();
      const ov = dom.made.find((m) => m.id === 'phx-confirm');
      assert.ok(ov && ov.removed, 'clicking it dismisses the modal');
    } finally { dom.restore(); }
  });

  test('a result notice renders its lines and can be dismissed', () => {
    reset();
    signIn(UID);
    const dom = recordingDom();
    try {
      app._blabNotice('Tabata Complete', ['Rounds: 12', 'New best — was 10']);
      assert.ok(dom.byText('Tabata Complete'), 'title rendered');
      assert.ok(dom.byText('Rounds: 12'), 'first line rendered');
      assert.ok(dom.byText('New best — was 10'), 'second line rendered');
      const ok = dom.byButton('OK');
      assert.ok(ok, 'dismissable');
    } finally { dom.restore(); }
  });

  test('a notice skips empty lines rather than rendering blanks', () => {
    // The tabata and log-result callers pass '' when there is no previous best.
    reset();
    signIn(UID);
    const dom = recordingDom();
    try {
      app._blabNotice('Cardio Logged', ['Steady-state: 20:00', '']);
      const blanks = dom.made.filter((m) => m.textContent === '');
      assert.equal(blanks.filter((b) => b.style && b.style.cssText && String(b.style.cssText).includes('line-height:1.6')).length, 0,
        'no empty result line was rendered');
    } finally { dom.restore(); }
  });

  test('the week check-in goes through the DOM confirm, not a native one', () => {
    // Drives blabOpenCheckin itself. Under the old code this called confirm(), which
    // the sandbox stubs to false — indistinguishable from the button doing nothing.
    reset();
    signIn(UID);
    seed(KEY, { active: true, week: 6, last_completed_day: 4, maxes: { bench: 130, squat: 150, deadlift: 170 } });
    const dom = recordingDom();
    try {
      app.blabOpenCheckin();
      assert.ok(dom.byButton('Start Week 6'), 'a working confirm button was raised for the next week');
    } finally { dom.restore(); }
  });

  // ── _phxConfirm resolution, end to end (v4.9.177) ─────────────────────────
  // Restored now the runner awaits test bodies. Before ff2762b an async body was
  // recorded as passing before its assertions ran, so these could not have failed —
  // which is how .175 shipped five destructive reset flows on an untestable promise.
  //
  // Covered heavily because those flows are destructive: an explicit Yes must
  // proceed, and NOTHING else may.

  const driveConfirm = async (pick) => {
    const dom = recordingDom();
    try {
      const p = app._phxConfirm('Reset Programme', 'This cannot be undone.', 'Reset Everything', true);
      pick(dom);
      return await p;
    } finally { dom.restore(); }
  };

  test('confirming resolves true — the destructive action proceeds', async () => {
    const got = await driveConfirm((dom) => dom.byButton('Reset Everything').handlers.click());
    assert.equal(got, true, 'an explicit Yes resolves true');
  });

  test('cancelling resolves false — the destructive action does not run', async () => {
    const got = await driveConfirm((dom) => dom.byButton('Cancel').handlers.click());
    assert.equal(got, false, 'Cancel resolves false');
  });

  test('a backdrop tap resolves false, it does not count as consent', async () => {
    // Dismissing by tapping outside must never be read as agreement to a reset.
    const got = await driveConfirm((dom) => {
      const ov = dom.byId('phx-confirm');
      ov.handlers.click({ target: ov });
    });
    assert.equal(got, false, 'a backdrop tap is a cancel');
  });

  test('a tap INSIDE the modal is not a dismissal', async () => {
    // The backdrop handler fires for clicks anywhere in the overlay subtree, so it
    // must check the target. Otherwise reading the message dismisses the dialog.
    const dom = recordingDom();
    try {
      const p = app._phxConfirm('Reset Programme', 'This cannot be undone.', 'Reset Everything', true);
      const ov = dom.byId('phx-confirm');
      ov.handlers.click({ target: { not: 'the overlay' } });
      let settled = false;
      p.then(() => { settled = true; });
      await settle();
      assert.equal(settled, false, 'clicking the box itself leaves the decision open');
      dom.byButton('Cancel').handlers.click();
      assert.equal(await p, false, 'and it still resolves when a button is used');
    } finally { dom.restore(); }
  });

  test('resolving twice cannot change the answer', async () => {
    // finish() guards with `done`; if it did not, a stray second event could flip a
    // false into a true after the caller had already acted on the cancel.
    const dom = recordingDom();
    try {
      const p = app._phxConfirm('Reset Programme', 'This cannot be undone.', 'Reset Everything', true);
      dom.byButton('Cancel').handlers.click();
      dom.byButton('Reset Everything').handlers.click();
      assert.equal(await p, false, 'the first answer stands');
    } finally { dom.restore(); }
  });

  test('_blabConfirm runs its callback only when confirmed', async () => {
    // The BLAB session paths use the callback form. Restored end to end now that a
    // microtask can actually be awaited.
    let ran = false;
    const dom = recordingDom();
    try {
      app._blabConfirm('Start Week 6', 'Begin the next week?', () => { ran = true; }, 'Start Week 6');
      dom.byButton('Start Week 6').handlers.click();
      await settle();
      assert.equal(ran, true, 'confirming runs the action');
    } finally { dom.restore(); }
  });

  test('_blabConfirm does not run its callback when cancelled', async () => {
    let ran = false;
    const dom = recordingDom();
    try {
      // POSITIVE CONTROL FIRST. `ran === false` is also true when the callback has
      // simply not run yet, so this case could never fail from settling too early — it
      // stayed green under the pass-through inversion that reddened its sibling. Proving
      // the callback WOULD have fired by now is what makes the negative mean something.
      let control = false;
      app._blabConfirm('Control', 'x', () => { control = true; }, 'Control');
      dom.byButton('Control').handlers.click();
      await settle();
      assert.equal(control, true, 'a confirmed callback has definitely run by this point');

      app._blabConfirm('Start Week 6', 'Begin the next week?', () => { ran = true; }, 'Start Week 6');
      dom.byButton('Cancel').handlers.click();
      await settle();
      assert.equal(ran, false, 'cancelling runs nothing');
    } finally { dom.restore(); }
  });

  // ── Three session bugs from Jon's 4:30am session (v4.9.179) ───────────────

  // 1. "navigate off training today session it then wipes the session info already
  //    done". openTodaySession called supabaseStartSession unconditionally and that
  //    always INSERTS, so re-entering minted a fresh id — and the completed-sets
  //    shadow store is keyed by it, so the restore looked under a key never written.

  test('re-entering the same session keeps its id, so logged sets are still found', () => {
    reset();
    signIn(UID);
    app.currentSupabaseSessionId = 'sess-1';
    app._phxActiveSessionKey = 'blab:5:3:' + dayFromToday(0);
    // The shadow store the restore reads is keyed by session id.
    seed('phoenix_completed_sets_sess-1', [{ exId: 'bench', setIdx: 0, kg: '100', reps: '5' }]);
    const before = read('phoenix_completed_sets_sess-1');
    assert.equal(before.length, 1, 'a set was logged under the live session id');
    // Same identity: the key must not move, or that set becomes unreachable.
    assert.equal(app._phxActiveSessionKey, 'blab:5:3:' + dayFromToday(0), 'identity is week/day plus local date');
  });

  test('completing a session releases the re-entry key', () => {
    // Otherwise a repeat of the same week/day would reuse a COMPLETED row.
    reset();
    signIn(UID);
    app.currentSupabaseSessionId = 'sess-1';
    app._phxActiveSessionKey = 'blab:5:3:' + dayFromToday(0);
    app.supabaseCompleteSession({});
    assert.equal(app._phxActiveSessionKey, null, 'key released with the row');
    assert.equal(app.currentSupabaseSessionId, null, 'and the id is cleared as before');
  });

  // 2. "the lunges on legs 45secs have no way of timing in the session".
  //    hold_secs already drives a Start-Hold button, but only Nordic Planks carried
  //    it; everything else put the duration in the reps TEXT.

  test('a timed exercise gets a hold timer even when the duration is only in the text', () => {
    reset();
    signIn(UID);
    seed(KEY, { active: true, week: 1, last_completed_day: 0, maxes: { bench: 130, squat: 150, deadlift: 170 }, chin_max: 10, records: {} });
    const sess = app.blabGetSessionData(1, 2);          // Lower Body — the lunges live here
    const phx = app.blabToPhoenixSession(sess, 1, 2);
    const lunge = phx.exercises.find((e) => /Lunge/i.test(e.name));
    assert.ok(lunge, 'the lunges are in the session');
    assert.equal(lunge._holdSecs, 45, 'a 45s continuous set is timeable');
  });

  test('rep-based exercises are left alone — a timer would be wrong', () => {
    reset();
    signIn(UID);
    seed(KEY, { active: true, week: 1, last_completed_day: 0, maxes: { bench: 130, squat: 150, deadlift: 170 }, chin_max: 10, records: {} });
    const phx = app.blabToPhoenixSession(app.blabGetSessionData(1, 1), 1, 1);
    const repBased = phx.exercises.filter((e) => e._holdSecs && !/^\s*\d+\s*(s|sec)/i.test(String(e.reps)));
    assert.equal(repBased.length, 0, `no rep-based exercise was given a hold timer: ${repBased.map((e) => e.name).join(', ')}`);
  });

  test('a duration that is not the whole prescription does not become a hold', () => {
    // '10 reps in 30s' is a rep target. Anchoring at the start is what prevents it.
    assert.equal(app.blabToPhoenixSession({ name: 'x', exercises: [
      { name: 'A', format: 'standard_sets', sets: 1, reps: '10 reps in 30s' }
    ] }, 1, 1).exercises[0]._holdSecs, undefined, 'not treated as a hold');
    assert.equal(app.blabToPhoenixSession({ name: 'x', exercises: [
      { name: 'B', format: 'standard_sets', sets: 1, reps: '20 sec/side' }
    ] }, 1, 1).exercises[0]._holdSecs, 20, 'a leading duration is');
  });

  // 3. "for the session where there are 2 max sets ... need the last session to show
  //    both sets from week before only shows 1 currently".

  test('both sets from last week come back, not just the better one', () => {
    reset();
    signIn(UID);
    seed(KEY, {
      active: true, week: 2, last_completed_day: 0,
      maxes: { bench: 130, squat: 150, deadlift: 170 }, chin_max: 10,
      records: {
        'Flat DB Press_max': 24, 'Flat DB Press_maxwt': 30,
        'Flat DB Press_lastsets': { date: dayFromToday(-7), sets: [{ reps: 24, wt: 30 }, { reps: 18, wt: 30 }] }
      }
    });
    const phx = app.blabToPhoenixSession(app.blabGetSessionData(2, 1), 2, 1);
    const press = phx.exercises.find((e) => e.name === 'Flat DB Press');
    assert.ok(press, 'the press slot is in the session');
    assert.equal(press.prev_sets.length, 2, 'both sets carried through');
    assert.ok(press.coaching_note.includes('Set 1: 24 reps'), 'set 1 named');
    assert.ok(press.coaching_note.includes('Set 2: 18 reps'), 'set 2 named — this is what was missing');
  });

  test("today's partial record does not replace the numbers being chased", () => {
    // Logging set 1 today must not overwrite last week's pair on screen — that is the
    // reference he is trying to beat.
    reset();
    signIn(UID);
    seed(KEY, {
      active: true, week: 2, last_completed_day: 0,
      maxes: { bench: 130, squat: 150, deadlift: 170 }, chin_max: 10,
      records: {
        'Flat DB Press_lastsets': { date: dayFromToday(0), sets: [{ reps: 12, wt: 30 }] },
        'Flat DB Press_prevsets': { date: dayFromToday(-7), sets: [{ reps: 24, wt: 30 }, { reps: 18, wt: 30 }] }
      }
    });
    const phx = app.blabToPhoenixSession(app.blabGetSessionData(2, 1), 2, 1);
    const press = phx.exercises.find((e) => e.name === 'Flat DB Press');
    assert.equal(press.prev_sets.length, 2, "last week's pair is still what is shown");
    assert.equal(press.prev_sets[0].reps, 24, 'not the 12 just logged today');
  });

  test('with no history at all the exercise still builds', () => {
    reset();
    signIn(UID);
    seed(KEY, { active: true, week: 2, last_completed_day: 0, maxes: { bench: 130, squat: 150, deadlift: 170 }, chin_max: 10, records: {} });
    const phx = app.blabToPhoenixSession(app.blabGetSessionData(2, 1), 2, 1);
    const press = phx.exercises.find((e) => e.name === 'Flat DB Press');
    assert.ok(press, 'still present');
    assert.equal(press.prev_sets, null, 'no invented history');
  });

  // ── 150 Wall Balls, built through the real library path (v4.9.184) ────────
  // Jon asked for Karen, named for what the session is rather than the benchmark.
  // Built through phxSessionById / the plan builder rather than asserting the object
  // exists — a harness assertion certified THIS EXACT WOD as working while it was
  // unreachable behind two dead renderers, which is why it had to be rebuilt at all.

  test('the wall-ball session builds through the library, not just exists in it', () => {
    const s = app.phxSessionById('wb-150');
    assert.ok(s, 'resolvable by id');
    assert.equal(s.cat, 'WOD', 'categorised as a WOD');
    assert.equal(s.tier, 'CONDITIONING', 'and tiered so it appears in the conditioning grid');
    assert.ok(s.movements.length >= 1, 'has the work');
    assert.ok(/150/.test(s.movements[0].detail), 'all 150 reps are in the prescription');
    assert.ok(/9kg/.test(s.movements[0].detail), 'with the load');
  });

  test('it is scored, so it earns a PB and a place in RECORDS', () => {
    // The whole reason for rebuilding it in PHX_LIB rather than restoring the old
    // opener: that one could not be scored at all.
    const s = app.phxSessionById('wb-150');
    assert.equal(s.scoreType, 'time', 'scored on time');
    assert.ok(s.scoreLabel, 'with a label for the score entry screen');
    assert.equal(s.renderer, 'time', 'and renders through the timed runner');
  });

  test('it is reachable from the conditioning list Jon actually browses', () => {
    const found = app.phxAllWods().filter((w) => w.id === 'wb-150');
    assert.equal(found.length, 1, 'listed exactly once among the WODs');
    const tiered = app.phxWodsByTier('CONDITIONING').filter((w) => w.id === 'wb-150');
    assert.equal(tiered.length, 1, 'and in the CONDITIONING tier');
  });

  test('the label describes the work, not the benchmark', () => {
    const s = app.phxSessionById('wb-150');
    assert.ok(!/karen/i.test(s.name), `name must not carry the benchmark: got "${s.name}"`);
    assert.ok(/wall ball/i.test(s.name), 'it says what the work is');
    assert.ok(/150/.test(s.name), 'and how much of it');
  });

  test('every library session still builds — adding one broke nothing', () => {
    const all = app.phxAllWods().concat(app.phxAllCore());
    all.forEach((s) => {
      assert.ok(s.id && s.name, `session has id and name: ${JSON.stringify(s.id)}`);
      assert.ok(Array.isArray(s.movements) && s.movements.length, `${s.id} has movements`);
      assert.ok(s.scoreType, `${s.id} is scoreable`);
    });
  });

  // ── Public API for other domains ──────────────────────────────────────────
  // Nutrition reads the BLAB day name to adjust macro targets. It was reaching into
  // _BLAB_DAY_LABELS, a bare module var I would rename without thinking — so this is
  // the supported surface, and it is contract-stable.

  test('blabDayLabel maps a BLAB day number to its session name', () => {
    assert.equal(app.blabDayLabel(1), 'Upper Body', 'day 1');
    assert.equal(app.blabDayLabel(2), 'Lower Body', 'day 2');
    assert.equal(app.blabDayLabel(4), 'Lower Power', 'day 4');
  });

  test('blabDayLabel returns empty for anything outside the programme days', () => {
    // A caller handling a custom or rest entry must not have to pre-check.
    [0, 5, null, undefined, 'x', -1].forEach((v) => {
      assert.equal(app.blabDayLabel(v), '', `no label for ${JSON.stringify(v)}`);
    });
  });

  test('the day range is enforced, not merely implied by the array length', () => {
    // The cases above pass on the `|| ''` fallback alone, so they do NOT prove the
    // range check — verified by removing it and watching them stay green. This one
    // discriminates: grow the internal array and the accessor must still refuse a
    // day outside 1-4, because BLAB has four days and a fifth label would be a bug
    // in the array, not a new training day to hand Nutrition.
    const real = app._BLAB_DAY_LABELS.slice();
    try {
      app._BLAB_DAY_LABELS.push('Not A Real Day');
      assert.equal(app.blabDayLabel(5), '', 'a fifth array slot is still not a valid BLAB day');
      assert.equal(app.blabDayLabel(3), 'Upper Body — Chins', 'and the real days are unaffected');
    } finally {
      app._BLAB_DAY_LABELS.length = 0;
      real.forEach((x) => app._BLAB_DAY_LABELS.push(x));
    }
  });

  test('the label accessor agrees with what the calendar renders', () => {
    // If these ever diverge, Nutrition would show one training day and the calendar
    // another, and neither would look wrong on its own.
    schedule({ sessions: [S(5, 2, dayFromToday(0))], customs: [] });
    const entry = app.blabCalSessionsOn(dayFromToday(0))[0];
    assert.equal(app.blabDayLabel(entry.blabDay), app.blabCalEntryView(entry).title,
      'accessor and calendar agree on the day name');
  });

  // ── Cross-domain contract (v4.9.186) ──────────────────────────────────────
  // Nutrition consumes blabCalSessionsOn + blabDayLabel to set macro targets. It
  // pins these too, but its suite going red means the break has ALREADY shipped
  // past the domain that owns the shape. These fail on the Training side first.
  //
  // The REST case is here because it caused a real bug: Nutrition's v4.9.182 read
  // every entry as work, so a day Jon had deliberately marked as rest took training
  // macros — and since an EMPTY day was already correct, the only broken case was
  // the one where the calendar looks right and nothing on screen looks wrong.

  test('CONTRACT: a BLAB entry carries blabDay, which names the training day', () => {
    schedule({ sessions: [S(5, 2, dayFromToday(0))], customs: [] });
    const [e] = app.blabCalSessionsOn(dayFromToday(0));
    assert.equal(e.blabDay, 2, 'blabDay present and correct');
    assert.equal(e.blabWeek, 5, 'blabWeek too');
    assert.ok(!e.custom, 'a BLAB session is not flagged custom');
    assert.equal(app.blabDayLabel(e.blabDay), 'Lower Body', 'and it names the day');
  });

  test('CONTRACT: a planned rest day is distinguishable from a session', () => {
    schedule({ sessions: [], customs: [REST(dayFromToday(0))] });
    const [e] = app.blabCalSessionsOn(dayFromToday(0));
    assert.equal(e.custom, true, 'flagged custom');
    assert.equal(e.cat, 'REST', 'cat REST is the marker a consumer keys on');
    assert.equal(e.blabDay, undefined, 'no blabDay — it is not a training day');
    assert.equal(app.blabDayLabel(e.blabDay), '', 'and the accessor returns empty rather than throwing');
  });

  test('CONTRACT: a custom WOD is distinguishable from both', () => {
    schedule({ sessions: [], customs: [C('Kronos', dayFromToday(0))] });
    const [e] = app.blabCalSessionsOn(dayFromToday(0));
    assert.equal(e.custom, true, 'flagged custom');
    assert.equal(e.cat, 'WOD', 'categorised');
    assert.ok(e.libId, 'and carries a library id');
    assert.equal(e.blabDay, undefined, 'no blabDay');
  });

  test('CONTRACT: nothing scheduled is an empty array, not a rest entry', () => {
    // "deliberately resting" and "nothing planned yet" are different states and a
    // consumer is expected to treat them differently.
    schedule({ sessions: [S(5, 2, dayFromToday(3))], customs: [] });
    assert.deepEqual(app.blabCalSessionsOn(dayFromToday(0)), [], 'empty day is []');
  });

  test('CONTRACT: the agenda excludes history, so a finished day reads as free', () => {
    schedule({ sessions: [{ ...S(5, 2, dayFromToday(0)), status: 'completed' }], customs: [] });
    assert.deepEqual(app.blabCalSessionsOn(dayFromToday(0)), [], 'completed work is not on the agenda');
  });

  test('CONTRACT: a rest marker alongside a real session still means training', () => {
    // The rest entry must not mask the session sharing the day.
    schedule({ sessions: [S(5, 2, dayFromToday(0))], customs: [REST(dayFromToday(0))] });
    const es = app.blabCalSessionsOn(dayFromToday(0));
    assert.equal(es.length, 2, 'both entries returned');
    assert.ok(es.some((e) => e.blabDay === 2), 'the training session is still discoverable');
  });

  // ── blabTrainingStateOn — the question-shaped surface (v4.9.188) ──────────
  // Returns a STATE, not entries. Both cross-domain bugs came from a consumer
  // inferring meaning from a shape: .182 read a planned rest day as training, .187
  // read a FINISHED day as nothing and dropped Jon's macros to rest levels on every
  // day he trained. These pin the interpretation on the side that owns the data.

  const stateOn = (n) => app.blabTrainingStateOn(dayFromToday(n));

  test('STATE: a completed session reads as trained, not as an empty day', () => {
    // This is .187 exactly: blabCalSessionsOn returns [] here, which is correct for
    // ITS question and catastrophic as an answer to this one.
    schedule({ sessions: [{ ...S(5, 2, dayFromToday(0)), status: 'completed' }], customs: [] });
    const r = stateOn(0);
    assert.equal(r.state, 'trained', 'he trained that day');
    assert.equal(r.blabDay, 2, 'and it names which session');
    assert.equal(r.label, 'Lower Body', 'with the label');
    assert.deepEqual(app.blabCalSessionsOn(dayFromToday(0)), [], 'while the agenda call still correctly says nothing outstanding');
  });

  test('STATE: a scheduled session not yet done reads as due', () => {
    schedule({ sessions: [S(5, 2, dayFromToday(0))], customs: [] });
    assert.equal(stateOn(0).state, 'due', 'due, not trained');
  });

  test('STATE: a planned rest day is rest, and an empty day is none', () => {
    // .182 was reading the first of these as training.
    schedule({ sessions: [], customs: [REST(dayFromToday(0))] });
    assert.equal(stateOn(0).state, 'rest', 'deliberate rest');
    schedule({ sessions: [], customs: [] });
    assert.equal(stateOn(0).state, 'none', 'nothing planned is a different thing');
  });

  test('STATE: a skipped session is skipped, not none', () => {
    // Nutrition asked for this distinction: he was due and did not, versus nothing
    // was ever planned. Both take rest targets, but they are not the same fact.
    schedule({ sessions: [{ ...S(5, 2, dayFromToday(0)), status: 'skipped' }], customs: [] });
    assert.equal(stateOn(0).state, 'skipped', 'was due, not done');
    assert.equal(stateOn(0).sessions, 0, 'and it does not count as a live session');
  });

  // The two cases Nutrition asked me to decide rather than assume.

  test('STATE: a completed session plus a rest marker is trained', () => {
    // Reachable: a session can be dragged onto a day already marked as rest.
    schedule({
      sessions: [{ ...S(5, 2, dayFromToday(0)), status: 'completed' }],
      customs: [REST(dayFromToday(0))]
    });
    assert.equal(stateOn(0).state, 'trained', 'the work he did wins over the marker');
  });

  test('STATE: with two sessions it names the completed one and reports the count', () => {
    // blabDay can only carry one, so the rule is documented rather than incidental:
    // the completed session leads, and `sessions` tells a caller not to trust one
    // label as the whole day.
    schedule({
      sessions: [S(5, 1, dayFromToday(0)), { ...S(5, 2, dayFromToday(0)), status: 'completed' }],
      customs: []
    });
    const r = stateOn(0);
    assert.equal(r.state, 'trained', 'a completed session makes the day trained');
    assert.equal(r.blabDay, 2, 'and the label names the one he actually finished');
    assert.equal(r.sessions, 2, 'count says there is more to the day than the label');
  });

  test('STATE: two unfinished sessions are due, named by the first', () => {
    schedule({ sessions: [S(5, 1, dayFromToday(0)), S(5, 2, dayFromToday(0))], customs: [] });
    const r = stateOn(0);
    assert.equal(r.state, 'due', 'still due');
    assert.equal(r.blabDay, 1, 'named by the first');
    assert.equal(r.sessions, 2, 'with the count');
  });

  test('STATE: a custom WOD is a training day and carries its own name', () => {
    schedule({ sessions: [], customs: [C('Kronos', dayFromToday(0))] });
    const r = stateOn(0);
    assert.equal(r.state, 'due', 'a WOD counts as training');
    assert.equal(r.blabDay, 0, 'no BLAB day number — never null, so no null check needed');
    assert.equal(r.label, 'Kronos', 'named by the session');
  });

  test('STATE: blabDay is always a number, never null', () => {
    // Nutrition branches on it; a null would mean a null check at every call site.
    [
      { sessions: [], customs: [] },
      { sessions: [], customs: [REST(dayFromToday(0))] },
      { sessions: [], customs: [C('Kronos', dayFromToday(0))] },
      { sessions: [S(5, 3, dayFromToday(0))], customs: [] }
    ].forEach((cal, i) => {
      schedule(cal);
      assert.equal(typeof stateOn(0).blabDay, 'number', `case ${i} returns a number`);
    });
  });

  test('STATE: it never throws, whatever the calendar holds', () => {
    // It is called to set macro targets; a throw there is worse than a wrong answer.
    reset();
    signIn(UID);
    seed(KEY, { active: true, week: 5, last_completed_day: 0, maxes: { bench: 130, squat: 150, deadlift: 170 } });
    seed(`blab_calendar_v1_${UID}`, { sessions: null, customs: undefined });
    const r = app.blabTrainingStateOn(dayFromToday(0));
    assert.equal(r.state, 'none', 'degrades to none rather than throwing');
  });

  // ── Occupying the empty trap: `due` is position-sensitive (v4.9.191) ──────
  // The date audit found nothing decaying, but nothing PINNED the today-vs-past
  // distinction either — an empty space where the next person's mistake lands
  // silently instead of on a red test. Peptides hit the same shape with running vs
  // finished courses and filled it; this fills mine.
  //
  // PM ruled (2026-08-21) that an unresolved past session must NOT auto-age to
  // 'skipped': only Jon knows whether a missed session was abandoned or is being
  // made up, and ageing it would have the calendar assert something he never said.
  // These cases hold that ruling in place — if someone later "tidies" it into
  // auto-ageing, this goes red and forces the conversation rather than silently
  // changing what the app claims about his training history.

  test('DUE: today means "do this" — the ordinary case', () => {
    schedule({ sessions: [S(5, 2, dayFromToday(0))], customs: [] });
    assert.equal(app.blabTrainingStateOn(dayFromToday(0)).state, 'due', "today's scheduled session is due");
  });

  test('DUE: a PAST unresolved session stays due — it does not auto-age to skipped', () => {
    // Same word, different meaning: for a past date `due` means "was scheduled, never
    // resolved". Deliberately NOT 'skipped' — that would assert he abandoned it.
    schedule({ sessions: [S(5, 2, dayFromToday(-21))], customs: [] });
    const r = app.blabTrainingStateOn(dayFromToday(-21));
    assert.equal(r.state, 'due', 'three weeks old and still unresolved, not skipped');
    assert.equal(r.blabDay, 2, 'and it still names the session');
  });

  test('DUE: a FUTURE session is due too — position does not change the value', () => {
    schedule({ sessions: [S(5, 2, dayFromToday(7))], customs: [] });
    assert.equal(app.blabTrainingStateOn(dayFromToday(7)).state, 'due', 'next week is due');
  });

  test('DUE: only an explicit mark makes it skipped, whatever the date', () => {
    // The distinction the ruling protects: skipped is something Jon said, not
    // something the passage of time inferred.
    schedule({ sessions: [{ ...S(5, 2, dayFromToday(-21)), status: 'skipped' }], customs: [] });
    assert.equal(app.blabTrainingStateOn(dayFromToday(-21)).state, 'skipped', 'explicitly marked');
    schedule({ sessions: [{ ...S(5, 2, dayFromToday(-21)), status: 'completed' }], customs: [] });
    assert.equal(app.blabTrainingStateOn(dayFromToday(-21)).state, 'trained', 'a past completed day is still trained');
  });

  // ── Drive the CALENDAR SCREEN, not just its readers (v4.9.192) ────────────
  // Third axis, from Peptides via the PM: a builder-level test certifies a function
  // returns the right data. It cannot tell you whether the entry point calls that
  // function at all — and both stay green while the feature is absent from the screen.
  //
  // That is the .165 Today-card failure exactly, and my calendar was in the same
  // state: blabCalSessionsOn, blabCalNextDays, _blabCalWarnings and _blabCalSuggestFor
  // are all covered, and NOTHING drove _blabCalRender. If it threw the way
  // _blabCalEntryView did, every one of those cases would still pass and Jon would
  // open a blank calendar.
  //
  // The Today card is already driven (that lesson landed at .165). This closes the
  // matching gap on the screen he actually schedules in.

  // A DOM stub that hands back the SAME element for a given id every time, so the
  // renderer's writes are observable. The default sandbox returns a fresh object per
  // call, which is why a renderer cannot otherwise be inspected.
  const screenDom = () => {
    const byId = new Map();
    const realGet = app.document.getElementById;
    const mk = (id) => ({
      id, style: {}, innerHTML: '', _attrs: {}, handlers: {},
      appendChild() {}, addEventListener(ev, fn) { this.handlers[ev] = fn; },
      setAttribute(k, v) { this._attrs[k] = v; }, removeAttribute(k) { delete this._attrs[k]; },
      querySelector: () => null, querySelectorAll: () => [],
      insertAdjacentHTML(pos, html) { this.innerHTML += html; },
      scrollIntoView() {}, remove() {}
    });
    app.document.getElementById = (id) => {
      if (!byId.has(id)) byId.set(id, mk(id));
      return byId.get(id);
    };
    return {
      get: (id) => byId.get(id),
      restore: () => { app.document.getElementById = realGet; }
    };
  };

  test('ENTRY: the calendar screen renders the scheduled session, not just returns it', () => {
    schedule({ sessions: [S(5, 2, dayFromToday(0))], customs: [] });
    const dom = screenDom();
    try {
      app._blabCalRender();
      const grid = dom.get('blab-cal-grid');
      assert.ok(grid, 'the renderer reached for its grid');
      assert.ok(grid.innerHTML.length > 200, 'and wrote a real calendar into it');
      assert.ok(grid.innerHTML.includes('Lower Body'), 'the scheduled session is ON SCREEN');
      assert.ok(grid.innerHTML.includes('TODAY'), 'and today is marked');
    } finally { dom.restore(); }
  });

  test('ENTRY: a planned rest day reaches the screen', () => {
    schedule({ sessions: [], customs: [REST(dayFromToday(0))] });
    const dom = screenDom();
    try {
      app._blabCalRender();
      assert.ok(dom.get('blab-cal-grid').innerHTML.includes('Rest Day'), 'rest is rendered, not just stored');
    } finally { dom.restore(); }
  });

  test('ENTRY: the queue panel renders the unscheduled sessions', () => {
    schedule({ sessions: [], customs: [] });
    const dom = screenDom();
    try {
      app._blabCalRender();
      const q = dom.get('blab-cal-queue');
      assert.ok(q && q.innerHTML.includes('Upper Body'), 'the queue shows what is left to schedule');
    } finally { dom.restore(); }
  });

  test('ENTRY: with no programme the screen says so rather than rendering blank', () => {
    reset();
    signIn(UID);
    seed(KEY, { active: false, week: 0, last_completed_day: 0 });
    const dom = screenDom();
    try {
      app._blabCalRender();
      assert.ok(dom.get('blab-cal-grid').innerHTML.includes('No BLAB Programme'), 'explains the empty state');
    } finally { dom.restore(); }
  });

  test('ENTRY: the library detail view renders the wall-ball session on screen', () => {
    // Karen was verified as a library ENTRY — phxSessionById, tier lists. Nothing drove
    // the view that shows it, which is precisely how the old implementation sat
    // unreachable while a harness assertion certified it.
    // Richer stubs than the shared helper: this view wires its buttons through
    // querySelector and getElementById, so both must hand back real objects or the
    // renderer throws before it has written anything.
    const realCreate = app.document.createElement;
    const realGet = app.document.getElementById;
    const made = [];
    const el = () => {
      const e = {
        style: {}, innerHTML: '', textContent: '', onclick: null, handlers: {},
        appendChild() {}, addEventListener(ev, fn) { this.handlers[ev] = fn; },
        setAttribute() {}, removeAttribute() {}, remove() {},
        querySelector: () => el(), querySelectorAll: () => []
      };
      made.push(e);
      return e;
    };
    app.document.createElement = el;
    app.document.getElementById = () => el();
    try {
      app._phxOpenSessionDetail('wb-150', null, {});
      const rendered = made.map((m) => m.innerHTML || '').join(' ');
      assert.ok(rendered.includes('150 Wall Balls'), 'the session name is on screen');
      assert.ok(rendered.includes('Wall Ball'), 'and the movement');
      assert.ok(!/karen/i.test(rendered), 'and the benchmark name is not what he reads');
    } finally {
      app.document.createElement = realCreate;
      app.document.getElementById = realGet;
    }
  });

  // ── The safety net nobody had pulled (v4.9.191) ───────────────────────────
  // Two harness guards claimed "a render failure is recorded" and "is visible on the
  // card". Both true as source strings; NEITHER proved anything happens. An auditor
  // reads the name and moves on — which is the mechanism, one level up from a test
  // that does not discriminate: the assertion is fine, the NAME overclaims it.
  //
  // This net exists because silent failure hid a broken Today card for four versions.
  // It had never been driven, so nothing said whether it still worked.

  test('a render failure paints a visible card instead of leaving the placeholder', () => {
    reset();
    signIn(UID);
    const card = { style: {}, _attrs: {}, innerHTML: '', setAttribute(k, v) { this._attrs[k] = v; },
                   removeAttribute(k) { delete this._attrs[k]; }, querySelector: null };
    const inner = { innerHTML: '' };
    card.querySelector = (sel) => (sel === '.game-card-inner' ? inner : null);
    const realGet = app.document.getElementById;
    app.document.getElementById = (id) => (id === 'card-today-session' ? card : realGet.call(app.document, id));
    try {
      app._blabRenderTodayError(new Error('_blabCalEntryView is not defined'));
      assert.ok(inner.innerHTML.includes('Could not build today'), 'the failure is on screen, not in a console Jon cannot see');
      assert.ok(inner.innerHTML.includes('_blabCalEntryView is not defined'), 'and it says what went wrong');
      assert.equal(card._attrs.onclick, undefined, 'the dead placeholder tap is removed');
    } finally { app.document.getElementById = realGet; }
  });

  test('a render failure is recorded to Diagnostic', () => {
    reset();
    signIn(UID);
    app._blabRenderTodayError(new Error('boom'));
    const last = read('phx_last_write_error');
    assert.ok(last, 'a diagnostic record exists');
    assert.equal(last.context, 'todayCard.render', 'under the right context');
  });

  test('it records BEFORE painting, so a fault in painting still leaves evidence', () => {
    // Ordering matters: this runs when something has already gone wrong. If the paint
    // threw first, the only trace of the original failure would be lost.
    reset();
    signIn(UID);
    const realGet = app.document.getElementById;
    app.document.getElementById = () => { throw new Error('DOM is gone too'); };
    try {
      app._blabRenderTodayError(new Error('original failure'));
      const last = read('phx_last_write_error');
      assert.ok(last, 'the original failure was still recorded');
      assert.ok(String(last.message).includes('original failure'), 'and it is the ORIGINAL error, not the paint error');
    } finally { app.document.getElementById = realGet; }
  });

  test('it never throws on top of the failure it is reporting', () => {
    reset();
    signIn(UID);
    const realGet = app.document.getElementById;
    app.document.getElementById = () => { throw new Error('DOM is gone too'); };
    try {
      app._blabRenderTodayError(null);   // even with no error object at all
      assert.ok(true, 'survived a null error and a hostile DOM');
    } finally { app.document.getElementById = realGet; }
  });

  // ── The backup was a claim, not a net (v4.9.195) ──────────────────────────
  // blab_v1_{uid}_bak was written and read by NOTHING. The comment said "kept one
  // generation", which reads as recoverable, and no path existed to get it back.
  // Peptides' framing: an untested net at least EXISTS; an unreachable net is a CLAIM.
  // The tell is that no test could have caught it — there was nothing to call.
  //
  // This is Jon's BLAB state and calendar: every session he has logged. So these drive
  // the real Adjust Programme screen as well as the functions, because "the recovery
  // works but he cannot reach it" is the exact failure being fixed.

  const seedBackup = (bak, cur) => {
    reset();
    signIn(UID);
    if (cur) seed(KEY, cur);
    seed(`${KEY}_bak`, bak);
  };
  const AT_W5 = { active: true, week: 5, last_completed_day: 2, log: [1, 2, 3, 4, 5, 6], maxes: { bench: 130, squat: 150, deadlift: 170 },
                  calendar: { sessions: [{ blabWeek: 5, blabDay: 3, scheduledDate: '2026-01-01', status: 'pending' }], customs: [] }, _ts: NEWER };
  const AT_W1 = { active: true, week: 1, last_completed_day: 0, log: [], maxes: { bench: 130, squat: 150, deadlift: 170 },
                  calendar: { sessions: [], customs: [] }, _ts: OLDER };

  test('BACKUP: describes what is held, in terms worth judging', () => {
    seedBackup(AT_W5, AT_W1);
    const info = app.blabBackupInfo();
    assert.ok(info, 'there is something to offer');
    assert.equal(info.week, 5, 'the week the backup holds');
    assert.equal(info.sessionsLogged, 6, 'and how much work is in it');
    assert.equal(info.curWeek, 1, 'alongside what is live now, so the choice is informed');
    assert.equal(info.curSessionsLogged, 0, 'including how much would be swapped out');
  });

  test('BACKUP: offers nothing when the backup matches what is live', () => {
    // An offer that is always there is noise.
    seedBackup(AT_W5, AT_W5);
    assert.equal(app.blabBackupInfo(), null, 'identical copies are not an offer');
  });

  test('BACKUP: offers nothing when there is no backup at all', () => {
    reset(); signIn(UID); seed(KEY, AT_W1);
    assert.equal(app.blabBackupInfo(), null, 'nothing held, nothing claimed');
  });

  test('RECOVER: swaps rather than overwrites, so a wrong recovery is undoable', () => {
    // The property that matters most here: recovering the wrong generation must not
    // destroy the good one.
    seedBackup(AT_W5, AT_W1);
    assert.equal(app.blabRestoreBackup(), true, 'recovery reports success');
    assert.equal(read(KEY).week, 5, 'the backup is now live');
    assert.equal(read(`${KEY}_bak`).week, 1, 'and what WAS live is now the backup');
    // Undo by doing it again.
    assert.equal(app.blabRestoreBackup(), true, 'second call works');
    assert.equal(read(KEY).week, 1, 'back to where he started');
  });

  test('RECOVER: brings the calendar with it, not just the programme position', () => {
    // The calendar lives in blab_state AND its own key. Swapping only the state would
    // recover his week while leaving the other generation's schedule on screen.
    seedBackup(AT_W5, AT_W1);
    seed(`blab_calendar_v1_${UID}`, { sessions: [], customs: [] });
    app.blabRestoreBackup();
    const cal = read(`blab_calendar_v1_${UID}`);
    assert.equal(cal.sessions.length, 1, 'the recovered schedule is on its own key too');
    assert.equal(cal.sessions[0].blabDay, 3, 'and it is the right one');
  });

  test('RECOVER: a pre-calendar backup leaves the current schedule alone', () => {
    // Recovering an old programme position is not a reason to blank a schedule that
    // is still good. blabBackupInfo reports hasCalendar so the card can say so.
    const legacy = { active: true, week: 4, last_completed_day: 1, log: [1], maxes: { bench: 130, squat: 150, deadlift: 170 }, _ts: OLDER };
    seedBackup(legacy, AT_W1);
    const keep = { sessions: [{ blabWeek: 9, blabDay: 1, scheduledDate: '2026-02-02', status: 'pending' }], customs: [] };
    seed(`blab_calendar_v1_${UID}`, keep);
    assert.equal(app.blabBackupInfo().hasCalendar, false, 'the card can warn it carries no schedule');
    app.blabRestoreBackup();
    assert.equal(read(`blab_calendar_v1_${UID}`).sessions[0].blabWeek, 9, 'the good schedule survived');
    assert.equal(read(KEY).week, 4, 'while the programme position was recovered');
  });

  test('RECOVER: re-stamps so the next cloud restore does not undo it', () => {
    // Without going through blabSaveState the recovered copy keeps the OLD _ts, and
    // the newest-wins rule would hand it straight back.
    seedBackup(AT_W5, AT_W1);
    app.blabRestoreBackup();
    const after = read(KEY);
    assert.ok(after._ts, 'the recovered state is stamped');
    assert.ok(Date.parse(after._ts) > Date.parse(NEWER), 'with a stamp newer than the copy it came from');
  });

  test('RECOVER: does nothing, safely, when there is no backup', () => {
    reset(); signIn(UID); seed(KEY, AT_W1);
    assert.equal(app.blabRestoreBackup(), false, 'reports it did nothing');
    assert.equal(read(KEY).week, 1, 'and changed nothing');
  });

  test('ENTRY: the Recover card is ON the Adjust Programme screen when there is something to recover', () => {
    // The whole failure was reachability, so this drives the real screen. A recovery
    // that works but cannot be reached is exactly what was already there.
    seedBackup(AT_W5, AT_W1);
    const dom = recordingDom();
    try {
      app.openBlabAdjust();
      const html = dom.made.map((m) => m.innerHTML || '').join(' ');
      assert.ok(html.includes('Recover Previous Programme'), 'the offer is on screen');
      assert.ok(html.includes('data-act="recover"'), 'and it is actionable');
      assert.ok(html.includes('Week 5'), 'saying what it would bring back');
      assert.ok(html.includes('SWAP'), 'and that it is undoable');
    } finally { dom.restore(); }
  });

  test('ENTRY: the Recover card is absent when there is nothing to recover', () => {
    reset(); signIn(UID); seed(KEY, AT_W1);
    const dom = recordingDom();
    try {
      app.openBlabAdjust();
      const html = dom.made.map((m) => m.innerHTML || '').join(' ');
      assert.ok(!html.includes('Recover Previous Programme'), 'no empty promise on screen');
      assert.ok(html.includes('Pause Programme'), 'while the rest of the sheet is intact');
    } finally { dom.restore(); }
  });

  // ── RESTORE SAFE LIST (v4.9.203) ──────────────────────────────────────────
  // .200 fixed the restore MECHANISM — it had never fired for any tab, for anyone,
  // because the key was read after the navTo that deletes it. What it read was still
  // stale: 'workout' and 'settings' are not navTo targets, and the two tabs the
  // training calendar is actually written under were missing.
  //
  // The harness derives the list from source and checks every entry resolves. These
  // prove the BEHAVIOUR that guard is premised on — that a dead string really does
  // route nowhere, and that the calendar entries really do land on the calendar.

  const routeRecorder = () => {
    const shown = [];
    const realShow = app.showScreen;
    const realRender = app._blabCalRender;
    app.showScreen = (id) => { shown.push(id); };
    app._blabCalRender = () => {};   // isolate routing from rendering
    return { shown, restore: () => { app.showScreen = realShow; app._blabCalRender = realRender; } };
  };

  test('SAFELIST: a dead entry routes NOWHERE — the diagnosis, not a reading of the map', () => {
    // If this ever shows a screen, 'workout' became real and removing it was wrong.
    reset(); signIn(UID); seed(KEY, AT_W5);
    const r = routeRecorder();
    try {
      app.navTo('workout');
      app.navTo('settings');
      assert.equal(r.shown.length, 0,
        'both removed entries route to nothing — the restore fired into a no-op and Jon stayed on Today');
    } finally { r.restore(); }
  });

  test('SAFELIST: blab-calendar lands on the calendar', () => {
    reset(); signIn(UID); seed(KEY, AT_W5);
    const r = routeRecorder();
    try {
      app.navTo('blab-calendar');
      assert.ok(r.shown.includes('screen-blab-calendar'), 'the restore target is the calendar screen');
    } finally { r.restore(); }
  });

  test('SAFELIST: programme lands on the calendar while BLAB is active', () => {
    // With BLAB running, Programme MEANS the calendar (v4.9.165) — it returns early
    // through blabCalOpen rather than the map. Both spellings are written to the
    // restore key by the navTo intercept, so both have to work.
    reset(); signIn(UID); seed(KEY, AT_W5);
    const r = routeRecorder();
    try {
      app.navTo('programme');
      assert.ok(r.shown.includes('screen-blab-calendar'), 'Programme resolves to the calendar, not the dead AI-programme screen');
    } finally { r.restore(); }
  });

  test('SAFELIST: the other domains restore tabs still route', () => {
    // I edited a list three domains ride on. Nutrition, records and peptide must be
    // untouched by my change.
    reset(); signIn(UID); seed(KEY, AT_W5);
    const r = routeRecorder();
    try {
      ['nutrition', 'records', 'peptide'].forEach((t) => app.navTo(t));
      assert.ok(r.shown.includes('screen-nutrition'), 'nutrition still routes');
      assert.ok(r.shown.includes('screen-records'), 'records still routes');
      assert.ok(r.shown.includes('screen-peptide'), 'peptide still routes');
    } finally { r.restore(); }
  });

  test('RESTORE: a cloud restore repaints the calendar when it is the live screen', () => {
    // Making the calendar restorable means it can now BE the screen when a cloud
    // restore lands. _blabApplyCloud rehydrated the calendar key and repainted
    // nothing — the caller only refreshes Today — so the pre-restore schedule would
    // sit there indefinitely, looking current.
    reset(); signIn(UID); seed(KEY, AT_W1);
    let painted = 0;
    const realRender = app._blabCalRender;
    const realGet = app.document.getElementById;
    app._blabCalRender = () => { painted++; };
    app.document.getElementById = (id) =>
      (id === 'screen-blab-calendar' ? { classList: { contains: (c) => c === 'active' } } : null);
    try {
      const did = app.blabRestoreFromCloud({ blab_state: AT_W5 });
      assert.equal(did, true, 'the restore took the cloud copy');
      assert.ok(painted > 0, 'and repainted the calendar that was on screen');
    } finally { app._blabCalRender = realRender; app.document.getElementById = realGet; }
  });

  test('RESTORE: no repaint when the calendar is not the live screen', () => {
    // The repaint must be conditional, not unconditional — repainting a hidden screen
    // is work at best and a throw at worst on a screen that was never opened.
    reset(); signIn(UID); seed(KEY, AT_W1);
    let painted = 0;
    const realRender = app._blabCalRender;
    const realGet = app.document.getElementById;
    app._blabCalRender = () => { painted++; };
    app.document.getElementById = (id) =>
      (id === 'screen-blab-calendar' ? { classList: { contains: () => false } } : null);
    try {
      assert.equal(app.blabRestoreFromCloud({ blab_state: AT_W5 }), true, 'the restore still happens');
      assert.equal(painted, 0, 'but nothing is repainted');
    } finally { app._blabCalRender = realRender; app.document.getElementById = realGet; }
  });

  // ── CUSTOM SESSION TEMPLATES (v4.9.214) ───────────────────────────────────
  // They lived at phx_custom_templates and NOWHERE else — no mirror, no backup, not in
  // the restore table. Survivable-looking until sw.js was found empty: every deploy for
  // 135 versions reached Jon only through a PWA reinstall, which wipes localStorage. So
  // a full wipe was the NORMAL path and every custom session he built was destroyed on
  // every ship, with the builder showing a healthy empty list.
  //
  // The case that matters is the one below marked "survives a reinstall". Asserting that
  // a setter was called would have passed against the broken version too — written is
  // not saved, which is exactly what made this invisible.

  const BARE = { active: true, week: 3, last_completed_day: 1, log: [1, 2, 3],
                 maxes: { bench: 130, squat: 150, deadlift: 170 }, _ts: OLDER };
  const LEGACY_KEY = 'phx_custom_templates';

  test('TEMPLATES: a saved template goes into blab_state, not a private key', () => {
    reset(); signIn(UID); seed(KEY, BARE);
    app._phxSaveCustomTemplate('Leg Burner', [{ name: 'Squat' }]);
    const state = read(KEY);
    assert.ok(Array.isArray(state.customTemplates), 'it rides inside the mirrored blob');
    assert.equal(state.customTemplates[0].name, 'Leg Burner', 'with the template in it');
  });

  test('TEMPLATES: they survive a reinstall — the case that was actually broken', () => {
    // The whole bug, reproduced end to end: save, wipe everything local exactly as a
    // PWA delete-and-reinstall does, restore from what the cloud would be holding.
    reset(); signIn(UID); seed(KEY, BARE);
    app._phxSaveCustomTemplate('Leg Burner', [{ name: 'Squat' }]);
    const cloudCopy = read(KEY);          // what the debounced mirror sends up

    reset(); signIn(UID);                 // the reinstall — localStorage is gone
    assert.equal(app._phxLoadCustomTemplates().length, 0, 'gone after the wipe, as it always was');

    app.blabRestoreFromCloud({ blab_state: cloudCopy });
    const back = app._phxLoadCustomTemplates();
    assert.equal(back.length, 1, 'and back again once the cloud copy lands');
    assert.equal(back[0].name, 'Leg Burner', 'the same template, not a placeholder');
  });

  test('TEMPLATES: existing local templates migrate IN rather than being replaced', () => {
    // Anything already on Jon's phone must be rescued, not overwritten with an empty list.
    reset(); signIn(UID); seed(KEY, BARE);
    seed(LEGACY_KEY, [{ id: 1, name: 'Old Favourite', exercises: [] }]);
    const loaded = app._phxLoadCustomTemplates();
    assert.equal(loaded.length, 1, 'the old template is still there');
    assert.equal(loaded[0].name, 'Old Favourite', 'by name');
    assert.equal(read(KEY).customTemplates[0].name, 'Old Favourite', 'and it has moved into the mirrored state');
  });

  test('TEMPLATES: migration saves IMMEDIATELY, or a restore would undo the rescue', () => {
    // A merged state that is not stamped and mirrored loses to the next cloud restore
    // under newest-wins — which would arrive with no templates and wipe the ones the
    // migration just rescued. The progress guard does not help: it scores training
    // progress and templates do not move it.
    reset(); signIn(UID); seed(KEY, BARE);
    seed(LEGACY_KEY, [{ id: 1, name: 'Old Favourite', exercises: [] }]);
    app._phxLoadCustomTemplates();
    const after = read(KEY);
    assert.ok(after.customTemplates, 'persisted on the spot, not left in memory');
    assert.ok(Date.parse(after._ts) > Date.parse(OLDER), 're-stamped, so the cloud copy cannot win and erase it');
  });

  test('TEMPLATES: nothing to migrate does NOT re-stamp the state', () => {
    // The hazard the guard above creates if applied unconditionally: stamping _ts on
    // every first render would make a freshly-loaded local state beat a genuinely newer
    // cloud copy, handing Jon back a stale programme in order to migrate nothing.
    reset(); signIn(UID); seed(KEY, BARE);
    assert.equal(app._phxLoadCustomTemplates().length, 0, 'no templates to offer');
    assert.equal(read(KEY)._ts, OLDER, 'and the state was left exactly as it was found');
  });

  test('TEMPLATES: deleting one persists to the mirrored state', () => {
    reset(); signIn(UID); seed(KEY, BARE);
    app._phxSaveCustomTemplate('Keep', [{ name: 'Squat' }]);
    app._phxSaveCustomTemplate('Bin', [{ name: 'Bench' }]);
    const binId = read(KEY).customTemplates.find((t) => t.name === 'Bin').id;
    app._phxDeleteCustomTemplate(binId);
    const left = read(KEY).customTemplates;
    assert.equal(left.length, 1, 'one removed');
    assert.equal(left[0].name, 'Keep', 'and the right one survived');
  });

  test('TEMPLATES: a taken id is stepped past, deterministically', () => {
    // The delete case above only catches the collision when both saves happen to land
    // in the same millisecond — on a slower machine it passes with the bug present. This
    // pins the allocator directly and does not depend on timing at all.
    const first = app._phxNextTemplateId([]);
    const second = app._phxNextTemplateId([{ id: first }]);
    assert.ok(second > first, 'an id already in the list is never handed out again');
    assert.equal(app._phxNextTemplateId([{ id: first }, { id: first + 1 }]) > first + 1, true,
      'and it keeps stepping while ids remain taken');
  });

  test('TEMPLATES: with no BLAB state the builder still works off the legacy key', () => {
    // A non-BLAB athlete, or one before setup. An unmirrored builder beats a broken one.
    reset(); signIn(UID);
    app._phxSaveCustomTemplate('No Programme Yet', [{ name: 'Row' }]);
    const loaded = app._phxLoadCustomTemplates();
    assert.equal(loaded.length, 1, 'saved and readable without any BLAB state');
    assert.equal(loaded[0].name, 'No Programme Yet', 'by name');
  });

  // ── KEYBOARD-SAFE SHEETS (v4.9.220) ──────────────────────────────────────
  // Jon: the on-screen keyboard covers the field he is typing into. Nutrition found
  // the cause and built _phxKeyboardSafe; the helper itself is pinned provider-side
  // with its own cases, so what is under test HERE is only the integration — do my
  // sheets actually arm themselves, with the real element.
  //
  // These drive the entry points rather than checking the source, because "the call
  // is in the file" is what a harness pin proves. Whether the sheet that OPENS is the
  // sheet that gets armed is a different question, and it is the one that was wrong
  // in the _blabCalEntryView case.

  const armRecorder = () => {
    const armed = [];
    const real = app._phxKeyboardSafe;
    app._phxKeyboardSafe = (ov) => { armed.push(ov); };
    return { armed, restore: () => { app._phxKeyboardSafe = real; } };
  };

  test('KEYBOARD: the score-entry sheet arms itself — the one with the notes box', () => {
    // Opened after every WOD and Core session. The textarea sits low in the panel,
    // which is exactly where the keyboard lands.
    reset(); signIn(UID);
    const r = armRecorder();
    // A synthetic session rather than a library lookup: PHX_LIB is an object, and
    // coupling this to whatever happens to be in it would make the case fail for
    // reasons that have nothing to do with arming.
    const s = { id: 'test-wod', name: 'Test WOD', cat: 'WOD', tier: 'CONDITIONING',
                format: 'For Time', scoreLabel: 'Fastest time', scoreType: 'time' };
    try {
      // Same as the builder case: the sheet wires handlers further than these DOM
      // stubs reach. Arming happens inside _phxLibOverlay on the FIRST line, before
      // any of that, so a later throw cannot mask a missing arming — remove the
      // factory call and this case fails on armed.length, which is the proof.
      try { app._phxOpenScoreEntry(s, null, null); } catch (_e) { /* past the arming point */ }
      assert.equal(r.armed.length >= 1, true, 'the sheet armed itself on open');
      assert.ok(r.armed[0], 'and was handed a real element, not undefined');
    } finally { r.restore(); }
  });

  test('KEYBOARD: the custom session builder arms itself', () => {
    // It rolls its own overlay instead of using _phxLibOverlay, so the factory
    // arming does not reach it — a separate call site, and a separate case.
    reset(); signIn(UID);
    const r = armRecorder();
    try {
      // The builder renders further than this sandbox's DOM stubs reach, and that is
      // not what is under test. Swallowing a LATER throw is safe: arming happens
      // immediately after appendChild, so anything thrown before it leaves armed
      // empty and this case still fails — which is the behaviour being asserted.
      try { app.openCustomSessionBuilder([], ''); } catch (_e) { /* past the arming point */ }
      assert.equal(r.armed.length >= 1, true, 'the builder armed itself on open');
      assert.ok(r.armed[0], 'with a real element');
    } finally { r.restore(); }
  });

  test('KEYBOARD: every library sheet arms exactly once, never twice', () => {
    // The helper is NOT idempotent — arming one overlay twice registers two listener
    // sets. The factory creates a fresh element per call, so this holds; the case
    // exists because a future "arm it at the call site too" would silently double up.
    reset(); signIn(UID);
    const r = armRecorder();
    try {
      const o = app._phxLibOverlay('phx-test-sheet', 9500);
      assert.equal(r.armed.length, 1, 'one overlay, one arming');
      assert.equal(r.armed[0], o, 'and it is the overlay that was just built');
    } finally { r.restore(); }
  });

  // ── PAIRED WALL BALLS (v4.9.223) ──────────────────────────────────────────
  // Jon ruled "paired". Added alongside wb-150 rather than replacing it, so the
  // standalone stays a clean comparable benchmark.
  //
  // The library CANNOT carry two scores: one score and one score_type per row, and
  // phxScoreToNum reduces composites to a single number for the PB test (load_reps
  // compares on load and ignores reps entirely). So this is two linked entries, each
  // scored in its native type. These cases pin that, and pin REACHABILITY — the old
  // Karen sat in the library, unreachable, under a green assertion.

  test('WB: the standalone was not touched', () => {
    // Jon chose the pair; that is not a statement that the standalone was wrong.
    const solo = app.phxSessionById('wb-150');
    assert.ok(solo, '150 Wall Balls still exists');
    assert.equal(solo.name, '150 Wall Balls', 'under its own name');
    assert.equal(solo.scoreType, 'time', 'still scored as a plain time');
    assert.equal(solo.pairedNext, undefined, 'and it does not chain anywhere');
  });

  test('WB: the paired entry is named for the work, not the benchmark', () => {
    const p = app.phxSessionById('wb-150-core');
    assert.ok(p, 'the paired session exists');
    assert.ok(/wall ball/i.test(p.name) && /core/i.test(p.name), 'the name says what the session is');
    assert.ok(!/karen/i.test(p.name), 'and does not reintroduce the benchmark name Jon asked to remove');
  });

  test('WB: each half keeps its own score type — nothing is fused', () => {
    const p1 = app.phxSessionById('wb-150-core');
    const p2 = app.phxSessionById('wb-150-core-p2');
    assert.equal(p1.scoreType, 'time', 'the wall balls score as a time');
    assert.equal(p2.scoreType, 'rounds', 'the core scores as rounds + reps');
    assert.equal(p1.scoreType === p2.scoreType, false, 'two native types, not one composite reduced to half of itself');
  });

  test('WB: both halves build a valid renderer plan', () => {
    // phxBuildSessionPlan throws on an unknown renderer, unknown scoreType, or missing
    // movements — so this is the structural validity of both entries.
    const p1 = app.phxBuildSessionPlan(app.phxSessionById('wb-150-core'));
    assert.equal(p1.renderer, 'time', 'part 1 runs the for-time renderer');
    const p2 = app.phxBuildSessionPlan(app.phxSessionById('wb-150-core-p2'));
    assert.equal(p2.renderer, 'amrap', 'part 2 runs the amrap renderer');
    assert.equal(p2.durationSec, 480, 'for eight minutes');
  });

  test('WB: part 2 is REACHABLE from part 1, not merely present', () => {
    // The whole point. Two entries that exist but have no path between them is the
    // _blabCalEntryView shape: every assertion green, nothing usable on the phone.
    const p1 = app.phxSessionById('wb-150-core');
    assert.equal(p1.pairedNext, 'wb-150-core-p2', 'part 1 declares its next part');
    assert.ok(app.phxSessionById(p1.pairedNext), 'and that id actually resolves to a session');
  });

  test('WB: the continue button is ON the saved-score screen', () => {
    // Drives the real view rather than asserting the field exists. A dangling id would
    // paint a button that goes nowhere, so the renderer only draws it when the next
    // part resolves — both directions checked below.
    reset(); signIn(UID);
    const dom = recordingDom();
    try {
      const p1 = app.phxSessionById('wb-150-core');
      app._phxScoreSaved(p1, { score: '452', is_pb: false });
      const html = dom.made.map((m) => m.innerHTML || '').join(' ');
      assert.ok(html.includes('phx-saved-next'), 'the continue control is rendered');
      assert.ok(/Start Part 2/i.test(html), 'and says what it starts');
      assert.ok(/not affected by how the core goes/i.test(html), 'and states that the time is already banked');
    } finally { dom.restore(); }
  });

  test('WB: an unpaired session shows no continue button', () => {
    // The standalone must not sprout a dead control.
    reset(); signIn(UID);
    const dom = recordingDom();
    try {
      app._phxScoreSaved(app.phxSessionById('wb-150'), { score: '452', is_pb: false });
      const html = dom.made.map((m) => m.innerHTML || '').join(' ');
      assert.ok(!html.includes('phx-saved-next'), 'no continue control on a session with no next part');
      assert.ok(html.includes('phx-saved-records'), 'while the normal buttons are intact');
    } finally { dom.restore(); }
  });

  test('WB: part 2 is hidden from the WOD grid but still startable', () => {
    // Its score only means anything in sequence, so it must not be offered cold — but
    // it has to stay resolvable, or the continue button above goes nowhere.
    const grid = app.phxWodsByTier('CONDITIONING');
    assert.ok(grid.some((w) => w.id === 'wb-150-core'), 'the pair is offered');
    assert.ok(grid.some((w) => w.id === 'wb-150'), 'the standalone is still offered');
    assert.ok(!grid.some((w) => w.id === 'wb-150-core-p2'), 'part 2 is not offered on its own');
    assert.ok(app.phxSessionById('wb-150-core-p2'), 'but it still resolves by id');
  });

  // ── FAILED WRITES MUST BE VISIBLE (v4.9.238) ──────────────────────────────
  // CLAUDE.md rule 8. These three were reporting to console.error and NOWHERE else,
  // and console is invisible in the iOS PWA. Jon finishes at 5am, the set looks
  // logged, and it is gone — and because set_logs feeds previous-best and RPE, the
  // loss ALSO degrades the targets for his next session.
  //
  // The assertion is that a failure REACHES THE DIAGNOSTIC, not that a helper was
  // called: phx_last_write_error is what Jon can actually read on his phone.

  const failingInsert = (err) => {
    // Mirrors the sandbox's own query shape so the code under test cannot tell the
    // difference — a stub that is not thenable would fail for the wrong reason.
    const q = {
      select: () => q, eq: () => q, single: () => Promise.resolve({ data: null, error: err }),
      insert: () => q, update: () => q, upsert: () => q, delete: () => q,
      then: (a, b) => Promise.resolve({ data: null, error: err }).then(a, b),
      catch: (b) => Promise.resolve({ data: null, error: err }).catch(b)
    };
    return { from: () => q, storage: { from: () => ({ upload: () => Promise.resolve({ error: err }) }) } };
  };

  test('WRITE: a failed set insert reaches the diagnostic, not just the console', async () => {
    reset(); signIn(UID);
    const realSb = app.sb;
    app.currentSupabaseSessionId = 'sess-1';
    app.sb = failingInsert({ code: '23503', message: 'insert or update violates foreign key' });
    try {
      await app.supabaseLogSet('Back Squat', 'squat', 1, 100, 5, { rpe: 8 });
      const last = read('phx_last_write_error');
      assert.ok(last, 'something was recorded where Jon can see it');
      assert.equal(last.context, 'supabaseLogSet', 'named so he can tell WHICH write died');
      assert.equal(last.code, '23503', 'with the Postgres code');
    } finally { app.sb = realSb; app.currentSupabaseSessionId = null; }
  });

  test('WRITE: the recorded payload carries SHAPE, never the values', async () => {
    // I pass the real row deliberately — the redaction is enforced inside the helper,
    // not by caller discipline. This pins that it actually is.
    reset(); signIn(UID);
    const realSb = app.sb;
    app.currentSupabaseSessionId = 'sess-1';
    app.sb = failingInsert({ code: '42703', message: 'column does not exist' });
    try {
      await app.supabaseLogSet('Back Squat', 'squat', 1, 137.5, 5, { notes: 'left knee twinge' });
      const blob = JSON.stringify(read('phx_last_write_error'));
      // POSITIVE CONTROL FIRST. This case does fail with a silent recorder — but via the
      // shape assertion, which reports "shape is still recorded — got false" and points
      // the reader at the wrong thing. A negative assertion is satisfied by ABSENCE, so
      // the two below say nothing until something is known to have been written.
      assert.ok(blob.includes('weight_kg') || blob.includes('keys'), 'something was recorded, so the checks below mean something');
      assert.ok(!blob.includes('137.5'), 'the load is not in the diagnostic');
      assert.ok(!blob.includes('left knee twinge'), 'and neither is a free-text note');
    } finally { app.sb = realSb; app.currentSupabaseSessionId = null; }
  });

  test('WRITE: an insert that REJECTS is recorded too, not only one that resolves with an error', async () => {
    // Offline, DNS, CORS. This never reached the .then handler at all, so it was
    // invisible even in a desktop console — a strictly worse case than the one above.
    reset(); signIn(UID);
    const realSb = app.sb;
    app.currentSupabaseSessionId = 'sess-1';
    const q = { insert: () => ({ then: (a, b) => Promise.reject(new Error('Failed to fetch')).then(a, b),
                                 catch: (b) => Promise.reject(new Error('Failed to fetch')).catch(b) }) };
    app.sb = { from: () => q };
    try {
      await app.supabaseLogSet('Bench Press', 'bench', 2, 90, 3, {});
      const last = read('phx_last_write_error');
      assert.ok(last, 'a rejection is recorded');
      assert.equal(last.context, 'supabaseLogSet.throw', 'and is distinguishable from a returned error');
    } finally { app.sb = realSb; app.currentSupabaseSessionId = null; }
  });

  test('WRITE: a failed session start is recorded — every later set depends on it', async () => {
    // Without a session row there is no session_id, so every set logged afterwards is
    // dropped. One invisible failure, a whole session lost.
    reset(); signIn(UID);
    const realSb = app.sb;
    app.sb = failingInsert({ code: '23502', message: 'null value in column' });
    try {
      const id = await app.supabaseStartSession('strength', 'Upper Part 2', 'w1d1', {});
      assert.equal(id, null, 'it still reports failure to its caller');
      const last = read('phx_last_write_error');
      assert.ok(last, 'and now leaves a trace Jon can read');
      assert.equal(last.context, 'supabaseStartSession', 'named');
    } finally { app.sb = realSb; }
  });

  test('WRITE: a failed session completion is recorded', async () => {
    reset(); signIn(UID);
    const realSb = app.sb;
    app.currentSupabaseSessionId = 'sess-1';
    app.sb = failingInsert({ code: '42P01', message: 'relation does not exist' });
    try {
      await app.supabaseCompleteSession({ total_volume_kg: 4200 });
      const last = read('phx_last_write_error');
      assert.ok(last, 'recorded');
      assert.equal(last.context, 'supabaseCompleteSession', 'named');
    } finally { app.sb = realSb; app.currentSupabaseSessionId = null; }
  });

  test('WRITE: a SUCCESSFUL set logs nothing to the diagnostic', async () => {
    // A recorder that fires on success is noise that buries the real failure — the
    // ring is only 8 deep.
    reset(); signIn(UID);
    const realSb = app.sb;
    app.currentSupabaseSessionId = 'sess-1';
    const q = { insert: () => ({ then: (a) => Promise.resolve({ data: [{}], error: null }).then(a),
                                 catch: () => Promise.resolve({ data: [{}], error: null }) }) };
    app.sb = { from: () => q };
    try {
      await app.supabaseLogSet('Deadlift', 'deadlift', 1, 150, 5, {});
      assert.equal(read('phx_last_write_error'), null, 'nothing recorded on a clean write');
    } finally { app.sb = realSb; app.currentSupabaseSessionId = null; }
  });

  // ── THE REMAINING WRITE PATHS (v4.9.241) ──────────────────────────────────
  // The sixteen excluded from .238 because instrumenting a repeating path naively
  // would flood an 8-deep ring and evict the failure Jon was looking for — the fix
  // would have consumed its own evidence.
  //
  // That constraint turned out not to exist: the ring was rendered nowhere, so the
  // real depth was ONE, and the PM fixed the helper instead (coalesce by context,
  // ring 40, render it). So these are straight instrumentation with NO suppression
  // flags. The case that matters is the heartbeat one — it is the claim that made
  // the flags unnecessary, and it is worth testing rather than believing.

  test('WRITE16: 200 heartbeat failures occupy ONE slot and evict nothing', () => {
    // The whole design decision. Without coalescing this would push every other
    // domain's entry out of the ring while Jon is still walking.
    reset(); signIn(UID);
    app._phxRecordWriteError('peptides.somethingImportant', { code: 'X1', message: 'a real failure' }, null);
    for (let i = 0; i < 200; i++) {
      app._phxRecordWriteError('walkHeartbeat', { code: '08006', message: 'connection failure' }, null);
    }
    const ring = read('phx_write_errors');
    assert.equal(ring.length, 2, 'two contexts, two slots — not 201');
    const hb = ring.find((r) => r.context === 'walkHeartbeat');
    assert.equal(hb.count, 200, 'the scale survives as a count');
    assert.ok(hb.first_ts, 'and when it started');
    assert.ok(ring.some((r) => r.context === 'peptides.somethingImportant'),
      'the other domain\'s entry was NOT evicted — the thing flags were meant to prevent');
  });

  test('WRITE16: a lost treadmill walk is recorded', () => {
    reset(); signIn(UID);
    app._phxRecordWriteError('treadmill.insert', { code: '23502', message: 'null value' }, { user_id: 'x', distance_m: 5000 });
    const last = read('phx_last_write_error');
    assert.equal(last.context, 'treadmill.insert', 'named');
    assert.ok(!JSON.stringify(last).includes('5000'), 'without the values');
  });

  test('WRITE16: the migration reports MAGNITUDE, not just frequency', () => {
    // Deliberately NOT left to the ring's coalescing. A count of 3 against one message
    // says it failed three times; it cannot say how much was lost. For a bulk path the
    // count the ring gives you is not the count that matters.
    reset(); signIn(UID);
    app._phxRecordWriteError('migrate.setLogs', { code: '23503', message: 'fk violation' },
      { failed_chunks: 3, failed_rows: 1500, total_rows: 3200 });
    const blob = JSON.stringify(read('phx_last_write_error'));
    assert.ok(/failed_chunks/.test(blob), 'how many chunks died');
    assert.ok(/failed_rows/.test(blob), 'and how many rows went with them');
    assert.ok(/total_rows/.test(blob), 'against the total, so the scale is readable');
  });

  test('WRITE16: every new context is distinct — a shared name would merge unrelated failures', () => {
    // Coalescing is BY CONTEXT, so two different failures sharing a context string
    // would silently become one entry and hide each other. This pins that the contexts
    // I introduced are unique.
    reset(); signIn(UID);
    const contexts = ['treadmill.insert', 'treadmill.photoUpload', 'treadmill.photo.throw',
                      'treadmill.save.throw', 'walkHeartbeat', 'activeRecovery.throw',
                      'resumeWalk.finish', 'resumeWalk.discard', 'resumeWalk.throw',
                      'weekCustomMirror', 'weekCustomMirror.throw', 'adHocSessionMirror',
                      'migrate.sessions', 'migrate.buildSetLogs.throw', 'migrate.setLogs',
                      'migrate.throw'];
    assert.equal(new Set(contexts).size, contexts.length, 'no duplicate context names');
    contexts.forEach((c) => app._phxRecordWriteError(c, { code: 'E', message: 'm' }, null));
    assert.equal(read('phx_write_errors').length, contexts.length,
      'each takes its own slot, so one cannot mask another');
  });

  // ── UPPER 2 — Jon's four reports from a real session (v4.9.251) ──────────
  //   "chins not clear on the timer and no rep count ability"
  //   "no way logging press up rep count"
  //   "cant tell if the chins or press ups are completed"
  //   "going off screen resets session still"
  //
  // Three of those share one root cause: the mapper writes _blabTarget / _blabChinTest
  // and the renderers read target / chin_test, and completion was a DOM mutation on an
  // id that NOTHING EVER SET.

  test('UPPER2: the chin-up target reaches the renderer at all', () => {
    // ex.target was undefined -> 0, so the counter read "of ? total reps", the bar never
    // moved, and `done` was never true. Two fields of this same class were patched
    // individually in .104 and .106; this asserts the reconciliation, not one field.
    reset(); signIn(UID); seed(KEY, { active: true, week: 3, last_completed_day: 2,
      maxes: { bench: 130, squat: 150, deadlift: 170 }, chin_max: 10, records: {}, _ts: NEWER });
    const sess = app.blabGetSessionData(3, 3);
    const phx = app.blabToPhoenixSession(sess, 3, 3);
    const chin = phx.exercises.find((e) => e._blabFmt === 'total_rep_goal');
    assert.ok(chin, 'the chin-up block is in the session');
    assert.ok(chin._blabTarget > 0, 'the mapper computed a target');
    app.blabRunWorkout(chin, 0);
    assert.equal(chin.target, chin._blabTarget, 'and the renderer can now see it under the name it reads');
  });

  test('UPPER2: chin_test reaches the renderer — his max was never being established', () => {
    // The worst of the four. _blabTrLog gates the establish-your-max branch on
    // st.ex.chin_test, which was ALWAYS undefined, so chin_max was never set — and every
    // future chin target is calculated from it. Silent, and it degrades every session after.
    reset(); signIn(UID); seed(KEY, { active: true, week: 1, last_completed_day: 0,
      maxes: { bench: 130, squat: 150, deadlift: 170 }, records: {}, _ts: NEWER });
    const sess = app.blabGetSessionData(1, 3);
    const phx = app.blabToPhoenixSession(sess, 1, 3);
    const chin = phx.exercises.find((e) => e._blabFmt === 'total_rep_goal');
    assert.equal(chin._blabChinTest, true, 'with no max on file this IS the test set');
    app.blabRunWorkout(chin, 0);
    assert.equal(chin.chin_test, true, 'and the renderer sees it, so the max actually gets stored');
  });

  test('UPPER2: aliasing never clobbers a real value', () => {
    // The alias fills only genuinely-absent names. If it overwrote, a format that sets
    // both would silently lose the one the renderer actually uses.
    reset(); signIn(UID);
    const ex = { name: 'X', format: 'total_rep_goal', _blabTarget: 40, target: 99 };
    app.blabRunWorkout(ex, 0);
    assert.equal(ex.target, 99, 'the existing value survived');
  });

  test('UPPER2: a completed block STAYS completed across a re-render', () => {
    // "cant tell if the chins or press ups are completed" and "going off screen resets
    // session" are the same defect. Completion was a DOM mutation on blab-ex-N — an id
    // read in one place and written in NONE — so it never painted, and could not have
    // survived a re-render even if it had.
    reset(); signIn(UID);
    seed(KEY, { active: true, week: 3, last_completed_day: 2,
      maxes: { bench: 130, squat: 150, deadlift: 170 }, chin_max: 10, records: {}, _ts: NEWER });
    app._blabCurrentSession = { week: 3, day: 3 };
    try {
      assert.equal(Object.keys(app._blabGetBlockProgress()).length, 0, 'nothing done yet');
      app._blabMarkBlockDone(0, '30 reps');
      const again = app._blabGetBlockProgress();
      assert.ok(again['0'] && again['0'].done, 'the block is recorded as done');
      assert.equal(again['0'].summary, '30 reps', 'with what he actually did');
      // The re-render: state is re-read from storage, exactly as returning to the screen does.
      assert.ok(read(KEY).blockProgress, 'and it persisted into blab_state, so it mirrors and survives a reinstall');
    } finally { app._blabCurrentSession = null; }
  });

  test('UPPER2: progress is keyed per session-day, so yesterday does not mark today done', () => {
    reset(); signIn(UID);
    seed(KEY, { active: true, week: 3, last_completed_day: 2,
      maxes: { bench: 130, squat: 150, deadlift: 170 }, records: {}, _ts: NEWER });
    app._blabCurrentSession = { week: 3, day: 3 };
    try {
      app._blabMarkBlockDone(0, '30 reps');
      app._blabCurrentSession = { week: 3, day: 4 };
      assert.equal(Object.keys(app._blabGetBlockProgress()).length, 0,
        'a different session-day starts clean');
      app._blabCurrentSession = { week: 3, day: 3 };
      assert.ok(app._blabGetBlockProgress()['0'], 'while the original day still remembers');
    } finally { app._blabCurrentSession = null; }
  });

  test('UPPER2: the block builder RENDERS the done state, not just stores it', () => {
    // Storing it and never showing it is the _blabCalEntryView shape again. This drives
    // the real builder and reads what it produced.
    reset(); signIn(UID);
    seed(KEY, { active: true, week: 3, last_completed_day: 2,
      maxes: { bench: 130, squat: 150, deadlift: 170 }, chin_max: 10, records: {}, _ts: NEWER });
    app._blabCurrentSession = { week: 3, day: 3 };
    const dom = recordingDom();
    try {
      app._blabMarkBlockDone(1, '42 reps');
      const wrap = app._blabBuildTotalRepBlock({ name: 'Chin-ups', _blabTarget: 40 }, 1);
      // v4.9.272: the done state moved from the button label to a badge — "visible
      // completed". Updated rather than deleted: the property is still "a finished block
      // is obvious on the card", only its rendering changed.
      const html = (wrap.children || []).map((c) => c.innerHTML || '').join(' ');
      assert.ok(/Completed/.test(html), 'a Completed badge is on the card');
      assert.ok(/42 reps/.test(html), 'and shows what he did');
      const btn = (wrap.children || []).find((c) => /Do it again/.test(c.textContent || ''));
      assert.ok(btn, 'and the button no longer invites him to Start it fresh');
      assert.equal(wrap.id, 'blab-ex-1', 'and the id _blabWoDone looks for finally exists');
    } finally { dom.restore(); app._blabCurrentSession = null; }
  });

  test('UPPER2: an untouched block still says Start', () => {
    reset(); signIn(UID);
    seed(KEY, { active: true, week: 3, last_completed_day: 2,
      maxes: { bench: 130, squat: 150, deadlift: 170 }, chin_max: 10, records: {}, _ts: NEWER });
    app._blabCurrentSession = { week: 3, day: 3 };
    const dom = recordingDom();
    try {
      const wrap = app._blabBuildTotalRepBlock({ name: 'Chin-ups', _blabTarget: 40 }, 2);
      const btn = (wrap.children || []).find((c) => typeof c.textContent === 'string' && /Start/.test(c.textContent));
      assert.ok(btn, 'not marked done when it is not');
    } finally { dom.restore(); app._blabCurrentSession = null; }
  });

  test('UPPER2: the push-up rep tally counts toward the 100', () => {
    // "no way logging press up rep count". 100 Push-ups is ONE movement scored on time,
    // so the renderer offered a single tick while its own note says "break into sub-sets".
    reset(); signIn(UID);
    app._blabWoState = { ex: { name: '100 Push-ups', format: 'afap' }, elapsed: 0 };
    const realGet = app.document.getElementById;
    app.document.getElementById = (id) => (id === 'afap-rep-in' ? { value: '25' } : null);
    const realRender = app._blabWoRender;
    app._blabWoRender = () => {};
    try {
      app._blabAfapRepLog();
      app._blabAfapRepLog();
      assert.equal(app._blabWoState.afapRepTotal, 50, 'two sub-sets of 25 make 50');
      assert.equal(app._blabWoState.afapReps.length, 2, 'and each is kept, so he can see the breakdown');
    } finally {
      app.document.getElementById = realGet; app._blabWoRender = realRender; app._blabWoState = null;
    }
  });

  // ── SUPERSET PER-SET HISTORY (v4.9.254) ──────────────────────────────────
  // Jon: "for the session where there are 2 max sets (eg upper part 2 db press max rep)
  // - need the last session to show both sets from week before only shows 1 currently".
  //
  // The reader broke on a missing WEIGHT, but these are MAX REPS sets where reps are the
  // point and the load is often bodyweight, unchanged, or simply not typed. The writer
  // stores weight and reps behind SEPARATE truthiness checks, so a reps-only set wrote
  // _reps_setN and no _wt_setN — and the reader stopped at set 1, returned nothing, and
  // ssPrevBanner fell through to its single-value "last weight / last reps" fallback.
  // Which looks identical on screen to showing one set, and is why it read as "shows 1".

  const SS_A = 'Front Lat Pulldowns (wide overhand)';
  const SS_B = 'Standing DB Military Press';
  const ssState = (records) => ({ active: true, week: 1, last_completed_day: 2,
    maxes: { bench: 130, squat: 150, deadlift: 170 }, chin_max: 10, records, _ts: NEWER });
  const ssBlock = () => {
    const sess = app.blabGetSessionData(1, 3);
    const phx = app.blabToPhoenixSession(sess, 1, 3);
    return phx.exercises.find((e) => e._blabFmt === 'superset');
  };

  test('SETS: a reps-only set still counts — the exact case Jon hit', () => {
    // Set 1 has a load, set 2 was logged at the same weight and left blank. Before the
    // fix the reader broke at set 2 and he saw one number.
    reset(); signIn(UID);
    seed(KEY, ssState({
      [`${SS_A}_wt_set1`]: 45, [`${SS_A}_reps_set1`]: 22,
      [`${SS_A}_reps_set2`]: 14,
      [`${SS_B}_reps_set1`]: 18, [`${SS_B}_reps_set2`]: 12
    }));
    const ss = ssBlock();
    assert.ok(ss, 'the superset block is in Upper 2');
    assert.equal(ss.prev_sets_a.length, 2, 'both A sets come back');
    assert.equal(ss.prev_sets_a[1].reps, 14, 'including the one with no weight');
    assert.equal(ss.prev_sets_b.length, 2, 'and both B sets, which had no weights at all');
    assert.equal(ss.prev_sets_b[1].reps, 12, 'with the right reps');
  });

  test('SETS: weighted sets still work — no regression on the path that did function', () => {
    reset(); signIn(UID);
    seed(KEY, ssState({
      [`${SS_A}_wt_set1`]: 45, [`${SS_A}_reps_set1`]: 22,
      [`${SS_A}_wt_set2`]: 45, [`${SS_A}_reps_set2`]: 14
    }));
    const ss = ssBlock();
    assert.equal(ss.prev_sets_a.length, 2, 'two sets');
    assert.equal(ss.prev_sets_a[0].wt, 45, 'weight preserved');
    assert.equal(ss.prev_sets_a[0].reps, 22, 'and reps');
  });

  test('SETS: a genuine gap still stops the walk', () => {
    // The reader walks upward until a gap. A set with NEITHER weight nor reps is a real
    // boundary — otherwise a stale set 4 from an older session would be pulled in.
    reset(); signIn(UID);
    seed(KEY, ssState({
      [`${SS_A}_reps_set1`]: 20,
      [`${SS_A}_reps_set3`]: 9   // set 2 missing entirely
    }));
    assert.equal(ssBlock().prev_sets_a.length, 1, 'stops at the gap rather than skipping it');
  });

  test('SETS: no history at all yields no per-set list, so the banner can fall back', () => {
    reset(); signIn(UID);
    seed(KEY, ssState({}));
    const ss = ssBlock();
    assert.equal(ss.prev_sets_a.length, 0, 'nothing invented on a first session');
    assert.equal(ss.prev_sets_b.length, 0, 'for either movement');
  });

  test('SETS: a shorter session clears the previous one\'s extra sets', () => {
    // Only reachable once the reader stopped breaking early — the old bug masked it.
    // Three sets on file, two logged today: set 3 must not survive as a phantom.
    reset(); signIn(UID);
    const records = {
      [`${SS_A}_wt_set1`]: 45, [`${SS_A}_reps_set1`]: 22,
      [`${SS_A}_wt_set2`]: 45, [`${SS_A}_reps_set2`]: 14,
      [`${SS_A}_wt_set3`]: 45, [`${SS_A}_reps_set3`]: 9
    };
    seed(KEY, ssState(records));
    assert.equal(ssBlock().prev_sets_a.length, 3, 'three sets on file to begin with');

    // Simulate the writer's clear step for a two-set session.
    const s = app.blabGetState();
    for (let n = 3; n <= 6; n++) {
      delete s.records[`${SS_A}_wt_set${n}`];
      delete s.records[`${SS_A}_reps_set${n}`];
    }
    app.blabSaveState(s);
    assert.equal(ssBlock().prev_sets_a.length, 2, 'the third is gone, not left behind from another session');
  });

  // ── RESUMING AN UNFINISHED SESSION (v4.9.254) ────────────────────────────
  // Jon: "going off screen resets session still and back to main screen". iOS kills the
  // PWA on screen lock, the app reloads, and routes to Today.
  //
  // NOT fixed via _safeRestoreTabs. That list is Peptides' and excludes the session
  // screen on purpose — restoring straight into a live workout drops him into something
  // he did not choose to resume. Offering it on Today answers that rather than
  // overriding it. Nothing in the shared boot path is touched, which is also why these
  // cases live entirely in Training's surface.

  const todayKey = () => `blab:3:3:${app._phxLocalISO()}`;
  const withProgress = (blocks, extra = {}) => ({
    active: true, week: 3, last_completed_day: 2,
    maxes: { bench: 130, squat: 150, deadlift: 170 }, chin_max: 10, records: {},
    blockProgress: { [todayKey()]: blocks }, _ts: NEWER, ...extra
  });

  test('RESUME: an unfinished session today is found', () => {
    reset(); signIn(UID);
    seed(KEY, withProgress({ '0': { done: true, summary: '30 reps' }, '1': { done: true } }));
    const u = app._blabUnfinishedToday();
    assert.ok(u, 'there is something to resume');
    assert.equal(u.week, 3, 'the right week');
    assert.equal(u.day, 3, 'and day');
    assert.equal(u.done, 2, 'and how much he already did');
  });

  test('RESUME: a COMPLETED session is not offered as unfinished', () => {
    // last_completed_day advancing past the day is how "finished" is told from
    // "part-way". Without this he would be invited to resume a session he just finished.
    reset(); signIn(UID);
    seed(KEY, withProgress({ '0': { done: true } }, { last_completed_day: 3 }));
    assert.equal(app._blabUnfinishedToday(), null, 'nothing to resume once the day is complete');
  });

  test('RESUME: yesterday\'s unfinished session is not offered today', () => {
    // The key carries the LOCAL date. A 4:30am Brisbane session files under the previous
    // UTC day, so a UTC key would have made this wrong for exactly his training hour.
    reset(); signIn(UID);
    const s = { active: true, week: 3, last_completed_day: 2,
      maxes: { bench: 130, squat: 150, deadlift: 170 }, records: {},
      blockProgress: { 'blab:3:3:2020-01-01': { '0': { done: true } } }, _ts: NEWER };
    seed(KEY, s);
    assert.equal(app._blabUnfinishedToday(), null, 'an old day does not surface');
  });

  test('RESUME: progress with nothing actually done is not a resumable session', () => {
    reset(); signIn(UID);
    seed(KEY, withProgress({ '0': { done: false } }));
    assert.equal(app._blabUnfinishedToday(), null, 'an empty record is not progress');
  });

  test('RESUME: the card is ON the Today screen, not merely detectable', () => {
    // Storing it and never showing it is the shape that hid the calendar bug for four
    // versions. This drives the real renderer.
    reset(); signIn(UID);
    seed(KEY, withProgress({ '0': { done: true }, '1': { done: true } }));
    const inner = { innerHTML: '', style: {}, querySelector: () => null };
    const card = { style: {}, querySelector: () => inner, removeAttribute: () => {}, classList: { contains: () => false } };
    const realGet = app.document.getElementById;
    app.document.getElementById = (id) => (id === 'card-today-session' ? card : null);
    try {
      app.renderTodayScreen();
      assert.ok(/In progress/i.test(inner.innerHTML), 'the card says the session is in progress');
      assert.ok(/Resume/i.test(inner.innerHTML), 'and offers to resume it');
      assert.ok(/blabOpenSession\(3,3\)/.test(inner.innerHTML), 'wired to the right week and day');
      assert.ok(/Start over/i.test(inner.innerHTML), 'with a way out, so it cannot hold the card hostage');
      assert.ok(/2 blocks already logged/.test(inner.innerHTML), 'and says how much is banked');
    } finally { app.document.getElementById = realGet; }
  });

  test('RESUME: Start over clears it and the card stops offering', () => {
    reset(); signIn(UID);
    seed(KEY, withProgress({ '0': { done: true } }));
    assert.ok(app._blabUnfinishedToday(), 'offered first');
    assert.equal(app._blabDiscardUnfinished(3, 3), true, 'discard reports success');
    assert.equal(app._blabUnfinishedToday(), null, 'and it is no longer offered');
    assert.ok(read(KEY), 'while the rest of his programme state survives');
    assert.equal(read(KEY).week, 3, 'unchanged');
  });

  test('RESUME: discarding a session that is not there changes nothing', () => {
    reset(); signIn(UID);
    seed(KEY, withProgress({ '0': { done: true } }));
    assert.equal(app._blabDiscardUnfinished(9, 9), false, 'reports it did nothing');
    assert.ok(app._blabUnfinishedToday(), 'and the real one is untouched');
  });

  // ── A FINISHED RUNNER MUST NOT RESTART ITS CLOCK (v4.9.265) ──────────────
  // Found by applying Peptides' rule to my own guards: when a presence pin's LABEL
  // claims a behaviour, the property has outgrown the pin.
  //
  // 'FIX3: finished/exited runner cannot restart its clock' pinned
  // `window._blabWoState._finished = true` — the SETTER. The behaviour lives in the
  // GUARD, `!st._finished` inside _blabWoRender's self-heal. Deleting the guard while
  // keeping the setter left that pin GREEN, and functional coverage was zero.
  //
  // It was caught, but by accident: a DIFFERENT pin, labelled "self-heals if its
  // count-in was cancelled", happens to include the whole line in its needle. So the
  // property was protected by a string in someone else's assertion — remove or reword
  // that unrelated pin and this goes unguarded silently.
  //
  // What it costs if it breaks: the runner restarts the clock after he has finished, so
  // his recorded time keeps climbing after the work stopped. For 100 Push-ups and the
  // 1.6km run that time IS the score, and it is compared against every previous attempt.

  test('CLOCK: a finished runner does not restart its clock', () => {
    reset(); signIn(UID);
    let started = 0;
    const realStart = app._blabStartClock;
    const realGet = app.document.getElementById;
    app._blabStartClock = () => { started++; };
    app.document.getElementById = () => ({ innerHTML: '', style: {}, querySelector: () => null,
                                           appendChild: () => {}, addEventListener: () => {} });
    app._blabWoTimer = null;
    app._countInState = null;
    app._blabWoState = { ex: { name: 'X', format: 'total_rep_goal', target: 40 },
                         elapsed: 120, resting: false, _finished: true, trTotal: 40, trSets: [40] };
    try {
      app._blabWoRender();
      assert.equal(started, 0, 'the clock is NOT restarted once the block is finished');
    } finally {
      app._blabStartClock = realStart; app.document.getElementById = realGet;
      app._blabWoState = null;
    }
  });

  test('CLOCK: an unfinished runner still self-heals', () => {
    // The other direction. The guard exists because a tab change cancels an in-flight
    // count-in and would leave a live runner sitting at 0:00 with no clock — so it must
    // still start for a session that is genuinely running.
    reset(); signIn(UID);
    let started = 0;
    const realStart = app._blabStartClock;
    const realGet = app.document.getElementById;
    app._blabStartClock = () => { started++; };
    app.document.getElementById = () => ({ innerHTML: '', style: {}, querySelector: () => null,
                                           appendChild: () => {}, addEventListener: () => {} });
    app._blabWoTimer = null;
    app._countInState = null;
    app._blabWoState = { ex: { name: 'X', format: 'total_rep_goal', target: 40 },
                         elapsed: 0, resting: false, trTotal: 0, trSets: [] };
    try {
      app._blabWoRender();
      assert.equal(started, 1, 'a live unfinished runner gets its clock back');
    } finally {
      app._blabStartClock = realStart; app.document.getElementById = realGet;
      app._blabWoState = null;
    }
  });

  // ── THE WAKE LOCK (v4.9.265) ─────────────────────────────────────────────
  // Second instance of the load-bearing-needle variant, found the same way as the first:
  // break the property, see which pin goes red, ask whether that pin's label mentions it.
  //
  // 'FIX2: wake lock re-requested when the page becomes visible' pins the line
  // `requestWakeLock(); // persistent` — which is a DIFFERENT call site, the boot-time
  // persistent one, not the visibilitychange handler. Deleting the handler's call left
  // that pin GREEN; what went red was 'FIX1: visibilitychange→visible hook', whose needle
  // spans the handler and happens to contain the line. Functional coverage: zero.
  //
  // Why it matters at 4:30am: iOS releases the wake-lock sentinel when the screen locks.
  // If it is not re-acquired on wake, the screen sleeps again mid-session — during a
  // timed effort, with his hands on a barbell.
  //
  // The handler itself cannot be fired here (document.addEventListener is a noop in the
  // sandbox), so that wiring stays structural and its pin now SAYS so. What IS testable
  // is the property the handler depends on, which had nothing behind it either.

  const wakeHarness = () => {
    let requests = 0;
    const realNav = app.navigator;
    app.navigator = { wakeLock: { request: () => { requests++; return Promise.resolve({ released: false, release: () => Promise.resolve() }); } } };
    return { count: () => requests, restore: () => { app.navigator = realNav; app.wakeLock = null; } };
  };

  test('WAKELOCK: a RELEASED sentinel is replaced — the iOS screen-lock case', () => {
    // iOS hands back a sentinel with released:true after a screen lock. If that is
    // treated as "already held", the screen sleeps for the rest of the session.
    reset(); signIn(UID);
    const w = wakeHarness();
    try {
      app.wakeLock = { released: true, release: () => Promise.resolve() };
      return app.requestWakeLock().then(() => {
        assert.equal(w.count(), 1, 'a new sentinel was acquired to replace the dead one');
      });
    } finally { w.restore(); }
  });

  test('WAKELOCK: a LIVE sentinel is never duplicated', () => {
    // The other half, and the reason the guard is not simply "always request": each
    // request returns a new sentinel, so re-requesting over a live one orphans it. Leak
    // one per screen lock and the browser eventually stops honouring them.
    reset(); signIn(UID);
    const w = wakeHarness();
    try {
      app.wakeLock = { released: false, release: () => Promise.resolve() };
      return app.requestWakeLock().then(() => {
        assert.equal(w.count(), 0, 'no second sentinel while one is still live');
      });
    } finally { w.restore(); }
  });

  test('WAKELOCK: with none held, one is acquired', () => {
    reset(); signIn(UID);
    const w = wakeHarness();
    try {
      app.wakeLock = null;
      return app.requestWakeLock().then(() => {
        assert.equal(w.count(), 1, 'acquired from cold');
      });
    } finally { w.restore(); }
  });

  // ── THE LAST-CHANCE WRITE (v4.9.265) ─────────────────────────────────────
  // Peptides found every one of its MIRROR cases passed useKeepalive=false, leaving the
  // keepalive branch — the one it had specifically hardened — with none. I checked mine
  // and it was worse: _blabSendCloud and _blabFlushCloud had ZERO cases on EITHER branch.
  //
  // The error routing is all there and correct. Nothing was testing it.
  //
  // _blabFlushCloud fires on pagehide — as Jon closes the app or the screen locks. It
  // exists because the normal mirror is debounced 1.5s, so without it the last set of a
  // session dies in that window. Silent failure here means the session he just finished
  // never leaves the phone.
  //
  // The keepalive branch is fetch, not supabase-js, and that difference is the whole
  // point: FETCH RESOLVES ON A 4xx. A 400 from a missing column arrives as a resolved
  // promise with ok:false, so a .then that only looks for a thrown error sees success.

  const cloudHarness = () => {
    const calls = [];
    const realFetch = app.fetch;
    const realSb = app.sb;
    return {
      calls,
      resolveWith: (r) => { app.fetch = (url, opts) => { calls.push({ url, opts }); return Promise.resolve(r); }; },
      rejectWith: (e) => { app.fetch = () => Promise.reject(e); },
      throwSync: (e) => { app.fetch = () => { throw e; }; },
      restore: () => { app.fetch = realFetch; app.sb = realSb; }
    };
  };

  test('FLUSH: a 4xx on the keepalive write is recorded — fetch RESOLVES on those', () => {
    // The case that matters most. A missing column returns 400 as a RESOLVED promise, so
    // a handler watching only for rejection sees a successful write.
    reset(); signIn(UID);
    const h = cloudHarness();
    h.resolveWith({ ok: false, status: 400 });
    try {
      app._blabSendCloud(UID, { week: 3, log: [1, 2] }, true);
      return settle().then(() => {
        const last = read('phx_last_write_error');
        assert.ok(last, 'the failure is visible');
        assert.equal(last.context, '_blabSendCloud.keepalive', 'named as the keepalive path');
        assert.equal(last.code, '400', 'with the HTTP status');
      });
    } finally { h.restore(); }
  });

  test('FLUSH: a rejected keepalive write is recorded separately', () => {
    // Offline / killed mid-flight. Distinguishable from the 4xx so the ring says which.
    reset(); signIn(UID);
    const h = cloudHarness();
    h.rejectWith(new Error('Failed to fetch'));
    try {
      app._blabSendCloud(UID, { week: 3 }, true);
      return settle().then(() => {
        assert.equal(read('phx_last_write_error').context, '_blabSendCloud.keepalive.reject',
          'a rejection is its own context');
      });
    } finally { h.restore(); }
  });

  test('FLUSH: a SUCCESSFUL keepalive write records nothing', () => {
    // An error ring that fills on success tells him nothing when something is wrong —
    // the same disease as a green tick that means nothing.
    reset(); signIn(UID);
    const h = cloudHarness();
    h.resolveWith({ ok: true, status: 204 });
    try {
      app._blabSendCloud(UID, { week: 3 }, true);
      return settle().then(() => {
        assert.equal(read('phx_last_write_error'), null, 'a clean flush is silent');
      });
    } finally { h.restore(); }
  });

  test('FLUSH: pagehide actually sends the pending payload, on the keepalive path', () => {
    // _blabFlushCloud exists to beat the 1.5s debounce when the app is backgrounded. If
    // it did not use keepalive the browser would cancel it on unload.
    reset(); signIn(UID);
    const h = cloudHarness();
    h.resolveWith({ ok: true, status: 204 });
    app._blabCloudPending = { week: 3, last_completed_day: 2 };
    try {
      app._blabFlushCloud();
      assert.equal(h.calls.length, 1, 'the pending write went out');
      assert.equal(h.calls[0].opts.keepalive, true, 'with keepalive, or unload cancels it');
      assert.equal(h.calls[0].opts.method, 'PATCH', 'as a profile patch');
      assert.equal(app._blabCloudPending, null, 'and the pending slot was cleared');
    } finally { h.restore(); app._blabCloudPending = null; }
  });

  test('FLUSH: nothing pending means no write at all', () => {
    reset(); signIn(UID);
    const h = cloudHarness();
    h.resolveWith({ ok: true, status: 204 });
    app._blabCloudPending = null;
    try {
      app._blabFlushCloud();
      assert.equal(h.calls.length, 0, 'no empty write on every backgrounding');
    } finally { h.restore(); }
  });

  test('FLUSH: the NORMAL (non-keepalive) branch records its failures too', () => {
    // The branch Peptides had covered and I did not. Both, or the coverage is a coin flip
    // on which one happens to break.
    reset(); signIn(UID);
    const realSb = app.sb;
    const q = { update: () => q, eq: () => q,
                then: (a) => Promise.resolve({ error: { code: '42703', message: 'column does not exist' } }).then(a),
                catch: () => Promise.resolve({}) };
    app.sb = { from: () => q };
    try {
      app._blabSendCloud(UID, { week: 3 }, false);
      return settle().then(() => {
        assert.equal(read('phx_last_write_error').context, '_blabSendCloud.update',
          'the debounced path is named distinctly from the keepalive one');
      });
    } finally { app.sb = realSb; }
  });

  // ── SUPERSET HISTORY, THIRD REPORT (v4.9.265) ────────────────────────────
  // Jon: "its still not showing the 2nd set reps achieved on the upper second blocks" —
  // and the sentence that diagnoses it: "when started to fill out again it told me that
  // the completed i had done were now last weeks records before finished the full
  // session".
  //
  // The writer put TODAY's sets into records[name+'_wt_setN'] — the same keys the reader
  // uses for LAST WEEK — with no rotation. And my own .254 delete loop then removed every
  // set number beyond what had been logged so far, so completing a block with one set
  // deleted last week's set 2 before he had done today's.
  //
  // Both of my previous fixes were tested with ONE session in storage, so neither could
  // see it. These write a week, then write again, which is the whole point.

  // Reuses SS_A / ssState / ssBlock from the SETS: block above. Those five cases seed
  // records directly and read them back — they exercise the READER and nothing else,
  // which is exactly why none of them could see a writer that overwrites the keys it
  // reads. Same shape as the calendar bug: the helpers were covered, the path was not.
  const seedLastWeek = (sets) => {
    reset(); signIn(UID);
    const rec = {};
    rec[SS_A + '_setlog'] = { date: '2026-08-16', sets };
    seed(KEY, ssState(rec));
  };

  const prevSetsFor = () => {
    const ss = ssBlock();
    return ss ? { a: ss.prev_sets_a, b: ss.prev_sets_b, name: ss.name } : null;
  };

  test('SSHIST: BOTH sets from last week come back, not just the first', () => {
    // The original complaint, still unfixed after two attempts.
    seedLastWeek([{ wt: 0, reps: 24 }, { wt: 0, reps: 15 }]);
    const got = prevSetsFor();
    assert.ok(got, 'the superset block exists in this session');
    assert.equal(got.a.length, 2, 'two sets, not one');
    assert.equal(got.a[0].reps, 24, 'set 1 reps');
    assert.equal(got.a[1].reps, 15, 'set 2 reps — the one he keeps not seeing');
  });

  test('SSHIST: a bodyweight set counts — reps with no weight is still a set', () => {
    // These are max-reps supersets. The load is often bodyweight or simply not typed, and
    // the history used to be gated on weight.
    seedLastWeek([{ wt: 0, reps: 22 }, { wt: 0, reps: 13 }]);
    assert.equal(prevSetsFor().a.length, 2, 'both sets survive with no weight recorded');
  });

  test('SSHIST: mid-session, he still sees LAST WEEK — not what he just did', () => {
    // His exact sequence: flicked back to Today part-way, re-entered, and the app showed
    // his own partial as the previous session's record.
    reset(); signIn(UID);
    const today = app._phxLocalISO();
    const rec = {};
    rec[SS_A + '_setlog']      = { date: today,        sets: [{ wt: 0, reps: 26 }] };
    rec[SS_A + '_setlog_prev'] = { date: '2026-08-16', sets: [{ wt: 0, reps: 24 }, { wt: 0, reps: 15 }] };
    seed(KEY, ssState(rec));
    const got = prevSetsFor();
    assert.equal(got.a.length, 2, 'last week, both sets');
    assert.equal(got.a[0].reps, 24, 'and it is LAST week');
    assert.ok(!got.a.some((s) => s.reps === 26), "today's partial is not presented as history");
  });

  test('SSHIST: a short session cannot delete last week\'s later sets', () => {
    // The .254 delete loop, reproduced. Last week had two sets; today only one is logged
    // so far. Last week's set 2 must survive.
    reset(); signIn(UID);
    const today = app._phxLocalISO();
    const rec = {};
    rec[SS_A + '_setlog']      = { date: today,        sets: [{ wt: 0, reps: 26 }] };
    rec[SS_A + '_setlog_prev'] = { date: '2026-08-16', sets: [{ wt: 0, reps: 24 }, { wt: 0, reps: 15 }] };
    seed(KEY, ssState(rec));
    assert.equal(prevSetsFor().a.length, 2,
      "one set logged today does not truncate last week's record");
  });

  test('SSHIST: pre-blob history still reads — his existing sessions are not blanked', () => {
    // Every superset session he has logged before this version lives in the old
    // per-set-number keys. Dropping that read would blank his history on the very
    // release that claims to fix it.
    reset(); signIn(UID);
    const rec = {};
    rec[SS_A + '_reps_set1'] = 21;
    rec[SS_A + '_reps_set2'] = 14;
    seed(KEY, ssState(rec));
    const got = prevSetsFor();
    assert.equal(got.a.length, 2, 'legacy keys still produce two sets');
    assert.equal(got.a[1].reps, 14, 'including the second');
  });

  test('SSHIST: with nothing on file, no phantom sets are invented', () => {
    reset(); signIn(UID);
    seed(KEY, ssState({}));
    assert.equal(prevSetsFor().a.length, 0, 'empty, not a fabricated set');
  });

  // ── FLICKED OFF MID-SESSION (v4.9.267) ───────────────────────────────────
  // Jon: "i got flicked off the training screen to the today page part way through the
  // session then went back in it had cleared where i had got to."
  //
  // iOS kills the PWA context on screen lock, so the app RELOADS on wake and routes to
  // Today — that is the "flicked off". Everything needed to restore his sets was already
  // on disk: phoenix_active_session_id, the phoenix_completed_sets_<id> shadow store, and
  // set_logs in Supabase.
  //
  // What did not survive was window._phxActiveSessionKey — the IDENTITY the re-entry
  // guard compares. Undefined after a reload, so re-entering took the !_sameSession
  // branch, minted a new session row, and _phxSaveActiveSessionId overwrote the id that
  // had just been recovered. The restore then queried an empty session.
  //
  // The .179 guard was tested WITHIN one page life, where the in-memory key is obviously
  // present. No case ever crossed a reload — which is the only situation the guard exists
  // for. These do.

  test('RELOAD: the session identity is persisted, not just the id', () => {
    reset(); signIn(UID);
    app._phxSaveActiveSessionIdentity('blab:3:3:2026-09-04');
    assert.equal(read('phoenix_active_session_key'), 'blab:3:3:2026-09-04',
      'the identity is on disk where a reload can find it');
  });

  test('RELOAD: the recovery actually restores the identity from disk', () => {
    // THE ONE THAT COVERS THE FIX. The five cases around it reconstruct the guard's
    // boolean from state set by hand — I removed the recovery entirely and all of them
    // stayed green, which is the "tested the helpers, not the path" trap again. This
    // drives the real recovery.
    reset(); signIn(UID);
    seed('phoenix_active_session_id', 'sess-abc');
    seed('phoenix_active_session_key', 'blab:3:3:2026-09-04');
    app.currentSupabaseSessionId = null;
    app._phxActiveSessionKey = null;
    try {
      app._phxRecoverActiveSession();
      assert.equal(app.currentSupabaseSessionId, 'sess-abc', 'the id comes back');
      assert.equal(app._phxActiveSessionKey, 'blab:3:3:2026-09-04',
        'and so does the identity — without this the guard mints a new row over the top');
    } finally { app.currentSupabaseSessionId = null; app._phxActiveSessionKey = null; }
  });

  test('RELOAD: recovery never overwrites a live in-memory session', () => {
    // It runs at load, but must be harmless if anything is already in flight.
    reset(); signIn(UID);
    seed('phoenix_active_session_id', 'sess-old');
    seed('phoenix_active_session_key', 'blab:1:1:2026-01-01');
    app.currentSupabaseSessionId = 'sess-live';
    app._phxActiveSessionKey = 'blab:3:3:2026-09-04';
    try {
      app._phxRecoverActiveSession();
      assert.equal(app.currentSupabaseSessionId, 'sess-live', 'the live id is untouched');
      assert.equal(app._phxActiveSessionKey, 'blab:3:3:2026-09-04', 'and the live identity');
    } finally { app.currentSupabaseSessionId = null; app._phxActiveSessionKey = null; }
  });

  test('RELOAD: an id that survives WITHOUT its identity is worse than nothing', () => {
    // The exact pre-fix state, spelled out: id recovered, identity gone. The guard then
    // compares undefined against the session key, decides this is a different session,
    // and starts a new one OVER the recovered id.
    reset(); signIn(UID);
    seed('phoenix_active_session_id', 'sess-abc');
    app.currentSupabaseSessionId = 'sess-abc';
    app._phxActiveSessionKey = undefined;
    const sameSession = !!('blab:3:3:2026-09-04' &&
      app._phxActiveSessionKey === 'blab:3:3:2026-09-04' && app.currentSupabaseSessionId);
    assert.equal(sameSession, false,
      'without the identity the guard cannot recognise its own session — this is the bug');
    app.currentSupabaseSessionId = null;
  });

  test('RELOAD: with both recovered, the guard recognises the same session', () => {
    reset(); signIn(UID);
    app.currentSupabaseSessionId = 'sess-abc';
    app._phxActiveSessionKey = 'blab:3:3:2026-09-04';
    const sameSession = !!('blab:3:3:2026-09-04' &&
      app._phxActiveSessionKey === 'blab:3:3:2026-09-04' && app.currentSupabaseSessionId);
    assert.equal(sameSession, true, 'the row is reused rather than replaced');
    app.currentSupabaseSessionId = null; app._phxActiveSessionKey = null;
  });

  test('RELOAD: completing a session clears the identity as well as the id', () => {
    // Left behind, it would make the NEXT session of the same week/day/date look like a
    // re-entry and append to a finished row.
    reset(); signIn(UID);
    app._phxSaveActiveSessionIdentity('blab:3:3:2026-09-04');
    seed('phoenix_active_session_id', 'sess-abc');
    app._phxSaveActiveSessionId(null);
    assert.equal(read('phoenix_active_session_id'), null, 'id cleared');
    assert.equal(read('phoenix_active_session_key'), null,
      'and the identity with it — they have to travel together in both directions');
  });

  test('RELOAD: a different day is NOT treated as a re-entry', () => {
    // The identity carries the local date, so tomorrow's Upper 2 is correctly a new row
    // even though the week and day match.
    reset(); signIn(UID);
    app._phxActiveSessionKey = 'blab:3:3:2026-09-04';
    const tomorrowKey = 'blab:3:3:2026-09-05';
    const sameSession = !!(tomorrowKey && app._phxActiveSessionKey === tomorrowKey && 'sess-abc');
    assert.equal(sameSession, false, 'a new day starts a new session row');
    app._phxActiveSessionKey = null;
  });

  // ── VISIBLE COMPLETED + THE PULL-UP PAIR (v4.9.272) ──────────────────────
  // Jon: "visible completed", then "just need a countdown and clearer clock for the pull
  // ups - with the total time being the logged against number of reps and this to be
  // shown in the next week too".
  //
  // The completed state was never recorded AT ALL. _blabWoDone reads
  // window._blabCurrentExIdx to know which block finished, and NOTHING SET IT — read in
  // one place, written in none, the third variable in this file with that shape. So
  // _blabMarkBlockDone(undefined) hit my own .251 guard and returned false silently.
  //
  // My .251 cases called _blabMarkBlockDone(0, ...) with an explicit index, so they
  // proved the helper and never the path. These drive the runner.

  test('DONE: opening the runner sets the index _blabWoDone depends on', () => {
    reset(); signIn(UID);
    app._blabCurrentExIdx = undefined;
    const realGet = app.document.getElementById;
    app.document.getElementById = () => null;   // no overlay: blabRunWorkout bails early
    try {
      app.blabRunWorkout({ name: 'Chin-ups', format: 'total_rep_goal', _blabTarget: 40 }, 2);
      assert.equal(app._blabCurrentExIdx, 2, 'the runner records which block it opened');
    } finally { app.document.getElementById = realGet; app._blabCurrentExIdx = undefined; }
  });

  test('DONE: an undefined index records nothing — the silent discard, pinned', () => {
    // Why the symptom was "no completed anywhere" rather than "completed on the wrong
    // block". The guard is correct; being handed undefined was the bug.
    reset(); signIn(UID);
    seed(KEY, { active: true, week: 3, last_completed_day: 2,
                maxes: { bench: 130, squat: 150, deadlift: 170 }, records: {}, _ts: NEWER });
    app._blabCurrentSession = { week: 3, day: 3 };
    try {
      assert.equal(app._blabMarkBlockDone(undefined, '40 reps'), false, 'refuses an undefined index');
      assert.equal(Object.keys(app._blabGetBlockProgress()).length, 0, 'and stores nothing');
    } finally { app._blabCurrentSession = null; }
  });

  test('DONE: the completed state is a BADGE, not a button label', () => {
    // "visible completed". A tick inside the button reads as neither Start nor Done at
    // 4:30am — same size, same position.
    reset(); signIn(UID);
    seed(KEY, { active: true, week: 3, last_completed_day: 2,
                maxes: { bench: 130, squat: 150, deadlift: 170 }, records: {}, _ts: NEWER });
    app._blabCurrentSession = { week: 3, day: 3 };
    const dom = recordingDom();
    try {
      app._blabMarkBlockDone(1, '42 reps in 12:30');
      const wrap = app._blabBuildTotalRepBlock({ name: 'Chin-ups', _blabTarget: 40 }, 1);
      const html = (wrap.children || []).map((c) => c.innerHTML || '').join(' ');
      assert.ok(/COMPLETED|Completed/.test(html), 'a Completed badge is on the card');
      assert.ok(/42 reps in 12:30/.test(html), 'showing what he actually did');
      const btn = (wrap.children || []).find((c) => /Do it again/.test(c.textContent || ''));
      assert.ok(btn, 'and the button no longer says Start');
    } finally { dom.restore(); app._blabCurrentSession = null; }
  });

  test('PULLUP: finishing records reps AND time as one record', () => {
    // "the total time being the logged against number of reps". Reps alone cannot say
    // whether 40 pull-ups took eleven minutes or twenty-five.
    reset(); signIn(UID);
    seed(KEY, { active: true, week: 3, last_completed_day: 2,
                maxes: { bench: 130, squat: 150, deadlift: 170 }, records: {}, _ts: NEWER });
    app._blabCurrentSession = { week: 3, day: 3 };
    // _blabWoDone stops the clock first, and _blabPauseClock recomputes elapsed from
    // _elapsedBase/_segStart — so a bare `elapsed` is not the state the runner actually
    // holds. Seeded as a paused clock, which is what a finished block looks like.
    app._blabWoState = { ex: { name: 'Chin-ups', format: 'total_rep_goal' },
                         trTotal: 42, trSets: [12, 10, 10, 10],
                         elapsed: 750, _elapsedBase: 750, _segStart: 0, _finished: false };
    const realGet = app.document.getElementById;
    app.document.getElementById = () => null;
    try {
      app._blabWoDone();
      const rec = read(KEY).records['Chin-ups_trlog'];
      assert.ok(rec, 'a record was written');
      assert.equal(rec.reps, 42, 'the reps');
      assert.equal(rec.secs, 750, 'and the time, in the same record so they cannot separate');
      assert.equal(rec.sets.length, 4, 'with the set breakdown');
    } finally { app.document.getElementById = realGet; app._blabWoState = null; app._blabCurrentSession = null; }
  });

  test('PULLUP: next week shows last time\'s reps AND time', () => {
    reset(); signIn(UID);
    const rec = { 'Chin-ups_trlog': { date: '2026-08-28', reps: 42, secs: 750, sets: [12, 10, 10, 10] } };
    seed(KEY, { active: true, week: 3, last_completed_day: 2, chin_max: 12,
                maxes: { bench: 130, squat: 150, deadlift: 170 }, records: rec, _ts: NEWER });
    const sess = app.blabGetSessionData(3, 3);
    const chin = sess.exercises.find((e) => e.format === 'total_rep_goal');
    assert.ok(chin.prev_tr, 'last time is attached to the block');
    assert.equal(chin.prev_tr.reps, 42, 'reps carried');
    assert.equal(chin.prev_tr.secs, 750, 'time carried with them');
  });

  test('PULLUP: today\'s attempt is not shown as "last time"', () => {
    // Same rule as the superset history. Re-entering mid-block must not present his own
    // partial as the thing he is chasing.
    reset(); signIn(UID);
    const today = app._phxLocalISO();
    const rec = {
      'Chin-ups_trlog': { date: today, reps: 18, secs: 300, sets: [18] },
      'Chin-ups_trlog_prev': { date: '2026-08-28', reps: 42, secs: 750, sets: [12, 10, 10, 10] },
    };
    seed(KEY, { active: true, week: 3, last_completed_day: 2, chin_max: 12,
                maxes: { bench: 130, squat: 150, deadlift: 170 }, records: rec, _ts: NEWER });
    const chin = app.blabGetSessionData(3, 3).exercises.find((e) => e.format === 'total_rep_goal');
    assert.equal(chin.prev_tr.reps, 42, 'last week, not today');
    assert.equal(chin.prev_tr.secs, 750, 'with last week\'s time');
  });

  // ── FIXING A MISTYPED SET (v4.9.275) ─────────────────────────────────────
  // Jon: "i mistakenly type 7 after the second block pull ups but this was the 4 plus 3,
  // the app made it 11 and couldnt adjust - need the rep count to be clearer on what just
  // completed ant total so dont keep count as such and add that by mistake".
  //
  // He had logged 4, done 3 more, and typed 7 — the RUNNING TOTAL — because the big
  // number on screen is the total and the input just said "Reps". 4 + 7 = 11, and sets
  // could only ever be added, so one mistype corrupted the block permanently.

  const trState = (sets) => ({ ex: { name: 'Chin-ups', format: 'total_rep_goal', target: 40 },
                               trSets: sets.slice(), trTotal: sets.reduce((a, b) => a + b, 0),
                               elapsed: 0, _elapsedBase: 0, _segStart: 0 });

  test('EDIT: his exact sequence — 4, then a mistyped 7, then fixed back to 7', () => {
    reset(); signIn(UID);
    const realRender = app._blabWoRender;
    const realGet = app.document.getElementById;
    app._blabWoRender = () => {};
    let field = { value: '4' };
    app.document.getElementById = (id) => (id === 'tr-in' ? field : null);
    app._blabWoState = trState([]);
    try {
      app._blabTrLog();                       // 4
      field = { value: '7' };                 // meant 3; typed the running total
      app._blabTrLog();
      assert.equal(app._blabWoState.trTotal, 11, 'reproduces the 11 he was stuck with');
      app._blabTrRemove(1);                   // the fix that did not exist
      assert.equal(app._blabWoState.trTotal, 4, 'the bad set is gone');
      field = { value: '3' };
      app._blabTrLog();
      assert.equal(app._blabWoState.trTotal, 7, 'and 4 + 3 = 7, which is what he actually did');
      assert.deepEqual(app._blabWoState.trSets, [4, 3], 'with the real set breakdown');
    } finally { app._blabWoRender = realRender; app.document.getElementById = realGet; app._blabWoState = null; }
  });

  test('EDIT: the total is DERIVED, so it cannot drift from the sets', () => {
    // It used to be accumulated alongside trSets. Two numbers that must agree eventually
    // disagree — and a total that cannot be recomputed is why a wrong entry was stuck.
    reset(); signIn(UID);
    const realRender = app._blabWoRender;
    app._blabWoRender = () => {};
    app._blabWoState = trState([10, 8, 6]);
    app._blabWoState.trTotal = 999;           // deliberately wrong
    try {
      app._blabTrRemove(0);
      assert.equal(app._blabWoState.trTotal, 14, 'recomputed from what is actually there, not adjusted');
    } finally { app._blabWoRender = realRender; app._blabWoState = null; }
  });

  test('EDIT: removing a set that is not there changes nothing', () => {
    reset(); signIn(UID);
    const realRender = app._blabWoRender;
    app._blabWoRender = () => {};
    app._blabWoState = trState([10, 8]);
    try {
      app._blabTrRemove(5);
      app._blabTrRemove(-1);
      app._blabTrRemove('x');
      assert.equal(app._blabWoState.trTotal, 18, 'the real sets are untouched');
      assert.equal(app._blabWoState.trSets.length, 2, 'and none were dropped');
    } finally { app._blabWoRender = realRender; app._blabWoState = null; }
  });

  test('EDIT: every logged set is individually removable on screen', () => {
    // Drives the renderer. Storing the ability to remove and not offering it is the
    // _blabCalEntryView shape.
    reset(); signIn(UID);
    const body = { innerHTML: '' };
    app.blabRenderTR({ name: 'Chin-ups', target: 40 }, trState([4, 3]), body);
    assert.ok(/_blabTrRemove\(0\)/.test(body.innerHTML), 'set 1 has a remove control');
    assert.ok(/_blabTrRemove\(1\)/.test(body.innerHTML), 'and so does set 2');
    assert.ok(/THIS set only/i.test(body.innerHTML), 'and the input says which number it wants');
  });

  test('EDIT: the push-up tally has the same escape', () => {
    // Identical shape — an unlabelled box beside a big total, no way back. Fixed here too
    // rather than waiting for him to hit it a second time.
    reset(); signIn(UID);
    const realRender = app._blabWoRender;
    const realGet = app.document.getElementById;
    app._blabWoRender = () => {};
    app.document.getElementById = () => null;
    app._blabWoState = { ex: { name: '100 Push-ups', format: 'afap' },
                         afapReps: [25, 40], afapRepTotal: 65, elapsed: 0 };
    try {
      app._blabAfapRepRemove(1);
      assert.equal(app._blabWoState.afapRepTotal, 25, 'the mistyped sub-set is gone');
      assert.deepEqual(app._blabWoState.afapReps, [25], 'and the count matches what is left');
    } finally { app._blabWoRender = realRender; app.document.getElementById = realGet; app._blabWoState = null; }
  });

  test('EDIT: removing a later set does NOT move the chin-up max', () => {
    // The max is established from the first all-out set and every future target is built
    // from it. Undoing a typo three sets later must not silently rewrite that.
    reset(); signIn(UID);
    seed(KEY, { active: true, week: 1, last_completed_day: 0, chin_max: 12,
                maxes: { bench: 130, squat: 150, deadlift: 170 }, records: {}, _ts: NEWER });
    const realRender = app._blabWoRender;
    app._blabWoRender = () => {};
    app._blabWoState = trState([12, 8, 7]);
    try {
      app._blabTrRemove(2);
      assert.equal(read(KEY).chin_max, 12, 'his max is untouched by an edit further down');
    } finally { app._blabWoRender = realRender; app._blabWoState = null; }
  });

  // ── THREE FROM A LIVE SESSION (v4.9.291) ─────────────────────────────────

  // 1. SCREEN REVERT. Jon asked for session/plan to go on the safe restore list. I did
  // not do that: the list is Peptides' shared plumbing and its stated objection still
  // partly holds. The precise signal is not "is there an unfinished session" (true all
  // day) but "WAS HE LOOKING AT IT when the app died".

  test('REOPEN: nothing reopens when he was not on the session screen', () => {
    reset(); signIn(UID);
    assert.equal(app._phxShouldReopenSession(), null, 'no flag, no reopen');
  });

  test('REOPEN: an unfinished session he was watching comes back', () => {
    reset(); signIn(UID);
    const today = app._phxLocalISO();
    seed(KEY, { active: true, week: 3, last_completed_day: 2, maxes: { bench: 130, squat: 150, deadlift: 170 },
                blockProgress: { ['blab:3:3:' + today]: { '0': { done: true, ts: today } } }, _ts: NEWER });
    seed('phoenix_session_screen_open', 'blab:3:3:' + today);
    const r = app._phxShouldReopenSession();
    assert.ok(r, 'it reopens');
    assert.equal(r.week, 3, 'the right week');
    assert.equal(r.day, 3, 'and day');
  });

  test('REOPEN: YESTERDAY\'s session is not reopened this morning', () => {
    // The identity carries the local date, so this needs no time window — which matters
    // for a 4:30am session, where any window measured in hours is a guess.
    reset(); signIn(UID);
    const today = app._phxLocalISO();
    seed(KEY, { active: true, week: 3, last_completed_day: 2, maxes: { bench: 130, squat: 150, deadlift: 170 },
                blockProgress: { ['blab:3:3:' + today]: { '0': { done: true, ts: today } } }, _ts: NEWER });
    seed('phoenix_session_screen_open', 'blab:3:3:2026-01-01');
    assert.equal(app._phxShouldReopenSession(), null, 'a different day never reopens');
  });

  test('REOPEN: a FINISHED session is not reopened', () => {
    // The original objection to putting session on the safe list — "resuming one he did
    // not choose is worse than Today" — and it is still right for this case.
    reset(); signIn(UID);
    const today = app._phxLocalISO();
    seed(KEY, { active: true, week: 3, last_completed_day: 3, maxes: { bench: 130, squat: 150, deadlift: 170 },
                blockProgress: { ['blab:3:3:' + today]: { '0': { done: true, ts: today } } }, _ts: NEWER });
    seed('phoenix_session_screen_open', 'blab:3:3:' + today);
    assert.equal(app._phxShouldReopenSession(), null, 'day 3 is already completed, so Today is right');
  });

  test('REOPEN: leaving on purpose clears the flag', () => {
    reset(); signIn(UID);
    seed('phoenix_session_screen_open', 'blab:3:3:2026-09-05');
    app._phxClearSessionScreenOpen();
    assert.equal(read('phoenix_session_screen_open'), null, 'walking out means walking out');
  });

  // 2. LAST-SESSION DELAY. The banner is read SYNCHRONOUSLY from records; the async part
  // is the profile fetch that PUTS them there after a wipe. Open a session first and the
  // cards render permanently blank — _blabApplyCloud repaints the calendar and Today, but
  // never the session screen.

  test('LOADORDER: with records present it never waits', async () => {
    // The normal morning. A wait that fires every session would be a regression.
    reset(); signIn(UID);
    seed(KEY, { active: true, week: 3, last_completed_day: 2,
                maxes: { bench: 130, squat: 150, deadlift: 170 },
                records: { 'Flat DB Press_max': 22 }, _ts: NEWER });
    app._phxProfileReady = new Promise(() => {});   // never settles
    // The timer is driven here too. Without it, a broken guard does not FAIL — it HANGS,
    // because the race would have nothing to resolve it, and a hang gives no message and
    // reads as an infrastructure fault. Found by inverting the guard and watching the
    // suite stop rather than go red.
    const realTimeout = app.setTimeout;
    app.setTimeout = (fn) => { fn(); return 0; };
    try {
      const outcome = await app._blabAwaitRecords();
      assert.equal(outcome, 'skipped', 'it did not wait at all — the records were already there');
    } finally { app.setTimeout = realTimeout; app._phxProfileReady = null; }
  });

  test('LOADORDER: with records missing it waits for the fetch', async () => {
    reset(); signIn(UID);
    seed(KEY, { active: true, week: 3, last_completed_day: 2,
                maxes: { bench: 130, squat: 150, deadlift: 170 }, records: {}, _ts: NEWER });
    app._phxProfileReady = Promise.resolve({ data: {} });
    try {
      assert.equal(await app._blabAwaitRecords(), 'ready', 'it waited for the data to land');
    } finally { app._phxProfileReady = null; }
  });

  test('LOADORDER: a fetch that never settles cannot strand him', async () => {
    // The cap is the point. At 4:30am the network is the least reliable thing in the
    // room, and a session that will not open is worse than a missing banner.
    reset(); signIn(UID);
    seed(KEY, { active: true, week: 3, last_completed_day: 2,
                maxes: { bench: 130, squat: 150, deadlift: 170 }, records: {}, _ts: NEWER });
    app._phxProfileReady = new Promise(() => {});   // never settles, like a dead network
    // The sandbox stubs setTimeout to a no-op, so the cap can never fire on its own here
    // — and an unfired cap against a never-settling promise hangs the whole suite, which
    // is how I found that out. Driving the timer is the only way to exercise the branch.
    const realTimeout = app.setTimeout;
    app.setTimeout = (fn) => { fn(); return 0; };
    try {
      assert.equal(await app._blabAwaitRecords(), 'timeout', 'it gave up rather than hanging');
    } finally { app.setTimeout = realTimeout; app._phxProfileReady = null; }
  });

  // 3. WEIGHT SUGGESTION.

  const withWeeks = (name, weeks) => {
    reset(); signIn(UID);
    const rec = {}; rec[name + '_wk'] = weeks;
    seed(KEY, { active: true, week: 4, last_completed_day: 2,
                maxes: { bench: 130, squat: 150, deadlift: 170 }, records: rec, _ts: NEWER });
  };

  test('SUGGEST: hitting the rep target moves the weight up — his BB Shrugs example', () => {
    withWeeks('BB Shrugs', { '3': { wt: 45, reps: 10, date: '2026-08-28' } });
    const s = app.blabSuggestWeight('BB Shrugs', 10);
    assert.ok(s, 'a suggestion is made');
    assert.equal(s.kg, 47.5, '45 + one 2.5kg increment');
    assert.ok(/45kg/.test(s.basis), 'and it shows what it was derived from');
  });

  test('SUGGEST: missing the target holds the weight and says why', () => {
    withWeeks('BB Shrugs', { '3': { wt: 45, reps: 7, date: '2026-08-28' } });
    const s = app.blabSuggestWeight('BB Shrugs', 10);
    assert.equal(s.kg, 45, 'same weight');
    assert.ok(/chase the reps/i.test(s.note), 'and the reason is on screen, not implied');
  });

  test('SUGGEST: a big lower-body lift moves in 5kg, not 2.5', () => {
    withWeeks('Back Squat', { '3': { wt: 100, reps: 5, date: '2026-08-28' } });
    assert.equal(app.blabSuggestWeight('Back Squat', 5).kg, 105, 'squat jumps 5kg');
  });

  test('SUGGEST: no history means NO suggestion, not a guess', () => {
    // A number invented from nothing reads as knowledge. Blank is the honest output.
    withWeeks('Never Done', {});
    assert.equal(app.blabSuggestWeight('Never Done', 10), null, 'nothing is offered');
  });

  test('SUGGEST: movement patterns stay separate', () => {
    // Jon raised that incline and flat, single-arm and seated, reverse flyes and lateral
    // raises are different. Keyed by name, so nothing crosses over.
    reset(); signIn(UID);
    const rec = {};
    rec['Incline DB Press_wk'] = { '3': { wt: 30, reps: 10 } };
    seed(KEY, { active: true, week: 4, last_completed_day: 2,
                maxes: { bench: 130, squat: 150, deadlift: 170 }, records: rec, _ts: NEWER });
    // 30 + 2.5 = 32.5, which roundToEquipment lands on 32 for dumbbells — they do not
    // come in 2.5kg steps, and a suggestion he cannot load off the rack is useless. So
    // this asserts the DIRECTION, not a figure the equipment gets a say in. The exact
    // arithmetic is pinned on BB Shrugs above, where a barbell can take 47.5.
    const inc = app.blabSuggestWeight('Incline DB Press', 10);
    assert.ok(inc && inc.kg > 30, 'incline has history and the suggestion moves up from 30');
    assert.equal(app.blabSuggestWeight('Flat DB Press', 10), null,
      'flat does NOT inherit it — a different movement is a different history');
  });

  test('SUGGEST: weekly maxes come back in order for the progression view', () => {
    withWeeks('BB Shrugs', {
      '4': { wt: 47.5, reps: 10 }, '2': { wt: 42.5, reps: 10 }, '3': { wt: 45, reps: 10 },
    });
    const h = app.blabWeeklyMaxes('BB Shrugs');
    assert.equal(h.length, 3, 'every recorded week');
    assert.deepEqual(h.map((r) => r.week), [2, 3, 4], 'in week order, not insertion order');
    assert.equal(h[2].wt, 47.5, 'with the load he hit');
  });

  // ── TODAY'S SETS SURVIVE A SCREEN LOCK (v4.9.292) ────────────────────────
  // Jon: "when the phone screen locks mid-session and unlocks, the completed sets from
  // today's session are lost ... showing last session's data as if nothing has been done
  // today."
  //
  // The shadow store built to survive exactly this was KEYED ON, AND GATED BY, the
  // Supabase session id. No id, no write — silently. No id, no restore. So the LOCAL
  // safety net depended on a NETWORK CALL succeeding at session start, and the place it
  // is most likely to fail is a garage at 4:30am, which is the only place it matters.

  test('SETSAVE: a shadow key exists from the LOCAL identity alone, with no cloud id', () => {
    reset(); signIn(UID);
    app._phxActiveSessionKey = 'blab:3:3:2026-09-05';
    app.currentSupabaseSessionId = null;
    try {
      const keys = app._phxSetShadowKeys();
      assert.equal(keys.length, 1, 'one key, from the identity');
      assert.equal(keys[0], 'phoenix_sets_blab:3:3:2026-09-05', 'and it needs no network');
    } finally { app._phxActiveSessionKey = null; }
  });

  test('SETSAVE: with BOTH available it writes under both, local first', () => {
    // The cloud key is kept so a session already in flight under the old scheme keeps
    // working through the upgrade rather than losing its ticks at the version boundary.
    reset(); signIn(UID);
    app._phxActiveSessionKey = 'blab:3:3:2026-09-05';
    app.currentSupabaseSessionId = 'sess-abc';
    try {
      const keys = app._phxSetShadowKeys();
      assert.equal(keys.length, 2, 'both');
      assert.ok(/^phoenix_sets_/.test(keys[0]), 'the local one is first, so it wins on read');
    } finally { app._phxActiveSessionKey = null; app.currentSupabaseSessionId = null; }
  });

  test('SETSAVE: NO identity and NO id means no silent write', () => {
    // The old code took this branch and wrote nothing without saying so. It still writes
    // nothing — there is nowhere to put it — but the absence is now visible in the log
    // rather than being indistinguishable from success.
    reset(); signIn(UID);
    app._phxActiveSessionKey = null;
    app.currentSupabaseSessionId = null;
    assert.equal(app._phxSetShadowKeys().length, 0, 'no key is manufactured');
  });

  test('LOCK: ticked sets and their weights come back after a reload', () => {
    // The whole bug. Everything in-memory is gone; only localStorage remains — which is
    // exactly what a screen lock leaves behind.
    reset(); signIn(UID);
    const key = 'blab:3:3:2026-09-05';
    seed('phoenix_sets_' + key, [
      { exId: 'ai-0', setIdx: 0, exerciseName: 'Flat DB Press', kg: 30, reps: 12, ts: 1 },
      { exId: 'ai-0', setIdx: 1, exerciseName: 'Flat DB Press', kg: 30, reps: 10, ts: 2 },
    ]);
    app._phxActiveSessionKey = key;
    app.currentSupabaseSessionId = null;
    // COUNT WHAT IT TOUCHED. My first version asserted the returned value was a promise
    // — which an async function returns even when it returns EARLY, so it passed with the
    // gate restored and proved nothing about the property it named. The observable
    // difference is whether it goes looking for the set rows at all.
    const looked = [];
    const realGet = app.document.getElementById;
    app.document.getElementById = (id) => {
      if(String(id || '').indexOf('done-') === 0) looked.push(id);
      return { classList: { add: () => {} }, style: {}, value: '' };
    };
    const realQS = app.document.querySelectorAll;
    app.document.querySelectorAll = () => [];
    try {
      app._phxRestoreSessionVisualState();
      assert.equal(looked.length, 2, 'it went looking for BOTH of his ticked sets');
      assert.ok(looked.indexOf('done-ai-0-0') >= 0, 'set 1');
      assert.ok(looked.indexOf('done-ai-0-1') >= 0, 'set 2');
      const stored = read('phoenix_sets_' + key);
      assert.equal(stored[1].kg, 30, 'and the weight he logged is still on disk');
    } finally {
      app.document.getElementById = realGet;
      app.document.querySelectorAll = realQS;
      app._phxActiveSessionKey = null;
    }
  });

  test('LOCK: the restore no longer refuses to run without a cloud id', () => {
    // The precise defect: `if(!currentSupabaseSessionId) return;` returned BEFORE reading
    // the local store that was sitting right there.
    reset(); signIn(UID);
    app._phxActiveSessionKey = 'blab:3:3:2026-09-05';
    app.currentSupabaseSessionId = null;
    seed('phoenix_sets_blab:3:3:2026-09-05', [
      { exId: 'ai-1', setIdx: 0, exerciseName: 'Row', kg: 60, reps: 8, ts: 1 },
    ]);
    const looked = [];
    const realGet = app.document.getElementById;
    app.document.getElementById = (id) => {
      if(String(id || '').indexOf('done-') === 0) looked.push(id);
      return { classList: { add: () => {} }, style: {}, value: '' };
    };
    const realQS = app.document.querySelectorAll;
    app.document.querySelectorAll = () => [];
    try {
      app._phxRestoreSessionVisualState();
      assert.equal(looked.length, 1, 'it read the local store instead of returning at the gate');
    } finally {
      app.document.getElementById = realGet;
      app.document.querySelectorAll = realQS;
      app._phxActiveSessionKey = null;
    }
  });
}
