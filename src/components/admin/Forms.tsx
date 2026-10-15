'use client';
import { useActionState, useState } from 'react';
import { changePasswordAction, createEnrolmentAction, createStaffAction, resetStaffAction, saveSettingsAction, type ActionState } from '@/app/admin/(board)/actions';
import type { Settings } from '@/lib/schema';

const init: ActionState = {};

export function EnrolDeviceForm() {
  const [s, act, pending] = useActionState(createEnrolmentAction, init);
  return (
    <div className="panel">
      <h2>Enrol a new phone</h2>
      <form action={act} className="form">
        <div className="field"><label htmlFor="lab">Phone name</label><input id="lab" name="label" className="input" placeholder="Study phone 1" maxLength={40} required /><span className="hint">Shown in the data next to every session from this phone.</span></div>
        <button className="btn primary" disabled={pending}>{pending ? 'Creating…' : 'Create QR code'}</button>
      </form>
      {s.error && <p className="error-msg" role="alert">{s.error}</p>}
      {s.ok && s.qr && (
        <div className="form" role="status">
          <p><b>{s.label}</b> — open the camera on that phone and scan this code, or type the code on the Enrol page. It works once and expires in 24 hours.</p>
          <div className="qr"><img src={s.qr} alt={`QR code to enrol ${s.label}`} width={280} height={280} /></div>
          <div className="code-big">{s.code}</div>
          <p className="small muted" style={{ overflowWrap: 'anywhere' }}>{s.url}</p>
        </div>
      )}
    </div>
  );
}

export function StaffForm() {
  const [s, act, pending] = useActionState(createStaffAction, init);
  return (
    <form action={act} className="panel form">
      <h2>Add a staff account</h2>
      <div className="grid2">
        <div className="field"><label htmlFor="se">Email</label><input id="se" name="email" type="email" className="input" required autoComplete="off" /></div>
        <div className="field"><label htmlFor="sn">Name</label><input id="sn" name="name" className="input" maxLength={80} autoComplete="off" /></div>
        <div className="field"><label htmlFor="sr">Role</label><select id="sr" name="role" className="input" defaultValue="researcher"><option value="therapist">Therapist: view data</option><option value="researcher">Researcher: view and export</option><option value="admin">Admin: everything</option></select></div>
        <div className="field"><label htmlFor="sp">Temporary password</label><input id="sp" name="password" type="text" className="input" minLength={12} required autoComplete="off" /><span className="hint">At least 12 characters. Ask them to change it.</span></div>
      </div>
      {s.error && <p className="error-msg" role="alert">{s.error}</p>}
      {s.ok && <p className="chip ok" role="status">{s.message}</p>}
      <button className="btn primary" disabled={pending}>{pending ? 'Adding…' : 'Add account'}</button>
    </form>
  );
}

export function ResetForm({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const [s, act, pending] = useActionState(resetStaffAction, init);
  if (!open) return <button className="btn sm" onClick={() => setOpen(true)}>Reset password</button>;
  return (
    <form action={act} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      <input type="hidden" name="id" value={id} />
      <input name="password" className="input" style={{ width: 220 }} placeholder="New password (12+)" minLength={12} required autoComplete="off" />
      <button className="btn sm primary" disabled={pending}>Set</button>
      {s.error && <span className="error-msg">{s.error}</span>}{s.ok && <span className="chip ok">Done</span>}
    </form>
  );
}

export function SettingsForm({ v }: { v: Settings }) {
  const [s, act, pending] = useActionState(saveSettingsAction, init);
  return (
    <form action={act} className="panel form">
      <div className="grid2">
        <div className="field"><label htmlFor="a1">Trials per game</label><input id="a1" className="input" name="trialsPerGame" type="number" min={1} max={20} defaultValue={v.trialsPerGame} /></div>
        <div className="field"><label htmlFor="a2">Trial length (seconds)</label><input id="a2" className="input" name="trialSec" type="number" min={10} max={300} defaultValue={v.trialSec} /></div>
        <div className="field"><label htmlFor="a3">Hold time to touch (ms)</label><input id="a3" className="input" name="dwellMs" type="number" min={100} max={1500} step={50} defaultValue={v.dwellMs} /></div>
        <div className="field"><label htmlFor="a4">Time limit per item (seconds)</label><input id="a4" className="input" name="itemTimeoutSec" type="number" min={3} max={60} defaultValue={v.itemTimeoutSec} /></div>
        <div className="field"><label htmlFor="a5">Default reach level</label><select id="a5" className="input" name="level" defaultValue={v.level}><option value={1}>1 · 20 cm</option><option value={2}>2 · 30 cm</option><option value={3}>3 · 40 cm</option></select></div>
        <div className="field"><label htmlFor="a6">Study groups (comma separated)</label><input id="a6" className="input" name="groups" defaultValue={v.groups.join(', ')} /></div>
      </div>
      <p className="hint muted">These are the starting values on every enrolled phone. Therapists can still change them for a single session, and the values used are always written into the data sheet.</p>
      {s.error && <p className="error-msg" role="alert">{s.error}</p>}
      {s.ok && <p className="chip ok" role="status">{s.message}</p>}
      <button className="btn primary" disabled={pending}>{pending ? 'Saving…' : 'Save defaults'}</button>
    </form>
  );
}

export function PasswordForm() {
  const [s, act, pending] = useActionState(changePasswordAction, init);
  return (
    <form action={act} className="panel form">
      <h2>Change password</h2>
      <div className="field"><label htmlFor="cp">Current password</label><input id="cp" name="current" type="password" className="input" autoComplete="current-password" required /></div>
      <div className="field"><label htmlFor="np">New password (12+ characters)</label><input id="np" name="next" type="password" className="input" minLength={12} autoComplete="new-password" required /></div>
      {s.error && <p className="error-msg" role="alert">{s.error}</p>}
      {s.ok && <p className="chip ok" role="status">{s.message}</p>}
      <button className="btn primary" disabled={pending}>{pending ? 'Saving…' : 'Change password'}</button>
    </form>
  );
}

export function TotpPanel({ enabled }: { enabled: boolean }) {
  const [state, setState] = useState<'idle' | 'setup' | 'on'>(enabled ? 'on' : 'idle');
  const [qr, setQr] = useState(''); const [secret, setSecret] = useState(''); const [code, setCode] = useState(''); const [err, setErr] = useState<string | null>(null);
  async function call(action: string, c?: string) {
    const r = await fetch('/api/auth/totp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, code: c }) });
    return { ok: r.ok, j: await r.json().catch(() => ({})) };
  }
  return (
    <div className="panel form">
      <h2>Two-step sign-in</h2>
      {state === 'on' ? (
        <>
          <p className="chip ok">On</p>
          <div className="field"><label htmlFor="off">To turn it off, enter a current code</label><input id="off" className="input" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} maxLength={7} /></div>
          {err && <p className="error-msg" role="alert">{err}</p>}
          <button className="btn danger" onClick={async () => { const r = await call('disable', code); if (r.ok) { setState('idle'); setCode(''); setErr(null); } else setErr(r.j.error || 'Failed'); }}>Turn off</button>
        </>
      ) : state === 'idle' ? (
        <>
          <p className="muted">Adds a 6-digit code from an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…) to every sign-in. Recommended for everyone who can see participant data.</p>
          <button className="btn primary" onClick={async () => { const r = await call('start'); if (r.ok) { setQr(r.j.qr); setSecret(r.j.secret); setState('setup'); } else setErr(r.j.error || 'Failed'); }}>Set up</button>
          {err && <p className="error-msg" role="alert">{err}</p>}
        </>
      ) : (
        <>
          <p>Scan with your authenticator app, then enter the 6-digit code it shows.</p>
          <div className="qr"><img src={qr} alt="Authenticator QR code" width={220} height={220} /></div>
          <p className="small muted">Or type this key: <b style={{ letterSpacing: '0.08em' }}>{secret}</b></p>
          <div className="field"><label htmlFor="on">6-digit code</label><input id="on" className="input" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} maxLength={7} /></div>
          {err && <p className="error-msg" role="alert">{err}</p>}
          <button className="btn primary" onClick={async () => { const r = await call('confirm', code); if (r.ok) { setState('on'); setCode(''); setErr(null); } else setErr(r.j.error || 'Failed'); }}>Turn on</button>
        </>
      )}
    </div>
  );
}
