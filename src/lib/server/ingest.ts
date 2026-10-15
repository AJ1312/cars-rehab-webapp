import core from '../core';
import type { SessionInput } from '../schema';
import type { SessionSummary } from './types';

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface FlagInfo { key: string; label: string; severity: 'info' | 'warn' | 'bad'; help: string }
export const FLAG_INFO: Record<string, FlagInfo> = {
  cal_override: { key: 'cal_override', label: 'Calibration overridden', severity: 'warn', help: 'The therapist continued although a calibration check failed.' },
  not_6dof: { key: 'not_6dof', label: 'Not position-tracked', severity: 'info', help: 'Motion (3-DoF) tracking: phone rotation only. Distances are angular, not true hand reach.' },
  practice_mode: { key: 'practice_mode', label: 'Touch/sim mode', severity: 'warn', help: 'Touch or simulated input: no hand movement was measured. Exclude from movement analysis.' },
  incomplete: { key: 'incomplete', label: 'Ended early', severity: 'warn', help: 'Not every planned trial was played.' },
  low_tracking: { key: 'low_tracking', label: 'Low tracking quality', severity: 'bad', help: 'Mean healthy-tracking time was below 90 %.' },
  many_dropouts: { key: 'many_dropouts', label: 'Many tracking dropouts', severity: 'warn', help: 'Five or more tracking-loss episodes.' },
  low_rate: { key: 'low_rate', label: 'Low sample rate', severity: 'warn', help: 'Sensor rate fell below the minimum for this tracking mode in at least one trial.' },
  fast_responses: { key: 'fast_responses', label: 'Implausibly fast reactions', severity: 'warn', help: 'More than 20 % of reaction times were under 150 ms (possible anticipation or sensor jump).' },
  score_mismatch: { key: 'score_mismatch', label: 'Score mismatch', severity: 'bad', help: 'A trial score does not equal the number of correct events. Do not use this session without checking.' },
  duplicate_session_no: { key: 'duplicate_session_no', label: 'Duplicate session number', severity: 'warn', help: 'Another session for this participant has the same number.' },
  kin_missing: { key: 'kin_missing', label: 'Movement file missing', severity: 'warn', help: 'The 20 Hz movement file has not arrived yet (phone offline?).' },
  cal_failed: { key: 'cal_failed', label: 'Calibration failed', severity: 'bad', help: 'Calibration did not pass and was not overridden.' }
};

export function summarise(s: SessionInput): { summary: SessionSummary; trialRows: any[]; gameRows: any[] } {
  const trialRows = core.summarizeTrials(s);
  const gameRows = core.summarizeGames(s, trialRows);
  const games: SessionSummary['games'] = {};
  for (const g of gameRows) {
    const key = Object.keys(core.GAMES).find((k) => core.GAMES[k].name === g.game) || g.game;
    games[key] = { scoreMean: g.score_mean, accuracyPct: g.accuracy_pct, rtMeanMs: g.rt_mean_ms, pathEffMean: g.path_eff_mean, stroopInterferenceMs: g.stroop_interference_ms, trials: g.trials };
  }
  const sum = (k: string) => trialRows.reduce((a: number, r: any) => a + (r[k] || 0), 0);
  return {
    trialRows, gameRows,
    summary: {
      games, items: s.events.length,
      validPctMean: core.round(core.mean(trialRows.map((r: any) => r.valid_pct)), 1),
      dropouts: sum('dropouts'), lostMs: sum('lost_ms'), recentres: sum('recentres'), durationS: core.round(sum('duration_s'), 1) ?? 0,
      calJitterCm: s.calibration ? core.round(s.calibration.jitterCm, 2) : null,
      calRateHz: s.calibration ? core.round(s.calibration.rateHz, 1) : null
    }
  };
}

export function computeFlags(s: SessionInput, trialRows: any[], opts: { duplicate: boolean; kinMissing: boolean }): string[] {
  const f: string[] = [];
  if (s.calibration?.override) f.push('cal_override');
  else if (s.calibration && !s.calibration.pass) f.push('cal_failed');
  if (s.mode === 'motion') f.push('not_6dof');
  if (s.mode === 'touch' || s.mode === 'sim') f.push('practice_mode');
  if (!s.complete) f.push('incomplete');
  const vp = core.mean(trialRows.map((r: any) => r.valid_pct));
  if (vp != null && vp < 90 && s.mode !== 'touch' && s.mode !== 'sim') f.push('low_tracking');
  if (trialRows.reduce((a: number, r: any) => a + (r.dropouts || 0), 0) >= 5) f.push('many_dropouts');
  const minRate = core.CAL_RULES.minRateHz[s.mode] || 20;
  if (s.mode !== 'touch' && s.mode !== 'sim' && trialRows.some((r: any) => r.sample_rate_hz != null && r.sample_rate_hz < minRate)) f.push('low_rate');
  const rts = s.events.filter((e) => e.outcome === 'correct' && e.rtMs != null).map((e) => e.rtMs as number);
  if (rts.length >= 10 && rts.filter((x) => x < 150).length / rts.length > 0.2) f.push('fast_responses');
  for (const t of s.trials) {
    const correct = s.events.filter((e) => e.game === t.game && e.trial === t.trial && e.outcome === 'correct').length;
    if (correct !== t.score) { f.push('score_mismatch'); break; }
  }
  if (opts.duplicate) f.push('duplicate_session_no');
  if (opts.kinMissing) f.push('kin_missing');
  return f;
}
