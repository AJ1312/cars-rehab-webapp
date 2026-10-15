/* The picture: 3D objects floating in the room (WebGL) plus a 2D layer for arrows, rings and popups.
 *
 * In AR (Android Chrome, WebXR) the 3D objects are drawn into the XR layer with the real camera's own
 * projection, so they stay fixed in the room as the phone moves. In the other modes a transparent canvas
 * sits over the rear-camera video and a virtual camera follows the phone's orientation.
 * No third-party 3D library: a few small shaders, a pyramid, a ring and billboards. */
import { mat4, type Mat4, type V3 } from './glmath';

export const PALETTE = {
  ink: '#141B2D', paper: '#F6F1E7', cobalt: '#2F5BFF', cobaltSoft: '#9DB2FF', yellow: '#FFC400', orange: '#FF8A00',
  green: '#19B36B', coral: '#FF5A4F', white: '#FFFFFF'
};

export type ObjKind = 'tri' | 'num' | 'word' | 'dot';
export type ObjState = 'idle' | 'wrong' | 'correct' | 'disabled';
export interface ViewObj {
  id: number; kind: ObjKind; pos: V3; label?: string; ink?: string; state: ObjState;
  progress: number; hot: boolean; touchR: number; bornMs: number; stateMs: number;
  /** World height of the object in metres, and a cosmetic variant (colour / spin) so no two look alike. */
  size: number; variant: number;
}
export interface ViewGate { pos: V3; r: number; yaw: number; active: boolean; progress: number; hint: boolean }
export interface ViewCam { view: Float32Array; proj?: Float32Array | null; viewport?: [number, number, number, number] | null; pos: V3 }
export interface ViewFrame {
  nowMs: number; cam: ViewCam | null; kind: 'linear' | 'angular';
  objects: ViewObj[]; gate: ViewGate | null;
  reticle: { show: boolean; progress: number; hot: boolean };
  /** Draw a floor grid at this height (used when there is no camera picture behind). */
  gridY: number | null; tracking: 'ok' | 'lost' | 'waiting';
}

export const FOV_Y = 60 * Math.PI / 180;
const LIGHT: V3 = [0.35, 0.8, 0.5];

/* ---------------- mesh data ---------------- */
interface Mesh { pos: WebGLBuffer; nrm: WebGLBuffer; out: WebGLBuffer; count: number }

function pyramidData() {
  // Triangular pyramid standing on its base: a clear "triangle" from every side.
  const R = 1, H = 1.55;
  const b: V3[] = [0, 1, 2].map((i) => { const a = Math.PI / 2 + (i * 2 * Math.PI) / 3; return [R * Math.cos(a), -H / 3, R * Math.sin(a)] as V3; });
  const apex: V3 = [0, (2 * H) / 3, 0];
  // Counter-clockwise seen from outside, so the computed normals point outwards and back-face culling keeps the outer faces.
  const tris: V3[][] = [[b[0], b[1], b[2]], [apex, b[1], b[0]], [apex, b[2], b[1]], [apex, b[0], b[2]]];
  const pos: number[] = [], nrm: number[] = [], out: number[] = [];
  for (const t of tris) {
    const u = [t[1][0] - t[0][0], t[1][1] - t[0][1], t[1][2] - t[0][2]], v = [t[2][0] - t[0][0], t[2][1] - t[0][1], t[2][2] - t[0][2]];
    let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const l = Math.hypot(n[0], n[1], n[2]) || 1; n = n.map((x) => x / l);
    for (const p of t) {
      pos.push(p[0], p[1], p[2]); nrm.push(n[0], n[1], n[2]);
      const ol = Math.hypot(p[0], p[1], p[2]) || 1; out.push(p[0] / ol, p[1] / ol, p[2] / ol);
    }
  }
  return { pos, nrm, out };
}

function torusData(R = 1, r = 0.07, seg = 48, side = 14) {
  const pos: number[] = [], nrm: number[] = [];
  const vert = (i: number, j: number) => {
    const u = (i / seg) * 2 * Math.PI, v = (j / side) * 2 * Math.PI;
    const cx = R * Math.cos(u), cy = R * Math.sin(u);
    const x = (R + r * Math.cos(v)) * Math.cos(u), y = (R + r * Math.cos(v)) * Math.sin(u), z = r * Math.sin(v);
    return { p: [x, y, z], n: [x - cx, y - cy, z] };
  };
  for (let i = 0; i < seg; i++) for (let j = 0; j < side; j++) {
    const a = vert(i, j), b = vert(i + 1, j), c = vert(i + 1, j + 1), d = vert(i, j + 1);
    for (const q of [a, b, c, a, c, d]) { pos.push(...q.p); const l = Math.hypot(...q.n) || 1; nrm.push(q.n[0] / l, q.n[1] / l, q.n[2] / l); }
  }
  return { pos, nrm, out: nrm.slice() };
}

/* ---------------- shaders ---------------- */
const SOLID_VS = `
attribute vec3 aPos; attribute vec3 aNrm; attribute vec3 aOut;
uniform mat4 uProj; uniform mat4 uView; uniform mat4 uModel; uniform float uOutline;
varying vec3 vN;
void main(){
  vec3 p = aPos + aOut * uOutline;
  vN = (uModel * vec4(aNrm, 0.0)).xyz;
  gl_Position = uProj * uView * uModel * vec4(p, 1.0);
}`;
const SOLID_FS = `
precision mediump float;
varying vec3 vN; uniform vec3 uColor; uniform vec3 uLight; uniform float uAlpha; uniform float uGlow; uniform float uFlat;
void main(){
  vec3 n = normalize(vN);
  float d = dot(n, normalize(uLight));
  float band = d > 0.5 ? 1.0 : (d > -0.1 ? 0.8 : 0.6);
  vec3 c = uFlat > 0.5 ? uColor : uColor * band + vec3(1.0, 0.95, 0.75) * uGlow;
  gl_FragColor = vec4(c * uAlpha, uAlpha);
}`;
const SPRITE_VS = `
attribute vec2 aUV; uniform mat4 uProj; uniform mat4 uView; uniform vec3 uCenter; uniform vec2 uSize; varying vec2 vUV;
void main(){
  vec3 right = vec3(uView[0][0], uView[1][0], uView[2][0]);
  vec3 up = vec3(uView[0][1], uView[1][1], uView[2][1]);
  vec3 p = uCenter + right * aUV.x * uSize.x + up * aUV.y * uSize.y;
  vUV = vec2(aUV.x + 0.5, 0.5 - aUV.y);
  gl_Position = uProj * uView * vec4(p, 1.0);
}`;
const SPRITE_FS = `
precision mediump float;
varying vec2 vUV; uniform sampler2D uTex; uniform vec4 uTint;
void main(){
  vec4 t = texture2D(uTex, vUV);
  if (t.a < 0.01) discard;
  gl_FragColor = vec4(t.rgb * uTint.rgb * uTint.a, t.a * uTint.a);
}`;
const LINE_VS = `attribute vec3 aPos; uniform mat4 uProj; uniform mat4 uView; void main(){ gl_Position = uProj * uView * vec4(aPos, 1.0); }`;
const LINE_FS = `precision mediump float; uniform vec4 uColor; void main(){ gl_FragColor = vec4(uColor.rgb * uColor.a, uColor.a); }`;

// Cosmetic variety: no two objects on the screen look the same. Colour never means anything in the games
// (the answer is never marked by colour), except the ink of the words in the Colour Merge Test.
const TRI_COLORS = ['#FF8A00', '#FF5D8F', '#8E6BFF', '#1FC8A9', '#FFC400', '#4D9BFF'];
const NUM_FILLS = ['#FFC400', '#7BE0B0', '#8EC5FF', '#FF9EC0', '#FFB27A', '#C9B3FF'];

function hexRgb(h: string): V3 { const n = parseInt(h.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; }

interface Particle { p: V3; v: V3; born: number; life: number; color: V3; size: number }
interface Pop { pos: V3; text: string; born: number; color: string }

const FONT = "'Atkinson Hyperlegible', system-ui, -apple-system, 'Segoe UI', sans-serif";

export class ArView {
  private gl: WebGLRenderingContext | null;
  private ctx2: CanvasRenderingContext2D | null;
  private solid!: { prog: WebGLProgram; u: Record<string, WebGLUniformLocation | null>; a: Record<string, number> };
  private sprite!: { prog: WebGLProgram; u: Record<string, WebGLUniformLocation | null>; a: Record<string, number> };
  private line!: { prog: WebGLProgram; u: Record<string, WebGLUniformLocation | null>; a: Record<string, number> };
  private pyramid!: Mesh; private torus!: Mesh;
  private quad!: WebGLBuffer; private gridBuf: WebGLBuffer | null = null; private gridCount = 0; private gridKey = '';
  private tex = new Map<string, { t: WebGLTexture; aspect: number }>();
  private parts: Particle[] = []; private pops: Pop[] = [];
  private W = 1; private H = 1; private dpr = 1;
  private xr: boolean;
  private lost = false;

  constructor(private glCanvas: HTMLCanvasElement | null, private overlay: HTMLCanvasElement, xrGL: WebGLRenderingContext | null) {
    this.xr = !!xrGL;
    let gl = xrGL;
    if (!gl && glCanvas) {
      gl = (glCanvas.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: true, depth: true, powerPreference: 'high-performance' }) as WebGLRenderingContext | null)
        || (glCanvas.getContext('experimental-webgl') as WebGLRenderingContext | null);
    }
    this.gl = gl;
    this.ctx2 = overlay.getContext('2d');
    if (glCanvas) glCanvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.lost = true; });
    if (this.gl) { try { this.init(this.gl); } catch (e) { console.error('WebGL setup failed', e); this.gl = null; } }
  }
  get ok() { return !!this.gl && !this.lost; }

  private compile(gl: WebGLRenderingContext, vs: string, fs: string, uniforms: string[], attrs: string[]) {
    const mk = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader'); return s; };
    const p = gl.createProgram()!; gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'link');
    const u: Record<string, WebGLUniformLocation | null> = {}; uniforms.forEach((n) => { u[n] = gl.getUniformLocation(p, n); });
    const a: Record<string, number> = {}; attrs.forEach((n) => { a[n] = gl.getAttribLocation(p, n); });
    return { prog: p, u, a };
  }
  private buf(gl: WebGLRenderingContext, data: number[]) { const b = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW); return b; }
  private mesh(gl: WebGLRenderingContext, d: { pos: number[]; nrm: number[]; out: number[] }): Mesh { return { pos: this.buf(gl, d.pos), nrm: this.buf(gl, d.nrm), out: this.buf(gl, d.out), count: d.pos.length / 3 }; }

  private init(gl: WebGLRenderingContext) {
    this.solid = this.compile(gl, SOLID_VS, SOLID_FS, ['uProj', 'uView', 'uModel', 'uOutline', 'uColor', 'uLight', 'uAlpha', 'uGlow', 'uFlat'], ['aPos', 'aNrm', 'aOut']);
    this.sprite = this.compile(gl, SPRITE_VS, SPRITE_FS, ['uProj', 'uView', 'uCenter', 'uSize', 'uTex', 'uTint'], ['aUV']);
    this.line = this.compile(gl, LINE_VS, LINE_FS, ['uProj', 'uView', 'uColor'], ['aPos']);
    this.pyramid = this.mesh(gl, pyramidData());
    this.torus = this.mesh(gl, torusData());
    this.quad = this.buf(gl, [-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5]);
  }

  /* ---------------- textures ---------------- */
  private label(kind: string, label: string, ink: string) {
    const key = kind + '|' + label + '|' + ink;
    const hit = this.tex.get(key); if (hit) return hit;
    const gl = this.gl!;
    const c = document.createElement('canvas');
    let aspect = 1;
    if (kind === 'num') {
      c.width = c.height = 256; const g = c.getContext('2d')!;
      g.beginPath(); g.arc(128, 128, 112, 0, Math.PI * 2); g.fillStyle = ink && ink !== '#fff' ? ink : PALETTE.yellow; g.fill(); g.lineWidth = 16; g.strokeStyle = PALETTE.ink; g.stroke();
      g.fillStyle = PALETTE.ink; g.font = `700 ${label.length > 1 ? 112 : 148}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label, 128, 138);
    } else if (kind === 'word') {
      c.width = 640; c.height = 224; aspect = 640 / 224; const g = c.getContext('2d')!;
      const r = 70, x = 8, y = 8, w = 624, h = 208;
      g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
      g.fillStyle = PALETTE.ink; g.fill(); g.lineWidth = 12; g.strokeStyle = PALETTE.paper; g.stroke();
      g.fillStyle = ink; g.font = `700 112px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label, 320, 120);
    } else if (kind === 'dot') {
      c.width = c.height = 256; const g = c.getContext('2d')!;
      g.beginPath(); g.arc(128, 128, 112, 0, Math.PI * 2); g.fillStyle = PALETTE.cobalt; g.fill(); g.lineWidth = 16; g.strokeStyle = PALETTE.paper; g.stroke();
      g.beginPath(); g.arc(128, 128, 48, 0, Math.PI * 2); g.fillStyle = PALETTE.paper; g.fill();
    } else if (kind === 'zone') {
      c.width = c.height = 256; const g = c.getContext('2d')!;
      g.beginPath(); g.arc(128, 128, 118, 0, Math.PI * 2); g.lineWidth = 10; g.strokeStyle = '#fff'; g.stroke();
      g.beginPath(); g.arc(128, 128, 118, 0, Math.PI * 2); g.fillStyle = 'rgba(255,255,255,0.12)'; g.fill();
    } else { // soft
      c.width = c.height = 64; const g = c.getContext('2d')!;
      const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.95)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    }
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const rec = { t, aspect }; this.tex.set(key, rec); return rec;
  }

  /* ---------------- effects ---------------- */
  burst(kind: 'ok' | 'bad' | 'ping', pos: V3, text?: string, now = performance.now()) {
    const col = kind === 'ok' ? hexRgb(PALETTE.green) : kind === 'bad' ? hexRgb(PALETTE.coral) : hexRgb(PALETTE.yellow);
    const n = kind === 'ping' ? 6 : 16;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, b = (Math.random() - 0.3) * Math.PI, s = (kind === 'ping' ? 0.15 : 0.45) * (0.5 + Math.random());
      this.parts.push({ p: [pos[0], pos[1], pos[2]], v: [Math.cos(a) * Math.cos(b) * s, Math.sin(b) * s + 0.1, Math.sin(a) * Math.cos(b) * s], born: now, life: 500 + Math.random() * 350, color: col, size: 0.012 + Math.random() * 0.012 });
    }
    if (text) this.pops.push({ pos: [pos[0], pos[1], pos[2]], text, born: now, color: kind === 'bad' ? PALETTE.coral : PALETTE.green });
    if (this.parts.length > 300) this.parts.splice(0, this.parts.length - 300);
  }

  /* ---------------- sizing ---------------- */
  resize(cssW: number, cssH: number, dpr: number) {
    this.W = Math.max(1, cssW); this.H = Math.max(1, cssH); this.dpr = Math.min(2.5, Math.max(1, dpr));
    const ow = Math.round(this.W * this.dpr), oh = Math.round(this.H * this.dpr);
    if (this.overlay.width !== ow || this.overlay.height !== oh) { this.overlay.width = ow; this.overlay.height = oh; }
    if (!this.xr && this.glCanvas && (this.glCanvas.width !== ow || this.glCanvas.height !== oh)) { this.glCanvas.width = ow; this.glCanvas.height = oh; }
  }

  /* ---------------- draw ---------------- */
  draw(f: ViewFrame) {
    const cam = f.cam;
    let proj: Mat4 | null = null; let view: Mat4 | null = null;
    if (cam) {
      view = cam.view;
      proj = (cam.proj as Mat4) || mat4.perspective(FOV_Y, this.W / this.H, 0.01, 20);
    }
    if (this.gl && !this.lost) this.draw3d(this.gl, f, view, proj, cam?.viewport ?? null);
    this.draw2d(f, view, proj);
  }

  private draw3d(gl: WebGLRenderingContext, f: ViewFrame, view: Mat4 | null, proj: Mat4 | null, vp: [number, number, number, number] | null) {
    if (!this.xr) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    } else if (vp) gl.viewport(vp[0], vp[1], vp[2], vp[3]);
    if (!view || !proj) return;
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const now = f.nowMs;

    // floor grid (only without a camera picture)
    if (f.gridY != null) this.drawGrid(gl, view, proj, f.gridY, f.cam!.pos);

    // 1. solid objects (pyramids, gate ring)
    gl.useProgram(this.solid.prog);
    gl.uniformMatrix4fv(this.solid.u.uProj, false, proj); gl.uniformMatrix4fv(this.solid.u.uView, false, view);
    gl.uniform3f(this.solid.u.uLight, LIGHT[0], LIGHT[1], LIGHT[2]);
    for (const o of f.objects) {
      if (o.kind !== 'tri') continue;
      const age = Math.max(0, now - o.bornMs);
      const pop = Math.min(1, age / 260); const ease = 1 - Math.pow(1 - pop, 3);
      let s = (o.size / 1.55) * ease * (1 + 0.14 * Math.sin(Math.min(1, age / 260) * Math.PI));
      let alpha = 1; let col = hexRgb(o.state === 'wrong' ? PALETTE.coral : o.state === 'correct' ? PALETTE.green : o.state === 'disabled' ? '#8A8F9C' : TRI_COLORS[o.variant % TRI_COLORS.length]);
      if (o.hot && o.state === 'idle') s *= 1.12;
      if (o.state === 'correct') { const k = Math.min(1, (now - o.stateMs) / 380); s *= 1 + 0.5 * k; alpha = 1 - k; }
      const bob = 0.1 * o.size * Math.sin(now / 520 + o.id * 1.7);
      const yaw = (now / 900) * (0.6 + 0.12 * o.variant) + o.id;
      this.drawMesh(gl, this.pyramid, mat4.model([o.pos[0], o.pos[1] + bob, o.pos[2]], s, yaw), col, alpha, o.hot && o.state === 'idle' ? 0.22 : 0, 0.11);
    }
    const g = f.gate;
    if (g) {
      // The ring surrounds the phone when it is at home, so fade it out as the camera gets close to it.
      const d = Math.sqrt(dist2(g.pos, f.cam!.pos));
      const a = Math.max(0, Math.min(1, (d - g.r * 1.1) / 0.08));
      if (a > 0.01) {
        const col = hexRgb(g.active ? PALETTE.green : PALETTE.yellow);
        this.drawMesh(gl, this.torus, mat4.model(g.pos, g.r * 0.92, g.yaw), col, a, g.active ? 0.15 : 0.05, 0.06);
      }
    }

    // 2. billboards, back to front, no depth writes
    gl.depthMask(false);
    gl.useProgram(this.sprite.prog);
    gl.uniformMatrix4fv(this.sprite.u.uProj, false, proj); gl.uniformMatrix4fv(this.sprite.u.uView, false, view);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad); gl.enableVertexAttribArray(this.sprite.a.aUV); gl.vertexAttribPointer(this.sprite.a.aUV, 2, gl.FLOAT, false, 0, 0);
    gl.uniform1i(this.sprite.u.uTex, 0); gl.activeTexture(gl.TEXTURE0);
    const camPos = f.cam!.pos;
    const sorted = f.objects.slice().sort((a, b) => dist2(b.pos, camPos) - dist2(a.pos, camPos));
    for (const o of sorted) {
      const age = Math.max(0, now - o.bornMs);
      const pop = Math.min(1, age / 260); const ease = 1 - Math.pow(1 - pop, 3);
      const zoneCol: V3 = o.state === 'correct' ? hexRgb(PALETTE.green) : o.state === 'wrong' ? hexRgb(PALETTE.coral) : o.hot ? hexRgb(PALETTE.green) : [1, 1, 1];
      const zoneA = o.state === 'disabled' ? 0.12 : o.hot ? 0.95 : 0.42;
      const ring = Math.min(o.touchR * 2, Math.max(0.05, o.size * 1.5)) * ease;
      this.drawSprite(gl, this.label('zone', '', ''), o.pos, ring, ring, [zoneCol[0], zoneCol[1], zoneCol[2], zoneA * (o.state === 'correct' ? Math.max(0, 1 - (now - o.stateMs) / 500) : 1)]);
      if (o.kind === 'num' || o.kind === 'word' || o.kind === 'dot') {
        const t = this.label(o.kind, o.label || '', o.kind === 'num' ? NUM_FILLS[o.variant % NUM_FILLS.length] : o.ink || '#fff');
        const h = o.size * ease * (o.hot && o.state === 'idle' ? 1.1 : 1) * (o.state === 'correct' ? 1 + 0.4 * Math.min(1, (now - o.stateMs) / 380) : 1);
        const bob = 0.06 * o.size * Math.sin(now / 560 + o.id * 2.1);
        const tint: [number, number, number, number] = o.state === 'disabled' ? [0.6, 0.6, 0.6, 0.35] : o.state === 'wrong' ? [1, 0.62, 0.58, 1] : o.state === 'correct' ? [0.7, 1, 0.8, Math.max(0, 1 - (now - o.stateMs) / 500)] : [1, 1, 1, 1];
        this.drawSprite(gl, t, [o.pos[0], o.pos[1] + bob, o.pos[2]], h * t.aspect, h, tint);
      }
    }
    // particles
    const soft = this.label('soft', '', '');
    this.parts = this.parts.filter((p) => now - p.born < p.life);
    for (const p of this.parts) {
      const t = (now - p.born) / 1000, k = 1 - (now - p.born) / p.life;
      const pos: V3 = [p.p[0] + p.v[0] * t, p.p[1] + p.v[1] * t - 0.5 * 0.8 * t * t, p.p[2] + p.v[2] * t];
      this.drawSprite(gl, soft, pos, p.size * (0.6 + k), p.size * (0.6 + k), [p.color[0], p.color[1], p.color[2], Math.max(0, k)]);
    }
    gl.depthMask(true);
  }

  private drawMesh(gl: WebGLRenderingContext, m: Mesh, model: Mat4, col: V3, alpha: number, glow: number, outline: number) {
    const S = this.solid;
    const bind = () => {
      gl.bindBuffer(gl.ARRAY_BUFFER, m.pos); gl.enableVertexAttribArray(S.a.aPos); gl.vertexAttribPointer(S.a.aPos, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, m.nrm); gl.enableVertexAttribArray(S.a.aNrm); gl.vertexAttribPointer(S.a.aNrm, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, m.out); gl.enableVertexAttribArray(S.a.aOut); gl.vertexAttribPointer(S.a.aOut, 3, gl.FLOAT, false, 0, 0);
    };
    bind(); gl.uniformMatrix4fv(S.u.uModel, false, model);
    // ink outline: back faces pushed outwards
    gl.enable(gl.CULL_FACE); gl.cullFace(gl.FRONT);
    gl.uniform1f(S.u.uOutline, outline); gl.uniform1f(S.u.uFlat, 1); gl.uniform3f(S.u.uColor, 0.078, 0.106, 0.176); gl.uniform1f(S.u.uAlpha, alpha); gl.uniform1f(S.u.uGlow, 0);
    gl.drawArrays(gl.TRIANGLES, 0, m.count);
    gl.cullFace(gl.BACK);
    gl.uniform1f(S.u.uOutline, 0); gl.uniform1f(S.u.uFlat, 0); gl.uniform3f(S.u.uColor, col[0], col[1], col[2]); gl.uniform1f(S.u.uGlow, glow);
    gl.drawArrays(gl.TRIANGLES, 0, m.count);
    gl.disable(gl.CULL_FACE);
  }

  private drawSprite(gl: WebGLRenderingContext, t: { t: WebGLTexture; aspect: number }, pos: V3, w: number, h: number, tint: [number, number, number, number]) {
    if (tint[3] <= 0.001 || w <= 0) return;
    gl.bindTexture(gl.TEXTURE_2D, t.t);
    gl.uniform3f(this.sprite.u.uCenter, pos[0], pos[1], pos[2]); gl.uniform2f(this.sprite.u.uSize, w, h);
    gl.uniform4f(this.sprite.u.uTint, tint[0], tint[1], tint[2], tint[3]);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  private drawGrid(gl: WebGLRenderingContext, view: Mat4, proj: Mat4, y: number, camPos: V3) {
    const cx = Math.round(camPos[0] / 0.25) * 0.25, cz = Math.round(camPos[2] / 0.25) * 0.25;
    const key = cx + ',' + cz + ',' + y;
    if (!this.gridBuf || key !== this.gridKey) {
      const pts: number[] = []; const ext = 2.5, step = 0.25;
      for (let i = -ext; i <= ext + 1e-6; i += step) { pts.push(cx + i, y, cz - ext, cx + i, y, cz + ext, cx - ext, y, cz + i, cx + ext, y, cz + i); }
      if (this.gridBuf) gl.deleteBuffer(this.gridBuf);
      this.gridBuf = this.buf(gl, pts); this.gridCount = pts.length / 3; this.gridKey = key;
    }
    gl.useProgram(this.line.prog);
    gl.uniformMatrix4fv(this.line.u.uProj, false, proj); gl.uniformMatrix4fv(this.line.u.uView, false, view);
    gl.uniform4f(this.line.u.uColor, 0.62, 0.7, 1.0, 0.22);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.gridBuf); gl.enableVertexAttribArray(this.line.a.aPos); gl.vertexAttribPointer(this.line.a.aPos, 3, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.LINES, 0, this.gridCount);
  }

  /* ---------------- 2D layer ---------------- */
  private project(view: Mat4, proj: Mat4, p: V3): { x: number; y: number; w: number; z: number } | null {
    const e = mat4.transformPoint(view, p);
    const c = mat4.transformPoint(proj, [e[0], e[1], e[2]]);
    // c[3] is -e.z for a perspective matrix
    const w = c[3];
    if (!isFinite(w)) return null;
    return { x: (c[0] / (w || 1e-6) * 0.5 + 0.5) * this.W, y: (1 - (c[1] / (w || 1e-6) * 0.5 + 0.5)) * this.H, w, z: -e[2] };
  }

  private draw2d(f: ViewFrame, view: Mat4 | null, proj: Mat4 | null) {
    const g = this.ctx2; if (!g) return;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.W, this.H);
    const now = f.nowMs;
    const cx = this.W / 2, cy = this.H / 2;

    if (view && proj && f.cam) {
      const fwd: V3 = [-view[2], -view[6], -view[10]];
      const cam = f.cam.pos;
      const edge = { l: 28, r: this.W - 28, t: 120, b: this.H - 110 };
      let arrows = 0;
      const guide = (pos: V3, color: string, tag: string) => {
        const pr = this.project(view, proj, pos);
        const dx = pos[0] - cam[0], dy = pos[1] - cam[1], dz = pos[2] - cam[2];
        const dl = Math.hypot(dx, dy, dz) || 1;
        let text: string;
        if (f.kind === 'linear') text = Math.round(dl * 100) + ' cm';
        else { const dot = (dx * fwd[0] + dy * fwd[1] + dz * fwd[2]) / dl; text = Math.round(Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI) + '°'; }
        const on = !!pr && pr.z > 0.02 && pr.x > edge.l && pr.x < edge.r && pr.y > edge.t && pr.y < edge.b;
        if (on) return { on, pr, text };
        // direction on screen (towards the object, even if it is behind the camera)
        let dirx: number, diry: number;
        if (pr && pr.z > 0.02) { dirx = pr.x - cx; diry = pr.y - cy; }
        else {
          const e = mat4.transformPoint(view, pos);
          dirx = e[0]; diry = -e[1];
          if (Math.hypot(dirx, diry) < 1e-4) { dirx = 0; diry = 1; }
        }
        const a = Math.atan2(diry, dirx);
        const k = Math.min((dirx === 0 ? 1e9 : Math.abs(((dirx > 0 ? edge.r : edge.l) - cx) / dirx)), (diry === 0 ? 1e9 : Math.abs(((diry > 0 ? edge.b : edge.t) - cy) / diry)));
        const px = cx + dirx * k, py = cy + diry * k;
        this.arrow(g, px, py, a, color, text, tag, now);
        arrows++;
        return { on: false, pr, text };
      };

      // targets
      for (const o of f.objects) {
        if (o.state !== 'idle') {
          const pr = this.project(view, proj, o.pos);
          if (pr && pr.z > 0.02 && o.state === 'wrong') this.shake(g, pr.x, pr.y, Math.min(150, Math.max(26, this.pxRadius(proj, pr.z, o.touchR))), now - o.stateMs);
          continue;
        }
        const gr = guide(o.pos, f.objects.length === 1 ? PALETTE.yellow : PALETTE.cobaltSoft, '');
        if (gr.on && gr.pr && o.progress > 0.01) {
          // dwell progress arc around the touch zone
          const rpx = Math.min(150, Math.max(18, this.pxRadius(proj, gr.pr.z, o.touchR) + 6));
          g.lineWidth = 8; g.lineCap = 'round'; g.strokeStyle = 'rgba(20,27,45,0.85)';
          g.beginPath(); g.arc(gr.pr.x, gr.pr.y, rpx, -Math.PI / 2, -Math.PI / 2 + o.progress * Math.PI * 2); g.stroke();
          g.lineWidth = 4.5; g.strokeStyle = PALETTE.green;
          g.beginPath(); g.arc(gr.pr.x, gr.pr.y, rpx, -Math.PI / 2, -Math.PI / 2 + o.progress * Math.PI * 2); g.stroke();
        }
      }
      // gate (home ring)
      if (f.gate && f.gate.hint) {
        const r = guide(f.gate.pos, PALETTE.white, 'centre');
        if (r.on && r.pr) { /* the ring itself is visible in 3D */ }
      }
      void arrows;

      // pops
      this.pops = this.pops.filter((p) => now - p.born < 900);
      for (const p of this.pops) {
        const pr = this.project(view, proj, p.pos); if (!pr || pr.z <= 0.02) continue;
        const k = (now - p.born) / 900;
        g.globalAlpha = 1 - k; g.font = `700 34px ${FONT}`; g.textAlign = 'center'; g.lineWidth = 7; g.strokeStyle = PALETTE.ink; g.fillStyle = p.color;
        g.strokeText(p.text, pr.x, pr.y - 20 - 60 * k); g.fillText(p.text, pr.x, pr.y - 20 - 60 * k); g.globalAlpha = 1;
      }
    }

    // reticle (angular modes: the phone's aim is the centre of the screen)
    if (f.reticle.show) this.reticle(g, cx, cy, f.reticle.progress, f.reticle.hot);
    // at the start ring (position tracking): the same ring in the middle of the screen counts the hold
    else if (f.gate && f.gate.active && f.cam) this.reticle(g, cx, cy, f.gate.progress, true);
  }

  private arrow(g: CanvasRenderingContext2D, x: number, y: number, a: number, color: string, text: string, tag: string, now: number) {
    const pulse = 1 + 0.06 * Math.sin(now / 220);
    g.save(); g.translate(x, y);
    g.fillStyle = PALETTE.ink; g.strokeStyle = color; g.lineWidth = 3;
    g.beginPath(); g.arc(0, 0, 22 * pulse, 0, Math.PI * 2); g.fill(); g.stroke();
    g.rotate(a); g.fillStyle = color;
    g.beginPath(); g.moveTo(11, 0); g.lineTo(-6, -9); g.lineTo(-6, 9); g.closePath(); g.fill();
    g.restore();
    // distance label on the inside of the chip
    const lx = Math.min(this.W - 36, Math.max(36, x - Math.cos(a) * 38)), ly = Math.min(this.H - 100, Math.max(130, y - Math.sin(a) * 38));
    g.font = `700 13px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    const label = tag ? tag + ' ' + text : text;
    const w = g.measureText(label).width + 14;
    g.fillStyle = PALETTE.ink; g.beginPath(); g.roundRect ? g.roundRect(lx - w / 2, ly - 11, w, 22, 11) : g.rect(lx - w / 2, ly - 11, w, 22); g.fill();
    g.fillStyle = PALETTE.paper; g.fillText(label, lx, ly + 1);
  }

  private pxRadius(proj: Mat4, depth: number, r: number) { return (r / Math.max(0.03, depth)) * proj[5] * (this.H / 2); }

  private shake(g: CanvasRenderingContext2D, x: number, y: number, r: number, age: number) {
    if (age > 400) return;
    g.save(); g.globalAlpha = 1 - age / 400; g.strokeStyle = PALETTE.coral; g.lineWidth = 6;
    g.beginPath(); g.arc(x, y, r * (1 + age / 400), 0, Math.PI * 2); g.stroke(); g.restore();
  }

  private reticle(g: CanvasRenderingContext2D, x: number, y: number, progress: number, hot: boolean) {
    const R = 30;
    g.lineCap = 'round';
    g.lineWidth = 7; g.strokeStyle = 'rgba(20,27,45,0.9)'; g.beginPath(); g.arc(x, y, R, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 3.5; g.strokeStyle = hot ? PALETTE.green : PALETTE.paper; g.beginPath(); g.arc(x, y, R, 0, Math.PI * 2); g.stroke();
    if (progress > 0.01) { g.lineWidth = 7; g.strokeStyle = PALETTE.green; g.beginPath(); g.arc(x, y, R + 9, -Math.PI / 2, -Math.PI / 2 + Math.min(1, progress) * Math.PI * 2); g.stroke(); }
    g.lineWidth = 3.5; g.strokeStyle = 'rgba(20,27,45,0.9)'; g.beginPath(); g.moveTo(x - 9, y); g.lineTo(x + 9, y); g.moveTo(x, y - 9); g.lineTo(x, y + 9); g.stroke();
    g.lineWidth = 2; g.strokeStyle = PALETTE.paper; g.beginPath(); g.moveTo(x - 8, y); g.lineTo(x + 8, y); g.moveTo(x, y - 8); g.lineTo(x, y + 8); g.stroke();
  }

  dispose() {
    const gl = this.gl;
    this.pops = []; this.parts = [];
    if (gl && !this.xr) { try { gl.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* ignore */ } }
    this.tex.clear();
    this.gl = null;
  }
}

function dist2(a: V3, b: V3) { const x = a[0] - b[0], y = a[1] - b[1], z = a[2] - b[2]; return x * x + y * y + z * z; }
