'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Brand } from '@/components/ui/Brand';
import { ArtGuide, ArtHero, ArtLock, ArtPhone, ArtTry, ArtUploads, IconGuide, IconSound, IconVibrate } from '@/components/ui/Art';
import { GameGlyph } from '@/components/ui/Glyphs';
import core from '@/lib/core';
import { detectCapabilities, MODE_INFO, type Capabilities, type Mode } from '@/lib/client/sensors';
import { allSessions, getRecent, nextSessionNo, refreshConfig, syncAll } from '@/lib/client/local';
import { haptic, hapticsKind, isHapticsOn, setHapticsOn } from '@/lib/client/haptics';
import { isMuted, setMuted, sfx, sfxUnlock } from '@/lib/client/sfx';

export function Home({ onStart, onGuide, onDemo, onHistory }: {
  onStart: (code?: string) => void; onGuide: (section?: string) => void; onDemo: (mode: Mode) => void; onHistory: () => void;
}) {
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [sim, setSim] = useState(false);
  const [revoked, setRevoked] = useState(false);
  const [pending, setPending] = useState<number | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const [nextNo, setNextNo] = useState<number | null>(null);
  const [check, setCheck] = useState(false);
  const [standalone, setStandalone] = useState(false);
  const [hk, setHk] = useState<'vibrate' | 'taps' | 'none'>('none');

  useEffect(() => {
    setHk(hapticsKind());
    setRecent(getRecent());
    const simOn = new URLSearchParams(location.search).get('sim') === '1'; setSim(simOn);
    setStandalone(window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true);
    void detectCapabilities().then(setCaps);
    void allSessions().then((s) => setPending(s.filter((x) => x.state === 'pending').length));
    void refreshConfig().then((r) => setRevoked(r === 'revoked'));
    void syncAll().then((r) => { setPending(r.pending); if (r.revoked) setRevoked(true); });
  }, []);

  const last = recent[0];
  useEffect(() => { if (last) void nextSessionNo(last).then(setNextNo); }, [last]);

  const mode: Mode | null = caps ? (sim ? 'sim' : caps.xr ? '6dof' : caps.motion ? 'motion' : 'touch') : null;
  const modeTitle = mode ? MODE_INFO[mode].title : 'Checking this phone…';
  const modeTone = mode === '6dof' || mode === 'sim' ? 'ok' : mode === 'motion' ? 'warn' : mode ? 'bad' : '';

  return (
    <main className="wrap home">
      <div className="topbar">
        <Brand />
        <div className="top-right">
          {revoked && <span className="chip bad">Phone removed</span>}
          <button type="button" className="icon-btn" aria-label="Open the guide" onClick={() => onGuide()}><IconGuide /></button>
        </div>
      </div>

      {revoked && <p className="notice bad" role="alert"><b>The study team removed this phone.</b> You can still play and download each sheet, but nothing uploads. Data already on the phone is kept.</p>}

      <div className="bento">
        <div className="bt hero w2">
          <span className="eyebrow">Reach · Touch · Recover</span>
          <div className="bt-art"><ArtHero /></div>
          <div className="bt-body">
            <h1>Start a session</h1>
            {last
              ? <p>Next up: <b>{last}</b>{nextNo ? `, session ${nextNo}` : ''}. Or pick someone else.</p>
              : <p>Choose the participant, the level and the games. About a minute to set up.</p>}
          </div>
          <div className="bt-actions">
            {last
              ? <><button type="button" className="btn yellow" onClick={() => onStart(last)}>Continue with {last}</button><button type="button" className="btn" onClick={() => onStart()}>Someone else</button></>
              : <button type="button" className="btn yellow" onClick={() => onStart()}>Start</button>}
          </div>
        </div>

        <button type="button" className="bt yellow" onClick={() => onGuide()}>
          <div className="bt-art sm"><ArtGuide /></div>
          <div><h3>Guide</h3><p>How it works, in two minutes</p></div>
        </button>

        <button type="button" className="bt" onClick={() => mode && onDemo(mode)} disabled={!mode}>
          <div className="bt-art sm"><ArtTry /></div>
          <div><h3>Try it</h3><p>One minute, nothing is saved</p></div>
        </button>

        <button type="button" className={'bt ink w2 check ' + modeTone} onClick={() => setCheck(true)} aria-haspopup="dialog">
          <div className="bt-art sm"><ArtPhone /></div>
          <div className="bt-body">
            <span className="eyebrow">Phone check</span>
            <h3>{modeTitle}</h3>
            <ul className="mini">
              <li className={caps?.secure === false ? 'bad' : 'ok'}>{caps ? (caps.secure ? 'Secure page: camera and sensors allowed' : 'Not https: camera and sensors blocked') : '…'}</li>
              <li className={hk === 'vibrate' ? 'ok' : 'warn'}>{hk === 'vibrate' ? 'Vibration available' : hk === 'taps' ? 'Vibration on taps only' : 'No vibration on this phone'}</li>
            </ul>
          </div>
        </button>

        <button type="button" className="bt" onClick={onHistory}>
          <div className="bt-art sm"><ArtUploads /></div>
          <div>
            <h3>This phone</h3>
            <p><b className="num big">{pending ?? '–'}</b> {pending === 1 ? 'session' : 'sessions'} waiting to upload</p>
          </div>
        </button>

        <Link href="/admin" className="bt">
          <div className="bt-art sm"><ArtLock /></div>
          <div><h3>Admin board</h3><p>Results, exports, devices</p></div>
        </Link>

        <div className="bt w2 plan">
          <div className="plan-head"><span className="eyebrow">The study block</span><h3>{core.PROTOCOL.carsMinutes} minutes · {core.PROTOCOL.trialsPerGame * 3} trials</h3></div>
          <div className="plan-bar" role="img" aria-label={`${core.PROTOCOL.trialsPerGame} trials each of Triangle Reach, Maths Fun and Colour Merge Test`}>
            {(['triangle', 'maths', 'colour'] as const).map((g) => (
              <button key={g} type="button" className={'seg-' + g} onClick={() => onGuide('games')}>
                <GameGlyph g={g} className="pg" /><span>{core.GAMES[g].name}</span><b>×{core.PROTOCOL.trialsPerGame}</b>
              </button>
            ))}
          </div>
          <p className="small muted">{core.PROTOCOL.trialSec / 60} minutes per trial. {core.PROTOCOL.sessions} sessions over {core.PROTOCOL.weeks} weeks, {core.PROTOCOL.perWeek} a week.</p>
        </div>
      </div>

      {check && <PhoneCheck caps={caps} mode={mode} revoked={revoked} standalone={standalone} onClose={() => setCheck(false)} onGuide={() => { setCheck(false); onGuide('tracking'); }} />}
    </main>
  );
}

function PhoneCheck({ caps, mode, revoked, standalone, onClose, onGuide }: { caps: Capabilities | null; mode: Mode | null; revoked: boolean; standalone: boolean; onClose: () => void; onGuide: () => void }) {
  const [vib, setVib] = useState(isHapticsOn());
  const [snd, setSnd] = useState(!isMuted());
  const hk = hapticsKind();
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  const rows: { tone: 'ok' | 'warn' | 'bad'; t: string; d: string }[] = [];
  if (caps && mode) {
    rows.push(mode === '6dof' || mode === 'sim'
      ? { tone: 'ok', t: 'AR position tracking', d: 'The phone can measure hand position in centimetres. Best for research data.' }
      : mode === 'motion'
        ? { tone: 'warn', t: 'Rotation only', d: `${caps.isIos ? 'Safari on iPhone does not offer AR position tracking to web pages. ' : 'AR position tracking is not available here. '}The games work by turning the phone, and reach is recorded in degrees. The data sheet flags it.` }
        : { tone: 'bad', t: 'Touch practice only', d: 'No motion sensors found. You can learn the games by dragging a finger, but no movement is measured.' });
    rows.push(caps.secure ? { tone: 'ok', t: 'Secure page (https)', d: 'The browser allows the camera and motion sensors.' } : { tone: 'bad', t: 'Not a secure page', d: 'Browsers block AR, the camera and motion sensors on pages that are not https.' });
    rows.push(hk === 'vibrate' ? { tone: 'ok', t: 'Vibration', d: 'A short buzz for each touch, a longer one at the end of a trial.' } : hk === 'taps' ? { tone: 'warn', t: 'Vibration: taps only', d: 'Safari on iPhone has no vibration for web pages. Buttons give a light tick where the phone allows it; the games use sound and the picture.' } : { tone: 'warn', t: 'No vibration', d: 'This phone or browser does not offer vibration.' });
  }
  rows.push(revoked ? { tone: 'bad', t: 'Phone removed', d: 'The study team removed this phone. Sessions stay on it and the sheet can still be downloaded.' } : { tone: 'ok', t: 'Upload', d: 'Sessions upload by themselves when the phone is online. Nothing to set up.' });
  if (standalone) rows.push({ tone: 'ok', t: 'Installed on the home screen', d: 'Opens full screen without the browser bars.' });

  return (
    <div className="scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet-p" role="dialog" aria-modal="true" aria-labelledby="pc-h">
        <div className="sp-head"><h2 id="pc-h">Phone check</h2><button type="button" className="icon-btn" onClick={onClose} aria-label="Close">✕</button></div>
        <ul className="ready-list">
          {rows.map((r) => <li key={r.t} className={r.tone === 'ok' ? '' : r.tone}><i>{r.tone === 'ok' ? '✓' : '!'}</i><span><b>{r.t}.</b> {r.d}</span></li>)}
        </ul>
        <div className="toggles">
          <label className="switch"><IconVibrate /><span><b>Vibration</b><small>Feel each touch</small></span>
            <input type="checkbox" checked={vib} onChange={(e) => { setVib(e.target.checked); setHapticsOn(e.target.checked); }} /><i aria-hidden="true" /></label>
          <label className="switch"><IconSound /><span><b>Sound</b><small>Tones for touches</small></span>
            <input type="checkbox" checked={snd} onChange={(e) => { setSnd(e.target.checked); setMuted(!e.target.checked); if (e.target.checked) { sfxUnlock(); sfx('ok'); } }} /><i aria-hidden="true" /></label>
        </div>
        <div className="btn-row">
          <button type="button" className="btn" onClick={() => { haptic('end'); sfxUnlock(); sfx('end'); }}>Test feedback</button>
          <button type="button" className="btn" onClick={onGuide}>About tracking</button>
        </div>
        <button type="button" className="btn primary block" onClick={onClose}>Done</button>
      </div>
    </div>
  );
}
