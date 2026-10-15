export function fmtDate(iso: string | null | undefined, offMin?: number): string {
  if (!iso) return '–';
  const d = new Date(iso); if (isNaN(+d)) return '–';
  const t = typeof offMin === 'number' ? new Date(+d + offMin * 60000) : d;
  return t.toISOString().slice(0, 10);
}
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '–';
  const d = new Date(iso); if (isNaN(+d)) return '–';
  return d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
}
export function ago(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const s = Math.max(0, (Date.now() - +new Date(iso)) / 1000);
  if (s < 90) return 'just now';
  if (s < 5400) return Math.round(s / 60) + ' min ago';
  if (s < 129600) return Math.round(s / 3600) + ' h ago';
  return Math.round(s / 86400) + ' d ago';
}
export const n1 = (v: number | null | undefined, d = 1) => (v == null || !Number.isFinite(v) ? '–' : v.toFixed(d));
export const MODE_LABEL: Record<string, string> = { '6dof': 'AR 6-DoF', motion: 'Motion 3-DoF', touch: 'Touch', sim: 'Simulated' };
export const GAME_NAME: Record<string, string> = { triangle: 'Triangle Reach', maths: 'Maths Fun', colour: 'Colour Merge Test' };
export const q1 = (v: string | string[] | undefined): string => (Array.isArray(v) ? v[0] : v) || '';
