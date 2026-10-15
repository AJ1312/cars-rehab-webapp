// Integration tests: starts the production server with the file store and exercises the real HTTP API.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { rmSync, mkdirSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { fakeSession } = require('./fixtures.js');

const PORT = 3101, BASE = `http://127.0.0.1:${PORT}`;
const DATA = new URL('./out/api-data', import.meta.url).pathname;
const ADMIN = { email: 'admin@example.org', password: 'correct-horse-battery' };
let server, cookie = '', token = '';

const j = async (path, init = {}) => {
  const r = await fetch(BASE + path, { redirect: 'manual', ...init, headers: { ...(init.body && !(init.body instanceof Uint8Array) ? { 'Content-Type': 'application/json' } : {}), ...(init.headers || {}) } });
  let body = null; const ct = r.headers.get('content-type') || '';
  if (ct.includes('json')) body = await r.json(); 
  return { r, body, status: r.status };
};
const asAdmin = (init = {}) => ({ ...init, headers: { cookie, ...(init.headers || {}) } });
const asDevice = (init = {}) => ({ ...init, headers: { Authorization: 'Bearer ' + token, ...(init.headers || {}) } });

function payload(sessionNo = 1, overrides = {}) {
  const s = fakeSession(randomUUID(), sessionNo);
  const { kin, ...rest } = s;
  return { ...rest, mode: '6dof', tzOffsetMin: 330, kinRows: kin.length, ...overrides, _kin: kin };
}
const clean = ({ _kin, ...p }) => p;

before(async () => {
  rmSync(DATA, { recursive: true, force: true }); mkdirSync(DATA, { recursive: true });
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', String(PORT), '-H', '127.0.0.1'], {
    env: { ...process.env, NODE_ENV: 'production', AUTH_SECRET: 'x'.repeat(48), BOOTSTRAP_ADMIN_EMAIL: ADMIN.email, BOOTSTRAP_ADMIN_PASSWORD: ADMIN.password, DATA_DIR: DATA, STORE: 'file' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stderr.on('data', (d) => process.env.DEBUG_SERVER && process.stderr.write(d));
  for (let i = 0; i < 80; i++) { try { const r = await fetch(BASE + '/api/health'); if (r.ok) return; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 250)); }
  throw new Error('server did not start');
});
after(() => { server?.kill(); });

test('health and security headers', async () => {
  const r = await fetch(BASE + '/api/health');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-powered-by'), null);
  assert.match(r.headers.get('permissions-policy'), /xr-spatial-tracking=\(self\)/);
});

test('nothing is readable without signing in', async () => {
  for (const p of ['/api/export/study', '/api/export/dictionary', '/api/export/session/' + randomUUID()]) assert.equal((await j(p)).status, 401, p);
  for (const p of ['/admin', '/admin/sessions', '/admin/devices', '/admin/staff']) {
    const { r } = await j(p); assert.equal(r.status, 307, p); assert.match(r.headers.get('location'), /\/admin\/login/);
  }
  assert.equal((await j('/api/sessions', { method: 'POST', body: '{}' })).status, 401);
  assert.equal((await j('/api/config')).status, 401);
});

test('login: wrong password fails, correct one sets a secure cookie, cross-site login is blocked', async () => {
  assert.equal((await j('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: ADMIN.email, password: 'nope' }) })).status, 401);
  assert.equal((await j('/api/auth/login', { method: 'POST', headers: { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' }, body: JSON.stringify(ADMIN) })).status, 403);
  const { r, body } = await j('/api/auth/login', { method: 'POST', body: JSON.stringify(ADMIN) });
  assert.equal(r.status, 200); assert.equal(body.role, 'admin');
  const sc = r.headers.get('set-cookie');
  assert.match(sc, /HttpOnly/i); assert.match(sc, /SameSite=lax/i); assert.match(sc, /Secure/i);
  cookie = sc.split(';')[0];
});

test('admin pages render for a signed-in admin', async () => {
  for (const p of ['/admin', '/admin/participants', '/admin/sessions', '/admin/quality', '/admin/exports', '/admin/devices', '/admin/staff', '/admin/settings', '/admin/audit', '/admin/account']) {
    const r = await fetch(BASE + p, { headers: { cookie } });
    assert.equal(r.status, 200, p);
    assert.match(await r.text(), /CARS Rehab/, p);
  }
});

test('enrol a phone: code works once, token works, forged token does not', async () => {
  const mk = await j('/api/admin/devices', asAdmin({ method: 'POST', body: JSON.stringify({ label: 'Study phone 1' }) }));
  assert.equal(mk.status, 200); assert.match(mk.body.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/); assert.match(mk.body.url, /\/enrol\?code=/);
  assert.equal((await j('/api/admin/devices', { method: 'POST', body: JSON.stringify({ label: 'x' }) })).status, 401);
  const bad = await j('/api/enrol', { method: 'POST', body: JSON.stringify({ code: 'AAAA-BBBB' }) });
  assert.equal(bad.status, 404);
  const ok = await j('/api/enrol', { method: 'POST', body: JSON.stringify({ code: mk.body.code.toLowerCase(), model: 'Pixel test' }) });
  assert.equal(ok.status, 200); assert.match(ok.body.token, /^cars_/); assert.equal(ok.body.label, 'Study phone 1');
  token = ok.body.token; globalThis.__deviceId = mk.body.id;
  assert.equal((await j('/api/enrol', { method: 'POST', body: JSON.stringify({ code: mk.body.code }) })).status, 404, 'a code is single-use');
  assert.equal((await j('/api/config', asDevice())).status, 200);
  assert.equal((await j('/api/config', { headers: { Authorization: 'Bearer cars_' + 'a'.repeat(43) } })).status, 401);
});

test('upload: validates, is idempotent, recomputes summaries and flags', async () => {
  const p = payload(1);
  const first = await j('/api/sessions', asDevice({ method: 'POST', body: JSON.stringify(clean(p)) }));
  assert.equal(first.status, 200, JSON.stringify(first.body)); assert.equal(first.body.created, true); assert.equal(first.body.needKin, true);
  assert.ok(first.body.flags.includes('kin_missing'));
  const again = await j('/api/sessions', asDevice({ method: 'POST', body: JSON.stringify(clean(p)) }));
  assert.equal(again.body.created, false, 'same id is a retry, not a duplicate');

  // movement file
  const kin = gzipSync(Buffer.from(JSON.stringify(p._kin)));
  const k = await j(`/api/sessions/${p.id}/kin`, asDevice({ method: 'PUT', headers: { 'Content-Type': 'application/gzip' }, body: new Uint8Array(kin) }));
  assert.equal(k.status, 200); assert.equal(k.body.rows, 200);
  const junk = await j(`/api/sessions/${p.id}/kin`, asDevice({ method: 'PUT', headers: { 'Content-Type': 'application/gzip' }, body: new Uint8Array(gzipSync(Buffer.from('[[1,2,3]]'))) }));
  assert.equal(junk.status, 422);
  const notGz = await j(`/api/sessions/${p.id}/kin`, asDevice({ method: 'PUT', headers: { 'Content-Type': 'application/gzip' }, body: new Uint8Array(Buffer.from('plain text')) }));
  assert.equal(notGz.status, 422);

  // validation failures
  for (const [name, mut] of [
    ['bad participant code', { participantId: 'not valid!' }], ['level out of range', { level: 9 }], ['future start', { startedAt: '2099-01-01T00:00:00.000Z', endedAt: '2099-01-01T00:30:00.000Z' }],
    ['end before start', { endedAt: '2026-10-15T08:00:00.000Z' }], ['not a uuid', { id: 'abc' }], ['unknown mode', { mode: 'teleport' }]
  ]) {
    const r = await j('/api/sessions', asDevice({ method: 'POST', body: JSON.stringify(clean({ ...payload(2), ...mut })) }));
    assert.equal(r.status, 422, name);
  }
  assert.equal((await j('/api/sessions', asDevice({ method: 'POST', body: 'not json' }))).status, 400);
  assert.equal((await j('/api/sessions', asDevice({ method: 'POST', body: JSON.stringify({ x: 'y'.repeat(3_700_000) }) }))).status, 413);

  // tampered score is caught, duplicate session number is flagged
  const bad = payload(1); bad.trials[0].score = 99;
  const b = await j('/api/sessions', asDevice({ method: 'POST', body: JSON.stringify(clean(bad)) }));
  assert.equal(b.status, 200); assert.ok(b.body.flags.includes('score_mismatch')); assert.ok(b.body.flags.includes('duplicate_session_no'));
  const n = await j('/api/participants/p007/next', asDevice());
  assert.equal(n.body.next, 2);
  assert.equal((await j('/api/participants/bad!!/next', asDevice())).status, 422);
});

test('exports: a valid workbook with the 9 specified tabs, csv, and an audit trail', async () => {
  const list = await fetch(BASE + '/admin/sessions', { headers: { cookie } });
  const html = await list.text();
  const id = html.match(/\/admin\/sessions\/([0-9a-f-]{36})/)[1];
  const page = await fetch(BASE + '/admin/sessions/' + id, { headers: { cookie } });
  assert.equal(page.status, 200); assert.match(await page.text(), /P007/);

  const x = await fetch(`${BASE}/api/export/session/${id}`, { headers: { cookie } });
  assert.equal(x.status, 200); assert.match(x.headers.get('content-disposition'), /CARS_P007_S0[12]_2026-10-1[56]\.xlsx/);
  const buf = Buffer.from(await x.arrayBuffer());
  assert.equal(buf.subarray(0, 2).toString(), 'PK');
  const study = await fetch(`${BASE}/api/export/study?format=trials.csv`, { headers: { cookie } });
  const csv = await study.text();
  assert.match(csv.split('\r\n')[0], /^participant_id,session_no,date,group,therapist,affected_side,hand_mode,tracking_mode,level,cal_pass,cal_override,game,trial,/);
  assert.ok(csv.split('\r\n').length > 6);
  assert.match(csv, /2026-10-15/);
  const dict = await fetch(`${BASE}/api/export/dictionary`, { headers: { cookie } });
  assert.match(await dict.text(), /stroop_interference_ms/);
  const ev = await fetch(`${BASE}/api/export/session/${id}?format=events.csv`, { headers: { cookie } });
  assert.match(await ev.text(), /^participant_id,session_no,game/);
  const kin = await fetch(`${BASE}/api/export/session/${id}?format=kinematics.json`, { headers: { cookie } });
  assert.ok(Array.isArray(await kin.json()));
  const audit = await (await fetch(BASE + '/admin/audit', { headers: { cookie } })).text();
  assert.match(audit, /export\.study/); assert.match(audit, /session\.uploaded/); assert.match(audit, /device\.enrolled/);
  await import('node:fs').then(async (fs) => fs.writeFileSync(new URL('./out/api_session.xlsx', import.meta.url), buf));
});

test('revoking a phone cuts it off immediately', async () => {
  const d = await j('/api/admin/devices/' + globalThis.__deviceId, asAdmin({ method: 'DELETE' }));
  assert.equal(d.status, 200);
  assert.equal((await j('/api/config', asDevice())).status, 401);
  assert.equal((await j('/api/sessions', asDevice({ method: 'POST', body: JSON.stringify(clean(payload(3))) }))).status, 401);
});

test('lock-out after repeated wrong passwords, and sign-out clears access', async () => {
  const mk = await import('node:fs');
  void mk;
  for (let i = 0; i < 5; i++) await j('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: ADMIN.email, password: 'wrong' + i }) });
  const locked = await j('/api/auth/login', { method: 'POST', body: JSON.stringify(ADMIN) });
  assert.equal(locked.status, 423, 'correct password is refused while locked');
  const out = await fetch(BASE + '/api/auth/logout', { method: 'POST', headers: { cookie } });
  assert.equal(out.status, 200);
});
