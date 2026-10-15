import { z } from 'zod';
import { deviceFromRequest, isResponse } from '@/lib/server/auth';
import { unpackKin } from '@/lib/server/export';
import { fail, json } from '@/lib/server/http';
import { computeFlags, summarise } from '@/lib/server/ingest';
import { getStore } from '@/lib/server/store';

export const maxDuration = 30;
const MAX = 4_000_000;

// The 20 Hz movement recording arrives as one gzip file, validated before it is stored.
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const d = await deviceFromRequest(req);
  if (isResponse(d)) return d;
  const id = (await ctx.params).id;
  if (!z.string().uuid().safeParse(id).success) return fail(422, 'Invalid session id');
  const store = getStore();
  const s = await store.getSession(id);
  if (!s) return fail(404, 'Upload the session record first');
  if (s.deviceId && s.deviceId !== d.id) return fail(403, 'This session belongs to another phone');
  const buf = new Uint8Array(await req.arrayBuffer());
  if (buf.length === 0) return fail(400, 'Empty body');
  if (buf.length > MAX) return fail(413, 'Movement file too large');
  let rows: unknown[];
  try { rows = unpackKin(buf); } catch { return fail(422, 'Movement file is not valid gzip JSON in the expected format'); }
  await store.putKin(id, buf, rows.length);
  // Recompute flags now that the file is present.
  const { trialRows } = summarise(s.record);
  const dup = (await store.sessionNosFor(s.participantCode)).some((x) => x.sessionNo === s.sessionNo && x.id !== s.id);
  const flags = computeFlags(s.record, trialRows, { duplicate: dup, kinMissing: false });
  await store.upsertSession({ ...s, flags, kinRows: rows.length, hasKin: true });
  return json({ ok: true, rows: rows.length });
}
