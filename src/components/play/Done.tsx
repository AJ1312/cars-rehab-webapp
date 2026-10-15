'use client';
import { useCallback, useEffect, useState } from 'react';
import { Brand } from '@/components/ui/Brand';
import { allSessions, buildEventsCsv, buildSessionXlsx, saveBlob, syncAll, type StoredSession } from '@/lib/client/local';

/* eslint-disable @typescript-eslint/no-explicit-any */
export function Done({ id, load, onNew, onHistory }: { id: string; load: (id: string) => Promise<StoredSession | undefined>; onNew: (code?: string) => void; onHistory: () => void }) {
  const [s, setS] = useState<StoredSession | null | undefined>(undefined);
  const [games, setGames] = useState<any[]>([]);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => { setS((await load(id)) ?? null); }, [id, load]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!s || s.state === 'uploaded') return;
    const iv = window.setInterval(() => { void refresh(); }, 2500);
    return () => window.clearInterval(iv);
  }, [s, refresh]);
  useEffect(() => {
    if (!s) return;
    (async () => {
      const core = (await import('@/lib/core')).default;
      setGames(core.summarizeGames(s.record));
      setFileName(core.sessionFileName(s.record, 'xlsx'));
    })();
  }, [s]);

  async function download(kind: 'xlsx' | 'csv') {
    if (!s) return;
    setBusy(kind); setMsg(null);
    try {
      const f = kind === 'xlsx' ? await buildSessionXlsx(s, await allSessions()) : await buildEventsCsv(s);
      saveBlob(f.name, f.blob);
    } catch { setMsg('Could not build the file on this phone. Try again, or download it from the admin board.'); }
    setBusy(null);
  }
  async function retry() { setBusy('sync'); await syncAll(); await refresh(); setBusy(null); }

  if (s === undefined) return <main className="wrap"><p className="muted">Loading…</p></main>;
  if (s === null) return <main className="wrap"><p>This session is no longer stored on this phone.</p><button className="btn" onClick={() => onNew()}>Back</button></main>;
  const r = s.record;
  const flags: string[] = [];
  if (r.mode === 'motion') flags.push('Motion tracking was used: reach is in degrees, not centimetres, and the session is flagged in the study data.');
  if (r.mode === 'touch' || r.mode === 'sim') flags.push('Touch/simulated input: no hand movement was measured. Exclude this session from movement analysis.');
  if (r.calibration?.override) flags.push('Calibration was overridden after a failed check.');
  if (!r.complete) flags.push('The session ended early.');

  const status = s.state === 'uploaded' ? { cls: 'ok', t: 'Uploaded to the study' } : s.state === 'rejected' ? { cls: 'bad', t: 'Upload rejected' } : { cls: 'warn', t: 'Saved on this phone · waiting to upload' };

  return (
    <main className="wrap">
      <div className="topbar"><Brand small /><span className={'chip ' + status.cls} role="status">{status.t}</span></div>
      <section className="hero">
        <h1>Session {r.sessionNo} saved</h1>
        <p>{r.participantId} · {new Date(r.startedAt).toLocaleString()} · {r.complete ? 'complete' : 'ended early'}</p>
      </section>

      {s.state === 'rejected' && <p className="notice" role="alert">The server did not accept this session: {s.lastError}. The data is safe on this phone, and you can still download it below.</p>}
      {s.state === 'pending' && <p className="notice">No problem if there is no signal. It uploads by itself when the phone is online.{s.lastError ? ` Last attempt: ${s.lastError}.` : ''} <button className="back" onClick={retry} disabled={busy === 'sync'}>{busy === 'sync' ? 'Trying…' : 'Try now'}</button></p>}
      {flags.map((f) => <p key={f} className="notice">{f}</p>)}

      <div className="stat-grid">
        {games.map((g) => (
          <div className="game-card" key={g.game}>
            <h3>{g.game}</h3>
            <div className="big num">{g.score_mean ?? '–'}<span className="muted small"> avg score</span></div>
            <div className="kv num">
              <span>Best trial</span><span>{g.score_best}</span>
              <span>Accuracy</span><span>{g.accuracy_pct == null ? '–' : g.accuracy_pct + '%'}</span>
              <span>Reaction</span><span>{g.rt_mean_ms == null ? '–' : (g.rt_mean_ms / 1000).toFixed(2) + ' s'}</span>
              {g.stroop_interference_ms != null && <><span>Interference</span><span>{g.stroop_interference_ms} ms</span></>}
            </div>
          </div>
        ))}
      </div>

      <div className="file-card">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M6 2h8l5 5v15H6z" /><path d="M14 2v5h5M9 13h6M9 17h6" /></svg>
        <div><div className="name">{fileName}</div><div className="small muted">Data sheet: 9 tabs, every trial, touch and movement sample</div></div>
      </div>
      <div className="btn-row">
        <button className="btn primary" onClick={() => download('xlsx')} disabled={!!busy}>{busy === 'xlsx' ? 'Preparing…' : 'Download Excel data sheet'}</button>
        <button className="btn" onClick={() => download('csv')} disabled={!!busy}>Events CSV</button>
      </div>
      {msg && <p className="error-msg" role="alert">{msg}</p>}

      <div className="btn-row">
        <button className="btn" onClick={() => onNew(r.participantId)}>Next session, same participant</button>
        <button className="btn" onClick={() => onNew()}>New participant</button>
        <button className="btn ghost" onClick={onHistory}>Sessions on this phone</button>
      </div>
    </main>
  );
}
