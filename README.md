# CARS Rehab: stroke-rehabilitation web app

A phone web app for the CARS study design (Li et al., JMIR Serious Games 2021) with three games, automatic research-ready data sheets and a separate admin board.

| Game | What the participant does |
|---|---|
| **Triangle Reach** | Reach for a triangle that appears far from the centre; consecutive targets are at least 90° apart, so the arm moves in different directions. |
| **Maths Fun** | Addition and subtraction; every number in the question and every answer option is 1 to 10. Touch the correct answer. |
| **Colour Merge Test** | Touch the word that is written in the colour named in the prompt (incongruent and congruent items; interference score computed). |

Flow: enrol phone, enter participant ID, start tracking, 2 s calibration (rate and jitter check), 4-dot range check, three games × N trials, short questionnaire, automatic upload and a 9-tab Excel sheet.

## Which phones give which data quality

| Phone | Mode | Data |
|---|---|---|
| Android with ARCore, Chrome | `6dof` (WebXR immersive-ar) | True 3D position in cm. This is the research-grade mode. |
| iPhone / iPad (Safari) | `motion` (DeviceOrientation, 3-DoF) | Orientation only, shown as aim direction. Every such session is flagged `not_6dof` in the data and on the admin board. |
| Any browser, `?sim=1` or touch | `touch` / `sim` | Practice and testing only. Flagged `practice_mode`. |

Honest limitation: Safari on iPhone does not expose WebXR AR, so iPhone data is never mixed silently with 6-DoF data. The 6-DoF code path was written to the WebXR spec but could only be exercised with a simulated sensor here, not on a physical ARCore phone. Do a 10-minute check on your target Android phone before the study.

## Run locally

```bash
npm install
cp .env.example .env.local        # set AUTH_SECRET, BOOTSTRAP_ADMIN_EMAIL/PASSWORD
npm run dev                       # http://localhost:3000  (file store in .data)
```

Camera, WebXR and motion sensors need HTTPS on a real phone. For local phone testing use a tunnel (for example `cloudflared tunnel --url http://localhost:3000`).

## Deploy on Vercel with Supabase

1. **Supabase**: create a project. In the SQL editor run `supabase/migrations/0001_init.sql` (tables, row-level security on with no policies, private `kinematics` bucket).
2. **Vercel**: import the repository (framework: Next.js). Add environment variables:
   - `AUTH_SECRET`: 48+ random characters (`node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`)
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (server only; never exposed to the browser)
   - `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD`
3. Deploy. The app errors on Vercel without Supabase, because the file store cannot write there.
4. Open `/admin/login`, sign in with the bootstrap account, change the password, turn on two-factor under *My account*, then remove the bootstrap variables.
5. **Enrol phones**: Admin > Phones > *New enrolment* shows a QR code and a single-use 24-hour code. Scan it on the study phone. The phone then holds a revocable device token (only its hash is stored on the server).

## Data

- Each session is uploaded automatically (idempotent, safe to retry). If there is no signal it waits in the phone's offline queue and syncs when online.
- The phone also builds the same Excel sheet locally, so data can be exported even if the server is unreachable.
- Admin board: overview, participants (progress charts), sessions (full detail, reach map), data quality, exports, phones, staff, settings, audit log.
- Excel tabs: `Session`, `Trial_Summary`, `Game_Summary`, `Events`, `Kinematics` (20 Hz), `Sensor_Quality`, `Questionnaire`, `Progress`, `Data_Dictionary`. The same data is available as study-wide xlsx, long-format CSV, events CSV, kinematics JSON and a dictionary CSV.
- Summaries and quality flags are recomputed on the server from the raw events, so a modified client cannot change them. Flags: `cal_override`, `not_6dof`, `practice_mode`, `incomplete`, `low_tracking`, `many_dropouts`, `low_rate`, `fast_responses`, `score_mismatch`, `duplicate_session_no`, `kin_missing`, `cal_failed`.
- Dates and times are phone-local (the phone's UTC offset is stored with each session).

## Security notes

Staff passwords are scrypt-hashed; sessions are 8-hour HttpOnly, Secure, SameSite=Lax JWT cookies re-checked against the staff table on each request; optional TOTP; lockout after 5 failures; same-origin checks on state-changing routes; per-IP rate limits; strict security headers and CSP; roles `admin` / `researcher` / `therapist`; audit log of admin actions. Known limits: the CSP allows inline scripts (no nonce), and rate limiting is in memory per serverless instance, so add Vercel Firewall rate-limit rules for a public deployment.

## Tests

```bash
npm test            # unit tests + typecheck
npm run build
npm run test:api    # needs a production build; spawns next start on :3101
npm run test:e2e    # Playwright, phone viewport; needs a build and Chromium
```

`test:e2e` expects Chromium at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`; set `CHROME_PATH` to use another.

## Known limitations

Excel files are built on the phone's main thread (fine for the sizes here) and the study-wide export is built in memory on the server. Only the sim and mocked-DeviceOrientation paths are covered by automated tests.
