/* Canvas 2-D renderer for the play stage. Pure drawing: the engine hands it a view description each frame. */

export interface DrawTarget {
  x: number; y: number;            // metres in the calibrated frame (x right, y up)
  r: number;                       // hit radius, metres
  kind: 'tri' | 'dot' | 'opt';
  label?: string;
  ink?: string;                    // colour of the label text
  state: 'idle' | 'disabled' | 'wrong' | 'correct';
  progress: number;                // 0..1 dwell progress
  hot?: boolean;                   // cursor is inside
}

export interface DrawView {
  scale: number;                   // pixels per metre
  insetTop: number; insetBottom: number;
  transparent: boolean;            // AR / camera behind the canvas
  guideRingsM: number[];
  home: { r: number; active: boolean; progress: number; show: boolean };
  targets: DrawTarget[];
  cursor: { x: number; y: number } | null;
  trail: { x: number; y: number }[];
  tracking: 'ok' | 'lost' | 'waiting';
}

export class Stage {
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  w = 0; h = 0;
  private ro: ResizeObserver;
  private col = { tri: '#FFB020', accent: '#43D3B3', ok: '#3EE08A', bad: '#FF5A4A', ink: '#EEF6F3', muted: '#A7BCB6', bg: '#071011' };
  private fontDisplay = 'Lexend Variable, Lexend, system-ui, sans-serif';

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) throw new Error('Canvas is not available');
    this.ctx = ctx;
    this.readTheme();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.resize();
  }
  dispose() { this.ro.disconnect(); }

  private readTheme() {
    const cs = getComputedStyle(this.canvas);
    const v = (n: string, d: string) => cs.getPropertyValue(n).trim() || d;
    this.col = {
      tri: v('--st-tri', this.col.tri), accent: v('--st-accent', this.col.accent), ok: v('--st-ok', this.col.ok),
      bad: v('--st-bad', this.col.bad), ink: v('--st-ink', this.col.ink), muted: v('--st-muted', this.col.muted), bg: v('--st-bg', this.col.bg)
    };
    this.fontDisplay = v('--font-display', this.fontDisplay);
  }

  resize() {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = this.canvas.getBoundingClientRect();
    this.w = Math.max(1, Math.round(r.width)); this.h = Math.max(1, Math.round(r.height));
    this.canvas.width = Math.round(this.w * this.dpr); this.canvas.height = Math.round(this.h * this.dpr);
  }

  /** Pixels per metre so that a ring of radius `extentM` plus a target fits the free area. */
  fitScale(extentM: number, insetTop: number, insetBottom: number): number {
    const freeH = Math.max(80, this.h - insetTop - insetBottom);
    return 0.94 * Math.min(this.w / 2, freeH / 2) / extentM;
  }
  centre(insetTop: number, insetBottom: number) { return { cx: this.w / 2, cy: insetTop + (this.h - insetTop - insetBottom) / 2 }; }
  /** Pointer position (css px) -> metres in the calibrated frame. */
  toMetres(px: number, py: number, v: { scale: number; insetTop: number; insetBottom: number }) {
    const { cx, cy } = this.centre(v.insetTop, v.insetBottom);
    return { x: (px - cx) / v.scale, y: -(py - cy) / v.scale };
  }

  draw(v: DrawView) {
    const { ctx } = this;
    const c = this.col;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    if (v.transparent) { ctx.fillStyle = 'rgba(5,12,12,0.55)'; ctx.fillRect(0, 0, this.w, this.h); }
    const { cx, cy } = this.centre(v.insetTop, v.insetBottom);
    const px = (m: number) => m * v.scale;
    const X = (m: number) => cx + px(m);
    const Y = (m: number) => cy - px(m);

    // Guides: faint rings and the eight directions.
    ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.setLineDash([4, 8]);
    for (const rm of v.guideRingsM) { ctx.beginPath(); ctx.arc(cx, cy, px(rm), 0, Math.PI * 2); ctx.stroke(); }
    ctx.setLineDash([]);
    if (v.guideRingsM.length) {
      const R = px(Math.max(...v.guideRingsM));
      ctx.strokeStyle = 'rgba(255,255,255,0.07)';
      for (let k = 0; k < 8; k++) { const a = (k * Math.PI) / 4; ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * px(v.home.r) * 1.3, cy - Math.sin(a) * px(v.home.r) * 1.3); ctx.lineTo(cx + Math.cos(a) * R, cy - Math.sin(a) * R); ctx.stroke(); }
    }

    // Home ring.
    if (v.home.show) {
      const r = px(v.home.r);
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = v.home.active ? 'rgba(67,211,179,0.20)' : 'rgba(67,211,179,0.06)'; ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = c.accent; ctx.stroke();
      if (v.home.progress > 0) { ctx.beginPath(); ctx.arc(cx, cy, r + 6, -Math.PI / 2, -Math.PI / 2 + v.home.progress * Math.PI * 2); ctx.lineWidth = 5; ctx.strokeStyle = c.ok; ctx.stroke(); }
    }

    // Targets.
    for (const t of v.targets) this.target(t, X(t.x), Y(t.y), px(t.r));

    // Cursor and trail.
    if (v.cursor && v.tracking !== 'waiting') {
      const lost = v.tracking === 'lost';
      for (let i = 0; i < v.trail.length; i++) {
        const a = (i + 1) / v.trail.length;
        ctx.beginPath(); ctx.arc(X(v.trail[i].x), Y(v.trail[i].y), 3 + 4 * a, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${0.04 + 0.16 * a})`; ctx.fill();
      }
      const x = X(v.cursor.x), y = Y(v.cursor.y);
      const g = ctx.createRadialGradient(x, y, 2, x, y, 30);
      g.addColorStop(0, lost ? 'rgba(255,90,74,0.45)' : 'rgba(255,255,255,0.40)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 30, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(x, y, 12, 0, Math.PI * 2); ctx.lineWidth = 4; ctx.strokeStyle = lost ? c.bad : '#FFFFFF'; ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, 4.5, 0, Math.PI * 2); ctx.fillStyle = lost ? c.bad : c.accent; ctx.fill();
    }
  }

  private target(t: DrawTarget, x: number, y: number, r: number) {
    const { ctx } = this;
    const c = this.col;
    const faded = t.state === 'disabled' || t.state === 'wrong';
    ctx.save();
    ctx.globalAlpha = faded ? 0.45 : 1;
    if (t.kind === 'tri') {
      const R = r * 1.45;
      ctx.beginPath();
      for (let k = 0; k < 3; k++) { const a = -Math.PI / 2 + (k * 2 * Math.PI) / 3; const px = x + Math.cos(a) * R, py = y + Math.sin(a) * R * 1.0 + R * 0.12; k ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
      ctx.closePath();
      ctx.fillStyle = t.state === 'correct' ? c.ok : c.tri; ctx.fill();
      ctx.lineWidth = 4; ctx.strokeStyle = '#FFFFFF'; ctx.lineJoin = 'round'; ctx.stroke();
    } else {
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = t.state === 'correct' ? 'rgba(62,224,138,0.35)' : t.state === 'wrong' ? 'rgba(255,90,74,0.35)' : 'rgba(10,24,24,0.92)'; ctx.fill();
      ctx.lineWidth = 4; ctx.strokeStyle = t.state === 'correct' ? c.ok : t.state === 'wrong' ? c.bad : 'rgba(255,255,255,0.85)'; ctx.stroke();
      if (t.label) {
        const word = t.label.length > 2;
        const size = word ? Math.max(11, Math.min(r * 0.62, (r * 2.5) / (t.label.length * 0.62))) : r * 1.15;
        ctx.font = `700 ${size}px ${this.fontDisplay}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        if (word) { ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.lineJoin = 'round'; ctx.strokeText(t.label, x, y + 1); }
        ctx.fillStyle = t.ink || '#FFFFFF'; ctx.fillText(t.label, x, y + 1);
      }
    }
    if (t.progress > 0 && t.state === 'idle') {
      ctx.beginPath(); ctx.arc(x, y, r + 7, -Math.PI / 2, -Math.PI / 2 + t.progress * Math.PI * 2);
      ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.strokeStyle = c.accent; ctx.stroke();
    } else if (t.hot && t.state === 'idle') {
      ctx.beginPath(); ctx.arc(x, y, r + 7, 0, Math.PI * 2); ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(67,211,179,0.5)'; ctx.stroke();
    }
    ctx.restore();
  }
}
