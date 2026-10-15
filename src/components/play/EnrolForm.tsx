'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Brand } from '@/components/ui/Brand';
import { enrolDevice, getDevice, setDevice } from '@/lib/client/local';

export function EnrolForm() {
  const [code, setCode] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  const [err, setErr] = useState<string | null>(null);
  const [label, setLabel] = useState<string | null>(null);
  const [iosTab, setIosTab] = useState(false);

  useEffect(() => {
    const c = new URLSearchParams(location.search).get('code'); if (c) setCode(c.toUpperCase());
    const d = getDevice(); if (d) setLabel(d.label);
    // iPhone: a Home Screen app and Safari keep separate storage, so enrol in the one that will be used for play.
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const standalone = (navigator as unknown as { standalone?: boolean }).standalone === true || window.matchMedia?.('(display-mode: standalone)').matches;
    setIosTab(ios && !standalone);
  }, []);

  async function go(e: React.FormEvent) {
    e.preventDefault(); setState('busy'); setErr(null);
    const r = await enrolDevice(code);
    if (r.ok) { setLabel(r.device.label); setState('done'); } else { setErr(r.error); setState('idle'); }
  }

  return (
    <main className="wrap">
      <div className="topbar"><Brand /></div>
      <section className="hero"><h1>Enrol this phone</h1><p>Scan the QR code from the admin board (Devices page), or type the 8-character code. Each code works once.</p></section>
      {state === 'done' ? (
        <div className="panel"><p className="chip ok">Enrolled as {label}</p><p>Sessions on this phone now upload to the study automatically.</p><Link className="btn primary" href="/">Start a session</Link></div>
      ) : (
        <form className="panel form" onSubmit={go}>
          {iosTab && <p className="notice">On iPhone, enrol where you will play. If this app is (or will be) added to the Home Screen, open it from the Home Screen and enrol there: Safari and the Home Screen app do not share their saved data.</p>}
          {label && <p className="notice">Already enrolled as <b>{label}</b>. Enrolling again replaces it.</p>}
          <div className="field"><label htmlFor="code">Enrolment code</label>
            <input id="code" className="input" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} autoCapitalize="characters" autoComplete="off" spellCheck={false} placeholder="ABCD-2345" maxLength={12} style={{ fontSize: 24, letterSpacing: '0.12em', textAlign: 'center' }} required /></div>
          {err && <p className="error-msg" role="alert">{err}</p>}
          <button className="btn primary block" disabled={state === 'busy' || code.replace(/[^A-Z0-9]/gi, '').length < 8}>{state === 'busy' ? 'Enrolling…' : 'Enrol this phone'}</button>
          {label && <button type="button" className="btn danger block" onClick={() => { setDevice(null); setLabel(null); }}>Forget enrolment on this phone</button>}
        </form>
      )}
    </main>
  );
}
