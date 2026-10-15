'use client';
export function SignOut() {
  return <button className="btn sm" onClick={async () => { await fetch('/api/auth/logout', { method: 'POST' }); location.href = '/admin/login'; }}>Sign out</button>;
}
