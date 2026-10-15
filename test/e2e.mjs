// End-to-end test in a real (headless Chromium) phone-sized browser against the production build.
// Drives complete sessions with a simulated hand in 3D, then checks the data, the phone's sheet, the upload and the admin board.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { rmSync, mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';

const PORT = 3102, BASE = `http://localhost:${PORT}`;
const DATA = new URL('./out/e2e-data', import.meta.url).pathname;
const SHOTS = new URL('./shots/', import.meta.url).pathname;
const OUT = new URL('./out/', import.meta.url).pathname;
const ADMIN = { email: 'admin@example.org', password: 'correct-horse-battery' };

rmSync(DATA, { recursive: true, force: true }); mkdirSync(DATA, { recursive: true }); mkdirSync(SHOTS, { recursive: true });
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', String(PORT)], {
  env: { ...process.env, NODE_ENV: 'production', AUTH_SECRET: 'y'.repeat(48), BOOTSTRAP_ADMIN_EMAIL: ADMIN.email, BOOTSTRAP_ADMIN_PASSWORD: ADMIN.password, DATA_DIR: DATA, STORE: 'file' },
  stdio: ['ignore', 'pipe', 'pipe']
});
server.stderr.on('data', (d) => process.env.DEBUG_SERVER && process.stderr.write(d));
for (let i = 0; i < 80; i++) { try { if ((await fetch(BASE + '/api/health')).ok) break; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 250)); }

const browser = await chromium.launch({
  headless: true, executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
});
const results = [];
const check = (name, ok, extra = '') => { results.push([ok, name, extra]); console.log((ok ? '  PASS ' : '  FAIL ') + name + (extra ? ' — ' + extra : '')); };
const shot = (page, name) => page.screenshot({ path: SHOTS + name + '.png' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let exitCode = 0;
/** Read every file of an .xlsx (zip with sizes in the local headers) as text. */
function unzipText(buf) {
  const out = {}; let o = 0;
  while (o + 30 <= buf.length && buf.readUInt32LE(o) === 0x04034b50) {
    const method = buf.readUInt16LE(o + 8), csize = buf.readUInt32LE(o + 18), nlen = buf.readUInt16LE(o + 26), xlen = buf.readUInt16LE(o + 28);
    const name = buf.subarray(o + 30, o + 30 + nlen).toString(); const data = buf.subarray(o + 30 + nlen + xlen, o + 30 + nlen + xlen + csize);
    out[name] = (method === 8 ? inflateRawSync(data) : data).toString('utf8'); o += 30 + nlen + xlen + csize;
  }
  return out;
}
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

async function newPhone(init, extra = {}) {
  const { tour, ...opts } = extra;   // tour: true = a first-time visitor, so the welcome tour shows
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, acceptDownloads: true, timezoneId: 'Asia/Kolkata', locale: 'en-GB', permissions: ['camera'], ...opts });
  if (!tour) await ctx.addInitScript("try{localStorage.setItem('cars.welcome.v2','1')}catch(e){}");
  if (init) await ctx.addInitScript(init);
  return ctx;
}

// A simulated participant. 'sim': a 6-DoF hand that flies in 3D to the correct target at 120 cm/s, returns to the ring between items,
// and every 3rd maths/colour item first touches a wrong answer. 'touch'/'motion': turns the view so the aim lands on the target.
const BOT = () => {
  const bot = (window.__bot = { speed: 120, turn: 140, wrongEvery: 3, mode: 'sim', hand: [0, 0, 0], yaw: 0, pitch: 0, last: performance.now(), itemSeen: -1, wrong: false, freeze: false });
  setInterval(() => {
    const e = window.__cars; if (!e) return;
    const d = e.debug(); const now = performance.now(); const dt = Math.min(0.1, (now - bot.last) / 1000); bot.last = now;
    if (bot.freeze) return;
    let goal = [0, 0, 0];
    if ((d.phase === 'playing' && d.sub === 'reach') || d.phase === 'range') {
      const ts = d.targets; let tg = ts.find((t) => t.correct) || ts[0];
      if (d.item && d.item.game !== 'triangle') {
        if (d.item.n !== bot.itemSeen) { bot.itemSeen = d.item.n; bot.wrong = d.item.n % bot.wrongEvery === 0; }
        if (bot.wrong) { const w = ts.find((t) => !t.correct && t.state === 'idle'); if (w) tg = w; else bot.wrong = false; }
      }
      if (tg) goal = tg.posCm;
    }
    if (bot.mode === 'sim') {
      const dx = goal[0] - bot.hand[0], dy = goal[1] - bot.hand[1], dz = goal[2] - bot.hand[2], dist = Math.hypot(dx, dy, dz), step = Math.min(dist, bot.speed * dt);
      if (dist > 0.01) { bot.hand[0] += (dx / dist) * step; bot.hand[1] += (dy / dist) * step; bot.hand[2] += (dz / dist) * step; }
      e.simHandCm(bot.hand[0], bot.hand[1], bot.hand[2]);
    }
    if (d.cal) {   // the participant also turns the phone toward the object they are reaching for
      const a = e.aimFor(goal);
      if (Math.abs(a.pitch) > 75) a.yaw = bot.yaw;                 // straight up/down: heading is undefined, keep it
      const dy = ((a.yaw - bot.yaw + 540) % 360) - 180, dp = a.pitch - bot.pitch, dist = Math.hypot(dy, dp), step = Math.min(dist, bot.turn * dt);
      if (dist > 0.01) { bot.yaw += (dy / dist) * step; bot.pitch += (dp / dist) * step; }
      if (bot.mode === 'motion') window.__orient((bot.yaw + 360) % 360, 90 + bot.pitch, 0); else e.simLook(bot.yaw, bot.pitch);
    }
  }, 16);
};
const ORIENT = () => {
  let a = 0, b = 90, g = 0;
  window.__orient = (x, y, z) => { a = x; b = y; g = z; };
  window.DeviceOrientationEvent.requestPermission = async () => 'granted';
  setInterval(() => window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: a + (Math.random() - 0.5) * 0.04, beta: b + (Math.random() - 0.5) * 0.04, gamma: g + (Math.random() - 0.5) * 0.04, absolute: false })), 16);
};

async function fillSetup(page, { code, trials = 1, secs = 12, games = ['Triangle Reach', 'Maths Fun', 'Colour Merge Test'], mode, camera = true, level, practice = true }) {
  if (!(await page.getByRole('heading', { name: 'Who is playing?' }).isVisible().catch(() => false))) await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.getByLabel('Participant ID').fill(code);
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('heading', { name: 'Set up the session' }).waitFor();
  if (level) await page.getByRole('radio', { name: new RegExp('Level ' + level) }).click();
  const pr = page.getByLabel(/Practice trial before each game/); if ((await pr.isChecked()) !== practice) await pr.click();
  await page.locator('summary', { hasText: 'More settings' }).click();
  await page.getByLabel('Trials per game').fill(String(trials));
  await page.getByLabel('Trial length (seconds)').fill(String(secs));
  await page.getByLabel('Time per item (s)').fill('6');
  for (const g of ['Triangle Reach', 'Maths Fun', 'Colour Merge Test']) {
    const tile = page.getByRole('button', { name: new RegExp(g) });
    if (((await tile.getAttribute('aria-pressed')) === 'true') !== games.includes(g)) await tile.click();
  }
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('heading', { name: 'Ready?' }).waitFor();
  await page.getByLabel('I have told the participant').check();
  if (mode === 'motion' || mode === 'touch') {
    await page.locator('summary', { hasText: 'Change tracking mode' }).click();
    await page.locator('.mode', { hasText: mode === 'motion' ? 'Motion tracking' : 'Touch practice' }).getByRole('button').click();
  }
  const cam = page.getByLabel('Show the camera picture behind the game');
  if (await cam.count()) { if ((await cam.isChecked()) !== camera) await cam.click(); }
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
      case 'idle': if (first) await shot(page, `${tag}-01-start`); await click(/Start tracking|Open AR/); break;
      case 'cal_ready': if (first) await shot(page, `${tag}-02-calibrate`); await click('Calibrate now'); break;
      case 'cal_result': if (first) await shot(page, `${tag}-03-cal-result`); await click(snap.cal.result.pass ? 'Continue' : 'Continue anyway (flagged in data)'); break;
      case 'game_intro': if (first) await shot(page, `${tag}-05-intro-${snap.game}`);
        if (snap.practiceNext && !(tag === 'a' && snap.gameIndex === 0)) await click('Skip practice'); else await click(/Start (practice|trial)/); break;
      case 'trial_end': if (first) await shot(page, `${tag}-07-trial-end-${snap.game}`); await click(/Start trial|Next: |Finish session/); break;
      case 'error': throw new Error('engine error: ' + snap.error);
      default: await sleep(120);
    }
  }
}

try {
  /* ============ A0. A first-time visitor gets the welcome tour once ============ */
  console.log('A0. First visit: welcome tour');
  const tctx = await newPhone(null, { tour: true });
  const tp = await tctx.newPage();
  await tp.goto(BASE + '/');
  const dlg = tp.getByRole('dialog');
  await dlg.waitFor({ timeout: 8000 }).catch(() => undefined);
  check('first visit shows the welcome tour', await dlg.isVisible().catch(() => false));
  await shot(tp, 'a0-welcome');
  await dlg.getByRole('button', { name: 'Next' }).click().catch(() => undefined);
  await sleep(300);
  await tp.getByRole('button', { name: 'Skip' }).click();
  await sleep(300);
  check('Skip closes the tour and reveals Start', !(await dlg.isVisible().catch(() => false)) && (await tp.getByRole('button', { name: 'Start', exact: true }).isVisible()));
  await tp.reload(); await sleep(700);
  check('the tour does not come back on the next visit', !(await tp.getByRole('dialog').isVisible().catch(() => false)));
  await tctx.close();

  /* ============ A. Run a full session with a simulated 6-DoF hand, check the data. The phone registers itself on upload. ============ */
  console.log('A. Full session (simulated 6-DoF hand, live camera behind), phone registers itself');

  const phoneCtx = await newPhone();
  const page = await phoneCtx.newPage();
  const consoleErrors = []; page.on('pageerror', (e) => consoleErrors.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  await page.goto(BASE + '/?sim=1');
  await page.getByRole('button', { name: 'Start', exact: true }).waitFor();
  await sleep(900);
  const homeText = await page.locator('main').innerText();
  check('Home has no enrolment or QR step', !/enrol|QR/i.test(homeText), homeText.match(/.{0,30}(enrol|QR).{0,30}/i)?.[0] || '');
  check('Home has the guide, a try-it demo and the phone check', /guide/i.test(homeText) && /try it/i.test(homeText) && /phone check/i.test(homeText));
  await shot(page, 'a-00-home');
  check('Home: no horizontal scroll at 390px', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  check('setup screen: no horizontal scroll at 390px', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await fillSetup(page, { code: 'E2E001', trials: 1, secs: 14 });
  await shot(page, 'a-01-setup');
  await shot(page, 'a-01b-ready');
  await page.getByRole('button', { name: 'Start session' }).click();
  await page.evaluate(`(${BOT})()`);

  let lostSeen = false, banner = false;
  await runSession(page, {
    tag: 'a',
    onPhase: async (snap, p) => {
      if (snap.phase === 'range') await shot(p, 'a-04-range');
      if (snap.phase === 'playing') {
        setTimeout(() => shot(p, `a-06-play-${snap.game}`).catch(() => undefined), 2200);
        setTimeout(() => shot(p, `a-06c-play-${snap.game}`).catch(() => undefined), 4700);
        if (snap.game === 'maths') {            // knock out tracking for 1.3 s in the middle of a trial
          setTimeout(async () => { await p.evaluate(() => window.__cars.simDrop(1300)); await sleep(700); banner = await p.getByText('Tracking lost').first().isVisible().catch(() => false); lostSeen = true; await shot(p, 'a-06b-tracking-lost'); }, 6000);
        }
      }
    }
  });
  check('tracking-loss banner appears and the game resumes by itself', lostSeen && banner);
  const res = await page.evaluate(() => window.__carsResult);
  const rec = res.record;
  check('session recorded in position-tracked (6-DoF style) mode with a calibration', rec.mode === 'sim' && rec.calibration && rec.calibration.pass);
  check('order was randomised, practice and the safety briefing were recorded', rec.orderMode === 'random' && rec.sequence && rec.sequence.length === 3 && new Set(rec.sequence).size === 3 && rec.practice === true && rec.briefed === true, JSON.stringify([rec.orderMode, rec.sequence, rec.practice, rec.briefed]));
  check('3D renderer started (WebGL available)', (rec.quality || []).some((q) => q.event === 'renderer' && q.value === 1));
  const ev = rec.events;
  const byGame = (g) => ev.filter((e) => e.game === g);
  check('every game produced items', ['triangle', 'maths', 'colour'].every((g) => byGame(g).length >= 3), ['triangle', 'maths', 'colour'].map((g) => g + ':' + byGame(g).length).join(' '));
  check('targets are 3D positions with zone, azimuth, elevation', ev.every((e) => e.zone && e.targetX != null && e.targetY != null && e.targetZ != null && e.targetAz != null && e.targetEl != null));
  const tri = byGame('triangle');
  const zones = new Set(ev.map((e) => e.zone));
  check('targets appear in many different regions of the room', zones.size >= 5, [...zones].join(','));
  const dists = ev.filter((e) => e.startToTargetCm != null).map((e) => e.startToTargetCm);
  check('every reach is a real movement (>= 5 cm)', dists.length > 5 && Math.min(...dists) >= 5, 'min ' + Math.min(...dists));
  let consecOk = true;
  for (let i = 1; i < tri.length; i++) { const a = tri[i - 1], b = tri[i]; const d = Math.hypot(a.targetX - b.targetX, a.targetY - b.targetY, a.targetZ - b.targetZ); if (d < 9) consecOk = false; }
  check('consecutive triangles are apart (>= 9 cm)', tri.length >= 3 && consecOk);
  const nums = [];
  for (const e of byGame('maths')) { const m = e.stimulus.match(/^(\d+) ([+-]) (\d+)$/); if (m) nums.push(+m[1], +m[3]); nums.push(+e.correctAnswer); (e.options.match(/(\d+)@/g) || []).forEach((x) => nums.push(parseInt(x))); }
  check('Maths Fun: every number shown is between 1 and 10', nums.length > 8 && nums.every((n) => n >= 1 && n <= 10), 'min ' + Math.min(...nums) + ' max ' + Math.max(...nums));
  check('Colour Merge Test: items record congruent/incongruent condition', byGame('colour').some((e) => e.condition === 'incongruent'));
  check('wrong touches are recorded as errors', ev.some((e) => (e.errorsBefore || 0) > 0));
  check('trials carry 3D range of motion', rec.trials.every((t) => t.rom && t.rom.h > 0 && t.rom.d != null));
  check('movement samples carry hand position in cm', res.kin.length > 100 && res.kin.some((r) => r[7] != null && r[9] != null));
  check('movement shows real travel (hand reached > 15 cm from the start)', res.kin.some((r) => Math.hypot(r[7], r[8], r[9]) > 15));
  await shot(page, 'a-08-questions');

  // Questionnaire + therapist notes
  for (const q of ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7']) await page.locator(`label[for="${q}-4"]`).click();
  await page.getByLabel(/negative symptoms/).fill('none');
  await page.getByLabel('Session notes').fill('e2e run');
  await page.getByRole('button', { name: 'Save session' }).click();
  await page.getByRole('heading', { name: /Session 1 (complete|saved)/ }).waitFor();
  await page.getByText('Uploaded to the study').waitFor({ timeout: 20000 });
  check('session uploads automatically after saving', true);
  await sleep(500);
  await shot(page, 'a-09-done');

  // Phone-side download
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /the Excel sheet/ }).click()]);
  await dl.saveAs(OUT + 'e2e_phone.xlsx');
  check('Excel data sheet downloads on the phone', /^CARS_E2E001_S01_\d{4}-\d{2}-\d{2}\.xlsx$/.test(dl.suggestedFilename()), dl.suggestedFilename());
  check('no browser errors during the full session', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

  /* ============ B. iPhone (Safari) emulation: motion permission, orientation drives the aim, share sheet saves the sheet ============ */
  console.log('B. iPhone-style motion mode (rotation only), share sheet');
  const ictx = await newPhone(null, { userAgent: IPHONE_UA });
  await ictx.addInitScript(`(${ORIENT})();
    window.__shared = [];
    navigator.canShare = () => true;
    navigator.share = async (d) => { window.__shared.push((d.files || []).map((f) => f.name)); };`);
  const ip = await ictx.newPage();
  await ip.goto(BASE + '/');
  await sleep(600);
  await fillSetup(ip, { code: 'E2E002', trials: 1, secs: 14, games: ['Triangle Reach', 'Maths Fun'], mode: 'motion', level: 2, practice: false });
  await shot(ip, 'b-01-ready-iphone');
  const readyText = await ip.locator('main').innerText();
  check('iPhone: setup explains that only rotation is measured', /rotation/i.test(readyText));
  await ip.getByRole('button', { name: 'Start session' }).click();
  let mapped = null;
  await runSession(ip, {
    tag: 'b',
    onPhase: async (snap, p) => {
      if (snap.phase === 'cal_ready') await p.evaluate(`(${BOT})(); window.__bot.mode = 'motion'; window.__bot.turn = 120;`);
      if (snap.phase === 'game_intro' && snap.gameIndex === 0) {
        // 10 degrees to the right and 10 degrees up: the aim point on a 50 cm sphere lands about 8.5 / 8.7 cm from the centre
        await p.evaluate(() => { window.__bot.freeze = true; window.__orient(350, 100, 0); });
        await sleep(900);
        mapped = await p.evaluate(() => window.__cars.debug().handCm);
        await p.evaluate(() => { window.__orient(0, 90, 0); window.__bot.yaw = 0; window.__bot.pitch = 0; window.__bot.freeze = false; });
        await sleep(500);
      }
    }
  });
  check('motion mapping: 10° right / 10° up lands at about (+8.5, +8.7) cm on the aim sphere', mapped && Math.abs(mapped[0] - 8.5) < 1.2 && Math.abs(mapped[1] - 8.7) < 1.2, JSON.stringify(mapped && mapped.map((v) => +v.toFixed(2))));
  const ires = await ip.evaluate(() => window.__carsResult);
  check('iPhone run recorded targets and touches in motion mode', ires.record.mode === 'motion' && ires.record.events.filter((e) => e.outcome === 'correct').length >= 4, 'correct ' + ires.record.events.filter((e) => e.outcome === 'correct').length);
  await ip.getByRole('button', { name: 'Skip questions' }).click();
  await ip.getByRole('heading', { name: /Session 1 (complete|saved)/ }).waitFor();
  await ip.getByText('Uploaded to the study').waitFor({ timeout: 20000 });
  check('motion session is flagged on the results screen', await ip.getByText(/Motion tracking was used/).isVisible());
  await ip.getByRole('button', { name: /Save or share the Excel sheet/ }).click();
  await sleep(1200);
  const shared = await ip.evaluate(() => window.__shared);
  check('iPhone: the data sheet goes through the share sheet (Save to Files)', shared.length === 1 && /\.xlsx$/.test(shared[0][0]), JSON.stringify(shared));
  await shot(ip, 'b-09-done-iphone');

  /* ============ C. Offline: session saved on the phone, uploads when the connection returns ============ */
  console.log('C. Offline queue (touch practice mode)');
  const octx = await newPhone();
  const op = await octx.newPage();
  await op.goto(BASE + '/'); await sleep(600);
  await fillSetup(op, { code: 'E2E003', trials: 1, secs: 14, games: ['Triangle Reach'], mode: 'touch', practice: false });
  await op.getByRole('button', { name: 'Start session' }).click();
  await op.evaluate(`(${BOT})(); window.__bot.mode = 'touch';`);
  await octx.setOffline(true);
  await runSession(op, { tag: 'c' });
  await op.getByRole('button', { name: 'Skip questions' }).click();
  await op.getByRole('heading', { name: /Session 1 (complete|saved)/ }).waitFor();
  check('offline: session is kept on the phone and says it will upload later', await op.getByText(/Waiting to upload/).first().isVisible());
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
  const sid = ap.url().match(/sessions\/([0-9a-f-]{36})/)[1];
  // comment, then title: both show on the page and in the Excel sheet
  await ap.getByLabel('Add a comment').fill('Phone slipped on the strap in trial 3.');
  await ap.getByRole('button', { name: 'Add comment' }).click();
  await ap.getByText('Phone slipped on the strap in trial 3.').waitFor();
  check('admin can comment on a session', true);
  await ap.getByLabel('Title', { exact: true }).fill('Baseline run');
  await ap.getByLabel('Notes', { exact: true }).fill('Checked by hand');
  await ap.getByRole('button', { name: 'Save changes' }).click();
  await ap.getByRole('heading', { level: 1, name: 'Baseline run' }).waitFor();
  check('admin can rename a session', true);
  await ap.screenshot({ path: SHOTS + 'd-05b-session-managed.png', fullPage: true });
  const xr = await ap.request.get(BASE + '/api/export/session/' + sid);
  const xf = unzipText(Buffer.from(await xr.body()));
  const xall = Object.values(xf).join('\n');
  check('the session Excel sheet has a Comments tab with the comment, the title and the notes', /<sheet name="Comments"/.test(xf['xl/workbook.xml']) && /strap in trial 3/.test(xall) && /Baseline run/.test(xall) && /Checked by hand/.test(xall));
  await ap.goto(BASE + '/admin/quality'); await shot(ap, 'd-06-quality');
  await ap.goto(BASE + '/admin/devices'); await shot(ap, 'd-07-devices');
  const devText = await ap.locator('main').innerText();
  check('Phones page lists the phones that registered themselves, with no QR step', (devText.match(/Active/g) || []).length >= 3 && /iPhone · Safari/.test(devText) && !/QR|Enrol/i.test(devText), devText.slice(0, 200).replace(/\n/g, ' | '));
  await ap.goto(BASE + '/admin/exports'); await shot(ap, 'd-08-exports');
  await ap.goto(BASE + '/admin/sessions?participant=E2E001');
  check('Sessions list shows the title and a comment count, and offers an Excel export of what is filtered', await ap.getByText('Baseline run').first().isVisible() && await ap.getByRole('link', { name: /Download these 1 \(Excel\)/ }).isVisible());
  // participant: rename then delete (admin only, typed confirmation)
  await ap.goto(BASE + '/admin/participants/E2E003');
  await ap.getByLabel('Rename participant ID').fill('E2E003B');
  await ap.getByRole('button', { name: 'Rename', exact: true }).click();
  await ap.waitForURL(/participants\/E2E003B/);
  check('admin can rename a participant', true);
  await ap.locator('summary', { hasText: 'Delete this participant' }).click();
  await ap.locator('.danger-zone input[name="confirm"]').fill('DELETE');
  await ap.getByRole('button', { name: /Delete E2E003B/ }).click();
  await ap.waitForURL(/admin\/participants$/);
  check('admin can delete a participant (typed confirmation)', !(await ap.locator('main').innerText()).includes('E2E003B'));
  const [adl] = await Promise.all([ap.waitForEvent('download'), ap.goto(BASE + '/api/export/study').catch(() => undefined)]);
  await adl.saveAs(OUT + 'e2e_study.xlsx');
  const [sdl] = await Promise.all([ap.waitForEvent('download'), ap.evaluate((u) => { location.href = u; }, '/api/export/participant/E2E001')]);
  await sdl.saveAs(OUT + 'e2e_participant.xlsx');
  check('admin can download study and participant workbooks', true);
  await ap.setViewportSize({ width: 1280, height: 800 });
  await ap.goto(BASE + '/admin'); await ap.screenshot({ path: SHOTS + 'd-09-overview-desktop.png' });
  await ap.goto(BASE + '/admin/sessions'); await ap.screenshot({ path: SHOTS + 'd-10-sessions-desktop.png' });

  // Dark theme + landscape sanity
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
