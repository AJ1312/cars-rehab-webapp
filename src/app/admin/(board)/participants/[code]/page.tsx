import Link from 'next/link';
import { notFound } from 'next/navigation';
import { atLeast, requireStaff } from '@/lib/server/auth';
import { getStore } from '@/lib/server/store';
import { participantCode } from '@/lib/schema';
import { LineChart } from '@/components/admin/charts';
import { Flags } from '@/components/admin/Bits';
import { fmtDateTime, MODE_LABEL, n1 } from '@/lib/format';

export default async function ParticipantPage({ params }: { params: Promise<{ code: string }> }) {
  const staff = await requireStaff();
  const p = participantCode.safeParse((await params).code);
  if (!p.success) notFound();
  const rows = (await getStore().listSessions({ participant: p.data, limit: 1000 })).sort((a, b) => a.sessionNo - b.sessionNo || a.startedAt.localeCompare(b.startedAt));
  if (!rows.length) notFound();
  const labels = rows.map((r) => 'S' + r.sessionNo);
  const g = (k: 'triangle' | 'maths' | 'colour') => rows.map((r) => r.summary.games[k]?.scoreMean ?? null);
  const acc = (k: 'maths' | 'colour') => rows.map((r) => r.summary.games[k]?.accuracyPct ?? null);
  const stroop = rows.map((r) => r.summary.games.colour?.stroopInterferenceMs ?? null);
  const last = rows[rows.length - 1];

  return (
    <>
      <div><p className="eyebrow"><Link className="lnk" href="/admin/participants">Participants</Link></p><h1>{p.data}</h1>
        <p className="sub">{rows.length} session{rows.length > 1 ? 's' : ''} · group {last.group ?? '–'} · last {fmtDateTime(last.startedAt)}</p></div>
      {atLeast(staff, 'researcher') && <div className="btn-row" style={{ maxWidth: 520 }}><a className="btn primary" href={`/api/export/participant/${p.data}`}>Download all sessions (Excel)</a></div>}

      <div className="cols">
        <section className="panel"><h2>Score progress</h2><LineChart labels={labels} series={[{ name: 'Triangle Reach', color: 'var(--c1)', points: g('triangle') }, { name: 'Maths Fun', color: 'var(--c2)', points: g('maths') }, { name: 'Colour Merge Test', color: 'var(--c3)', points: g('colour') }]} yLabel="mean score per trial" /></section>
        <section className="panel"><h2>Accuracy</h2><LineChart labels={labels} series={[{ name: 'Maths Fun', color: 'var(--c2)', points: acc('maths') }, { name: 'Colour Merge Test', color: 'var(--c3)', points: acc('colour') }]} yLabel="% correct" /></section>
        <section className="panel"><h2>Stroop interference</h2><LineChart labels={labels} series={[{ name: 'Incongruent − congruent', color: 'var(--c3)', points: stroop }]} yLabel="milliseconds" /></section>
      </div>

      <section className="panel"><h2>Sessions</h2>
        <div className="table-wrap"><table>
          <thead><tr><th className="r">#</th><th>Started</th><th>Mode</th><th className="r">Level</th><th className="r">Triangle</th><th className="r">Maths</th><th className="r">Colour</th><th className="r">Tracking %</th><th>Checks</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}><td className="r"><Link href={`/admin/sessions/${r.id}`}>{r.sessionNo}</Link></td><td>{fmtDateTime(r.startedAt)}</td><td>{MODE_LABEL[r.mode] ?? r.mode}</td><td className="r">{r.level}</td>
              <td className="r">{n1(r.summary.games.triangle?.scoreMean)}</td><td className="r">{n1(r.summary.games.maths?.scoreMean)}</td><td className="r">{n1(r.summary.games.colour?.scoreMean)}</td>
              <td className="r">{n1(r.summary.validPctMean, 0)}</td><td><Flags flags={r.flags} /></td></tr>
          ))}</tbody></table></div>
      </section>
    </>
  );
}
