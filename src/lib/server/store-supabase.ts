import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_SETTINGS, settingsSchema, type Settings } from '../schema';
import type { AuditEntry, Device, SessionComment, SessionFull, SessionQuery, SessionRow, Staff, Store } from './types';

/* eslint-disable @typescript-eslint/no-explicit-any */
type R = Record<string, any>;

const BUCKET = 'kinematics';

function fail(where: string, error: { message: string } | null) {
  if (error) throw new Error(where + ': ' + error.message);
}

const toStaff = (r: R): Staff => ({
  id: r.id, email: r.email, name: r.name, role: r.role, passwordHash: r.password_hash,
  totpSecret: r.totp_secret, totpEnabled: r.totp_enabled, failedAttempts: r.failed_attempts, lockedUntil: r.locked_until,
  active: r.active, createdAt: r.created_at, lastLoginAt: r.last_login_at
});
const toDevice = (r: R): Device => ({
  id: r.id, label: r.label, model: r.model, createdAt: r.created_at, registeredAt: r.enrolled_at, lastSeenAt: r.last_seen_at, revokedAt: r.revoked_at
});
const toRow = (r: R): SessionRow => ({
  id: r.id, participantCode: r.participant_code, sessionNo: r.session_no, startedAt: r.started_at, endedAt: r.ended_at,
  mode: r.mode, level: r.level, group: r.grp, therapist: r.therapist, complete: r.complete, calPass: r.cal_pass,
  calOverride: r.cal_override, deviceId: r.device_id, deviceLabel: r.device_label, flags: r.flags ?? [], summary: r.summary,
  kinRows: r.kin_rows, receivedAt: r.received_at, appVersion: r.app_version, title: r.title ?? null
});
const toComment = (r: R): SessionComment => ({ id: r.id, sessionId: r.session_id, author: r.author, body: r.body, createdAt: r.created_at });
const LIST_COLS = 'id,participant_code,session_no,started_at,ended_at,mode,level,grp,therapist,complete,cal_pass,cal_override,device_id,device_label,flags,summary,kin_rows,received_at,app_version,title';

export function createSupabaseStore(url: string, key: string): Store {
  const db: SupabaseClient = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  function applyFilters(q: any, f: SessionQuery = {}) {
    if (f.participant) q = q.eq('participant_code', f.participant);
    if (f.since) q = q.gte('started_at', f.since);
    if (f.until) q = q.lte('started_at', f.until);
    if (f.flaggedOnly) q = q.not('flags', 'eq', '{}');
    if (f.mode) q = q.eq('mode', f.mode);
    if (f.group) q = q.eq('grp', f.group);
    return q;
  }

  return {
    kind: 'supabase',
    async staffCount() { const { count, error } = await db.from('staff').select('id', { count: 'exact', head: true }); fail('staffCount', error); return count ?? 0; },
    async staffByEmail(email) { const { data, error } = await db.from('staff').select('*').eq('email', email.toLowerCase()).maybeSingle(); fail('staffByEmail', error); return data ? toStaff(data) : null; },
    async staffById(id) { const { data, error } = await db.from('staff').select('*').eq('id', id).maybeSingle(); fail('staffById', error); return data ? toStaff(data) : null; },
    async listStaff() { const { data, error } = await db.from('staff').select('*').order('created_at'); fail('listStaff', error); return (data ?? []).map(toStaff); },
    async createStaff(s) {
      const { data, error } = await db.from('staff').insert({ email: s.email.toLowerCase(), name: s.name, role: s.role, password_hash: s.passwordHash, totp_secret: s.totpSecret, totp_enabled: s.totpEnabled, active: s.active }).select('*').single();
      fail('createStaff', error); return toStaff(data);
    },
    async updateStaff(id, p) {
      const m: R = {};
      if (p.name !== undefined) m.name = p.name; if (p.role !== undefined) m.role = p.role;
      if (p.passwordHash !== undefined) m.password_hash = p.passwordHash; if (p.totpSecret !== undefined) m.totp_secret = p.totpSecret;
      if (p.totpEnabled !== undefined) m.totp_enabled = p.totpEnabled; if (p.failedAttempts !== undefined) m.failed_attempts = p.failedAttempts;
      if (p.lockedUntil !== undefined) m.locked_until = p.lockedUntil; if (p.active !== undefined) m.active = p.active;
      if (p.lastLoginAt !== undefined) m.last_login_at = p.lastLoginAt;
      const { error } = await db.from('staff').update(m).eq('id', id); fail('updateStaff', error);
    },

    async registerDevice({ label, tokenHash, model }) {
      const now = new Date().toISOString();
      const { data, error } = await db.from('devices').insert({ label, token_hash: tokenHash, model, enrolled_at: now }).select('*').single();
      fail('registerDevice', error); return toDevice(data);
    },
    async deviceByTokenHash(hash) { const { data, error } = await db.from('devices').select('*').eq('token_hash', hash).maybeSingle(); fail('deviceByToken', error); return data ? toDevice(data) : null; },
    async touchDevice(id) { await db.from('devices').update({ last_seen_at: new Date().toISOString() }).eq('id', id); },
    async listDevices() { const { data, error } = await db.from('devices').select('*').order('created_at', { ascending: false }); fail('listDevices', error); return (data ?? []).map(toDevice); },
    async revokeDevice(id) { const { error } = await db.from('devices').update({ revoked_at: new Date().toISOString() }).eq('id', id).is('revoked_at', null); fail('revokeDevice', error); },

    async upsertSession(s) {
      const { data: existing } = await db.from('sessions').select('id').eq('id', s.id).maybeSingle();
      const { error } = await db.from('sessions').upsert({
        id: s.id, participant_code: s.participantCode, session_no: s.sessionNo, started_at: s.startedAt, ended_at: s.endedAt,
        mode: s.mode, level: s.level, grp: s.group, therapist: s.therapist, complete: s.complete, cal_pass: s.calPass,
        cal_override: s.calOverride, device_id: s.deviceId, device_label: s.deviceLabel, flags: s.flags, record: s.record,
        summary: s.summary, app_version: s.appVersion, title: s.title ?? null
      }, { onConflict: 'id' });
      fail('upsertSession', error); return { created: !existing };
    },
    async updateSession(id, p) {
      const { data: cur, error: e0 } = await db.from('sessions').select('record').eq('id', id).maybeSingle(); fail('updateSession read', e0);
      if (!cur) return;
      const rec = { ...cur.record }; const m: R = {};
      if (p.participantCode !== undefined) { m.participant_code = p.participantCode; rec.participantId = p.participantCode; }
      if (p.sessionNo !== undefined) { m.session_no = p.sessionNo; rec.sessionNo = p.sessionNo; }
      if (p.group !== undefined) { m.grp = p.group; rec.group = p.group; }
      if (p.therapist !== undefined) { m.therapist = p.therapist || null; rec.therapist = p.therapist; }
      if (p.notes !== undefined) rec.notes = p.notes;
      if (p.title !== undefined) m.title = p.title;
      if (p.flags !== undefined) m.flags = p.flags;
      m.record = rec;
      const { error } = await db.from('sessions').update(m).eq('id', id); fail('updateSession', error);
    },
    async deleteSession(id) {
      const { data } = await db.from('sessions').select('kin_path').eq('id', id).maybeSingle();
      if (data?.kin_path) await db.storage.from(BUCKET).remove([data.kin_path]);
      const { error } = await db.from('sessions').delete().eq('id', id); fail('deleteSession', error);   // comments go with it (on delete cascade)
      await db.from('deleted_sessions').upsert({ id, at: new Date().toISOString() });
    },
    async wasDeleted(id) { const { data } = await db.from('deleted_sessions').select('id').eq('id', id).maybeSingle(); return !!data; },
    async listComments(sid) { const { data, error } = await db.from('session_comments').select('*').eq('session_id', sid).order('created_at'); fail('listComments', error); return (data ?? []).map(toComment); },
    async commentsFor(ids) {
      const out: SessionComment[] = [];
      for (let i = 0; i < ids.length; i += 150) {
        const { data, error } = await db.from('session_comments').select('*').in('session_id', ids.slice(i, i + 150)).order('created_at'); fail('commentsFor', error);
        out.push(...(data ?? []).map(toComment));
      }
      return out;
    },
    async commentCounts() {
      const { data, error } = await db.from('session_comments').select('session_id'); fail('commentCounts', error);
      const m: Record<string, number> = {}; for (const r of data ?? []) m[r.session_id] = (m[r.session_id] || 0) + 1; return m;
    },
    async addComment({ sessionId, author, body }) { const { data, error } = await db.from('session_comments').insert({ session_id: sessionId, author, body }).select('*').single(); fail('addComment', error); return toComment(data); },
    async getComment(id) { const { data } = await db.from('session_comments').select('*').eq('id', id).maybeSingle(); return data ? toComment(data) : null; },
    async deleteComment(id) { const { error } = await db.from('session_comments').delete().eq('id', id); fail('deleteComment', error); },
    async getSession(id) {
      const { data, error } = await db.from('sessions').select('*').eq('id', id).maybeSingle(); fail('getSession', error);
      if (!data) return null;
      return { ...toRow(data), record: data.record, hasKin: !!data.kin_path };
    },
    async listSessions(q) {
      let query = db.from('sessions').select(LIST_COLS).order('started_at', { ascending: false });
      query = applyFilters(query, q);
      const off = q?.offset ?? 0;
      if (q?.limit) query = query.range(off, off + q.limit - 1); else query = query.range(off, off + 4999);
      const { data, error } = await query; fail('listSessions', error); return (data ?? []).map(toRow);
    },
    async countSessions(q) {
      const { count, error } = await applyFilters(db.from('sessions').select('id', { count: 'exact', head: true }), q);
      fail('countSessions', error); return count ?? 0;
    },
    async sessionNosFor(p) { const { data, error } = await db.from('sessions').select('id,session_no').eq('participant_code', p); fail('sessionNosFor', error); return (data ?? []).map((r: R) => ({ id: r.id, sessionNo: r.session_no })); },
    async putKin(id, gz, rows) {
      const path = id + '.json.gz';
      const up = await db.storage.from(BUCKET).upload(path, gz, { contentType: 'application/gzip', upsert: true });
      fail('putKin', up.error);
      const { error } = await db.from('sessions').update({ kin_path: path, kin_rows: rows }).eq('id', id); fail('putKin row', error);
    },
    async getKin(id) {
      const { data, error } = await db.storage.from(BUCKET).download(id + '.json.gz');
      if (error || !data) return null;
      return new Uint8Array(await data.arrayBuffer());
    },

    async addAudit(e) { await db.from('audit').insert({ actor: e.actor, action: e.action, target: e.target ?? null, detail: e.detail ?? null, ip: e.ip ?? null }); },
    async listAudit(limit, offset = 0) {
      const { data, error } = await db.from('audit').select('*').order('id', { ascending: false }).range(offset, offset + limit - 1); fail('listAudit', error);
      return (data ?? []).map((r: R): AuditEntry => ({ id: r.id, at: r.at, actor: r.actor, action: r.action, target: r.target, detail: r.detail, ip: r.ip }));
    },

    async getSettings() {
      const { data } = await db.from('settings').select('value').eq('key', 'study').maybeSingle();
      const parsed = settingsSchema.safeParse({ ...DEFAULT_SETTINGS, ...(data?.value ?? {}) });
      return parsed.success ? parsed.data : DEFAULT_SETTINGS;
    },
    async setSettings(s: Settings) { const { error } = await db.from('settings').upsert({ key: 'study', value: s, updated_at: new Date().toISOString() }); fail('setSettings', error); }
  };
}
