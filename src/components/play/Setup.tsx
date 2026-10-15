'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Brand } from '@/components/ui/Brand';
import { detectCapabilities, MODE_INFO, type Capabilities, type Mode } from '@/lib/client/sensors';
import type { GameKey, SessionConfig } from '@/lib/client/engine';
import { allSessions, getDevice, getPrefs, getRecent, getSettings, nextSessionNo, pushRecent, refreshConfig, setPrefs, syncAll } from '@/lib/client/local';
import { GAME_KEYS, HAND_MODES, SIDES, participantCode } from '@/lib/schema';

const GAME_LABEL: Record<GameKey, string> = { triangle: 'Triangle Reach', maths: 'Maths Fun', colour: 'Colour Merge Test' };
const SIDE_LABEL: Record<string, string> = { Left: 'Left', Right: 'Right', Both: 'Both', 'Not applicable': 'N/A' };
const LEVEL_LABEL = ['', 'Level 1 · 20 cm', 'Level 2 · 30 cm', 'Level 3 · 40 cm'];

interface Prefs { therapist: string; group: string; side: string; handMode: string; level: number; games: GameKey[]; camera: boolean }

function Seg<T extends string | number>({ name, value, options, onChange, label }: { name: string; value: T; options: { v: T; t: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="field" role="radiogroup" aria-label={label}>
      <span className="label">{label}</span>
      <div className="seg" style={{ gridAutoFlow: options.length > 3 ? 'row' : 'column', gridTemplateColumns: options.length > 3 ? 'repeat(2, 1fr)' : undefined }}>
        {options.map((o) => (
          <span key={String(o.v)} style={{ display: 'contents' }}>
            <input type="radio" name={name} id={`${name}-${o.v}`} checked={value === o.v} onChange={() => onChange(o.v)} />
            <label htmlFor={`${name}-${o.v}`}>{o.t}</label>
          </span>
        ))}
      </div>
    </div>
  );
}

export function Setup({ onStart, onHistory, initialCode }: { onStart: (cfg: SessionConfig) => void; onHistory: () => void; initialCode?: string }) {
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [device, setDeviceState] = useState<{ label: string } | null>(null);
  const [pending, setPending] = useState(0);
  const [revoked, setRevoked] = useState(false);
  const settings = useMemo(() => getSettings(), []);
  const [code, setCode] = useState(initialCode || '');
  const [sessionNo, setSessionNo] = useState<number | null>(null);
  const [p, setP] = useState<Prefs>({ therapist: '', group: settings.groups[0], side: 'Right', handMode: HAND_MODES[0], level: settings.level, games: [...GAME_KEYS], camera: false });
  const [mode, setMode] = useState<Mode>('touch');
  const [adv, setAdv] = useState({ trialsPerGame: settings.trialsPerGame, trialSec: settings.trialSec, dwellMs: settings.dwellMs, itemTimeoutSec: settings.itemTimeoutSec, skipRange: false });
  const [err, setErr] = useState<string | null>(null);
  const [sim, setSim] = useState(false);

  useEffect(() => {
    const saved = getPrefs<Prefs>(); if (saved) setP((x) => ({ ...x, ...saved, group: settings.groups.includes(saved.group) ? saved.group : settings.groups[0] }));
    setDeviceState(getDevice());
    setSim(new URLSearchParams(location.search).get('sim') === '1');
    detectCapabilities().then((c) => {
      setCaps(c);
      setMode(new URLSearchParams(location.search).get('sim') === '1' ? 'sim' : c.xr ? '6dof' : c.motion ? 'motion' : 'touch');
    });
    void allSessions().then((s) => setPending(s.filter((x) => x.state === 'pending').length));
    if (getDevice()) void refreshConfig().then((r) => setRevoked(r === 'revoked'));
    void syncAll().then((r) => { setPending(r.pending); if (r.revoked) setRevoked(true); });
  }, [settings.groups]);

  const parsed = participantCode.safeParse(code);
  useEffect(() => {
    if (!parsed.success) { setSessionNo(null); return; }
    let live = true;
    nextSessionNo(parsed.data).then((n) => { if (live) setSessionNo(n); });
    return () => { live = false; };
  }, [parsed.success, parsed.success ? parsed.data : '']);   // eslint-disable-line react-hooks/exhaustive-deps

  const avail = (m: Mode) => (m === '6dof' ? !!caps?.xr : m === 'motion' ? !!caps?.motion : true);
  const modes: Mode[] = sim ? ['sim', '6dof', 'motion', 'touch'] : ['6dof', 'motion', 'touch'];

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!parsed.success) { setErr(parsed.error.issues[0].message); return; }
    if (!p.games.length) { setErr('Choose at least one game.'); return; }
    if (!avail(mode)) { setErr('That tracking mode is not available on this phone.'); return; }
    setErr(null);
    pushRecent(parsed.data); setPrefs(p);
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    onStart({
      participantId: parsed.data, sessionNo: sessionNo ?? 1, group: p.group, therapist: p.therapist.trim().toUpperCase().slice(0, 10), affectedSide: p.side, handMode: p.handMode,
      mode, level: p.level as 1 | 2 | 3, games: GAME_KEYS.filter((g) => p.games.includes(g)), trialsPerGame: adv.trialsPerGame, trialSec: adv.trialSec, dwellMs: adv.dwellMs,
      itemTimeoutSec: adv.itemTimeoutSec, camera: p.camera ? 'on' : 'off', device: `${navigator.userAgent.slice(0, 180)} | ${screen.width}x${screen.height}@${window.devicePixelRatio}`, seed, skipRange: adv.skipRange
    });
  }

  const num = (k: keyof typeof adv, min: number, max: number) => (e: React.ChangeEvent<HTMLInputElement>) => setAdv((a) => ({ ...a, [k]: Math.max(min, Math.min(max, Math.round(+e.target.value || min))) }));

  return (
    <main className="wrap">
      <div className="topbar">
        <Brand />
        <div className="chips">
          {device && !revoked ? <span className="chip ok">{device.label}</span> : revoked ? <span className="chip bad">Phone revoked</span> : <span className="chip warn">Not enrolled</span>}
        </div>
      </div>

      <section className="hero">
        <h1>New session</h1>
        <p>Calibrate, play three short games, answer a few questions. The data sheet is made automatically at the end.</p>
      </section>

      {revoked && <p className="notice" role="alert">This phone was removed from the study. Ask the study team for a new enrolment QR code. Data already on the phone is kept.</p>}
      {!device && !revoked && (
        <p className="notice">This phone is <b>not enrolled</b>, so sessions stay on this phone only. <Link href="/enrol" style={{ color: 'var(--accent)', fontWeight: 700 }}>Enrol with a QR code</Link> to upload automatically.</p>
      )}
      {caps && !caps.secure && <p className="notice" role="alert">This page is not using HTTPS, so AR and motion sensors are blocked by the browser.</p>}
      {pending > 0 && (
        <p className="notice">{pending} session{pending > 1 ? 's' : ''} waiting to upload. <button type="button" className="back" onClick={onHistory}>View</button></p>
      )}

      <form className="form panel" onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="pid">Participant ID</label>
          <input id="pid" className="input" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} list="recent" autoComplete="off" autoCapitalize="characters" spellCheck={false} inputMode="text"
            placeholder="e.g. P001" aria-invalid={!!code && !parsed.success} aria-describedby="pid-hint" maxLength={20} required />
          <datalist id="recent">{getRecent().map((c) => <option key={c} value={c} />)}</datalist>
          <span id="pid-hint" className="hint">{parsed.success ? (sessionNo ? `This will be session ${sessionNo}.` : 'Checking…') : 'Use the study code, never a name.'}</span>
        </div>

        <div className="grid2">
          <Seg name="group" label="Group" value={p.group} options={settings.groups.map((g) => ({ v: g, t: g }))} onChange={(v) => setP({ ...p, group: v })} />
          <div className="field">
            <label htmlFor="th">Therapist initials</label>
            <input id="th" className="input" value={p.therapist} onChange={(e) => setP({ ...p, therapist: e.target.value.toUpperCase() })} maxLength={6} autoCapitalize="characters" autoComplete="off" placeholder="e.g. AB" />
          </div>
        </div>

        <Seg name="side" label="Affected side" value={p.side} options={SIDES.map((s) => ({ v: s, t: SIDE_LABEL[s] }))} onChange={(v) => setP({ ...p, side: v })} />
        <Seg name="hand" label="Hand use" value={p.handMode} options={HAND_MODES.map((s) => ({ v: s, t: s === HAND_MODES[0] ? 'Affected hand alone' : 'Assisted by other hand' }))} onChange={(v) => setP({ ...p, handMode: v })} />
        <Seg name="level" label="Reach distance" value={p.level} options={[1, 2, 3].map((l) => ({ v: l, t: LEVEL_LABEL[l] }))} onChange={(v) => setP({ ...p, level: v })} />

        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="label" style={{ padding: 0, marginBottom: 6 }}>Games</legend>
          <div className="checks">
            {GAME_KEYS.map((g) => (
              <label key={g} className="check">
                <input type="checkbox" checked={p.games.includes(g)} onChange={(e) => setP({ ...p, games: e.target.checked ? [...p.games, g] : p.games.filter((x) => x !== g) })} />
                {GAME_LABEL[g]}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="field">
          <span className="label">Tracking</span>
          <div className="modes">
            {modes.map((m) => {
              const ok = avail(m); const best = m === '6dof' && ok;
              return (
                <div key={m} className={'mode' + (mode === m ? ' best' : '')} aria-disabled={!ok}>
                  <h3>{MODE_INFO[m].title}</h3>
                  <span className={'chip ' + (ok ? (m === '6dof' ? 'ok' : 'warn') : 'bad')}>{!caps ? 'Checking…' : ok ? (best ? 'Research-grade' : m === 'motion' ? 'Flagged in data' : 'Practice only') : 'Not available here'}</span>
                  <p>{MODE_INFO[m].detail}</p>
                  <button type="button" className={'btn' + (mode === m ? ' primary' : '')} disabled={!ok} aria-pressed={mode === m} onClick={() => setMode(m)}>{mode === m ? 'Selected' : 'Use'}</button>
                </div>
              );
            })}
          </div>
        </div>

        <details className="adv">
          <summary>More settings</summary>
          <div className="form" style={{ paddingTop: 12 }}>
            <div className="grid2">
              <div className="field"><label htmlFor="tpg">Trials per game</label><input id="tpg" className="input" type="number" inputMode="numeric" min={1} max={20} value={adv.trialsPerGame} onChange={num('trialsPerGame', 1, 20)} /></div>
              <div className="field"><label htmlFor="ts">Trial length (seconds)</label><input id="ts" className="input" type="number" inputMode="numeric" min={10} max={300} value={adv.trialSec} onChange={num('trialSec', 10, 300)} /></div>
              <div className="field"><label htmlFor="dw">Hold time to touch (ms)</label><input id="dw" className="input" type="number" inputMode="numeric" min={100} max={1500} step={50} value={adv.dwellMs} onChange={num('dwellMs', 100, 1500)} /></div>
              <div className="field"><label htmlFor="it">Time limit per item (s)</label><input id="it" className="input" type="number" inputMode="numeric" min={3} max={60} value={adv.itemTimeoutSec} onChange={num('itemTimeoutSec', 3, 60)} /></div>
            </div>
            <label className="check"><input type="checkbox" checked={adv.skipRange} onChange={(e) => setAdv({ ...adv, skipRange: e.target.checked })} /> Skip the 4-dot range check</label>
            {mode === 'motion' && <label className="check"><input type="checkbox" checked={p.camera} onChange={(e) => setP({ ...p, camera: e.target.checked })} /> Show the camera behind the game</label>}
          </div>
        </details>

        {err && <p className="error-msg" role="alert">{err}</p>}
        <button className="btn primary block" type="submit">Start session</button>
      </form>

      <div className="btn-row">
        <button type="button" className="btn" onClick={onHistory}>Sessions on this phone</button>
        <Link className="btn" href="/admin">Admin board</Link>
      </div>
    </main>
  );
}
