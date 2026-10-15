import core from '../core';

export type Mode = '6dof' | 'motion' | 'touch' | 'sim';
export type V3 = [number, number, number];
export type Q4 = [number, number, number, number];
export interface Pose { t: number; pos: V3; quat: Q4; valid: boolean }

export interface Sensor {
  readonly mode: Mode;
  /** Must be called from a tap (browsers require a user gesture for AR and motion permission). */
  start(opts: { overlayRoot: HTMLElement }): Promise<void>;
  stop(): Promise<void>;
  pose(): Pose | null;
  /** Measured rate of fresh pose samples (Hz). */
  rateHz(): number;
  requestFrame(cb: (t: number) => void): number;
  cancelFrame(id: number): void;
  /** Touch/sim only: set the cursor straight from the stage (metres in the calibrated frame). */
  setAim?(x: number, y: number): void;
  /** Lets tests and the touch sensor simulate a tracking dropout. */
  dropFor?(ms: number): void;
  onEnd?: (reason: string) => void;
}

/* ---------------- rate meter ---------------- */
class RateMeter {
  private times: number[] = [];
  tick(t: number) { this.times.push(t); const cut = t - 1000; while (this.times.length && this.times[0] < cut) this.times.shift(); }
  hz(now: number) {
    const cut = now - 1000; while (this.times.length && this.times[0] < cut) this.times.shift();
    if (this.times.length < 2) return 0;
    return ((this.times.length - 1) / Math.max(1, this.times[this.times.length - 1] - this.times[0])) * 1000;
  }
}

/* ---------------- capability detection ---------------- */
export interface Capabilities { xr: boolean; motion: boolean; needsMotionPermission: boolean; touch: boolean; isIos: boolean; secure: boolean }

export async function detectCapabilities(): Promise<Capabilities> {
  const nav = navigator as Navigator & { xr?: { isSessionSupported(m: string): Promise<boolean> } };
  let xr = false;
  try { xr = !!nav.xr && (await nav.xr.isSessionSupported('immersive-ar')); } catch { xr = false; }
  const DOE = (window as unknown as { DeviceOrientationEvent?: { requestPermission?: unknown } }).DeviceOrientationEvent;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  return {
    xr, motion: !!DOE && coarse, needsMotionPermission: !!DOE && typeof DOE.requestPermission === 'function',
    touch: true, isIos: /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
    secure: window.isSecureContext
  };
}

/* ---------------- 6-DoF: WebXR immersive-ar (ARCore on Android Chrome) ---------------- */
/* eslint-disable @typescript-eslint/no-explicit-any */
export class XrSensor implements Sensor {
  readonly mode: Mode = '6dof';
  private session: any = null;
  private space: any = null;
  private gl: WebGLRenderingContext | null = null;
  private last: Pose | null = null;
  private meter = new RateMeter();
  onEnd?: (reason: string) => void;

  async start({ overlayRoot }: { overlayRoot: HTMLElement }) {
    const xr = (navigator as any).xr;
    if (!xr) throw new Error('This browser does not support WebXR.');
    const session = await xr.requestSession('immersive-ar', {
      requiredFeatures: ['local'],
      optionalFeatures: ['dom-overlay'],
      domOverlay: { root: overlayRoot }
    });
    this.session = session;
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl', { xrCompatible: true, alpha: true, antialias: false, depth: false, stencil: false }) as WebGLRenderingContext;
    if (!gl) throw new Error('WebGL is not available.');
    this.gl = gl;
    await (gl as any).makeXRCompatible?.();
    session.updateRenderState({ baseLayer: new (window as any).XRWebGLLayer(session, gl) });
    this.space = await session.requestReferenceSpace('local');
    session.addEventListener('end', () => { this.session = null; this.onEnd?.('xr-ended'); });
  }

  async stop() { try { await this.session?.end(); } catch { /* already ended */ } this.session = null; }

  pose() { return this.last; }
  rateHz() { return this.meter.hz(performance.now()); }

  requestFrame(cb: (t: number) => void): number {
    if (!this.session) return window.requestAnimationFrame(cb);
    return this.session.requestAnimationFrame((t: number, frame: any) => {
      this.read(t, frame);
      cb(t);
    });
  }
  cancelFrame(id: number) { try { this.session ? this.session.cancelAnimationFrame(id) : window.cancelAnimationFrame(id); } catch { /* ignore */ } }

  private read(t: number, frame: any) {
    const gl = this.gl, layer = this.session?.renderState?.baseLayer;
    if (gl && layer) { gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); }
    const vp = this.space ? frame.getViewerPose(this.space) : null;
    if (!vp) { if (this.last) this.last = { ...this.last, valid: false }; return; }
    const p = vp.transform.position, o = vp.transform.orientation;
    // emulatedPosition = the device lost position tracking and is guessing from rotation only.
    this.last = { t, pos: [p.x, p.y, p.z], quat: [o.x, o.y, o.z, o.w], valid: !vp.emulatedPosition };
    if (!vp.emulatedPosition) this.meter.tick(t);
  }
}

/* ---------------- 3-DoF: phone orientation (iPhone and any phone without WebXR) ---------------- */
export class MotionSensor implements Sensor {
  readonly mode: Mode = 'motion';
  private last: Pose | null = null;
  private meter = new RateMeter();
  private handler: ((e: DeviceOrientationEvent) => void) | null = null;
  onEnd?: (reason: string) => void;

  async start() {
    const DOE = (window as any).DeviceOrientationEvent;
    if (!DOE) throw new Error('This phone does not report orientation.');
    if (typeof DOE.requestPermission === 'function') {
      const res = await DOE.requestPermission();
      if (res !== 'granted') throw new Error('Motion access was declined. Allow "Motion & Orientation" for this site in Settings.');
    }
    this.handler = (e) => {
      const t = performance.now();
      if (e.alpha == null || e.beta == null || e.gamma == null) { if (this.last) this.last = { ...this.last, valid: false }; return; }
      const ang = (screen.orientation && typeof screen.orientation.angle === 'number') ? screen.orientation.angle : ((window as any).orientation || 0);
      const q = core.deviceOrientationToQuat(e.alpha, e.beta, e.gamma, ang) as Q4;
      this.last = { t, pos: [0, 1.4, 0], quat: q, valid: core.quat.finite(q) };
      this.meter.tick(t);
    };
    window.addEventListener('deviceorientation', this.handler);
  }
  async stop() { if (this.handler) window.removeEventListener('deviceorientation', this.handler); this.handler = null; }
  pose() { return this.last; }
  rateHz() { return this.meter.hz(performance.now()); }
  requestFrame(cb: (t: number) => void) { return window.requestAnimationFrame(cb); }
  cancelFrame(id: number) { window.cancelAnimationFrame(id); }
}

/* ---------------- Touch / simulated: the finger (or a test script) aims the cursor ---------------- */
export class TouchSensor implements Sensor {
  mode: Mode;
  private aim: [number, number] = [0, 0];
  private last: Pose | null = null;
  private meter = new RateMeter();
  private raf = 0;
  private dropUntil = 0;
  private running = false;
  onEnd?: (reason: string) => void;
  constructor(mode: 'touch' | 'sim') { this.mode = mode; }

  async start() {
    this.running = true;
    const loop = () => { if (!this.running) return; this.emit(performance.now()); this.raf = window.setTimeout(loop, 1000 / 60) as unknown as number; };
    loop();
  }
  async stop() { this.running = false; clearTimeout(this.raf); }
  setAim(x: number, y: number) { this.aim = [x, y]; }
  dropFor(ms: number) { this.dropUntil = performance.now() + ms; }
  private emit(t: number) {
    if (t < this.dropUntil) { if (this.last) this.last = { ...this.last, valid: false }; return; }
    // Aim (x, y metres in the calibrated frame) -> a viewing direction whose cursor lands exactly there.
    const A = core.AHEAD_ANGULAR_M as number;
    const r = Math.min(Math.hypot(this.aim[0], this.aim[1]), A * Math.sin(80 * core.DEG));
    const s = r / A, c = Math.sqrt(Math.max(0, 1 - s * s));
    const d: V3 = r < 1e-9 ? [0, 0, -1] : [s * this.aim[0] / r, s * this.aim[1] / r, -c];
    const { yaw, pitch } = core.yawPitchToward(d);
    this.last = { t, pos: [0, 1.4, 0], quat: core.quat.fromYawPitch(yaw, pitch) as Q4, valid: true };
    this.meter.tick(t);
  }
  pose() { return this.last; }
  rateHz() { return this.meter.hz(performance.now()); }
  requestFrame(cb: (t: number) => void) { return window.requestAnimationFrame(cb); }
  cancelFrame(id: number) { window.cancelAnimationFrame(id); }
}

export function createSensor(mode: Mode): Sensor {
  if (mode === '6dof') return new XrSensor();
  if (mode === 'motion') return new MotionSensor();
  return new TouchSensor(mode);
}

export const MODE_INFO: Record<Mode, { title: string; short: string; detail: string }> = {
  '6dof': { title: 'AR position tracking', short: 'AR 6-DoF', detail: 'Measures real hand movement in centimetres (Android with ARCore, Chrome). Use this for research data.' },
  motion: { title: 'Motion tracking', short: 'Motion 3-DoF', detail: 'Uses phone rotation only (iPhone, other phones). Reach is in degrees, not centimetres. Flagged in the data.' },
  touch: { title: 'Touch practice', short: 'Touch', detail: 'Drag a finger to aim. For learning the games. No movement is measured; flagged in the data.' },
  sim: { title: 'Simulated', short: 'Sim', detail: 'Automated testing only.' }
};
