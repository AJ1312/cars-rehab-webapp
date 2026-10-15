# Research reference

What the app measures, how, and where its limits are. Read this before using the data in a paper or a protocol.

## Source design

Li et al., *JMIR Serious Games* 2021: three phone-based AR games (Add vs Sub, Stroop, Pyramid Reach in the paper), 5 trials per game, about 30 minutes per session, 10 sessions over 2 weeks, a 5 s initialisation, a practice trial per game, a 7-question satisfaction questionnaire (1 to 5), and adverse events recorded by the therapist (pain and fatigue in the shoulder or elbow).

This app's required changes to that design: Maths Fun (addition and subtraction, digits 1 to 10 only), Colour Merge Test (Stroop-type), Triangle Reach (several triangles far apart, reached in different directions).

## How position is measured

- **Android, WebXR (`6dof`).** The phone's tracked position is the hand. Positions are in a calibrated frame: x right, y up, z forward, origin where the phone was held at calibration. Units are centimetres. Samples are stored at 20 Hz.
- **Rotation only (`motion`, iPhone).** Only orientation is known. Objects sit on a 50 cm sphere and "reach" is an angle in degrees. Distances in centimetres in these sessions are not hand distances.
- **`touch` / `sim`.** Practice only.

A touch is registered when the phone is within 7 cm of an object's centre for the hold time (default 250 ms). If two touch zones overlap, the nearest centre wins.

## Object placement (on-screen model)

Objects are placed so that they are all visible on the screen at once, never overlap, and have non-overlapping touch zones.

- **Distance setting** (Close, Medium, Far) changes how far from the phone objects sit, how far they spread over the screen, and their apparent size.
- **Level** (1, 2, 3) sets the mid reach (about 25, 35, 45 cm) and the number of objects (3 to 5).
- **Size** (Small, Medium, Large) scales the apparent size of triangles, numbers and words.
- Each triangle set keeps clear of the hand's current position and of the last triangle touched (at least about 12 cm), and, as far as the screen allows, of the previous set, so each reach is a real movement.
- Placement is random on every item. Zone labels (`left-high-far` and so on), azimuth, elevation and reach are stored for every target.

Because the phone is held in portrait, the sideways spread is smaller than the vertical spread. This is a property of the screen, not a bug.

## What the sheet contains

See the `Data_Dictionary` tab in every workbook for each column. Key outputs per item: target position, answer, errors, reaction time, movement time, path length, path efficiency, peak speed. Per trial: range of motion (horizontal, vertical, depth in position tracking). Per game: score and, for Colour Merge Test, the interference effect (incongruent minus congruent). Per session: settings, game order actually played, practice and briefing flags, adverse-event tags, questionnaire.

Quality flags are computed on the server from the raw events: `cal_override`, `not_6dof`, `practice_mode`, `incomplete`, `low_tracking`, `many_dropouts`, `low_rate`, `fast_responses`, `score_mismatch`, `duplicate_session_no`, `kin_missing`, `cal_failed`. Filter on them before any analysis.

## Validity limits

- This is not ARKit or a motion-capture system. WebXR on Android gives a visual-inertial pose estimate that drifts over time and varies by phone. The calibration check and the `Sensor_Quality` tab are there to show this; they do not remove it.
- Rotation-only data cannot give reach distance. Do not pool it with position data.
- Hand position here is the phone's position, not a joint angle. Trunk compensation is not measured.
- The WebXR path was exercised with a simulated sensor, not on a physical phone, during development. Check each study phone before the first participant.
- `Clinical_Scores` (FMA-UE, ARAT, MMT, Brunnstrom, Barthel, MMSE) is a blank template for the study team; the app does not collect those assessments.
- This is a research prototype. It is not a medical device and has no regulatory clearance.

## Data handling

Participant IDs should be study codes, not names. Free-text fields (notes, adverse events, comments) should not contain names or contact details. Staff actions (edits, renames, deletes, comments, exports) are in the audit log. Deleted sessions are removed from storage, with only their id kept so phones do not upload them again.
