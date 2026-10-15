import type { SessionInput, Settings } from '../schema';

export type Role = 'admin' | 'researcher' | 'therapist';

export interface Staff {
  id: string; email: string; name: string; role: Role; passwordHash: string;
  totpSecret: string | null; totpEnabled: boolean; failedAttempts: number; lockedUntil: string | null;
  active: boolean; createdAt: string; lastLoginAt: string | null;
}

export interface Device {
  id: string; label: string; model: string | null; createdAt: string; enrolledAt: string | null;
  lastSeenAt: string | null; revokedAt: string | null; pending: boolean; enrolExpiresAt: string | null;
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
}
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

  createEnrolment(a: { label: string; codeHash: string; expiresAt: string; createdBy: string | null }): Promise<Device>;
  redeemEnrolment(codeHash: string, tokenHash: string, model: string | null): Promise<Device | null>;
  deviceByTokenHash(hash: string): Promise<Device | null>;
  touchDevice(id: string): Promise<void>;
  listDevices(): Promise<Device[]>;
  revokeDevice(id: string): Promise<void>;

  upsertSession(s: SessionFull): Promise<{ created: boolean }>;
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
