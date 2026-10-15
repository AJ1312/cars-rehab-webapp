/* Small dependency-free SVG charts, rendered on the server (no chart library shipped to the browser). */

export interface Series { name: string; color: string; points: (number | null)[] }

export function LineChart({ labels, series, yLabel, height = 220 }: { labels: string[]; series: Series[]; yLabel?: string; height?: number }) {
  const W = 640, H = height, L = 44, R = 14, T = 12, B = 34;
  const vals = series.flatMap((s) => s.points).filter((v): v is number => v != null);
  if (!vals.length || !labels.length) return <div className="empty">No data yet</div>;
  const max = Math.max(1, ...vals) * 1.1, min = 0;
  const x = (i: number) => L + (labels.length === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (labels.length - 1));
  const y = (v: number) => T + (1 - (v - min) / (max - min)) * (H - T - B);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => min + f * (max - min));
  const step = Math.max(1, Math.ceil(labels.length / 8));
  return (
    <div className="svgbox">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={yLabel ? `Line chart of ${yLabel}` : 'Line chart'}>
        {ticks.map((t) => (<g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--grid)" /><text x={L - 6} y={y(t) + 4} textAnchor="end" fontSize="12" fill="var(--muted)">{Math.round(t * 10) / 10}</text></g>))}
        {labels.map((l, i) => (i % step === 0 ? <text key={i} x={x(i)} y={H - 10} textAnchor="middle" fontSize="12" fill="var(--muted)">{l}</text> : null))}
        {series.map((s) => {
          const pts = s.points.map((v, i) => (v == null ? null : [x(i), y(v)] as const));
          const d = pts.reduce((acc, p, i) => (p ? acc + (i > 0 && pts[i - 1] ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1) : acc), '');
          return (<g key={s.name}><path d={d} fill="none" stroke={s.color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />{pts.map((p, i) => (p ? <circle key={i} cx={p[0]} cy={p[1]} r="4" fill={s.color}><title>{`${s.name}, ${labels[i]}: ${s.points[i]}`}</title></circle> : null))}</g>);
        })}
      </svg>
      <div className="legend">{series.map((s) => <span key={s.name}><i style={{ background: s.color }} />{s.name}</span>)}{yLabel && <span>· {yLabel}</span>}</div>
    </div>
  );
}

export function Bars({ labels, values, color = 'var(--accent)', height = 160 }: { labels: string[]; values: number[]; color?: string; height?: number }) {
  const W = 640, H = height, L = 30, R = 8, T = 10, B = 28;
  const max = Math.max(1, ...values);
  const bw = (W - L - R) / Math.max(1, values.length);
  return (
    <div className="svgbox">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Bar chart">
        <line x1={L} x2={W - R} y1={H - B} y2={H - B} stroke="var(--grid)" />
        {[0, max].map((t) => <text key={t} x={L - 6} y={T + (1 - t / max) * (H - T - B) + 4} textAnchor="end" fontSize="12" fill="var(--muted)">{t}</text>)}
        {values.map((v, i) => {
          const h = (v / max) * (H - T - B);
          return (<g key={i}><rect x={L + i * bw + bw * 0.15} y={H - B - h} width={bw * 0.7} height={Math.max(v ? 2 : 0, h)} rx="3" fill={color}><title>{`${labels[i]}: ${v}`}</title></rect>{i % Math.ceil(values.length / 8) === 0 && <text x={L + i * bw + bw / 2} y={H - 9} textAnchor="middle" fontSize="12" fill="var(--muted)">{labels[i]}</text>}</g>);
        })}
      </svg>
    </div>
  );
}

/** Where the hand actually went, and where the targets were: front view (x right, y up) and, for position-tracked sessions, top view (x right, z forward). cm from the start point. */
export function ReachMap({ rows, targets, radiusCm, linear }: { rows: (string | number | null)[][]; targets: { x: number; y: number; z: number }[]; radiusCm: number; linear: boolean }) {
  const colorOf: Record<string, string> = { 'Triangle Reach': 'var(--c1)', 'Maths Fun': 'var(--c2)', 'Colour Merge Test': 'var(--c3)', 'Range check': 'var(--muted)' };
  const games = new Set<string>();
  for (const r of rows) if (typeof r[4] === 'number') games.add(String(r[1]));
  if (!games.size) return <div className="empty">No movement file for this session</div>;
  const view = (title: string, ax: 0 | 2, ay: 1 | 2, xl: string, yl: string) => {
    const S = 300, pad = 16, ext = radiusCm * 1.15 + 6;
    const sc = (S / 2 - pad) / ext;
    const X = (cm: number) => S / 2 + cm * sc, Y = (cm: number) => (ay === 2 ? S - 22 : S / 2) - cm * sc * (ay === 2 ? 1.0 : 1);
    const lines = new Map<string, string[]>();
    for (const r of rows) {
      const g = String(r[1]); const px = r[4 + (ax === 2 ? 2 : 0)], py = r[4 + ay];
      if (typeof px !== 'number' || typeof py !== 'number') continue;
      if (!lines.has(g)) lines.set(g, []);
      lines.get(g)!.push(`${X(px).toFixed(1)},${Y(py).toFixed(1)}`);
    }
    const tv = (t: { x: number; y: number; z: number }) => [ax === 2 ? t.z : t.x, ay === 1 ? t.y : t.z];
    return (
      <figure style={{ margin: 0, minWidth: 0 }}>
        <div className="svgbox" style={{ maxWidth: 360 }}>
          <svg viewBox={`0 0 ${S} ${S}`} role="img" aria-label={title}>
            <rect x="1" y="1" width={S - 2} height={S - 2} rx="14" fill="none" stroke="var(--line)" />
            <line x1={S / 2} x2={S / 2} y1="14" y2={S - 14} stroke="var(--grid)" strokeDasharray="3 5" />
            <line y1={ay === 2 ? S - 22 : S / 2} y2={ay === 2 ? S - 22 : S / 2} x1="14" x2={S - 14} stroke="var(--grid)" strokeDasharray="3 5" />
            {[...lines.entries()].map(([g, pts]) => <polyline key={g} points={pts.join(' ')} fill="none" stroke={colorOf[g] || 'var(--muted)'} strokeWidth="1.5" strokeOpacity="0.75" strokeLinejoin="round" />)}
            {targets.map((t, i) => { const [a, b] = tv(t); return <circle key={i} cx={X(a)} cy={Y(b)} r="5" fill="#FF8A00" stroke="var(--ink)" strokeWidth="1.6" fillOpacity="0.85" />; })}
            <circle cx={X(0)} cy={Y(0)} r="6" fill="none" stroke="var(--accent)" strokeWidth="2.4" />
            <text x={S - 10} y={ay === 2 ? S - 26 : S / 2 - 6} textAnchor="end" fontSize="11" fill="var(--muted)">{xl}</text>
            <text x={S / 2 + 6} y="24" fontSize="11" fill="var(--muted)">{yl}</text>
          </svg>
        </div>
        <figcaption className="small muted" style={{ textAlign: 'center' }}>{title}</figcaption>
      </figure>
    );
  };
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div className="cols" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))' }}>
        {view('Front view: from the participant\u2019s side of the targets', 0, 1, 'right \u2192', '\u2191 up')}
        {linear && view('Top view: how far forward the hand went', 0, 2, 'right \u2192', '\u2191 forward')}
      </div>
      <div className="legend">{[...games].map((g) => <span key={g}><i style={{ background: colorOf[g] || 'var(--muted)' }} />{g}</span>)}<span>● orange = target positions</span></div>
    </div>
  );
}

export function Spark({ values, color = 'var(--accent)' }: { values: (number | null)[]; color?: string }) {
  const v = values.filter((x): x is number => x != null);
  if (v.length < 2) return <span className="muted">–</span>;
  const W = 90, H = 26, max = Math.max(...v), min = Math.min(...v);
  const pts = v.map((val, i) => `${(i * (W - 4)) / (v.length - 1) + 2},${H - 3 - ((val - min) / (max - min || 1)) * (H - 6)}`).join(' ');
  return <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Trend from ${v[0]} to ${v[v.length - 1]}`}><polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
