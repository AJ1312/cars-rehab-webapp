// Shared synthetic session used by the unit and API tests.
const C = require('../src/lib/core.js');

function fakeSession(id, sessionNo) {
  const rng = C.makeRng(sessionNo);
  const s = {
    id, participantId: 'P007', sessionNo, group: 'Experimental', therapist: 'AB', affectedSide: 'Right',
    handMode: 'Affected hand alone', level: 2, trialSec: 60, trialsPerGame: 2, dwellMs: 250, itemTimeoutSec: 15,
    games: ['triangle', 'maths', 'colour'], mode: 'motion', camera: 'on', device: 'test', seed: 1,
    startedAt: '2026-10-15T09:00:00.000Z', endedAt: '2026-10-15T09:35:00.000Z', complete: true,
    calibration: { rateHz: 60, jitterCm: 0.3, pass: true, override: false, attempts: 1, range: [{ dir: 180, reached: true, ms: 1800 }] },
    trials: [], events: [], kin: [], quality: [{ tMs: 1000, game: 'Calibration', event: 'calibration', value: 60, detail: 'pass' }],
    questionnaire: { Q1: 4, Q2: 5, Q3: 4, Q4: 5, Q5: 4, Q6: 4, Q7: 5, negative: 'none', suggestions: 'bigger screen, "levels"' },
    adverse: '', notes: 'Line one, with comma'
  };
  let t = 0;
  for (const g of s.games) for (let trial = 1; trial <= 2; trial++) {
    let score = 0;
    for (let item = 1; item <= 6; item++) {
      const outcome = item === 6 ? 'timeout' : 'correct';
      const errs = g !== 'triangle' && item === 2 ? 1 : 0;
      if (outcome === 'correct') score++;
      s.events.push({ game: g, trial, item, onsetMs: (t += 2500), stimulus: g === 'maths' ? '3 + 4' : g, options: 'x', targetDir: 90, targetDistCm: 26.1,
        correctAnswer: g === 'maths' ? '7' : '', firstResponse: errs ? '6' : '7', outcome, firstTry: outcome === 'correct' ? (errs ? 0 : 1) : null, errorsBefore: errs,
        rtMs: 300 + item * 10, mtMs: 700, respMs: 1250 + (g === 'colour' && item % 2 ? 200 : 0), pathCm: 31, straightCm: 26, pathEff: 0.84, peakSpeedCms: 80,
        condition: g === 'colour' ? (item % 2 ? 'incongruent' : 'congruent') : 'up' });
    }
    s.trials.push({ game: g, trial, level: 2, activeMs: 60000, score, rom: { h: 50, v: 40 }, pauseMs: 0, quality: { validPct: 99.5, rateHz: 59.8, dropouts: 0, lostMs: 0, recentres: 0 } });
  }
  for (let i = 0; i < 200; i++) s.kin.push([i * 0.05, 'Triangle Reach', 1, 'reach', 1.1, 2.2, 0, null, null, null, 3.3, 4.4, 0.1, 12.5, 1]);
  return s;
}


module.exports = { fakeSession };
