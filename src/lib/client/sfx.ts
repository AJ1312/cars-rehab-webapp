/* Tiny sound cues (Web Audio, no files). Sound helps people who cannot look at the screen while reaching.
 * The audio context is created from a tap, as browsers require. Muting is remembered on the phone. */

export type Cue = 'ok' | 'bad' | 'tick' | 'go' | 'lost' | 'back' | 'end';

let ctx: AudioContext | null = null;
let muted = false;
try { muted = localStorage.getItem('cars.mute') === '1'; } catch { /* storage unavailable */ }

export function sfxUnlock() {
  try {
    if (!ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AC) ctx = new AC();
    }
    if (ctx && ctx.state === 'suspended') void ctx.resume();
  } catch { /* no audio */ }
}
export function isMuted() { return muted; }
export function setMuted(m: boolean) {
  muted = m;
  try { localStorage.setItem('cars.mute', m ? '1' : '0'); } catch { /* ignore */ }
}

function tone(freq: number, start: number, dur: number, type: OscillatorType = 'sine', gain = 0.16, slideTo?: number) {
  if (!ctx) return;
  const t0 = ctx.currentTime + start;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t0);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t0); o.stop(t0 + dur + 0.02);
}

export function sfx(cue: Cue) {
  if (muted || !ctx || ctx.state !== 'running') return;
  switch (cue) {
    case 'ok': tone(660, 0, 0.12, 'sine', 0.18); tone(990, 0.09, 0.2, 'sine', 0.16); break;
    case 'bad': tone(190, 0, 0.18, 'triangle', 0.2, 120); break;
    case 'tick': tone(520, 0, 0.09, 'sine', 0.12); break;
    case 'go': tone(780, 0, 0.22, 'sine', 0.18); tone(1170, 0.06, 0.26, 'sine', 0.12); break;
    case 'lost': tone(420, 0, 0.14, 'triangle', 0.16); tone(300, 0.14, 0.22, 'triangle', 0.16); break;
    case 'back': tone(520, 0, 0.08, 'sine', 0.1); tone(700, 0.07, 0.1, 'sine', 0.1); break;
    case 'end': tone(523, 0, 0.16, 'sine', 0.16); tone(659, 0.14, 0.16, 'sine', 0.16); tone(784, 0.28, 0.3, 'sine', 0.16); break;
  }
}
