'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Brand } from '@/components/ui/Brand';
import { GameGlyph, LevelGlyph, Tick } from '@/components/ui/Glyphs';
import core from '@/lib/core';
import { detectCapabilities, MODE_INFO, type Capabilities, type Mode } from '@/lib/client/sensors';
import type { GameKey, SessionConfig } from '@/lib/client/engine';
import { allSessions, getDevice, getPrefs, getRecent, getSettings, nextSessionNo, pushRecent, refreshConfig, setPrefs, syncAll } from '@/lib/client/local';
import { GAME_KEYS, HAND_MODES, SIDES, participantCode } from '@/lib/schema';

const GAME_INFO: Record<GameKey, { name: string; blurb: string }> = {
  triangle: { name: 'Triangle Reach', blurb: 'Touch triangles floating around you. Each one is somewhere new, so the arm travels in every direction.' },
  maths: { name: 'Maths Fun', blurb: 'Add or subtract, then touch the answer. Every number is from 1 to 10.' },
  colour: { name: 'Colour Merge Test', blurb: 'Touch the word whose ink colour matches the colour named. Ignore what the word says.' }
};
const SIDE_LABEL: Record<string, string> = { Left: 'Left', Right: 'Right', Both: 'Both', 'Not applicable': 'N/A' };
const LEVEL_CM = [0, 20, 30, 40];

interface Prefs { therapist: string; group: string; side: string; handMode: string; level: number; games: GameKey[]; camera: boolean; shuffle: boolean; homeGate: boolean }

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
  const [step, setStep] = useState<0 | 1 | 2>(initialCode ? 1 : 0);
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [device, setDeviceState] = useState<{ label: string } | null>(null);
  const [pending, setPending] = useState(0);
  const [revoked, setRevoked] = useState(false);
  const [standalone, setStandalone] = useState(false);
  const settings = useMemo(() => getSettings(), []);
  const [code, setCode] = useState(initialCode || '');
  const [recent, setRecent] = useState<string[]>([]);
  const [sessionNo, setSessionNo] = useState<number | null>(null);
  const [p, setP] = useState<Prefs>({ therapist: '', group: settings.groups[0], side: 'Right', handMode: HAND_MODES[0], level: settings.level, games: [...GAME_KEYS], camera: true, shuffle: false, homeGate: true });
  const [mode, setMode] = useState<Mode>('touch');
  const [auto, setAuto] = useState<Mode>('touch');
  const [adv, setAdv] = useState({ trialsPerGame: settings.trialsPerGame, trialSec: settings.trialSec, dwellMs: settings.dwellMs, itemTimeoutSec: settings.itemTimeoutSec, skipRange: false });
  const [err, setErr] = useState<string | null>(null);
  const [sim, setSim] = useState(false);
  const [change, setChange] = useState(false);

  useEffect(() => {
    const saved = getPrefs<Prefs>(); if (saved) setP((x) => ({ ...x, ...saved, group: settings.groups.includes(saved.group) ? saved.group : settings.groups[0] }));
    setDeviceState(getDevice()); setRecent(getRecent());
    const simOn = new URLSearchParams(location.search).get('sim') === '1';
    setSim(simOn);
    setStandalone(window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true);
    detectCapabilities().then((c) => {
      setCaps(c);
      const m: Mode = simOn ? 'sim' : c.xr ? '6dof' : c.motion ? 'motion' : 'touch';
      setMode(m); setAuto(m);
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
  const linear = mode === '6dof' || mode === 'sim';

  function next() {
    setErr(null);
    if (step === 0) {
      if (!parsed.success) { setErr(parsed.error.issues[0].message); return; }
      setStep(1); window.scrollTo?.(0, 0); return;
    }
    if (step === 1) {
      if (!p.games.length) { setErr('Choose at least one game.'); return; }
      setStep(2); window.scrollTo?.(0, 0); return;
    }
  }
  function back() { setErr(null); if (step > 0) { setStep((step - 1) as 0 | 1); window.scrollTo?.(0, 0); } }

  function start() {
    if (!parsed.success) { setErr(parsed.error.issues[0].message); setStep(0); return; }
    if (!p.games.length) { setErr('Choose at least one game.'); setStep(1); return; }
    if (!avail(mode)) { setErr('That tracking mode is not available on this phone.'); return; }
    setErr(null);
    pushRecent(parsed.data); setPrefs(p);
    let seed = 0;
    try { seed = crypto.getRandomValues(new Uint32Array(1))[0]; } catch { seed = Math.floor(Math.random() * 2 ** 32); }
    const chosen = GAME_KEYS.filter((g) => p.games.includes(g));
    const games = (p.shuffle ? core.makeRng(seed ^ 0x5bd1e995).shuffle(chosen) : chosen) as GameKey[];
    onStart({
      participantId: parsed.data, sessionNo: sessionNo ?? 1, group: p.group, therapist: p.therapist.trim().toUpperCase().slice(0, 10), affectedSide: p.side, handMode: p.handMode,
      mode, level: p.level as 1 | 2 | 3, games, trialsPerGame: adv.trialsPerGame, trialSec: adv.trialSec, dwellMs: adv.dwellMs,
      itemTimeoutSec: adv.itemTimeoutSec, camera: p.camera || mode === '6dof' ? 'on' : 'off', homeGate: p.homeGate,
      device: `${navigator.userAgent.slice(0, 180)} | ${screen.width}x${screen.height}@${window.devicePixelRatio}`, seed, skipRange: adv.skipRange
    });
  }

  const num = (k: keyof typeof adv, min: number, max: number) => (e: React.ChangeEvent<HTMLInputElement>) => setAdv((a) => ({ ...a, [k]: Math.max(min, Math.min(max, Math.round(+e.target.value || min))) }));
  const toggleGame = (g: GameKey) => setP((x) => ({ ...x, games: x.games.includes(g) ? x.games.filter((y) => y !== g) : [...x.games, g] }));

  return (
    <main className="wrap has-dock">
      <div className="topbar">
        <Brand />
        {device && !revoked ? <span className="chip ok">{device.label}</span> : revoked ? <span className="chip bad">Phone removed</span> : <span className="chip warn">Not enrolled</span>}
      </div>

      <div className="progress" role="progressbar" aria-valuemin={1} aria-valuemax={3} aria-valuenow={step + 1} aria-label={`Step ${step + 1} of 3`}>
        {[0, 1, 2].map((i) => <i key={i} className={i <= step ? 'on' : ''} />)}
      </div>

      {step === 0 && (
        <>
          <div className="step-title"><span className="eyebrow">Step 1 of 3</span><h1>Who is playing?</h1></div>
          {revoked && <p className="notice bad" role="alert"><b>This phone was removed from the study.</b> Ask the study team for a new enrolment QR code. Data already on the phone is kept.</p>}
          {pending > 0 && <p className="notice"><b>{pending} session{pending > 1 ? 's' : ''} waiting to upload.</b> They upload by themselves when the phone is online. <button type="button" className="back" onClick={onHistory} style={{ justifySelf: 'start', padding: 0, minHeight: 0 }}>View them</button></p>}
          {!device && !revoked && (
            <p className="notice"><b>This phone is not enrolled.</b> Sessions stay on this phone until you <Link href="/enrol" style={{ color: 'var(--accent)', fontWeight: 700 }}>enrol it with a QR code</Link>.{standalone ? ' Enrol inside this app: a home-screen app keeps its own storage.' : ''}</p>
          )}
          <div className="panel form">
            <div className="field">
              <label htmlFor="pid">Participant ID</label>
              <input id="pid" className="input big" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} autoComplete="off" autoCapitalize="characters" spellCheck={false} inputMode="text"
                placeholder="P001" aria-invalid={!!code && !parsed.success} aria-describedby="pid-hint" maxLength={20} />
              <span id="pid-hint" className="hint">{parsed.success ? (sessionNo ? `This will be session ${sessionNo} for ${parsed.data}.` : 'Checking…') : 'Use the study code, never a name.'}</span>
            </div>
            {recent.length > 0 && (
              <div className="field"><span className="label">Recent</span>
                <div className="recent">{recent.slice(0, 8).map((c) => <button key={c} type="button" className="pick" aria-pressed={code === c} onClick={() => setCode(c)}>{c}</button>)}</div>
              </div>
            )}
            <div className="grid2">
              <Seg name="group" label="Group" value={p.group} options={settings.groups.map((g) => ({ v: g, t: g }))} onChange={(v) => setP({ ...p, group: v })} />
              <div className="field">
                <label htmlFor="th">Therapist initials</label>
                <input id="th" className="input" value={p.therapist} onChange={(e) => setP({ ...p, therapist: e.target.value.toUpperCase() })} maxLength={6} autoCapitalize="characters" autoComplete="off" placeholder="AB" />
              </div>
            </div>
          </div>
          <div className="btn-row">
            <button type="button" className="btn sm" onClick={onHistory}>Sessions on this phone</button>
            <Link className="btn sm" href="/admin">Admin board</Link>
          </div>
        </>
      )}

      {step === 1 && (
        <>
          <div className="step-title"><span className="eyebrow">Step 2 of 3 · {parsed.success ? parsed.data : ''}</span><h1>Set up the session</h1></div>
          <div className="panel form">
            <Seg name="side" label="Affected side" value={p.side} options={SIDES.map((s) => ({ v: s, t: SIDE_LABEL[s] }))} onChange={(v) => setP({ ...p, side: v })} />
            <Seg name="hand" label="Hand use" value={p.handMode} options={HAND_MODES.map((s) => ({ v: s, t: s === HAND_MODES[0] ? 'Affected hand alone' : 'Assisted by other hand' }))} onChange={(v) => setP({ ...p, handMode: v })} />
          </div>

          <div className="field" role="radiogroup" aria-label="Reach distance">
            <span className="label" style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>How far to reach</span>
            <div className="levels">
              {([1, 2, 3] as const).map((l) => (
                <button key={l} type="button" role="radio" aria-checked={p.level === l} className="level" onClick={() => setP({ ...p, level: l })}>
                  <LevelGlyph n={l} /><b>Level {l}</b><span>{LEVEL_CM[l]} cm{linear ? '' : ` · ${LEVEL_CM[l]}°`}</span>
                </button>
              ))}
            </div>
            <span className="hint">Targets float up to this far from the starting point, left and right, high and low, near and far.</span>
          </div>

          <div className="field"><span className="label" style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>Games</span>
            <div className="tiles">
              {GAME_KEYS.map((g) => (
                <button key={g} type="button" className="tile" aria-pressed={p.games.includes(g)} onClick={() => toggleGame(g)}>
                  <GameGlyph g={g} />
                  <span><b>{GAME_INFO[g].name}</b><span className="d">{GAME_INFO[g].blurb}</span></span>
                  <span className="tick"><Tick /></span>
                </button>
              ))}
            </div>
          </div>
          <label className="check"><input type="checkbox" checked={p.shuffle} onChange={(e) => setP({ ...p, shuffle: e.target.checked })} /><span>Random game order<small>Shuffle the order of the games each session. Off keeps Triangle, Maths, Colour.</small></span></label>

          <details className="adv">
            <summary>More settings</summary>
            <div className="form" style={{ paddingTop: 12 }}>
              <div className="grid2">
                <div className="field"><label htmlFor="tpg">Trials per game</label><input id="tpg" className="input" type="number" inputMode="numeric" min={1} max={20} value={adv.trialsPerGame} onChange={num('trialsPerGame', 1, 20)} /></div>
                <div className="field"><label htmlFor="ts">Trial length (seconds)</label><input id="ts" className="input" type="number" inputMode="numeric" min={10} max={300} value={adv.trialSec} onChange={num('trialSec', 10, 300)} /></div>
                <div className="field"><label htmlFor="dw">Hold to touch (ms)</label><input id="dw" className="input" type="number" inputMode="numeric" min={100} max={1500} step={50} value={adv.dwellMs} onChange={num('dwellMs', 100, 1500)} /></div>
                <div className="field"><label htmlFor="it">Time per item (s)</label><input id="it" className="input" type="number" inputMode="numeric" min={3} max={60} value={adv.itemTimeoutSec} onChange={num('itemTimeoutSec', 3, 60)} /></div>
              </div>
              <label className="check"><input type="checkbox" checked={p.homeGate} onChange={(e) => setP({ ...p, homeGate: e.target.checked })} /><span>Return to the centre ring between targets<small>Makes every reach start from the same place, so reach distances are comparable. Recommended.</small></span></label>
              <label className="check"><input type="checkbox" checked={adv.skipRange} onChange={(e) => setAdv({ ...adv, skipRange: e.target.checked })} /><span>Skip the 4-point range check</span></label>
            </div>
          </details>
        </>
      )}

      {step === 2 && (
        <>
          <div className="step-title"><span className="eyebrow">Step 3 of 3</span><h1>Ready?</h1></div>
          <div className="panel">
            <div className="summary">
              <div><span>Participant</span><b>{parsed.success ? parsed.data : '–'} · session {sessionNo ?? '…'}</b></div>
              <div><span>Group · side</span><b>{p.group} · {SIDE_LABEL[p.side]}</b></div>
              <div><span>Reach</span><b>Level {p.level} · {LEVEL_CM[p.level]} cm</b></div>
              <div><span>Games</span><b>{GAME_KEYS.filter((g) => p.games.includes(g)).map((g) => GAME_INFO[g].name).join(', ')}</b></div>
              <div><span>Per game</span><b>{adv.trialsPerGame} {adv.trialsPerGame === 1 ? 'trial' : 'trials'} × {adv.trialSec} s</b></div>
            </div>
          </div>

          <div className="panel flat">
            <h3>Before you start</h3>
            <ul className="ready-list">
              <li className={mode === '6dof' ? '' : mode === 'motion' ? 'warn' : 'bad'}><i>{mode === '6dof' ? '✓' : '!'}</i>
                <span><b>{MODE_INFO[mode].title}.</b> {mode === '6dof' ? 'Real hand position in centimetres. Strap the phone to the hand and hold it at chest height.' : mode === 'motion'
                  ? `This phone cannot measure position, only rotation${caps?.isIos ? ' (Safari on iPhone does not offer AR position tracking)' : ''}. Reach is recorded in degrees and the session is flagged in the data.`
                  : MODE_INFO[mode].detail}</span></li>
              <li><i>✓</i><span><b>Camera.</b> {mode === '6dof' ? 'AR opens the rear camera.' : p.camera ? 'The game opens the rear camera; allow access when asked. Nothing is recorded or stored.' : 'Camera view is off.'}</span></li>
              <li className={device && !revoked ? '' : 'warn'}><i>{device && !revoked ? '✓' : '!'}</i><span><b>Upload.</b> {device && !revoked ? `Sessions upload automatically (${device.label}).` : 'Not enrolled: the data stays on this phone. You can still download the sheet at the end.'}</span></li>
              {caps && !caps.secure && <li className="bad"><i>!</i><span><b>Not HTTPS.</b> The browser blocks AR, the camera and motion sensors on pages that are not secure.</span></li>}
            </ul>
            {mode !== '6dof' && mode !== 'sim' && (
              <label className="check"><input type="checkbox" checked={p.camera} onChange={(e) => setP({ ...p, camera: e.target.checked })} /><span>Show the camera picture behind the game</span></label>
            )}
            <details className="adv" open={change || undefined} onToggle={(e) => setChange((e.target as HTMLDetailsElement).open)}>
              <summary>Change tracking mode{mode !== auto ? ' (changed)' : ''}</summary>
              <div className="tiles" style={{ paddingTop: 12 }}>
                {modes.map((m) => {
                  const ok = avail(m);
                  return (
                    <div key={m} className={'mode' + (mode === m ? ' sel' : '')} aria-disabled={!ok}>
                      <h3>{MODE_INFO[m].title}{m === auto ? ' · recommended' : ''}</h3>
                      <p>{MODE_INFO[m].detail}</p>
                      <button type="button" className="btn sm" disabled={!ok} aria-pressed={mode === m} onClick={() => setMode(m)}>{!ok ? 'Not available here' : mode === m ? 'Selected' : 'Use this'}</button>
                    </div>
                  );
                })}
              </div>
            </details>
          </div>
        </>
      )}

      {err && <p className="error-msg" role="alert">{err}</p>}

      <div className={'dock' + (step === 0 ? ' single' : '')}><div>
        {step > 0 && <button type="button" className="btn" onClick={back}>Back</button>}
        {step < 2
          ? <button type="button" className="btn primary" onClick={next}>Next</button>
          : <button type="button" className="btn yellow" onClick={start}>Start session</button>}
      </div></div>
    </main>
  );
}
