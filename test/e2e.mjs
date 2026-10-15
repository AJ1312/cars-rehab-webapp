// End-to-end test in a real (headless Chromium) phone-sized browser against the production build.
// Drives complete sessions with a simulated hand, then checks the phone's data sheet, the upload, and the admin board.
import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { rmSync, mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const PORT = 3102, BASE = `http://localhost:${PORT}`;
const DATA = new URL('./out/e2e-data', import.meta.url).pathname;
const SHOTS = new URL('./shots/', import.meta.url).pathname;
const OUT = new URL('./out/', import.meta.url).pathname;
const ADMIN = { email: 'admin@example.org', password: 'correct-horse-battery' };
const FULL = process.env.E2E_FULL !== '0';

rmSync(DATA, { recursive: true, force: true }); mkdirSync(DATA, { recursive: true }); mkdirSync(SHOTS, { recursive: true });
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', String(PORT)], {
  env: { ...process.env, NODE_ENV: 'production', AUTH_SECRET: 'y'.repeat(48), BOOTSTRAP_ADMIN_EMAIL: ADMIN.email, BOOTSTRAP_ADMIN_PASSWORD: ADMIN.password, DATA_DIR: DATA, STORE: 'file' },
  stdio: ['ignore', 'pipe', 'pipe']
});
server.stderr.on('data', (d) => process.env.DEBUG_SERVER && process.stderr.write(d));
for (let i = 0; i < 80; i++) { try { if ((await fetch(BASE + '/api/health')).ok) break; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 250)); }

const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const results = [];
const check = (name, ok, extra = '') => { results.push([ok, name, extra]); console.log((ok ? '  PASS ' : '  FAIL ') + name + (extra ? ' — ' + extra : '')); };
const shot = (page, name) => page.screenshot({ path: SHOTS + name + '.png' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let exitCode = 0;

async function newPhone(init) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, acceptDownloads: true, timezoneId: 'Asia/Kolkata', locale: 'en-GB' });
  if (init) await ctx.addInitScript(init);
  return ctx;
}

// A simulated hand: moves the cursor at 90 cm/s to whatever the game asks for; every 3rd maths/colour item it first tries a wrong answer.
const BOT = () => {
  const bot = (window.__bot = { speed: 90, wrongEvery: 3, mode: 'sim', ax: 0, ay: 0, last: performance.now(), itemSeen: -1, wrong: false });
  setInterval(() => {
    const e = window.__cars; if (!e) return;
    const d = e.debug(); const now = performance.now(); const dt = (now - bot.last) / 1000; bot.last = now;
    let gx = 0, gy = 0;
    if ((d.phase === 'playing' && d.sub === 'reach') || d.phase === 'range') {
      const ts = d.targets; let tg = ts.find((t) => t.correct) || ts[0];
      if (d.item && d.item.game !== 'triangle') {
        if (d.item.n !== bot.itemSeen) { bot.itemSeen = d.item.n; bot.wrong = d.item.n % bot.wrongEvery === 0; }
        if (bot.wrong) { const w = ts.find((t) => !t.correct && t.state === 'idle'); if (w) tg = w; else bot.wrong = false; }
      }
      if (tg) { gx = tg.xCm; gy = tg.yCm; }
    }
    const dx = gx - bot.ax, dy = gy - bot.ay, dist = Math.hypot(dx, dy), step = Math.min(dist, bot.speed * dt);
    if (dist > 0.01) { bot.ax += (dx / dist) * step; bot.ay += (dy / dist) * step; }
    if (bot.mode === 'sim') e.simAimCm(bot.ax, bot.ay);
    else if (bot.mode === 'motion') {   // motion: turn the phone so the cursor lands on (ax, ay) 50 cm out
      const phi = Math.asin(Math.max(-0.99, Math.min(0.99, bot.ay / 50))), psi = Math.asin(Math.max(-0.99, Math.min(0.99, bot.ax / (50 * Math.cos(phi)))));
      window.__orient((360 - (psi * 180) / Math.PI) % 360, 90 + (phi * 180) / Math.PI, 0);
    }
  }, 16);
};
const ORIENT = () => {
  let a = 0, b = 90, g = 0;
  window.__orient = (x, y, z) => { a = x; b = y; g = z; };
  setInterval(() => window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: a + (Math.random() - 0.5) * 0.04, beta: b + (Math.random() - 0.5) * 0.04, gamma: g + (Math.random() - 0.5) * 0.04, absolute: false })), 16);
};

async function fillSetup(page, { code, trials = 1, secs = 12, games = ['Triangle Reach', 'Maths Fun', 'Colour Merge Test'], mode }) {
  await page.getByLabel('Participant ID').fill(code);
  await page.locator('summary', { hasText: 'More settings' }).click();
  await page.getByLabel('Trials per game').fill(String(trials));
  await page.getByLabel('Trial length (seconds)').fill(String(secs));
  await page.getByLabel('Time limit per item (s)').fill('6');
  for (const g of ['Triangle Reach', 'Maths Fun', 'Colour Merge Test']) { const box = page.getByLabel(g, { exact: true }); if ((await box.isChecked()) !== games.includes(g)) await box.click(); }
  if (mode === 'motion') await page.locator('.mode', { hasText: 'Motion tracking' }).getByRole('button').click();
}

// Click through the on-screen prompts until the run ends. `onPhase` lets a test do extra things at a given moment.
async function runSession(page, { onPhase, tag = 'run' } = {}) {
  const seen = new Set(); const t0 = Date.now();
  for (;;) {
    if (Date.now() - t0 > 240000) throw new Error('session timed out');
    if (await page.getByRole('heading', { name: 'A few questions' }).isVisible().catch(() => false)) return;
    const snap = await page.evaluate(() => window.__cars?.getSnapshot()).catch(() => null);
    if (!snap) { await sleep(100); continue; }
    const key = snap.phase + ':' + snap.gameIndex + ':' + snap.trialNo;
    const first = !seen.has(key); seen.add(key);
    if (first && onPhase) await onPhase(snap, page);
    const click = async (name) => { await page.getByRole('button', { name }).first().click({ timeout: 4000 }); await sleep(150); };
    switch (snap.phase) {
      case 'idle': await click('Start tracking'); break;
      case 'cal_ready': if (first) await shot(page, `${tag}-02-calibrate`); await click('Calibrate now'); break;
      case 'cal_result': if (first) await shot(page, `${tag}-03-cal-result`); await click(snap.cal.result.pass ? 'Continue' : 'Continue anyway (flagged in data)'); break;
      case 'game_intro': if (first) await shot(page, `${tag}-05-intro-${snap.game}`); await click('Start trial 1'); break;
      case 'trial_end': if (first) await shot(page, `${tag}-07-trial-end-${snap.game}`); await click(/Start trial|Next game|Finish session/); break;
      case 'error': throw new Error('engine error: ' + snap.error);
      default: await sleep(120);
    }
  }
}

try {
  /* ============ A. Enrol a phone, run a full simulated session, check the phone-side data sheet ============ */
  console.log('A. Full session on an enrolled phone (simulated hand)');
  const admin = await browser.newContext();
  assert.equal((await admin.request.post(BASE + '/api/auth/login', { data: ADMIN })).status(), 200);
  const mk = await (await admin.request.post(BASE + '/api/admin/devices', { data: { label: 'Study phone 1' } })).json();

  const phoneCtx = await newPhone();
  const page = await phoneCtx.newPage();
  const consoleErrors = []; page.on('pageerror', (e) => consoleErrors.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  await page.goto(`${BASE}/enrol?code=${mk.code}`);
  await shot(page, 'a-00-enrol');
  await page.getByRole('button', { name: 'Enrol this phone' }).click();
  await page.getByText('Enrolled as Study phone 1').waitFor();
  check('phone enrols with the QR/code', true);

  await page.goto(BASE + '/?sim=1');
  await page.getByText('New session').first().waitFor();
  await sleep(600);
  await shot(page, 'a-01-setup');
  check('setup screen: no horizontal scroll at 390px', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await fillSetup(page, { code: 'E2E001', trials: 1, secs: 12 });
  await shot(page, 'a-01b-setup-filled');
  await page.getByRole('button', { name: 'Start session' }).click();
  await page.evaluate(`(${BOT})()`);

  let lostSeen = false, banner = false;
  await runSession(page, {
    tag: 'a',
    onPhase: async (snap, p) => {
      if (snap.phase === 'range') await shot(p, 'a-04-range');
      if (snap.phase === 'playing') {
        setTimeout(() => shot(p, `a-06-play-${snap.game}`).catch(() => undefined), 3500);
        if (snap.game === 'maths') {            // knock out tracking for 1.3 s in the middle of a trial
          setTimeout(async () => { await p.evaluate(() => window.__cars.simDrop(1300)); await sleep(700); banner = await p.getByText('Tracking lost').first().isVisible().catch(() => false); lostSeen = true; await shot(p, 'a-06b-tracking-lost'); }, 5000);
        }
      }
    }
  });
  check('tracking-loss banner appears and the game resumes by itself', lostSeen && banner);
  await shot(page, 'a-08-questions');

  // Questionnaire + therapist notes
  for (const q of ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7']) await page.locator(`label[for="${q}-4"]`).click();
  await page.getByLabel(/negative symptoms/).fill('none');
  await page.getByLabel('Session notes').fill('e2e run');
  await page.getByRole('button', { name: 'Save session' }).click();
  await page.getByText('Session 1 saved').waitFor();
  await page.getByText('Uploaded to the study').waitFor({ timeout: 20000 });
  check('session uploads automatically after saving', true);
  await sleep(500);
  await shot(page, 'a-09-done');

  // Phone-side download
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download Excel data sheet' }).click()]);
  const xlsxPath = OUT + 'e2e_phone.xlsx'; await dl.saveAs(xlsxPath);
  check('Excel data sheet downloads on the phone', /^CARS_E2E001_S01_\d{4}-\d{2}-\d{2}\.xlsx$/.test(dl.suggestedFilename()), dl.suggestedFilename());
  check('no browser errors during the full session', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
  const events = await page.evaluate(() => window.__cars === undefined);
  void events;

  /* ============ B. Motion (iPhone-style) mode: orientation drives the cursor ============ */
  console.log('B. Motion mode with simulated phone orientation');
  const mctx = await newPhone(ORIENT);
  const mp = await mctx.newPage();
  await mp.goto(`${BASE}/enrol?code=${(await (await admin.request.post(BASE + '/api/admin/devices', { data: { label: 'Study iPhone' } })).json()).code}`);
  await mp.getByRole('button', { name: 'Enrol this phone' }).click();
  await mp.getByText('Enrolled as Study iPhone').waitFor();
  await mp.goto(BASE + '/');
  await sleep(500);
  await fillSetup(mp, { code: 'E2E002', trials: 1, secs: 10, games: ['Triangle Reach'], mode: 'motion' });
  await mp.getByRole('button', { name: 'Start session' }).click();
  let mapped = null;
  await runSession(mp, {
    tag: 'b',
    onPhase: async (snap, p) => {
      if (snap.phase === 'cal_ready') await p.evaluate(`(${BOT})(); window.__bot.mode = 'motion'; window.__bot.speed = 60;`);
      if (snap.phase === 'game_intro') {
        // 10 degrees to the right and 10 degrees up -> about 8.7 cm on a 50 cm radius
        await p.evaluate(() => { window.__bot.mode = 'manual'; window.__orient(350, 100, 0); });
        await sleep(900);
        mapped = await p.evaluate(() => window.__cars.debug().cursorCm);
        await p.evaluate(() => { window.__orient(0, 90, 0); window.__bot.mode = 'motion'; window.__bot.ax = 0; window.__bot.ay = 0; });
        await sleep(400);
      }
    }
  });
  check('motion mapping: 10° right / 10° up lands at about (+8.5, +8.5) cm', mapped && Math.abs(mapped[0] - 8.5) < 1.2 && Math.abs(mapped[1] - 8.7) < 1.2, JSON.stringify(mapped && mapped.map((v) => +v.toFixed(2))));
  await mp.getByRole('button', { name: 'Skip questions' }).click();
  await mp.getByText('Session 1 saved').waitFor();
  await mp.getByText('Uploaded to the study').waitFor({ timeout: 20000 });
  check('motion session is flagged on the results screen', await mp.getByText(/Motion tracking was used/).isVisible());
  await shot(mp, 'b-09-done-motion');

  /* ============ C. Offline: session saved on the phone, uploads when the connection returns ============ */
  console.log('C. Offline queue');
  const octx = await newPhone();
  const op = await octx.newPage();
  await op.goto(`${BASE}/enrol?code=${(await (await admin.request.post(BASE + '/api/admin/devices', { data: { label: 'Study phone 2' } })).json()).code}`);
  await op.getByRole('button', { name: 'Enrol this phone' }).click();
  await op.getByText('Enrolled as Study phone 2').waitFor();
  await op.goto(BASE + '/?sim=1'); await sleep(500);
  await fillSetup(op, { code: 'E2E003', trials: 1, secs: 10, games: ['Triangle Reach'] });
  await op.getByRole('button', { name: 'Start session' }).click();
  await op.evaluate(`(${BOT})()`);
  await octx.setOffline(true);
  await runSession(op, { tag: 'c' });
  await op.getByRole('button', { name: 'Skip questions' }).click();
  await op.getByText('Session 1 saved').waitFor();
  check('offline: session is kept on the phone and says it will upload later', await op.getByText(/waiting to upload/).first().isVisible());
  await shot(op, 'c-09-offline');
  await octx.setOffline(false);
  await op.evaluate(() => window.dispatchEvent(new Event('online')));
  await op.getByText('Uploaded to the study').waitFor({ timeout: 20000 });
  check('offline: uploads by itself when the connection returns', true);

  /* ============ D. Admin board sees everything ============ */
  console.log('D. Admin board');
  const actx = await newPhone();
  const ap = await actx.newPage();
  await ap.goto(BASE + '/admin');
  await ap.waitForURL(/admin\/login/);
  await shot(ap, 'd-00-login');
  await ap.getByLabel('Email').fill(ADMIN.email); await ap.getByLabel('Password').fill(ADMIN.password);
  await ap.getByRole('button', { name: 'Sign in' }).click();
  await ap.getByRole('heading', { name: 'Overview' }).waitFor();
  await shot(ap, 'd-01-overview');
  const txt = await ap.locator('main').innerText();
  if (!/E2E003/.test(txt)) console.log('OVERVIEW TEXT:', txt.slice(0, 900));
  check('overview shows the three uploaded sessions', /E2E001/.test(txt) && /E2E002/.test(txt) && /E2E003/.test(txt));
  check('motion session is flagged on the admin board', /Not position-tracked/.test(txt));
  await ap.goto(BASE + '/admin/participants'); await shot(ap, 'd-02-participants');
  await ap.goto(BASE + '/admin/participants/E2E001'); await shot(ap, 'd-03-participant');
  await ap.goto(BASE + '/admin/sessions'); await shot(ap, 'd-04-sessions');
  await ap.getByRole('link', { name: 'E2E001' }).first().click();
  await ap.getByRole('heading', { level: 2, name: 'Where the hand went' }).waitFor();
  const pageText = await ap.locator('main').innerText();
  check('session page lists trials, sensor events and the tracking dropout', /Triangle Reach/.test(pageText) && /tracking_lost/.test(pageText) && /Maths Fun/.test(pageText));
  check('session page: no horizontal scroll at 390px', await ap.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await ap.screenshot({ path: SHOTS + 'd-05-session.png', fullPage: true });
  await ap.goto(BASE + '/admin/quality'); await shot(ap, 'd-06-quality');
  await ap.goto(BASE + '/admin/devices'); await shot(ap, 'd-07-devices');
  await ap.goto(BASE + '/admin/exports'); await shot(ap, 'd-08-exports');
  const [adl] = await Promise.all([ap.waitForEvent('download'), ap.goto(BASE + '/api/export/study').catch(() => undefined)]);
  await adl.saveAs(OUT + 'e2e_study.xlsx');
  const [sdl] = await Promise.all([ap.waitForEvent('download'), ap.evaluate((u) => { location.href = u; }, '/api/export/participant/E2E001')]);
  await sdl.saveAs(OUT + 'e2e_participant.xlsx');
  check('admin can download study and participant workbooks', true);
  await ap.setViewportSize({ width: 1280, height: 800 });
  await ap.goto(BASE + '/admin'); await ap.screenshot({ path: SHOTS + 'd-09-overview-desktop.png' });
  await ap.goto(BASE + '/admin/sessions'); await ap.screenshot({ path: SHOTS + 'd-10-sessions-desktop.png' });

  // Dark theme + landscape sanity for the stage
  const dctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'dark' });
  const dp = await dctx.newPage();
  await dp.goto(BASE + '/?sim=1'); await sleep(600); await shot(dp, 'e-01-setup-landscape-dark');
} catch (e) {
  console.error('E2E ERROR:', e);
  exitCode = 1;
} finally {
  await browser.close(); server.kill();
}
const failed = results.filter((r) => !r[0]);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
writeFileSync(OUT + 'e2e-results.json', JSON.stringify(results));
process.exit(exitCode || (failed.length ? 1 : 0));
