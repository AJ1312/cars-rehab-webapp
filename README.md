# CARS Rehab: stroke-rehabilitation web app

A phone web app for the CARS study design (Li et al., JMIR Serious Games 2021): the participant holds the phone like a wand, a live rear-camera picture fills the screen, and 3D objects float at random places in the room. You touch an object by moving the phone into it. Three games, automatic research-ready data sheets and a separate admin board.

| Game | What the participant does |
|---|---|
| **Triangle Reach** | Orange triangles appear at random places around the participant (left or right, high or low, near or far). Consecutive triangles are always far apart, so the arm reaches in different directions rather than making small movements. |
| **Maths Fun** | A sum such as `7 - 2 = ?` is shown in the middle of the screen; numbered answer badges float around the room. Addition and subtraction only; every number in the question and every answer is 1 to 10. |
| **Colour Merge Test** | A colour name is shown in the middle; coloured words float around the room. Touch the word written in that ink colour (congruent and incongruent items; the interference score is computed). |

The screen follows Fig. 2 of the paper: score top-left, timer top-right, the question or prompt in the centre, answers around it. Arrows with distances (cm, or degrees in motion mode) point to objects that are off-screen.

Flow: enrol phone, enter participant ID, choose level and games, start tracking, 2 s calibration (rate and jitter check), 4-point range check, the games x N trials (each reach starts from a start ring, so reach distances are comparable), short questionnaire, automatic upload and a 9-tab Excel sheet.

## How touching works

Everything is in a calibrated frame: x right, y up, z forward, origin where the phone was held during calibration.

- **Position tracking (Android, WebXR):** the phone's position is the hand. Objects are placed 20, 30 or 40 cm (level 1, 2, 3) from the start point, with a reach between 72 % and 100 % of that radius, in eight cells (left/right x low/high x near/far), shuffled so every region is used, and never closer than the level radius to the previous target. An object is touched when the phone is within 7 cm of its centre for the hold time (default 250 ms).
- **Rotation only (iPhone, other phones):** objects sit on a 50 cm sphere in front of the user and you aim the centre ring at them. Reach is measured in degrees. Flagged in the data.

## Which phones give which data quality

| Phone | Mode | Data |
|---|---|---|
| Android with ARCore, Chrome | `6dof` (WebXR immersive-ar) | True 3D position in cm. This is the research-grade mode. The camera picture and the 3D objects come from the same AR session, so objects stay fixed in the room. |
| iPhone / iPad (Safari) | `motion` (DeviceOrientation, 3-DoF) | Orientation only, shown as aim direction, with the live camera behind. Every such session is flagged `not_6dof` in the data and on the admin board. |
| Any browser, `?sim=1` or touch | `touch` / `sim` | Practice and testing only (drag a finger to look around). Flagged `practice_mode`. |

**Honest limitations**

- Safari on iPhone does not expose WebXR AR, so an iPhone cannot measure position from a web page. iPhone data is never mixed silently with 6-DoF data. For true iPhone position tracking the page would have to be opened through an ARKit-based WebXR launcher (an App Clip or a WebXR browser app); this is not built or tested here.
- The WebXR code path follows the specification (`immersive-ar`, `local` reference space, DOM overlay for the score, timer and buttons) but could only be exercised with a simulated sensor here, not on a physical ARCore phone. Do a 10-minute check on your target Android phone before the study.
- iPhone details handled: the motion-permission prompt is requested inside the tap, the Excel sheet is saved through the share sheet (Save to Files), storage persistence is requested, and older iOS versions fall back where `CompressionStream` or `crypto.randomUUID` are missing. A Home Screen app and Safari keep separate saved data, so enrol in the one you will use.

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
- Admin board: overview, participants (progress charts), sessions (full detail, front and top reach maps with the target positions), data quality, exports, phones, staff, settings, audit log.
- The Events tab has one row per item with the target position (`target_x/y/z_cm`, `target_az/el_deg`, `target_zone`, `target_reach_cm`, `start_to_target_cm`), the answer given, error count, reaction time, movement time, path length and path efficiency. Trial summaries include range of motion (horizontal, vertical, depth). Questionnaire ratings are numeric (`response_score`) with free text in a separate column.
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

`test:e2e` drives full sessions in a phone-sized Chromium with a simulated hand that flies to the targets in 3D, an iPhone-style rotation-only run, an offline run and the admin pages, and writes screenshots to `test/shots`. It expects Chromium at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`; set `CHROME_PATH` to use another.

## Known limitations

Excel files are built on the phone's main thread (fine for the sizes here) and the study-wide export is built in memory on the server. Only the simulated-hand, touch and mocked-DeviceOrientation paths are covered by automated tests; WebXR on real hardware is not.
