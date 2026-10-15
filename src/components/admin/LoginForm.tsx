'use client';
import { useState } from 'react';

export function LoginForm() {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [code, setCode] = useState('');
  const [needCode, setNeedCode] = useState(false); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, code: code || undefined }) });
      const j = await r.json().catch(() => ({}));
      if (r.ok) { location.href = '/admin'; return; }
      if (j.needCode) { setNeedCode(true); setErr(j.error || null); } else setErr(j.error || 'Could not sign in');
    } catch { setErr('No connection'); }
    setBusy(false);
  }
  return (
    <form className="panel form" onSubmit={submit}>
      <div className="field"><label htmlFor="em">Email</label><input id="em" className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required disabled={needCode} /></div>
      <div className="field"><label htmlFor="pw">Password</label><input id="pw" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required disabled={needCode} /></div>
      {needCode && <div className="field"><label htmlFor="cd">6-digit code from your authenticator app</label><input id="cd" className="input" inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} autoFocus required /></div>}
      {err && <p className="error-msg" role="alert">{err}</p>}
      <button className="btn primary block" disabled={busy}>{busy ? 'Signing in…' : needCode ? 'Verify and sign in' : 'Sign in'}</button>
    </form>
  );
}
