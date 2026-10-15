'use client';
import { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { getSession, keepStorage, saveSession, syncAll, type StoredSession } from '@/lib/client/local';
import type { Screen } from './types';
import { Setup } from './Setup';
import { History } from './History';
import { Questions } from './Questions';
import { Done } from './Done';

// The game engine and renderer load only when a session starts: the setup screen stays small and fast.
const StageScreen = dynamic(() => import('./StageScreen').then((m) => m.StageScreen), { ssr: false, loading: () => <div className="wrap"><p className="muted">Loading the game…</p></div> });

export function PlayApp() {
  const [screen, setScreen] = useState<Screen>({ name: 'setup' });

  // Upload anything waiting whenever the app opens or the connection returns.
  useEffect(() => {
    const go = () => { void syncAll(); };
    go(); void keepStorage();
    window.addEventListener('online', go);
    const iv = window.setInterval(() => { if (document.visibilityState === 'visible') go(); }, 60_000);
    return () => { window.removeEventListener('online', go); window.clearInterval(iv); };
  }, []);

  const finishRun = useCallback(async (stored: StoredSession) => {
    await saveSession(stored);            // safe on the phone first, before anything touches the network
    setScreen({ name: 'questions', stored });
  }, []);

  const saveWithAnswers = useCallback(async (stored: StoredSession) => {
    await saveSession(stored);
    void syncAll();
    setScreen({ name: 'done', id: stored.id });
  }, []);

  switch (screen.name) {
    case 'setup': return <Setup initialCode={screen.code} onStart={(cfg) => setScreen({ name: 'stage', cfg })} onHistory={() => setScreen({ name: 'history' })} />;
    case 'history': return <History onBack={() => setScreen({ name: 'setup' })} onOpen={(id) => setScreen({ name: 'done', id })} />;
    case 'stage': return <StageScreen cfg={screen.cfg} onFinished={finishRun} onExit={() => setScreen({ name: 'setup' })} />;
    case 'questions': return <Questions stored={screen.stored} onSave={saveWithAnswers} />;
    case 'done': return <Done id={screen.id} load={getSession} onNew={(code) => setScreen({ name: 'setup', ...(code ? { code } : {}) } as Screen)} onHistory={() => setScreen({ name: 'history' })} />;
  }
}
