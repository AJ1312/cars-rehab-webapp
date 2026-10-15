'use client';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Brand } from '@/components/ui/Brand';
import { ArtDistance, ArtOrder, ArtSize, IconSound, IconVibrate } from '@/components/ui/Art';
import { GameGlyph, LevelGlyph, Tick } from '@/components/ui/Glyphs';
import core from '@/lib/core';
import { detectCapabilities, MODE_INFO, type Capabilities, type Mode } from '@/lib/client/sensors';
import type { GameKey, SessionConfig } from '@/lib/client/engine';
import { getPrefs, getRecent, getSettings, nextSessionNo, pushRecent, setPrefs, refreshConfig } from '@/lib/client/local';
import { hapticsKind, isHapticsOn, setHapticsOn } from '@/lib/client/haptics';
import { isMuted, setMuted, sfx, sfxUnlock } from '@/lib/client/sfx';
import { GAME_KEYS, HAND_MODES, SIDES, participantCode } from '@/lib/schema';

const GAME_INFO: Record<GameKey, { name: string; blurb: string }> = {
  triangle: { name: 'Triangle Reach', blurb: 'Touch every triangle floating apart in front of you. Each set is somewhere new, so the arm travels in every direction.' },
  maths: { name: 'Maths Fun', blurb: 'Add or subtract, then touch the answer. Every number is from 1 to 10.' },
  colour: { name: 'Colour Merge Test', blurb: 'Touch the word whose ink colour matches the colour named. Ignore what the word says.' }
};
const SIDE_LABEL: Record<string, string> = { Left: 'Left', Right: 'Right', Both: 'Both', 'Not applicable': 'N/A' };
type Dist = 'near' | 'medium' | 'far';
type Size = 'small' | 'medium' | 'large';
type Order = 'random' | 'fixed' | 'rotate' | 'mixed';
const DIST_OPTS: { v: Dist; t: string; d: string }[] = [{ v: 'near', t: 'Close', d: 'Bigger, together' }, { v: 'medium', t: 'Medium', d: 'Balanced' }, { v: 'far', t: 'Far', d: 'Smaller, spread wide' }];
const SIZE_OPTS: { v: Size; t: string }[] = [{ v: 'small', t: 'Small' }, { v: 'medium', t: 'Medium' }, { v: 'large', t: 'Large' }];

interface Prefs { therapist: string; group: string; side: string; handMode: string; level: number; games: GameKey[]; camera: boolean; order: Order; homeGate: boolean; practice: boolean; distance: Dist; objectSize: Size }

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

/** Picture choices: a row of cards, one selected. */
function Picks<T extends string>({ label, value, options, onChange, cols = 3, hint }: { label: string; value: T; options: { v: T; t: string; d?: string; art: ReactNode }[]; onChange: (v: T) => void; cols?: 2 | 3; hint?: string }) {
  return (
    <div className="field" role="radiogroup" aria-label={label}>
      <span className="label">{label}</span>
      <div className={'picks c' + cols}>
        {options.map((o) => (
          <button key={o.v} type="button" role="radio" aria-checked={value === o.v} className="pk" onClick={() => onChange(o.v)}>
            <span className="pk-art">{o.art}</span><b>{o.t}</b>{o.d && <span className="d">{o.d}</span>}
          </button>
        ))}
      </div>
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

export function Setup({ onStart, onHome, onGuide, initialCode }: { onStart: (cfg: SessionConfig) => void; onHome: () => void; onGuide: (section?: string) => void; initialCode?: string }) {
  const [step, setStep] = useState<0 | 1 | 2>(initialCode ? 1 : 0);
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [revoked, setRevoked] = useState(false);
  const settings = useMemo(() => getSettings(), []);
  const [code, setCode] = useState(initialCode || '');
  const [recent, setRecent] = useState<string[]>([]);
  const [sessionNo, setSessionNo] = useState<number | null>(null);
  const [p, setP] = useState<Prefs>({ therapist: '', group: settings.groups[0], side: 'Right', handMode: HAND_MODES[0], level: settings.level, games: [...GAME_KEYS], camera: true, order: 'random', homeGate: true, practice: true, distance: 'medium', objectSize: 'medium' });
  const [mode, setMode] = useState<Mode>('touch');
  const [auto, setAuto] = useState<Mode>('touch');
  const [adv, setAdv] = useState({ trialsPerGame: settings.trialsPerGame, trialSec: settings.trialSec, dwellMs: settings.dwellMs, itemTimeoutSec: settings.itemTimeoutSec, skipRange: false });
  const [briefed, setBriefed] = useState(false);
  const [vib, setVib] = useState(true);
  const [snd, setSnd] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [sim, setSim] = useState(false);
  const [change, setChange] = useState(false);

  useEffect(() => {
    const saved = getPrefs<Partial<Prefs> & { shuffle?: boolean }>();
    if (saved) setP((x) => ({ ...x, ...saved, order: saved.order ?? x.order, group: settings.groups.includes(saved.group ?? '') ? (saved.group as string) : settings.groups[0] }));
    setRecent(getRecent()); setVib(isHapticsOn()); setSnd(!isMuted());
    const simOn = new URLSearchParams(location.search).get('sim') === '1';
    setSim(simOn);
    detectCapabilities().then((c) => {
      setCaps(c);
      const m: Mode = simOn ? 'sim' : c.xr ? '6dof' : c.motion ? 'motion' : 'touch';
      setMode(m); setAuto(m);
    });
    void refreshConfig().then((r) => setRevoked(r === 'revoked'));
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
  const PRO = core.PROTOCOL as { sessions: number; perWeek: number; weeks: number };
  const sessionLine = !parsed.success ? 'Use the study code, never a name.' : !sessionNo ? 'Checking…'
    : sessionNo <= PRO.sessions ? `Session ${sessionNo} of ${PRO.sessions}, week ${Math.ceil(sessionNo / PRO.perWeek)} of ${PRO.weeks}.` : `Session ${sessionNo}: beyond the ${PRO.sessions}-session protocol.`;
  const playMin = Math.round((p.games.length * adv.trialsPerGame * adv.trialSec) / 60);

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
  function back() { setErr(null); if (step > 0) { setStep((step - 1) as 0 | 1); window.scrollTo?.(0, 0); } else onHome(); }

  function start() {
    if (!parsed.success) { setErr(parsed.error.issues[0].message); setStep(0); return; }
    if (!p.games.length) { setErr('Choose at least one game.'); setStep(1); return; }
    if (!avail(mode)) { setErr('That tracking mode is not available on this phone.'); return; }
    if (!briefed) { setErr('Please confirm the participant has been told about possible pain and tiredness.'); return; }
    setErr(null);
    pushRecent(parsed.data); setPrefs(p);
    let seed = 0;
    try { seed = crypto.getRandomValues(new Uint32Array(1))[0]; } catch { seed = Math.floor(Math.random() * 2 ** 32); }
    const games = GAME_KEYS.filter((g) => p.games.includes(g)) as GameKey[];
    onStart({
      participantId: parsed.data, sessionNo: sessionNo ?? 1, group: p.group, therapist: p.therapist.trim().toUpperCase().slice(0, 10), affectedSide: p.side, handMode: p.handMode,
      mode, level: p.level as 1 | 2 | 3, games, trialsPerGame: adv.trialsPerGame, trialSec: adv.trialSec, dwellMs: adv.dwellMs,
      itemTimeoutSec: adv.itemTimeoutSec, camera: p.camera || mode === '6dof' ? 'on' : 'off', homeGate: p.homeGate, practice: p.practice, distance: p.distance, objectSize: p.objectSize, order: p.order, briefed: true,
      device: `${navigator.userAgent.slice(0, 180)} | ${screen.width}x${screen.height}@${window.devicePixelRatio}`, seed, skipRange: adv.skipRange
    });
  }

  const num = (k: keyof typeof adv, min: number, max: number) => (e: React.ChangeEvent<HTMLInputElement>) => setAdv((a) => ({ ...a, [k]: Math.max(min, Math.min(max, Math.round(+e.target.value || min))) }));
  const toggleGame = (g: GameKey) => setP((x) => ({ ...x, games: x.games.includes(g) ? x.games.filter((y) => y !== g) : [...x.games, g] }));
  const cmOf = (l: 1 | 2 | 3) => core.LEVELS[l].cm as number;
  const nObj = (l: 1 | 2 | 3) => core.objectCount('maths', l) as number;
  const orderLabel = (core.ORDER_MODES as { key: Order; label: string; help: string }[]).find((o) => o.key === p.order);

  return (
    <main className="wrap has-dock">
      <div className="topbar">
        <button type="button" className="back" onClick={onHome}>← Home</button>
        <div className="top-right">
          {revoked && <span className="chip bad">Phone removed</span>}
          <button type="button" className="back" onClick={() => onGuide()}>Guide</button>
        </div>
      </div>

      <div className="progress" role="progressbar" aria-valuemin={1} aria-valuemax={3} aria-valuenow={step + 1} aria-label={`Step ${step + 1} of 3`}>
        {[0, 1, 2].map((i) => <i key={i} className={i <= step ? 'on' : ''} />)}
      </div>

      {step === 0 && (
        <>
          <div className="step-title"><span className="eyebrow">Step 1 of 3</span><h1>Who is playing?</h1></div>
          {revoked && <p className="notice bad" role="alert"><b>The study team removed this phone.</b> You can still play and download each sheet, but nothing uploads. Ask the study team if this is a mistake.</p>}
          <div className="panel form">
            <div className="field">
              <label htmlFor="pid">Participant ID</label>
              <input id="pid" className="input big" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} autoComplete="off" autoCapitalize="characters" spellCheck={false} inputMode="text"
                placeholder="P001" aria-invalid={!!code && !parsed.success} aria-describedby="pid-hint" maxLength={20} />
              <span id="pid-hint" className="hint">{sessionLine}</span>
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
        </>
      )}

      {step === 1 && (
        <>
          <div className="step-title"><span className="eyebrow">Step 2 of 3 · {parsed.success ? parsed.data : ''}</span><h1>Set up the session</h1></div>

          <section className="sec" aria-labelledby="s-who">
            <h2 id="s-who">Participant</h2>
            <div className="panel form">
              <Seg name="side" label="Affected side" value={p.side} options={SIDES.map((s) => ({ v: s, t: SIDE_LABEL[s] }))} onChange={(v) => setP({ ...p, side: v })} />
              <Seg name="hand" label="Hand use" value={p.handMode} options={HAND_MODES.map((s) => ({ v: s, t: s === HAND_MODES[0] ? 'Affected hand alone' : 'Assisted by other hand' }))} onChange={(v) => setP({ ...p, handMode: v })} />
            </div>
          </section>

          <section className="sec" aria-labelledby="s-hard">
            <h2 id="s-hard">How hard</h2>
            <div className="field" role="radiogroup" aria-label="Level">
              <div className="levels">
                {([1, 2, 3] as const).map((l) => (
                  <button key={l} type="button" role="radio" aria-checked={p.level === l} className="level" onClick={() => setP({ ...p, level: l })}>
                    <LevelGlyph n={l} /><b>Level {l}</b><span>{linear ? `${cmOf(l)} cm reach` : 'Turn to aim'}</span><span>{nObj(l)} objects</span>
                  </button>
                ))}
              </div>
              <span className="hint">Higher levels make the phone travel further and put more objects on the screen at once.</span>
            </div>
          </section>

          <section className="sec" aria-labelledby="s-lay">
            <h2 id="s-lay">How it looks</h2>
            <div className="panel form">
              <Picks label="Object distance" value={p.distance} onChange={(v) => setP({ ...p, distance: v })} options={DIST_OPTS.map((o) => ({ ...o, art: <ArtDistance kind={o.v} /> }))}
                hint="Close fits fewer, bigger objects near the middle. Far spreads smaller objects over the whole screen." />
              <Picks label="Object size" value={p.objectSize} onChange={(v) => setP({ ...p, objectSize: v })} options={SIZE_OPTS.map((o) => ({ ...o, art: <ArtSize kind={o.v} /> }))} />
            </div>
          </section>

          <section className="sec" aria-labelledby="s-games">
            <h2 id="s-games">Games</h2>
            <div className="tiles">
              {GAME_KEYS.map((g) => (
                <button key={g} type="button" className="tile" aria-pressed={p.games.includes(g)} onClick={() => toggleGame(g)}>
                  <GameGlyph g={g} />
                  <span><b>{GAME_INFO[g].name}</b><span className="d">{GAME_INFO[g].blurb}</span></span>
                  <span className="tick"><Tick /></span>
                </button>
              ))}
            </div>
            <div className="panel form" style={{ marginTop: 14 }}>
              <Picks label="Order of the games" cols={2} value={p.order} onChange={(v) => setP({ ...p, order: v })}
                options={(core.ORDER_MODES as { key: Order; label: string; help: string }[]).map((o) => ({ v: o.key, t: o.label, art: <ArtOrder mode={o.key} /> }))}
                hint={orderLabel?.help} />
              <label className="check"><input type="checkbox" checked={p.practice} onChange={(e) => setP({ ...p, practice: e.target.checked })} /><span>Practice trial before each game<small>A short warm-up (up to 20 s) so the participant learns the game, as in the study. It is not recorded or scored.</small></span></label>
            </div>
          </section>

          <details className="adv">
            <summary>More settings</summary>
            <div className="form" style={{ paddingTop: 12 }}>
              <div className="grid2">
                <div className="field"><label htmlFor="tpg">Trials per game</label><input id="tpg" className="input" type="number" inputMode="numeric" min={1} max={20} value={adv.trialsPerGame} onChange={num('trialsPerGame', 1, 20)} /></div>
                <div className="field"><label htmlFor="ts">Trial length (seconds)</label><input id="ts" className="input" type="number" inputMode="numeric" min={10} max={300} value={adv.trialSec} onChange={num('trialSec', 10, 300)} /></div>
                <div className="field"><label htmlFor="dw">Hold to touch (ms)</label><input id="dw" className="input" type="number" inputMode="numeric" min={100} max={1500} step={50} value={adv.dwellMs} onChange={num('dwellMs', 100, 1500)} /></div>
                <div className="field"><label htmlFor="it">Time per item (s)</label><input id="it" className="input" type="number" inputMode="numeric" min={3} max={60} value={adv.itemTimeoutSec} onChange={num('itemTimeoutSec', 3, 60)} /></div>
              </div>
              <p className="hint">The study used 5 trials of 120 seconds for each game: 30 minutes.</p>
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
              <div><span>Level</span><b>{p.level}{linear ? ` · ${cmOf(p.level as 1 | 2 | 3)} cm` : ''} · {nObj(p.level as 1 | 2 | 3)} objects</b></div>
              <div><span>Layout</span><b>{DIST_OPTS.find((o) => o.v === p.distance)?.t} · {SIZE_OPTS.find((o) => o.v === p.objectSize)?.t}</b></div>
              <div><span>Games</span><b>{GAME_KEYS.filter((g) => p.games.includes(g)).map((g) => GAME_INFO[g].name).join(', ')}</b></div>
              <div><span>Order</span><b>{orderLabel?.label}</b></div>
              <div><span>Plan</span><b>{adv.trialsPerGame} × {adv.trialSec} s each{p.practice ? ' + practice' : ''} · about {playMin} min</b></div>
            </div>
          </div>

          <div className="brief">
            <h3>Before you start</h3>
            <p>Tell the participant that reaching can cause shoulder or elbow pain and tiredness, that they should stop and say so if anything hurts, and that they can pause at any time.</p>
            <label className="check"><input type="checkbox" checked={briefed} onChange={(e) => { setBriefed(e.target.checked); setErr(null); }} /><span>I have told the participant</span></label>
          </div>

          <div className="panel flat">
            <h3>This phone</h3>
            <ul className="ready-list">
              <li className={mode === '6dof' || mode === 'sim' ? '' : mode === 'motion' ? 'warn' : 'bad'}><i>{mode === '6dof' || mode === 'sim' ? '✓' : '!'}</i>
                <span><b>{MODE_INFO[mode].title}.</b> {mode === '6dof' ? 'Real hand position in centimetres. Strap the phone to the hand and hold it at chest height.' : mode === 'motion'
                  ? `This phone cannot measure position, only rotation${caps?.isIos ? ' (Safari on iPhone does not offer AR position tracking)' : ''}. Reach is recorded in degrees and the session is flagged in the data.`
                  : MODE_INFO[mode].detail}</span></li>
              <li><i>✓</i><span><b>Camera.</b> {mode === '6dof' ? 'AR opens the rear camera.' : p.camera ? 'The game opens the rear camera; allow access when asked. Nothing is recorded or stored.' : 'Camera view is off.'}</span></li>
              <li className={revoked ? 'warn' : ''}><i>{revoked ? '!' : '✓'}</i><span><b>Upload.</b> {revoked ? 'This phone was removed from the study: the data stays on the phone. You can still download the sheet at the end.' : 'The session uploads by itself when it ends, or later when the phone is online.'}</span></li>
              {caps && !caps.secure && <li className="bad"><i>!</i><span><b>Not https.</b> The browser blocks AR, the camera and motion sensors on pages that are not secure.</span></li>}
            </ul>
            <div className="toggles">
              <label className="switch"><IconVibrate /><span><b>Vibration</b><small>{hapticsKind() === 'vibrate' ? 'Feel each touch' : 'Not on this phone'}</small></span>
                <input type="checkbox" checked={vib} onChange={(e) => { setVib(e.target.checked); setHapticsOn(e.target.checked); }} /><i aria-hidden="true" /></label>
              <label className="switch"><IconSound /><span><b>Sound</b><small>Tones for touches</small></span>
                <input type="checkbox" checked={snd} onChange={(e) => { setSnd(e.target.checked); setMuted(!e.target.checked); if (e.target.checked) { sfxUnlock(); sfx('ok'); } }} /><i aria-hidden="true" /></label>
            </div>
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

      <div className="dock"><div>
        <button type="button" className="btn" onClick={back}>{step === 0 ? 'Home' : 'Back'}</button>
        {step < 2
          ? <button type="button" className="btn primary" onClick={next}>Next</button>
          : <button type="button" className="btn yellow" onClick={start}>Start session</button>}
      </div></div>
    </main>
  );
}
