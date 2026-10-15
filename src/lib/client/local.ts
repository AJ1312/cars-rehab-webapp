/* On-phone storage: the phone's upload token, study defaults, and an offline queue of finished sessions (IndexedDB). */
import type { SessionInput, Settings } from '../schema';
import { DEFAULT_SETTINGS } from '../schema';

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface DeviceInfo { token: string; label: string }
export interface StoredSession {
  id: string; record: SessionInput; kin: any[][]; savedAt: string;
  state: 'pending' | 'uploaded' | 'rejected'; kinUploaded: boolean; attempts: number; lastError: string | null; uploadedAt: string | null;
}

const LS_DEVICE = 'cars.device', LS_SETTINGS = 'cars.settings', LS_RECENT = 'cars.recent', LS_PREFS = 'cars.prefs';
const lsGet = <T,>(k: string): T | null => { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : null; } catch { return null; } };
const lsSet = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ } };

export const getDevice = () => lsGet<DeviceInfo>(LS_DEVICE);
export const setDevice = (d: DeviceInfo | null) => { if (d) lsSet(LS_DEVICE, d); else try { localStorage.removeItem(LS_DEVICE); } catch { /* ignore */ } };
export const getSettings = (): Settings => ({ ...DEFAULT_SETTINGS, ...(lsGet<Settings>(LS_SETTINGS) || {}) });
export const setSettings = (s: Settings) => lsSet(LS_SETTINGS, s);
export const getRecent = (): string[] => lsGet<string[]>(LS_RECENT) || [];
export const pushRecent = (code: string) => lsSet(LS_RECENT, [code, ...getRecent().filter((c) => c !== code)].slice(0, 12));
export const getPrefs = <T,>() => lsGet<T>(LS_PREFS);
export const setPrefs = (p: unknown) => lsSet(LS_PREFS, p);

/* ---------------- IndexedDB ---------------- */
let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open('cars', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('sessions', { keyPath: 'id' }); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((res, rej) => { const r = fn(d.transaction('sessions', mode).objectStore('sessions')); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
export const saveSession = (s: StoredSession) => tx('readwrite', (st) => st.put(s));
export const allSessions = async (): Promise<StoredSession[]> => ((await tx('readonly', (st) => st.getAll())) as StoredSession[]).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
export const getSession = (id: string) => tx('readonly', (st) => st.get(id)) as Promise<StoredSession | undefined>;
export const deleteSession = (id: string) => tx('readwrite', (st) => st.delete(id));

export async function nextSessionNoLocal(code: string): Promise<number> {
  const all = await allSessions();
  return all.filter((s) => s.record.participantId === code).reduce((m, s) => Math.max(m, s.record.sessionNo), 0) + 1;
}

/* ---------------- talking to the server ---------------- */
async function gzip(text: string): Promise<Blob> {
  if (typeof CompressionStream !== 'undefined') {
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Response(stream).blob();
  }
  // Older iPhones (before iOS 16.4) have no CompressionStream: write a valid gzip file with uncompressed ("stored") blocks.
  const core = (await import('../core')).default;
  const data = new TextEncoder().encode(text);
  const parts: Uint8Array[] = [new Uint8Array([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 0xff])];
  for (let i = 0; i < data.length || i === 0; i += 65535) {
    const chunk = data.subarray(i, Math.min(data.length, i + 65535));
    const last = i + 65535 >= data.length;
    const h = new Uint8Array(5); h[0] = last ? 1 : 0; h[1] = chunk.length & 255; h[2] = chunk.length >> 8; h[3] = ~chunk.length & 255; h[4] = (~chunk.length >> 8) & 255;
    parts.push(h, chunk);
    if (last) break;
  }
  const tail = new DataView(new ArrayBuffer(8)); tail.setUint32(0, core.crc32(data) >>> 0, true); tail.setUint32(4, data.length >>> 0, true);
  parts.push(new Uint8Array(tail.buffer));
  return new Blob(parts as BlobPart[], { type: 'application/gzip' });
}

async function api(path: string, init: RequestInit & { token?: string } = {}) {
  const { token, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (token) headers.set('Authorization', 'Bearer ' + token);
  const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 30000);
  try { return await fetch(path, { ...rest, headers, signal: ctl.signal, cache: 'no-store' }); } finally { clearTimeout(to); }
}

/** The phone registers itself with the study the first time it is online with something to send: no code, no scan. */
async function registerDevice(): Promise<DeviceInfo | null> {
  try {
    const r = await api('/api/device', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (!r.ok) return null;
    const j = await r.json();
    const device = { token: j.token as string, label: j.label as string };
    setDevice(device); if (j.settings) setSettings(j.settings);
    return device;
  } catch { return null; }
}
let registering: Promise<DeviceInfo | null> | null = null;
async function ensureDevice(): Promise<DeviceInfo | null> {
  const d = getDevice(); if (d) return d;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return null;
  if (!registering) registering = registerDevice().finally(() => { registering = null; });
  return registering;
}

/** A call the study needs to know the phone for. 'revoked' means staff removed this phone; null means no connection or no way to register right now. */
async function authed(path: string, init: RequestInit = {}): Promise<Response | 'revoked' | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const d = await ensureDevice(); if (!d) return null;
    const r = await api(path, { ...init, token: d.token });
    if (r.status !== 401) return r;
    const j = await r.clone().json().catch(() => ({}));
    if (j.code === 'revoked') return 'revoked';
    setDevice(null);   // the study does not know this token (for example its database was reset): register again once
  }
  return null;
}

export async function refreshConfig(): Promise<'ok' | 'revoked' | 'offline'> {
  try {
    const d = getDevice();
    const r = await api('/api/config', { token: d?.token });
    if (r.status === 401) { const j = await r.json().catch(() => ({})); return j.code === 'revoked' ? 'revoked' : 'ok'; }
    if (!r.ok) return 'offline';
    const j = await r.json(); if (j.settings) setSettings(j.settings);
    return 'ok';
  } catch { return 'offline'; }
}

export async function nextSessionNo(code: string): Promise<number> {
  const local = await nextSessionNoLocal(code);
  if (!getDevice()) return local;   // a phone that has not uploaded yet counts its own sessions
  try {
    const r = await authed('/api/participants/' + encodeURIComponent(code) + '/next');
    if (r && r !== 'revoked' && r.ok) { const j = await r.json(); return Math.max(local, j.next); }
  } catch { /* offline: local number */ }
  return local;
}

let syncing = false;
export type SyncResult = { sent: number; failed: number; pending: number; revoked: boolean };
/** Upload everything not yet on the server. Safe to call repeatedly: uploads are idempotent on the session id. */
export async function syncAll(): Promise<SyncResult> {
  const out: SyncResult = { sent: 0, failed: 0, pending: 0, revoked: false };
  const waiting = async () => (await allSessions()).filter((s) => s.state === 'pending');
  if (syncing || (typeof navigator !== 'undefined' && navigator.onLine === false)) { out.pending = (await waiting()).length; return out; }
  syncing = true;
  try {
    for (const s of (await waiting()).reverse()) {
      try {
        const r = await authed('/api/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...s.record, kinRows: s.kin.length }) });
        if (r === 'revoked') { out.revoked = true; break; }
        if (!r) throw new Error('No connection');
        if (r.status === 422 || r.status === 413) { const j = await r.json().catch(() => ({})); await saveSession({ ...s, state: 'rejected', lastError: (j.error || 'Rejected') + (j.issues ? ': ' + j.issues.join('; ') : ''), attempts: s.attempts + 1 }); out.failed++; continue; }
        if (!r.ok) throw new Error('HTTP ' + r.status);
        let kinOk = s.kinUploaded;
        if (!kinOk && s.kin.length) {
          const k = await authed('/api/sessions/' + s.id + '/kin', { method: 'PUT', headers: { 'Content-Type': 'application/gzip' }, body: await gzip(JSON.stringify(s.kin)) });
          if (k === 'revoked') { out.revoked = true; break; }
          if (!k) throw new Error('No connection');
          if (!k.ok && k.status !== 413 && k.status !== 422) throw new Error('Movement file HTTP ' + k.status);
          kinOk = k.ok;
        } else kinOk = true;
        await saveSession({ ...s, state: kinOk ? 'uploaded' : 'pending', kinUploaded: kinOk, uploadedAt: new Date().toISOString(), lastError: null, attempts: s.attempts + 1 });
        out.sent++;
      } catch (e: any) {
        await saveSession({ ...s, attempts: s.attempts + 1, lastError: e?.message || 'Upload failed' });
        out.failed++;
      }
    }
  } finally { syncing = false; }
  out.pending = (await waiting()).length;
  return out;
}

/* ---------------- data sheet on the phone ---------------- */
export async function buildSessionXlsx(s: StoredSession, history: StoredSession[]): Promise<{ name: string; blob: Blob }> {
  const core = (await import('../core')).default;
  const cs = { ...s.record, kin: s.kin };
  const hist = history.filter((h) => h.id !== s.id && h.record.participantId === s.record.participantId).map((h) => ({ ...h.record }));
  const bytes: Uint8Array = await core.buildXlsx(core.sessionWorkbookSpec(cs, hist));
  return { name: core.sessionFileName(cs, 'xlsx'), blob: new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }) };
}
export async function buildEventsCsv(s: StoredSession): Promise<{ name: string; blob: Blob }> {
  const core = (await import('../core')).default;
  const cs = { ...s.record };
  return { name: core.sessionFileName(cs, 'csv').replace('.csv', '_events.csv'), blob: new Blob([core.eventsCsv(cs)], { type: 'text/csv;charset=utf-8' }) };
}
/** Save a file. On iPhone the share sheet ("Save to Files") is the reliable route, including inside a home-screen app. */
export async function saveBlob(name: string, blob: Blob, opts: { preferShare?: boolean } = {}): Promise<'shared' | 'downloaded'> {
  if (opts.preferShare && (await shareBlob(name, blob))) return 'shared';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 120_000);
  return 'downloaded';
}
export async function shareBlob(name: string, blob: Blob): Promise<boolean> {
  try {
    const file = new File([blob], name, { type: blob.type });
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (!nav.canShare?.({ files: [file] })) return false;
    await navigator.share({ files: [file], title: name });
    return true;
  } catch (e) { return (e as Error)?.name === 'AbortError'; }
}
/** Ask the browser not to clear this site's data when storage is low (sessions waiting to upload live here). */
export async function keepStorage() { try { await navigator.storage?.persist?.(); } catch { /* not supported */ } }
