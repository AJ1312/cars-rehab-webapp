import { Fragment } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import core from '@/lib/core';
import { atLeast, requireStaff } from '@/lib/server/auth';
import { getStore } from '@/lib/server/store';
import { loadKin } from '@/lib/server/export';
import { FLAG_INFO, summarise } from '@/lib/server/ingest';
import { ReachMap } from '@/components/admin/charts';
import { Flags } from '@/components/admin/Bits';
import { CommentForm, EditSessionForm } from '@/components/admin/Forms';
import { deleteCommentAction } from '../../actions';
import { fmtDate, fmtDateTime, GAME_NAME, MODE_LABEL, n1 } from '@/lib/format';
import { z } from 'zod';

/* eslint-disable @typescript-eslint/no-explicit-any */
export default async function SessionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const staff = await requireStaff();
  const id = (await params).id;
  const saved = (await searchParams).saved === '1';
  if (!z.string().uuid().safeParse(id).success) notFound();
  const store = getStore();
  const s = await store.getSession(id);
  if (!s) notFound();
  const [comments, settings] = await Promise.all([store.listComments(id), store.getSettings()]);
  const r = s.record;
  const { trialRows, gameRows } = summarise(r);
  const kin = await loadKin(id);
  const linear = r.mode === '6dof' || r.mode === 'sim';
  const ring = Math.round(core.depthRange(linear ? 'linear' : 'angular', r.level, r.distance || 'medium')[1] * 100);
  const tgts = r.events.filter((e) => e.targetX != null && e.targetY != null).map((e) => ({ x: e.targetX as number, y: e.targetY as number, z: (e.targetZ ?? 0) as number }));
  const cal = r.calibration;
  const dur = Math.round((+new Date(r.endedAt) - +new Date(r.startedAt)) / 60000);
  const exportable = atLeast(staff, 'researcher');
  const canEdit = exportable, canDelete = atLeast(staff, 'admin');

  return (
    <>
      <div>
        <p className="eyebrow"><Link className="lnk" href={`/admin/participants/${r.participantId}`}>{r.participantId}</Link> · session {r.sessionNo}</p>
        <h1>{s.title || `${fmtDate(r.startedAt, r.tzOffsetMin)} · ${MODE_LABEL[r.mode]}`}</h1>
        <p className="sub">{s.title ? `${fmtDate(r.startedAt, r.tzOffsetMin)} · ${MODE_LABEL[r.mode]} · ` : ''}{r.complete ? 'Complete' : 'Ended early'} · {dur} min · phone {s.deviceLabel ?? '–'} · received {fmtDateTime(s.receivedAt)}</p>
        {saved && <p className="ok-msg" role="status">Saved. Exports now use the new details.</p>}
      </div>
      {exportable && (
        <div className="btn-row" style={{ maxWidth: 760 }}>
          <a className="btn primary" href={`/api/export/session/${id}`}>Download data sheet (Excel)</a>
          <a className="btn" href={`/api/export/session/${id}?format=events.csv`}>Events CSV</a>
          <a className="btn" href={`/api/export/session/${id}?format=kinematics.json`}>Movement (JSON)</a>
        </div>
      )}

      <div className="cols">
        <section className="panel" id="comments"><h2>Comments{comments.length ? ` (${comments.length})` : ''}</h2>
          {comments.length === 0 ? <p className="muted">No comments yet. Notes here go into the Excel sheet too.</p> : (
            <ul className="comments">{comments.map((c) => (
              <li key={c.id}><div className="c-head"><b>{c.author}</b><time dateTime={c.createdAt}>{fmtDateTime(c.createdAt)}</time>
                {(c.author === staff.email || canDelete) && <form action={deleteCommentAction}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="session" value={id} /><button className="linkbtn" aria-label="Delete this comment">Delete</button></form>}</div>
                <p>{c.body}</p></li>
            ))}</ul>
          )}
          <CommentForm id={id} />
        </section>
        {canEdit && <EditSessionForm id={id} canDelete={canDelete} groups={settings.groups} v={{ participantCode: s.participantCode, sessionNo: s.sessionNo, group: s.group ?? '', therapist: s.therapist ?? '', title: s.title ?? '', notes: r.notes ?? '' }} />}
      </div>

      {s.flags.length > 0 && (
        <section className="panel"><h2>Checks</h2>
          {s.flags.map((f) => <p key={f}><span className={'flag ' + (FLAG_INFO[f]?.severity ?? '')}>{FLAG_INFO[f]?.label ?? f}</span> {FLAG_INFO[f]?.help}</p>)}
        </section>
      )}

      <div className="stat-grid">
        {gameRows.map((g: any) => (
          <div className="game-card" key={g.game}><h3>{g.game}</h3>
            <div className="big num">{g.score_mean ?? '–'}<span className="muted small"> mean score</span></div>
            <div className="kv num"><span>Trials</span><span>{g.trials}</span><span>Best / last</span><span>{g.score_best} / {g.score_last}</span><span>Accuracy</span><span>{g.accuracy_pct == null ? '–' : g.accuracy_pct + '%'}</span><span>Reaction</span><span>{g.rt_mean_ms == null ? '–' : g.rt_mean_ms + ' ms'}</span><span>Path efficiency</span><span>{n1(g.path_eff_mean, 2)}</span>
              {g.stroop_interference_ms != null && <><span>Stroop interference</span><span>{g.stroop_interference_ms} ms</span></>}</div>
          </div>
        ))}
      </div>

      <div className="cols">
        <section className="panel"><h2>Session</h2>
          <dl className="kvl">
            <dt>Participant</dt><dd>{r.participantId}</dd><dt>Group</dt><dd>{r.group}</dd><dt>Therapist</dt><dd>{r.therapist || '–'}</dd>
            <dt>Affected side</dt><dd>{r.affectedSide}</dd><dt>Hand use</dt><dd>{r.handMode}</dd>
            <dt>Level</dt><dd>{r.level} ({linear ? core.LEVELS[r.level].cm + ' cm forward reach' : 'turn to aim'}) · {core.objectCount('triangle', r.level)} objects at a time</dd>
            <dt>Layout</dt><dd>Objects {(core.DISTANCES[r.distance || 'medium'] || core.DISTANCES.medium).label.toLowerCase()} · size {(core.OBJECT_SIZES[r.objectSize || 'medium'] || core.OBJECT_SIZES.medium).label.toLowerCase()}</dd>
            <dt>Game order</dt><dd>{(core.ORDER_MODES.find((m: { key: string }) => m.key === r.orderMode) || { label: 'Fixed (older session)' }).label}: {core.sequenceLabel(r.sequence && r.sequence.length ? r.sequence : r.games.flatMap((g) => Array(r.trialsPerGame).fill(g)), (g: string) => GAME_NAME[g as keyof typeof GAME_NAME])}</dd>
            <dt>Practice</dt><dd>{r.practice ? 'A short unrecorded practice before each game' : 'None'}</dd>
            <dt>Plan</dt><dd>{r.games.map((g) => GAME_NAME[g]).join(', ')} · {r.trialsPerGame} × {r.trialSec} s</dd>
            <dt>Hold / item limit</dt><dd>{r.dwellMs} ms / {r.itemTimeoutSec} s</dd>
            <dt>Phone</dt><dd style={{ fontSize: 13 }}>{r.device}</dd><dt>App / seed</dt><dd>{r.appVersion} / {r.seed}</dd>
            <dt>Briefed on risks</dt><dd>{r.briefed == null ? 'Not recorded' : r.briefed ? 'Yes' : 'No'}</dd>
            <dt>Adverse events</dt><dd>{[...(r.adverseTags ?? []).map((t: string) => core.adverseLabel(t)), r.adverse].filter(Boolean).join('; ') || 'None recorded'}</dd><dt>Notes</dt><dd>{r.notes || '–'}</dd>
          </dl>
        </section>
        <section className="panel"><h2>Calibration and tracking</h2>
          <dl className="kvl">
            <dt>Result</dt><dd>{cal ? (cal.pass ? 'Passed' : cal.override ? 'Failed, therapist continued' : 'Failed') : '–'}{cal?.attempts && cal.attempts > 1 ? ` (${cal.attempts} attempts)` : ''}</dd>
            <dt>Sensor rate</dt><dd>{n1(cal?.rateHz, 0)} Hz</dd><dt>Jitter</dt><dd>{n1(cal?.jitterCm, 2)} cm</dd>
            <dt>Range check</dt><dd>{(cal?.range ?? []).map((x) => `${core.dirName(x.dir)}: ${x.reached ? ((x.ms ?? 0) / 1000).toFixed(1) + ' s' : 'no'}`).join(' · ') || 'skipped'}</dd>
            <dt>Healthy tracking</dt><dd>{n1(s.summary.validPctMean, 1)}%</dd><dt>Dropouts</dt><dd>{s.summary.dropouts} ({Math.round(s.summary.lostMs / 1000)} s lost)</dd><dt>Recentres</dt><dd>{s.summary.recentres}</dd>
            <dt>Movement file</dt><dd>{s.hasKin ? `${s.kinRows} samples at 20 Hz` : 'not received'}</dd>
          </dl>
        </section>
      </div>

      <section className="panel"><h2>Where the hand went</h2><p className="sub">Hand path every 50 ms, in centimetres from the start point, with every target that appeared.{linear ? '' : ' Motion tracking: the path is where the phone was pointing, not where the hand was.'}</p><ReachMap rows={kin} targets={tgts} radiusCm={ring} linear={linear} /></section>

      <section className="panel"><h2>Trials</h2>
        <div className="table-wrap"><table>
          <thead><tr><th>Game</th><th className="r">Trial</th><th className="r">Score</th><th className="r">Accuracy %</th><th className="r">Errors</th><th className="r">Misses</th><th className="r">RT ms</th><th className="r">MT ms</th><th className="r">Path eff.</th><th className="r">ROM h × v × d cm</th><th className="r">Tracking %</th><th className="r">Dropouts</th></tr></thead>
          <tbody>{trialRows.map((t: any) => (
            <tr key={t.game + t.trial}><td>{t.game}</td><td className="r">{t.trial}</td><td className="r">{t.score}</td><td className="r">{n1(t.accuracy_pct, 0)}</td><td className="r">{t.errors}</td><td className="r">{t.misses}</td><td className="r">{t.rt_mean_ms ?? '–'}</td><td className="r">{t.mt_mean_ms ?? '–'}</td><td className="r">{n1(t.path_eff_mean, 2)}</td><td className="r">{n1(t.rom_h_cm, 0)} × {n1(t.rom_v_cm, 0)}{t.rom_d_cm != null ? ' × ' + n1(t.rom_d_cm, 0) : ''}</td><td className="r">{n1(t.valid_pct, 0)}</td><td className="r">{t.dropouts ?? '–'}</td></tr>
          ))}</tbody></table></div>
      </section>

      {r.questionnaire && (
        <section className="panel"><h2>Questionnaire</h2>
          <dl className="kvl">{core.QUESTIONS.map(([k, t]: [string, string]) => <Fragment key={k}><dt>{k}</dt><dd>{(r.questionnaire as any)[k] ?? '–'} <span className="muted">· {t}</span></dd></Fragment>)}
            <dt>Negative symptoms</dt><dd>{String((r.questionnaire as any).negative ?? '–')}</dd><dt>Suggestions</dt><dd>{String((r.questionnaire as any).suggestions ?? '–')}</dd></dl>
        </section>
      )}

      <section className="panel"><h2>Sensor events</h2>
        {(r.quality ?? []).length === 0 ? <p className="muted">None.</p> : (
          <div className="table-wrap"><table><thead><tr><th className="r">t (s)</th><th>Event</th><th>Game</th><th className="r">Trial</th><th className="r">Value</th><th>Detail</th></tr></thead>
            <tbody>{(r.quality ?? []).filter((q) => !['trial_start', 'trial_end', 'practice_start', 'practice_end'].includes(q.event)).slice(0, 150).map((q, i) => (
              <tr key={i}><td className="r">{n1(q.tMs / 1000, 1)}</td><td>{q.event}</td><td>{q.game ?? ''}</td><td className="r">{q.trial ?? ''}</td><td className="r">{q.value ?? ''}</td><td style={{ whiteSpace: 'normal', minWidth: 200 }}>{q.detail}</td></tr>
            ))}</tbody></table></div>
        )}
      </section>

      <section className="panel"><h2>Items (first 120 of {r.events.length})</h2>
        <div className="table-wrap"><table>
          <thead><tr><th>Game</th><th className="r">Trial</th><th className="r">Item</th><th>Stimulus</th><th>Zone</th><th className="r">Start→target cm</th><th>Outcome</th><th className="r">Errors</th><th className="r">RT ms</th><th className="r">MT ms</th><th className="r">Resp ms</th><th className="r">Path cm</th></tr></thead>
          <tbody>{r.events.slice(0, 120).map((e, i) => (
            <tr key={i}><td>{GAME_NAME[e.game]}</td><td className="r">{e.trial}</td><td className="r">{e.item}</td><td>{e.stimulus}</td><td>{e.zone ?? ''}</td><td className="r">{e.startToTargetCm ?? ''}</td><td>{e.outcome}</td><td className="r">{e.errorsBefore ?? ''}</td><td className="r">{e.rtMs ?? ''}</td><td className="r">{e.mtMs ?? ''}</td><td className="r">{e.respMs ?? ''}</td><td className="r">{e.pathCm ?? ''}</td></tr>
          ))}</tbody></table></div>
      </section>
    </>
  );
}
