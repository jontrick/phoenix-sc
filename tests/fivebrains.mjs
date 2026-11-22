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
        gte(k, v) { q.filters[k + '>='] = v; return chain; },
        lte(k, v) { q.filters[k + '<='] = v; return chain; },
        order(k, o) { q.order = [k, o]; return chain; },
        maybeSingle() { return Promise.resolve(answers[table] || { data: null, error: null }); },
        // Awaited directly (list query): answers[table + ':list'], or a never-settling
        // promise when the answer is the string 'hang'.
        then(ok, bad) {
          const a = answers[table + ':list'];
          const p = a === 'hang' ? new Promise(() => {}) : Promise.resolve(a || { data: [], error: null });
          return p.then(ok, bad);
        },
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

  // ── readiness → coach context (v4.9.445) ─────────────────────────────────────
  const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return app._phxLocalISO(d); };

  test('COACH model keeps scores only — a text column on the view cannot reach the coach', () => {
    const today = app._phxLocalISO();
    const m = app.fbCoachReadinessModel([
      { date: today, sleep_hours: 5.5, energy_am: 3, mood: 6, stress: 8, intention: 'PRIVATE', win: 'PRIVATE', user_id: 'x', water_ml: 900 },
    ], today);
    const txt = JSON.stringify(m);
    assert.notIncludes(txt, 'PRIVATE', 'free text dropped');
    assert.notIncludes(txt, 'user_id', 'ids dropped');
    assert.notIncludes(txt, 'water_ml', 'only the listed fields survive');
    assert.equal(m.today.sleep_hours, 5.5, 'today picked');
    assert.deepEqual(m.today_flags, ['slept under 6h', 'morning energy 3/10'], 'flags computed for today');
    assert.ok(/NOT a low score/.test(m.how_to_read), 'the coach is told null is not low');
    assert.ok(/stress[^.]*higher is WORSE/.test(m.how_to_read), 'stress direction stated');
  });

  test('COACH model: nothing checked in = null; null days dropped; perfect_day alone is not a check-in', () => {
    const today = app._phxLocalISO();
    assert.equal(app.fbCoachReadinessModel([], today), null, 'empty');
    assert.equal(app.fbCoachReadinessModel([{ date: today, sleep_hours: null, mood: null, perfect_day: false, five_brains: {} }], today), null, 'all-null row is no data');
    const m = app.fbCoachReadinessModel([
      { date: today, mood: 7 },
      { date: daysAgo(2), sleep_hours: null },
      { date: daysAgo(1), energy_am: 8 },
    ], today);
    assert.deepEqual(m.last_7_days.map((d) => d.date), [daysAgo(1), today], 'empty day dropped, sorted oldest first');
    assert.equal(m.today.sleep_hours, null, 'unanswered field stays null, never 0');
    assert.deepEqual(m.today_flags, [], 'null sleep does not raise a flag');
  });

  test('COACH no row today still sends the week, with today null', () => {
    const today = app._phxLocalISO();
    const m = app.fbCoachReadinessModel([{ date: daysAgo(1), sleep_hours: 7 }], today);
    assert.equal(m.today, null, 'today null');
    assert.equal(m.last_7_days.length, 1, 'history kept');
  });

  test('COACH fbCoachReadiness asks for an explicit 7-day, scores-only column list', () => {
    reset(); signIn(UID);
    const today = app._phxLocalISO();
    return withSb({ 'brains_wellbeing_day:list': { data: [{ date: today, mood: 6 }], error: null } }, (calls) =>
      app.fbCoachReadiness().then((m) => {
        const q = calls.find((c) => c.table === 'brains_wellbeing_day');
        assert.ok(q.cols && q.cols.indexOf('*') < 0, 'no select(*) — got ' + q.cols);
        ['intention', 'win', 'gratitude', 'user_id'].forEach((c) => assert.ok(q.cols.indexOf(c) < 0, c + ' not requested'));
        assert.equal(q.filters['date>='], daysAgo(6), '7 local days');
        assert.equal(q.filters['date<='], today, 'up to today');
        assert.equal(m.today.mood, 6, 'model built from the answer');
      }));
  });

  test('COACH error, signed out, or a hung query all give null — never block the reply', () => {
    reset(); signIn(UID);
    const realST = app.setTimeout;
    return withSb({ 'brains_wellbeing_day:list': { data: null, error: { code: '42P01', message: 'x' } } }, () =>
      app.fbCoachReadiness().then((m) => assert.equal(m, null, 'error → null')))
      .then(() => withSb({ 'brains_wellbeing_day:list': 'hang' }, () => {
        app.setTimeout = (fn) => { fn(); return 0; };          // fire the cap at once
        return app.fbCoachReadiness(10).then((m) => assert.equal(m, null, 'hung query → null via the cap'));
      }))
      .then(() => { signIn(null); return app.fbCoachReadiness().then((m) => assert.equal(m, null, 'signed out → null')); })
      .finally(() => { app.setTimeout = realST; });
  });

  // Drive the REAL chat entry points and read what reaches the worker.
  const driveCoach = (fn, listAnswer) => {
    reset(); signIn(UID);
    const saved = {};
    const stubs = {
      _mcLoadRecentDataForContext: async () => ({}),
      _mcLoadHistory: async () => [],
      _mcSaveMessage: () => {},
      _phxUpdateMyCoachTilePreview: () => {},
      buildAthleteProfile: () => '{}',
    };
    Object.keys(stubs).forEach((k) => { saved[k] = app[k]; app[k] = stubs[k]; });
    const realFetch = app.fetch;
    let body = null;
    app.fetch = (url, opts) => { body = JSON.parse(opts.body); return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ content: [{ text: 'ok' }] }) }); };
    return withSb({ 'brains_wellbeing_day:list': listAnswer }, () => fn().then(() => body))
      .finally(() => { app.fetch = realFetch; Object.keys(saved).forEach((k) => { app[k] = saved[k]; }); });
  };
  const ctxOf = (body) => {
    const txt = body.messages[0].content;
    return JSON.parse(txt.slice(txt.indexOf('```json') + 7, txt.lastIndexOf('```')));
  };

  test('COACH sendCoachMessage sends five_brains_readiness to the worker', () => {
    const today = app._phxLocalISO();
    return driveCoach(() => app.sendCoachMessage('how should I train today?'),
      { data: [{ date: today, sleep_hours: 5, energy_am: 7 }], error: null }).then((body) => {
      assert.ok(body, 'the worker was called');
      const ctx = ctxOf(body);
      assert.ok(ctx.five_brains_readiness, 'readiness present in the context preface');
      assert.equal(ctx.five_brains_readiness.today.sleep_hours, 5, 'today’s sleep reaches the coach');
      assert.deepEqual(ctx.five_brains_readiness.today_flags, ['slept under 6h'], 'flag reaches the coach');
    });
  });

  test('COACH sendCoachMessage with no 5 Brains data omits the key entirely', () =>
    driveCoach(() => app.sendCoachMessage('hi'), { data: [], error: null }).then((body) => {
      assert.ok(body, 'the worker was still called');
      assert.ok(!('five_brains_readiness' in ctxOf(body)), 'no key, not a null or empty block');
    }));

  test('COACH opening message carries the same readiness', () => {
    const today = app._phxLocalISO();
    return driveCoach(() => app._mcGenerateOpeningMessage(),
      { data: [{ date: today, mood: 4 }], error: null }).then((body) => {
      assert.ok(body, 'the worker was called');
      assert.ok(body.messages[0].content.indexOf('five_brains_readiness') >= 0, 'readiness in the opening prompt');
    });
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

  // ── meal ticks OUT (v4.9.446) — contract: five-brains PHOENIX_BRIEF_MEALS.md ──
  const feeds = () => app.nut2Day(app._nutToday()).feeds;
  const firstMeal = () => feeds().filter((f) => !f.drinks)[0];
  const feedUps = (calls) => calls.filter((c) => c.table === 'feed_events' && c.op === 'upsert');

  test('FEED OUT ticking a meal upserts feed_events with the tick time, through nut2SetFeed', () => {
    setUp();
    const d = app._nutToday(), m = firstMeal();
    return withSb({}, (calls) => {
      const before = Date.now();
      app.nut2SetFeed(d, m.id, { eaten: true });
      const ups = feedUps(calls);
      assert.equal(ups.length, 1, 'one write per tick');
      const r = ups[0].row;
      assert.equal(r.feed_id, m.id, 'keyed on the feed id');
      assert.equal(r.date, d, 'LOCAL day key');
      assert.equal(r.user_id, UID, 'owner');
      assert.equal(r.eaten, true, 'eaten');
      assert.ok(Date.parse(r.eaten_at) >= before - 5, 'eaten_at is the tick moment');
      assert.equal(r.name, m.name, 'name carried');
      assert.equal(r.source, 'phoenix', 'writer tagged');
      assert.equal(ups[0].opts && ups[0].opts.onConflict, 'user_id,date,feed_id', 'upsert, never append');
      assert.ok(!('location' in r) && !('note' in r), '5 Brains-owned columns are never sent');
    });
  });

  test('FEED OUT re-ticking an eaten meal sends nothing and keeps the original time', () => {
    setUp();
    const d = app._nutToday(), m = firstMeal();
    return withSb({}, (calls) => {
      app.nut2SetFeed(d, m.id, { eaten: true });
      const t1 = feedUps(calls)[0].row.eaten_at;
      app.nut2SetFeed(d, m.id, { eaten: true });
      assert.equal(feedUps(calls).length, 1, 'no second write');
      assert.equal(app.nut2Day(d).feeds.find((f) => f.id === m.id).eaten_at, t1, 'local stamp unchanged');
    });
  });

  test('FEED OUT unticking sends eaten false and clears the time', () => {
    setUp();
    const d = app._nutToday(), m = firstMeal();
    return withSb({}, (calls) => {
      app.nut2SetFeed(d, m.id, { eaten: true });
      app.nut2SetFeed(d, m.id, { eaten: false });
      const ups = feedUps(calls);
      assert.equal(ups.length, 2, 'untick is a write');
      assert.equal(ups[1].row.eaten, false, 'not eaten');
      assert.equal(ups[1].row.eaten_at, null, 'time cleared');
    });
  });

  test('FEED OUT renaming or retiming a feed is not a tick and sends nothing', () => {
    setUp();
    const d = app._nutToday(), m = firstMeal();
    return withSb({}, (calls) => {
      app.nut2SetFeed(d, m.id, { name: 'Brekkie' });
      app.nut2SetFeed(d, m.id, { time: '07:15' });
      assert.equal(feedUps(calls).length, 0, 'no feed_events write');
    });
  });

  test('FEED OUT morning drinks are not a meal and are never sent', () => {
    setUp();
    const d = app._nutToday(), dr = feeds().filter((f) => f.drinks)[0];
    assert.ok(dr, 'fixture has a drinks feed');
    return withSb({}, (calls) => {
      app.nut2SetFeed(d, dr.id, { eaten: true });
      assert.equal(feedUps(calls).length, 0, 'skipped');
    });
  });

  test('FEED OUT an empty feed sends null macros — unknown is not zero', () => {
    setUp();
    const d = app._nutToday(), m = firstMeal();
    return withSb({}, (calls) => {
      app.nut2SetFeed(d, m.id, { eaten: true });
      const r = feedUps(calls)[0].row;
      assert.equal(r.kcal, null, 'kcal null');
      assert.equal(r.protein_g, null, 'protein null');
    });
  });

  test('FEED OUT a failed upsert lands in phx_last_write_error as fbFeed, no values', () => {
    setUp();
    app.localStorage.removeItem('phx_last_write_error');
    const d = app._nutToday(), m = firstMeal();
    return withSb({ 'feed_events:upsert': { error: { code: '42P01', message: 'relation "feed_events" does not exist' } } }, () => {
      const p = app.fbPushFeed(d, Object.assign({}, m, { eaten: true }), null);
      assert.ok(p && typeof p.then === 'function', 'returns a thenable');
      return p.then(() => {
        const raw = read('phx_last_write_error');
        const snap = typeof raw === 'string' ? JSON.parse(raw) : raw;
        assert.ok(snap && String(snap.context) === 'fbFeed', 'context is fbFeed, got ' + (snap && snap.context));
        assert.equal(snap.code, '42P01', 'code carried');
        assert.notIncludes(JSON.stringify(snap.payload_shape), m.name, 'no meal name in the record');
      });
    });
  });

  test('FEED OUT signed out = no write; the tick still saves locally', () => {
    setUp(); signIn(null);
    return withSb({}, (calls) => {
      assert.equal(app.fbPushFeed(app._nutToday(), { id: 'F1', name: 'Breakfast', eaten: true }, null), null, 'nothing sent');
      assert.equal(calls.length, 0, 'no query');
    });
  });
}
