import { z } from 'zod';
import { registerDevice } from '@/lib/server/devices';
import { clientIp, fail, json, rateLimit, readJson } from '@/lib/server/http';

// A study phone calls this once, the first time it has something to upload, and keeps the token it gets back.
// There is no sign-up step for the person using the phone. Staff can remove any phone from Admin > Phones.
export async function POST(req: Request) {
  const ip = clientIp(req);
  // Clinics often share one address, so the per-address limit is generous; the overall limit stops a flood.
  if (!rateLimit('register:' + ip, 20, 10 * 60_000) || !rateLimit('register:all', 400, 3600_000)) return fail(429, 'Too many new phones just now. Try again in a few minutes.');
  const parsed = await readJson(req, z.object({}).passthrough(), 1000);
  if (!parsed.ok) return parsed.res;
  const r = await registerDevice(req.headers.get('user-agent') || '', ip);
  return json({ ok: true, token: r.token, label: r.device.label, settings: r.settings });
}
