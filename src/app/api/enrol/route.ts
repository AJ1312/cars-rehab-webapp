import { z } from 'zod';
import { normaliseCode, randomToken, sha256 } from '@/lib/server/crypto';
import { clientIp, fail, json, rateLimit, readJson } from '@/lib/server/http';
import { getStore } from '@/lib/server/store';

const body = z.object({ code: z.string().min(6).max(20), model: z.string().max(200).optional() });

// A phone redeems the one-time code from the QR link and receives a long-lived device token.
// Only the token's hash is stored, so a database leak does not expose working tokens.
export async function POST(req: Request) {
  const ip = clientIp(req);
  if (!rateLimit('enrol:' + ip, 10, 10 * 60_000)) return fail(429, 'Too many attempts. Wait a few minutes.');
  const parsed = await readJson(req, body, 2000);
  if (!parsed.ok) return parsed.res;
  const store = getStore();
  const token = randomToken('cars_');
  const device = await store.redeemEnrolment(sha256(normaliseCode(parsed.data.code)), sha256(token), parsed.data.model ?? null);
  if (!device) return fail(404, 'This code is not valid, has expired, or was already used. Ask for a new QR code.');
  await store.addAudit({ actor: 'device:' + device.label, action: 'device.enrolled', target: device.id, ip });
  return json({ ok: true, token, label: device.label, settings: await store.getSettings() });
}
