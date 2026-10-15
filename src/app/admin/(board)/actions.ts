'use server';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireStaff } from '@/lib/server/auth';
import { addComment, editSession, removeComment, removeParticipant, removeSession, renameParticipant, type Result } from '@/lib/server/manage';
import { hashPassword, verifyPassword } from '@/lib/server/crypto';
import { revokeDevice } from '@/lib/server/devices';
import { getStore } from '@/lib/server/store';
import { settingsSchema } from '@/lib/schema';

export interface ActionState { ok?: boolean; error?: string; message?: string }

const toState = (r: Result): ActionState => (r.ok ? { ok: true, message: r.message } : { error: r.error });
const ipOf = async () => ((await headers()).get('x-forwarded-for') || '').split(',')[0].trim() || null;

/* ---------- sessions and participants: edit, delete, comment ---------- */
const id36 = z.string().uuid();
const typedDelete = (fd: FormData) => String(fd.get('confirm') || '').trim().toUpperCase() === 'DELETE';

export async function editSessionAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const staff = await requireStaff('researcher');
  const id = id36.safeParse(fd.get('id')); if (!id.success) return { error: 'Unknown session' };
  const r = await editSession(staff, id.data, Object.fromEntries(fd), await ipOf());
  revalidatePath('/admin', 'layout');
  if (r.ok) redirect(`/admin/sessions/${id.data}?saved=1`);
  return toState(r);
}
export async function deleteSessionAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const staff = await requireStaff('admin');
  const id = id36.safeParse(fd.get('id')); if (!id.success) return { error: 'Unknown session' };
  if (!typedDelete(fd)) return { error: 'Type DELETE to confirm' };
  const r = await removeSession(staff, id.data, await ipOf());
  revalidatePath('/admin', 'layout');
  if (r.ok && r.goto) redirect(r.goto);
  return toState(r);
}
export async function renameParticipantAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const staff = await requireStaff('researcher');
  const from = String(fd.get('from') || '').toUpperCase();
  const r = await renameParticipant(staff, from, String(fd.get('to') || ''), await ipOf());
  revalidatePath('/admin', 'layout');
  if (r.ok && r.goto) redirect(r.goto);
  return toState(r);
}
export async function deleteParticipantAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const staff = await requireStaff('admin');
  if (!typedDelete(fd)) return { error: 'Type DELETE to confirm' };
  const r = await removeParticipant(staff, String(fd.get('code') || '').toUpperCase(), await ipOf());
  revalidatePath('/admin', 'layout');
  if (r.ok && r.goto) redirect(r.goto);
  return toState(r);
}
export async function addCommentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const staff = await requireStaff();
  const id = id36.safeParse(fd.get('id')); if (!id.success) return { error: 'Unknown session' };
  const r = await addComment(staff, id.data, String(fd.get('body') || ''), await ipOf());
  revalidatePath(`/admin/sessions/${id.data}`);
  return toState(r);
}
export async function deleteCommentAction(fd: FormData) {
  const staff = await requireStaff();
  const id = id36.safeParse(fd.get('id')); const sid = id36.safeParse(fd.get('session'));
  if (!id.success || !sid.success) return;
  await removeComment(staff, id.data, await ipOf());
  revalidatePath(`/admin/sessions/${sid.data}`);
}
export async function revokeDeviceAction(fd: FormData) {
  const staff = await requireStaff('admin');
  await revokeDevice(staff, z.string().uuid().parse(fd.get('id')), await ipOf());
  revalidatePath('/admin/devices');
}

const staffSchema = z.object({
  email: z.string().trim().email().max(200), name: z.string().trim().max(80),
  role: z.enum(['admin', 'researcher', 'therapist']),
  password: z.string().min(12, 'Password must be at least 12 characters').max(200)
});
export async function createStaffAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireStaff('admin');
  const p = staffSchema.safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: p.error.issues[0].message };
  const store = getStore();
  if (await store.staffByEmail(p.data.email)) return { error: 'That email already has an account' };
  const s = await store.createStaff({ email: p.data.email, name: p.data.name, role: p.data.role, passwordHash: await hashPassword(p.data.password), totpSecret: null, totpEnabled: false, active: true });
  await store.addAudit({ actor: me.email, action: 'staff.created', target: s.email, detail: { role: s.role }, ip: await ipOf() });
  revalidatePath('/admin/staff');
  return { ok: true, message: `Account created for ${s.email}. Ask them to set up two-step sign-in under My account.` };
}

export async function setStaffActiveAction(fd: FormData) {
  const me = await requireStaff('admin');
  const id = z.string().uuid().parse(fd.get('id'));
  const active = fd.get('active') === '1';
  if (id === me.id) return;
  const store = getStore();
  await store.updateStaff(id, { active });
  await store.addAudit({ actor: me.email, action: active ? 'staff.enabled' : 'staff.disabled', target: id, ip: await ipOf() });
  revalidatePath('/admin/staff');
}

export async function resetStaffAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireStaff('admin');
  const id = z.string().uuid().safeParse(fd.get('id'));
  const pw = z.string().min(12, 'Password must be at least 12 characters').max(200).safeParse(fd.get('password'));
  if (!id.success) return { error: 'Unknown account' };
  if (!pw.success) return { error: pw.error.issues[0].message };
  const store = getStore();
  await store.updateStaff(id.data, { passwordHash: await hashPassword(pw.data), failedAttempts: 0, lockedUntil: null, totpEnabled: false, totpSecret: null });
  await store.addAudit({ actor: me.email, action: 'staff.password_reset', target: id.data, ip: await ipOf() });
  return { ok: true, message: 'Password reset. Two-step sign-in was turned off for that account.' };
}

export async function saveSettingsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireStaff('admin');
  const groups = String(fd.get('groups') || '').split(',').map((g) => g.trim()).filter(Boolean);
  const p = settingsSchema.safeParse({
    trialsPerGame: Number(fd.get('trialsPerGame')), trialSec: Number(fd.get('trialSec')), dwellMs: Number(fd.get('dwellMs')),
    itemTimeoutSec: Number(fd.get('itemTimeoutSec')), level: Number(fd.get('level')), groups
  });
  if (!p.success) return { error: p.error.issues[0].path.join('.') + ': ' + p.error.issues[0].message };
  const store = getStore();
  await store.setSettings(p.data);
  await store.addAudit({ actor: me.email, action: 'settings.updated', detail: p.data, ip: await ipOf() });
  revalidatePath('/admin/settings');
  return { ok: true, message: 'Saved. Phones pick up the new defaults the next time they are online.' };
}

export async function changePasswordAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireStaff();
  const cur = String(fd.get('current') || '');
  const next = z.string().min(12, 'New password must be at least 12 characters').max(200).safeParse(fd.get('next'));
  if (!next.success) return { error: next.error.issues[0].message };
  if (!(await verifyPassword(cur, me.passwordHash))) return { error: 'Current password is not correct' };
  const store = getStore();
  await store.updateStaff(me.id, { passwordHash: await hashPassword(next.data) });
  await store.addAudit({ actor: me.email, action: 'staff.password_changed', ip: await ipOf() });
  return { ok: true, message: 'Password changed.' };
}
