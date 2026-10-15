import { deviceFromRequest, isResponse } from '@/lib/server/auth';
import { clientIp, fail, json, rateLimit } from '@/lib/server/http';
import { getStore } from '@/lib/server/store';

// The study defaults (trials per game, time per trial, level) are not secret, so any phone can read them without registering.
// A phone that sends its token is also told if it was removed from the study.
export async function GET(req: Request) {
  if (!rateLimit('config:' + clientIp(req), 120, 60_000)) return fail(429, 'Too many requests');
  let label: string | null = null;
  if (req.headers.get('authorization')) {
    const d = await deviceFromRequest(req);
    if (isResponse(d)) { const j = await d.clone().json().catch(() => ({})); if (j.code === 'revoked') return d; }
    else label = d.label;
  }
  return json({ ok: true, label, settings: await getStore().getSettings() });
}
