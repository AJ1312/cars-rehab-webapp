'use client';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Engine, gameInfo, type GameKey, type SessionConfig, type Snapshot } from '@/lib/client/engine';
import { createSensor } from '@/lib/client/sensors';
import type { StoredSession } from '@/lib/client/local';

const IDLE: Snapshot = {
  phase: 'idle', error: null, tracking: 'waiting', rateHz: 0, manualPause: false, cal: { progress: 0, result: null, attempts: 0 },
  range: { index: 0, total: 4, secLeft: 0, results: [] }, game: null, gameIndex: 0, gameCount: 0, trialNo: 0, trialsTotal: 0, timeLeftS: 0, score: 0, itemNo: 0,
  prompt: null, countdown: 0, trialEnd: null, isLast: false, elapsedS: 0
};
const noopSub = () => () => undefined;
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

function GameIcon({ g }: { g: GameKey }) {
  if (g === 'triangle') return <svg viewBox="0 0 72 72" aria-hidden="true"><path d="M36 10 L58 50 L14 50 Z" fill="#FFB020" stroke="#fff" strokeWidth="4" strokeLinejoin="round" /><circle cx="56" cy="60" r="6" fill="#43D3B3" /></svg>;
  if (g === 'maths') return <svg viewBox="0 0 72 72" aria-hidden="true"><text x="36" y="46" textAnchor="middle" fontSize="40" fontWeight="700" fill="#EEF6F3" fontFamily="Lexend Variable, sans-serif">3+4</text></svg>;
  return <svg viewBox="0 0 72 72" aria-hidden="true"><text x="36" y="34" textAnchor="middle" fontSize="20" fontWeight="700" fill="#4D9BFF" fontFamily="Lexend Variable, sans-serif">RED</text><text x="36" y="58" textAnchor="middle" fontSize="20" fontWeight="700" fill="#FF4B3E" fontFamily="Lexend Variable, sans-serif">BLUE</text></svg>;
}

export function StageScreen({ cfg, onFinished, onExit }: { cfg: SessionConfig; onFinished: (s: StoredSession) => void; onExit: () => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const botRef = useRef<HTMLDivElement>(null);
  const [engine, setEngine] = useState<Engine | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const doneRef = useRef(false);
  const snap = useSyncExternalStore(engine ? engine.subscribe : noopSub, engine ? engine.getSnapshot : () => IDLE, () => IDLE);

  useEffect(() => {
    if (!canvasRef.current) return;
    const eng = new Engine(cfg, createSensor(cfg.mode), canvasRef.current, { transparent: cfg.mode === '6dof' || cfg.camera === 'on' });
    setEngine(eng);
    (window as unknown as { __cars?: Engine }).__cars = eng;       // read by automated tests
    return () => { eng.dispose(); delete (window as unknown as { __cars?: Engine }).__cars; };
  }, [cfg]);

  // Keep the drawing area clear of the top and bottom bars.
  useEffect(() => {
    if (!engine || !topRef.current || !botRef.current) return;
    const apply = () => {
      const th = topRef.current?.offsetHeight ?? 70, bh = botRef.current?.offsetHeight ?? 70;
      rootRef.current?.style.setProperty('--hud-h', th + 'px');
      engine.setInsets(th + 8 + 112, bh + 8);
    };
    apply();
    const ro = new ResizeObserver(apply); ro.observe(topRef.current); ro.observe(botRef.current);
    return () => ro.disconnect();
  }, [engine]);

  // Optional camera picture behind the game (motion mode). In AR mode the browser provides it.
  useEffect(() => {
    if (cfg.camera !== 'on' || cfg.mode === '6dof' || snap.phase === 'idle') return;
    let stream: MediaStream | null = null; let dead = false;
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: 'environment' }, audio: false }).then((s) => {
      if (dead) { s.getTracks().forEach((t) => t.stop()); return; }
      stream = s; if (videoRef.current) { videoRef.current.srcObject = s; void videoRef.current.play().catch(() => undefined); }
    }).catch(() => undefined);
    return () => { dead = true; stream?.getTracks().forEach((t) => t.stop()); };
  }, [cfg.camera, cfg.mode, snap.phase === 'idle']);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (snap.phase !== 'finished' || !engine || doneRef.current) return;
    doneRef.current = true;
    const { record, kin } = engine.result();
    onFinished({ id: record.id, record, kin, savedAt: new Date().toISOString(), state: 'pending', kinUploaded: false, attempts: 0, lastError: null, uploadedAt: null });
  }, [snap.phase, engine, onFinished]);

  const pointer = useCallback((e: React.PointerEvent) => {
    if ((cfg.mode === 'touch' || cfg.mode === 'sim') && (e.type === 'pointerdown' || e.buttons)) engine?.setAim(e.clientX, e.clientY);
  }, [cfg.mode, engine]);

  const ph = snap.phase;
  const playing = ph === 'playing';
  const info = snap.game ? gameInfo(snap.game) : null;
  const lost = snap.tracking === 'lost' && (ph === 'playing' || ph === 'range');
  const onTrialEnd = snap.trialEnd;
  const nextGame = snap.gameIndex < cfg.games.length - 1 ? gameInfo(cfg.games[snap.gameIndex + 1]).name : null;

  return (
    <div ref={rootRef} className={'stage' + (cfg.mode === '6dof' ? ' xr' : '')} id="stage-root" onPointerDown={pointer} onPointerMove={pointer}>
      {cfg.camera === 'on' && cfg.mode !== '6dof' && <video ref={videoRef} playsInline muted autoPlay aria-hidden="true" />}
      <canvas ref={canvasRef} aria-label="Game area" />
      <div className="vignette" />

      <div className="hud-top" ref={topRef}>
        <div className="game">{info && ph !== 'idle' ? <>{info.name}<small>{snap.trialNo > 0 ? `Trial ${snap.trialNo} of ${snap.trialsTotal}` : `Game ${snap.gameIndex + 1} of ${snap.gameCount}`}</small></> : <>Session setup<small>{cfg.participantId} · session {cfg.sessionNo}</small></>}</div>
        <div className="timer" aria-live="off">{playing ? fmt(snap.timeLeftS) : ''}</div>
        <div className="score">{playing || ph === 'trial_end' ? <>Score<b>{snap.score}</b></> : ph === 'range' ? <>Range<b>{snap.range.index + 1}/{snap.range.total}</b></> : null}</div>
      </div>

      {playing && snap.prompt && !snap.manualPause && (
        <div className="prompt" style={{ top: 'calc(var(--hud-h, 70px) + 8px)' }} aria-live="polite">
          <small>{snap.prompt.caption}</small>
          {snap.prompt.main ? <div className="p-main">{snap.prompt.main}</div> : null}
        </div>
      )}
      {ph === 'range' && <div className="prompt" style={{ top: 'calc(var(--hud-h, 70px) + 8px)' }}><small>Range check · dot {snap.range.index + 1} of {snap.range.total}</small><div className="p-main" style={{ fontSize: 28 }}>Reach the circle</div><small>{snap.range.secLeft} s left</small></div>}

      <div className="hud-bottom" ref={botRef}>
        <span className={'pill ' + (snap.tracking === 'ok' ? '' : snap.tracking === 'lost' ? 'lost' : 'wait')} role="status">
          {snap.tracking === 'ok' ? `Tracking OK · ${snap.rateHz} Hz` : snap.tracking === 'lost' ? 'Tracking lost' : ph === 'idle' ? 'Not started' : 'Finding tracking…'}
        </span>
        <div className="hud-btns">
          {ph === 'range' && <button className="sbtn" onClick={() => engine?.skipRange()}>Skip</button>}
          {(playing || ph === 'range') && <button className="sbtn" onClick={() => engine?.recentre()}>Recentre</button>}
          {playing && <button className="sbtn" onClick={() => engine?.setManualPause(true)}>Pause</button>}
        </div>
      </div>

      {lost && <div className="banner" role="alert">Tracking lost<small>Hold the phone steady with the camera facing the room. The game resumes by itself.</small></div>}
      {ph === 'countdown' && <div className="countdown" aria-live="assertive">{snap.countdown}</div>}

      {ph === 'idle' && (
        <div className="card" role="dialog" aria-label="Start tracking">
          <span className="mode-tag">{cfg.mode === '6dof' ? 'AR position tracking' : cfg.mode === 'motion' ? 'Motion tracking' : cfg.mode === 'touch' ? 'Touch practice' : 'Simulated'}</span>
          <h2>Ready to start</h2>
          <p>{cfg.mode === '6dof' ? 'Your browser will ask for camera access to track movement. Hold the phone upright at chest height.' : cfg.mode === 'motion' ? 'Your phone may ask to allow motion access. Hold the phone upright at chest height.' : 'Drag a finger on the screen to move the cursor.'}</p>
          <div className="btns">
            <button className="sbtn primary" onClick={() => rootRef.current && void engine?.begin(rootRef.current)}>Start tracking</button>
            <button className="sbtn" onClick={onExit}>Back</button>
          </div>
        </div>
      )}

      {ph === 'starting' && (
        <div className="card" role="status"><h2>Finding tracking…</h2><p>Hold the phone upright and move it slowly so the camera can see the room. This takes a few seconds.</p></div>
      )}

      {ph === 'cal_ready' && (
        <div className="card" role="dialog" aria-label="Calibration">
          <span className="mode-tag">Step 1 · Calibrate</span>
          <h2>Find the centre</h2>
          <p>Sit comfortably. Hold the phone at the middle of the space you will reach in, at chest height, then keep it completely still for 2 seconds.</p>
          <div className="btns"><button className="sbtn primary" onClick={() => engine?.beginCalibration()}>Calibrate now</button></div>
        </div>
      )}

      {ph === 'cal_hold' && (
        <div className="card" role="status" aria-live="polite">
          <h2>Hold still…</h2>
          <div style={{ height: 14, borderRadius: 7, background: 'rgba(255,255,255,0.12)', overflow: 'hidden' }}><div style={{ height: '100%', width: `${Math.round(snap.cal.progress * 100)}%`, background: 'var(--st-accent)', transition: 'width 0.15s linear' }} /></div>
          <p>{snap.tracking === 'ok' ? 'Measuring how steady the tracking is.' : 'Waiting for tracking…'}</p>
        </div>
      )}

      {ph === 'cal_result' && snap.cal.result && (
        <div className="card" role="dialog" aria-label="Calibration result">
          <span className="mode-tag">Calibration {snap.cal.attempts > 1 ? `(attempt ${snap.cal.attempts})` : ''}</span>
          <h2 className={snap.cal.result.pass ? 'ok' : undefined}>{snap.cal.result.pass ? 'Tracking is steady' : 'Tracking is not steady enough'}</h2>
          <div className="stats">
            <div className="stat"><b>{snap.cal.result.rateHz.toFixed(0)} Hz</b><span>Sensor rate (min {snap.cal.result.minRate})</span></div>
            <div className="stat"><b>{snap.cal.result.jitterCm == null ? '–' : snap.cal.result.jitterCm.toFixed(1) + ' cm'}</b><span>Jitter (max {snap.cal.result.maxJitterCm.toFixed(1)})</span></div>
          </div>
          {!snap.cal.result.pass && <p className="fail">{snap.cal.result.reasons.join(' ')} Try again with both hands steady on the phone, in a well-lit room.</p>}
          <div className="btns">
            {snap.cal.result.pass
              ? <><button className="sbtn primary" onClick={() => engine?.acceptCalibration(false)}>Continue</button><button className="sbtn" onClick={() => engine?.beginCalibration()}>Calibrate again</button></>
              : <><button className="sbtn primary" onClick={() => engine?.beginCalibration()}>Calibrate again</button><button className="sbtn warn" onClick={() => engine?.acceptCalibration(true)}>Continue anyway (flagged in data)</button></>}
          </div>
        </div>
      )}

      {ph === 'game_intro' && info && snap.game && (
        <div className="card" role="dialog" aria-label={info.name}>
          <span className="mode-tag">Game {snap.gameIndex + 1} of {snap.gameCount}</span>
          <h2>{info.name}</h2>
          <div className="how"><GameIcon g={snap.game} /><p>{info.how}</p></div>
          <p>{cfg.trialsPerGame} trials of {cfg.trialSec} seconds. The clock pauses if tracking is lost.</p>
          <div className="btns"><button className="sbtn primary" onClick={() => engine?.startTrial()}>Start trial 1</button><button className="sbtn" onClick={() => setConfirmEnd(true)}>End session</button></div>
        </div>
      )}

      {ph === 'trial_end' && onTrialEnd && (
        <div className="card" role="dialog" aria-label="Trial finished">
          <span className="mode-tag">{gameInfo(onTrialEnd.game).name} · trial {onTrialEnd.trial} of {cfg.trialsPerGame}</span>
          <h2>{snap.isLast ? 'All done!' : 'Trial complete'}</h2>
          <div className="stats">
            <div className="stat"><b>{onTrialEnd.score}</b><span>Score</span></div>
            <div className="stat"><b>{onTrialEnd.accuracyPct == null ? '–' : onTrialEnd.accuracyPct + '%'}</b><span>Accuracy</span></div>
            <div className="stat"><b>{onTrialEnd.rtMeanMs == null ? '–' : (onTrialEnd.rtMeanMs / 1000).toFixed(2) + ' s'}</b><span>Reaction</span></div>
          </div>
          {onTrialEnd.dropouts > 0 && <p className="fail">Tracking was lost {onTrialEnd.dropouts} time{onTrialEnd.dropouts > 1 ? 's' : ''} in this trial. The clock was paused each time.</p>}
          <p>Rest your arm before the next one if needed.</p>
          <div className="btns">
            <button className="sbtn primary" onClick={() => engine?.next()}>
              {snap.isLast ? 'Finish session' : onTrialEnd.trial < cfg.trialsPerGame ? `Start trial ${onTrialEnd.trial + 1}` : `Next game: ${nextGame}`}
            </button>
            {!snap.isLast && <button className="sbtn" onClick={() => setConfirmEnd(true)}>End session</button>}
          </div>
        </div>
      )}

      {snap.manualPause && !confirmEnd && (
        <div className="card" role="dialog" aria-label="Paused">
          <h2>Paused</h2><p>The trial clock is stopped.</p>
          <div className="btns">
            <button className="sbtn primary" onClick={() => engine?.setManualPause(false)}>Resume</button>
            <button className="sbtn" onClick={() => engine?.recentre()}>Recentre</button>
            <button className="sbtn warn" onClick={() => setConfirmEnd(true)}>End session</button>
          </div>
        </div>
      )}

      {confirmEnd && ph !== 'error' && (
        <div className="card" role="alertdialog" aria-label="End the session">
          <h2>End the session now?</h2><p>Everything played so far is saved. The data sheet will be marked as ended early.</p>
          <div className="btns"><button className="sbtn warn" onClick={() => { setConfirmEnd(false); engine?.endEarly(); }}>Yes, end now</button><button className="sbtn primary" onClick={() => setConfirmEnd(false)}>Keep going</button></div>
        </div>
      )}

      {ph === 'error' && (
        <div className="card" role="alertdialog" aria-label="Problem">
          <h2>Could not continue</h2><p className="fail">{snap.error}</p>
          <div className="btns"><button className="sbtn primary" onClick={onExit}>Back to start</button></div>
        </div>
      )}
    </div>
  );
}
