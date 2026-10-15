import { deviceFromRequest, isResponse } from '@/lib/server/auth';
import { json } from '@/lib/server/http';
import { getStore } from '@/lib/server/store';

export async function GET(req: Request) {
  const d = await deviceFromRequest(req);
  if (isResponse(d)) return d;
  return json({ ok: true, label: d.label, settings: await getStore().getSettings() });
}
