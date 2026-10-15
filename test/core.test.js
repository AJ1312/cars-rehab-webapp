// Unit tests for the pure logic: node --test test/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../src/lib/core.js');

const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

const placers = (seed, kind, level) => {
  const rng = C.makeRng(seed);
  return { rng, placer: C.makePlacer(rng, kind, level), src: C.makeItemSource(rng, level) };
};

test('Maths Fun: every number shown is a whole number from 1 to 10 (20,000 items, all levels, both frames)', () => {
  const seen = { '+': 0, '-': 0 };
  for (const kind of ['linear', 'angular']) {
    for (const level of [1, 2, 3]) {
      const { placer, src } = placers(12345 + level, kind, level);
      let prevKey, prevZone;
      for (let i = 0; i < 3300; i++) {
        const it = src.maths(placer, prevKey, prevZone);
        const nums = [it.a, it.b, it.answer, ...it.options.map((o) => o.value)];
        for (const n of nums) {
          assert.ok(Number.isInteger(n), 'integer ' + n);
          assert.ok(n >= 1 && n <= 10, 'out of range: ' + JSON.stringify(it));
        }
        assert.equal(it.op === '+' ? it.a + it.b : it.a - it.b, it.answer);
        if (level === 1) assert.equal(it.op, '+', 'level 1 is addition only');
        assert.equal(it.options.length, level === 1 ? 3 : 4);
        assert.equal(it.options.filter((o) => o.correct).length, 1);
        assert.equal(new Set(it.options.map((o) => o.value)).size, it.options.length, 'options distinct');
        assert.notEqual(it.key, prevKey, 'no immediate repeat');
        for (const m of it.display.match(/\d+/g)) assert.ok(+m >= 1 && +m <= 10);
        // Every option floats in a different region, clearly apart from the others
        assert.equal(new Set(it.options.map((o) => o.zone)).size, it.options.length, 'distinct zones');
        for (let x = 0; x < it.options.length; x++) for (let y = x + 1; y < it.options.length; y++) assert.ok(C.v3.dist(it.options[x].pos, it.options[y].pos) >= placer.clearance - 1e-9, 'options apart');
        seen[it.op]++;
        prevKey = it.key;
        const correct = it.options.find((o) => o.correct);
        if (prevZone !== undefined) assert.notEqual(correct.zone, prevZone, 'correct answer never in the same region twice in a row');
        prevZone = correct.zone;
      }
    }
  }
  assert.ok(seen['-'] > 6000, 'subtraction appears at levels 2-3');
});

test('Maths Fun: operands, answers and layouts are well spread (not predictable)', () => {
  const { placer, src } = placers(77, 'linear', 2);
  const ans = new Array(11).fill(0), zones = {}, firstZone = {};
  let prevZone;
  for (let i = 0; i < 4000; i++) {
    const it = src.maths(placer, undefined, prevZone);
    ans[it.answer]++;
    const c = it.options.find((o) => o.correct);
    zones[c.zone] = (zones[c.zone] || 0) + 1;
    prevZone = c.zone;
  }
  for (let v = 1; v <= 9; v++) assert.ok(ans[v] > 100, 'answer ' + v + ' appears');
  assert.equal(Object.keys(zones).length, 8, 'the correct answer visits all 8 regions');
  for (const z of Object.keys(zones)) assert.ok(zones[z] > 300 && zones[z] < 700, z + ' share ' + zones[z]);
  void firstZone;
});

test('Triangle Reach: targets float at random 3-D points, balanced over 8 regions, always far from the previous one', () => {
  for (const kind of ['linear', 'angular']) {
    for (const level of [1, 2, 3]) {
      for (let seed = 1; seed <= 40; seed++) {
        const { placer } = placers(seed, kind, level);
        const R = C.reachRadius(kind, level);
        let prev = null;
        const counts = {};
        const order = [];
        for (let i = 0; i < 64; i++) {
          const t = placer.next(prev);
          counts[t.zone] = (counts[t.zone] || 0) + 1;
          order.push(t.zone);
          if (prev) {
            const d = C.v3.dist(prev.pos, t.pos);
            assert.ok(d >= 0.5 * R && d >= placer.clearance - 1e-9, `${kind} L${level} seed ${seed} step ${i}: gap ${d} (R ${R})`);
          }
          // always well away from the start point (the home gate)
          assert.ok(Math.hypot(...t.pos) >= 0.5 * R, 'far from the start point');
          prev = t;
        }
        // Balanced: each of the 8 regions used 8 times in 64 (bag), +/- 1 for skipped cells
        assert.equal(Object.keys(counts).length, 8);
        for (const z of Object.keys(counts)) assert.ok(counts[z] >= 4 && counts[z] <= 12, z + ' ' + counts[z]);
        // Not a repeating pattern: the order differs between seeds
        if (seed === 1) globalThis.__first = order.join();
        if (seed === 2) assert.notEqual(order.join(), globalThis.__first);
      }
    }
  }
});

test('Triangle Reach: 6-DoF targets keep strong reaching and body movement (level 2: typical gap well over 25 cm)', () => {
  const { placer } = placers(4242, 'linear', 2);
  let prev = null, sum = 0, n = 0, minGap = Infinity;
  for (let i = 0; i < 2000; i++) {
    const t = placer.next(prev);
    if (prev) { const d = C.v3.dist(prev.pos, t.pos); sum += d; n++; minGap = Math.min(minGap, d); }
    prev = t;
  }
  assert.ok(sum / n > 0.30, 'mean gap ' + sum / n);
  assert.ok(minGap >= 0.15, 'min gap ' + minGap);
});

test('Placement geometry: positions match their azimuth, elevation and reach', () => {
  const { placer } = placers(3, 'linear', 3);
  for (let i = 0; i < 200; i++) {
    const t = placer.next(null);
    const [x, y, z] = t.pos;
    const rho = Math.hypot(x, y, z);
    assert.ok(close(rho * 100, t.reachCm, 0.06));
    assert.ok(rho <= 0.4 + 1e-9 && rho >= 0.55 * 0.4 - 1e-9);
    assert.ok(close(Math.asin(y / rho) / C.DEG, t.el, 0.06));
    assert.ok(close(Math.atan2(x, z) / C.DEG, t.az, 0.06));
    assert.equal(t.zone.startsWith(t.az < 0 ? 'left' : 'right'), true);
    assert.equal(t.zone.includes(t.el < 0 ? 'low' : 'high'), true);
  }
});

test('Colour Merge Test: exactly one option has the target ink; distractor words never match their own ink', () => {
  let cong = 0, n = 0;
  for (const kind of ['linear', 'angular']) {
    for (const level of [1, 2, 3]) {
      const { placer, src } = placers(2024 + level, kind, level);
      let prev, prevZone;
      for (let i = 0; i < 1700; i++) {
        const it = src.colour(placer, prev, prevZone);
        assert.equal(it.options.length, level === 1 ? 3 : 4);
        const withInk = it.options.filter((o) => o.ink === it.targetInk);
        assert.equal(withInk.length, 1);
        assert.ok(withInk[0].correct);
        assert.equal(new Set(it.options.map((o) => o.ink)).size, it.options.length, 'inks distinct');
        it.options.filter((o) => !o.correct).forEach((o) => assert.notEqual(o.word, o.ink));
        assert.ok(it.options.some((o) => !o.correct && o.word === it.targetInk), 'a distractor names the target colour');
        assert.equal(it.congruent, withInk[0].word === withInk[0].ink);
        assert.notEqual(it.targetInk, prev);
        assert.equal(new Set(it.options.map((o) => o.zone)).size, it.options.length);
        if (it.congruent) cong++;
        n++;
        prev = it.targetInk;
        prevZone = withInk[0].zone;
      }
    }
  }
  const share = cong / n;
  assert.ok(share > 0.23 && share < 0.27, 'exactly about 25% congruent (bag), got ' + share);
});

test('Device orientation -> camera quaternion', () => {
  // Phone upright facing the user (beta 90): camera looks straight ahead (-z)
  let f = C.forwardOf(C.deviceOrientationToQuat(0, 90, 0, 0));
  assert.ok(close(f[0], 0) && close(f[1], 0) && close(f[2], -1));
  // Flat on a table, screen up: camera looks down
  f = C.forwardOf(C.deviceOrientationToQuat(0, 0, 0, 0));
  assert.ok(close(f[1], -1));
  // Upright and turned 90 deg left (alpha 90): camera looks to -x
  f = C.forwardOf(C.deviceOrientationToQuat(90, 90, 0, 0));
  assert.ok(close(f[0], -1, 1e-9));
  // Landscape (screen angle 90) held upright: camera looks horizontally, screen 'up' stays world-up
  const ql = C.deviceOrientationToQuat(0, 0, -90, 90);
  f = C.forwardOf(ql);
  assert.ok(close(f[1], 0, 1e-9), 'landscape forward ' + f);
  assert.ok(close(C.quat.rotate(ql, [0, 1, 0])[1], 1, 1e-9), 'screen up is world up');
});

test('Yaw/pitch round-trip and calibration frame', () => {
  for (const [y, p] of [[0, 0], [0.4, 0.2], [-0.7, -0.3], [1.2, 0.5]]) {
    const q = C.quat.fromYawPitch(y, p);
    const back = C.yawPitchToward(C.forwardOf(q));
    assert.ok(close(back.yaw, y, 1e-9) && close(back.pitch, p, 1e-9));
    const ypr = C.yawPitchRoll(q);
    assert.ok(close(ypr[0], -y / C.DEG, 1e-6), 'reported yaw is positive to the right');
    assert.ok(close(ypr[1], p / C.DEG, 1e-6));
    assert.ok(close(ypr[2], 0, 1e-6));
  }
  const cal = C.makeCalibration('angular', [0, 0, 0], [0, 0, -1], 0.5);
  const right = C.toCalFrame(cal, C.calToWorld(cal, C.rangePoint('angular', 2, 0)));
  const up = C.toCalFrame(cal, C.calToWorld(cal, C.rangePoint('angular', 2, 90)));
  assert.ok(right[0] > 0.2 && close(right[1], 0, 1e-9));
  assert.ok(up[1] > 0.2 && close(up[0], 0, 1e-9));
  // Angular target sits at the level's angle from the centre direction
  const w = C.calToWorld(cal, C.rangePoint('angular', 3, 135));
  const ang = Math.acos(C.v3.dot(C.v3.norm(w), cal.c)) / C.DEG;
  assert.ok(close(ang, 40, 1e-6));
  // 6-DoF frame is gravity aligned: tilting the phone at calibration does not tilt "up"
  const lin = C.makeCalibration('linear', [0, 1.2, 0], [0, -0.5, -1], C.AHEAD_6DOF_M);
  assert.ok(close(lin.u[1], 1, 1e-9) && close(lin.c[1], 0, 1e-9));
  const hand = C.toCalFrame(lin, [0.1, 1.3, -0.2]);
  assert.ok(close(hand[0], 0.1) && close(hand[1], 0.1) && close(hand[2], 0.2));
  assert.ok(C.v3.dist(C.calToWorld(lin, hand), [0.1, 1.3, -0.2]) < 1e-12);
});

test('One-Euro filter cuts jitter while still following a reach', () => {
  const rng = C.makeRng(5);
  const f = new C.OneEuro3();
  let rawSS = 0, filtSS = 0;
  for (let i = 0; i < 300; i++) {
    const t = i / 60;
    const noise = [(rng.next() - 0.5) * 0.01, (rng.next() - 0.5) * 0.01, 0];
    const out = f.filter(noise, t);
    if (i > 30) { rawSS += noise[0] ** 2 + noise[1] ** 2; filtSS += out[0] ** 2 + out[1] ** 2; }
  }
  assert.ok(filtSS < rawSS * 0.35, 'jitter reduced by > 65%');
  // Fast 30 cm reach in 0.5 s: filter lag after the move under 2 cm within 150 ms
  const g = new C.OneEuro3();
  let out;
  for (let i = 0; i <= 60; i++) {
    const t = i / 60;
    const x = t < 0.5 ? 0.3 * (t / 0.5) : 0.3;
    out = g.filter([x, 0, 0], t + 1);
  }
  assert.ok(Math.abs(out[0] - 0.3) < 0.02, 'settled at ' + out[0]);
});

test('Tracking health: dropout after 250 ms, recovery after 500 ms steady, counters', () => {
  const h = new C.TrackingHealth();
  const events = [];
  let t = 0;
  const run = (until, valid) => { for (; t <= until; t += 16) { if (valid) h.sample(t, true); const e = h.tick(t); if (e) events.push([e, t]); } };
  run(1000, true);
  assert.equal(h.state, 'ok');
  run(1400, false); // 400 ms gap
  assert.equal(h.state, 'lost');
  assert.equal(h.dropouts, 1);
  const lostAt = events.find((e) => e[0] === 'lost')[1];
  assert.ok(lostAt > 992 + 250 && lostAt <= 992 + 250 + 16, 'lost at ' + lostAt); // last valid sample at 992 ms
  run(1700, true);
  assert.equal(h.state, 'lost', 'needs 500 ms of steady tracking');
  run(2200, true);
  assert.equal(h.state, 'ok');
  assert.ok(h.lostMs > 640 && h.lostMs < 700, 'lost time ' + h.lostMs); // detection (1248) to recovery (~1920)
  // Short glitch under 250 ms is not a dropout
  run(2300, false); run(2600, true);
  assert.equal(h.dropouts, 1);
});

test('Calibration checks: rate and jitter thresholds', () => {
  const steady = [];
  for (let i = 0; i < 120; i++) steady.push({ t: i * 16.7, cursor: [0.001 * Math.sin(i), 0, -0.5] });
  let r = C.measureCalibration(steady, 'motion');
  assert.ok(r.pass, JSON.stringify(r));
  assert.ok(r.rateHz > 55 && r.rateHz < 65);
  const shaky = steady.map((s, i) => ({ t: s.t, cursor: [0.03 * Math.sin(i), 0, -0.5] }));
  r = C.measureCalibration(shaky, 'motion');
  assert.equal(r.pass, false);
  assert.match(r.reasons[0], /moved/);
  const slow = [];
  for (let i = 0; i < 20; i++) slow.push({ t: i * 100, cursor: [0, 0, -0.5] });
  r = C.measureCalibration(slow, '6dof');
  assert.equal(r.pass, false);
  assert.match(r.reasons[0], /Hz/);
  assert.equal(C.measureCalibration([], 'motion').pass, false);
});

test('Reach metrics: straight reach has efficiency near 1, curved reach lower', () => {
  const tr = new C.ReachTracker(0, [0, 0, 0]);
  for (let i = 1; i <= 30; i++) tr.update(i * 16, [0.3 * i / 30, 0, 0]);
  const m = tr.finish(480, [0.3, 0, 0], 730);
  assert.ok(m.pathEff > 0.99);
  assert.equal(m.respMs, 730);
  assert.ok(m.rtMs >= 16 && m.rtMs <= 48);
  assert.equal(m.straightCm, 30);
  const tc = new C.ReachTracker(0, [0, 0, 0]);
  for (let i = 1; i <= 60; i++) { const a = Math.PI * i / 60; tc.update(i * 16, [0.15 - 0.15 * Math.cos(a), 0.15 * Math.sin(a), 0]); }
  const mc = tc.finish(960, [0.3, 0, 0]);
  assert.ok(mc.pathEff < 0.7 && mc.pathEff > 0.6, 'semicircle efficiency ' + mc.pathEff);
});

const { fakeSession } = require('./fixtures.js');

test('Summaries: trial and game rows', () => {
  const s = fakeSession('a', 3);
  const tr = C.summarizeTrials(s);
  assert.equal(tr.length, 6);
  assert.equal(tr[0].score, 5);
  assert.equal(tr[0].misses, 1);
  assert.equal(tr[2].errors, 1);
  assert.equal(tr[2].accuracy_pct, 83.3);
  const gr = C.summarizeGames(s, tr);
  assert.equal(gr.length, 3);
  const col = gr.find((r) => r.game === 'Colour Merge Test');
  assert.equal(col.stroop_interference_ms, 200);
  assert.equal(gr[0].score_change, 0);
});

test('Workbook: valid .xlsx written, sheet names and headers as specified', async () => {
  const s = fakeSession('b', 3);
  const h = [fakeSession('a', 1), fakeSession('c', 2)];
  const spec = C.sessionWorkbookSpec(s, h);
  assert.deepEqual(spec.sheets.map((x) => x.name), ['Session', 'Trial_Summary', 'Game_Summary', 'Events', 'Kinematics', 'Sensor_Quality', 'Questionnaire', 'Progress', 'Data_Dictionary']);
  const bytes = await C.buildXlsx(spec);
  assert.equal(bytes[0], 0x50); assert.equal(bytes[1], 0x4b);
  const out = path.join(__dirname, 'out');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'unit_session.xlsx'), bytes);
  const study = await C.buildXlsx(C.studyWorkbookSpec([s].concat(h)));
  fs.writeFileSync(path.join(out, 'unit_study.xlsx'), study);
  const stored = await C.buildXlsx(spec, { store: true });
  fs.writeFileSync(path.join(out, 'unit_session_stored.xlsx'), stored);
  assert.ok(stored.length > bytes.length, 'deflate compresses');
  const qs = spec.sheets.find((x) => x.name === 'Questionnaire');
  assert.deepEqual(qs.columns.map((c) => c.header || c.key || c.name).slice(-2), ['response_score', 'response_text']);
  assert.equal(typeof qs.rows[0][4], 'number', 'ratings are numbers, ready for statistics');
  assert.equal(qs.rows[0][4], 4);
  assert.equal(qs.rows[7][4], null, 'free-text answers are not in the score column');
  assert.equal(C.sessionFileName(s), 'CARS_P007_S03_' + C.localDate(s.startedAt, s.tzOffsetMin) + '.xlsx');
});

test('CSV export quotes commas and quotes', () => {
  const s = fakeSession('d', 1);
  s.events[0].stimulus = 'a, "b"';
  const csv = C.eventsCsv(s);
  assert.ok(csv.startsWith('participant_id,session_no,game'));
  assert.ok(csv.includes('"a, ""b"""'));
  assert.equal(csv.trim().split('\r\n').length, s.events.length + 1);
});

test('Local date and time follow the recorded UTC offset, not the machine running the code', () => {
  assert.equal(C.localDate('2026-10-15T20:30:00.000Z', 330), '2026-10-16');
  assert.equal(C.localTime('2026-10-15T20:30:00.000Z', 330), '02:00:00');
  assert.equal(C.localDate('2026-10-15T02:30:00.000Z', -300), '2026-10-14');
  const s = fakeSession('tz', 4); s.tzOffsetMin = 330; s.startedAt = '2026-10-15T20:30:00.000Z';
  assert.equal(C.sessionFileName(s), 'CARS_P007_S04_2026-10-16.xlsx');
  assert.equal(C.sessionRow(s).start_time, '02:00:00');
});

test('CRC32 matches the standard check value', () => {
  assert.equal(C.crc32(new TextEncoder().encode('123456789')).toString(16), 'cbf43926');
});
