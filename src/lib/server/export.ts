import { gunzipSync, gzipSync } from 'node:zlib';
import core from '../core';
import { kinSchema } from '../schema';
import { getStore } from './store';
import type { SessionFull } from './types';

/* eslint-disable @typescript-eslint/no-explicit-any */

export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function packKin(rows: unknown[]): Uint8Array { return gzipSync(Buffer.from(JSON.stringify(rows))); }

export function unpackKin(gz: Uint8Array): unknown[] {
  const text = gunzipSync(gz, { maxOutputLength: 60_000_000 }).toString('utf8');
  return kinSchema.parse(JSON.parse(text));
}

export async function loadKin(id: string): Promise<any[][]> {
  const gz = await getStore().getKin(id);
  if (!gz) return [];
  try { return unpackKin(gz) as any[][]; } catch { return []; }
}

/** Shape the stored record the way core.js expects it. */
export function asCoreSession(s: SessionFull, kin: any[][] = []): any {
  return { ...s.record, id: s.id, kin };
}

export async function sessionXlsx(s: SessionFull): Promise<{ name: string; bytes: Uint8Array }> {
  const store = getStore();
  const [kin, history] = await Promise.all([loadKin(s.id), store.listSessions({ participant: s.participantCode })]);
  const hist: any[] = [];
  for (const h of history) {
    if (h.id === s.id) continue;
    const full = await store.getSession(h.id);
    if (full) hist.push(asCoreSession(full));
  }
  const cs = asCoreSession(s, kin);
  return { name: core.sessionFileName(cs, 'xlsx'), bytes: await core.buildXlsx(core.sessionWorkbookSpec(cs, hist)) };
}

export async function studyXlsx(rows: SessionFull[]): Promise<Uint8Array> {
  return core.buildXlsx(core.studyWorkbookSpec(rows.map((r) => asCoreSession(r))));
}

export async function loadFull(ids: string[]): Promise<SessionFull[]> {
  const store = getStore();
  const out: SessionFull[] = [];
  const CHUNK = 8;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const part = await Promise.all(ids.slice(i, i + CHUNK).map((id) => store.getSession(id)));
    for (const p of part) if (p) out.push(p);
  }
  return out;
}

/** Analysis-ready long file: one row per trial with session metadata (no joins needed in R / SPSS / pandas). */
export function trialLongCsv(rows: SessionFull[]): string {
  const sess = rows.map((r) => asCoreSession(r));
  const meta = ['participant_id', 'session_no', 'date', 'group', 'therapist', 'affected_side', 'hand_mode', 'tracking_mode', 'level', 'cal_pass', 'cal_override'];
  const trialCols = core.COLS.Trial_Summary.map((c: any) => c.key).filter((k: string) => !['participant_id', 'session_no', 'tracking_mode', 'level'].includes(k));
  const lines = [meta.concat(trialCols).join(',')];
  const esc = (v: unknown) => { if (v == null) return ''; const s = String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  for (const s of sess) {
    const sr = core.sessionRow(s);
    for (const t of core.summarizeTrials(s)) {
      lines.push(meta.map((k) => esc(k in sr ? sr[k] : (t as any)[k])).concat(trialCols.map((k: string) => esc((t as any)[k]))).join(','));
    }
  }
  return lines.join('\r\n') + '\r\n';
}

export function dictionaryCsv(): string {
  const esc = (v: unknown) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const lines = ['sheet,variable,unit,description'];
  for (const [sheet, cols] of Object.entries(core.COLS as Record<string, any[]>)) for (const c of cols) lines.push([sheet, c.key, c.unit || '', c.desc].map(esc).join(','));
  return lines.join('\r\n') + '\r\n';
}

export function downloadHeaders(name: string, type: string) {
  return { 'Content-Type': type, 'Content-Disposition': `attachment; filename="${name.replace(/[^A-Za-z0-9._-]/g, '_')}"`, 'Cache-Control': 'no-store' };
}
