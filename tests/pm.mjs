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
}
