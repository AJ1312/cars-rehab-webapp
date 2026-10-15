import { z } from 'zod';
import { apiStaff, isResponse } from '@/lib/server/auth';
import { clientIp, fail, json } from '@/lib/server/http';
import { removeComment } from '@/lib/server/manage';

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string; cid: string }> }) {
  const staff = await apiStaff(req, 'therapist', { write: true });
  if (isResponse(staff)) return staff;
  const { cid } = await ctx.params; if (!z.string().uuid().safeParse(cid).success) return fail(422, 'Invalid comment id');
  const r = await removeComment(staff, cid, clientIp(req));
  return r.ok ? json({ ok: true }) : fail(403, r.error);
}
