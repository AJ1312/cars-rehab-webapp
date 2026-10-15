/* eslint-disable @typescript-eslint/no-explicit-any */
import core from '../core';
import type { Mode, Q4, Sensor, V3 } from './sensors';
import { ArView, type ViewCam, type ViewFrame, type ViewObj, type ObjKind } from './arview';
import { mat4 } from './glmath';
import type { Cue } from './sfx';
import type { SessionInput } from '../schema';

export type GameKey = 'triangle' | 'maths' | 'colour';

export interface SessionConfig {
  participantId: string; sessionNo: number; group: string; therapist: string; affectedSide: string; handMode: string;
  mode: Mode; level: 1 | 2 | 3; games: GameKey[]; trialsPerGame: number; trialSec: number; dwellMs: number; itemTimeoutSec: number;
  camera: 'on' | 'off'; homeGate: boolean; device: string; seed: number; skipRange?: boolean;
}

export type Phase = 'idle' | 'starting' | 'cal_ready' | 'cal_hold' | 'cal_result' | 'range' | 'game_intro' | 'countdown' | 'playing' | 'trial_end' | 'finished' | 'error';
export interface CalResult { rateHz: number; jitterCm: number | null; pass: boolean; reasons: string[]; minRate: number; maxJitterCm: number }
export interface TrialEnd { game: GameKey; trial: number; score: number; correct: number; errors: number; misses: number; accuracyPct: number | null; rtMeanMs: number | null; validPct: number | null; dropouts: number }

export interface Snapshot {
  phase: Phase; error: string | null;
  tracking: 'waiting' | 'ok' | 'lost'; rateHz: number; manualPause: boolean;
  cal: { progress: number; result: CalResult | null; attempts: number };
  range: { index: number; total: number; secLeft: number; results: { dir: number; reached: boolean; ms: number | null }[] };
  game: GameKey | null; gameIndex: number; gameCount: number; trialNo: number; trialsTotal: number;
  timeLeftS: number; score: number; itemNo: number;
  prompt: { caption: string; main: string } | null;
  countdown: number; trialEnd: TrialEnd | null; isLast: boolean; elapsedS: number;
}

interface Target {
  id: number; kind: ObjKind; pos: V3; zone: string; az: number; el: number; reachCm: number;
  opt: any | null; state: 'idle' | 'disabled' | 'wrong' | 'correct';
  dwell: number; enteredT: number | null; enteredP: V3 | null; stateT: number; bornT: number; hot: boolean;
}
interface Item {
  n: number; game: GameKey; data: any; targets: Target[]; onsetWall: number; onsetGame: number; tracker: any; start: V3;
  errors: number; firstResponse: string | null; stimulus: string; optionsText: string; correct: Target;
  correctAnswer: string; condition: string; closed: boolean;
}

const RANGE_DIRS = [0, 90, 180, 270];
const RANGE_TIMEOUT_MS = 12000;
const HOME_HOLD_MS = 200;
const KIN_DT = 50;
const FEEDBACK_OK_MS = 500;
const FEEDBACK_MISS_MS = 400;
const HOME_R = core.HOME_RADIUS_M as number;
const GAME_TEXT: Record<GameKey, { how: string; caption: string }> = {
  triangle: { how: 'Triangles float around you in the room. Reach to touch each one with the phone. Each new triangle appears somewhere else, so you will reach in different directions.', caption: 'Touch the triangle' },
  maths: { how: 'A sum appears in the middle. Numbers float around you. Reach and touch the number that is the answer. All numbers are from 1 to 10.', caption: 'Touch the answer' },
  colour: { how: 'A colour name appears in the middle. Words float around you, each written in a colour of ink. Touch the word whose INK is the colour named. Ignore what the words say.', caption: 'Touch the word written in this colour' }
};
const GAME_TEXT_ANGULAR: Record<GameKey, string> = {
  triangle: 'Triangles float around you in the room. Turn the phone so the ring in the middle of the screen lands on a triangle, and hold. Each new triangle appears somewhere else.',
  maths: 'A sum appears in the middle. Numbers float around you. Turn the phone so the ring lands on the number that is the answer, and hold. All numbers are from 1 to 10.',
  colour: 'A colour name appears in the middle. Words float around you, each written in a colour of ink. Aim the ring at the word whose INK is the colour named, and hold.'
};
export const gameInfo = (k: GameKey, mode?: Mode) => ({
  name: core.GAMES[k].name as string,
  how: mode === 'motion' || mode === 'touch' ? GAME_TEXT_ANGULAR[k] : GAME_TEXT[k].how,
  caption: GAME_TEXT[k].caption
});

const round = core.round as (x: number | null | undefined, d?: number) => number | null;

function emptySnap(cfg: SessionConfig): Snapshot {
  return {
    phase: 'idle', error: null, tracking: 'waiting', rateHz: 0, manualPause: false,
    cal: { progress: 0, result: null, attempts: 0 },
    range: { index: 0, total: RANGE_DIRS.length, secLeft: 0, results: [] },
    game: null, gameIndex: 0, gameCount: cfg.games.length, trialNo: 0, trialsTotal: cfg.trialsPerGame,
    timeLeftS: cfg.trialSec, score: 0, itemNo: 0, prompt: null, countdown: 0, trialEnd: null, isLast: false, elapsedS: 0
  };
}

export class Engine {
  private snap: Snapshot;
  private listeners = new Set<() => void>();
  private raf = 0; private disposed = false;
  private view: ArView | null = null;
  private t0 = 0; private lastT = 0; private gms = 0; private lastSnapT = 0;
  private rng: ReturnType<typeof core.makeRng>;
  private kind: 'linear' | 'angular';
  private ahead: number; private touchR: number;
  private placer: any; private source: any;
  private cal: any = null; private calQuat: Q4 = [0, 0, 0, 1]; private calEye: V3 = [0, 0, 0];
  private filter = new core.OneEuro3(1.2, 6, 1.0);
  private health = new core.TrackingHealth();
  private lastPoseT = -1; private prevRaw: V3 | null = null; private prevRawT = 0;
  private raw: V3 | null = null; private pose: { pos: V3; quat: Q4 } | null = null; private filt: V3 | null = null;
  private cur = { x: 0, y: 0, z: 0 };
  private startedAt = ''; private wake: any = null;
  private dead = false; private cameraLive = false; private idSeq = 1;

  // calibration
  private hold: { t: number; cursor: V3; pos: V3; quat: Q4 }[] = []; private holdStart = 0;
  private calResult: CalResult | null = null; private calAttempts = 0; private calOverride = false;
  private rangeResults: { dir: number; reached: boolean; ms: number | null }[] = [];
  private rangeIdx = 0; private rangeStartG = 0; private rangeTarget: Target | null = null;

  // play
  private gameIdx = 0; private trialNo = 0;
  private prevPl: any = null; private prevKey: string | undefined; private prevInk: string | undefined; private prevZone: string | undefined;
  private sub: 'home' | 'reach' | 'feedback' = 'home'; private homeHold = 0; private feedbackUntil = 0;
  private item: Item | null = null; private itemCount = 0; private score = 0;
  private countdownStart = 0; private lostPrev = false; private manualPause = false; private pauseStart = 0;
  private tq: any = null;
  private nextKin = 0; private lastKin: { t: number; p: V3 } | null = null;
  private ended = false; private completeFlag = false; private endedAt = '';

  // recorded data
  private trials: any[] = []; private events: any[] = []; private quality: any[] = []; private kin: any[][] = [];
  private onDestroyListeners: (() => void)[] = [];

  constructor(public readonly cfg: SessionConfig, private sensor: Sensor, private els: { gl: HTMLCanvasElement | null; overlay: HTMLCanvasElement }, private opts: { sfx?: (c: Cue) => void }) {
    this.snap = emptySnap(cfg);
    this.rng = core.makeRng(cfg.seed);
    this.kind = cfg.mode === '6dof' || cfg.mode === 'sim' ? 'linear' : 'angular';
    this.ahead = this.kind === 'linear' ? core.AHEAD_6DOF_M : core.AHEAD_ANGULAR_M;
    this.touchR = this.kind === 'linear' ? core.TOUCH_RADIUS_LINEAR_M : core.TARGET_RADIUS_M;
    this.placer = core.makePlacer(this.rng, this.kind, cfg.level);
    this.source = core.makeItemSource(this.rng, cfg.level);
    this.sensor.onEnd = (reason: string) => { if (!this.ended && !this.dead) this.fail('Tracking stopped (' + reason + '). Start again to continue.'); };
  }

  /* ---------------- subscription for React ---------------- */
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getSnapshot = () => this.snap;
  private emit(patch: Partial<Snapshot>) { this.snap = { ...this.snap, ...patch }; this.listeners.forEach((f) => f()); }
  /** True once a live camera picture is behind the canvas. */
  setCamera(live: boolean) { this.cameraLive = live; }
  private size: [number, number, number] | null = null;
  resize(w: number, h: number, dpr: number) { this.size = [w, h, dpr]; this.view?.resize(w, h, dpr); }
  /** Touch practice: a finger drag turns the view like a camera (content follows the finger). */
  look(dxPx: number, dyPx: number) { this.sensor.look?.(dxPx * 0.0045, dyPx * 0.0045); }
  private cue(c: Cue) { try { this.opts.sfx?.(c); } catch { /* sound is optional */ } }
  get isLinear() { return this.kind === 'linear'; }

  /* ---------------- lifecycle ---------------- */
  async begin(overlayRoot: HTMLElement) {
    this.t0 = performance.now(); this.startedAt = new Date().toISOString();
    try {
      await this.sensor.start({ overlayRoot });
    } catch (e: any) {
      this.fail(e?.message || 'Could not start tracking.'); return;
    }
    this.view = new ArView(this.els.gl, this.els.overlay, this.sensor.xrGL?.() ?? null);
    if (this.size) this.view.resize(this.size[0], this.size[1], this.size[2]);
    this.q('renderer', this.view.ok ? 1 : 0, this.view.ok ? 'WebGL ready' : 'WebGL not available; 2D fallback only');
    try { this.wake = await (navigator as any).wakeLock?.request('screen'); this.q('wake_lock', 1, 'Screen kept awake'); } catch { this.q('wake_lock', 0, 'Wake lock not available'); }
    const onVis = () => {
      if (document.hidden && this.snap.phase === 'playing' && !this.manualPause) this.setManualPause(true, 'App moved to background');
      if (!document.hidden && !this.wake) { (navigator as any).wakeLock?.request('screen').then((w: any) => { this.wake = w; }).catch(() => undefined); }
    };
    document.addEventListener('visibilitychange', onVis);
    this.onDestroyListeners.push(() => document.removeEventListener('visibilitychange', onVis));
    this.lastT = performance.now();
    this.emit({ phase: 'starting' });
    this.loop();
  }

  dispose() {
    this.dead = true; this.disposed = true;
    if (this.raf) this.sensor.cancelFrame(this.raf);
    this.onDestroyListeners.forEach((f) => f());
    this.view?.dispose();
    void this.sensor.stop();
    try { this.wake?.release?.(); } catch { /* ignore */ }
  }
  private fail(msg: string) { this.emit({ phase: 'error', error: msg }); }
  private loop = () => {
    if (this.disposed) return;
    this.raf = this.sensor.requestFrame((t) => { try { this.tick(t); } catch (e: any) { console.error(e); } this.loop(); });
  };

  /* ---------------- user actions (called from the overlay buttons) ---------------- */
  beginCalibration() {
    if (this.snap.phase !== 'cal_ready' && this.snap.phase !== 'cal_result') return;
    this.hold = []; this.holdStart = 0; this.calResult = null;
    this.emit({ phase: 'cal_hold', cal: { progress: 0, result: null, attempts: this.calAttempts } });
  }
  acceptCalibration(override = false) {
    const r = this.calResult; if (!r || this.hold.length < 3) return;
    if (!r.pass && !override) return;
    this.calOverride = !r.pass && override;
    const n = this.hold.length; const eye: V3 = [0, 0, 0]; const fwd: V3 = [0, 0, 0];
    for (const s of this.hold) { for (let i = 0; i < 3; i++) { eye[i] += s.pos[i] / n; } const f = core.forwardOf(s.quat) as V3; for (let i = 0; i < 3; i++) fwd[i] += f[i]; }
    this.calEye = eye; this.calQuat = this.hold[n - 1].quat;
    this.cal = core.makeCalibration(this.kind, eye, fwd, this.ahead);
    this.filter.reset(); this.filt = null;
    this.q(this.calOverride ? 'calibration_override' : 'calibration', r.rateHz, `jitter ${r.jitterCm?.toFixed(2)} cm; ${this.calOverride ? 'therapist continued after failed check: ' + r.reasons.join(' ') : 'passed'}`, 'Calibration');
    if (this.cfg.skipRange) { this.toGameIntro(); return; }
    this.rangeIdx = 0; this.rangeResults = [];
    this.startRangeDot();
    this.emit({ phase: 'range' });
  }
  skipRange() {
    if (this.snap.phase !== 'range') return;
    for (let i = this.rangeIdx; i < RANGE_DIRS.length; i++) this.rangeResults.push({ dir: RANGE_DIRS[i], reached: false, ms: null });
    this.q('range_dot', 0, 'Range check skipped by therapist', 'Range check');
    this.toGameIntro();
  }
  startTrial() {
    if (this.snap.phase !== 'game_intro' && this.snap.phase !== 'trial_end') return;
    this.countdownStart = performance.now();
    this.emit({ phase: 'countdown', countdown: 3, trialEnd: null });
  }
  next() {
    if (this.snap.phase !== 'trial_end') return;
    if (this.trialNo < this.cfg.trialsPerGame) { this.startTrial(); return; }
    if (this.gameIdx < this.cfg.games.length - 1) { this.gameIdx++; this.trialNo = 0; this.toGameIntro(); return; }
    this.finish(true);
  }
  setManualPause(on: boolean, why = 'Therapist') {
    if (this.snap.phase !== 'playing' && !(on === false)) return;
    if (on === this.manualPause) return;
    this.manualPause = on;
    const t = performance.now();
    if (on) { this.pauseStart = t; this.q('pause', 1, why, this.gameName(), this.trialNo); }
    else { const d = t - this.pauseStart; if (this.tq) this.tq.pauseMs += d; this.q('resume', Math.round(d), 'Resumed', this.gameName(), this.trialNo); this.resync(); }
    this.emit({ manualPause: on });
  }
  /** Re-zero: the current hand position and heading become the new centre (the room of targets moves with it). */
  recentre() {
    if (!this.pose || !this.cal) return;
    const f = core.forwardOf(this.pose.quat) as V3;
    this.calEye = this.pose.pos.slice() as V3; this.calQuat = this.pose.quat;
    this.cal = core.makeCalibration(this.kind, this.pose.pos, f, this.ahead);
    this.filter.reset(); this.filt = null;
    // Targets already on screen are re-placed relative to the new centre by simply keeping their calibrated coordinates.
    if (this.tq) this.tq.recentres++;
    this.q('recentre', 1, 'Centre reset', this.gameName(), this.trialNo || null);
    this.resync();
  }
  /** Ends the session early; whatever was recorded is kept and marked incomplete. */
  endEarly() { this.finish(false); }

  /* ---------------- test hooks (simulated tracking) ---------------- */
  debug() {
    const it = this.item;
    const list = it && this.sub === 'reach' ? it.targets : this.rangeTarget && this.snap.phase === 'range' ? [this.rangeTarget] : [];
    return {
      phase: this.snap.phase, sub: this.sub, kind: this.kind, gms: this.gms,
      handCm: [this.cur.x * 100, this.cur.y * 100, this.cur.z * 100],
      targets: list.map((t) => ({ posCm: t.pos.map((x) => x * 100), zone: t.zone, state: t.state, correct: it ? t === it.correct : true, label: t.opt?.label ?? '', ink: t.opt?.ink ?? '' })),
      item: it ? { n: it.n, game: it.game, stimulus: it.stimulus } : null,
      touchRadiusCm: this.touchR * 100,
      cal: this.cal ? { c: this.cal.c, center: this.cal.center } : null,
      frame: this.lastFrameInfo
    };
  }
  simHandCm(x: number, y: number, z: number) { this.sensor.setHand?.(x / 100, y / 100, z / 100); }
  /** Touch-practice sensors: absolute view direction in degrees. */
  simLook(yawDeg: number, pitchDeg: number) { this.sensor.setLook?.(yawDeg * core.DEG, pitchDeg * core.DEG); }
  simDrop(ms: number) { this.sensor.dropFor?.(ms); }
  /** Direction (degrees) that makes the aim point land on a target: angular modes. */
  aimFor(posCm: number[]) {
    const w = core.calToWorld(this.cal, posCm.map((x) => x / 100)) as V3;
    const d = core.v3.sub(w, this.calEye) as V3;
    const a = core.yawPitchToward(d);
    return { yaw: a.yaw / core.DEG, pitch: a.pitch / core.DEG };
  }

  /* ---------------- helpers ---------------- */
  private gameName() { const k = this.cfg.games[this.gameIdx]; return k ? (core.GAMES[k].name as string) : null; }
  private q(event: string, value: number | null, detail: string, game?: string | null, trial?: number | null) {
    this.quality.push({ tMs: Math.max(0, Math.round(performance.now() - this.t0)), game: game ?? null, trial: trial ?? null, event, value: value == null ? null : round(value, 2), detail });
  }
  private curVec(): V3 { return [this.cur.x, this.cur.y, this.cur.z]; }
  private resync() { if (this.item) { this.item.tracker.last = this.curVec(); this.item.tracker.lastT = this.gms; } this.lastKin = null; }
  private mkTarget(pl: { pos: V3; az: number; el: number; zone: string; reachCm: number }, kind: ObjKind, opt: any): Target {
    return { id: this.idSeq++, kind, pos: pl.pos, zone: pl.zone, az: pl.az, el: pl.el, reachCm: pl.reachCm, opt, state: 'idle', dwell: 0, enteredT: null, enteredP: null, stateT: 0, bornT: performance.now(), hot: false };
  }

  /* ---------------- per-frame processing ---------------- */
  private ingestPose(): boolean {
    const p = this.sensor.pose();
    if (!p || p.t === this.lastPoseT) return false;
    this.lastPoseT = p.t;
    let valid = p.valid && core.v3.finite(p.pos) && core.quat.finite(p.quat);
    const cur = valid ? (core.cursorFromPose(p.pos, p.quat, this.ahead) as V3) : null;
    // A jump faster than 15 m/s is a sensor glitch, not a hand.
    if (valid && cur && this.prevRaw && p.t - this.prevRawT < 100 && p.t > this.prevRawT && core.v3.dist(cur, this.prevRaw) / ((p.t - this.prevRawT) / 1000) > 15) valid = false;
    this.health.sample(p.t, valid);
    if (valid && cur) {
      this.prevRaw = cur; this.prevRawT = p.t; this.raw = cur; this.pose = { pos: p.pos, quat: p.quat };
      this.filt = this.filter.filter(cur, p.t / 1000) as V3;
      return true;
    }
    return false;
  }

  private tick(t: number) {
    const dt = Math.min(250, Math.max(0, t - this.lastT)); this.lastT = t;
    const fresh = this.ingestPose();
    const ev = this.health.tick(t);
    const phase = this.snap.phase;
    const hs = this.health.state as 'waiting' | 'ok' | 'lost';
    if (ev === 'lost' && (phase === 'playing' || phase === 'range')) this.cue('lost');
    if (ev === 'lost') this.q('tracking_lost', null, 'No valid tracking sample for 250 ms', this.gameName(), this.trialNo || null);
    if (ev === 'restored' && this.lostPrev) this.q('tracking_restored', round(this.health.lostMs, 0), 'Tracking steady for 500 ms; total lost so far (ms)', this.gameName(), this.trialNo || null);
    this.lostPrev = hs === 'lost';
    if (this.cal && this.filt) { const c = core.toCalFrame(this.cal, this.filt) as V3; this.cur = { x: c[0], y: c[1], z: c[2] }; }

    const trackingOk = hs === 'ok';
    const paused = !trackingOk || this.manualPause;
    if (phase === 'starting' && trackingOk) this.emit({ phase: 'cal_ready' });

    switch (phase) {
      case 'cal_hold': this.tickHold(t, fresh, trackingOk); break;
      case 'range': if (!paused) this.tickRange(dt); break;
      case 'countdown': this.tickCountdown(t); break;
      case 'playing': if (!this.manualPause) this.tickPlay(t, dt, trackingOk); break;
    }
    if (this.cal && (phase === 'range' || phase === 'playing') && !paused) this.logKin(t, trackingOk);

    // Throttled snapshot for the HUD (5 Hz) so React does not re-render every frame.
    if (t - this.lastSnapT > 200 || hs !== this.snap.tracking) {
      this.lastSnapT = t;
      const left = this.tq ? Math.max(0, this.cfg.trialSec - this.tq.activeMs / 1000) : this.cfg.trialSec;
      const base: Partial<Snapshot> = { tracking: hs, rateHz: Math.round(this.sensor.rateHz()), timeLeftS: Math.ceil(left), score: this.score, elapsedS: Math.round((t - this.t0) / 1000) };
      if (phase === 'range') base.range = { index: this.rangeIdx, total: RANGE_DIRS.length, secLeft: Math.max(0, Math.ceil((RANGE_TIMEOUT_MS - (this.gms - this.rangeStartG)) / 1000)), results: this.rangeResults.slice() };
      this.emit(base);
    }
    this.render(hs);
  }

  /* ---------------- calibration ---------------- */
  private tickHold(t: number, fresh: boolean, ok: boolean) {
    if (!ok || !this.raw || !this.pose) { this.hold = []; this.holdStart = 0; this.emit({ cal: { progress: 0, result: null, attempts: this.calAttempts } }); return; }
    if (!this.holdStart) this.holdStart = t;
    if (fresh) this.hold.push({ t, cursor: this.raw.slice() as V3, pos: this.pose.pos, quat: this.pose.quat });
    const prog = Math.min(1, (t - this.holdStart) / core.CAL_RULES.holdMs);
    if (Math.abs(prog - this.snap.cal.progress) > 0.04) this.emit({ cal: { progress: prog, result: null, attempts: this.calAttempts } });
    if (prog >= 1) {
      const res = core.measureCalibration(this.hold.map((s) => ({ t: s.t, cursor: s.cursor })), this.cfg.mode, this.sensor.rateHz()) as CalResult;
      this.calAttempts++; this.calResult = res;
      this.emit({ phase: 'cal_result', cal: { progress: 1, result: res, attempts: this.calAttempts } });
    }
  }

  /* ---------------- range check ---------------- */
  private startRangeDot() {
    const dir = RANGE_DIRS[this.rangeIdx];
    const pos = core.rangePoint(this.kind, this.cfg.level, dir) as V3;
    this.rangeTarget = this.mkTarget({ pos, az: 0, el: 0, zone: core.dirName(dir), reachCm: round(core.v3.len(pos) * 100, 1) ?? 0 }, 'dot', null);
    this.rangeStartG = this.gms;
  }
  private tickRange(dt: number) {
    this.gms += dt;
    const tg = this.rangeTarget; if (!tg) return;
    const hit = this.updateDwell([tg], dt);
    const used = this.gms - this.rangeStartG;
    const done = (reached: boolean) => {
      this.rangeResults.push({ dir: RANGE_DIRS[this.rangeIdx], reached, ms: reached ? Math.round(used) : null });
      this.q('range_dot', reached ? Math.round(used) : null, `${core.dirName(RANGE_DIRS[this.rangeIdx])}: ${reached ? 'reached' : 'not reached in ' + RANGE_TIMEOUT_MS / 1000 + ' s'}`, 'Range check');
      this.rangeIdx++;
      if (this.rangeIdx >= RANGE_DIRS.length) { this.rangeTarget = null; this.toGameIntro(); } else this.startRangeDot();
    };
    if (hit) { tg.state = 'correct'; tg.stateT = performance.now(); this.burst('ok', tg); this.cue('ok'); this.buzz(25); done(true); }
    else if (used >= RANGE_TIMEOUT_MS) done(false);
  }

  /* ---------------- games ---------------- */
  private toGameIntro() {
    this.rangeTarget = null;
    this.item = null; this.tq = null; this.prevPl = null; this.prevKey = undefined; this.prevInk = undefined; this.prevZone = undefined;
    const k = this.cfg.games[this.gameIdx];
    this.emit({ phase: 'game_intro', game: k, gameIndex: this.gameIdx, trialNo: 0, prompt: null, range: { index: 0, total: RANGE_DIRS.length, secLeft: 0, results: this.rangeResults.slice() } });
  }

  private tickCountdown(t: number) {
    const left = 3 - Math.floor((t - this.countdownStart) / 1000);
    if (left <= 0) { this.beginTrial(t); return; }
    if (left !== this.snap.countdown) { this.cue('tick'); this.emit({ countdown: left }); }
  }

  private homePrompt() { return this.cfg.homeGate ? { caption: 'Return to the ring', main: '' } : { caption: 'Get ready', main: '' }; }

  private beginTrial(t: number) {
    this.cue('go');
    this.trialNo++; this.score = 0; this.itemCount = 0; this.item = null; this.sub = 'home'; this.homeHold = 0;
    const key = this.cfg.games[this.gameIdx];
    this.tq = {
      activeMs: 0, pauseMs: 0, recentres: 0, min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity],
      lost0: this.health.lostMsAt(t), drop0: this.health.dropouts, valid0: this.health.validSamples
    };
    this.q('trial_start', this.trialNo, `${core.GAMES[key].name} trial ${this.trialNo}`, core.GAMES[key].name, this.trialNo);
    this.emit({ phase: 'playing', game: key, gameIndex: this.gameIdx, trialNo: this.trialNo, score: 0, itemNo: 0, timeLeftS: this.cfg.trialSec, prompt: this.homePrompt(), countdown: 0, trialEnd: null });
  }

  private tickPlay(t: number, dt: number, trackingOk: boolean) {
    if (!this.tq) return;
    if (!trackingOk) return;           // auto-pause: the trial clock and item timers stand still
    this.gms += dt; this.tq.activeMs += dt;
    const c = this.curVec();
    for (let i = 0; i < 3; i++) { this.tq.min[i] = Math.min(this.tq.min[i], c[i]); this.tq.max[i] = Math.max(this.tq.max[i], c[i]); }

    if (this.tq.activeMs >= this.cfg.trialSec * 1000) { this.endTrial(t); return; }

    if (this.sub === 'home') {
      const inside = !this.cfg.homeGate || Math.hypot(c[0], c[1], c[2]) <= HOME_R;
      this.homeHold = inside ? this.homeHold + dt : 0;
      if (this.homeHold >= HOME_HOLD_MS) this.spawnItem();
    } else if (this.sub === 'reach' && this.item) {
      const it = this.item;
      it.tracker.update(this.gms, c);
      const hit = this.updateDwell(it.targets, dt);
      if (hit) this.onTouch(it, hit);
      else if (!it.closed && this.gms - it.onsetGame >= this.cfg.itemTimeoutSec * 1000) {
        this.closeItem('timeout');
        this.sub = 'feedback'; this.feedbackUntil = this.gms + FEEDBACK_MISS_MS;
        this.emit({ prompt: { caption: 'Out of time', main: '' } });
      }
    } else if (this.sub === 'feedback') {
      if (this.gms >= this.feedbackUntil) { this.sub = 'home'; this.homeHold = 0; this.item = null; this.emit({ prompt: this.homePrompt() }); }
    }
  }

  /** Dwell logic with a little hysteresis so a tremor at the edge does not restart the hold. */
  private updateDwell(targets: Target[], dt: number): Target | null {
    let touched: Target | null = null;
    const c = this.curVec();
    for (const tg of targets) {
      if (tg.state !== 'idle') { tg.hot = false; continue; }
      const d = core.v3.dist(c, tg.pos);
      const inside = d <= (tg.enteredT != null ? this.touchR * 1.25 : this.touchR);
      tg.hot = d <= this.touchR;
      if (inside) {
        if (tg.enteredT == null) { tg.enteredT = this.gms; tg.enteredP = c; tg.dwell = 0; }
        tg.dwell += dt;
        if (tg.dwell >= this.cfg.dwellMs && !touched) touched = tg;
      } else { tg.enteredT = null; tg.enteredP = null; tg.dwell = 0; }
    }
    return touched;
  }

  private spawnItem() {
    const key = this.cfg.games[this.gameIdx];
    let data: any = null; let targets: Target[]; let stimulus: string; let correct: Target; let correctAnswer = ''; let condition: string; let optionsText: string;
    let prompt: { caption: string; main: string };
    if (key === 'triangle') {
      const pl = this.placer.next(this.prevPl); this.prevPl = pl;
      correct = this.mkTarget(pl, 'tri', null); targets = [correct];
      stimulus = 'triangle'; condition = pl.zone; optionsText = `triangle@${pl.zone}`;
      prompt = { caption: GAME_TEXT.triangle.caption, main: '' };
    } else {
      data = key === 'maths' ? this.source.maths(this.placer, this.prevKey, this.prevZone) : this.source.colour(this.placer, this.prevInk, this.prevZone);
      targets = data.options.map((o: any) => this.mkTarget(o, key === 'maths' ? 'num' : 'word', o));
      correct = targets.find((t) => t.opt.correct) as Target;
      this.prevKey = data.key; this.prevInk = key === 'colour' ? data.targetInk : undefined; this.prevZone = correct.zone;
      stimulus = data.stimulus; condition = data.condition;
      correctAnswer = key === 'maths' ? String(data.answer) : data.answer;
      optionsText = data.options.map((o: any) => (key === 'maths' ? o.label : `${o.label}/${o.ink}`) + '@' + o.zone).join('; ');
      prompt = key === 'maths' ? { caption: GAME_TEXT.maths.caption, main: data.display } : { caption: GAME_TEXT.colour.caption, main: data.targetName };
    }
    this.itemCount++;
    this.item = {
      n: this.itemCount, game: key, data, targets, onsetWall: performance.now() - this.t0, onsetGame: this.gms,
      tracker: new core.ReachTracker(this.gms, this.curVec()), start: this.curVec(), errors: 0, firstResponse: null,
      stimulus, optionsText, correct, correctAnswer, condition, closed: false
    };
    this.sub = 'reach';
    for (const tg of targets) this.burst('ping', tg);
    this.emit({ itemNo: this.itemCount, prompt });
  }

  private onTouch(it: Item, tg: Target) {
    const label = it.game === 'colour' ? tg.opt.ink : tg.opt ? tg.opt.label : 'triangle';
    if (it.firstResponse == null) it.firstResponse = String(label);
    if (tg === it.correct) {
      tg.state = 'correct'; tg.stateT = performance.now();
      this.burst('ok', tg, '+1'); this.cue('ok');
      const confirmG = this.gms;
      this.closeItem('correct', tg.enteredT ?? confirmG, tg.enteredP ?? this.curVec(), confirmG);
      this.score++; this.buzz(30);
      for (const o of it.targets) if (o !== tg && o.state === 'idle') o.state = 'disabled';
      this.sub = 'feedback'; this.feedbackUntil = this.gms + FEEDBACK_OK_MS;
      this.emit({ score: this.score, prompt: { caption: 'Good!', main: '' } });
    } else {
      tg.state = 'wrong'; tg.stateT = performance.now(); it.errors++; this.burst('bad', tg); this.cue('bad'); this.buzz([40, 40, 40]);
      // a wrong target stays wrong (cannot be re-touched) so repeated hovering does not count twice
    }
  }

  private closeItem(outcome: 'correct' | 'timeout' | 'trial_end', entryG?: number, entryP?: V3, confirmG?: number) {
    const it = this.item; if (!it || it.closed) return;
    it.closed = true;
    const fin = outcome === 'correct' ? it.tracker.finish(entryG, entryP, confirmG) : null;
    const c = it.correct;
    this.events.push({
      game: it.game, trial: this.trialNo, item: it.n, onsetMs: Math.max(0, Math.round(it.onsetWall)), stimulus: it.stimulus, options: it.optionsText,
      zone: c.zone, targetX: round(c.pos[0] * 100, 1), targetY: round(c.pos[1] * 100, 1), targetZ: round(c.pos[2] * 100, 1), targetAz: c.az, targetEl: c.el, targetReachCm: c.reachCm,
      startToTargetCm: round(core.v3.dist(it.start, c.pos) * 100, 1), correctAnswer: it.correctAnswer || null,
      firstResponse: it.firstResponse, outcome, firstTry: outcome === 'correct' ? (it.errors === 0 ? 1 : 0) : (it.errors > 0 ? 0 : null), errorsBefore: it.errors,
      rtMs: fin?.rtMs ?? null, mtMs: fin?.mtMs ?? null, respMs: fin?.respMs ?? null, pathCm: fin?.pathCm ?? null, straightCm: fin?.straightCm ?? null,
      pathEff: fin?.pathEff ?? null, peakSpeedCms: fin?.peakSpeedCms ?? null, condition: it.condition
    });
  }

  private endTrial(t: number) {
    if (this.item && !this.item.closed) this.closeItem('trial_end');
    const tq = this.tq; const key = this.cfg.games[this.gameIdx];
    const lost = this.health.lostMsAt(t) - tq.lost0;
    const wall = tq.activeMs + lost;
    const validN = this.health.validSamples - tq.valid0;
    const quality = {
      validPct: wall > 0 ? round((100 * tq.activeMs) / wall, 1) ?? 100 : 100,
      rateHz: wall > 0 ? round(validN / (wall / 1000), 1) ?? 0 : 0,
      dropouts: this.health.dropouts - tq.drop0, lostMs: Math.round(lost), recentres: tq.recentres
    };
    const has = isFinite(tq.min[0]);
    const trial = {
      game: key, trial: this.trialNo, level: this.cfg.level, activeMs: Math.round(tq.activeMs), pauseMs: Math.round(tq.pauseMs), score: this.score,
      rom: has ? { h: round((tq.max[0] - tq.min[0]) * 100, 1) ?? 0, v: round((tq.max[1] - tq.min[1]) * 100, 1) ?? 0, ...(this.kind === 'linear' ? { d: round((tq.max[2] - tq.min[2]) * 100, 1) ?? 0 } : {}) } : null, quality
    };
    this.trials.push(trial);
    this.q('trial_end', this.score, `score ${this.score}`, core.GAMES[key].name, this.trialNo);
    const evs = this.events.filter((e) => e.game === key && e.trial === this.trialNo);
    const done = evs.filter((e) => e.outcome === 'correct');
    const errors = evs.reduce((s, e) => s + (e.errorsBefore || 0), 0);
    const info: TrialEnd = {
      game: key, trial: this.trialNo, score: this.score, correct: done.length, errors, misses: evs.filter((e) => e.outcome === 'timeout').length,
      accuracyPct: done.length + errors ? round((100 * done.length) / (done.length + errors), 0) : null,
      rtMeanMs: round(core.mean(done.map((e) => e.rtMs)), 0), validPct: quality.validPct, dropouts: quality.dropouts
    };
    this.item = null; this.sub = 'home'; this.tq = null;
    const last = this.trialNo >= this.cfg.trialsPerGame && this.gameIdx >= this.cfg.games.length - 1;
    this.emit({ phase: 'trial_end', trialEnd: info, isLast: last, prompt: null, timeLeftS: this.cfg.trialSec, manualPause: false });
    this.manualPause = false;
  }

  private finish(complete: boolean) {
    if (this.ended) return;
    if (this.snap.phase === 'playing' && this.tq) this.endTrial(performance.now());
    this.ended = true;
    this.completeFlag = complete && this.trials.length === this.cfg.games.length * this.cfg.trialsPerGame;
    this.endedAt = new Date().toISOString();
    this.cue('end');
    this.emit({ phase: 'finished', prompt: null });
    this.sensor.stop().catch(() => undefined);
  }

  /* ---------------- recording ---------------- */
  private logKin(t: number, ok: boolean) {
    if (t < this.nextKin) return;
    this.nextKin = t + KIN_DT;
    if (!this.pose || !this.filt) return;
    const phase = this.snap.phase === 'range' ? 'reach' : this.sub === 'reach' ? 'reach' : this.sub === 'feedback' ? 'feedback' : 'home';
    const game = this.snap.phase === 'range' ? 'Range check' : (this.gameName() as string);
    const c = this.cur; let speed = 0;
    if (this.lastKin) { const dts = (t - this.lastKin.t) / 1000; if (dts > 0) speed = (Math.hypot(c.x - this.lastKin.p[0], c.y - this.lastKin.p[1], c.z - this.lastKin.p[2]) / dts) * 100; }
    this.lastKin = { t, p: [c.x, c.y, c.z] };
    let hand: (number | null)[] = [null, null, null];
    if (this.kind === 'linear' && this.cal) {
      const d = core.v3.sub(this.pose.pos, this.calEye) as V3;
      hand = [core.v3.dot(d, this.cal.r), core.v3.dot(d, this.cal.u), core.v3.dot(d, this.cal.c)].map((x) => round(x * 100, 1));
    }
    const rel = core.quat.mul(core.quat.conj(this.calQuat), this.pose.quat) as Q4;
    const [yaw, pitch, roll] = core.yawPitchRoll(rel) as number[];
    this.kin.push([
      round((t - this.t0) / 1000, 2), game, this.snap.phase === 'range' ? null : this.trialNo, phase,
      round(c.x * 100, 1), round(c.y * 100, 1), round(c.z * 100, 1), hand[0], hand[1], hand[2],
      round(yaw, 1), round(pitch, 1), round(roll, 1), round(speed, 1), ok ? 1 : 0
    ]);
  }

  /** The finished session as the server expects it, plus the 20 Hz rows (uploaded separately). */
  result(extra?: { adverse?: string; notes?: string; questionnaire?: Record<string, string | number> }): { record: SessionInput; kin: any[][] } {
    const c = this.calResult;
    const record: any = {
      id: uuid(), participantId: this.cfg.participantId, sessionNo: this.cfg.sessionNo, group: this.cfg.group, therapist: this.cfg.therapist,
      affectedSide: this.cfg.affectedSide, handMode: this.cfg.handMode, mode: this.cfg.mode, level: this.cfg.level, games: this.cfg.games,
      trialsPerGame: this.cfg.trialsPerGame, trialSec: this.cfg.trialSec, dwellMs: this.cfg.dwellMs, itemTimeoutSec: this.cfg.itemTimeoutSec,
      camera: this.cfg.camera, homeGate: this.cfg.homeGate, device: this.cfg.device, seed: this.cfg.seed, appVersion: core.VERSION,
      tzOffsetMin: -new Date().getTimezoneOffset(), startedAt: this.startedAt, endedAt: this.endedAt || new Date().toISOString(), complete: this.completeFlag,
      adverse: extra?.adverse || '', notes: extra?.notes || '',
      calibration: c ? { rateHz: round(c.rateHz, 1), jitterCm: round(c.jitterCm, 2) ?? 0, pass: c.pass, override: this.calOverride, attempts: Math.max(1, this.calAttempts), range: this.rangeResults } : null,
      trials: this.trials, events: this.events, quality: this.quality, questionnaire: extra?.questionnaire ?? null, kinRows: this.kin.length
    };
    return { record, kin: this.kin };
  }

  private buzz(p: number | number[]) { try { navigator.vibrate?.(p); } catch { /* not supported (iPhone) */ } }
  private burst(kind: 'ok' | 'bad' | 'ping', tg: Target, text?: string) {
    if (!this.cal) return;
    this.view?.burst(kind, core.calToWorld(this.cal, tg.pos) as V3, text);
  }

  /* ---------------- drawing ---------------- */
  private camera(): ViewCam | null {
    const xr = this.sensor.xrCamera?.();
    if (xr) return { view: xr.view, proj: xr.proj, viewport: xr.viewport, pos: xr.pos };
    const p = this.sensor.pose();
    if (!p || !core.v3.finite(p.pos) || !core.quat.finite(p.quat)) return null;
    return { view: mat4.viewFromPose(p.pos, p.quat), proj: null, viewport: null, pos: p.pos };
  }

  private render(tracking: 'ok' | 'lost' | 'waiting') {
    const view = this.view; if (!view) return;
    const phase = this.snap.phase;
    const now = performance.now();
    const cam = this.camera();
    const objects: ViewObj[] = [];
    const toObj = (tg: Target): ViewObj => ({
      id: tg.id, kind: tg.kind, pos: core.calToWorld(this.cal, tg.pos) as V3, label: tg.opt ? tg.opt.label : undefined, ink: tg.opt?.inkHex,
      state: tg.state, progress: tg.state === 'idle' ? Math.min(1, tg.dwell / this.cfg.dwellMs) : 0, hot: tg.hot, touchR: this.touchR, bornMs: tg.bornT, stateMs: tg.stateT
    });
    let best = 0; let anyHot = false;
    if (this.cal) {
      if (phase === 'range' && this.rangeTarget) objects.push(toObj(this.rangeTarget));
      if ((phase === 'playing') && this.item && (this.sub === 'reach' || this.sub === 'feedback')) for (const tg of this.item.targets) objects.push(toObj(tg));
      for (const tg of (this.item?.targets ?? [])) { best = Math.max(best, tg.state === 'idle' ? Math.min(1, tg.dwell / this.cfg.dwellMs) : 0); anyHot = anyHot || tg.hot; }
      if (this.rangeTarget && phase === 'range') { best = Math.max(best, Math.min(1, this.rangeTarget.dwell / this.cfg.dwellMs)); anyHot = anyHot || this.rangeTarget.hot; }
    }
    const worldOn = !!this.cal && (phase === 'range' || phase === 'playing' || phase === 'countdown' || phase === 'trial_end' || phase === 'game_intro');
    const inHome = Math.hypot(this.cur.x, this.cur.y, this.cur.z) <= HOME_R;
    const gateOn = this.cal && phase === 'playing' && this.cfg.homeGate && this.sub === 'home';   // only while the participant has to come back
    const gate = gateOn ? {
      pos: core.calToWorld(this.cal, [0, 0, 0]) as V3, r: HOME_R + 0.012, yaw: Math.atan2(this.cal.c[0], this.cal.c[2]),
      active: inHome, progress: Math.min(1, this.homeHold / HOME_HOLD_MS), hint: this.sub === 'home' && !inHome
    } : null;
    const homeProg = this.sub === 'home' && phase === 'playing' ? Math.min(1, this.homeHold / HOME_HOLD_MS) : 0;
    const reticleProgress = phase === 'cal_hold' ? this.snap.cal.progress : homeProg > 0 ? homeProg : best;
    const reticleShow = this.kind === 'angular' && (worldOn || phase === 'cal_ready' || phase === 'cal_hold' || phase === 'cal_result');
    const frame: ViewFrame = {
      nowMs: now, cam, kind: this.kind, objects, gate,
      reticle: { show: reticleShow, progress: reticleProgress, hot: anyHot || (inHome && phase === 'playing' && this.sub === 'home') },
      gridY: !this.cameraLive && cam ? this.calEye[1] - 0.9 : null,
      tracking
    };
    this.lastFrameInfo = { gate: !!gate, objects: objects.length, sub: this.sub };
    view.draw(frame);
  }
  private lastFrameInfo: { gate: boolean; objects: number; sub: string } | null = null;
}

function uuid(): string {
  try { if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID(); } catch { /* older iPhone */ }
  const b = new Uint8Array(16);
  try { crypto.getRandomValues(b); } catch { for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256); }
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
