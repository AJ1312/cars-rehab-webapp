# CARS Rehab: stroke-rehabilitation web app

A phone web app built on the CARS study design (Li et al., *JMIR Serious Games* 2021). The participant holds the phone like a wand. The live rear-camera picture fills the screen, and 3D objects float at random places in the room. The participant touches an object by moving the phone into it. The app has three games, an automatic research-ready Excel data sheet for every session, and a separate admin board for the study team.

| Game | What the participant does |
|---|---|
| **Triangle Reach** | Orange triangles appear at random places around the participant (left or right, high or low, near or far). Consecutive triangles are always far apart, so the arm reaches in different directions rather than making small movements. Several triangles are on screen at once. |
| **Maths Fun** | A sum such as `7 - 2 = ?` is shown in the middle; numbered answer badges float around the room. Addition and subtraction only; every number in the question and every answer is 1 to 10. |
| **Colour Merge Test** | A colour name is shown in the middle; coloured words float around the room. The participant touches the word written in that ink colour. Congruent and incongruent items are mixed, and an interference score is computed. |

The screen follows Fig. 2 of the paper: score top-left, timer top-right, the question or prompt in the centre, the answers around it. Arrows with distances (cm, or degrees in rotation mode) point to objects that are off-screen.

## Contents

1. [Quick start](#quick-start)
2. [Deploy on Vercel with Supabase](#deploy-on-vercel-with-supabase)
3. [Admin login](#admin-login)
4. [What the admin board can do](#what-the-admin-board-can-do)
5. [How a session runs](#how-a-session-runs)
6. [Settings the therapist chooses](#settings-the-therapist-chooses)
7. [Which phones give which data quality](#which-phones-give-which-data-quality)
8. [Data and the Excel sheet](#data-and-the-excel-sheet)
9. [Security](#security)
10. [Tests](#tests)
11. [Known limitations](#known-limitations)

More detail on method and validity: [`docs/RESEARCH_REFERENCE.md`](docs/RESEARCH_REFERENCE.md).

## Quick start

```bash
npm install
cp .env.example .env.local        # set AUTH_SECRET, BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_PASSWORD
npm run dev                       # http://localhost:3000  (file store in .data)
```

- The participant app is at `/`. Add `?sim=1` to try the games on a computer (drag with the mouse to look around).
- The admin board is at `/admin/login`.
- Camera, WebXR and motion sensors need HTTPS on a real phone. For local phone testing use a tunnel, for example `cloudflared tunnel --url http://localhost:3000`.

## Deploy on Vercel with Supabase

1. **Supabase**: create a project. In the SQL editor run, in order:
   - `supabase/migrations/0001_init.sql` (tables, row-level security on with no policies, private `kinematics` bucket)
   - `supabase/migrations/0002_phones_register_themselves.sql`
   - `supabase/migrations/0003_admin_manage.sql` (session titles, comments, deleted-session record)
2. **Vercel**: import the project (framework: Next.js). Add these environment variables:
   - `AUTH_SECRET`: 48+ random characters. Create one with `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`.
   - `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (server only; never sent to the browser).
   - `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD` (your admin sign-in; the password needs at least 10 characters).
3. Deploy. On Vercel the app needs Supabase, because the file store cannot write there.
4. Open `/admin/login` and sign in with the two bootstrap values. Then change the password, turn on two-factor sign-in under *My account*, and remove the two bootstrap variables from Vercel.

There is no phone set-up step. A study phone opens the site, plays, and registers itself the first time it has something to upload (see [Phones](#phones)).

## Admin login

There is **no default user name or password**. Shipping a fixed password in a study app that holds health data would be unsafe, so you choose your own:

| | |
|---|---|
| Address | `<your-site>/admin/login` |
| ID (e-mail) | the value of `BOOTSTRAP_ADMIN_EMAIL` |
| Password | the value of `BOOTSTRAP_ADMIN_PASSWORD` |

The first successful sign-in with those two values creates the first account, with the **admin** role, while the staff table is empty. After that, add colleagues under *Staff* and give them a role:

| Role | Can do |
|---|---|
| `therapist` | See sessions and participants, add comments, download the dictionary. |
| `researcher` | Everything a therapist can, plus edit and rename sessions and participants, and download every Excel and CSV export. |
| `admin` | Everything, plus delete sessions and participants, remove phones, manage staff, change study settings and read the audit log. |

Staff accounts lock for 15 minutes after 5 wrong attempts. Two-factor sign-in (an authenticator app) is optional and set up under *My account*.

## What the admin board can do

- **See everything.** Overview, every participant (with progress charts), every session (full detail: settings, game order, practice, safety briefing, adverse events, scores per game, reach maps with the target positions, data-quality flags), data quality, exports, phones, staff, settings and the audit log. Previous sessions and results stay visible; nothing is hidden by date.
- **Edit a session.** Participant ID, session number, group, therapist, a title and notes. Quality flags are recomputed after an edit, and the audit log records the before and after values.
- **Rename a participant** across all their sessions (blocked if it would clash with an existing session number).
- **Delete** a single session or a whole participant (admin only; you type `DELETE` to confirm). Deleted sessions are remembered, so a phone that still holds one does not upload it again.
- **Comment on a specific session.** Any staff member can add comments; the author or an admin can delete one. Comments are shown on the session and participant pages and are exported as a `Comments` sheet.
- **Export to Excel.** One session, one participant, or the whole study as `.xlsx`, plus CSV (long format and events), a data dictionary and the raw kinematics. On the *Sessions* page, *Download these N (Excel)* exports exactly the sessions currently filtered on screen (by participant or flagged).
- **Phones.** A list of the phones that have registered, each with a readable label such as `iPhone · Safari · 7F3A`, the last time it was seen, and a *Remove* button.

### Phones

A phone registers itself silently the first time it has a session to upload: it asks the server for a token, and the server stores only a hash of it. There is no QR code and no code to type. A removed phone keeps playing and can still download its Excel sheet, but its sessions no longer upload and the app says so.

Because anyone with the site address could register a phone, registration is rate limited per IP and overall, and you can remove any phone in the admin board. For a public deployment also add Vercel Firewall rate-limit rules.

## How a session runs

1. **Home.** A bento screen with *Start*, the *Guide*, a one-minute *Try it* demo (nothing is saved), a phone check, and past sessions. A first-time welcome tour explains the screen.
2. **Who is playing.** Participant ID (and group, therapist, session number).
3. **Set up.** Level, which games, game order, object distance and size, practice trial, the safety briefing and the camera choice.
4. **Calibrate.** 2 s of stillness (rate and jitter check), then a 4-point range check. Then the **5 s system initialisation** the paper describes.
5. **Play.** For each game: an optional short **practice trial** (not scored or recorded), then the timed trials. Each reach starts from a start ring, so reach distances are comparable. Haptic feedback on every touch, a longer buzz at the end of a trial.
6. **Questionnaire.** The paper's 7-question satisfaction questionnaire (1 to 5), a pain/fatigue rating and adverse-event tags (shoulder pain, elbow pain, fatigue, dizziness, other).
7. **Upload.** Automatic and idempotent. If the phone is offline the session waits in the phone's queue and uploads later. The same Excel sheet can be downloaded on the phone.

Protocol defaults follow the paper: 5 trials per game, 120 s per trial, three games (15 trials, about 30 minutes), 10 sessions over 2 weeks. The session number and the study week are written into every sheet.

## Settings the therapist chooses

| Setting | Options |
|---|---|
| **Object distance** | **Close**, **Medium**, **Far**. Close packs objects nearer the phone and the middle of the screen; Far spreads them over the whole screen. All objects always fit on screen, never overlap, and their touch zones never overlap. |
| **Object size** | **Small**, **Medium**, **Large** (triangles, numbers and words). |
| **Level** | 1, 2, 3. Sets the reach distance (about 25, 35 or 45 cm in position tracking) and how many objects are on screen (3 to 5). |
| **Game order** | **Random** (new order every session), **Fixed** (Triangle, Maths, Colour as in the paper), **Rotate** (order rotates with the session number, so it is counterbalanced), **Mixed** (trials of the three games interleaved in random rounds). The order actually played is recorded in the data. |
| **Practice trial** | On by default, as in the paper. |
| **Camera picture** | Show or hide the live camera behind the game. |

Object placement is random on every trial (position, left or right, high or low, near or far, number and which character), with a rule that consecutive targets must be far apart.

**Haptics.** Android Chrome vibrates on each touch. Safari on iPhone does not offer the vibration API to web pages, so on iPhone the app gives sound, a visual pulse and a light tick on buttons where the phone allows it, and says so in the phone check.

## Touching, the crosshair and Android

- **Rotation mode (iPhone, or any phone without AR):** the ring in the middle of the screen is the crosshair. An object counts as touched when the crosshair is on the object itself (the word, number or triangle plus a small margin) for the hold time. An outline around the object fills as you hold. Objects never overlap, and nothing sits on the straight path from the middle of the screen to another object, so aiming at one does not brush another.
- **Position tracking (Android AR):** the phone itself is the hand. A crosshair in the middle of the screen shows where the phone points, and the label under the nearest object counts the centimetres left to reach it. An object is touched when the phone is within 7 cm of its centre. The AR near-clip plane is pulled in to 2 cm, so objects stay visible until the moment of the touch.
- **Android checklist:** Chrome (or Samsung Internet) with *Google Play Services for AR* installed, camera allowed, site opened over HTTPS. The calibration check needs at least 20 Hz (many phones run ARCore at 30 fps). If AR will not start, the error names the reason; use *Change tracking mode > Motion tracking* as a fallback.

## Which phones give which data quality

| Phone | Mode | Data |
|---|---|---|
| Android with ARCore, Chrome | `6dof` (WebXR `immersive-ar`) | True 3D position in cm. This is the research-grade mode. The camera picture and the 3D objects come from the same AR session, so objects stay fixed in the room. |
| iPhone / iPad (Safari) | `motion` (DeviceOrientation, 3-DoF) | Orientation only: the participant aims the centre ring at objects and reach is measured in degrees, with the live camera behind. Every such session is flagged `not_6dof`. |
| Any browser, `?sim=1` or touch | `touch` / `sim` | Practice and testing only. Flagged `practice_mode`. |

## Data and the Excel sheet

Every session produces one workbook with these tabs:

`Session`, `Trial_Summary`, `Game_Summary`, `Events`, `Kinematics` (20 Hz), `Sensor_Quality`, `Questionnaire`, `Progress`, `Comments`, `Data_Dictionary`.

- `Events` has one row per item: the target position (`target_x/y/z_cm`, `target_az/el_deg`, `target_zone`, `target_reach_cm`, `start_to_target_cm`), the answer given, errors, reaction time, movement time, path length and path efficiency.
- `Trial_Summary` adds range of motion (horizontal, vertical, depth). Questionnaire ratings are numeric (`response_score`) with free text in a separate column.
- The same data is available for the whole study (`.xlsx`, long-format CSV, events CSV, kinematics JSON, dictionary CSV).
- The server recomputes every summary and quality flag from the raw events, so a modified client cannot change them. Flags: `cal_override`, `not_6dof`, `practice_mode`, `incomplete`, `low_tracking`, `many_dropouts`, `low_rate`, `fast_responses`, `score_mismatch`, `duplicate_session_no`, `kin_missing`, `cal_failed`.
- Dates and times are phone-local (the phone's UTC offset is stored with each session).
- `Clinical_Scores` columns (FMA-UE, ARAT, MMT, Brunnstrom, Barthel, MMSE) are a **template** for the study team to fill in; the app does not collect those assessments.

## Security

Staff passwords are scrypt-hashed. Sign-in cookies are 8-hour HttpOnly, Secure, SameSite=Lax JWTs that are re-checked against the staff table on every request. Optional TOTP, lockout after 5 failures, same-origin checks on state-changing routes, per-IP rate limits, strict security headers and a CSP, role checks on every admin route, and an audit log of every admin action (sign-in, edits, deletes, comments, exports, phone registration and removal). Phone tokens are stored only as hashes. Known limits: the CSP allows inline scripts (no nonce), and rate limiting is in memory per serverless instance, so add Vercel Firewall rules for a public deployment.

## Tests

```bash
npm test            # unit tests + typecheck
npm run build
npm run test:api    # needs a production build; starts next start on :3101
npm run test:e2e    # Playwright, phone viewport; needs a build and Chromium
```

`test:e2e` drives full sessions in a phone-sized Chromium with a simulated hand that flies to the targets in 3D, an iPhone-style rotation-only run, an offline run, and the admin pages (comments, rename, delete, Excel export). It writes screenshots to `test/shots`. It expects Chromium at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`; set `CHROME_PATH` to use another.

## Known limitations

- The WebXR code path follows the specification, but it could only be exercised with a simulated sensor here, not on a physical ARCore phone. Do a 10-minute check on your target Android phone before the study.
- Safari on iPhone does not offer WebXR AR to web pages, so an iPhone measures rotation only (3-DoF), not hand position. iPhone data is flagged and never mixed silently with 6-DoF data.
- Phone-in-portrait limits how far apart objects can be sideways; the Close/Medium/Far setting trades reach against how much fits on screen.
- This is a research prototype, not a medical device, and it has not been validated against a clinical motion-capture system.
- Excel files are built on the phone's main thread (fine for these sizes) and the study-wide export is built in memory on the server.
