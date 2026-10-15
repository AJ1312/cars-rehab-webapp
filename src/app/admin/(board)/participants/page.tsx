import Link from 'next/link';
import { requireStaff } from '@/lib/server/auth';
import { getStore } from '@/lib/server/store';
import { Spark } from '@/components/admin/charts';
import { fmtDate, MODE_LABEL, q1 } from '@/lib/format';

export const metadata = { title: 'Participants' };

export default async function Participants({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireStaff();
  const sp = await searchParams; const q = q1(sp.q).toUpperCase().trim();
  const rows = await getStore().listSessions({ limit: 5000 });
  const by = new Map<string, typeof rows>();
  for (const r of rows) { if (q && !r.participantCode.includes(q)) continue; (by.get(r.participantCode) ?? by.set(r.participantCode, []).get(r.participantCode)!).push(r); }
  const list = [...by.entries()].map(([code, s]) => {
    const asc = s.slice().sort((a, b) => a.sessionNo - b.sessionNo || a.startedAt.localeCompare(b.startedAt));
    return { code, s: asc, last: asc[asc.length - 1], modes: [...new Set(asc.map((x) => MODE_LABEL[x.mode] ?? x.mode))], flagged: asc.filter((x) => x.flags.length).length };
  }).sort((a, b) => b.last.startedAt.localeCompare(a.last.startedAt));

  return (
    <>
      <div><h1>Participants</h1><p className="sub">{list.length} participant{list.length === 1 ? '' : 's'}. A participant appears when their first session uploads.</p></div>
      <form className="filters" role="search"><div className="field"><label htmlFor="q">Find a participant</label><input id="q" name="q" className="input" defaultValue={q} placeholder="e.g. P001" /></div><button className="btn primary sm">Search</button></form>
      {list.length === 0 ? <div className="empty">No participants found.</div> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Participant</th><th>Group</th><th className="r">Sessions</th><th>First</th><th>Last</th><th>Triangle trend</th><th>Maths trend</th><th>Colour trend</th><th>Tracking</th><th className="r">Flagged</th></tr></thead>
          <tbody>{list.map((p) => (
            <tr key={p.code}>
              <td><Link href={`/admin/participants/${p.code}`}>{p.code}</Link></td><td>{p.last.group ?? '–'}</td><td className="r">{p.s.length}</td>
              <td>{fmtDate(p.s[0].startedAt)}</td><td>{fmtDate(p.last.startedAt)}</td>
              <td><Spark values={p.s.map((x) => x.summary.games.triangle?.scoreMean ?? null)} color="var(--c1)" /></td>
              <td><Spark values={p.s.map((x) => x.summary.games.maths?.scoreMean ?? null)} color="var(--c2)" /></td>
              <td><Spark values={p.s.map((x) => x.summary.games.colour?.scoreMean ?? null)} color="var(--c3)" /></td>
              <td>{p.modes.join(', ')}</td><td className="r">{p.flagged || '–'}</td>
            </tr>
          ))}</tbody></table></div>
      )}
    </>
  );
}
