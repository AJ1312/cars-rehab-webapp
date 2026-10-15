import { participantCode } from '@/lib/schema';
import { apiStaff, isResponse } from '@/lib/server/auth';
import { XLSX_TYPE, downloadHeaders, loadFull, studyXlsx } from '@/lib/server/export';
import { fail } from '@/lib/server/http';
import { getStore } from '@/lib/server/store';

export const maxDuration = 60;

export async function GET(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const staff = await apiStaff(req, 'researcher');
  if (isResponse(staff)) return staff;
  const p = participantCode.safeParse((await ctx.params).code);
  if (!p.success) return fail(422, 'Invalid participant code');
  const store = getStore();
  const rows = await loadFull((await store.listSessions({ participant: p.data, limit: 1000 })).map((r) => r.id));
  if (!rows.length) return fail(404, 'No sessions for this participant');
  await store.addAudit({ actor: staff.email, action: 'export.participant', target: p.data, detail: { sessions: rows.length } });
  return new Response((await studyXlsx(rows)) as BodyInit, { headers: downloadHeaders(`CARS_${p.data}_all_sessions.xlsx`, XLSX_TYPE) });
}
