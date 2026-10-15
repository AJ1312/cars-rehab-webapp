'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Brand } from '@/components/ui/Brand';
import { GameGlyph } from '@/components/ui/Glyphs';
import { allSessions, buildEventsCsv, buildSessionXlsx, saveBlob, syncAll, type StoredSession } from '@/lib/client/local';
import type { GameKey } from '@/lib/client/engine';

/* eslint-disable @typescript-eslint/no-explicit-any */
const TABS: [string, string][] = [
  ['Session', 'who, when, settings, calibration, tracking mode'],
  ['Trial_Summary', 'one row per trial: score, accuracy, reaction, movement time, path, range of motion'],
  ['Game_Summary', 'one row per game, with the Colour Merge interference score'],
  ['Events', 'one row per item: target position, answer, reach metrics'],
  ['Kinematics', 'hand position every 50 ms'],
  ['Sensor_Quality', 'calibration, dropouts, sample rate'],
  ['Questionnaire', 'Q1 to Q7 and comments'],
  ['Progress', 'this participant across sessions'],
  ['Data_Dictionary', 'every column explained, with units']
];
const KEY_OF: Record<string, GameKey> = { 'Triangle Reach': 'triangle', 'Maths Fun': 'maths', 'Colour Merge Test': 'colour' };
const isIos = () => typeof navigator !== 'undefined' && (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

export function Done({ id, load, onNew, onHistory, onHome }: { id: string; load: (id: string) => Promise<StoredSession | undefined>; onNew: (code?: string) => void; onHistory: () => void; onHome: () => void }) {
  const [s, setS] = useState<StoredSession | null | undefined>(undefined);
  const [games, setGames] = useState<any[]>([]);
  const [fileName, setFileName] = useState('');
  const [played, setPlayed] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  // The workbook is built as soon as the session is on screen, so the button only has to hand the finished file over.
  // That also matters on iPhone: the share sheet must be opened inside the tap, with nothing slow awaited first.
  const [book, setBook] = useState<{ name: string; blob: Blob } | null>(null);
  const [sheet, setSheet] = useState<'preparing' | 'ready' | 'error'>('preparing');
  const latest = useRef<StoredSession | null>(null);
  const builtFor = useRef<string>('');

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
      setPlayed(core.sequenceLabel(s.record.sequence?.length ? s.record.sequence : s.record.games.flatMap((g: string) => Array(s.record.trialsPerGame).fill(g)), (g: string) => core.GAMES[g].name));
    })();
  }, [s]);

  useEffect(() => { latest.current = s ?? null; });
  const build = useCallback(async () => {
    const cur = latest.current;
    if (!cur) return;
    setSheet('preparing');
    try {
      const f = await buildSessionXlsx(cur, await allSessions());
      if (latest.current?.id !== cur.id) return;
      setBook(f); setSheet('ready');
    } catch { setBook(null); setSheet('error'); }
  }, []);
  // Build once per session. The record never changes after the game ends; only the upload state does.
  const sid = s?.id ?? '';
  useEffect(() => {
    if (!sid || builtFor.current === sid) return;
    builtFor.current = sid;
    void build();
  }, [sid, build]);

  async function download(kind: 'xlsx' | 'csv') {
    if (!s) return;
    setMsg(null);
    try {
      let f: { name: string; blob: Blob };
      if (kind === 'xlsx') {
        if (!book) { setBusy('xlsx'); await build(); setBusy(null); setMsg('The sheet was not ready. Tap the button again.'); return; }
        f = book;
      } else { setBusy('csv'); f = await buildEventsCsv(s); }
      const how = await saveBlob(f.name, f.blob, { preferShare: isIos() });
      setMsg(how === 'shared' ? 'Choose "Save to Files" to keep the sheet.' : 'Saved to your downloads.');
    } catch { setMsg('Could not save the file on this phone. Try again, or download it from the admin board.'); }
    setBusy(null);
  }
  async function retry() { setBusy('sync'); await syncAll(); await refresh(); setBusy(null); }

  if (s === undefined) return <main className="wrap"><p className="muted">Loading…</p></main>;
  if (s === null) return <main className="wrap"><p>This session is no longer stored on this phone.</p><button className="btn" onClick={() => onNew()}>Back</button></main>;
  const r = s.record;
  const flags: string[] = [];
  if (r.mode === 'motion') flags.push('Motion tracking was used: reach is in degrees, not centimetres, and the session is flagged in the study data.');
  if (r.mode === 'touch' || r.mode === 'sim') flags.push('Touch or simulated input: no hand movement was measured. Exclude this session from movement analysis.');
  if (r.calibration?.override) flags.push('Calibration was overridden after a failed check.');
  if (!r.complete) flags.push('The session ended early.');

  const status = s.state === 'uploaded' ? { cls: 'ok', t: 'Uploaded to the study' } : s.state === 'rejected' ? { cls: 'bad', t: 'Upload rejected' } : { cls: 'warn', t: 'Saved on this phone' };

  return (
    <main className="wrap">
      <div className="topbar"><Brand small /><button type="button" className="back" onClick={onHome}>Home</button></div>
      <section className="result-hero">
        <svg className="deco" viewBox="0 0 150 150" aria-hidden="true"><path d="M75 14 L30 92 L75 108 Z" fill="#FF8A00" /><path d="M75 14 L120 92 L75 108 Z" fill="#E86400" /><path d="M75 14 L120 92 L75 108 L30 92 Z" fill="none" stroke="#F6F1E7" strokeWidth="6" strokeLinejoin="round" /></svg>
        <span className="eyebrow" style={{ color: 'inherit', opacity: 0.75 }}>{r.participantId} · {new Date(r.startedAt).toLocaleDateString()}</span>
        <h1>Session {r.sessionNo} {r.complete ? 'complete' : 'saved'}</h1>
        <div className="chips"><span className={'chip ' + status.cls} role="status">{status.t}</span><span className="chip plain">{r.complete ? 'All trials played' : 'Ended early'}</span></div>
        {played && <p className="small">Played: {played}</p>}
      </section>

      {s.state === 'rejected' && <p className="notice bad" role="alert"><b>The server did not accept this session.</b> {s.lastError}. The data is safe on this phone, and you can still download it below.</p>}
      {s.state === 'pending' && <p className="notice"><b>Waiting to upload.</b> No problem without signal: it uploads by itself when the phone is online.{s.lastError ? ` Last attempt: ${s.lastError}.` : ''} <button className="back" onClick={retry} disabled={busy === 'sync'} style={{ justifySelf: 'start', padding: 0, minHeight: 0 }}>{busy === 'sync' ? 'Trying…' : 'Try now'}</button></p>}
      {flags.map((f) => <p key={f} className="notice">{f}</p>)}

      <div className="stat-grid">
        {games.map((g) => (
          <div className="game-card" key={g.game}>
            <div className="gc-head">{KEY_OF[g.game] && <GameGlyph g={KEY_OF[g.game]} className="" />}<h3>{g.game}</h3></div>
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

      <section className="panel">
        <div className="file-card">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M6 2h8l5 5v15H6z" /><path d="M14 2v5h5M9 13h6M9 17h6" /></svg>
          <div>
            <div className="name">{book?.name ?? fileName}</div>
            <div className="small muted" role="status" aria-live="polite">
              {sheet === 'preparing' ? 'Building the research data sheet…'
                : sheet === 'ready' && book ? `Research data sheet, made automatically · ${book.blob.size < 1024 * 1024 ? Math.max(1, Math.round(book.blob.size / 1024)) + ' KB' : (book.blob.size / 1048576).toFixed(1) + ' MB'}`
                : <>Could not build the sheet on this phone. <button className="back" onClick={() => void build()} style={{ padding: 0, minHeight: 0, display: 'inline' }}>Try again</button></>}
            </div>
          </div>
        </div>
        <button className="btn yellow block" onClick={() => download('xlsx')} disabled={!!busy || sheet === 'preparing'}>{sheet === 'preparing' || busy === 'xlsx' ? 'Preparing…' : isIos() ? 'Save or share the Excel sheet' : 'Download the Excel sheet'}</button>
        <button className="btn sm block" onClick={() => download('csv')} disabled={!!busy}>Events as CSV</button>
        {msg && <p className="small" role="status">{msg}</p>}
        <details className="adv"><summary>What is in the sheet</summary>
          <ul className="tabs-list" style={{ columns: 1 }}>{TABS.map(([t, d]) => <li key={t}><b>{t}</b>: {d}</li>)}</ul>
        </details>
      </section>

      <div className="btn-row">
        <button className="btn primary" onClick={() => onNew(r.participantId)}>Next session, same participant</button>
        <button className="btn" onClick={() => onNew()}>New participant</button>
      </div>
      <div className="btn-row"><button className="btn ghost" onClick={onHistory}>Sessions on this phone</button><button className="btn ghost" onClick={onHome}>Home</button></div>
    </main>
  );
}
