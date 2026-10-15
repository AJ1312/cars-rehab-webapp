/* Vibration feedback. The paper's system gives a short vibration when a task is completed (the "central-peripheral-central
 * closed loop": the hand feels the success). Android browsers support navigator.vibrate. Safari on iPhone does not offer a
 * vibration API at all; the only haptic a web page can trigger there is the tick of a switch control, and only straight after
 * a real tap. So on iPhone buttons give a best-effort tick and the game relies on sound and the picture instead. */

export type Haptic = 'tick' | 'ok' | 'bad' | 'set' | 'go' | 'end' | 'lost' | 'back' | 'cal' | 'tap';

const PATTERNS: Record<Haptic, number | number[]> = {
  tick: 8,                      // the phone has entered an object
  ok: 30,                       // correct touch
  bad: [45, 45, 45],            // wrong touch
  set: [24, 40, 56],            // every triangle of the set touched
  go: 40,                       // trial starts
  end: [70, 60, 70, 60, 150],   // trial finished (task completion)
  lost: [140, 90, 140],         // tracking lost
  back: 22,                     // tracking is back
  cal: [30, 40, 30],            // calibration accepted
  tap: 7                        // a button press
};

const KEY = 'cars.haptics';
let on = true;
try { on = localStorage.getItem(KEY) !== '0'; } catch { /* storage unavailable: keep the default */ }

export const isHapticsOn = () => on;
export function setHapticsOn(v: boolean) {
  on = v;
  try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* ignore */ }
  if (v) haptic('ok');
}

/** 'vibrate' (Android and others), 'taps' (iPhone: switch tick on taps only) or 'none'. */
export function hapticsKind(): 'vibrate' | 'taps' | 'none' {
  if (typeof navigator === 'undefined') return 'none';
  if (typeof navigator.vibrate === 'function') return 'vibrate';
  const ua = navigator.userAgent || '';
  const ios = /iPad|iPhone|iPod/.test(ua) || (ua.includes('Mac') && (navigator.maxTouchPoints || 0) > 1);
  return ios ? 'taps' : 'none';
}

let sw: HTMLLabelElement | null = null;
function iosTick() {
  try {
    if (!sw) {
      sw = document.createElement('label');
      sw.setAttribute('aria-hidden', 'true');
      sw.style.cssText = 'position:fixed;left:-100px;top:-100px;width:1px;height:1px;opacity:0;pointer-events:none;overflow:hidden';
      const input = document.createElement('input');
      input.type = 'checkbox'; input.setAttribute('switch', ''); input.tabIndex = -1;
      sw.appendChild(input);
      document.body.appendChild(sw);
    }
    sw.click();
  } catch { /* no haptic available */ }
}

export function haptic(kind: Haptic) {
  if (!on) return;
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(PATTERNS[kind]);
    else if (kind === 'tap' || kind === 'ok' || kind === 'bad' || kind === 'end') iosTick();   // only works inside a tap; otherwise silently nothing
  } catch { /* not supported */ }
}

/** A light tick on every button press, everywhere in the app. */
export function installTapHaptics() {
  if (typeof document === 'undefined') return () => undefined;
  const h = (e: Event) => {
    const el = e.target as HTMLElement | null;
    if (el?.closest?.('button, a.btn, .seg label, .scale label, .check, .tile, .level, .pick, summary')) haptic('tap');
  };
  document.addEventListener('click', h, true);
  return () => document.removeEventListener('click', h, true);
}
