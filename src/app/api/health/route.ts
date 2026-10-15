import { json } from '@/lib/server/http';
export const GET = () => json({ ok: true, time: new Date().toISOString() });
