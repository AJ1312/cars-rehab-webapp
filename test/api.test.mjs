// Integration tests: starts the production server with the file store and exercises the real HTTP API.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { rmSync, mkdirSync } from 'node:fs';
import { gzipSync, gunzipSync, inflateRawSync } from 'node:zlib';
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
/** Read every file of an .xlsx (zip with sizes in the local headers) as text, keyed by name. */
function unzipText(buf) {
  const out = {}; let o = 0;
  while (o + 30 <= buf.length && buf.readUInt32LE(o) === 0x04034b50) {
    const method = buf.readUInt16LE(o + 8), csize = buf.readUInt32LE(o + 18), nlen = buf.readUInt16LE(o + 26), xlen = buf.readUInt16LE(o + 28);
    const name = buf.subarray(o + 30, o + 30 + nlen).toString(); const data = buf.subarray(o + 30 + nlen + xlen, o + 30 + nlen + xlen + csize);
    out[name] = (method === 8 ? inflateRawSync(data) : data).toString('utf8'); o += 30 + nlen + xlen + csize;
  }
  return out;
}

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
  for (const p of ['/api/admin/devices/' + randomUUID(), '/api/admin/sessions/' + randomUUID(), '/api/admin/participants/P001']) assert.equal((await j(p, { method: 'DELETE' })).status, 401, p);
  assert.equal((await j('/api/admin/sessions/' + randomUUID() + '/comments')).status, 401);
  assert.equal((await j('/api/participants/P001/next')).status, 401, 'session numbers of participants need a registered phone');
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

test('a phone registers itself: token works, forged token does not, no QR step exists', async () => {
  const ok = await j('/api/device', { method: 'POST', headers: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1' }, body: '{}' });
  assert.equal(ok.status, 200); assert.match(ok.body.token, /^cars_/); assert.match(ok.body.label, /^iPhone · Safari · [0-9A-F]{4}$/);
  assert.ok(ok.body.settings && ok.body.settings.trialsPerGame > 0, 'the study defaults come back with the token');
  token = ok.body.token;
  // the old QR enrolment endpoints are gone
  assert.equal((await j('/api/enrol', { method: 'POST', body: JSON.stringify({ code: 'AAAA-BBBB' }) })).status, 404);
  assert.equal((await j('/api/admin/devices', asAdmin({ method: 'POST', body: JSON.stringify({ label: 'x' }) }))).status, 404);
  assert.equal((await j('/api/config', asDevice())).status, 200);
  assert.equal((await j('/api/config')).status, 200, 'the study defaults are readable without registering');
  const forged = { headers: { Authorization: 'Bearer cars_' + 'a'.repeat(43), 'Content-Type': 'application/json' }, method: 'POST', body: '{}' };
  const f = await j('/api/sessions', forged);
  assert.equal(f.status, 401); assert.equal(f.body.code, 'unknown');
});

test('upload: validates, is idempotent, recomputes summaries and flags', async () => {
  const p = payload(1); globalThis.__p1 = p;
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
  assert.match(audit, /export\.study/); assert.match(audit, /session\.uploaded/); assert.match(audit, /device\.registered/);
  await import('node:fs').then(async (fs) => fs.writeFileSync(new URL('./out/api_session.xlsx', import.meta.url), buf));
});

test('admin: comment on a session, correct and rename it, export with the comment, delete it for good', async () => {
  const target = globalThis.__p1.id;
  const sheetNames = (files) => [...files['xl/workbook.xml'].matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1]);
  // comments: staff only, empty refused
  assert.equal((await j(`/api/admin/sessions/${target}/comments`, { method: 'POST', body: JSON.stringify({ body: 'x' }) })).status, 401);
  assert.equal((await j(`/api/admin/sessions/${target}/comments`, asAdmin({ method: 'POST', body: JSON.stringify({ body: '   ' }) }))).status, 422);
  const c1 = await j(`/api/admin/sessions/${target}/comments`, asAdmin({ method: 'POST', body: JSON.stringify({ body: 'Phone slipped on the strap in trial 3.' }) }));
  assert.equal(c1.status, 201);
  const cl = await j(`/api/admin/sessions/${target}/comments`, asAdmin());
  assert.equal(cl.body.comments.length, 1); assert.equal(cl.body.comments[0].author, ADMIN.email);

  // correct and rename: title, group, notes; a clashing session number is refused
  const ed = await j(`/api/admin/sessions/${target}`, asAdmin({ method: 'PATCH', body: JSON.stringify({ title: 'Baseline run', group: 'Control', notes: 'Checked by hand', sessionNo: 41 }) }));
  assert.equal(ed.status, 200, JSON.stringify(ed.body));
  const html = await (await fetch(`${BASE}/admin/sessions/${target}`, { headers: { cookie } })).text();
  assert.match(html, /Baseline run/); assert.match(html, /Phone slipped on the strap/); assert.match(html, /Edit this session/);
  assert.equal((await j(`/api/admin/sessions/${target}`, { method: 'PATCH', body: JSON.stringify({ title: 'no' }) })).status, 401);
  const other = [...(await (await fetch(BASE + '/admin/sessions?participant=P007', { headers: { cookie } })).text()).matchAll(/\/admin\/sessions\/([0-9a-f-]{36})/g)].map((m) => m[1]).find((x) => x !== target);
  assert.ok(other, 'a second P007 session exists');
  const clash = await j(`/api/admin/sessions/${other}`, asAdmin({ method: 'PATCH', body: JSON.stringify({ sessionNo: 41 }) }));
  assert.equal(clash.status, 422); assert.match(clash.body.error, /already has a session 41/);
  assert.equal((await j(`/api/admin/sessions/${target}`, asAdmin({ method: 'PATCH', body: JSON.stringify({ participantCode: 'bad code!' }) }))).status, 422);

  // the Excel sheet carries the edit and the comment
  const xr = await fetch(`${BASE}/api/export/session/${target}`, { headers: { cookie } });
  const files = unzipText(Buffer.from(await xr.arrayBuffer()));
  assert.ok(sheetNames(files).includes('Comments'), sheetNames(files).join(','));
  const all = Object.values(files).join('\n');
  assert.match(all, /Phone slipped on the strap in trial 3\./); assert.match(all, /Baseline run/); assert.match(all, /Checked by hand/);
  const csv = await (await fetch(`${BASE}/api/export/study?format=trials.csv&participant=P007&group=Control`, { headers: { cookie } })).text();
  assert.match(csv, /Control/); assert.ok(csv.split('\r\n').length > 2, 'filters apply to the study export');
  const studyFiles = unzipText(Buffer.from(await (await fetch(`${BASE}/api/export/study`, { headers: { cookie } })).arrayBuffer()));
  assert.ok(sheetNames(studyFiles).includes('Comments'));

  // delete a comment, then rename the participant everywhere
  assert.equal((await j(`/api/admin/sessions/${target}/comments/${cl.body.comments[0].id}`, asAdmin({ method: 'DELETE' }))).status, 200);
  assert.equal((await j(`/api/admin/sessions/${target}/comments`, asAdmin())).body.comments.length, 0);
  const rn = await j('/api/admin/participants/P007', asAdmin({ method: 'PATCH', body: JSON.stringify({ to: 'p777' }) }));
  assert.equal(rn.status, 200, JSON.stringify(rn.body));
  assert.match(await (await fetch(BASE + '/admin/participants', { headers: { cookie } })).text(), /P777/);
  assert.equal((await fetch(BASE + '/admin/participants/P007', { headers: { cookie } })).status, 404);
  assert.equal((await j('/api/admin/participants/P777', asAdmin({ method: 'PATCH', body: JSON.stringify({ to: 'P777' }) }))).status, 200, 'renaming to the same code is a no-op');

  // delete: needs a signed-in admin, removes it, and a phone retrying the upload does not bring it back
  assert.equal((await j(`/api/admin/sessions/${target}`, { method: 'DELETE' })).status, 401);
  assert.equal((await j(`/api/admin/sessions/${target}`, asAdmin({ method: 'DELETE' }))).status, 200);
  assert.equal((await fetch(`${BASE}/admin/sessions/${target}`, { headers: { cookie } })).status, 404);
  const retry = await j('/api/sessions', asDevice({ method: 'POST', body: JSON.stringify(clean(globalThis.__p1)) }));
  assert.equal(retry.status, 200); assert.equal(retry.body.deleted, true);
  assert.doesNotMatch(await (await fetch(BASE + '/admin/sessions?participant=P777', { headers: { cookie } })).text(), new RegExp(target));
  const audit = await (await fetch(BASE + '/admin/audit', { headers: { cookie } })).text();
  for (const a of ['comment.added', 'session.edited', 'participant.renamed', 'session.deleted']) assert.match(audit, new RegExp(a.replace('.', '\\.')));
});

test('removing a phone cuts it off immediately and says so', async () => {
  const list = await fetch(BASE + '/admin/devices', { headers: { cookie } });
  const html = await list.text();
  assert.match(html, /iPhone · Safari/);
  assert.doesNotMatch(html, /QR code|Enrol/i, 'the Phones page no longer offers enrolment');
  const dev = (await j('/api/sessions', asDevice({ method: 'POST', body: JSON.stringify(clean(payload(3))) })));
  assert.ok([200, 422].includes(dev.status), 'the phone can upload before it is removed');
  const id = html.match(/name="id" value="([0-9a-f-]{36})"/)?.[1];
  assert.ok(id, 'the Phones page lists the registered phone with a Remove button');
  const d = await j('/api/admin/devices/' + id, asAdmin({ method: 'DELETE' }));
  assert.equal(d.status, 200);
  const cfg = await j('/api/config', asDevice()); assert.equal(cfg.status, 401); assert.equal(cfg.body.code, 'revoked');
  const up = await j('/api/sessions', asDevice({ method: 'POST', body: JSON.stringify(clean(payload(3))) }));
  assert.equal(up.status, 401); assert.equal(up.body.code, 'revoked');
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
