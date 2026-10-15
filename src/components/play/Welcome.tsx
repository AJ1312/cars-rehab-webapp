'use client';
import { useEffect, useRef, useState } from 'react';
import { ArtHero, ArtInit, ArtStrap, ArtUploads } from '@/components/ui/Art';

const KEY = 'cars.welcome.v2';
export const welcomeSeen = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return true; } };
const markSeen = () => { try { localStorage.setItem(KEY, '1'); } catch { /* ignore */ } };

const SLIDES = [
  { tone: 'cobalt', art: <ArtHero />, h: 'Reach. Touch. Recover.', p: 'Three short games where you move the phone through the air to touch floating triangles, numbers and words. The phone records how the hand moves.' },
  { tone: 'yellow', art: <ArtStrap />, h: 'Strap it on', p: 'Fix the phone over the back of the affected hand, camera facing out. Hold it at chest height with the elbow comfortable. The camera picture shows the room behind the game.' },
  { tone: 'ink', art: <ArtInit />, h: 'Calibrate, then play', p: 'Move the phone left and right for 5 seconds so tracking locks on, hold still to set the centre, then a short practice. After that the trials start by themselves.' },
  { tone: 'cream', art: <ArtUploads />, h: 'The data builds itself', p: 'When the games end, an Excel sheet with every trial, every reach and the sensor quality is ready to download. Sessions also upload on their own when the phone is online.' }
] as const;

export function Welcome({ onClose }: { onClose: (openGuide: boolean) => void }) {
  const [i, setI] = useState(0);
  const nextRef = useRef<HTMLButtonElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const touch = useRef<number | null>(null);
  const last = i === SLIDES.length - 1;
  const close = (g: boolean) => { markSeen(); onClose(g); };

  useEffect(() => { boxRef.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') close(false); if (e.key === 'ArrowRight') setI((x) => Math.min(SLIDES.length - 1, x + 1)); if (e.key === 'ArrowLeft') setI((x) => Math.max(0, x - 1)); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  });

  return (
    <div className="scrim" role="presentation">
      <div className="welcome" role="dialog" aria-modal="true" aria-labelledby="wl-h" tabIndex={-1} ref={boxRef}
        onTouchStart={(e) => { touch.current = e.touches[0].clientX; }}
        onTouchEnd={(e) => { if (touch.current == null) return; const dx = e.changedTouches[0].clientX - touch.current; touch.current = null; if (dx < -50) setI((x) => Math.min(SLIDES.length - 1, x + 1)); if (dx > 50) setI((x) => Math.max(0, x - 1)); }}>
        <button type="button" className="wl-skip" onClick={() => close(false)}>Skip</button>
        <div className="wl-track" style={{ transform: `translateX(${-i * 100}%)` }}>
          {SLIDES.map((s, k) => (
            <section key={k} className={'wl-slide ' + s.tone} aria-hidden={k !== i} aria-roledescription="slide" aria-label={`${k + 1} of ${SLIDES.length}`}>
              <div className="wl-art">{s.art}</div>
              <h2 id={k === i ? 'wl-h' : undefined}>{s.h}</h2>
              <p>{s.p}</p>
            </section>
          ))}
        </div>
        <div className="wl-dots" aria-hidden="true">{SLIDES.map((_, k) => <i key={k} className={k === i ? 'on' : ''} />)}</div>
        <div className="wl-btns">
          {last ? (
            <>
              <button type="button" className="btn" onClick={() => close(true)}>Open the guide</button>
              <button type="button" className="btn yellow" ref={nextRef} onClick={() => close(false)}>Let’s go</button>
            </>
          ) : (
            <>
              <button type="button" className="btn" onClick={() => setI(Math.max(0, i - 1))} disabled={i === 0}>Back</button>
              <button type="button" className="btn yellow" ref={nextRef} onClick={() => setI(i + 1)}>Next</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
