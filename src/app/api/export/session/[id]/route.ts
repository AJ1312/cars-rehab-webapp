import core from '@/lib/core';
import { apiStaff, isResponse } from '@/lib/server/auth';
import { XLSX_TYPE, asCoreSession, downloadHeaders, loadKin, sessionXlsx } from '@/lib/server/export';
import { fail } from '@/lib/server/http';
import { getStore } from '@/lib/server/store';

export const maxDuration = 60;

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const staff = await apiStaff(req, 'researcher');
  if (isResponse(staff)) return staff;
  const id = (await ctx.params).id;
  const s = await getStore().getSession(id);
  if (!s) return fail(404, 'Session not found');
  const fmt = new URL(req.url).searchParams.get('format') || 'xlsx';
  await getStore().addAudit({ actor: staff.email, action: 'export.session', target: id, detail: { fmt } });
  if (fmt === 'events.csv') {
    const cs = asCoreSession(s);
    return new Response(core.eventsCsv(cs), { headers: downloadHeaders(core.sessionFileName(cs, 'events.csv').replace('.events.csv', '_events.csv'), 'text/csv; charset=utf-8') });
  }
  if (fmt === 'kinematics.json') {
    return new Response(JSON.stringify(await loadKin(id)), { headers: downloadHeaders(`kinematics_${id}.json`, 'application/json') });
  }
  const { name, bytes } = await sessionXlsx(s);
  return new Response(bytes as BodyInit, { headers: downloadHeaders(name, XLSX_TYPE) });
}
