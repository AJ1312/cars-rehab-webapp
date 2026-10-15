import { z } from 'zod';
import { apiStaff, isResponse } from '@/lib/server/auth';
import { createEnrolment } from '@/lib/server/devices';
import { clientIp, json, readJson } from '@/lib/server/http';

export async function POST(req: Request) {
  const staff = await apiStaff(req, 'admin', { write: true });
  if (isResponse(staff)) return staff;
  const body = await readJson(req, z.object({ label: z.string().trim().min(2).max(40) }), 1000);
  if (!body.ok) return body.res;
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'localhost:3000';
  const proto = req.headers.get('x-forwarded-proto') || (host.startsWith('localhost') ? 'http' : 'https');
  const r = await createEnrolment(staff, body.data.label, `${proto}://${host}`, clientIp(req));
  return json({ ok: true, id: r.device.id, code: r.code, url: r.url, expires: r.expires });
}
