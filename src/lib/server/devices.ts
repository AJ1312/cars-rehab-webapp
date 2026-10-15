import QRCode from 'qrcode';
import { enrolCode, normaliseCode, sha256 } from './crypto';
import { getStore } from './store';
import type { Staff } from './types';

/** One-time enrolment code (24 h) for a study phone, with the QR code that carries it. Only the code's hash is stored. */
export async function createEnrolment(staff: Staff, label: string, origin: string, ip: string | null) {
  const code = enrolCode();
  const expires = new Date(Date.now() + 24 * 3600_000).toISOString();
  const store = getStore();
  const device = await store.createEnrolment({ label, codeHash: sha256(normaliseCode(code)), expiresAt: expires, createdBy: staff.id });
  await store.addAudit({ actor: staff.email, action: 'device.enrolment_created', target: device.id, detail: { label }, ip });
  const url = `${origin}/enrol?code=${code}`;
  return { device, code, url, expires, qr: await QRCode.toDataURL(url, { margin: 1, width: 280, errorCorrectionLevel: 'M' }) };
}

export async function revokeDevice(staff: Staff, id: string, ip: string | null) {
  const store = getStore();
  await store.revokeDevice(id);
  await store.addAudit({ actor: staff.email, action: 'device.revoked', target: id, ip });
}
