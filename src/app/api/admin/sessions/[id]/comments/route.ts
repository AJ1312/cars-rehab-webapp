import { z } from 'zod';
import { apiStaff, isResponse } from '@/lib/server/auth';
import { clientIp, fail, json, readJson } from '@/lib/server/http';
import { addComment } from '@/lib/server/manage';
import { getStore } from '@/lib/server/store';

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const staff = await apiStaff(req, 'therapist');
  if (isResponse(staff)) return staff;
  const id = (await ctx.params).id; if (!z.string().uuid().safeParse(id).success) return fail(422, 'Invalid session id');
  return json({ ok: true, comments: await getStore().listComments(id) });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const staff = await apiStaff(req, 'therapist', { write: true });
  if (isResponse(staff)) return staff;
  const id = (await ctx.params).id; if (!z.string().uuid().safeParse(id).success) return fail(422, 'Invalid session id');
  const body = await readJson(req, z.object({ body: z.string() }), 5000); if (!body.ok) return body.res;
  const r = await addComment(staff, id, body.data.body, clientIp(req));
  return r.ok ? json({ ok: true }, 201) : fail(422, r.error);
}
