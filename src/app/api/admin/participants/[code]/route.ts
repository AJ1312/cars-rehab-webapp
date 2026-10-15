import { z } from 'zod';
import { participantCode } from '@/lib/schema';
import { apiStaff, isResponse } from '@/lib/server/auth';
import { clientIp, fail, json, readJson } from '@/lib/server/http';
import { removeParticipant, renameParticipant } from '@/lib/server/manage';

// Rename a participant ID across all their sessions (researchers and admins).
export async function PATCH(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const staff = await apiStaff(req, 'researcher', { write: true });
  if (isResponse(staff)) return staff;
  const from = participantCode.safeParse((await ctx.params).code); if (!from.success) return fail(422, 'Invalid participant code');
  const body = await readJson(req, z.object({ to: z.string() }), 1000); if (!body.ok) return body.res;
  const r = await renameParticipant(staff, from.data, body.data.to, clientIp(req));
  return r.ok ? json({ ok: true, goto: r.goto }) : fail(422, r.error);
}

// Delete every session of a participant for good (admins only).
export async function DELETE(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const staff = await apiStaff(req, 'admin', { write: true });
  if (isResponse(staff)) return staff;
  const c = participantCode.safeParse((await ctx.params).code); if (!c.success) return fail(422, 'Invalid participant code');
  const r = await removeParticipant(staff, c.data, clientIp(req));
  return r.ok ? json({ ok: true }) : fail(404, r.error);
}
