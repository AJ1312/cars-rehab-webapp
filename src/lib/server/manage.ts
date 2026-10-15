import { z } from 'zod';
import { participantCode } from '../schema';
import { computeFlags, summarise } from './ingest';
import { getStore } from './store';
import type { Staff } from './types';

/* What the study team may do to stored sessions: rename, correct details, delete, comment.
   Every change is written to the audit log with what it was before, and the original upload is never needed again. */

export type Result = { ok: true; message?: string; goto?: string } | { ok: false; error: string };

const editSchema = z.object({
  participantCode,
  sessionNo: z.coerce.number().int().min(1, 'Session number is 1 or more').max(999),
  group: z.string().trim().min(1, 'Group cannot be empty').max(20),
  therapist: z.string().trim().max(10, 'Therapist initials: up to 10 characters'),
  title: z.string().trim().max(60, 'Title: up to 60 characters'),
  notes: z.string().trim().max(2000)
});

async function recomputeFlags(id: string) {
  const store = getStore();
  const s = await store.getSession(id); if (!s) return;
  const { trialRows } = summarise(s.record);
  const dup = (await store.sessionNosFor(s.participantCode)).some((x) => x.sessionNo === s.sessionNo && x.id !== s.id);
  const kinMissing = (s.record.kinRows ?? s.kinRows ?? 0) > 0 && !s.hasKin;
  await store.updateSession(id, { flags: computeFlags(s.record, trialRows, { duplicate: dup, kinMissing }) });
}

export async function editSession(staff: Staff, id: string, input: unknown, ip: string | null): Promise<Result> {
  const p = editSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const store = getStore();
  const s = await store.getSession(id);
  if (!s) return { ok: false, error: 'This session no longer exists' };
  const d = p.data;
  if ((await store.sessionNosFor(d.participantCode)).some((x) => x.sessionNo === d.sessionNo && x.id !== id)) {
    return { ok: false, error: `${d.participantCode} already has a session ${d.sessionNo}. Pick another number, or change that one first.` };
  }
  const before = { participant: s.participantCode, sessionNo: s.sessionNo, group: s.group, therapist: s.therapist ?? '', title: s.title ?? '', notes: s.record.notes ?? '' };
  const after = { participant: d.participantCode, sessionNo: d.sessionNo, group: d.group, therapist: d.therapist, title: d.title, notes: d.notes };
  const changed = Object.keys(after).filter((k) => (before as Record<string, unknown>)[k] !== (after as Record<string, unknown>)[k]);
  if (!changed.length) return { ok: true, message: 'Nothing to change.' };
  await store.updateSession(id, { participantCode: d.participantCode, sessionNo: d.sessionNo, group: d.group, therapist: d.therapist, notes: d.notes, title: d.title || null });
  await recomputeFlags(id);
  await store.addAudit({ actor: staff.email, action: 'session.edited', target: id, ip, detail: { changed, before: Object.fromEntries(changed.map((k) => [k, (before as Record<string, unknown>)[k]])), after: Object.fromEntries(changed.map((k) => [k, (after as Record<string, unknown>)[k]])) } });
  return { ok: true, message: 'Saved. Exports now use the new details.' };
}

export async function removeSession(staff: Staff, id: string, ip: string | null): Promise<Result> {
  const store = getStore();
  const s = await store.getSession(id);
  if (!s) return { ok: false, error: 'This session no longer exists' };
  await store.deleteSession(id);
  await store.addAudit({ actor: staff.email, action: 'session.deleted', target: id, ip, detail: { participant: s.participantCode, sessionNo: s.sessionNo, startedAt: s.startedAt } });
  await Promise.all((await store.sessionNosFor(s.participantCode)).map((x) => recomputeFlags(x.id)));   // a duplicate-number warning may now be gone
  return { ok: true, goto: '/admin/sessions' };
}

export async function renameParticipant(staff: Staff, from: string, toRaw: string, ip: string | null): Promise<Result> {
  const to = participantCode.safeParse(toRaw);
  if (!to.success) return { ok: false, error: to.error.issues[0].message };
  if (to.data === from) return { ok: true, message: 'Nothing to change.' };
  const store = getStore();
  const mine = await store.sessionNosFor(from);
  if (!mine.length) return { ok: false, error: `${from} has no sessions` };
  const theirs = new Set((await store.sessionNosFor(to.data)).map((x) => x.sessionNo));
  const clash = mine.filter((x) => theirs.has(x.sessionNo)).map((x) => x.sessionNo);
  if (clash.length) return { ok: false, error: `${to.data} already has session ${clash.join(', ')}. Renaming would merge two sessions with the same number.` };
  for (const x of mine) await store.updateSession(x.id, { participantCode: to.data });
  await Promise.all(mine.map((x) => recomputeFlags(x.id)));
  await store.addAudit({ actor: staff.email, action: 'participant.renamed', target: from, ip, detail: { to: to.data, sessions: mine.length } });
  return { ok: true, goto: `/admin/participants/${to.data}` };
}

export async function removeParticipant(staff: Staff, code: string, ip: string | null): Promise<Result> {
  const store = getStore();
  const mine = await store.sessionNosFor(code);
  if (!mine.length) return { ok: false, error: `${code} has no sessions` };
  for (const x of mine) await store.deleteSession(x.id);
  await store.addAudit({ actor: staff.email, action: 'participant.deleted', target: code, ip, detail: { sessions: mine.length } });
  return { ok: true, goto: '/admin/participants' };
}

export async function addComment(staff: Staff, sessionId: string, body: string, ip: string | null): Promise<Result> {
  const text = body.trim();
  if (!text) return { ok: false, error: 'Write something first' };
  if (text.length > 2000) return { ok: false, error: 'Comments can be up to 2000 characters' };
  const store = getStore();
  if (!(await store.getSession(sessionId))) return { ok: false, error: 'This session no longer exists' };
  const c = await store.addComment({ sessionId, author: staff.email, body: text });
  await store.addAudit({ actor: staff.email, action: 'comment.added', target: sessionId, ip, detail: { id: c.id } });
  return { ok: true, message: 'Comment added.' };
}

export async function removeComment(staff: Staff, id: string, ip: string | null): Promise<Result> {
  const store = getStore();
  const c = await store.getComment(id);
  if (!c) return { ok: true };
  if (c.author !== staff.email && staff.role !== 'admin') return { ok: false, error: 'You can only delete your own comments' };
  await store.deleteComment(id);
  await store.addAudit({ actor: staff.email, action: 'comment.deleted', target: c.sessionId, ip, detail: { id, author: c.author } });
  return { ok: true };
}
