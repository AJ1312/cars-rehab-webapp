import Link from 'next/link';
import { requireStaff } from '@/lib/server/auth';
import { getStore } from '@/lib/server/store';
import { FLAG_INFO } from '@/lib/server/ingest';
import { Flags } from '@/components/admin/Bits';
import { ago, fmtDateTime, MODE_LABEL, n1 } from '@/lib/format';

export const metadata = { title: 'Data quality' };
const avg = (a: (number | null | undefined)[]) => { const v = a.filter((x): x is number => x != null && Number.isFinite(x)); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };

export default async function Quality() {
  await requireStaff();
  const store = getStore();
  const [rows, devices] = await Promise.all([store.listSessions({ limit: 5000 }), store.listDevices()]);
  const flagCount = new Map<string, number>();
  rows.forEach((r) => r.flags.forEach((f) => flagCount.set(f, (flagCount.get(f) || 0) + 1)));
  const modes = new Map<string, number>(); rows.forEach((r) => modes.set(r.mode, (modes.get(r.mode) || 0) + 1));
  const clean = rows.filter((r) => r.flags.length === 0).length;
  const problem = rows.filter((r) => r.flags.some((f) => FLAG_INFO[f]?.severity === 'bad' || f === 'kin_missing'));
  const perDevice = devices.map((d) => {
    const s = rows.filter((r) => r.deviceId === d.id);
    return { d, n: s.length, valid: avg(s.map((x) => x.summary.validPctMean)), jitter: avg(s.map((x) => x.summary.calJitterCm)), rate: avg(s.map((x) => x.summary.calRateHz)), flagged: s.filter((x) => x.flags.length).length, last: s.length ? s[0].receivedAt : null };
  });

  return (
    <>
      <div><h1>Data quality</h1><p className="sub">Automatic checks run on every upload. Flagged sessions are kept in the data and marked, never deleted.</p></div>
      <div className="kpis">
        <div className="kpi"><b>{rows.length ? Math.round((100 * clean) / rows.length) + '%' : '–'}</b><span>Sessions with no flags</span></div>
        {[...modes.entries()].map(([m, n]) => <div className="kpi" key={m}><b>{n}</b><span>{MODE_LABEL[m] ?? m}</span></div>)}
        <div className={'kpi' + (problem.length ? ' bad' : '')}><b>{problem.length}</b><span>Need a look</span></div>
      </div>

      <div className="cols">
        <section className="panel"><h2>What the checks found</h2>
          {flagCount.size === 0 ? <p className="muted">No flags raised.</p> : (
            <div className="table-wrap"><table><thead><tr><th>Check</th><th className="r">Sessions</th></tr></thead><tbody>
              {[...flagCount.entries()].sort((a, b) => b[1] - a[1]).map(([f, n]) => <tr key={f}><td><span className={'flag ' + (FLAG_INFO[f]?.severity ?? '')} title={FLAG_INFO[f]?.help}>{FLAG_INFO[f]?.label ?? f}</span></td><td className="r">{n}</td></tr>)}
            </tbody></table></div>
          )}
        </section>
        <section className="panel"><h2>By phone</h2>
          {perDevice.length === 0 ? <p className="muted">No phones have uploaded yet.</p> : (
            <div className="table-wrap"><table><thead><tr><th>Phone</th><th className="r">Sessions</th><th className="r">Tracking %</th><th className="r">Jitter cm</th><th className="r">Rate Hz</th><th className="r">Flagged</th><th>Last upload</th></tr></thead><tbody>
              {perDevice.map((x) => <tr key={x.d.id}><td>{x.d.label}{x.d.revokedAt ? ' (revoked)' : ''}</td><td className="r">{x.n}</td><td className="r">{n1(x.valid, 0)}</td><td className="r">{n1(x.jitter, 2)}</td><td className="r">{n1(x.rate, 0)}</td><td className="r">{x.flagged}</td><td>{ago(x.last)}</td></tr>)}
            </tbody></table></div>
          )}
        </section>
      </div>

      <section className="panel"><h2>Sessions that need a look</h2>
        {problem.length === 0 ? <p className="muted">None.</p> : (
          <div className="table-wrap"><table><thead><tr><th>Participant</th><th className="r">#</th><th>Started</th><th>Phone</th><th>Problem</th></tr></thead><tbody>
            {problem.map((r) => <tr key={r.id}><td><Link href={`/admin/sessions/${r.id}`}>{r.participantCode}</Link></td><td className="r">{r.sessionNo}</td><td>{fmtDateTime(r.startedAt)}</td><td>{r.deviceLabel ?? '–'}</td><td><Flags flags={r.flags} /></td></tr>)}
          </tbody></table></div>
        )}
      </section>
    </>
  );
}
