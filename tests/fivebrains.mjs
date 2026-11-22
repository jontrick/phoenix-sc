// 5 BRAINS LINK — functional tests (v4.9.444). Run: node functional_check.mjs fivebrains
//
// Contract: five-brains repo PHOENIX_BRIEF.md. Covers the three behaviours that
// shipped together:
//   · water OUT  — every Phoenix water change upserts daily_water (source 'phoenix')
//   · water IN   — a NEWER 5 Brains total replaces water_ml; water_log untouched
//   · weigh-in   — a 5 Brains daily_weigh_ins row feeds nutRecordWeight + done flag
//   · readiness  — null view fields mean "not checked in", never a low score
// Dates are derived from the app's own clock, never literals.

import { readFileSync } from 'node:fs';
import path from 'node:path';

const UID = 'u-fb';
const NUT_KEY = `phx_nut_v1_${UID}`;

// Minimal supabase-js stand-in: records calls, answers maybeSingle/upsert.
function stubSb(answers) {
  const calls = [];
  const sb = {
    from(table) {
      const q = { table, filters: {}, op: null, row: null, opts: null };
      calls.push(q);
      const chain = {
        select(cols) { q.op = 'select'; q.cols = cols; return chain; },
        eq(k, v) { q.filters[k] = v; return chain; },
        maybeSingle() { return Promise.resolve(answers[table] || { data: null, error: null }); },
        upsert(row, opts) {
          q.op = 'upsert'; q.row = row; q.opts = opts;
          return Promise.resolve(answers[table + ':upsert'] || { error: null });
        },
      };
      return chain;
    },
  };
  return { sb, calls };
}

export default function ({ test, assert, app, signIn, seed, read, reset }) {
  const setUp = (daily) => {
    reset(); signIn(UID);
    seed(NUT_KEY, { setup_done: true, water_target_ml: 3000, daily: daily || {} });
  };
  const withSb = (answers, fn) => {
    const real = app.sb;
    const s = stubSb(answers);
    app.sb = s.sb;
    const out = (() => { try { return fn(s.calls); } catch (e) { app.sb = real; throw e; } })();
    if (out && typeof out.then === 'function') return out.finally(() => { app.sb = real; });
    app.sb = real;
    return out;
  };

  // ── water OUT ──────────────────────────────────────────────────────────────
  test('WATER OUT nutAddWater upserts the day total to daily_water as phoenix', () => {
    setUp();
    return withSb({}, (calls) => {
      app.nutAddWater(500);
      app.nutAddWater(330);
      const ups = calls.filter((c) => c.table === 'daily_water' && c.op === 'upsert');
      assert.equal(ups.length, 2, 'one upsert per tap, driven through the real entry point');
      const last = ups[1];
      assert.equal(last.row.water_ml, 830, 'sends the running TOTAL, not the drink');
      assert.equal(last.row.target_ml, 3000, 'carries the target');
      assert.equal(last.row.source, 'phoenix', 'tags the writer');
      assert.equal(last.row.user_id, UID, 'owner is the signed-in user');
      assert.equal(last.row.date, app._nutToday(), 'LOCAL day key');
      assert.equal(last.opts && last.opts.onConflict, 'user_id,date', 'upsert, never append');
    });
  });

  test('WATER OUT undo pushes the reduced total too', () => {
    setUp();
    return withSb({}, (calls) => {
      app.nutAddWater(1000);
      app.nutUndoLastWater();
      const ups = calls.filter((c) => c.table === 'daily_water' && c.op === 'upsert');
      assert.equal(ups.length, 2, 'undo is a write as well');
      assert.equal(ups[1].row.water_ml, 0, 'the undone total reaches the cloud');
    });
  });

  test('WATER OUT a failed upsert lands in phx_last_write_error, amounts redacted', () => {
    setUp();
    app.localStorage.removeItem('phx_last_write_error');
    return withSb({ 'daily_water:upsert': { error: { code: '42P01', message: 'relation "daily_water" does not exist' } } }, () => {
      const p = app.fbPushWater(app._nutToday());
      assert.ok(p && typeof p.then === 'function', 'returns a thenable');
      return p.then(() => {
        const raw = read('phx_last_write_error');
        const snap = typeof raw === 'string' ? JSON.parse(raw) : raw;
        assert.ok(snap && String(snap.context) === 'fbWater', 'context is fbWater, got ' + (snap && snap.context));
        assert.equal(snap.code, '42P01', 'code carried');
        assert.notIncludes(JSON.stringify(snap.payload_shape), '3000', 'no amounts in the record');
      });
    });
  });

  test('WATER OUT signed out = no write at all', () => {
    setUp(); signIn(null);
    return withSb({}, (calls) => {
      assert.equal(app.fbPushWater(), null, 'nothing sent');
      assert.equal(calls.length, 0, 'no query issued');
    });
  });

  // ── water IN ───────────────────────────────────────────────────────────────
  test('WATER IN a newer five-brains total replaces water_ml and leaves water_log alone', () => {
    const today = app._nutToday();
    setUp({ [today]: { water_ml: 500, water_log: [500] } });
    const future = new Date(Date.now() + 60000).toISOString().replace('Z', '123+00:00');
    return withSb({ daily_water: { data: { water_ml: 1750, source: 'five-brains', updated_at: future }, error: null } }, () =>
      app.fbPullWater().then((applied) => {
        assert.equal(applied, true, 'applied');
        const day = read(NUT_KEY).daily[today];
        assert.equal(day.water_ml, 1750, 'total adopted (microsecond timestamp parsed)');
        assert.deepEqual(day.water_log, [500], 'Phoenix undo still only reverses Phoenix taps');
      }));
  });

  test('WATER IN an older five-brains row does not overwrite a newer Phoenix tap', () => {
    const today = app._nutToday();
    setUp({ [today]: { water_ml: 500, water_log: [500] } });
    return withSb({}, () => {
      app.fbPushWater(today);                       // stamps "now" locally
      const past = new Date(Date.now() - 3600000).toISOString();
      assert.equal(app.fbApplyRemoteWater(UID, today, { water_ml: 2000, source: 'five-brains', updated_at: past }), false, 'stale row refused');
      assert.equal(read(NUT_KEY).daily[today].water_ml, 500, 'local total kept');
    });
  });

  test('WATER IN Phoenix\'s own echo is ignored', () => {
    const today = app._nutToday();
    setUp({ [today]: { water_ml: 500 } });
    const future = new Date(Date.now() + 60000).toISOString();
    assert.equal(app.fbApplyRemoteWater(UID, today, { water_ml: 900, source: 'phoenix', updated_at: future }), false, 'source phoenix never applied');
    assert.equal(read(NUT_KEY).daily[today].water_ml, 500, 'unchanged');
  });

  // ── weigh-in IN ────────────────────────────────────────────────────────────
  test('WEIGH-IN a 5 Brains row feeds nutRecordWeight and sets the morning done flag', () => {
    const keys = app._phxMorningKeys();
    setUp();
    return withSb({ daily_weigh_ins: { data: { weight_kg: 96.4 }, error: null } }, (calls) =>
      app.fbPullWeighIn().then((applied) => {
        assert.equal(applied, true, 'applied');
        assert.equal(read(NUT_KEY).daily[keys.today].weight_kg, 96.4, 'authoritative weight log written');
        assert.equal(String(read(keys.doneKey)), '1', 'morning card will not prompt again');
        assert.equal(read('phoenix_last_weighin').weight_kg, 96.4, 'last-weigh-in cache follows');
        const q = calls.find((c) => c.table === 'daily_weigh_ins');
        assert.equal(q.filters.date, keys.today, 'asks for today only');
        assert.equal(q.filters.user_id, UID, 'own rows only');
      }));
  });

  test('WEIGH-IN a local weight already logged today means no query, no overwrite', () => {
    const keys = app._phxMorningKeys();
    setUp({ [keys.today]: { weight_kg: 95.0 } });
    return withSb({ daily_weigh_ins: { data: { weight_kg: 99 }, error: null } }, (calls) =>
      app.fbPullWeighIn().then((applied) => {
        assert.equal(applied, false, 'skipped');
        assert.equal(calls.length, 0, 'no query issued');
        assert.equal(read(NUT_KEY).daily[keys.today].weight_kg, 95, 'local kept');
      }));
  });

  test('WEIGH-IN no cloud row = nothing changes', () => {
    const keys = app._phxMorningKeys();
    setUp();
    return withSb({}, () =>
      app.fbPullWeighIn().then((applied) => {
        assert.equal(applied, false, 'nothing applied');
        assert.ok(!read(keys.doneKey), 'card still prompts');
      }));
  });

  // ── readiness ──────────────────────────────────────────────────────────────
  test('READINESS no row, or a row of nulls, hides the chip — not checked in is not low', () => {
    assert.equal(app.fbReadinessModel(null, 'Upper — Max Effort'), null, 'no row');
    assert.equal(app.fbReadinessModel({ sleep_hours: null, energy_am: null, mood: null, stress: null }, 'Upper — Max Effort'), null, 'all null');
  });

  test('READINESS short sleep before Max Effort says so', () => {
    const m = app.fbReadinessModel({ sleep_hours: 5.5, energy_am: 7, mood: null, stress: 3 }, 'Upper — Max Effort');
    assert.equal(m.low, true, 'flagged');
    assert.ok(m.note.indexOf('Max Effort') === 0, 'names the session, got ' + m.note);
    assert.ok(m.note.indexOf('sleep under 6h') > 0, 'names the reason');
    assert.notIncludes(m.line, 'Mood', 'a null field is left out, not shown as 0');
  });

  test('READINESS energy 4 or less flags on any day; a good morning does not', () => {
    assert.equal(app.fbReadinessModel({ sleep_hours: 8, energy_am: 4 }, 'Conditioning').low, true, 'energy 4 flags');
    const ok = app.fbReadinessModel({ sleep_hours: 7.5, energy_am: 8, mood: 7, stress: 3 }, 'Upper — Max Effort');
    assert.equal(ok.low, false, 'not flagged');
    assert.equal(ok.note, '', 'no warning text');
    assert.equal(ok.line, 'Sleep 7.5h · Energy 8/10 · Mood 7/10 · Stress 3/10', 'summary line');
  });

  test('READINESS fbFetchWellbeing + fbRenderReadinessChip DRAW the chip into Today', () => {
    reset(); signIn(UID);
    const chip = { innerHTML: '', style: {} };
    const name = { textContent: 'Lower — Max Effort' };
    const realGet = app.document.getElementById;
    app.document.getElementById = (id) => (id === 'today-readiness-chip' ? chip : id === 'today-session-name' ? name : null);
    return withSb({ brains_wellbeing_day: { data: { sleep_hours: 5, energy_am: 6 }, error: null } }, (calls) =>
      app.fbFetchWellbeing().then(() => {
        app.fbRenderReadinessChip();
        assert.ok(chip.innerHTML.indexOf('Readiness') >= 0, 'chip drawn');
        assert.ok(chip.innerHTML.indexOf('Max Effort today with sleep under 6h') >= 0, 'warning drawn');
        const q = calls.find((c) => c.table === 'brains_wellbeing_day');
        assert.equal(q.filters.date, app._phxLocalISO(), 'today only');
      })).finally(() => { app.document.getElementById = realGet; });
  });

  // ── privacy + wiring (STRUCTURAL — the behaviour is proven by the cases above) ──
  test('STRUCTURAL Phoenix source never names brains_entry (journal text stays in 5 Brains)', () => {
    const html = readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'index.html'), 'utf8');
    const hits = (html.match(/brains_entry/g) || []).length;
    // Floor: prove the scan read the file at all.
    assert.ok(html.indexOf('brains_wellbeing_day') > 0, 'scan read the file (finds the view name)');
    // The block header names it once, in a comment, to say it is NOT read.
    assert.ok(hits <= 1, 'brains_entry appears ' + hits + ' times');
    assert.ok(!/from\(\s*['"]brains_entry/.test(html), 'no query on brains_entry');
  });

  test('STRUCTURAL renderTodayScreen calls fbSyncOnOpen', () => {
    const src = String(app.renderTodayScreen);
    assert.ok(src.indexOf('fbSyncOnOpen') > 0, 'wired into the Today render');
  });
}
