import { requireStaff } from '@/lib/server/auth';
import { getStore } from '@/lib/server/store';

export const metadata = { title: 'Exports' };

export default async function Exports() {
  await requireStaff('researcher');
  const settings = await getStore().getSettings();
  const rows = await getStore().listSessions({ limit: 5000 });
  const codes = [...new Set(rows.map((r) => r.participantCode))].sort();
  return (
    <>
      <div><h1>Exports</h1><p className="sub">Every download is written to the audit log. Files contain pseudonymous participant codes only.</p></div>
      <section className="panel">
        <h2>Whole study</h2>
        <form action="/api/export/study" method="get" className="form">
          <div className="filters">
            <div className="field"><label htmlFor="f">Format</label><select id="f" name="format" className="input"><option value="xlsx">Excel workbook (7 tabs + dictionary)</option><option value="trials.csv">Trial table, one row per trial (CSV for R / SPSS / Python)</option></select></div>
            <div className="field"><label htmlFor="g">Group</label><select id="g" name="group" className="input"><option value="">All groups</option>{settings.groups.map((g) => <option key={g}>{g}</option>)}</select></div>
            <div className="field"><label htmlFor="m">Tracking</label><select id="m" name="mode" className="input"><option value="">All</option><option value="6dof">AR 6-DoF only (movement analysis)</option><option value="motion">Motion 3-DoF</option></select></div>
            <div className="field"><label htmlFor="s">From</label><input id="s" type="date" name="since" className="input" /></div>
            <div className="field"><label htmlFor="u">To</label><input id="u" type="date" name="until" className="input" /></div>
          </div>
          <button className="btn primary">Download</button>
        </form>
        <p className="small muted">The Excel workbook holds Sessions, Progress, Trial_Summary, Game_Summary, Events, Sensor_Quality, Questionnaire and Data_Dictionary. The 20 Hz movement samples are in each session’s own workbook because they are large.</p>
      </section>
      <div className="cols">
        <section className="panel"><h2>One participant</h2>
          <p className="muted small">All sessions for one participant in a single workbook. Tap a code:</p>
          <div className="chips">{codes.slice(0, 40).map((c) => <a key={c} className="chip" href={`/api/export/participant/${c}`}>{c}</a>)}{codes.length === 0 && <span className="muted">No participants yet.</span>}</div>
        </section>
        <section className="panel"><h2>Data dictionary</h2>
          <p className="muted">Every column in every sheet: name, unit, and exactly how it is calculated.</p>
          <a className="btn" href="/api/export/dictionary">Download dictionary (CSV)</a>
        </section>
      </div>
    </>
  );
}
