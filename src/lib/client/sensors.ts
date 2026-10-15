import core from '../core';

export type Mode = '6dof' | 'motion' | 'touch' | 'sim';
export type V3 = [number, number, number];
export type Q4 = [number, number, number, number];
export interface Pose { t: number; pos: V3; quat: Q4; valid: boolean }

/** What the renderer needs to draw the room as the camera sees it. */
export interface CameraState {
  view: Float32Array;                 // world -> eye
  proj: Float32Array;                 // eye -> clip (from the real camera in AR)
  viewport: [number, number, number, number] | null;   // device pixels, AR only
  pos: V3;
}

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
  /** Touch practice: turn the view (radians). */
  look?(dYaw: number, dPitch: number): void;
  /** Touch practice / tests: set the view direction (radians). */
  setLook?(yaw: number, pitch: number): void;
  /** Simulated 6-DoF: put the hand at x right, y up, z forward (metres from the start pose). */
  setHand?(x: number, y: number, z: number): void;
  /** AR only: the WebGL context bound to the XR layer, and the real camera of this frame. */
  xrGL?(): WebGLRenderingContext | null;
  xrCamera?(): CameraState | null;
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
  private cam: CameraState | null = null;
  private meter = new RateMeter();
  onEnd?: (reason: string) => void;

  async start({ overlayRoot }: { overlayRoot: HTMLElement }) {
    const xr = (navigator as any).xr;
    if (!xr) throw new Error('This browser does not support WebXR.');
    let session: any;
    try {
      // dom-overlay is required: without it the score, timer and buttons would be invisible over the camera.
      session = await xr.requestSession('immersive-ar', {
        requiredFeatures: ['local', 'dom-overlay'],
        domOverlay: { root: overlayRoot }
      });
    } catch (e: any) {
      const why = e?.name === 'SecurityError' ? 'Camera access was declined.' : 'AR could not start. On Android it needs Chrome with Google Play Services for AR installed, and camera access allowed.';
      throw new Error(why);
    }
    this.session = session;
    // Taps on the on-screen buttons must not also count as an AR "select".
    overlayRoot.addEventListener('beforexrselect', (ev) => ev.preventDefault());
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl', { xrCompatible: true, alpha: true, antialias: true, depth: true, stencil: false, premultipliedAlpha: true }) as WebGLRenderingContext | null;
    if (!gl) { try { await session.end(); } catch { /* ignore */ } throw new Error('WebGL is not available.'); }
    this.gl = gl;
    await (gl as any).makeXRCompatible?.();
    session.updateRenderState({ baseLayer: new (window as any).XRWebGLLayer(session, gl, { alpha: true, depth: true, antialias: true }) });
    this.space = await session.requestReferenceSpace('local');
    session.addEventListener('end', () => { this.session = null; this.onEnd?.('xr-ended'); });
  }
  xrGL() { return this.gl; }
  xrCamera() { return this.cam; }

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
    if (gl && layer) { gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); }
    const vp = this.space ? frame.getViewerPose(this.space) : null;
    if (!vp) { this.cam = null; if (this.last) this.last = { ...this.last, valid: false }; return; }
    const p = vp.transform.position, o = vp.transform.orientation;
    // emulatedPosition = the device lost position tracking and is guessing from rotation only.
    this.last = { t, pos: [p.x, p.y, p.z], quat: [o.x, o.y, o.z, o.w], valid: !vp.emulatedPosition };
    if (!vp.emulatedPosition) this.meter.tick(t);
    const v = vp.views?.[0];
    if (v && layer) {
      const vpt = layer.getViewport(v);
      this.cam = { view: new Float32Array(v.transform.inverse.matrix), proj: new Float32Array(v.projectionMatrix), viewport: [vpt.x, vpt.y, vpt.width, vpt.height], pos: [p.x, p.y, p.z] };
    } else this.cam = null;
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

/* ---------------- Touch practice: dragging the screen turns the view (angular, like the phone-orientation mode) ---------------- */
export class TouchSensor implements Sensor {
  mode: Mode = 'touch';
  private yaw = 0; private pitch = 0;
  private last: Pose | null = null;
  private meter = new RateMeter();
  private timer = 0;
  private dropUntil = 0;
  private running = false;
  onEnd?: (reason: string) => void;

  async start() {
    this.running = true;
    const loop = () => { if (!this.running) return; this.emit(performance.now()); this.timer = window.setTimeout(loop, 1000 / 60) as unknown as number; };
    loop();
  }
  async stop() { this.running = false; clearTimeout(this.timer); }
  look(dYaw: number, dPitch: number) {
    this.yaw = Math.max(-1.6, Math.min(1.6, this.yaw + dYaw));
    this.pitch = Math.max(-1.2, Math.min(1.2, this.pitch + dPitch));
  }
  setLook(yaw: number, pitch: number) { this.yaw = Math.max(-1.6, Math.min(1.6, yaw)); this.pitch = Math.max(-1.2, Math.min(1.2, pitch)); }
  dropFor(ms: number) { this.dropUntil = performance.now() + ms; }
  private emit(t: number) {
    if (t < this.dropUntil) { if (this.last) this.last = { ...this.last, valid: false }; return; }
    this.last = { t, pos: [0, 1.4, 0], quat: core.quat.fromYawPitch(this.yaw, this.pitch) as Q4, valid: true };
    this.meter.tick(t);
  }
  pose() { return this.last; }
  rateHz() { return this.meter.hz(performance.now()); }
  requestFrame(cb: (t: number) => void) { return window.requestAnimationFrame(cb); }
  cancelFrame(id: number) { window.cancelAnimationFrame(id); }
}

/* ---------------- Simulated 6-DoF: a scripted hand, used by the automated tests ---------------- */
export class SimSensor implements Sensor {
  readonly mode: Mode = 'sim';
  private hand: V3 = [0, 0, 0];
  private quat: Q4 = [0, 0, 0, 1];
  private last: Pose | null = null;
  private meter = new RateMeter();
  private timer = 0;
  private dropUntil = 0;
  private running = false;
  onEnd?: (reason: string) => void;

  async start() {
    this.running = true;
    const loop = () => { if (!this.running) return; this.emit(performance.now()); this.timer = window.setTimeout(loop, 1000 / 60) as unknown as number; };
    loop();
  }
  async stop() { this.running = false; clearTimeout(this.timer); }
  setHand(x: number, y: number, z: number) { this.hand = [x, y, z]; }
  /** Which way the simulated phone faces (radians; yaw + is left, pitch + is up). The hand position is unaffected. */
  setLook(yaw: number, pitch: number) { this.quat = core.quat.fromYawPitch(yaw, pitch) as Q4; }
  dropFor(ms: number) { this.dropUntil = performance.now() + ms; }
  private emit(t: number) {
    if (t < this.dropUntil) { if (this.last) this.last = { ...this.last, valid: false }; return; }
    // Start pose is (0, 1.2, 0) looking along -z: x right, y up, z forward maps to world (x, 1.2 + y, -z).
    this.last = { t, pos: [this.hand[0], 1.2 + this.hand[1], -this.hand[2]], quat: this.quat, valid: true };
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
  return mode === 'sim' ? new SimSensor() : new TouchSensor();
}

export const MODE_INFO: Record<Mode, { title: string; short: string; detail: string }> = {
  '6dof': { title: 'AR position tracking', short: 'AR 6-DoF', detail: 'Measures real hand movement in centimetres (Android with ARCore, Chrome). Use this for research data.' },
  motion: { title: 'Motion tracking', short: 'Motion 3-DoF', detail: 'Uses phone rotation only (iPhone, other phones). Reach is in degrees, not centimetres. Flagged in the data.' },
  touch: { title: 'Touch practice', short: 'Touch', detail: 'Drag a finger to look around. For learning the games. No movement is measured; flagged in the data.' },
  sim: { title: 'Simulated hand', short: 'Sim', detail: 'Automated testing only.' }
};
