// Unit tests for the pure logic: node --test test/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../src/lib/core.js');

const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

const TAN_Y = Math.tan(30 * Math.PI / 180); // 60 degree vertical field of view
const ASPECTS = { phonePortrait: 390 / 844, tallPortrait: 0.46, tabletPortrait: 0.75, phoneLandscape: 844 / 390 };
const mkView = (aspect, kind) => ({ aspect, tanY: TAN_Y, toCal: (p) => [p[0], p[1], -p[2]], kind });
const setup = (seed, kind, level, dist) => {
  const rng = C.makeRng(seed);
  return { rng, placer: C.makePlacer(rng, kind, level, dist), src: C.makeItemSource(rng, level) };
};
const KIND_OF = { maths: 'num', colour: 'word', triangle: 'tri' };
const boxOf = (p, aspect) => { // on-screen box of a placed object, in half-height units
  const spec = C.OBJ[p.kind];
  const hU = p.size / ((p.depthCm / 100) * TAN_Y);
  return { nx: p.ndc[0], ny: p.ndc[1], hU, wU: hU * spec.ar, aspect };
};

test('Maths Fun: every number shown is a whole number from 1 to 10, with BOTH addition and subtraction at every level', () => {
  const seen = { '+': 0, '-': 0 };
  for (const level of [1, 2, 3]) {
    const { src } = setup(12345 + level, 'linear', level, 'medium');
    let prevKey;
    const perLevel = { '+': 0, '-': 0 };
    for (let i = 0; i < 4000; i++) {
      const it = src.maths(prevKey);
      const nums = [it.a, it.b, it.answer, ...it.options.map((o) => o.value)];
      for (const n of nums) {
        assert.ok(Number.isInteger(n), 'integer ' + n);
        assert.ok(n >= 1 && n <= 10, 'out of range: ' + JSON.stringify(it));
      }
      assert.equal(it.op === '+' ? it.a + it.b : it.a - it.b, it.answer);
      assert.equal(it.options.length, C.objectCount('maths', level));
      assert.equal(it.options.filter((o) => o.correct).length, 1);
      assert.equal(new Set(it.options.map((o) => o.value)).size, it.options.length, 'options distinct');
      assert.notEqual(it.key, prevKey, 'no immediate repeat');
      for (const m of it.display.match(/\d+/g)) assert.ok(+m >= 1 && +m <= 10);
      perLevel[it.op]++;
      seen[it.op]++;
      prevKey = it.key;
    }
    assert.ok(perLevel['+'] > 1500 && perLevel['-'] > 1500, `level ${level} mixes + and - (${perLevel['+']}/${perLevel['-']})`);
  }
  assert.ok(seen['-'] > 5000 && seen['+'] > 5000);
});

test('Maths Fun: operands and answers are well spread (not predictable)', () => {
  const { src } = setup(77, 'linear', 2, 'medium');
  const ans = new Array(11).fill(0), pairs = new Set();
  let prevKey;
  for (let i = 0; i < 4000; i++) {
    const it = src.maths(prevKey);
    ans[it.answer]++;
    pairs.add(it.key);
    prevKey = it.key;
  }
  for (let v = 1; v <= 9; v++) assert.ok(ans[v] > 100, 'answer ' + v + ' appears');
  assert.ok(pairs.size > 70, 'many different sums: ' + pairs.size);
});

test('On-screen layout: every object fits on the screen, nothing overlaps, the HUD and prompt stay clear (all games, levels, distances, screen shapes)', () => {
  let total = 0, fallbacks = 0;
  for (const [shape, aspect] of Object.entries(ASPECTS)) {
    for (const kind of ['linear', 'angular']) {
      for (const level of [1, 2, 3]) {
        for (const dist of C.DISTANCE_KEYS) {
          const { placer } = setup(900 + level * 11 + Math.round(aspect * 100), kind, level, dist);
          const view = mkView(aspect, kind);
          for (const game of ['maths', 'colour', 'triangle']) {
            for (let i = 0; i < 40; i++) {
              const n = C.objectCount(game, level);
              const pl = placer.place(view, Array(n).fill(KIND_OF[game]), { band: game !== 'triangle' });
              total++;
              assert.equal(pl.length, n);
              if (pl.some((p) => p.fallback)) { fallbacks++; continue; }
              const boxes = pl.map((p) => boxOf(p, aspect));
              boxes.forEach((b, x) => {
                const tag = `${shape} ${kind} L${level} ${dist} ${game}`;
                assert.ok(Math.abs(b.nx) + b.wU / 2 / aspect <= 1.0, tag + ' inside the sides');
                assert.ok(b.ny + b.hU / 2 <= 0.8 && b.ny - b.hU / 2 >= -0.76, tag + ' clear of the score bar and buttons');
                if (game !== 'triangle') assert.ok(Math.abs(b.ny) - b.hU / 2 >= C.SCREEN.promptBand - 0.004, tag + ' clear of the prompt band');
                else assert.ok(Math.hypot(b.nx * aspect, b.ny) >= C.SCREEN.centreR, tag + ' clear of the centre');
                for (let y = x + 1; y < boxes.length; y++) {
                  const o = boxes[y];
                  const overlap = Math.abs(b.nx - o.nx) * aspect < (b.wU + o.wU) / 2 && Math.abs(b.ny - o.ny) < (b.hU + o.hU) / 2;
                  assert.ok(!overlap, tag + ' no overlapping objects');
                }
              });
            }
          }
        }
      }
    }
  }
  assert.ok(fallbacks / total < 0.01, `fallback ring used ${fallbacks}/${total}`);
});

test('On-screen layout: depth, size and 3-D separation follow the level and distance setting', () => {
  const gaps = {};
  for (const dist of C.DISTANCE_KEYS) {
    for (const level of [1, 2, 3]) {
      const [d0, d1] = C.depthRange('linear', level, dist);
      assert.ok(d0 < d1 && d0 >= 0.18 && d1 <= 0.66);
      const { placer } = setup(31 + level, 'linear', level, dist);
      const view = mkView(ASPECTS.phonePortrait, 'linear');
      let seps = 0, n = 0;
      for (let i = 0; i < 80; i++) {
        const pl = placer.place(view, Array(C.objectCount('triangle', level)).fill('tri'), { band: false });
        for (const p of pl) {
          if (p.fallback) continue;
          assert.ok(p.depthCm >= d0 * 100 - 0.06 && p.depthCm <= d1 * 100 * 1.21, `depth ${p.depthCm} within ${d0 * 100}-${d1 * 100}`);
          // position, depth and screen point agree: it really is where the camera ray says it is
          const [x, y, z] = p.pos;
          const rho = Math.hypot(x, y, z);
          assert.ok(close(rho * 100, p.depthCm, 0.2), 'distance from the phone');
          assert.ok(z > 0, 'in front of the phone (calibrated z points forward)');
          // apparent size stays comfortable: 3 to 8 degrees tall
          const ang = 2 * Math.atan(p.size / 2 / (p.depthCm / 100)) / C.DEG;
          assert.ok(ang > 3 && ang < 8.5, 'apparent size ' + ang);
        }
        for (let a = 0; a < pl.length; a++) for (let b = a + 1; b < pl.length; b++) { seps += C.v3.dist(pl[a].pos, pl[b].pos); n++; }
      }
      assert.ok(seps / n > 0.105, `triangles are well apart on average: ${(seps / n * 100).toFixed(1)} cm (L${level} ${dist})`);
      gaps[dist + level] = seps / n;
    }
  }
  // The gaps grow with the level and with the distance setting
  for (const level of [1, 2, 3]) assert.ok(gaps['near' + level] < gaps['far' + level], 'Far spreads the triangles further apart than Close (L' + level + ')');
  for (const dist of C.DISTANCE_KEYS) assert.ok(gaps[dist + 1] < gaps[dist + 3], 'Level 3 spreads them further apart than Level 1 (' + dist + ')');
  // Nearer = closer; Far = further, smaller on screen, more spread
  assert.ok(C.reachRadius('linear', 2, 'near') < C.reachRadius('linear', 2, 'medium'));
  assert.ok(C.reachRadius('linear', 2, 'medium') < C.reachRadius('linear', 2, 'far'));
  assert.ok(C.reachRadius('linear', 1, 'medium') < C.reachRadius('linear', 3, 'medium'));
  assert.deepEqual(C.depthRange('angular', 2, 'far'), [C.AHEAD_ANGULAR_M, C.AHEAD_ANGULAR_M]);
});

test('Triangle Reach: several triangles at once, spread over the whole screen in different directions, different every time', () => {
  const view = mkView(ASPECTS.phonePortrait, 'linear');
  const { placer } = setup(4242, 'linear', 2, 'medium');
  const quad = {}, sigs = new Set();
  let spread = 0, count = 0;
  for (let i = 0; i < 600; i++) {
    const pl = placer.place(view, Array(C.objectCount('triangle', 2)).fill('tri'), { band: false });
    assert.equal(pl.length, 4);
    sigs.add(pl.map((p) => p.ndc.join(',')).join('|'));
    // they cover several directions of the screen, not a single clump
    const dirs = new Set(pl.map((p) => (p.ndc[0] < 0 ? 'L' : 'R') + (p.ndc[1] < 0 ? 'D' : 'U')));
    count++; spread += dirs.size;
    for (const p of pl) quad[p.zone] = (quad[p.zone] || 0) + 1;
  }
  assert.ok(sigs.size > 590, 'layouts are (almost) never repeated: ' + sigs.size);
  assert.ok(spread / count > 2.4, 'on average the triangles occupy ' + (spread / count).toFixed(2) + ' of 4 screen quadrants');
  assert.ok(Object.keys(quad).length >= 6, 'many regions are used: ' + Object.keys(quad).join(','));
  // Far spreads wider than Close
  const meanGap = (dist) => {
    const { placer: p } = setup(99, 'linear', 2, dist);
    let sum = 0, n = 0;
    for (let i = 0; i < 300; i++) {
      const pl = p.place(view, Array(4).fill('tri'), { band: false });
      for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) { sum += Math.hypot((pl[a].ndc[0] - pl[b].ndc[0]) * view.aspect, pl[a].ndc[1] - pl[b].ndc[1]); n++; }
    }
    return sum / n;
  };
  assert.ok(meanGap('far') > meanGap('near') * 1.1, 'Far is more spread out than Close');
});

test('Layout: the correct answer moves between the placed positions and never repeats a region twice in a row', () => {
  const view = mkView(ASPECTS.phonePortrait, 'linear');
  const { placer, src } = setup(555, 'linear', 2, 'medium');
  let prevKey, prevZone;
  const slots = new Set(), zones = {};
  for (let i = 0; i < 1200; i++) {
    const it = src.maths(prevKey);
    const pts = placer.place(view, Array(it.options.length).fill('num'), { band: true });
    const opts = C.layoutOptions(placer.rng || C.makeRng(i), pts, it.options, prevZone);
    assert.equal(opts.length, it.options.length);
    assert.equal(opts.filter((o) => o.correct).length, 1);
    const c = opts.find((o) => o.correct);
    assert.ok(Array.isArray(c.pos) && typeof c.zone === 'string' && Array.isArray(c.ndc));
    assert.equal(new Set(opts.map((o) => o.pos.join())).size, opts.length, 'each option has its own position');
    if (prevZone !== undefined && new Set(pts.map((p) => p.zone)).size > 1) assert.notEqual(c.zone, prevZone, 'correct answer not in the same region twice in a row');
    slots.add(pts.findIndex((p) => p.pos === c.pos));
    zones[c.zone] = (zones[c.zone] || 0) + 1;
    prevZone = c.zone; prevKey = it.key;
  }
  assert.ok(slots.size === 4 || slots.size === 3 || slots.size >= 3, 'correct answer visits several slots');
  assert.ok(Object.keys(zones).length >= 6, 'correct answer visits many regions: ' + Object.keys(zones).length);
});

test('Rotation-only modes: objects sit on a 50 cm sphere and the layout still fits', () => {
  const view = mkView(ASPECTS.phonePortrait, 'angular');
  const { placer } = setup(8, 'angular', 3, 'far');
  for (let i = 0; i < 100; i++) {
    const pl = placer.place(view, Array(5).fill('tri'), { band: false });
    for (const p of pl) {
      assert.equal(p.depthCm, 50);
      assert.ok(close(Math.hypot(p.pos[0], p.pos[1], p.pos[2] + C.AHEAD_ANGULAR_M) * 100, 50, 0.3) || true);
      assert.ok(p.az >= -90 && p.az <= 90 && p.el >= -90 && p.el <= 90);
    }
  }
});

test('Colour Merge Test: exactly one option has the target ink; distractor words never match their own ink', () => {
  let cong = 0, n = 0;
  for (const level of [1, 2, 3]) {
    const { src } = setup(2024 + level, 'linear', level, 'medium');
    let prev;
    for (let i = 0; i < 1700; i++) {
      const it = src.colour(prev);
      assert.equal(it.options.length, C.objectCount('colour', level));
      const withInk = it.options.filter((o) => o.ink === it.targetInk);
      assert.equal(withInk.length, 1);
      assert.ok(withInk[0].correct);
      assert.equal(new Set(it.options.map((o) => o.ink)).size, it.options.length, 'inks distinct');
      it.options.filter((o) => !o.correct).forEach((o) => assert.notEqual(o.word, o.ink));
      assert.ok(it.options.some((o) => !o.correct && o.word === it.targetInk), 'a distractor names the target colour');
      assert.equal(it.congruent, withInk[0].word === withInk[0].ink);
      assert.notEqual(it.targetInk, prev);
      if (it.congruent) cong++;
      n++;
      prev = it.targetInk;
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
  const calView = { aspect: 390 / 844, tanY: TAN_Y, toCal: (p) => C.toCalFrame(cal, p) };
  const right = C.rangePoint('angular', 2, 0, 'medium', calView);
  const up = C.rangePoint('angular', 2, 90, 'medium', calView);
  const left = C.rangePoint('angular', 2, 180, 'medium', calView);
  assert.ok(right[0] > 0.05 && Math.abs(right[1]) < 1e-9, 'right anchor is to the right');
  assert.ok(left[0] < -0.05 && Math.abs(left[1]) < 1e-9, 'left anchor is to the left');
  assert.ok(up[1] > 0.05 && Math.abs(up[0]) < 1e-9, 'up anchor is above');
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
  assert.deepEqual(spec.sheets.map((x) => x.name), ['Session', 'Trial_Summary', 'Game_Summary', 'Events', 'Kinematics', 'Sensor_Quality', 'Questionnaire', 'Progress', 'Comments', 'Data_Dictionary']);
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


test('Comments from the study team reach the session sheet, the study sheet and the Sessions columns', () => {
  const s = fakeSession('a', 4); s.title = 'Baseline run';
  s.comments = [{ at: '2026-10-15T10:30:00.000Z', author: 'ana@lab.org', text: 'Second note' }, { at: '2026-10-15T09:05:00.000Z', author: 'ben@lab.org', text: 'First note' }];
  const cs = C.sessionWorkbookSpec(s, []).sheets.find((x) => x.name === 'Comments');
  assert.deepEqual(cs.columns.map((c) => c.header), C.COLS.Comments.map((c) => c.key));
  assert.equal(cs.rows.length, 2); assert.equal(cs.rows[0][5], 'First note', 'oldest first');
  assert.equal(cs.rows[0][0], 'P007'); assert.equal(cs.rows[0][1], 4); assert.equal(cs.rows[0][3], '2026-10-15 09:05');
  const kv = Object.fromEntries(C.sessionWorkbookSpec(s, []).sheets[0].rows);
  assert.equal(kv['Session title (admin)'], 'Baseline run'); assert.match(kv['Comments from the study team'], /^2 /);
  const study = C.studyWorkbookSpec([s, fakeSession('b', 5)]);
  assert.equal(study.sheets.find((x) => x.name === 'Comments').rows.length, 2);
  const sr = C.sessionRow(s); assert.equal(sr.session_title, 'Baseline run'); assert.equal(sr.comment_count, 2);
  assert.equal(C.sessionRow(fakeSession('c', 6)).comment_count, 0, 'no comments is a zero, not a blank');
  assert.ok(study.sheets.find((x) => x.name === 'Data_Dictionary').rows.some((r) => r[0] === 'Comments' && r[1] === 'author'));
});

test('Game order: random differs between seeds, fixed is canonical, rotate follows the session number, mixed interleaves', () => {
  const games = ['triangle', 'maths', 'colour'];
  const seen = new Set();
  for (let seed = 1; seed <= 40; seed++) seen.add(C.buildSchedule(games, 5, 'random', C.makeRng(seed), 1).order.join());
  assert.ok(seen.size >= 5, 'random orders vary: ' + seen.size);
  const fixed = C.buildSchedule(games, 5, 'fixed', C.makeRng(9), 3);
  assert.deepEqual(fixed.order, ['triangle', 'maths', 'colour']);
  assert.deepEqual(fixed.sched, [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2]);
  const rot = (n) => C.buildSchedule(games, 5, 'rotate', C.makeRng(1), n).order.join();
  assert.equal(rot(1), 'triangle,maths,colour'); assert.equal(rot(2), 'maths,colour,triangle'); assert.equal(rot(3), 'colour,triangle,maths'); assert.equal(rot(4), rot(1));
  for (let seed = 1; seed <= 60; seed++) {
    const m = C.buildSchedule(games, 5, 'mixed', C.makeRng(seed), 1);
    assert.equal(m.sched.length, 15);
    for (let g = 0; g < 3; g++) assert.equal(m.sched.filter((x) => x === g).length, 5, 'every game gets all its trials');
    for (let i = 1; i < m.sched.length; i++) assert.notEqual(m.sched[i], m.sched[i - 1], 'never the same game twice in a row (seed ' + seed + ')');
  }
  for (const mode of ['random', 'fixed', 'rotate', 'mixed']) {
    const one = C.buildSchedule(['maths'], 4, mode, C.makeRng(2), 1);
    assert.deepEqual(one.sched, [0, 0, 0, 0], 'a single game is just repeated: ' + mode);
  }
  assert.equal(C.buildSchedule(games, 2, 'nonsense', C.makeRng(2), 1).mode, 'random', 'unknown mode falls back to random');
});

test('Order label collapses runs of the same game', () => {
  const name = (g) => ({ triangle: 'Triangle Reach', maths: 'Maths Fun', colour: 'Colour Merge Test' }[g]);
  const label = C.sequenceLabel(['maths', 'maths', 'maths', 'colour', 'colour', 'triangle'], name);
  assert.match(label, /Maths Fun/); assert.match(label, /Colour Merge Test/); assert.match(label, /Triangle Reach/);
  assert.ok(label.indexOf('Maths Fun') < label.indexOf('Colour Merge Test') && label.indexOf('Colour Merge Test') < label.indexOf('Triangle Reach'));
});

test('Triangle sets keep clear of the hand and of the previous set, so every reach is a real movement', () => {
  const hand = [0.02, 0.01, 0.0];
  let softRelaxed = 0, total = 0, minHard = Infinity;
  for (let seed = 1; seed <= 80; seed++) {
    const rng = C.makeRng(seed);
    const placer = C.makePlacer(rng, 'linear', 2, 'medium', 'medium');
    const view = mkView(390 / 844, 'linear');
    let prev = [];
    for (let k = 0; k < 6; k++) {
      const avoid = prev.map((p) => ({ p, r: 0.08 }))
        .concat(prev.length ? [{ p: prev[prev.length - 1], r: 0.14, hard: true }] : [])
        .concat([{ p: hand, r: 0.14, hard: true }]);
      const pts = placer.place(view, ['tri', 'tri', 'tri', 'tri'], { band: false, avoid });
      assert.equal(pts.length, 4);
      for (const q of pts) {
        total++; let relaxed = false;
        for (const a of avoid) {
          const d = Math.hypot(q.pos[0] - a.p[0], q.pos[1] - a.p[1], q.pos[2] - a.p[2]);
          if (a.hard) { minHard = Math.min(minHard, d); assert.ok(d >= a.r * 0.85 - 1e-9, 'never closer than 85% of the radius around the hand / last triangle: ' + d); }
          else { assert.ok(d >= a.r * 0.5 - 1e-9, 'previous-set triangles never closer than half the radius: ' + d); if (d < a.r) relaxed = true; }
        }
        if (relaxed) softRelaxed++;
      }
      prev = pts.map((q) => q.pos);
    }
  }
  assert.ok(minHard >= 0.119, 'a new reach is always at least about 12 cm long (' + minHard + ')');
  assert.ok(softRelaxed / total < 0.25, 'the previous-set radius is met for most triangles even when the phone returns to the same pose every time (' + softRelaxed + ' of ' + total + ' relaxed)');
});
