'use client';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Engine, gameInfo, type SessionConfig, type Snapshot } from '@/lib/client/engine';
import { createSensor } from '@/lib/client/sensors';
import { isMuted, setMuted, sfx, sfxUnlock } from '@/lib/client/sfx';
import { GameGlyph } from '@/components/ui/Glyphs';
import { IconVibrate } from '@/components/ui/Art';
import { hapticsKind, isHapticsOn, setHapticsOn } from '@/lib/client/haptics';
import type { StoredSession } from '@/lib/client/local';

const IDLE: Snapshot = {
  phase: 'idle', error: null, tracking: 'waiting', rateHz: 0, manualPause: false, cal: { progress: 0, result: null, attempts: 0 },
  range: { index: 0, total: 4, secLeft: 0, results: [] }, game: null, gameIndex: 0, gameCount: 0, trialNo: 0, trialsTotal: 0, timeLeftS: 0, score: 0, itemNo: 0,
  prompt: null, countdown: 0, trialEnd: null, isLast: false, elapsedS: 0, init: 0, practice: false, practiceNext: false, trialSecNow: 0,
  slot: 0, slots: 0, nextGame: null, nextNewGame: false
};
const noopSub = () => () => undefined;
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

const I = {
  recentre: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" /></svg>,
  pause: <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4.2" height="14" rx="1.4" /><rect x="13.8" y="5" width="4.2" height="14" rx="1.4" /></svg>,
  skip: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 5l9 7-9 7zM19 5v14" /></svg>,
  sound: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5zM15.5 9a4 4 0 010 6M18 6.5a8 8 0 010 11" /></svg>,
  muted: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5zM16 9.5l5 5M21 9.5l-5 5" /></svg>
};

export function StageScreen({ cfg, onFinished, onExit }: { cfg: SessionConfig; onFinished: (s: StoredSession) => void; onExit: () => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const glRef = useRef<HTMLCanvasElement>(null);
  const ovRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hudRef = useRef<HTMLDivElement>(null);
  const lastPtr = useRef<{ x: number; y: number } | null>(null);
  const [engine, setEngine] = useState<Engine | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [mute, setMute] = useState(false);
  const [vib, setVib] = useState(true);
  const hk = hapticsKind();
  const [camState, setCamState] = useState<'off' | 'wait' | 'live' | 'denied'>('off');
  const doneRef = useRef(false);
  const snap = useSyncExternalStore(engine ? engine.subscribe : noopSub, engine ? engine.getSnapshot : () => IDLE, () => IDLE);
  const xr = cfg.mode === '6dof';
  const linear = xr || cfg.mode === 'sim';

  useEffect(() => { setMute(isMuted()); setVib(isHapticsOn()); }, []);
  useEffect(() => {
    document.documentElement.classList.add('in-stage');
    return () => document.documentElement.classList.remove('in-stage');
  }, []);

  useEffect(() => {
    if (!ovRef.current) return;
    const eng = new Engine(cfg, createSensor(cfg.mode), { gl: glRef.current, overlay: ovRef.current }, { sfx });
    setEngine(eng);
    (window as unknown as { __cars?: Engine }).__cars = eng;       // read by automated tests
    return () => { eng.dispose(); delete (window as unknown as { __cars?: Engine }).__cars; };
  }, [cfg]);

  // Keep the drawing surfaces the size of the screen; keep the banner clear of the HUD.
  useEffect(() => {
    if (!engine || !rootRef.current) return;
    const root = rootRef.current;
    const apply = () => {
      const r = root.getBoundingClientRect();
      engine.resize(r.width, r.height, window.devicePixelRatio || 1);
      root.style.setProperty('--hud-h', (hudRef.current?.offsetHeight ?? 90) + 'px');
    };
    apply();
    const ro = new ResizeObserver(apply); ro.observe(root);
    window.addEventListener('orientationchange', apply);
    return () => { ro.disconnect(); window.removeEventListener('orientationchange', apply); };
  }, [engine]);

  // The camera picture behind the game. In AR mode (Android) the browser provides it; elsewhere we open the rear camera.
  const wantCam = cfg.camera === 'on' && !xr;
  const started = snap.phase !== 'idle';
  useEffect(() => {
    if (!wantCam || !started || !engine) return;
    let stream: MediaStream | null = null; let dead = false;
    setCamState('wait');
    const md = navigator.mediaDevices;
    if (!md?.getUserMedia) { setCamState('denied'); return; }
    md.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false }).then((st) => {
      if (dead) { st.getTracks().forEach((t) => t.stop()); return; }
      stream = st;
      const v = videoRef.current; if (!v) return;
      v.srcObject = st;
      v.onplaying = () => { if (!dead) { setCamState('live'); engine.setCamera(true); } };
      void v.play().catch(() => undefined);
    }).catch(() => { if (!dead) { setCamState('denied'); engine.setCamera(false); } });
    return () => { dead = true; stream?.getTracks().forEach((t) => t.stop()); engine.setCamera(false); };
  }, [wantCam, started, engine]);

  useEffect(() => {
    if (snap.phase !== 'finished' || !engine || doneRef.current) return;
    doneRef.current = true;
    const { record, kin } = engine.result();
    (window as unknown as { __carsResult?: unknown }).__carsResult = { record, kin };   // read by automated tests
    onFinished({ id: record.id, record, kin, savedAt: new Date().toISOString(), state: 'pending', kinUploaded: false, attempts: 0, lastError: null, uploadedAt: null });
  }, [snap.phase, engine, onFinished]);

  // Touch practice: drag to look around, as if turning the camera.
  const practice = cfg.mode === 'touch';
  const pointer = useCallback((e: React.PointerEvent) => {
    if (!practice || !engine) return;
    if ((e.target as HTMLElement).closest('button, .sheet')) { lastPtr.current = null; return; }
    if (e.type === 'pointerdown') { lastPtr.current = { x: e.clientX, y: e.clientY }; return; }
    if (e.type === 'pointerup' || e.type === 'pointercancel') { lastPtr.current = null; return; }
    if (e.buttons && lastPtr.current) {
      engine.look(e.clientX - lastPtr.current.x, e.clientY - lastPtr.current.y);
      lastPtr.current = { x: e.clientX, y: e.clientY };
    }
  }, [practice, engine]);

  const ph = snap.phase;
  const playing = ph === 'playing';
  const info = snap.game ? gameInfo(snap.game, cfg.mode) : null;
  const lost = snap.tracking === 'lost' && (ph === 'playing' || ph === 'range');
  const te = snap.trialEnd;
  const nextGame = snap.nextGame ? gameInfo(snap.nextGame).name : null;
  const mixed = cfg.order === 'mixed';
  const showSheet = !confirmEnd && !snap.manualPause && (ph === 'idle' || ph === 'cal_ready' || ph === 'cal_result' || ph === 'game_intro' || ph === 'trial_end');
  const modeTag = xr ? 'AR position tracking' : cfg.mode === 'motion' ? 'Motion tracking' : cfg.mode === 'touch' ? 'Touch practice' : 'Simulated hand';
  const inTrial = ph === 'playing' || ph === 'countdown' || ph === 'trial_end';
  const nocam = !xr && camState !== 'live';
  const low = playing && snap.timeLeftS <= 10;
  const pips = Array.from({ length: snap.trialsTotal || cfg.trialsPerGame }, (_, i) => i + 1);

  return (
    <div ref={rootRef} className={'stage' + (xr ? ' xr' : '') + (nocam ? ' nocam' : '') + (lost ? ' is-lost' : '')} id="stage-root" data-phase={ph}
      onPointerDown={pointer} onPointerMove={pointer} onPointerUp={pointer} onPointerCancel={pointer}>
      {wantCam && <video ref={videoRef} className={camState === 'live' ? 'live' : ''} playsInline muted autoPlay aria-hidden="true" />}
      <canvas ref={glRef} className="gl" aria-hidden="true" style={xr ? { display: 'none' } : undefined} />
      <canvas ref={ovRef} className="ov" role="img" aria-label="Game view" />

      <div className="hud" ref={hudRef}>
        <div className="chip-s score" aria-live="off">
          <small>{ph === 'range' ? 'Range' : 'Score'}</small>
          {ph === 'range' ? <b className="sm">{Math.min(snap.range.index + 1, snap.range.total)}/{snap.range.total}</b> : <b key={snap.score} className={snap.score ? 'pop' : ''}>{snap.score}</b>}
        </div>
        <div className="hud-c">
          {info && ph !== 'idle' && <span className="game-tag">{info.name}{inTrial && snap.practice && <span className="prac-tag">Practice</span>}{inTrial && !snap.practice && snap.trialNo > 0 && <span className="pips" aria-label={`Trial ${snap.trialNo} of ${snap.trialsTotal}`}>{pips.map((n) => <i key={n} className={n < snap.trialNo || (n === snap.trialNo && ph === 'trial_end') ? 'done' : n === snap.trialNo ? 'now' : ''} />)}</span>}</span>}
        </div>
        <div className={'chip-s time' + (low ? ' low' : '')}>
          <small>{ph === 'range' ? 'Seconds' : 'Time'}</small>
          <b>{ph === 'range' ? snap.range.secLeft : fmt(playing || ph === 'trial_end' ? snap.timeLeftS : snap.trialSecNow || cfg.trialSec)}</b>
          {playing && <span className="bar" style={{ width: `${Math.max(0, Math.min(100, (snap.timeLeftS / (snap.trialSecNow || cfg.trialSec)) * 100))}%` }} />}
        </div>
      </div>

      {playing && snap.prompt && !snap.manualPause && (
        <div className="mid" key={snap.itemNo + snap.prompt.caption} aria-live="polite">
          <span className="cap">{snap.prompt.caption}</span>
          {snap.prompt.main ? <div className="main">{snap.prompt.main}</div> : null}
        </div>
      )}
      {ph === 'range' && (
        <div className="mid" aria-live="polite">
          <span className="cap">Range check · {Math.min(snap.range.index + 1, snap.range.total)} of {snap.range.total}</span>
          <div className="main" style={{ fontSize: 'clamp(26px, 8vw, 40px)' }}>{linear ? 'Reach to the blue dot' : 'Aim at the blue dot'}</div>
        </div>
      )}
      {ph === 'starting' && (
        <div className="mid" role="status" aria-live="polite">
          {xr && snap.tracking === 'ok' && (
            <div className="cal-ring" style={{ background: 'var(--s-ink)', borderRadius: '50%', border: '3px solid var(--s-paper)' }}>
              <svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="48" fill="none" stroke="rgba(246,241,231,.25)" strokeWidth="9" /><circle cx="60" cy="60" r="48" fill="none" stroke="#FFC400" strokeWidth="9" strokeLinecap="round" strokeDasharray={2 * Math.PI * 48} strokeDashoffset={2 * Math.PI * 48 * (1 - snap.init)} transform="rotate(-90 60 60)" /></svg>
              <b style={{ color: '#F6F1E7' }}>{Math.max(0, Math.ceil(5 * (1 - snap.init)))}</b>
            </div>
          )}
          <span className="cap">{xr ? (snap.tracking === 'ok' ? 'Starting AR tracking' : 'Finding tracking') : 'Finding tracking'}</span>
          <div className="main" style={{ fontSize: 'clamp(24px, 7vw, 34px)' }}>{xr ? 'Move the phone back and forth' : 'Move the phone slowly'}</div>
        </div>
      )}
      {ph === 'cal_hold' && (
        <div className="mid" role="status" aria-live="polite">
          <div className="cal-ring" style={{ background: 'var(--s-ink)', borderRadius: '50%', border: '3px solid var(--s-paper)' }}>
            <svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="48" fill="none" stroke="rgba(246,241,231,.25)" strokeWidth="9" /><circle cx="60" cy="60" r="48" fill="none" stroke="#FFC400" strokeWidth="9" strokeLinecap="round" strokeDasharray={2 * Math.PI * 48} strokeDashoffset={2 * Math.PI * 48 * (1 - snap.cal.progress)} transform="rotate(-90 60 60)" /></svg>
            <b style={{ color: '#F6F1E7' }}>{Math.round(snap.cal.progress * 100)}%</b>
          </div>
          <span className="cap">{snap.tracking === 'ok' ? 'Hold still…' : 'Waiting for tracking…'}</span>
        </div>
      )}
      {wantCam && camState === 'denied' && started && <div className="note-s" role="status">Camera is off, so the room is not shown. The game still works.</div>}

      <div className="bar-b">
        <span className={'pill-s ' + (snap.tracking === 'ok' ? '' : snap.tracking === 'lost' ? 'lost' : 'wait')} role="status">
          {snap.tracking === 'ok' ? `${snap.rateHz} Hz` : snap.tracking === 'lost' ? 'Lost' : ph === 'idle' ? 'Idle' : 'Finding…'}
        </span>
        <div className="tools">
          <button className="tool" aria-label={mute ? 'Turn sound on' : 'Turn sound off'} aria-pressed={mute} onClick={() => { sfxUnlock(); const m = !mute; setMuted(m); setMute(m); if (!m) sfx('back'); }}>{mute ? I.muted : I.sound}<span>{mute ? 'Muted' : 'Sound'}</span></button>
          {hk !== 'none' && <button className="tool" aria-label={vib ? 'Turn vibration off' : 'Turn vibration on'} aria-pressed={!vib} onClick={() => { const v = !vib; setHapticsOn(v); setVib(v); }}><IconVibrate /><span>{vib ? 'Buzz' : 'No buzz'}</span></button>}
          {ph === 'range' && <button className="tool" onClick={() => engine?.skipRange()}>{I.skip}<span>Skip</span></button>}
          {(playing || ph === 'range') && <button className="tool" onClick={() => engine?.recentre()}>{I.recentre}<span>Centre</span></button>}
          {playing && <button className="tool" onClick={() => engine?.setManualPause(true)}>{I.pause}<span>Pause</span></button>}
        </div>
      </div>

      {lost && (
        <div className="banner-s" role="alert"><b>Tracking lost</b><small>Hold the phone steady with the camera facing the room. The game resumes by itself.</small></div>
      )}
      {ph === 'countdown' && <div className="count" key={snap.countdown} aria-live="assertive"><span>{snap.countdown}</span><small>Get ready</small></div>}

      {showSheet && ph === 'idle' && (
        <div className="sheet" role="dialog" aria-label="Start tracking">
          <span className="tag">{modeTag}</span>
          <h2>Ready to start</h2>
          <p>{xr
            ? 'The camera opens and 3D targets appear around you in the room. Hold or strap the phone on your hand and reach out to touch them with the phone itself. The + in the middle shows where the phone points, and the label under the nearest target counts the centimetres left.'
            : cfg.mode === 'motion'
              ? 'The camera opens and targets appear around you in the room. Turn the phone so the ring in the middle of the screen lands on a target, and hold.'
              : cfg.mode === 'touch'
                ? 'Drag a finger on the screen to look around, as if turning a camera. Put the ring in the middle of the screen on a target and hold.'
                : 'Simulated hand for testing.'}</p>
          <div className="btns">
            <button className="sbtn go" onClick={() => { sfxUnlock(); if (rootRef.current) void engine?.begin(rootRef.current); }}>{xr ? 'Open AR' : 'Start tracking'}</button>
            <button className="sbtn" onClick={onExit}>Back</button>
          </div>
        </div>
      )}

      {showSheet && ph === 'cal_ready' && (
        <div className="sheet" role="dialog" aria-label="Calibration">
          <span className="tag">Calibrate</span>
          <h2>Find the centre</h2>
          <p>{linear
            ? 'Sit comfortably. Hold the phone at the middle of the space you will reach in, at chest height, facing straight ahead. This spot becomes the start ring. Keep it still for 2 seconds.'
            : 'Sit comfortably. Hold the phone upright, pointing at the middle of the space in front of you. Keep it still for 2 seconds.'}</p>
          <div className="btns"><button className="sbtn go" onClick={() => engine?.beginCalibration()}>Calibrate now</button></div>
        </div>
      )}

      {showSheet && ph === 'cal_result' && snap.cal.result && (
        <div className="sheet" role="dialog" aria-label="Calibration result">
          <span className="tag">Calibration{snap.cal.attempts > 1 ? ` · attempt ${snap.cal.attempts}` : ''}</span>
          <h2 className={snap.cal.result.pass ? 'good' : undefined}>{snap.cal.result.pass ? 'Tracking is steady' : 'Not steady enough'}</h2>
          <div className="stats">
            <div className="stat"><b>{snap.cal.result.rateHz.toFixed(0)} Hz</b><span>Sensor rate (min {snap.cal.result.minRate})</span></div>
            <div className="stat"><b>{snap.cal.result.jitterCm == null ? '–' : snap.cal.result.jitterCm.toFixed(1) + ' cm'}</b><span>Wobble (max {snap.cal.result.maxJitterCm.toFixed(1)})</span></div>
          </div>
          {!snap.cal.result.pass && <p className="fail">{snap.cal.result.reasons.join(' ')} Try again with both hands steady, in a well-lit room.</p>}
          <div className="btns">
            {snap.cal.result.pass
              ? <><button className="sbtn go" onClick={() => engine?.acceptCalibration(false)}>Continue</button><button className="sbtn" onClick={() => engine?.beginCalibration()}>Calibrate again</button></>
              : <><button className="sbtn go" onClick={() => engine?.beginCalibration()}>Calibrate again</button><button className="sbtn warn" onClick={() => engine?.acceptCalibration(true)}>Continue anyway (flagged in data)</button></>}
          </div>
        </div>
      )}

      {showSheet && ph === 'game_intro' && info && snap.game && (
        <div className="sheet" role="dialog" aria-label={info.name}>
          <span className="tag">{mixed ? `Trial ${snap.slot + 1} of ${snap.slots}` : `Game ${snap.gameIndex + 1} of ${snap.gameCount}`}</span>
          <h2>{info.name}</h2>
          <div className="how"><GameGlyph g={snap.game} /><p>{info.how}</p></div>
          <p className="small">{snap.practiceNext ? `First a practice trial of up to ${snap.trialSecNow} seconds that is not recorded, then ` : ''}{mixed ? `one trial of ${cfg.trialSec} seconds. The three games are mixed, so the next one may be different.` : `${cfg.trialsPerGame} ${cfg.trialsPerGame === 1 ? 'trial' : 'trials'} of ${cfg.trialSec} seconds.`} The clock pauses if tracking is lost.</p>
          <div className="btns">
            <button className="sbtn go" onClick={() => engine?.startTrial()}>{snap.practiceNext ? 'Start practice' : mixed ? 'Start trial' : 'Start trial 1'}</button>
            {snap.practiceNext && <button className="sbtn" onClick={() => engine?.skipPractice()}>Skip practice</button>}
            <button className="sbtn" onClick={() => setConfirmEnd(true)}>End session</button>
          </div>
        </div>
      )}

      {showSheet && ph === 'trial_end' && te && (
        <div className="sheet" role="dialog" aria-label="Trial finished">
          <span className="tag">{gameInfo(te.game).name} · {te.practice ? 'practice' : `trial ${te.trial} of ${cfg.trialsPerGame}`}</span>
          <h2>{te.practice ? 'Practice done' : snap.isLast ? 'All done!' : 'Trial complete'}</h2>
          <div className="stats">
            <div className="stat"><b>{te.score}</b><span>Score</span></div>
            <div className="stat"><b>{te.accuracyPct == null ? '–' : te.accuracyPct + '%'}</b><span>Accuracy</span></div>
            <div className="stat"><b>{te.rtMeanMs == null ? '–' : (te.rtMeanMs / 1000).toFixed(2) + ' s'}</b><span>Reaction</span></div>
          </div>
          {te.dropouts > 0 && <p className="fail">Tracking was lost {te.dropouts} time{te.dropouts > 1 ? 's' : ''} in this trial. The clock was paused each time.</p>}
          {!te.practice && <p className="small">Session progress: trial {snap.slot + 1} of {snap.slots}.</p>}
          <p className="small">{te.practice ? 'The practice trial is not saved or scored. Rest your arm, then start the first real trial.' : 'Rest your arm before the next one if needed.'}</p>
          <div className="btns">
            <button className="sbtn go" onClick={() => engine?.next()}>
              {te.practice ? (mixed ? 'Start trial' : 'Start trial 1') : snap.isLast ? 'Finish session' : snap.nextNewGame ? `Next: ${nextGame}` : `Start trial ${te.trial + 1}`}
            </button>
            {!snap.isLast && <button className="sbtn" onClick={() => setConfirmEnd(true)}>End session</button>}
          </div>
        </div>
      )}

      {snap.manualPause && !confirmEnd && (
        <div className="sheet" role="dialog" aria-label="Paused">
          <span className="tag">Paused</span>
          <h2>Take a rest</h2><p>The trial clock is stopped.</p>
          <div className="btns">
            <button className="sbtn go" onClick={() => engine?.setManualPause(false)}>Resume</button>
            <button className="sbtn" onClick={() => engine?.recentre()}>Reset the centre here</button>
            <button className="sbtn warn" onClick={() => setConfirmEnd(true)}>End session</button>
          </div>
        </div>
      )}

      {confirmEnd && ph !== 'error' && (
        <div className="sheet" role="alertdialog" aria-label="End the session">
          <h2>End the session now?</h2><p>Everything played so far is saved. The data sheet will be marked as ended early.</p>
          <div className="btns"><button className="sbtn warn" onClick={() => { setConfirmEnd(false); engine?.endEarly(); }}>Yes, end now</button><button className="sbtn go" onClick={() => setConfirmEnd(false)}>Keep going</button></div>
        </div>
      )}

      {ph === 'error' && (
        <div className="sheet" role="alertdialog" aria-label="Problem">
          <h2>Could not continue</h2><p className="fail">{snap.error}</p>
          <div className="btns"><button className="sbtn go" onClick={onExit}>Back to start</button></div>
        </div>
      )}
    </div>
  );
}
