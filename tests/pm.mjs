// PM-owned shared plumbing — functional tests.
export default function ({ test, assert, app }) {
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
  test('CONTRACT _phxRecordWriteError: ring keeps the last 8, never throws', () => {
    app.localStorage.removeItem('phx_write_errors');
    for (let i = 0; i < 12; i++) app._phxRecordWriteError('ctx' + i, { message: 'e' + i }, {});
    const ring = JSON.parse(app.localStorage.getItem('phx_write_errors'));
    assert.equal(ring.length, 8, 'ring capped at 8');
    assert.equal(ring[7].context, 'ctx11', 'newest retained');
    assert.equal(ring[0].context, 'ctx4', 'oldest evicted');
    // Callers wrap cloud writes in this; it must never become the thing that throws.
    app._phxRecordWriteError(undefined, undefined, undefined);
    app._phxRecordWriteError('c', null, (() => { const o = {}; o.self = o; return o; })());
    assert.ok(true, 'survived undefined args and a circular payload');
  });
}
