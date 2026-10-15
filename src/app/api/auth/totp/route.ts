import { z } from 'zod';
import QRCode from 'qrcode';
import { apiStaff, isResponse } from '@/lib/server/auth';
import { newTotpSecret, totpUri, verifyTotp } from '@/lib/server/crypto';
import { clientIp, fail, json, readJson } from '@/lib/server/http';
import { getStore } from '@/lib/server/store';

const body = z.object({ action: z.enum(['start', 'confirm', 'disable']), code: z.string().max(10).optional() });

export async function POST(req: Request) {
  const staff = await apiStaff(req, 'therapist', { write: true });
  if (isResponse(staff)) return staff;
  const parsed = await readJson(req, body, 1000);
  if (!parsed.ok) return parsed.res;
  const { action, code } = parsed.data;
  const store = getStore();
  const ip = clientIp(req);
  if (action === 'start') {
    const secret = newTotpSecret();
    await store.updateStaff(staff.id, { totpSecret: secret, totpEnabled: false });
    const uri = totpUri(secret, staff.email);
    return json({ ok: true, secret, uri, qr: await QRCode.toDataURL(uri, { margin: 1, width: 220 }) });
  }
  if (action === 'confirm') {
    if (!staff.totpSecret || !code || !verifyTotp(staff.totpSecret, code)) return fail(422, 'That code is not correct');
    await store.updateStaff(staff.id, { totpEnabled: true });
    await store.addAudit({ actor: staff.email, action: 'totp.enabled', ip });
    return json({ ok: true });
  }
  if (!staff.totpSecret || !code || !verifyTotp(staff.totpSecret, code)) return fail(422, 'Enter a current code to turn this off');
  await store.updateStaff(staff.id, { totpEnabled: false, totpSecret: null });
  await store.addAudit({ actor: staff.email, action: 'totp.disabled', ip });
  return json({ ok: true });
}
