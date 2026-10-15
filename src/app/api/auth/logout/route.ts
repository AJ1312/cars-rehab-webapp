import { cookies } from 'next/headers';
import { COOKIE } from '@/lib/server/auth';
import { json } from '@/lib/server/http';

export async function POST() {
  (await cookies()).set(COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
  return json({ ok: true });
}
