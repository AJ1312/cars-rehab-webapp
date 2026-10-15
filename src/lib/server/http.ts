import { NextResponse } from 'next/server';
import { z } from 'zod';

export const json = (data: unknown, status = 200, headers?: Record<string, string>) =>
  NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
export const fail = (status: number, message: string, extra?: Record<string, unknown>) => json({ ok: false, error: message, ...extra }, status);

export function clientIp(req: Request): string {
  return (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || req.headers.get('x-real-ip') || 'unknown';
}

// Cookie-authenticated writes must come from our own pages (CSRF defence in depth on top of SameSite=Lax).
export function sameOrigin(req: Request): boolean {
  const site = req.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') return false;
  const origin = req.headers.get('origin');
  if (!origin) return true;
  try {
    const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
    return new URL(origin).host === host;
  } catch { return false; }
}

export async function readJson<T extends z.ZodTypeAny>(req: Request, schema: T, maxBytes = 3_500_000): Promise<{ ok: true; data: z.infer<T> } | { ok: false; res: Response }> {
  const len = Number(req.headers.get('content-length') || 0);
  if (len > maxBytes) return { ok: false, res: fail(413, 'Request too large') };
  let text: string;
  try { text = await req.text(); } catch { return { ok: false, res: fail(400, 'Unreadable body') }; }
  if (text.length > maxBytes) return { ok: false, res: fail(413, 'Request too large') };
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return { ok: false, res: fail(400, 'Invalid JSON') }; }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 8).map((i) => i.path.join('.') + ': ' + i.message);
    return { ok: false, res: fail(422, 'Validation failed', { issues }) };
  }
  return { ok: true, data: parsed.data };
}

/* Best-effort sliding-window limiter. Serverless instances do not share memory, so this slows
   brute force per instance; the lock-out counters in the database are the hard limit. */
const buckets = new Map<string, number[]>();
export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const hits = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  if (hits.length >= max) { buckets.set(key, hits); return false; }
  hits.push(now); buckets.set(key, hits);
  if (buckets.size > 5000) for (const [k, v] of buckets) if (!v.length || now - v[v.length - 1] > windowMs) buckets.delete(k);
  return true;
}
