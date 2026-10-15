import { z } from 'zod';
import { cookies } from 'next/headers';
import { COOKIE, cookieOptions, createSessionToken } from '@/lib/server/auth';
import { DUMMY_HASH, hashPassword, verifyPassword, verifyTotp } from '@/lib/server/crypto';
import { clientIp, fail, json, rateLimit, readJson, sameOrigin } from '@/lib/server/http';
import { getStore } from '@/lib/server/store';

const body = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200), code: z.string().max(10).optional() });
const MAX_FAILS = 5;
const LOCK_MIN = 15;

export async function POST(req: Request) {
  if (!sameOrigin(req)) return fail(403, 'Cross-site request blocked');
  const ip = clientIp(req);
  if (!rateLimit('login:' + ip, 20, 10 * 60_000)) return fail(429, 'Too many attempts. Wait a few minutes.');
  const parsed = await readJson(req, body, 4000);
  if (!parsed.ok) return parsed.res;
  const { email, password, code } = parsed.data;
  const store = getStore();

  // First run: the bootstrap administrator from the environment becomes the first account.
  if ((await store.staffCount()) === 0) {
    const be = process.env.BOOTSTRAP_ADMIN_EMAIL?.toLowerCase();
    const bp = process.env.BOOTSTRAP_ADMIN_PASSWORD;
    if (be && bp && bp.length >= 10 && email.toLowerCase() === be && password === bp) {
      await store.createStaff({ email: be, name: 'Administrator', role: 'admin', passwordHash: await hashPassword(bp), totpSecret: null, totpEnabled: false, active: true });
      await store.addAudit({ actor: be, action: 'staff.bootstrap', ip });
    }
  }

  const staff = await store.staffByEmail(email);
  const generic = () => fail(401, 'Email or password is not correct');
  if (!staff || !staff.active) { await verifyPassword(password, DUMMY_HASH); return generic(); }
  if (staff.lockedUntil && staff.lockedUntil > new Date().toISOString()) return fail(423, 'Account locked after repeated failures. Try again later.');

  const ok = await verifyPassword(password, staff.passwordHash);
  if (!ok) {
    const fails = staff.failedAttempts + 1;
    await store.updateStaff(staff.id, { failedAttempts: fails, lockedUntil: fails >= MAX_FAILS ? new Date(Date.now() + LOCK_MIN * 60_000).toISOString() : null });
    await store.addAudit({ actor: staff.email, action: 'login.failed', ip, detail: { fails } });
    return generic();
  }
  if (staff.totpEnabled && staff.totpSecret) {
    if (!code) return json({ ok: false, needCode: true }, 401);
    if (!verifyTotp(staff.totpSecret, code)) {
      const fails = staff.failedAttempts + 1;
      await store.updateStaff(staff.id, { failedAttempts: fails, lockedUntil: fails >= MAX_FAILS ? new Date(Date.now() + LOCK_MIN * 60_000).toISOString() : null });
      await store.addAudit({ actor: staff.email, action: 'login.badcode', ip });
      return json({ ok: false, needCode: true, error: 'That code is not correct' }, 401);
    }
  }
  await store.updateStaff(staff.id, { failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date().toISOString() });
  await store.addAudit({ actor: staff.email, action: 'login', ip });
  (await cookies()).set(COOKIE, await createSessionToken(staff), cookieOptions());
  return json({ ok: true, role: staff.role });
}
