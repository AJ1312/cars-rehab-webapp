import { apiStaff, isResponse } from '@/lib/server/auth';
import { XLSX_TYPE, downloadHeaders, loadFull, studyXlsx, trialLongCsv } from '@/lib/server/export';
import { getStore } from '@/lib/server/store';

export const maxDuration = 60;

export async function GET(req: Request) {
  const staff = await apiStaff(req, 'researcher');
  if (isResponse(staff)) return staff;
  const u = new URL(req.url).searchParams;
  const q = {
    since: u.get('since') || undefined, until: u.get('until') ? u.get('until') + 'T23:59:59.999Z' : undefined,
    group: u.get('group') || undefined, mode: u.get('mode') || undefined, limit: 5000
  };
  const store = getStore();
  const rows = await loadFull((await store.listSessions(q)).map((r) => r.id));
  const fmt = u.get('format') || 'xlsx';
  const stamp = new Date().toISOString().slice(0, 10);
  await store.addAudit({ actor: staff.email, action: 'export.study', detail: { fmt, sessions: rows.length, ...q } });
  if (fmt === 'trials.csv') return new Response(trialLongCsv(rows), { headers: downloadHeaders(`CARS_trials_long_${stamp}.csv`, 'text/csv; charset=utf-8') });
  return new Response((await studyXlsx(rows)) as BodyInit, { headers: downloadHeaders(`CARS_study_${stamp}.xlsx`, XLSX_TYPE) });
}
