import { deviceFromRequest, isResponse } from '@/lib/server/auth';
import { fail, json } from '@/lib/server/http';
import { getStore } from '@/lib/server/store';
import { participantCode } from '@/lib/schema';

export async function GET(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const d = await deviceFromRequest(req);
  if (isResponse(d)) return d;
  const p = participantCode.safeParse((await ctx.params).code);
  if (!p.success) return fail(422, 'Invalid participant code');
  const nos = await getStore().sessionNosFor(p.data);
  return json({ ok: true, next: nos.reduce((m, s) => Math.max(m, s.sessionNo), 0) + 1, count: nos.length });
}
