import { z } from 'zod';
import { apiStaff, isResponse } from '@/lib/server/auth';
import { clientIp, fail, json, readJson } from '@/lib/server/http';
import { editSession, removeSession } from '@/lib/server/manage';
import { getStore } from '@/lib/server/store';

const idOk = (id: string) => z.string().uuid().safeParse(id).success;

// Correct a session's details (participant code, number, group, therapist, title, notes). Researchers and admins.
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const staff = await apiStaff(req, 'researcher', { write: true });
  if (isResponse(staff)) return staff;
  const id = (await ctx.params).id; if (!idOk(id)) return fail(422, 'Invalid session id');
  const s = await getStore().getSession(id); if (!s) return fail(404, 'Session not found');
  const body = await readJson(req, z.record(z.string(), z.unknown()), 10_000); if (!body.ok) return body.res;
  const cur = { participantCode: s.participantCode, sessionNo: s.sessionNo, group: s.group ?? '', therapist: s.therapist ?? '', title: s.title ?? '', notes: s.record.notes ?? '' };
  const r = await editSession(staff, id, { ...cur, ...body.data }, clientIp(req));
  return r.ok ? json({ ok: true, message: r.message }) : fail(422, r.error);
}

// Delete a session for good (admins only).
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const staff = await apiStaff(req, 'admin', { write: true });
  if (isResponse(staff)) return staff;
  const id = (await ctx.params).id; if (!idOk(id)) return fail(422, 'Invalid session id');
  const r = await removeSession(staff, id, clientIp(req));
  return r.ok ? json({ ok: true }) : fail(404, r.error);
}
