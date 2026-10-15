'use client';
import { useEffect, useRef, useState } from 'react';
import { ArtDistance, ArtHold, ArtInit, ArtOrder, ArtScreen, ArtSize, ArtStrap } from '@/components/ui/Art';
import { GameGlyph } from '@/components/ui/Glyphs';
import core from '@/lib/core';

const SECTIONS: { id: string; label: string }[] = [
  { id: 'quick', label: 'Quick start' },
  { id: 'hold', label: 'Holding the phone' },
  { id: 'games', label: 'The games' },
  { id: 'levels', label: 'Level and layout' },
  { id: 'tracking', label: 'Tracking' },
  { id: 'safety', label: 'Safety' },
  { id: 'data', label: 'Your data' },
  { id: 'fix', label: 'If it goes wrong' }
];

const FIXES: [string, string][] = [
  ['The camera does not open', 'Allow the camera when the browser asks. If you said no, open the browser’s site settings and allow it. The page must be https, and no other app may be using the camera.'],
  ['“Tracking lost” keeps appearing', 'Use a bright room and point at something with texture: a plain white wall gives AR nothing to hold on to. The clock pauses while tracking is lost, nothing is counted against the participant. Press Centre, or calibrate again.'],
  ['Not all objects are on the screen', 'Choose Far and Small in the setup: objects become smaller and spread over the whole screen. Holding the phone in landscape gives much more room.'],
  ['The phone does not vibrate', 'Vibration works on Android. Safari on iPhone has no vibration for web pages, so the app gives sound and picture feedback there. Check that Vibration is on in the game’s pause menu, and that the phone is not in silent or battery-saver mode.'],
  ['iPhone asks for motion access', 'Tap Allow. If it was refused, open Settings, Safari, and switch on Motion & Orientation Access, then reload.'],
  ['A session did not upload', 'It is safe on the phone. When the phone is online it uploads by itself, or open Sessions on this phone and tap Upload now. You can always download the Excel sheet.']
];

export function Guide({ onBack, onStart, onTour, section }: { onBack: () => void; onStart: () => void; onTour: () => void; section?: string }) {
  const [active, setActive] = useState(section || 'quick');
  const nav = useRef<HTMLDivElement>(null);
  const L1 = core.LEVELS[1].cm, L2 = core.LEVELS[2].cm, L3 = core.LEVELS[3].cm;

  useEffect(() => {
    if (section) document.getElementById('g-' + section)?.scrollIntoView({ block: 'start' });
    else window.scrollTo?.(0, 0);
  }, [section]);

  useEffect(() => {
    const els = SECTIONS.map((s) => document.getElementById('g-' + s.id)).filter(Boolean) as HTMLElement[];
    if (!('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver((entries) => {
      const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (vis) setActive(vis.target.id.slice(2));
    }, { rootMargin: '-90px 0px -65% 0px' });
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, []);

  useEffect(() => { // keep the active chip in view
    nav.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [active]);

  const go = (id: string) => { document.getElementById('g-' + id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); setActive(id); };

  return (
    <main className="wrap has-dock guide">
      <div className="topbar"><button type="button" className="back" onClick={onBack}>← Home</button><span className="eyebrow">Guide</span></div>
      <div className="g-hero">
        <h1>How it works</h1>
        <p className="muted">Everything you need to run a session, in about two minutes.</p>
      </div>

      <div className="g-nav" ref={nav} role="navigation" aria-label="Guide sections">
        {SECTIONS.map((s) => <button key={s.id} type="button" aria-current={active === s.id ? 'true' : undefined} onClick={() => go(s.id)}>{s.label}</button>)}
      </div>

      <section id="g-quick" className="g-sec">
        <h2>Quick start</h2>
        <ol className="steps">
          <li><span><b>Strap on.</b> Phone over the back of the affected hand, camera facing out.</span></li>
          <li><span><b>Set up.</b> Enter the study code, choose the level, tap Start.</span></li>
          <li><span><b>Calibrate.</b> Move the phone left and right for 5 seconds, then hold still on the ring. That spot becomes the centre.</span></li>
          <li><span><b>Practise.</b> Each game starts with a short practice that is not recorded.</span></li>
          <li><span><b>Play.</b> Reach, touch, repeat. When it ends, the Excel sheet is ready.</span></li>
        </ol>
        <div className="g-fig"><ArtInit /></div>
        <p className="small muted">First time? <button type="button" className="inline" onClick={onTour}>Replay the welcome tour</button>.</p>
      </section>

      <section id="g-hold" className="g-sec">
        <h2>Holding the phone</h2>
        <div className="g-fig"><ArtStrap /></div>
        <p>Strap the phone over the back of the hand so it moves exactly with it. A fingerless glove with the phone fixed on top works well for people who cannot hold a phone. The screen should face the participant.</p>
        <div className="g-fig"><ArtHold /></div>
        <p>Sit or stand comfortably and hold the phone about chest height in front of you. The starting position is wherever you hold still during calibration; every reach is measured from it.</p>
        <div className="g-two">
          <div className="g-card"><b>Affected hand alone</b><span>The affected arm moves the phone. This is the main method.</span></div>
          <div className="g-card"><b>Assisted by the other hand</b><span>The unaffected hand supports or guides the affected one. Record which one you used in the setup.</span></div>
        </div>
      </section>

      <section id="g-games" className="g-sec">
        <h2>The games</h2>
        <p className="muted">Touch an object by moving the phone into it and holding for a quarter of a second. Score, time and the question stay on the screen; objects float around them.</p>
        <article className="g-game">
          <ArtScreen game="triangle" />
          <div><h3><GameGlyph g="triangle" className="gg" />Triangle Reach</h3>
            <p>Several triangles float far apart. Touch every one, in any order. Each new set appears in different places, so the arm reaches up, down, left, right, near and far.</p></div>
        </article>
        <article className="g-game">
          <ArtScreen game="maths" />
          <div><h3><GameGlyph g="maths" className="gg" />Maths Fun</h3>
            <p>A sum such as 8 − 4 appears in the middle. Numbers float around it; touch the answer. Only addition and subtraction with numbers from 1 to 10.</p></div>
        </article>
        <article className="g-game">
          <ArtScreen game="colour" />
          <div><h3><GameGlyph g="colour" className="gg" />Colour Merge Test</h3>
            <p>A colour name appears in the middle. Words float around it, each printed in a coloured ink. Touch the word whose <b>ink</b> is the colour named. Ignore what the words say; that is the challenge.</p></div>
        </article>
        <p className="small">Each correct touch scores one point. A wrong touch is counted as an error and cannot be repeated. If an item takes longer than the time limit it is skipped.</p>
      </section>

      <section id="g-levels" className="g-sec">
        <h2>Level and layout</h2>
        <div className="g-table">
          <div><b>Level 1</b><span>About {L1} cm forward reach · 3 objects at a time</span></div>
          <div><b>Level 2</b><span>About {L2} cm · 4 objects</span></div>
          <div><b>Level 3</b><span>About {L3} cm · 5 objects</span></div>
        </div>
        <h3>Close, Medium, Far</h3>
        <div className="g-three">
          <figure><ArtDistance kind="near" /><figcaption><b>Close</b>Bigger, packed towards the middle</figcaption></figure>
          <figure><ArtDistance kind="medium" /><figcaption><b>Medium</b>Balanced</figcaption></figure>
          <figure><ArtDistance kind="far" /><figcaption><b>Far</b>Smaller, spread over the whole screen</figcaption></figure>
        </div>
        <h3>Object size</h3>
        <div className="g-three">
          <figure><ArtSize kind="small" /><figcaption><b>Small</b></figcaption></figure>
          <figure><ArtSize kind="medium" /><figcaption><b>Medium</b></figcaption></figure>
          <figure><ArtSize kind="large" /><figcaption><b>Large</b></figcaption></figure>
        </div>
        <h3>Order of the games</h3>
        <div className="g-orders">
          {core.ORDER_MODES.map((m: { key: 'random' | 'fixed' | 'rotate' | 'mixed'; label: string; help: string }) => (
            <div key={m.key}><ArtOrder mode={m.key} /><span><b>{m.label}</b>{m.help}</span></div>
          ))}
        </div>
        <p className="small muted">Every set of objects is placed at random on the screen, away from the score, the timer and the question, and never on top of each other. The protocol in the study was 5 trials of 2 minutes for each game.</p>
      </section>

      <section id="g-tracking" className="g-sec">
        <h2>Tracking</h2>
        <div className="g-two">
          <div className="g-card"><b>Android, Chrome</b><span>Real position tracking with AR: the app measures how far the hand moves, in centimetres, and the reach path is recorded. This is the research mode.</span></div>
          <div className="g-card"><b>iPhone, Safari</b><span>Safari does not offer AR position tracking to web pages. The app uses the phone’s rotation instead: turn the phone so the ring on the screen lands on the object. Reach is recorded in degrees and flagged in the data.</span></div>
        </div>
        <ul className="plain">
          <li>The <b>Centre</b> button makes the current position the new centre.</li>
          <li>If tracking is lost, the game pauses by itself and the clock stands still. The screen edge pulses red.</li>
          <li>Vibration confirms each touch on Android phones, with a longer buzz when a trial ends. Switch it off in the pause menu.</li>
          <li>The camera picture is only shown behind the game. Nothing is recorded or stored from it.</li>
        </ul>
      </section>

      <section id="g-safety" className="g-sec">
        <h2>Safety</h2>
        <div className="g-warn">
          <b>Tell the participant before starting</b>
          <p>Reaching can cause shoulder or elbow pain and tiredness. They should stop and tell you if anything hurts, and they can rest at any time with the Pause button. Do not push through pain.</p>
        </div>
        <ul className="plain">
          <li>The protocol used 30 minutes of these games a day, 5 days a week, for 2 weeks.</li>
          <li>Rest between trials. Use the practice trial to learn the games without effort.</li>
          <li>At the end, tick any pain, tiredness or dizziness. It is saved with the session.</li>
          <li>This app supports rehabilitation research. It is not a medical device and does not replace a therapist.</li>
        </ul>
      </section>

      <section id="g-data" className="g-sec">
        <h2>Your data</h2>
        <p>When a session ends, the app builds an Excel workbook on the phone. Nothing to export or set up.</p>
        <div className="g-chips">{['Session', 'Trial_Summary', 'Game_Summary', 'Events', 'Kinematics', 'Sensor_Quality', 'Questionnaire', 'Progress', 'Data_Dictionary'].map((s) => <span key={s}>{s}</span>)}</div>
        <ul className="plain">
          <li>One row per trial and per object touched: reaction time, movement time, path length, path efficiency, range of motion.</li>
          <li>Every sheet has clear column names. The Data_Dictionary sheet explains each one.</li>
          <li>Sessions stay safely on the phone and upload by themselves when it is online. The study team opens them in the admin board.</li>
        </ul>
      </section>

      <section id="g-fix" className="g-sec">
        <h2>If something goes wrong</h2>
        <div className="g-fixes">
          {FIXES.map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}
        </div>
      </section>

      <div className="dock"><div>
        <button type="button" className="btn" onClick={onBack}>Home</button>
        <button type="button" className="btn yellow" onClick={onStart}>Start a session</button>
      </div></div>
    </main>
  );
}
