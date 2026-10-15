import { deviceFromRequest, isResponse } from '@/lib/server/auth';
import { clientIp, fail, json, rateLimit, readJson } from '@/lib/server/http';
import { computeFlags, summarise } from '@/lib/server/ingest';
import { getStore } from '@/lib/server/store';
import { sessionSchema } from '@/lib/schema';

export const maxDuration = 30;

// Idempotent: the phone generates the session id, so a retry after a dropped connection never duplicates data.
export async function POST(req: Request) {
  const d = await deviceFromRequest(req);
  if (isResponse(d)) return d;
  if (!rateLimit('up:' + d.id, 60, 60_000)) return fail(429, 'Too many uploads');
  const parsed = await readJson(req, sessionSchema);
  if (!parsed.ok) return parsed.res;
  const s = parsed.data;
  if (new Date(s.endedAt) < new Date(s.startedAt)) return fail(422, 'Session ends before it starts');
  if (new Date(s.startedAt).getTime() > Date.now() + 36 * 3600_000) return fail(422, 'Session start is in the future (check the phone clock)');

  const store = getStore();
  // A session the study team deleted stays deleted: tell the phone it is done so it stops retrying.
  if (await store.wasDeleted(s.id)) return json({ ok: true, id: s.id, created: false, deleted: true, flags: [], needKin: false });
  const existing = await store.getSession(s.id);
  // Idempotent retry: the stored copy may have been renamed or commented by staff, so it is never overwritten.
  if (existing) return json({ ok: true, id: s.id, created: false, flags: existing.flags, needKin: (s.kinRows ?? 0) > 0 && !existing.hasKin });
  const { summary, trialRows } = summarise(s);
  const dup = (await store.sessionNosFor(s.participantId)).some((x) => x.sessionNo === s.sessionNo && x.id !== s.id);
  const kinMissing = (s.kinRows ?? 0) > 0;
  const flags = computeFlags(s, trialRows, { duplicate: dup, kinMissing });
  const { created } = await store.upsertSession({
    id: s.id, participantCode: s.participantId, sessionNo: s.sessionNo, startedAt: s.startedAt, endedAt: s.endedAt,
    mode: s.mode, level: s.level, group: s.group, therapist: s.therapist || null, complete: s.complete,
    calPass: s.calibration?.pass ?? null, calOverride: s.calibration?.override ?? null,
    deviceId: d.id, deviceLabel: d.label, flags, summary, kinRows: s.kinRows ?? 0, receivedAt: new Date().toISOString(),
    appVersion: s.appVersion ?? null, title: null, record: s, hasKin: false
  });
  if (created) await store.addAudit({ actor: 'device:' + d.label, action: 'session.uploaded', target: s.id, ip: clientIp(req), detail: { participant: s.participantId, sessionNo: s.sessionNo, flags } });
  return json({ ok: true, id: s.id, created, flags, needKin: kinMissing });
}
