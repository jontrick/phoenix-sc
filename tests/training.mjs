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
      await Promise.resolve();
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
      await Promise.resolve();
      await Promise.resolve();
      assert.equal(ran, true, 'confirming runs the action');
    } finally { dom.restore(); }
  });

  test('_blabConfirm does not run its callback when cancelled', async () => {
    let ran = false;
    const dom = recordingDom();
    try {
      app._blabConfirm('Start Week 6', 'Begin the next week?', () => { ran = true; }, 'Start Week 6');
      dom.byButton('Cancel').handlers.click();
      await Promise.resolve();
      await Promise.resolve();
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
}
