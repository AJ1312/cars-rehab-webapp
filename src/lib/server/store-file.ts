import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DEFAULT_SETTINGS, type Settings } from '../schema';
import type { AuditEntry, Device, SessionFull, SessionQuery, SessionRow, Staff, Store } from './types';

/* Development / test store: one JSON file plus one file per movement recording.
   Not for production: Vercel's disk is read-only and not shared between instances. */

interface Db {
  staff: Staff[];
  devices: (Device & { tokenHash: string | null; codeHash: string | null })[];
  sessions: (SessionFull & { kinRows: number })[];
  audit: AuditEntry[];
  settings: Settings;
  auditSeq: number;
}

const EMPTY: Db = { staff: [], devices: [], sessions: [], audit: [], settings: DEFAULT_SETTINGS, auditSeq: 0 };

export function createFileStore(dir: string): Store {
  const file = path.join(dir, 'db.json');
  const kinDir = path.join(dir, 'kin');
  let chain: Promise<unknown> = Promise.resolve();

  async function load(): Promise<Db> {
    try { return { ...EMPTY, ...JSON.parse(await fs.readFile(file, 'utf8')) }; } catch { return structuredClone(EMPTY); }
  }
  async function save(db: Db) {
    await fs.mkdir(dir, { recursive: true });
    const tmp = file + '.' + process.pid + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(db));
    await fs.rename(tmp, file);
  }
  // Serialise read-modify-write cycles.
  function tx<T>(fn: (db: Db) => T | Promise<T>, write = true): Promise<T> {
    const run = async () => { const db = await load(); const out = await fn(db); if (write) await save(db); return out; };
    const p = chain.then(run, run);
    chain = p.catch(() => undefined);
    return p;
  }
  const strip = (d: Device & { tokenHash?: unknown; codeHash?: unknown }): Device => {
    const { tokenHash, codeHash, ...rest } = d as Device & { tokenHash?: unknown; codeHash?: unknown };
    void tokenHash; void codeHash;
    return rest;
  };
  const toRow = (s: SessionFull): SessionRow => { const { record, hasKin, ...row } = s; void record; void hasKin; return row; };

  function filter(db: Db, q: SessionQuery = {}) {
    let list = db.sessions.slice();
    if (q.participant) list = list.filter((s) => s.participantCode === q.participant);
    if (q.since) list = list.filter((s) => s.startedAt >= q.since!);
    if (q.until) list = list.filter((s) => s.startedAt <= q.until!);
    if (q.flaggedOnly) list = list.filter((s) => s.flags.length > 0);
    if (q.mode) list = list.filter((s) => s.mode === q.mode);
    if (q.group) list = list.filter((s) => s.group === q.group);
    return list.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  return {
    kind: 'file',
    staffCount: () => tx((db) => db.staff.length, false),
    staffByEmail: (email) => tx((db) => db.staff.find((s) => s.email === email.toLowerCase()) ?? null, false),
    staffById: (id) => tx((db) => db.staff.find((s) => s.id === id) ?? null, false),
    listStaff: () => tx((db) => db.staff, false),
    createStaff: (s) => tx((db) => {
      const row: Staff = { ...s, email: s.email.toLowerCase(), id: randomUUID(), createdAt: new Date().toISOString(), lastLoginAt: null, failedAttempts: 0, lockedUntil: null };
      db.staff.push(row); return row;
    }),
    updateStaff: (id, patch) => tx((db) => { const s = db.staff.find((x) => x.id === id); if (s) Object.assign(s, patch); }),

    createEnrolment: ({ label, codeHash, expiresAt, createdBy }) => tx((db) => {
      void createdBy;
      const d = { id: randomUUID(), label, model: null, createdAt: new Date().toISOString(), enrolledAt: null, lastSeenAt: null, revokedAt: null, pending: true, enrolExpiresAt: expiresAt, tokenHash: null, codeHash };
      db.devices.push(d); return strip(d);
    }),
    redeemEnrolment: (codeHash, tokenHash, model) => tx((db) => {
      const d = db.devices.find((x) => x.codeHash === codeHash && x.pending && !x.revokedAt);
      if (!d || !d.enrolExpiresAt || d.enrolExpiresAt < new Date().toISOString()) return null;
      d.tokenHash = tokenHash; d.codeHash = null; d.pending = false; d.enrolledAt = new Date().toISOString(); d.model = model; d.enrolExpiresAt = null;
      return strip(d);
    }),
    deviceByTokenHash: (hash) => tx((db) => { const d = db.devices.find((x) => x.tokenHash === hash && !x.revokedAt); return d ? strip(d) : null; }, false),
    touchDevice: (id) => tx((db) => { const d = db.devices.find((x) => x.id === id); if (d) d.lastSeenAt = new Date().toISOString(); }),
    listDevices: () => tx((db) => db.devices.map(strip).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), false),
    revokeDevice: (id) => tx((db) => { const d = db.devices.find((x) => x.id === id); if (d) { d.revokedAt = new Date().toISOString(); d.tokenHash = null; d.codeHash = null; d.pending = false; } }),

    upsertSession: (s) => tx((db) => {
      const i = db.sessions.findIndex((x) => x.id === s.id);
      if (i >= 0) { db.sessions[i] = { ...s, kinRows: db.sessions[i].kinRows || s.kinRows, hasKin: db.sessions[i].hasKin }; return { created: false }; }
      db.sessions.push(s); return { created: true };
    }),
    getSession: (id) => tx((db) => db.sessions.find((s) => s.id === id) ?? null, false),
    listSessions: (q) => tx((db) => {
      const list = filter(db, q);
      const off = q?.offset ?? 0;
      return list.slice(off, q?.limit ? off + q.limit : undefined).map(toRow);
    }, false),
    countSessions: (q) => tx((db) => filter(db, q).length, false),
    sessionNosFor: (p) => tx((db) => db.sessions.filter((s) => s.participantCode === p).map((s) => ({ id: s.id, sessionNo: s.sessionNo })), false),
    putKin: async (id, gz, rows) => {
      await fs.mkdir(kinDir, { recursive: true });
      await fs.writeFile(path.join(kinDir, id + '.json.gz'), gz);
      await tx((db) => { const s = db.sessions.find((x) => x.id === id); if (s) { s.kinRows = rows; s.hasKin = true; } });
    },
    getKin: async (id) => { try { return new Uint8Array(await fs.readFile(path.join(kinDir, id + '.json.gz'))); } catch { return null; } },

    addAudit: (e) => tx((db) => {
      db.audit.push({ id: ++db.auditSeq, at: new Date().toISOString(), actor: e.actor, action: e.action, target: e.target ?? null, detail: e.detail ?? null, ip: e.ip ?? null });
      if (db.audit.length > 20000) db.audit.splice(0, db.audit.length - 20000);
    }),
    listAudit: (limit, offset = 0) => tx((db) => db.audit.slice().reverse().slice(offset, offset + limit), false),

    getSettings: () => tx((db) => ({ ...DEFAULT_SETTINGS, ...db.settings }), false),
    setSettings: (s) => tx((db) => { db.settings = s; })
  };
}
