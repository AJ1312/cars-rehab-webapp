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

/** Where the hand actually went: the 20 Hz cursor path per game over the target ring. cm, x right, y up. */
export function ReachMap({ rows, ringCm }: { rows: (string | number | null)[][]; ringCm: number }) {
  const S = 300, pad = 14, ext = ringCm + 12;
  const sc = (S / 2 - pad) / ext;
  const X = (cm: number) => S / 2 + cm * sc, Y = (cm: number) => S / 2 - cm * sc;
  const colorOf: Record<string, string> = { 'Triangle Reach': 'var(--c1)', 'Maths Fun': 'var(--c2)', 'Colour Merge Test': 'var(--c3)', 'Range check': 'var(--muted)' };
  const byGame = new Map<string, string[]>();
  for (const r of rows) {
    const g = String(r[1]); const px = r[4], py = r[5];
    if (typeof px !== 'number' || typeof py !== 'number') continue;
    if (!byGame.has(g)) byGame.set(g, []);
    byGame.get(g)!.push(`${X(px).toFixed(1)},${Y(py).toFixed(1)}`);
  }
  if (!byGame.size) return <div className="empty">No movement file for this session</div>;
  return (
    <div className="svgbox" style={{ maxWidth: 420 }}>
      <svg viewBox={`0 0 ${S} ${S}`} role="img" aria-label="Map of the movement path">
        <circle cx={S / 2} cy={S / 2} r={ringCm * sc} fill="none" stroke="var(--grid)" strokeDasharray="4 6" />
        {[0, 45, 90, 135, 180, 225, 270, 315].map((d) => <circle key={d} cx={X(ringCm * Math.cos((d * Math.PI) / 180))} cy={Y(ringCm * Math.sin((d * Math.PI) / 180))} r="4" fill="var(--grid)" />)}
        <circle cx={S / 2} cy={S / 2} r={8 * sc} fill="none" stroke="var(--accent)" />
        {[...byGame.entries()].map(([g, pts]) => <polyline key={g} points={pts.join(' ')} fill="none" stroke={colorOf[g] || 'var(--muted)'} strokeWidth="1.4" strokeOpacity="0.8" strokeLinejoin="round" />)}
      </svg>
      <div className="legend">{[...byGame.keys()].map((g) => <span key={g}><i style={{ background: colorOf[g] || 'var(--muted)' }} />{g}</span>)}</div>
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
