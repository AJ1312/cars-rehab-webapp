import type { SessionInput, Settings } from '../schema';

export type Role = 'admin' | 'researcher' | 'therapist';

export interface Staff {
  id: string; email: string; name: string; role: Role; passwordHash: string;
  totpSecret: string | null; totpEnabled: boolean; failedAttempts: number; lockedUntil: string | null;
  active: boolean; createdAt: string; lastLoginAt: string | null;
}

/** A study phone. It registers itself the first time it uploads; staff can remove it, which stops it for good. */
export interface Device {
  id: string; label: string; model: string | null; createdAt: string; registeredAt: string | null;
  lastSeenAt: string | null; revokedAt: string | null;
}

export interface SessionSummary {
  games: Record<string, { scoreMean: number | null; accuracyPct: number | null; rtMeanMs: number | null; pathEffMean: number | null; stroopInterferenceMs: number | null; trials: number }>;
  items: number; validPctMean: number | null; dropouts: number; lostMs: number; recentres: number; durationS: number;
  calJitterCm: number | null; calRateHz: number | null;
}

export interface SessionRow {
  id: string; participantCode: string; sessionNo: number; startedAt: string; endedAt: string | null;
  mode: string; level: number; group: string | null; therapist: string | null; complete: boolean;
  calPass: boolean | null; calOverride: boolean | null; deviceId: string | null; deviceLabel: string | null;
  flags: string[]; summary: SessionSummary; kinRows: number; receivedAt: string; appVersion: string | null;
  /** Optional name the study team gave the session in the admin board. */
  title: string | null;
}

/** A note a staff member wrote on one session. */
export interface SessionComment { id: string; sessionId: string; author: string; body: string; createdAt: string }

/** What staff may change on a stored session. The record inside is updated to match, so exports agree with the screen. */
export interface SessionPatch { participantCode?: string; sessionNo?: number; group?: string; therapist?: string; notes?: string; title?: string | null; flags?: string[] }
export interface SessionFull extends SessionRow { record: SessionInput; hasKin: boolean }

export interface AuditEntry { id: number; at: string; actor: string; action: string; target: string | null; detail: unknown; ip: string | null }

export interface SessionQuery {
  participant?: string; since?: string; until?: string; flaggedOnly?: boolean; mode?: string; group?: string;
  limit?: number; offset?: number;
}

export interface Store {
  kind: 'file' | 'supabase';
  staffCount(): Promise<number>;
  staffByEmail(email: string): Promise<Staff | null>;
  staffById(id: string): Promise<Staff | null>;
  listStaff(): Promise<Staff[]>;
  createStaff(s: Omit<Staff, 'id' | 'createdAt' | 'lastLoginAt' | 'failedAttempts' | 'lockedUntil'>): Promise<Staff>;
  updateStaff(id: string, patch: Partial<Staff>): Promise<void>;

  registerDevice(a: { label: string; tokenHash: string; model: string | null }): Promise<Device>;
  /** Also returns removed phones (revokedAt set), so a removed phone can be told apart from an unknown token. */
  deviceByTokenHash(hash: string): Promise<Device | null>;
  touchDevice(id: string): Promise<void>;
  listDevices(): Promise<Device[]>;
  revokeDevice(id: string): Promise<void>;

  upsertSession(s: SessionFull): Promise<{ created: boolean }>;
  updateSession(id: string, patch: SessionPatch): Promise<void>;
  /** Removes the session, its movement file and its comments, and remembers the id so a phone that still has it does not upload it again. */
  deleteSession(id: string): Promise<void>;
  wasDeleted(id: string): Promise<boolean>;
  listComments(sessionId: string): Promise<SessionComment[]>;
  commentCounts(): Promise<Record<string, number>>;
  commentsFor(sessionIds: string[]): Promise<SessionComment[]>;
  addComment(a: { sessionId: string; author: string; body: string }): Promise<SessionComment>;
  getComment(id: string): Promise<SessionComment | null>;
  deleteComment(id: string): Promise<void>;
  getSession(id: string): Promise<SessionFull | null>;
  listSessions(q?: SessionQuery): Promise<SessionRow[]>;
  countSessions(q?: SessionQuery): Promise<number>;
  sessionNosFor(participant: string): Promise<{ id: string; sessionNo: number }[]>;
  putKin(id: string, gz: Uint8Array, rows: number): Promise<void>;
  getKin(id: string): Promise<Uint8Array | null>;

  addAudit(e: { actor: string; action: string; target?: string | null; detail?: unknown; ip?: string | null }): Promise<void>;
  listAudit(limit: number, offset?: number): Promise<AuditEntry[]>;

  getSettings(): Promise<Settings>;
  setSettings(s: Settings): Promise<void>;
}
