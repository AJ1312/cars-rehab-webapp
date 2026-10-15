import Link from 'next/link';
import { requireStaff } from '@/lib/server/auth';
import { getStore } from '@/lib/server/store';
import { Flags, Pager } from '@/components/admin/Bits';
import { fmtDateTime, MODE_LABEL, n1, q1 } from '@/lib/format';

export const metadata = { title: 'Sessions' };
const PAGE = 40;

export default async function Sessions({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireStaff();
  const sp = await searchParams;
  const f = { participant: q1(sp.participant).toUpperCase().trim(), mode: q1(sp.mode), group: q1(sp.group), flagged: q1(sp.flagged), since: q1(sp.since), until: q1(sp.until) };
  const page = Math.max(1, Number(q1(sp.page)) || 1);
  const store = getStore();
  const query = { participant: f.participant || undefined, mode: f.mode || undefined, group: f.group || undefined, flaggedOnly: f.flagged === '1', since: f.since || undefined, until: f.until ? f.until + 'T23:59:59.999Z' : undefined };
  const [total, rows, settings] = await Promise.all([store.countSessions(query), store.listSessions({ ...query, limit: PAGE, offset: (page - 1) * PAGE }), store.getSettings()]);
  const keep = Object.fromEntries(Object.entries(f).filter(([, v]) => v));

  return (
    <>
      <div><h1>Sessions</h1><p className="sub">{total} session{total === 1 ? '' : 's'} match.</p></div>
      <form className="filters panel" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
        <div className="field"><label htmlFor="p">Participant</label><input id="p" name="participant" className="input" defaultValue={f.participant} /></div>
        <div className="field"><label htmlFor="m">Mode</label><select id="m" name="mode" className="input" defaultValue={f.mode}><option value="">All</option><option value="6dof">AR 6-DoF</option><option value="motion">Motion 3-DoF</option><option value="touch">Touch</option><option value="sim">Simulated</option></select></div>
        <div className="field"><label htmlFor="g">Group</label><select id="g" name="group" className="input" defaultValue={f.group}><option value="">All</option>{[...new Set([...settings.groups, 'Intervention', 'Control', 'Pilot', 'Other'])].map((g) => <option key={g}>{g}</option>)}</select></div>
        <div className="field"><label htmlFor="s">From</label><input id="s" type="date" name="since" className="input" defaultValue={f.since} /></div>
        <div className="field"><label htmlFor="u">To</label><input id="u" type="date" name="until" className="input" defaultValue={f.until} /></div>
        <label className="check" style={{ minHeight: 46 }}><input type="checkbox" name="flagged" value="1" defaultChecked={f.flagged === '1'} /> Flagged only</label>
        <button className="btn primary sm">Apply</button>
      </form>
      {rows.length === 0 ? <div className="empty">No sessions match.</div> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Participant</th><th className="r">#</th><th>Started</th><th>Mode</th><th>Group</th><th className="r">Level</th><th className="r">Items</th><th className="r">Tracking %</th><th>Phone</th><th>Checks</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}><td><Link href={`/admin/sessions/${r.id}`}>{r.participantCode}</Link></td><td className="r">{r.sessionNo}</td><td>{fmtDateTime(r.startedAt)}</td><td>{MODE_LABEL[r.mode] ?? r.mode}</td><td>{r.group ?? '–'}</td><td className="r">{r.level}</td><td className="r">{r.summary.items}</td><td className="r">{n1(r.summary.validPctMean, 0)}</td><td>{r.deviceLabel ?? '–'}</td><td><Flags flags={r.flags} /></td></tr>
          ))}</tbody></table></div>
      )}
      <Pager base="/admin/sessions" page={page} pages={Math.ceil(total / PAGE)} params={keep} />
    </>
  );
}
