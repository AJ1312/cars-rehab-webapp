import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SignJWT, jwtVerify } from 'jose';
import { getStore } from './store';
import { sha256 } from './crypto';
import { fail, sameOrigin } from './http';
import type { Device, Role, Staff } from './types';

export const COOKIE = 'cars_session';
const TTL_S = 8 * 3600;

function secret(): Uint8Array {
  const s = process.env.AUTH_SECRET || (process.env.NODE_ENV !== 'production' ? 'dev-only-secret-change-me-dev-only-secret' : '');
  if (s.length < 32) throw new Error('AUTH_SECRET must be set to a random string of at least 32 characters');
  return new TextEncoder().encode(s);
}

export async function createSessionToken(staff: Staff): Promise<string> {
  return new SignJWT({ role: staff.role }).setProtectedHeader({ alg: 'HS256' }).setSubject(staff.id)
    .setIssuedAt().setExpirationTime(TTL_S + 's').sign(secret());
}

export const cookieOptions = () => ({ httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/', maxAge: TTL_S });

async function staffFromToken(token: string | undefined): Promise<Staff | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ['HS256'] });
    if (!payload.sub) return null;
    const staff = await getStore().staffById(payload.sub);
    return staff && staff.active ? staff : null;   // re-checked on every request: disabling an account takes effect at once
  } catch { return null; }
}

export async function currentStaff(): Promise<Staff | null> {
  return staffFromToken((await cookies()).get(COOKIE)?.value);
}

const RANK: Record<Role, number> = { therapist: 1, researcher: 2, admin: 3 };
export const atLeast = (s: Staff, role: Role) => RANK[s.role] >= RANK[role];

/** Server components: redirect to the login page when signed out; 404-style redirect when the role is too low. */
export async function requireStaff(min: Role = 'therapist'): Promise<Staff> {
  const s = await currentStaff();
  if (!s) redirect('/admin/login');
  if (!atLeast(s, min)) redirect('/admin?denied=1');
  return s;
}

/** Route handlers. Returns the staff member or a ready-made error response. */
export async function apiStaff(req: Request, min: Role = 'therapist', opts: { write?: boolean } = {}): Promise<Staff | Response> {
  const cookie = req.headers.get('cookie') || '';
  const m = cookie.match(new RegExp('(?:^|; )' + COOKIE + '=([^;]+)'));
  const s = await staffFromToken(m ? decodeURIComponent(m[1]) : undefined);
  if (!s) return fail(401, 'Sign in required');
  if (!atLeast(s, min)) return fail(403, 'Not allowed for your role');
  if (opts.write && !sameOrigin(req)) return fail(403, 'Cross-site request blocked');
  return s;
}

export async function deviceFromRequest(req: Request): Promise<Device | Response> {
  const h = req.headers.get('authorization') || '';
  const m = h.match(/^Bearer (cars_[A-Za-z0-9_-]{20,})$/);
  if (!m) return fail(401, 'Device token required', { code: 'unknown' });
  const d = await getStore().deviceByTokenHash(sha256(m[1]));
  if (!d) return fail(401, 'This phone is not known to the study', { code: 'unknown' });
  if (d.revokedAt) return fail(401, 'This phone was removed from the study', { code: 'revoked' });
  void getStore().touchDevice(d.id);
  return d;
}

export const isResponse = (x: unknown): x is Response => x instanceof Response;
