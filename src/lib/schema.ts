import { z } from 'zod';

const n = z.number().finite();
const nn = n.nullable().optional();
const short = (max: number) => z.string().max(max);

export const MODES = ['6dof', 'motion', 'touch', 'sim'] as const;
export const GAME_KEYS = ['triangle', 'maths', 'colour'] as const;
export const GROUPS = ['Intervention', 'Control', 'Pilot', 'Other'] as const;
export const SIDES = ['Left', 'Right', 'Both', 'Not applicable'] as const;
export const HAND_MODES = ['Affected hand alone', 'Assisted by unaffected hand'] as const;

export const participantCode = z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{2,20}$/, 'Use 2-20 letters, numbers, - or _');

const trialSchema = z.object({
  game: z.enum(GAME_KEYS),
  trial: z.number().int().min(1).max(100),
  level: z.number().int().min(1).max(3),
  activeMs: n.min(0).max(1_000_000),
  pauseMs: n.min(0).max(10_000_000).optional(),
  score: z.number().int().min(0).max(1000),
  rom: z.object({ h: n, v: n, d: n.optional() }).nullable().optional(),
  quality: z.object({
    validPct: n.min(0).max(100), rateHz: n.min(0).max(1000), dropouts: z.number().int().min(0),
    lostMs: n.min(0), recentres: z.number().int().min(0)
  }).nullable().optional()
});

const eventSchema = z.object({
  game: z.enum(GAME_KEYS),
  trial: z.number().int().min(1).max(100),
  item: z.number().int().min(1).max(1000),
  onsetMs: n.min(0),
  stimulus: short(60),
  options: short(300),
  zone: short(24).nullable().optional(),
  targetX: nn, targetY: nn, targetZ: nn, targetAz: nn, targetEl: nn, targetReachCm: nn, startToTargetCm: nn,
  correctAnswer: short(20).nullable().optional(),
  firstResponse: short(20).nullable().optional(),
  outcome: z.enum(['correct', 'timeout', 'trial_end']),
  firstTry: z.number().int().min(0).max(1).nullable().optional(),
  errorsBefore: z.number().int().min(0).max(20).nullable().optional(),
  rtMs: nn, mtMs: nn, respMs: nn, pathCm: nn, straightCm: nn, pathEff: nn, peakSpeedCms: nn,
  condition: short(30).nullable().optional()
});

const qualitySchema = z.object({
  tMs: n.min(0),
  game: short(30).nullable().optional(),
  trial: z.number().int().nullable().optional(),
  event: short(30),
  value: nn,
  detail: short(300).nullable().optional()
});

export const sessionSchema = z.object({
  id: z.string().uuid(),
  participantId: participantCode,
  sessionNo: z.number().int().min(1).max(999),
  group: z.string().trim().min(1).max(20),
  therapist: short(10),
  affectedSide: z.enum(SIDES),
  handMode: z.enum(HAND_MODES),
  mode: z.enum(MODES),
  level: z.number().int().min(1).max(3),
  games: z.array(z.enum(GAME_KEYS)).min(1).max(3),
  trialsPerGame: z.number().int().min(1).max(20),
  trialSec: z.number().int().min(10).max(300),
  dwellMs: z.number().int().min(100).max(1500),
  itemTimeoutSec: z.number().int().min(3).max(60),
  camera: short(20).optional(),
  homeGate: z.boolean().optional(),
  device: short(300).optional(),
  seed: z.number().int(),
  appVersion: short(20).optional(),
  tzOffsetMin: z.number().int().min(-840).max(840).optional(),
  startedAt: z.string().datetime({ offset: true }),
  endedAt: z.string().datetime({ offset: true }),
  complete: z.boolean(),
  adverse: short(1000).optional(),
  notes: short(2000).optional(),
  calibration: z.object({
    rateHz: n.min(0), jitterCm: n.min(0), pass: z.boolean(), override: z.boolean().optional(),
    attempts: z.number().int().min(1).max(50).optional(),
    range: z.array(z.object({ dir: n, reached: z.boolean(), ms: nn })).max(8).optional()
  }).nullable().optional(),
  trials: z.array(trialSchema).max(300),
  events: z.array(eventSchema).max(6000),
  quality: z.array(qualitySchema).max(6000).optional(),
  questionnaire: z.record(z.string().max(24), z.union([z.string().max(1000), z.number().int().min(1).max(5)])).nullable().optional(),
  kinRows: z.number().int().min(0).max(200_000).optional()
});

export type SessionInput = z.infer<typeof sessionSchema>;

export const kinRowSchema = z.tuple([
  n, short(30), z.number().nullable(), short(10),
  n, n, n, nn, nn, nn, n, n, n, n, z.number().int().min(0).max(1)
]);
export const kinSchema = z.array(kinRowSchema).max(200_000);

export const settingsSchema = z.object({
  trialsPerGame: z.number().int().min(1).max(20),
  trialSec: z.number().int().min(10).max(300),
  dwellMs: z.number().int().min(100).max(1500),
  itemTimeoutSec: z.number().int().min(3).max(60),
  level: z.number().int().min(1).max(3),
  groups: z.array(short(20)).min(1).max(8)
});
export type Settings = z.infer<typeof settingsSchema>;
export const DEFAULT_SETTINGS: Settings = { trialsPerGame: 5, trialSec: 60, dwellMs: 250, itemTimeoutSec: 12, level: 2, groups: ['Intervention', 'Control'] };
