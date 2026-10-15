import Link from 'next/link';
import { requireStaff } from '@/lib/server/auth';
import { getStore } from '@/lib/server/store';
import { FLAG_INFO } from '@/lib/server/ingest';
import { Bars } from '@/components/admin/charts';
import { Flags } from '@/components/admin/Bits';
import { ago, fmtDateTime, MODE_LABEL } from '@/lib/format';

export const metadata = { title: 'Overview' };
const DAY = 86400_000;

export default async function Overview({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireStaff();
  const denied = (await searchParams).denied;
  const store = getStore();
  const [rows, devices] = await Promise.all([store.listSessions({ limit: 5000 }), store.listDevices()]);
  const now = Date.now();
  const participants = new Set(rows.map((r) => r.participantCode));
  const week = rows.filter((r) => now - +new Date(r.startedAt) < 7 * DAY);
  const serious = rows.filter((r) => r.flags.some((f) => FLAG_INFO[f]?.severity === 'bad' || (f === 'kin_missing' && now - +new Date(r.receivedAt) > DAY)));
  const research = rows.filter((r) => r.mode === '6dof').length;
  const weeks = 12;
  const counts = Array.from({ length: weeks }, () => 0);
  for (const r of rows) { const w = Math.floor((now - +new Date(r.startedAt)) / (7 * DAY)); if (w >= 0 && w < weeks) counts[weeks - 1 - w]++; }
  const labels = counts.map((_, i) => (i === weeks - 1 ? 'now' : `-${weeks - 1 - i}w`));
  const live = devices.filter((d) => d.enrolledAt && !d.revokedAt);
  const quiet = live.filter((d) => !d.lastSeenAt || now - +new Date(d.lastSeenAt) > 14 * DAY);

  return (
    <>
      <div><h1>Overview</h1><p className="sub">Everything that arrived from the study phones.</p></div>
      {denied && <p className="notice" role="alert">Your role does not include that page.</p>}
      <div className="kpis">
        <div className="kpi"><b>{participants.size}</b><span>Participants</span></div>
        <div className="kpi"><b>{rows.length}</b><span>Sessions</span></div>
        <div className="kpi"><b>{week.length}</b><span>Sessions, last 7 days</span></div>
        <div className="kpi"><b>{rows.length ? Math.round((100 * research) / rows.length) + '%' : '–'}</b><span>With AR position tracking</span></div>
        <div className={'kpi' + (serious.length ? ' bad' : '')}><b>{serious.length}</b><span>Need attention</span></div>
        <div className={'kpi' + (quiet.length ? ' warn' : '')}><b>{live.length}</b><span>Phones enrolled{quiet.length ? ` · ${quiet.length} quiet` : ''}</span></div>
      </div>

      <div className="cols">
        <section className="panel">
          <h2>Needs attention</h2>
          {serious.length === 0 ? <p className="muted">Nothing needs checking. Every session passed the automatic quality checks.</p> : (
            <div className="table-wrap"><table><thead><tr><th>Participant</th><th className="r">#</th><th>Problem</th></tr></thead><tbody>
              {serious.slice(0, 8).map((r) => (
                <tr key={r.id}><td><Link href={`/admin/sessions/${r.id}`}>{r.participantCode}</Link></td><td className="r">{r.sessionNo}</td><td><Flags flags={r.flags.filter((f) => FLAG_INFO[f]?.severity === 'bad' || f === 'kin_missing')} /></td></tr>
              ))}</tbody></table></div>
          )}
          {serious.length > 8 && <Link className="lnk" href="/admin/quality">See all {serious.length} →</Link>}
        </section>
        <section className="panel">
          <h2>Sessions per week</h2>
          <Bars labels={labels} values={counts} />
        </section>
      </div>

      <section className="panel">
        <h2>Latest sessions</h2>
        {rows.length === 0 ? <div className="empty">No sessions yet. Enrol a phone under <Link className="lnk" href="/admin/devices">Phones</Link>, then run a session.</div> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Participant</th><th className="r">#</th><th>Started</th><th>Mode</th><th>Phone</th><th>Checks</th></tr></thead>
            <tbody>{rows.slice(0, 10).map((r) => (
              <tr key={r.id}><td><Link href={`/admin/sessions/${r.id}`}>{r.participantCode}</Link></td><td className="r">{r.sessionNo}</td><td>{fmtDateTime(r.startedAt)}</td><td>{MODE_LABEL[r.mode] ?? r.mode}</td><td>{r.deviceLabel ?? '–'}</td><td><Flags flags={r.flags} /></td></tr>
            ))}</tbody></table></div>
        )}
      </section>

      {quiet.length > 0 && (
        <section className="panel"><h2>Phones with no contact for 14 days</h2>
          <div className="table-wrap"><table><thead><tr><th>Phone</th><th>Last seen</th></tr></thead><tbody>{quiet.map((d) => <tr key={d.id}><td>{d.label}</td><td>{ago(d.lastSeenAt)}</td></tr>)}</tbody></table></div>
        </section>
      )}
    </>
  );
}
