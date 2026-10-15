'use client';
import { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { getSession, keepStorage, saveSession, syncAll, type StoredSession } from '@/lib/client/local';
import { installTapHaptics } from '@/lib/client/haptics';
import type { Mode } from '@/lib/client/sensors';
import type { SessionConfig } from '@/lib/client/engine';
import type { Screen } from './types';
import { Home } from './Home';
import { Setup } from './Setup';
import { History } from './History';
import { Questions } from './Questions';
import { Done } from './Done';
import { Guide } from './Guide';
import { Welcome, welcomeSeen } from './Welcome';

// The game engine and renderer load only when a session starts: the home screen stays small and fast.
const StageScreen = dynamic(() => import('./StageScreen').then((m) => m.StageScreen), { ssr: false, loading: () => <div className="wrap"><p className="muted">Loading the game…</p></div> });

/** A one-minute try-out: every game once, short, no calibration range check, nothing saved. */
function demoConfig(mode: Mode): SessionConfig {
  let seed = 0;
  try { seed = crypto.getRandomValues(new Uint32Array(1))[0]; } catch { seed = Math.floor(Math.random() * 2 ** 32); }
  return {
    participantId: 'DEMO', sessionNo: 1, group: 'Other', therapist: '', affectedSide: 'Not applicable', handMode: 'Affected hand alone',
    mode, level: 1, games: ['triangle', 'maths', 'colour'], trialsPerGame: 1, trialSec: 20, dwellMs: 250, itemTimeoutSec: 12,
    camera: 'on', homeGate: true, practice: false, distance: 'medium', objectSize: 'medium', order: 'fixed', briefed: true, demo: true, skipRange: true,
    device: 'demo', seed
  };
}

export function PlayApp() {
  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  const [welcome, setWelcome] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Upload anything waiting whenever the app opens or the connection returns.
  useEffect(() => {
    const go = () => { void syncAll(); };
    go(); void keepStorage();
    window.addEventListener('online', go);
    const iv = window.setInterval(() => { if (document.visibilityState === 'visible') go(); }, 60_000);
    const off = installTapHaptics();
    return () => { window.removeEventListener('online', go); window.clearInterval(iv); off(); };
  }, []);

  // First visit: a short welcome tour. It never shows again once closed; the Guide can replay it.
  useEffect(() => { if (!welcomeSeen() && !new URLSearchParams(location.search).has('sim')) setWelcome(true); }, []);
  useEffect(() => { if (!toast) return; const t = window.setTimeout(() => setToast(null), 3200); return () => window.clearTimeout(t); }, [toast]);

  const finishRun = useCallback(async (stored: StoredSession) => {
    await saveSession(stored);            // safe on the phone first, before anything touches the network
    setScreen({ name: 'questions', stored });
  }, []);

  const saveWithAnswers = useCallback(async (stored: StoredSession) => {
    await saveSession(stored);
    void syncAll();
    setScreen({ name: 'done', id: stored.id });
  }, []);

  const home = () => setScreen({ name: 'home' });
  let view: React.ReactNode = null;
  switch (screen.name) {
    case 'home': view = <Home onStart={(code) => setScreen({ name: 'setup', ...(code ? { code } : {}) })} onGuide={(section) => setScreen({ name: 'guide', section })} onDemo={(m) => setScreen({ name: 'stage', cfg: demoConfig(m) })} onHistory={() => setScreen({ name: 'history' })} />; break;
    case 'guide': view = <Guide section={screen.section} onBack={home} onStart={() => setScreen({ name: 'setup' })} onTour={() => setWelcome(true)} />; break;
    case 'setup': view = <Setup initialCode={screen.code} onHome={home} onGuide={(section) => setScreen({ name: 'guide', section })} onStart={(cfg) => setScreen({ name: 'stage', cfg })} />; break;
    case 'history': view = <History onBack={home} onOpen={(id) => setScreen({ name: 'done', id })} />; break;
    case 'stage': {
      const cfg = screen.cfg;
      view = <StageScreen key={cfg.seed} cfg={cfg} onFinished={cfg.demo ? async () => { setToast('That was a demo. Nothing was saved.'); home(); } : finishRun} onExit={home} />;
      break;
    }
    case 'questions': view = <Questions stored={screen.stored} onSave={saveWithAnswers} />; break;
    case 'done': view = <Done id={screen.id} load={getSession} onNew={(code) => setScreen({ name: 'setup', ...(code ? { code } : {}) })} onHistory={() => setScreen({ name: 'history' })} onHome={home} />; break;
  }
  return (
    <>
      {view}
      {welcome && <Welcome onClose={(g) => { setWelcome(false); if (g) setScreen({ name: 'guide' }); }} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </>
  );
}
