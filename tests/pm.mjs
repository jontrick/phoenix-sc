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
}
