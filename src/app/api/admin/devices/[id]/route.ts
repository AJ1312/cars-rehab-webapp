import { z } from 'zod';
import { apiStaff, isResponse } from '@/lib/server/auth';
import { revokeDevice } from '@/lib/server/devices';
import { clientIp, fail, json } from '@/lib/server/http';

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const staff = await apiStaff(req, 'admin', { write: true });
  if (isResponse(staff)) return staff;
  const id = z.string().uuid().safeParse((await ctx.params).id);
  if (!id.success) return fail(422, 'Invalid id');
  await revokeDevice(staff, id.data, clientIp(req));
  return json({ ok: true });
}
