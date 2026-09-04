// PM-owned shared plumbing — functional tests.
export default function ({ test, assert, app, signIn, seed, read, reset }) {
  test('_phxLocalISO returns the LOCAL calendar day, not UTC', () => {
    // 2026-08-19 04:30 in UTC+10 is 2026-08-18 18:30 UTC. Construct via local components so the
    // assertion holds in any TZ the runner happens to have; the property is "matches local parts".
    const d = new Date(2026, 7, 19, 4, 30, 0);
    const want = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    assert.equal(app._phxLocalISO(d), want, 'local date components');
    assert.equal(app._phxLocalISO(d), '2026-08-19', 'the day the athlete is actually in');
    // And it must NOT be the UTC day when they differ (only observable in a TZ east of UTC).
    const utcDay = d.toISOString().slice(0, 10);
    if (utcDay !== '2026-08-19') assert.ok(app._phxLocalISO(d) !== utcDay, 'differs from UTC day when they diverge');
  });
  test('_phxLocalISO with no arg is today, zero-padded, 10 chars', () => {
    const s = app._phxLocalISO();
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(s), 'YYYY-MM-DD shape: ' + s);
  });

  test('_phxConfirm resolves FALSE on cancel and TRUE on the yes button', async () => {
    // Rule 4: native confirm is suppressed on iOS and returns false, so every
    // `if(!confirm(x)) return;` was a dead branch. The DOM replacement must actually
    // resolve both ways or we have swapped one broken guard for another.
    const buttons = [];
    const realCreate = app.document.createElement;
    app.document.createElement = function (tag) {
      const el = realCreate.call(app.document, tag);
      const handlers = [];
      el.addEventListener = (ev, fn) => { if (ev === 'click') { handlers.push(fn); el.__click = fn; } };
      el.__handlers = handlers;
      if (String(tag).toLowerCase() === 'button') buttons.push(el);
      return el;
    };
    try {
      buttons.length = 0;
      const pCancel = app._phxConfirm('T', 'M');
      assert.ok(buttons.length >= 2, 'modal built a cancel and a yes button, got ' + buttons.length);
      buttons[0].__click();                              // Cancel
      assert.equal(await pCancel, false, 'cancel resolves false');

      buttons.length = 0;
      const pYes = app._phxConfirm('T', 'M');
      buttons[1].__click();                              // Yes
      assert.equal(await pYes, true, 'yes resolves true');
    } finally {
      app.document.createElement = realCreate;
    }
  });

  test('the reset flows await _phxConfirm rather than native confirm', () => {
    // The feature was dead on device, not merely silent — pin that it cannot regress.
    const src = app._phxResetFullReset.toString() + app._phxResetFreshStart.toString() + app._phxResetUpdateGoals.toString();
    assert.ok(!/[^.\w]confirm\(/.test(src), 'no native confirm left in the reset flows');
    assert.ok(/_phxConfirm\(/.test(src), 'reset flows use the DOM confirm');
    assert.ok(/await/.test(src), 'and await it, so a cancel still returns early');
  });

  // ── CONTRACT _phxRecordWriteError ───────────────────────────────────────────
  // PM-owned, 25 call sites across all three domains (Peptides declared consumption
  // 2026-08-21; Training and Nutrition route their cloud mirrors through it). Provider
  // pins live here per COMMS_PROTOCOL — a consumer's pin only reddens after the break
  // has shipped. The privacy properties are the contract: this snapshot lands in plain
  // localStorage and is readable from the Safari URL bar via phxLastError().
  test('CONTRACT _phxRecordWriteError: records SHAPE, never values', () => {
    app.localStorage.removeItem('phx_last_write_error');
    app._phxRecordWriteError('t.ctx', { message: 'boom', code: '42P01' }, {
      stacks: [1, 2, 3], secretName: 'Jon Trickey', dob: '1985-03-12', nested: { a: 1, b: 2 },
    });
    const snap = JSON.parse(app.localStorage.getItem('phx_last_write_error'));
    const blob = JSON.stringify(snap);
    assert.notIncludes(blob, 'Jon Trickey', 'a value must never reach the snapshot');
    assert.notIncludes(blob, '1985-03-12', 'a DOB must never reach the snapshot');
    assert.ok(snap.payload_shape, 'shape is recorded');
    assert.equal(snap.payload_shape.stacks, 'array[3]', 'arrays reduce to a length');
    assert.equal(snap.payload_shape.secretName, 'string(11)', 'strings reduce to a length');
    assert.equal(snap.code, '42P01', 'the error code IS kept — it is the diagnostic value');
  });
  test('CONTRACT _phxRecordWriteError: drops details/hint, truncates message', () => {
    app.localStorage.removeItem('phx_last_write_error');
    app._phxRecordWriteError('t.ctx', {
      message: 'x'.repeat(500),
      details: 'Key (email)=(jon@visionmadeco.com) already exists.',
      hint: 'invalid input syntax for type date: "1985-03-12"',
    }, {});
    const snap = JSON.parse(app.localStorage.getItem('phx_last_write_error'));
    const blob = JSON.stringify(snap);
    // Postgres echoes the offending VALUE in details/hint — that is why they are dropped.
    assert.notIncludes(blob, 'visionmadeco', 'details must not be recorded');
    assert.notIncludes(blob, '1985-03-12', 'hint must not be recorded');
    assert.equal(snap.details, undefined, 'no details field at all');
    assert.equal(snap.hint, undefined, 'no hint field at all');
    assert.ok(snap.message.length <= 201, 'message truncated, got ' + snap.message.length);
  });
  test('CONTRACT _phxRecordWriteError: a looping writer cannot evict another domain', () => {
    // THE POINT OF THE RING. It is shared by four domains. Before v4.9.240 a repeating
    // failure — a walk heartbeat firing every few seconds, a bulk migrate over 300 rows —
    // pushed one entry per occurrence and flushed everyone else's out. Training was about
    // to add per-call-site suppression flags in 16 places to work around it; suppression
    // belongs in the helper, where it protects domains that never thought about it.
    app.localStorage.removeItem('phx_write_errors');
    app._phxRecordWriteError('peptides.bloodPanel', { message: 'insert failed', code: '23505' }, {});
    app._phxRecordWriteError('pm.weighIn', { message: 'upsert failed', code: '42703' }, {});
    for (let i = 0; i < 200; i++) app._phxRecordWriteError('training.walkHeartbeat', { message: 'offline' }, {});

    const ring = JSON.parse(app.localStorage.getItem('phx_write_errors'));
    const ctxs = ring.map(r => r.context);
    assert.ok(ctxs.includes('peptides.bloodPanel'), '200 heartbeat failures must NOT evict the blood panel');
    assert.ok(ctxs.includes('pm.weighIn'), '200 heartbeat failures must NOT evict the weigh-in');
    assert.equal(ctxs.filter(c => c === 'training.walkHeartbeat').length, 1, 'the looping context occupies exactly ONE slot');
    const hb = ring.find(r => r.context === 'training.walkHeartbeat');
    assert.equal(hb.count, 200, 'but the count is preserved, so the scale is not lost');
    assert.ok(hb.first_ts, 'and when it started');
  });

  test('CONTRACT _phxRecordWriteError: ring is deep enough and evicts oldest-first', () => {
    app.localStorage.removeItem('phx_write_errors');
    for (let i = 0; i < 45; i++) app._phxRecordWriteError('ctx' + i, { message: 'e' + i }, {});
    const ring = JSON.parse(app.localStorage.getItem('phx_write_errors'));
    assert.equal(ring.length, 40, 'ring capped at 40');
    assert.equal(ring[39].context, 'ctx44', 'newest retained');
    assert.equal(ring[0].context, 'ctx5', 'oldest evicted');
    // Callers wrap cloud writes in this; it must never become the thing that throws.
    app._phxRecordWriteError(undefined, undefined, undefined);
    app._phxRecordWriteError('c', null, (() => { const o = {}; o.self = o; return o; })());
    assert.ok(true, 'survived undefined args and a circular payload');
  });

  test('ENTRY the Diagnostic panel actually RENDERS the ring', async () => {
    // The ring was written from v4.9.176 and READ BY NOTHING until v4.9.240 — the panel
    // showed only phx_last_write_error, one entry, so any later failure overwrote the one
    // that mattered. A comment in the source claimed the ring kept writers "visible". It
    // was false when written. This drives the panel and asserts an earlier failure is
    // still on screen after a later one — the exact thing that was untrue for 60+ versions.
    app.localStorage.removeItem('phx_write_errors');
    app._phxRecordWriteError('pm.weighIn', { message: 'weigh-in upsert failed', code: '42703' }, {});
    app._phxRecordWriteError('peptides.bloodPanel', { message: 'photo upload failed' }, {});

    const el = { textContent: '', style: {}, addEventListener(){}, remove(){} };
    const realGet = app.document.getElementById;
    // Delegate every OTHER id to the real stub — returning null broke showScreen and the
    // failure then arrived as an unhandled rejection, not as this test's assertion.
    app.document.getElementById = (id) => (id === 'diag-error-ring' ? el : realGet.call(app.document, id));
    try { await Promise.resolve(app._phxOpenDiagnostic()); }
    catch (_e) { /* the rest of the panel is stubbed; the ring render is what matters */ }
    finally { app.document.getElementById = realGet; }

    assert.ok(el.textContent.includes('peptides.bloodPanel'), 'the newest failure is shown');
    assert.ok(el.textContent.includes('pm.weighIn'), 'and the EARLIER one is still there — not overwritten');
    assert.ok(el.textContent.includes('42703'), 'with its error code');
  });

  test('CONTRACT _phxRecordWriteError: holds for a CARELESS caller, not just a careful one', () => {
    // Peptides' insight (2026-08-21): its own call sites pass scrubbed summaries, so its
    // tests only ever proved its discipline. The provider guarantee must hold WITHOUT it —
    // otherwise the redaction is caller etiquette wearing a helper's clothes. This hands the
    // helper a raw peptide state, the exact thing a future caller might pass by accident.
    app.localStorage.removeItem('phx_last_write_error');
    app._phxRecordWriteError('pep.careless', {
      message: 'duplicate key value violates unique constraint',
      code: '23505',
      // The subtle path: the value leaks through the ERROR object, not the payload, so
      // scrubbing the payload alone would not be enough.
      details: 'Failing row contains (24.8, Serum copper)',
      hint: 'value 24.8 is out of range',
    }, {
      stacks: [{ compoundId: 'epitalon', dose: 5, notes: 'felt flat all week' }],
      notes: [{ text: 'sleep much worse since Tuesday' }],
      bloods: [{ lab: 'QML', markers: [{ name: 'Serum copper', value: 24.8, unit: 'umol/L' }] }],
    });
    const blob = app.localStorage.getItem('phx_last_write_error');
    ['24.8', 'Serum copper', 'QML', 'felt flat all week', 'sleep much worse', 'epitalon', 'umol/L']
      .forEach(leak => assert.notIncludes(blob, leak, `medical/personal value leaked: ${leak}`));
    const snap = JSON.parse(blob);
    assert.equal(snap.code, '23505', 'still diagnosable — code kept');
    assert.ok(snap.payload_shape.stacks === 'array[1]', 'still diagnosable — shape kept');
  });

  test('ENTRY _phxResetFullReset: cancelling the confirm changes nothing', async () => {
    // Peptides' third axis (34c75fe): my existing pin asserts the reset flows AWAIT
    // _phxConfirm — a structural claim about the source. It cannot tell me the entry point
    // actually reaches the modal, nor that a Cancel really aborts. This drives the entry
    // point. Cancel is the case worth pinning: these flows wipe Jon's programme, and the
    // whole reason .175 existed is that the native confirm returned false and the feature
    // was dead. If a future edit makes cancel fall through, that is silent data loss.
    signIn('u-reset');
    seed('phoenix_athlete', { id: 'u-reset', name: 'Jon', fqCompleted: true });
    const buttons = [];
    const realCreate = app.document.createElement;
    app.document.createElement = function (tag) {
      const el = realCreate.call(app.document, tag);
      el.addEventListener = (ev, fn) => { if (ev === 'click') el.__click = fn; };
      if (String(tag).toLowerCase() === 'button') buttons.push(el);
      return el;
    };
    let threw = null;
    try {
      const p = app._phxResetFullReset();          // entry point, not a helper
      assert.ok(buttons.length >= 2, 'the entry point actually reached the DOM confirm, got ' + buttons.length + ' buttons');
      buttons[0].__click();                         // Cancel
      await p;
    } catch (e) { threw = e; } finally { app.document.createElement = realCreate; }
    assert.equal(threw, null, 'cancelling must not throw: ' + (threw && threw.message));
    const ath = read('phoenix_athlete');
    assert.equal(ath && ath.fqCompleted, true, 'cancel left the profile untouched');
  });

  test('ENTRY _blabSendCloud: a failing keepalive write reaches the diagnostic', async () => {
    // Declared gap, now closed. Four harness guards asserted "recorded" while only checking
    // that a line of source existed — Nutrition's 06da7fa point. This is the write that fires
    // when Jon backgrounds the PWA mid-session, so a silent failure here loses the set he just
    // logged with nothing on screen and nothing in Settings.
    signIn('u-blab');
    app.localStorage.removeItem('phx_last_write_error');
    const realFetch = app.fetch;
    app.fetch = () => Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}), text: () => Promise.resolve('') });
    try {
      app._blabSendCloud('u-blab', { blabWeek: 5, blabDay: 1 }, true); // keepalive branch
      await new Promise(r => setImmediate(r));
      await new Promise(r => setImmediate(r));
    } finally { app.fetch = realFetch; }
    const raw = app.localStorage.getItem('phx_last_write_error');
    assert.ok(raw, 'a failed keepalive write must land in phx_last_write_error');
    const snap = JSON.parse(raw);
    assert.ok(String(snap.context).includes('_blabSendCloud.keepalive'), 'context names the branch, got ' + snap.context);
    assert.equal(snap.code, '503', 'HTTP status carried as the code, got ' + snap.code);
    assert.ok(snap.payload_shape, 'shape recorded, not the payload');
  });

  test('ENTRY _phxMorningSave feeds the AUTHORITATIVE weight log', async () => {
    // The chain was: PM ruled ns.daily[].weight_kg authoritative -> Training wired
    // submitWeightCheckin to feed it (.167) -> submitWeightCheckin turned out to be
    // orphaned behind a display:none banner -> nutRecordWeight had no reachable caller
    // -> Jon could weigh in every morning and his macros never noticed. Three domains
    // coordinated a contract and hung it off an unreachable function. This drives the
    // weigh-in Jon ACTUALLY does and asserts the log is populated.
    signIn('u-weigh');
    reset(); signIn('u-weigh');
    seed('phx_nut_v1_u-weigh', { targets: {}, daily: {} });
    const el = { value: '88.4', style: {}, focus(){}, addEventListener(){} };
    const realGet = app.document.getElementById;
    app.document.getElementById = (id) => (id === 'phx-morning-weight' ? el : realGet.call(app.document, id));
    try {
      await app._phxMorningSave();
    } catch (_e) { /* the Supabase/photo tail is stubbed; the local writes are what matter */ }
    finally { app.document.getElementById = realGet; }
    const key = app._phxLocalISO();
    const ns = read('phx_nut_v1_u-weigh');
    assert.ok(ns && ns.daily && ns.daily[key], 'a nutrition day record exists for today');
    assert.equal(ns.daily[key].weight_kg, 88.4, 'the authoritative log carries this morning\'s weight');
  });

  test('CONTRACT _phxNotice actually renders and resolves — alert() did neither', async () => {
    // The bug this replaces: twelve failure paths reported ONLY through alert(), which iOS
    // suppresses in a PWA. fqNext's "Build my plan", Fresh Start, the weekly check-in submit
    // and the Diagnostic's own force-save all failed with a screen that did not change.
    //
    // NOTE ON THE HARNESS ITSELF: the shared sandbox's document.getElementById returns a
    // fresh truthy stub for ANY id, so `assert.ok(getElementById('phx-notice'))` passes even
    // if the function was never called. That assertion cannot fail and would have been
    // another presence check dressed as a behaviour check. So this test supplies its own
    // recording DOM and inspects the tree _phxNotice actually builds.
    const made = [];
    const mk = (tag) => {
      const n = {
        tagName: String(tag).toUpperCase(), style: {}, children: [], _on: {},
        set cssText(v){}, textContent: '',
        appendChild(c){ this.children.push(c); return c; },
        addEventListener(ev, fn){ (this._on[ev] = this._on[ev] || []).push(fn); },
        remove(){ this._removed = true; },
      };
      n.style = { set cssText(v){}, get cssText(){ return ''; } };
      made.push(n); return n;
    };
    const realDoc = app.document;
    const body = mk('body');
    app.document = {
      getElementById: () => null,
      createElement: mk,
      body,
    };
    let p;
    try {
      p = app._phxNotice('Check-in not saved', 'Nothing has been lost — tap Submit again.');

      assert.equal(body.children.length, 1, '_phxNotice appended exactly one overlay to the body');
      const ov = body.children[0];
      assert.equal(ov.id, 'phx-notice', 'the overlay carries the id the code looks for on re-entry');

      const flat = [];
      (function walk(n){ flat.push(n); n.children.forEach(walk); })(ov);
      const texts = flat.map(n => n.textContent).filter(Boolean);
      assert.ok(texts.includes('Check-in not saved'), 'the title is rendered, got: ' + JSON.stringify(texts));
      assert.ok(texts.some(t => t.includes('Nothing has been lost')), 'the message is rendered');

      const btn = flat.find(n => n.tagName === 'BUTTON');
      assert.ok(btn, 'there is a button to acknowledge with');

      let settled = false;
      p.then(() => { settled = true; });
      await Promise.resolve(); await Promise.resolve();
      assert.equal(settled, false, 'it must NOT resolve before the user acknowledges');

      // An await on a promise that never settles hangs the caller forever — strictly worse
      // than the alert it replaced, and invisible to any presence check.
      btn._on.click.forEach(fn => fn());
      await Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('_phxNotice never resolved — the caller would hang')), 500))]);
      assert.ok(ov._removed, 'the overlay is removed once acknowledged');
    } finally {
      app.document = realDoc;
    }
  });

  test('ENTRY navigating to Stats survives an iOS PWA reload', async () => {
    // Jon: "it keeps reverting to today page". The cause was not the restore failing — it
    // was the WRITER saving a tab the READER refused. Stats was stored on every navigation
    // and discarded at boot, and nothing recorded that a restore had been declined.
    // This drives both halves: navigate, then boot, and assert where he lands.
    reset(); signIn('u-nav');
    const shown = [];
    const realShow = app.showScreen;
    app.showScreen = function(id){ shown.push(id); };
    try {
      app.navTo('stats');
      assert.equal(read('phx_lastTab_v1'), 'stats', 'navigating to Stats records it');

      // iOS discards the page; the app boots fresh and routing heads for Today.
      shown.length = 0;
      app._phxBootRestoreBegin();
      app.navTo('today');                       // what boot routing does
      assert.equal(read('phx_lastTab_v1'), 'stats',
        'boot routing to Today must NOT erase the screen he actually left');
      app._phxBootRestoreApply();
      assert.ok(shown.includes('screen-stats'),
        'after boot settles he is returned to Stats, got: ' + JSON.stringify(shown));
    } finally { app.showScreen = realShow; }
  });

  test('ENTRY a tab the restore would refuse is never recorded', async () => {
    // The invariant the old code broke: writer and reader must agree. Storing a tab that
    // will be refused is indistinguishable, from the outside, from losing the screen.
    reset(); signIn('u-nav2');
    const realShow = app.showScreen;
    app.showScreen = function(){};
    try {
      app.navTo('stats');
      assert.equal(read('phx_lastTab_v1'), 'stats', 'a restorable tab is recorded');
      app.navTo('weekly-checkin');   // deliberately not restorable — a form that reloads empty
      assert.equal(read('phx_lastTab_v1'), 'stats',
        'a non-restorable tab must not overwrite the last restorable one, or he loses both');
    } finally { app.showScreen = realShow; }
  });
}
