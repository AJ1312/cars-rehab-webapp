/*
 * CARS Rehab — core logic.
 * Pure functions shared by the app and the automated tests: seeded randomness,
 * game item generators, 3-D maths, signal filtering, tracking-health logic,
 * reach metrics, data-sheet assembly and a dependency-free .xlsx writer.
 * No DOM access in this file.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CARSCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VERSION = '1.0.0';

  /* ------------------------------------------------------------------ */
  /* Constants                                                           */
  /* ------------------------------------------------------------------ */

  const GAMES = {
    triangle: { key: 'triangle', name: 'Triangle Reach', short: 'Triangle' },
    maths: { key: 'maths', name: 'Maths Fun', short: 'Maths' },
    colour: { key: 'colour', name: 'Colour Merge Test', short: 'Colour' }
  };
  const GAME_ORDER = ['triangle', 'maths', 'colour'];

  // Reach distance per difficulty level: linear (6-DoF) and angular (motion / touch).
  const LEVELS = {
    1: { cm: 20, deg: 20 },
    2: { cm: 30, deg: 30 },
    3: { cm: 40, deg: 40 }
  };

  const DIRS = [0, 45, 90, 135, 180, 225, 270, 315];
  const DIR_NAMES = {
    0: 'right', 45: 'up-right', 90: 'up', 135: 'up-left',
    180: 'left', 225: 'down-left', 270: 'down', 315: 'down-right'
  };

  const TARGET_RADIUS_M = 0.065; // touch zone around each target
  const HOME_RADIUS_M = 0.08; // touch zone around the centre ring
  const AHEAD_ANGULAR_M = 0.5; // motion / touch: cursor projected 50 cm along the phone's view
  const AHEAD_6DOF_M = 0.3; // 6-DoF: cursor ring 30 cm in front of the phone

  const COLOURS = [
    { key: 'red', name: 'RED', hex: '#FF4B3E' },
    { key: 'blue', name: 'BLUE', hex: '#4D9BFF' },
    { key: 'green', name: 'GREEN', hex: '#2FD06A' },
    { key: 'yellow', name: 'YELLOW', hex: '#FFD43B' }
  ];

  const CAL_RULES = {
    minRateHz: { '6dof': 30, motion: 20, touch: 20, sim: 20 },
    maxJitterCm: 1.0,
    holdMs: 2000
  };

  const DEG = Math.PI / 180;

  /* ------------------------------------------------------------------ */
  /* Seeded random numbers (mulberry32) — the seed is logged per session */
  /* ------------------------------------------------------------------ */

  function makeRng(seed) {
    let a = (seed >>> 0) || 0x9e3779b9;
    function next() {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    return {
      next,
      int(lo, hi) { return lo + Math.floor(next() * (hi - lo + 1)); },
      pick(arr) { return arr[Math.floor(next() * arr.length)]; },
      chance(p) { return next() < p; },
      shuffle(arr) {
        const out = arr.slice();
        for (let i = out.length - 1; i > 0; i--) {
          const j = Math.floor(next() * (i + 1));
          const tmp = out[i]; out[i] = out[j]; out[j] = tmp;
        }
        return out;
      }
    };
  }

  /* ------------------------------------------------------------------ */
  /* Vector and quaternion maths. World: x right, y up, camera looks -z.  */
  /* ------------------------------------------------------------------ */

  const v3 = {
    add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
    sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
    scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
    dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    len: (a) => Math.hypot(a[0], a[1], a[2]),
    dist: (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]),
    norm(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
    finite: (a) => Array.isArray(a) && a.length === 3 && a.every(Number.isFinite)
  };

  const quat = {
    identity: () => [0, 0, 0, 1],
    mul(a, b) {
      const ax = a[0], ay = a[1], az = a[2], aw = a[3];
      const bx = b[0], by = b[1], bz = b[2], bw = b[3];
      return [
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
        aw * bw - ax * bx - ay * by - az * bz
      ];
    },
    conj: (q) => [-q[0], -q[1], -q[2], q[3]],
    normalize(q) { const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1; return [q[0] / l, q[1] / l, q[2] / l, q[3] / l]; },
    rotate(q, v) {
      const x = q[0], y = q[1], z = q[2], w = q[3];
      const tx = 2 * (y * v[2] - z * v[1]);
      const ty = 2 * (z * v[0] - x * v[2]);
      const tz = 2 * (x * v[1] - y * v[0]);
      return [
        v[0] + w * tx + (y * tz - z * ty),
        v[1] + w * ty + (z * tx - x * tz),
        v[2] + w * tz + (x * ty - y * tx)
      ];
    },
    fromAxisAngle(axis, ang) {
      const s = Math.sin(ang / 2);
      return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(ang / 2)];
    },
    // Euler order YXZ (same convention as three.js)
    fromEulerYXZ(x, y, z) {
      const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2);
      const s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
      return [
        s1 * c2 * c3 + c1 * s2 * s3,
        c1 * s2 * c3 - s1 * c2 * s3,
        c1 * c2 * s3 - s1 * s2 * c3,
        c1 * c2 * c3 + s1 * s2 * s3
      ];
    },
    // Camera orientation from yaw (radians, + turns left) and pitch (+ looks up).
    fromYawPitch(yaw, pitch) {
      return quat.mul(quat.fromAxisAngle([0, 1, 0], yaw), quat.fromAxisAngle([1, 0, 0], pitch));
    },
    finite: (q) => Array.isArray(q) && q.length === 4 && q.every(Number.isFinite)
  };

  // W3C DeviceOrientation (alpha, beta, gamma in degrees) + screen angle -> camera quaternion.
  // The camera looks out of the back of the phone (-z), y is world-up.
  function deviceOrientationToQuat(alpha, beta, gamma, screenAngleDeg) {
    const q = quat.fromEulerYXZ(beta * DEG, alpha * DEG, -gamma * DEG);
    const q1 = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2]; // -90 deg about X
    const q2 = quat.fromAxisAngle([0, 0, 1], -(screenAngleDeg || 0) * DEG);
    return quat.normalize(quat.mul(quat.mul(q, q1), q2));
  }

  function forwardOf(q) { return quat.rotate(q, [0, 0, -1]); }

  // Yaw (+ right), pitch (+ up) and roll (+ clockwise as the user sees it), degrees.
  function yawPitchRoll(q) {
    const f = forwardOf(q);
    const r = quat.rotate(q, [1, 0, 0]);
    const u = quat.rotate(q, [0, 1, 0]);
    const yaw = Math.atan2(f[0], -f[2]) / DEG;
    const pitch = Math.asin(Math.max(-1, Math.min(1, f[1]))) / DEG;
    const roll = Math.atan2(-r[1], u[1]) / DEG;
    return [yaw, pitch, roll];
  }

  // Yaw/pitch (radians, fromYawPitch convention) that point the camera along direction d.
  function yawPitchToward(d) {
    const n = v3.norm(d);
    return { yaw: Math.atan2(-n[0], -n[2]), pitch: Math.asin(Math.max(-1, Math.min(1, n[1]))) };
  }

  function cursorFromPose(pos, q, ahead) {
    return v3.add(pos, v3.scale(forwardOf(q), ahead));
  }

  /* ------------------------------------------------------------------ */
  /* Calibration frame and target placement                              */
  /* ------------------------------------------------------------------ */

  // kind 'angular' (motion / touch / sim): targets on a sphere around the eye.
  // kind 'linear' (6-DoF): targets on a plane through the centre point.
  function makeCalibration(kind, eye, forward, ahead) {
    const c = v3.norm(forward);
    let r = v3.cross(c, [0, 1, 0]);
    if (v3.len(r) < 1e-3) r = [1, 0, 0];
    r = v3.norm(r);
    const u = v3.cross(r, c);
    const center = v3.add(eye, v3.scale(c, ahead));
    return { kind, eye: eye.slice(), c, r, u, ahead, center };
  }

  function placeOnRing(cal, dirDeg, level) {
    const phi = dirDeg * DEG;
    const lv = LEVELS[level] || LEVELS[2];
    const ringDir = v3.add(v3.scale(cal.r, Math.cos(phi)), v3.scale(cal.u, Math.sin(phi)));
    if (cal.kind === 'angular') {
      const th = lv.deg * DEG;
      const dir = v3.add(v3.scale(cal.c, Math.cos(th)), v3.scale(ringDir, Math.sin(th)));
      return v3.add(cal.eye, v3.scale(dir, cal.ahead));
    }
    return v3.add(cal.center, v3.scale(ringDir, lv.cm / 100));
  }

  // World point -> calibrated coordinates in metres: x right, y up, z depth (towards the targets).
  function toCalFrame(cal, p) {
    const d = v3.sub(p, cal.center);
    return [v3.dot(d, cal.r), v3.dot(d, cal.u), v3.dot(d, cal.c)];
  }

  function angDiff(a, b) {
    let d = Math.abs(a - b) % 360;
    return d > 180 ? 360 - d : d;
  }

  /* ------------------------------------------------------------------ */
  /* Game item generators                                                */
  /* ------------------------------------------------------------------ */

  // Triangle Reach: blocks of 8 directions, each used once per block, with every
  // consecutive pair at least minSep degrees apart (never the same or a neighbour).
  function triangleSequence(rng, count, minSep, startAfter) {
    const sep = minSep || 90;
    const out = [];
    let prev = startAfter;
    while (out.length < count) {
      const block = [];
      const used = new Set();
      const solve = (last) => {
        if (block.length === DIRS.length) return true;
        for (const d of rng.shuffle(DIRS)) {
          if (used.has(d)) continue;
          if (last !== undefined && angDiff(last, d) < sep) continue;
          used.add(d); block.push(d);
          if (solve(d)) return true;
          used.delete(d); block.pop();
        }
        return false;
      };
      if (!solve(prev)) throw new Error('No valid triangle order');
      out.push(...block);
      prev = block[block.length - 1];
    }
    return out.slice(0, count);
  }

  // Up to n directions, all at least 90 degrees apart, for answer options.
  function optionDirections(rng, n) {
    const base = rng.pick([0, 45]);
    const four = [0, 90, 180, 270].map((d) => (d + base) % 360);
    return rng.shuffle(four).slice(0, n);
  }

  // Place options so the correct one is not in the same direction as last time.
  function layoutOptions(rng, options, avoidDir) {
    const dirs = optionDirections(rng, options.length);
    const correctIdx = options.findIndex((o) => o.correct);
    let slot = dirs.findIndex((d) => d !== avoidDir);
    if (slot < 0) slot = 0;
    const order = [];
    const rest = dirs.filter((_, i) => i !== slot);
    let k = 0;
    options.forEach((o, i) => {
      order.push(Object.assign({}, o, { dir: i === correctIdx ? dirs[slot] : rest[k++] }));
    });
    return order;
  }

  // Maths Fun: every number shown is a whole number from 1 to 10.
  function genMaths(rng, level, prevKey, avoidDir) {
    for (let attempt = 0; attempt < 100; attempt++) {
      const op = level === 1 ? '+' : (rng.chance(0.5) ? '+' : '-');
      let a, b, ans;
      if (op === '+') { a = rng.int(1, 9); b = rng.int(1, 10 - a); ans = a + b; }
      else { a = rng.int(2, 10); b = rng.int(1, a - 1); ans = a - b; }
      const key = a + op + b;
      if (key === prevKey) continue;
      const nOpt = level === 1 ? 3 : 4;
      const pool = [];
      for (let v = 1; v <= 10; v++) if (v !== ans) pool.push(v);
      const distract = pool
        .map((v) => ({ v, k: Math.abs(v - ans) + rng.next() * 2.5 }))
        .sort((x, y) => x.k - y.k)
        .slice(0, nOpt - 1)
        .map((o) => o.v);
      const opts = rng.shuffle([ans].concat(distract)).map((v) => ({ value: v, label: String(v), correct: v === ans }));
      return {
        game: 'maths', key, a, b, op, answer: ans,
        stimulus: a + ' ' + op + ' ' + b,
        display: a + ' ' + (op === '+' ? '+' : '−') + ' ' + b + ' = ?',
        condition: op === '+' ? 'addition' : 'subtraction',
        options: layoutOptions(rng, opts, avoidDir)
      };
    }
    throw new Error('Could not generate a maths item');
  }

  // Colour Merge Test: find the word printed in the target ink colour.
  function genColour(rng, level, prevInk, avoidDir) {
    const nOpt = level === 1 ? 3 : 4;
    for (let attempt = 0; attempt < 200; attempt++) {
      const target = rng.pick(COLOURS);
      if (target.key === prevInk) continue;
      const congruent = rng.chance(0.25);
      const others = COLOURS.filter((c) => c.key !== target.key);
      const targetWord = congruent ? target : rng.pick(others);
      const distInks = rng.shuffle(others).slice(0, nOpt - 1);
      // Distractor words: one always names the target colour (the interference), none matches its own ink.
      const words = distInks.map(() => null);
      const holder = rng.int(0, distInks.length - 1);
      words[holder] = target;
      let ok = true;
      for (let i = 0; i < distInks.length; i++) {
        if (words[i]) continue;
        const choices = COLOURS.filter((c) => c.key !== distInks[i].key);
        words[i] = rng.pick(choices);
      }
      for (let i = 0; i < distInks.length; i++) if (words[i].key === distInks[i].key) ok = false;
      if (!ok) continue;
      const opts = [{ word: targetWord.key, label: targetWord.name, ink: target.key, inkHex: target.hex, correct: true }]
        .concat(distInks.map((ink, i) => ({ word: words[i].key, label: words[i].name, ink: ink.key, inkHex: ink.hex, correct: false })));
      return {
        game: 'colour', key: target.key + (congruent ? '+c' : '+i'),
        targetInk: target.key, targetName: target.name, congruent,
        stimulus: 'find ' + target.name + ' ink',
        display: target.name,
        answer: target.key,
        condition: congruent ? 'congruent' : 'incongruent',
        options: layoutOptions(rng, rng.shuffle(opts), avoidDir)
      };
    }
    throw new Error('Could not generate a colour item');
  }

  /* ------------------------------------------------------------------ */
  /* One-Euro filter (Casiez et al. 2012)                                 */
  /* ------------------------------------------------------------------ */

  function lowpassAlpha(cutoff, dt) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  class OneEuro3 {
    constructor(minCutoff, beta, dCutoff) {
      this.minCutoff = minCutoff == null ? 1.2 : minCutoff;
      this.beta = beta == null ? 6 : beta;
      this.dCutoff = dCutoff == null ? 1.0 : dCutoff;
      this.reset();
    }
    reset() { this.x = null; this.dx = [0, 0, 0]; this.t = null; }
    filter(p, tSec) {
      if (this.x === null || this.t === null || !(tSec > this.t)) {
        if (this.x === null) this.x = p.slice();
        this.t = tSec;
        return this.x.slice();
      }
      const dt = Math.min(0.2, tSec - this.t);
      this.t = tSec;
      const ad = lowpassAlpha(this.dCutoff, dt);
      const rawD = [(p[0] - this.x[0]) / dt, (p[1] - this.x[1]) / dt, (p[2] - this.x[2]) / dt];
      this.dx = this.dx.map((d, i) => d + ad * (rawD[i] - d));
      const speed = Math.hypot(this.dx[0], this.dx[1], this.dx[2]);
      const a = lowpassAlpha(this.minCutoff + this.beta * speed, dt);
      this.x = this.x.map((x, i) => x + a * (p[i] - x));
      return this.x.slice();
    }
  }

  /* ------------------------------------------------------------------ */
  /* Tracking health: dropout detection, recovery, counters              */
  /* ------------------------------------------------------------------ */

  class TrackingHealth {
    constructor(opts) {
      const o = opts || {};
      this.lostAfterMs = o.lostAfterMs || 250;
      this.recoverAfterMs = o.recoverAfterMs || 500;
      this.gapResetMs = o.gapResetMs || 150;
      this.state = 'waiting';
      this.lastValid = null;
      this.goodSince = null;
      this.lostSince = null;
      this.validSamples = 0;
      this.dropouts = 0;
      this.lostMs = 0;
      this.limited = false;
    }
    // Call for every new sample; valid=false for empty or limited-tracking samples.
    sample(tMs, valid) {
      if (!valid) { this.goodSince = null; return; }
      this.validSamples++;
      if (this.lastValid === null || tMs - this.lastValid > this.gapResetMs || this.goodSince === null) this.goodSince = tMs;
      this.lastValid = tMs;
    }
    // Call once per frame. Returns 'lost' or 'restored' on a transition, otherwise null.
    tick(tMs) {
      if (this.state === 'waiting') {
        if (this.goodSince !== null && tMs - this.goodSince >= 0) { this.state = 'ok'; return 'restored'; }
        return null;
      }
      if (this.state === 'ok') {
        if (this.lastValid === null || tMs - this.lastValid > this.lostAfterMs) {
          this.state = 'lost'; this.lostSince = tMs; this.dropouts++; this.goodSince = null;
          return 'lost';
        }
        return null;
      }
      // lost
      if (this.lastValid !== null && tMs - this.lastValid > this.gapResetMs) this.goodSince = null;
      if (this.goodSince !== null && tMs - this.goodSince >= this.recoverAfterMs) {
        this.state = 'ok'; this.lostMs += tMs - this.lostSince; this.lostSince = null;
        return 'restored';
      }
      return null;
    }
    lostMsAt(tMs) { return this.lostMs + (this.state === 'lost' && this.lostSince !== null ? tMs - this.lostSince : 0); }
    snapshot(tMs) { return { validSamples: this.validSamples, dropouts: this.dropouts, lostMs: this.lostMsAt(tMs), t: tMs }; }
  }

  // Calibration measurement over the hold window.
  function measureCalibration(samples, mode, sensorRateHz) {
    // samples: [{t, cursor:[x,y,z]}] in metres, t in ms. sensorRateHz: measured sensor event rate, if known.
    if (!samples.length) return { rateHz: 0, jitterCm: null, pass: false, reasons: ['No tracking samples were received.'] };
    const t0 = samples[0].t, t1 = samples[samples.length - 1].t;
    const span = Math.max(1, t1 - t0);
    const rateHz = Number.isFinite(sensorRateHz) ? sensorRateHz : (samples.length > 1 ? (samples.length - 1) / (span / 1000) : 0);
    const mean = [0, 0, 0];
    samples.forEach((s) => { mean[0] += s.cursor[0]; mean[1] += s.cursor[1]; mean[2] += s.cursor[2]; });
    mean[0] /= samples.length; mean[1] /= samples.length; mean[2] /= samples.length;
    let ss = 0;
    samples.forEach((s) => { const d = v3.dist(s.cursor, mean); ss += d * d; });
    const jitterCm = Math.sqrt(ss / samples.length) * 100;
    const minRate = CAL_RULES.minRateHz[mode] || 20;
    const reasons = [];
    if (rateHz < minRate) reasons.push('Sensor rate ' + rateHz.toFixed(0) + ' Hz is below the ' + minRate + ' Hz minimum.');
    if (jitterCm > CAL_RULES.maxJitterCm) reasons.push('The hand moved ' + jitterCm.toFixed(1) + ' cm while holding still (limit ' + CAL_RULES.maxJitterCm.toFixed(1) + ' cm).');
    return { rateHz, jitterCm, pass: reasons.length === 0, reasons, minRate, maxJitterCm: CAL_RULES.maxJitterCm };
  }

  /* ------------------------------------------------------------------ */
  /* Reach metrics for one item                                          */
  /* ------------------------------------------------------------------ */

  class ReachTracker {
    constructor(tMs, p) {
      this.t0 = tMs; this.p0 = p.slice(); this.last = p.slice(); this.lastT = tMs;
      this.path = 0; this.peak = 0; this.moveT = null; this.vEma = 0;
    }
    update(tMs, p) {
      const dt = (tMs - this.lastT) / 1000;
      const d = v3.dist(p, this.last);
      if (dt > 0) {
        this.path += d;
        const v = d / dt;
        this.vEma = this.vEma + 0.35 * (v - this.vEma);
        if (this.vEma > this.peak) this.peak = this.vEma;
      }
      if (this.moveT === null && v3.dist(p, this.p0) > 0.02) this.moveT = tMs;
      this.last = p.slice(); this.lastT = tMs;
    }
    finish(entryT, entryP, confirmT) {
      const straight = v3.dist(entryP, this.p0);
      const move = this.moveT === null ? null : Math.min(this.moveT, entryT);
      return {
        rtMs: move === null ? null : Math.round(move - this.t0),
        mtMs: move === null ? null : Math.round(entryT - move),
        respMs: Math.round((confirmT == null ? entryT : confirmT) - this.t0),
        pathCm: round(this.path * 100, 1),
        straightCm: round(straight * 100, 1),
        pathEff: this.path > 0.005 ? round(Math.min(1, straight / this.path), 3) : null,
        peakSpeedCms: round(this.peak * 100, 1)
      };
    }
  }

  /* ------------------------------------------------------------------ */
  /* Small statistics helpers                                            */
  /* ------------------------------------------------------------------ */

  function round(x, d) { if (x == null || !Number.isFinite(x)) return null; const m = Math.pow(10, d || 0); return Math.round(x * m) / m; }
  function nums(arr) { return arr.filter((x) => typeof x === 'number' && Number.isFinite(x)); }
  function mean(arr) { const a = nums(arr); return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null; }
  function median(arr) {
    const a = nums(arr).sort((x, y) => x - y);
    if (!a.length) return null;
    const m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }
  function sd(arr) {
    const a = nums(arr); if (a.length < 2) return null;
    const m = mean(a);
    return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1));
  }

  /* ------------------------------------------------------------------ */
  /* Session summaries                                                   */
  /* ------------------------------------------------------------------ */

  function summarizeTrials(session) {
    return session.trials.map((tr) => {
      const ev = session.events.filter((e) => e.game === tr.game && e.trial === tr.trial);
      const done = ev.filter((e) => e.outcome === 'correct');
      const responded = ev.filter((e) => e.outcome === 'correct' || (e.errorsBefore || 0) > 0);
      const errors = ev.reduce((s, e) => s + (e.errorsBefore || 0), 0);
      const misses = ev.filter((e) => e.outcome === 'timeout').length;
      const firstTry = done.filter((e) => e.firstTry === 1).length;
      const scored = done.length + errors;
      return {
        participant_id: session.participantId,
        session_no: session.sessionNo,
        game: GAMES[tr.game].name,
        trial: tr.trial,
        level: tr.level,
        tracking_mode: session.mode,
        duration_s: round(tr.activeMs / 1000, 1),
        score: tr.score,
        items_presented: ev.length,
        touches: done.length + errors,
        correct: done.length,
        errors,
        misses,
        accuracy_pct: scored ? round((done.length / scored) * 100, 1) : null,
        first_try_pct: responded.length ? round((firstTry / responded.length) * 100, 1) : null,
        rt_mean_ms: round(mean(done.map((e) => e.rtMs)), 0),
        rt_median_ms: round(median(done.map((e) => e.rtMs)), 0),
        mt_mean_ms: round(mean(done.map((e) => e.mtMs)), 0),
        resp_mean_ms: round(mean(done.map((e) => e.respMs)), 0),
        path_mean_cm: round(mean(done.map((e) => e.pathCm)), 1),
        path_eff_mean: round(mean(done.map((e) => e.pathEff)), 3),
        peak_speed_mean_cms: round(mean(done.map((e) => e.peakSpeedCms)), 1),
        rom_h_cm: tr.rom ? round(tr.rom.h, 1) : null,
        rom_v_cm: tr.rom ? round(tr.rom.v, 1) : null,
        valid_pct: tr.quality ? round(tr.quality.validPct, 1) : null,
        sample_rate_hz: tr.quality ? round(tr.quality.rateHz, 1) : null,
        dropouts: tr.quality ? tr.quality.dropouts : null,
        lost_ms: tr.quality ? Math.round(tr.quality.lostMs) : null,
        pause_ms: Math.round(tr.pauseMs || 0),
        recentres: tr.quality ? tr.quality.recentres : null
      };
    });
  }

  function summarizeGames(session, trialRows) {
    const rows = trialRows || summarizeTrials(session);
    const out = [];
    GAME_ORDER.forEach((g) => {
      const tr = rows.filter((r) => r.game === GAMES[g].name);
      if (!tr.length) return;
      const scores = tr.map((r) => r.score);
      const ev = session.events.filter((e) => e.game === g && e.outcome === 'correct');
      const cong = mean(ev.filter((e) => e.condition === 'congruent').map((e) => e.respMs));
      const incong = mean(ev.filter((e) => e.condition === 'incongruent').map((e) => e.respMs));
      const correct = tr.reduce((s, r) => s + r.correct, 0);
      const errors = tr.reduce((s, r) => s + r.errors, 0);
      out.push({
        participant_id: session.participantId,
        session_no: session.sessionNo,
        game: GAMES[g].name,
        trials: tr.length,
        score_total: scores.reduce((s, x) => s + x, 0),
        score_mean: round(mean(scores), 2),
        score_sd: round(sd(scores), 2),
        score_best: Math.max.apply(null, scores),
        score_first: scores[0],
        score_last: scores[scores.length - 1],
        score_change: scores[scores.length - 1] - scores[0],
        accuracy_pct: correct + errors ? round((correct / (correct + errors)) * 100, 1) : null,
        rt_mean_ms: round(mean(ev.map((e) => e.rtMs)), 0),
        resp_mean_ms: round(mean(ev.map((e) => e.respMs)), 0),
        path_eff_mean: round(mean(ev.map((e) => e.pathEff)), 3),
        stroop_resp_congruent_ms: g === 'colour' ? round(cong, 0) : null,
        stroop_resp_incongruent_ms: g === 'colour' ? round(incong, 0) : null,
        stroop_interference_ms: g === 'colour' && cong != null && incong != null ? round(incong - cong, 0) : null
      });
    });
    return out;
  }

  function progressRow(session) {
    const games = summarizeGames(session);
    const by = (k) => games.find((r) => r.game === GAMES[k].name) || {};
    return {
      participant_id: session.participantId,
      session_no: session.sessionNo,
      date: localDate(session.startedAt, session.tzOffsetMin),
      tracking_mode: session.mode,
      level: session.level,
      complete: session.complete ? 1 : 0,
      triangle_score_mean: by('triangle').score_mean,
      maths_score_mean: by('maths').score_mean,
      colour_score_mean: by('colour').score_mean,
      triangle_rt_mean_ms: by('triangle').rt_mean_ms,
      maths_accuracy_pct: by('maths').accuracy_pct,
      colour_accuracy_pct: by('colour').accuracy_pct,
      stroop_interference_ms: by('colour').stroop_interference_ms,
      items_total: session.events.length
    };
  }

  /* ------------------------------------------------------------------ */
  /* Data-sheet column definitions (also feed the Data_Dictionary sheet) */
  /* ------------------------------------------------------------------ */

  // [key, unit, fmt, width, description]
  const C = (key, unit, fmt, width, desc) => ({ key, unit, fmt, width, desc });
  const COLS = {
    Trial_Summary: [
      C('participant_id', '', 'text', 14, 'Pseudonymous participant code.'),
      C('session_no', '', 'int', 10, 'Session number for this participant (1 = first).'),
      C('game', '', 'text', 18, 'Triangle Reach, Maths Fun or Colour Merge Test.'),
      C('trial', '', 'int', 7, 'Trial number within the game (1-based).'),
      C('level', '', 'int', 7, 'Difficulty level 1-3 (reach distance).'),
      C('tracking_mode', '', 'text', 13, '6dof (WebXR position tracking), motion (phone orientation + camera), touch (drag, demo) or sim (automated test).'),
      C('duration_s', 's', 'dec1', 10, 'Active trial time; excludes time paused for tracking loss or by the therapist.'),
      C('score', 'count', 'int', 7, 'Correct touches in the trial (the game score).'),
      C('items_presented', 'count', 'int', 10, 'Targets or questions shown in the trial.'),
      C('touches', 'count', 'int', 9, 'All registered touches, correct and wrong.'),
      C('correct', 'count', 'int', 8, 'Items completed with the correct touch.'),
      C('errors', 'count', 'int', 8, 'Touches on a wrong option.'),
      C('misses', 'count', 'int', 8, 'Items not reached within the item time limit.'),
      C('accuracy_pct', '%', 'dec1', 11, 'correct / (correct + errors) x 100.'),
      C('first_try_pct', '%', 'dec1', 11, 'Share of answered items whose first touch was correct.'),
      C('rt_mean_ms', 'ms', 'int', 11, 'Mean reaction time: item shown to movement onset (cursor 2 cm from start).'),
      C('rt_median_ms', 'ms', 'int', 11, 'Median reaction time.'),
      C('mt_mean_ms', 'ms', 'int', 11, 'Mean movement time: movement onset to entering the correct target.'),
      C('resp_mean_ms', 'ms', 'int', 11, 'Mean response time: item shown to confirmed correct touch (includes dwell).'),
      C('path_mean_cm', 'cm', 'dec1', 11, 'Mean cursor path length per reach.'),
      C('path_eff_mean', 'ratio', 'dec3', 11, 'Mean path efficiency: straight-line distance / path length (1 = perfectly straight).'),
      C('peak_speed_mean_cms', 'cm/s', 'dec1', 13, 'Mean of per-reach peak cursor speed.'),
      C('rom_h_cm', 'cm', 'dec1', 9, 'Horizontal range of the cursor during the trial (max x - min x).'),
      C('rom_v_cm', 'cm', 'dec1', 9, 'Vertical range of the cursor during the trial (max y - min y).'),
      C('valid_pct', '%', 'dec1', 9, 'Share of trial wall-clock time with healthy tracking.'),
      C('sample_rate_hz', 'Hz', 'dec1', 12, 'Mean rate of valid sensor samples during the trial.'),
      C('dropouts', 'count', 'int', 9, 'Number of tracking-loss episodes (no valid sample for 250 ms).'),
      C('lost_ms', 'ms', 'int', 9, 'Total time the game was auto-paused for tracking loss.'),
      C('pause_ms', 'ms', 'int', 9, 'Total time paused by the therapist.'),
      C('recentres', 'count', 'int', 9, 'Times the forward direction was reset during the trial.')
    ],
    Game_Summary: [
      C('participant_id', '', 'text', 14, 'Pseudonymous participant code.'),
      C('session_no', '', 'int', 10, 'Session number.'),
      C('game', '', 'text', 18, 'Game name.'),
      C('trials', 'count', 'int', 7, 'Trials played.'),
      C('score_total', 'count', 'int', 10, 'Sum of trial scores.'),
      C('score_mean', 'count', 'dec2', 10, 'Mean trial score.'),
      C('score_sd', 'count', 'dec2', 9, 'Standard deviation of trial scores (n-1).'),
      C('score_best', 'count', 'int', 10, 'Highest trial score.'),
      C('score_first', 'count', 'int', 10, 'Score in trial 1.'),
      C('score_last', 'count', 'int', 10, 'Score in the last trial.'),
      C('score_change', 'count', 'int', 11, 'Last trial score minus first trial score.'),
      C('accuracy_pct', '%', 'dec1', 11, 'correct / (correct + errors) x 100 across trials.'),
      C('rt_mean_ms', 'ms', 'int', 11, 'Mean reaction time across correct items.'),
      C('resp_mean_ms', 'ms', 'int', 11, 'Mean response time across correct items.'),
      C('path_eff_mean', 'ratio', 'dec3', 11, 'Mean path efficiency across correct items.'),
      C('stroop_resp_congruent_ms', 'ms', 'int', 14, 'Colour Merge Test: mean response time, congruent items.'),
      C('stroop_resp_incongruent_ms', 'ms', 'int', 14, 'Colour Merge Test: mean response time, incongruent items.'),
      C('stroop_interference_ms', 'ms', 'int', 14, 'Colour Merge Test: incongruent minus congruent mean response time.')
    ],
    Events: [
      C('participant_id', '', 'text', 14, 'Pseudonymous participant code.'),
      C('session_no', '', 'int', 10, 'Session number.'),
      C('game', '', 'text', 18, 'Game name.'),
      C('trial', '', 'int', 7, 'Trial number.'),
      C('item', '', 'int', 6, 'Item number within the trial.'),
      C('onset_s', 's', 'dec2', 9, 'Session time when the item appeared.'),
      C('stimulus', '', 'text', 16, 'What was shown: triangle, the sum (e.g. 3 + 4) or the colour to find.'),
      C('options', '', 'text', 34, 'Every option shown: label / ink @ direction in degrees (0 = right, 90 = up).'),
      C('target_dir_deg', 'deg', 'int', 11, 'Direction of the correct target from the centre (0 = right, 90 = up).'),
      C('target_dir_name', '', 'text', 12, 'Direction name of the correct target.'),
      C('target_dist_cm', 'cm', 'dec1', 11, 'Distance from the centre to the correct target.'),
      C('correct_answer', '', 'text', 10, 'Correct answer (Maths Fun: the number; Colour Merge Test: the ink colour).'),
      C('first_response', '', 'text', 10, 'Option touched first (blank if none).'),
      C('outcome', '', 'text', 10, 'correct, timeout (item time limit reached) or trial_end (trial ended mid-item).'),
      C('correct', '0/1', 'int', 8, '1 if the item ended with the correct touch.'),
      C('first_try', '0/1', 'int', 8, '1 if the first touch was correct.'),
      C('errors_before', 'count', 'int', 9, 'Wrong touches before the correct one.'),
      C('rt_ms', 'ms', 'int', 8, 'Reaction time: item shown to movement onset.'),
      C('mt_ms', 'ms', 'int', 8, 'Movement time: movement onset to entering the correct target.'),
      C('resp_ms', 'ms', 'int', 8, 'Response time: item shown to confirmed correct touch.'),
      C('path_cm', 'cm', 'dec1', 8, 'Cursor path length from item shown to target entry.'),
      C('straight_cm', 'cm', 'dec1', 9, 'Straight-line distance from start position to target entry.'),
      C('path_eff', 'ratio', 'dec3', 8, 'straight_cm / path_cm.'),
      C('peak_speed_cms', 'cm/s', 'dec1', 11, 'Peak cursor speed during the reach.'),
      C('condition', '', 'text', 12, 'Triangle Reach: direction; Maths Fun: addition or subtraction; Colour Merge Test: congruent or incongruent.')
    ],
    Kinematics: [
      C('participant_id', '', 'text', 14, 'Pseudonymous participant code.'),
      C('session_no', '', 'int', 10, 'Session number.'),
      C('t_s', 's', 'dec2', 8, 'Session time, sampled at a fixed 20 Hz during play.'),
      C('game', '', 'text', 16, 'Game name (or Range check).'),
      C('trial', '', 'int', 6, 'Trial number.'),
      C('phase', '', 'text', 9, 'home (returning to centre), reach (target shown) or feedback.'),
      C('x_cm', 'cm', 'dec1', 7, 'Cursor position right of centre (filtered). In motion/touch mode, projected 50 cm along the phone view.'),
      C('y_cm', 'cm', 'dec1', 7, 'Cursor position above centre (filtered).'),
      C('z_cm', 'cm', 'dec1', 7, 'Cursor depth relative to the centre point (filtered).'),
      C('hand_x_cm', 'cm', 'dec1', 10, '6-DoF only: phone position right of the calibration point.'),
      C('hand_y_cm', 'cm', 'dec1', 10, '6-DoF only: phone position above the calibration point.'),
      C('hand_z_cm', 'cm', 'dec1', 10, '6-DoF only: phone position forward of the calibration point.'),
      C('yaw_deg', 'deg', 'dec1', 9, 'Phone heading, positive to the right.'),
      C('pitch_deg', 'deg', 'dec1', 9, 'Phone elevation, positive up.'),
      C('roll_deg', 'deg', 'dec1', 9, 'Phone roll, positive clockwise as the user sees it.'),
      C('speed_cms', 'cm/s', 'dec1', 10, 'Cursor speed.'),
      C('tracking_ok', '0/1', 'int', 11, '1 when tracking was healthy at that moment.')
    ],
    Sensor_Quality: [
      C('participant_id', '', 'text', 14, 'Pseudonymous participant code.'),
      C('session_no', '', 'int', 10, 'Session number.'),
      C('t_s', 's', 'dec2', 8, 'Session time of the event.'),
      C('game', '', 'text', 16, 'Game name, Calibration or Range check.'),
      C('trial', '', 'int', 6, 'Trial number (blank outside trials).'),
      C('event', '', 'text', 18, 'calibration, calibration_override, range_dot, tracking_lost, tracking_restored, recentre, pause, resume, camera, wake_lock.'),
      C('value', '', 'dec2', 9, 'Numeric value of the event (e.g. lost duration in ms, rate in Hz).'),
      C('detail', '', 'text', 50, 'Description.')
    ],
    Progress: [
      C('participant_id', '', 'text', 14, 'Pseudonymous participant code.'),
      C('session_no', '', 'int', 10, 'Session number.'),
      C('date', '', 'text', 11, 'Session date (YYYY-MM-DD).'),
      C('tracking_mode', '', 'text', 13, 'Tracking mode used.'),
      C('level', '', 'int', 7, 'Difficulty level.'),
      C('complete', '0/1', 'int', 9, '1 if every planned trial was played.'),
      C('triangle_score_mean', 'count', 'dec2', 12, 'Triangle Reach mean trial score.'),
      C('maths_score_mean', 'count', 'dec2', 12, 'Maths Fun mean trial score.'),
      C('colour_score_mean', 'count', 'dec2', 12, 'Colour Merge Test mean trial score.'),
      C('triangle_rt_mean_ms', 'ms', 'int', 12, 'Triangle Reach mean reaction time.'),
      C('maths_accuracy_pct', '%', 'dec1', 12, 'Maths Fun accuracy.'),
      C('colour_accuracy_pct', '%', 'dec1', 12, 'Colour Merge Test accuracy.'),
      C('stroop_interference_ms', 'ms', 'int', 13, 'Colour Merge Test interference effect.'),
      C('items_total', 'count', 'int', 10, 'Items presented in the session.')
    ],
    Sessions: [
      C('participant_id', '', 'text', 14, 'Pseudonymous participant code.'),
      C('session_no', '', 'int', 10, 'Session number.'),
      C('date', '', 'text', 11, 'Session date.'),
      C('start_time', '', 'text', 9, 'Local start time.'),
      C('end_time', '', 'text', 9, 'Local end time.'),
      C('group', '', 'text', 12, 'Study group.'),
      C('therapist', '', 'text', 10, 'Therapist initials.'),
      C('affected_side', '', 'text', 11, 'Affected side.'),
      C('hand_mode', '', 'text', 16, 'Affected hand alone, or assisted by the unaffected hand.'),
      C('tracking_mode', '', 'text', 13, 'Tracking mode used.'),
      C('level', '', 'int', 7, 'Difficulty level.'),
      C('trials_per_game', '', 'int', 10, 'Planned trials per game.'),
      C('trial_s', 's', 'int', 8, 'Planned trial length.'),
      C('complete', '0/1', 'int', 9, '1 if every planned trial was played.'),
      C('cal_rate_hz', 'Hz', 'dec1', 10, 'Calibration sample rate.'),
      C('cal_jitter_cm', 'cm', 'dec2', 11, 'Calibration jitter (RMS distance from mean while holding still).'),
      C('cal_pass', '0/1', 'int', 9, '1 if calibration passed every check.'),
      C('cal_override', '0/1', 'int', 11, '1 if the therapist continued after a failed check.'),
      C('adverse_events', '', 'text', 24, 'Adverse events noted by the therapist.'),
      C('notes', '', 'text', 30, 'Session notes.')
    ],
    Questionnaire: [
      C('participant_id', '', 'text', 14, 'Pseudonymous participant code.'),
      C('session_no', '', 'int', 10, 'Session number.'),
      C('item', '', 'text', 6, 'Question code.'),
      C('question', '', 'text', 60, 'Question text (after the USEQ-based questionnaire in Li et al. 2021).'),
      C('response', '', 'text', 30, 'Score 1-5 (1 strongly disagree, 5 strongly agree) or free text.')
    ]
  };

  const QUESTIONS = [
    ['Q1', 'Did you enjoy your experience with the system?'],
    ['Q2', 'Were you successful using the system?'],
    ['Q3', 'Were you able to control the system?'],
    ['Q4', 'Is the information provided by the system clear?'],
    ['Q5', 'Did you feel comfortable during your experience with the system?'],
    ['Q6', 'Do you think that this system will be helpful for your rehabilitation?'],
    ['Q7', 'Do you think this system can be used for home-based rehabilitation?']
  ];

  function dirName(d) { return d == null ? '' : (DIR_NAMES[((d % 360) + 360) % 360] || String(d)); }

  function eventRow(session, e) {
    return {
      participant_id: session.participantId,
      session_no: session.sessionNo,
      game: GAMES[e.game] ? GAMES[e.game].name : e.game,
      trial: e.trial,
      item: e.item,
      onset_s: round(e.onsetMs / 1000, 2),
      stimulus: e.stimulus,
      options: e.options,
      target_dir_deg: e.targetDir,
      target_dir_name: dirName(e.targetDir),
      target_dist_cm: e.targetDistCm,
      correct_answer: e.correctAnswer,
      first_response: e.firstResponse,
      outcome: e.outcome,
      correct: e.outcome === 'correct' ? 1 : 0,
      first_try: e.firstTry,
      errors_before: e.errorsBefore,
      rt_ms: e.rtMs,
      mt_ms: e.mtMs,
      resp_ms: e.respMs,
      path_cm: e.pathCm,
      straight_cm: e.straightCm,
      path_eff: e.pathEff,
      peak_speed_cms: e.peakSpeedCms,
      condition: e.condition
    };
  }

  // Local clock parts. With a known UTC offset (minutes, recorded on the phone) the result does not depend on
  // where the code runs; without one it uses the machine's own time zone.
  function clockParts(iso, offMin) {
    if (!iso) return null;
    const d = new Date(iso);
    if (isNaN(d)) return null;
    if (typeof offMin === 'number' && Number.isFinite(offMin)) {
      const t = new Date(d.getTime() + offMin * 60000);
      return { y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate(), h: t.getUTCHours(), mi: t.getUTCMinutes(), s: t.getUTCSeconds() };
    }
    return { y: d.getFullYear(), mo: d.getMonth() + 1, d: d.getDate(), h: d.getHours(), mi: d.getMinutes(), s: d.getSeconds() };
  }
  function localTime(iso, offMin) {
    const c = clockParts(iso, offMin);
    if (!c) return '';
    const p = (n) => String(n).padStart(2, '0');
    return p(c.h) + ':' + p(c.mi) + ':' + p(c.s);
  }
  function localDate(iso, offMin) {
    const c = clockParts(iso, offMin);
    if (!c) return '';
    const p = (n) => String(n).padStart(2, '0');
    return c.y + '-' + p(c.mo) + '-' + p(c.d);
  }

  function sessionRow(s) {
    return {
      participant_id: s.participantId,
      session_no: s.sessionNo,
      date: localDate(s.startedAt, s.tzOffsetMin),
      start_time: localTime(s.startedAt, s.tzOffsetMin),
      end_time: localTime(s.endedAt, s.tzOffsetMin),
      group: s.group,
      therapist: s.therapist,
      affected_side: s.affectedSide,
      hand_mode: s.handMode,
      tracking_mode: s.mode,
      level: s.level,
      trials_per_game: s.trialsPerGame,
      trial_s: s.trialSec,
      complete: s.complete ? 1 : 0,
      cal_rate_hz: s.calibration ? round(s.calibration.rateHz, 1) : null,
      cal_jitter_cm: s.calibration ? round(s.calibration.jitterCm, 2) : null,
      cal_pass: s.calibration ? (s.calibration.pass ? 1 : 0) : null,
      cal_override: s.calibration ? (s.calibration.override ? 1 : 0) : null,
      adverse_events: s.adverse || '',
      notes: s.notes || ''
    };
  }

  function rowsFrom(cols, objs) { return objs.map((o) => cols.map((c) => (o[c.key] === undefined ? null : o[c.key]))); }

  function qualityRows(s) {
    return (s.quality || []).map((q) => [s.participantId, s.sessionNo, round(q.tMs / 1000, 2), q.game || '', q.trial == null ? null : q.trial, q.event, q.value == null ? null : q.value, q.detail || '']);
  }

  function questionnaireRows(s) {
    const q = s.questionnaire;
    if (!q) return [];
    const rows = QUESTIONS.map(([k, text]) => [s.participantId, s.sessionNo, k, text, q[k] == null ? '' : String(q[k])]);
    rows.push([s.participantId, s.sessionNo, 'Q8', 'Did you experience any negative symptoms during or after gameplay?', q.negative || '']);
    rows.push([s.participantId, s.sessionNo, 'Q9', 'What are some suggestions you have that you think could improve the system?', q.suggestions || '']);
    return rows;
  }

  function dictionarySheet(sheetNames) {
    const rows = [];
    sheetNames.forEach((name) => {
      (COLS[name] || []).forEach((c) => rows.push([name, c.key, c.unit || '', c.desc]));
    });
    return {
      name: 'Data_Dictionary',
      columns: [
        { header: 'sheet', width: 16 }, { header: 'variable', width: 26 },
        { header: 'unit', width: 8 }, { header: 'description', width: 90, fmt: 'wrap' }
      ],
      rows
    };
  }

  function colsToSheetCols(cols) { return cols.map((c) => ({ header: c.key, width: c.width, fmt: c.fmt })); }

  function sessionFileName(s, ext) {
    const id = String(s.participantId || 'P').replace(/[^A-Za-z0-9_-]/g, '');
    return 'CARS_' + id + '_S' + String(s.sessionNo).padStart(2, '0') + '_' + localDate(s.startedAt, s.tzOffsetMin) + '.' + (ext || 'xlsx');
  }

  // Build the per-session workbook specification.
  function sessionWorkbookSpec(s, history) {
    const trialObjs = summarizeTrials(s);
    const gameObjs = summarizeGames(s, trialObjs);
    const all = (history || []).filter((h) => h.participantId === s.participantId && h.id !== s.id).concat([s])
      .sort((a, b) => a.sessionNo - b.sessionNo || String(a.startedAt).localeCompare(String(b.startedAt)));
    const cal = s.calibration || {};
    const kv = [
      ['Data sheet', 'CARS Rehab session record'],
      ['Participant ID', s.participantId],
      ['Group', s.group],
      ['Session number', s.sessionNo],
      ['Date', localDate(s.startedAt, s.tzOffsetMin)],
      ['Start time', localTime(s.startedAt, s.tzOffsetMin)],
      ['End time', localTime(s.endedAt, s.tzOffsetMin)],
      ['Session complete', s.complete ? 'Yes' : 'No (ended early)'],
      ['Therapist', s.therapist || ''],
      ['Affected side', s.affectedSide],
      ['Hand mode', s.handMode],
      ['Difficulty level', s.level],
      ['Reach distance', s.mode === '6dof' ? LEVELS[s.level].cm + ' cm' : LEVELS[s.level].deg + ' degrees'],
      ['Games played', (s.games || []).map((g) => GAMES[g].name).join(', ')],
      ['Trials per game', s.trialsPerGame],
      ['Trial length (s)', s.trialSec],
      ['Touch dwell (ms)', s.dwellMs],
      ['Item time limit (s)', s.itemTimeoutSec],
      ['Tracking mode', s.mode],
      ['Camera view', s.camera || 'n/a'],
      ['Device', s.device || ''],
      ['Calibration rate (Hz)', round(cal.rateHz, 1)],
      ['Calibration jitter (cm)', round(cal.jitterCm, 2)],
      ['Calibration passed', cal.pass ? 'Yes' : 'No'],
      ['Calibration override', cal.override ? 'Yes (therapist continued after a failed check)' : 'No'],
      ['Calibration attempts', cal.attempts || 1],
      ['Range check', (cal.range || []).map((r) => dirName(r.dir) + ': ' + (r.reached ? (r.ms / 1000).toFixed(1) + ' s' : 'not reached')).join('; ')],
      ['Random seed', s.seed],
      ['Adverse events', s.adverse || 'None recorded'],
      ['Notes', s.notes || ''],
      ['App version', s.appVersion || VERSION],
      ['Generated', new Date().toISOString()]
    ];
    const sheets = [
      { name: 'Session', kv: true, columns: [{ header: 'field', width: 26 }, { header: 'value', width: 60, fmt: 'wrap' }], rows: kv },
      { name: 'Trial_Summary', columns: colsToSheetCols(COLS.Trial_Summary), rows: rowsFrom(COLS.Trial_Summary, trialObjs) },
      { name: 'Game_Summary', columns: colsToSheetCols(COLS.Game_Summary), rows: rowsFrom(COLS.Game_Summary, gameObjs) },
      { name: 'Events', columns: colsToSheetCols(COLS.Events), rows: rowsFrom(COLS.Events, s.events.map((e) => eventRow(s, e))) },
      { name: 'Kinematics', columns: colsToSheetCols(COLS.Kinematics), rows: (s.kin || []).map((r) => [s.participantId, s.sessionNo].concat(r)) },
      { name: 'Sensor_Quality', columns: colsToSheetCols(COLS.Sensor_Quality), rows: qualityRows(s) },
      { name: 'Questionnaire', columns: colsToSheetCols(COLS.Questionnaire), rows: questionnaireRows(s) },
      { name: 'Progress', columns: colsToSheetCols(COLS.Progress), rows: rowsFrom(COLS.Progress, all.map(progressRow)) }
    ];
    sheets.push(dictionarySheet(['Trial_Summary', 'Game_Summary', 'Events', 'Kinematics', 'Sensor_Quality', 'Questionnaire', 'Progress']));
    return { title: 'CARS ' + s.participantId + ' session ' + s.sessionNo, sheets };
  }

  // Whole-study workbook: every session stored on the device (kinematics left out for size).
  function studyWorkbookSpec(sessions) {
    const list = sessions.slice().sort((a, b) => String(a.participantId).localeCompare(String(b.participantId)) || a.sessionNo - b.sessionNo);
    const trials = [], games = [], events = [], quality = [], questions = [];
    list.forEach((s) => {
      const t = summarizeTrials(s);
      trials.push(...t);
      games.push(...summarizeGames(s, t));
      s.events.forEach((e) => events.push(eventRow(s, e)));
      quality.push(...qualityRows(s));
      questions.push(...questionnaireRows(s));
    });
    const sheets = [
      { name: 'Sessions', columns: colsToSheetCols(COLS.Sessions), rows: rowsFrom(COLS.Sessions, list.map(sessionRow)) },
      { name: 'Progress', columns: colsToSheetCols(COLS.Progress), rows: rowsFrom(COLS.Progress, list.map(progressRow)) },
      { name: 'Trial_Summary', columns: colsToSheetCols(COLS.Trial_Summary), rows: rowsFrom(COLS.Trial_Summary, trials) },
      { name: 'Game_Summary', columns: colsToSheetCols(COLS.Game_Summary), rows: rowsFrom(COLS.Game_Summary, games) },
      { name: 'Events', columns: colsToSheetCols(COLS.Events), rows: rowsFrom(COLS.Events, events) },
      { name: 'Sensor_Quality', columns: colsToSheetCols(COLS.Sensor_Quality), rows: quality },
      { name: 'Questionnaire', columns: colsToSheetCols(COLS.Questionnaire), rows: questions }
    ];
    sheets.push(dictionarySheet(['Sessions', 'Progress', 'Trial_Summary', 'Game_Summary', 'Events', 'Sensor_Quality', 'Questionnaire']));
    return { title: 'CARS study export', sheets };
  }

  function csvEscape(v) {
    if (v == null) return '';
    const s = String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function eventsCsv(s) {
    const cols = COLS.Events;
    const lines = [cols.map((c) => c.key).join(',')];
    rowsFrom(cols, s.events.map((e) => eventRow(s, e))).forEach((r) => lines.push(r.map(csvEscape).join(',')));
    return lines.join('\r\n') + '\r\n';
  }

  /* ------------------------------------------------------------------ */
  /* Minimal XLSX writer (Office Open XML, inline strings, styled header) */
  /* ------------------------------------------------------------------ */

  const STYLE = { text: 0, header: 1, int: 2, dec1: 3, dec2: 4, key: 5, title: 6, dec3: 7, wrap: 8 };

  function colName(i) {
    let n = i + 1, s = '';
    while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
    return s;
  }

  function xmlEsc(v) {
    return String(v)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
      .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '$1')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function safeSheetName(name, used) {
    let n = String(name).replace(/[\[\]:*?\/\\]/g, '_').slice(0, 31) || 'Sheet';
    let k = 2; const base = n;
    while (used.has(n.toLowerCase())) { n = (base.slice(0, 28) + '_' + k++); }
    used.add(n.toLowerCase());
    return n;
  }

  function cellXml(ref, v, style) {
    if (v === null || v === undefined || v === '') return '';
    if (typeof v === 'boolean') v = v ? 1 : 0;
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) return '';
      return '<c r="' + ref + '"' + (style ? ' s="' + style + '"' : '') + '><v>' + v + '</v></c>';
    }
    return '<c r="' + ref + '" t="inlineStr"' + (style ? ' s="' + style + '"' : '') + '><is><t xml:space="preserve">' + xmlEsc(v) + '</t></is></c>';
  }

  function sheetXml(sheet, index) {
    const cols = sheet.columns;
    const nCols = cols.length;
    const rows = sheet.rows;
    const lastRow = rows.length + 1;
    const lastRef = colName(Math.max(0, nCols - 1)) + lastRow;
    const parts = [];
    parts.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n');
    parts.push('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">');
    parts.push('<dimension ref="A1:' + lastRef + '"/>');
    parts.push('<sheetViews><sheetView workbookViewId="0"' + (index === 0 ? ' tabSelected="1"' : '') + '>');
    parts.push('<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/>');
    parts.push('</sheetView></sheetViews>');
    parts.push('<sheetFormatPr defaultRowHeight="15"/>');
    parts.push('<cols>');
    cols.forEach((c, i) => {
      const w = Math.max(c.width || 10, String(c.header).length + 2);
      parts.push('<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>');
    });
    parts.push('</cols><sheetData>');
    parts.push('<row r="1" ht="20" customHeight="1">');
    cols.forEach((c, i) => parts.push(cellXml(colName(i) + '1', c.header, STYLE.header)));
    parts.push('</row>');
    const styles = cols.map((c) => STYLE[c.fmt] || 0);
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      const rn = r + 2;
      let s = '<row r="' + rn + '">';
      for (let i = 0; i < nCols; i++) {
        let st = styles[i];
        if (sheet.kv && i === 0) st = STYLE.key;
        const v = row[i];
        if (typeof v === 'string' && (st === STYLE.int || st >= STYLE.dec1 && st <= STYLE.dec2 || st === STYLE.dec3)) st = 0;
        s += cellXml(colName(i) + rn, v, st);
      }
      parts.push(s + '</row>');
    }
    parts.push('</sheetData>');
    if (!sheet.kv && nCols > 0) parts.push('<autoFilter ref="A1:' + lastRef + '"/>');
    parts.push('<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>');
    parts.push('</worksheet>');
    return { xml: parts.join(''), filterRef: !sheet.kv && nCols > 0 ? 'A1:' + lastRef : null };
  }

  const STYLES_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="3"><numFmt numFmtId="164" formatCode="0.0"/><numFmt numFmtId="165" formatCode="0.00"/><numFmt numFmtId="166" formatCode="0.000"/></numFmts>' +
    '<fonts count="4">' +
    '<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>' +
    '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>' +
    '<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>' +
    '<font><b/><sz val="14"/><name val="Calibri"/><family val="2"/></font>' +
    '</fonts>' +
    '<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FF0B5C50"/><bgColor indexed="64"/></patternFill></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFE8F1EE"/><bgColor indexed="64"/></patternFill></fill></fills>' +
    '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>' +
    '<border><left/><right/><top/><bottom style="thin"><color rgb="FFB9CCC6"/></bottom><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="9">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf>' +
    '<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>' +
    '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    '<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
    '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(u8) {
    let c = 0xffffffff;
    for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  async function deflateRaw(u8) {
    const cs = new CompressionStream('deflate-raw');
    const stream = new Blob([u8]).stream().pipeThrough(cs);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function zip(files, opts) {
    const enc = new TextEncoder();
    const useDeflate = !(opts && opts.store) && typeof CompressionStream === 'function';
    const now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const chunks = [], central = [];
    let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name);
      const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
      const crc = crc32(data);
      let body = data, method = 0;
      if (useDeflate && data.length > 128) {
        try { const d = await deflateRaw(data); if (d.length < data.length) { body = d; method = 8; } } catch (e) { /* store */ }
      }
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
      lh.setUint16(8, method, true); lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, body.length, true); lh.setUint32(22, data.length, true);
      lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      chunks.push(new Uint8Array(lh.buffer), name, body);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
      ch.setUint16(10, method, true); ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, body.length, true); ch.setUint32(24, data.length, true);
      ch.setUint16(28, name.length, true); ch.setUint16(30, 0, true); ch.setUint16(32, 0, true);
      ch.setUint16(34, 0, true); ch.setUint16(36, 0, true); ch.setUint32(38, 0, true); ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + body.length;
    }
    const cdSize = central.reduce((s, c) => s + c.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    const all = chunks.concat(central, [new Uint8Array(end.buffer)]);
    const total = all.reduce((s, c) => s + c.length, 0);
    const out = new Uint8Array(total);
    let p = 0;
    all.forEach((c) => { out.set(c, p); p += c.length; });
    return out;
  }

  async function buildXlsx(spec, opts) {
    const used = new Set();
    const sheets = spec.sheets.map((s) => Object.assign({}, s, { safeName: safeSheetName(s.name, used) }));
    const files = [];
    const ctOverrides = sheets.map((s, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('');
    files.push({ name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' + ctOverrides + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>' });
    files.push({ name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>' });
    const iso = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    files.push({ name: 'docProps/core.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>' + xmlEsc(spec.title || 'CARS data') + '</dc:title><dc:creator>CARS Rehab ' + VERSION + '</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">' + iso + '</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">' + iso + '</dcterms:modified></cp:coreProperties>' });
    files.push({ name: 'docProps/app.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>CARS Rehab</Application></Properties>' });
    const defined = [];
    const sheetEntries = [];
    sheets.forEach((s, i) => {
      const built = sheetXml(s, i);
      files.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', data: built.xml });
      sheetEntries.push('<sheet name="' + xmlEsc(s.safeName) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>');
      if (built.filterRef) {
        const abs = built.filterRef.replace(/([A-Z]+)(\d+)/g, '$$$1$$$2');
        defined.push('<definedName name="_xlnm._FilterDatabase" localSheetId="' + i + '" hidden="1">\'' + xmlEsc(s.safeName).replace(/'/g, "''") + '\'!' + abs + '</definedName>');
      }
    });
    files.push({ name: 'xl/workbook.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="0"/></bookViews><sheets>' + sheetEntries.join('') + '</sheets>' + (defined.length ? '<definedNames>' + defined.join('') + '</definedNames>' : '') + '</workbook>' });
    const rels = sheets.map((s, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('');
    files.push({ name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + rels + '<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' });
    files.push({ name: 'xl/styles.xml', data: STYLES_XML });
    return zip(files, opts);
  }

  return {
    VERSION, GAMES, GAME_ORDER, LEVELS, DIRS, DIR_NAMES, COLOURS, CAL_RULES, QUESTIONS, COLS,
    TARGET_RADIUS_M, HOME_RADIUS_M, AHEAD_ANGULAR_M, AHEAD_6DOF_M, DEG,
    makeRng, v3, quat, deviceOrientationToQuat, forwardOf, yawPitchRoll, yawPitchToward, cursorFromPose,
    makeCalibration, placeOnRing, toCalFrame, angDiff, dirName,
    triangleSequence, optionDirections, layoutOptions, genMaths, genColour,
    OneEuro3, TrackingHealth, measureCalibration, ReachTracker,
    round, mean, median, sd,
    summarizeTrials, summarizeGames, progressRow, sessionRow, eventRow,
    sessionWorkbookSpec, studyWorkbookSpec, sessionFileName, eventsCsv,
    buildXlsx, zip, crc32, colName, xmlEsc, localDate, localTime
  };
});
