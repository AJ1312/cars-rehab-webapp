import { randomToken, sha256 } from './crypto';
import { getStore } from './store';
import type { Staff } from './types';

/** A readable name for a phone, taken from its browser string: "iPhone · Safari · 7F3A". The 4 characters tell two phones of the same kind apart. */
export function deviceLabelFromUa(ua: string, tokenHash: string): string {
  const u = ua || '';
  const kind = /iPhone/i.test(u) ? 'iPhone' : /iPad/i.test(u) ? 'iPad' : /Android/i.test(u) ? 'Android' : /Mac OS X|Windows|Linux|CrOS/i.test(u) ? 'Computer' : 'Phone';
  const browser = /SamsungBrowser/i.test(u) ? 'Samsung Internet' : /EdgA|EdgiOS|Edg\//i.test(u) ? 'Edge' : /FxiOS|Firefox/i.test(u) ? 'Firefox' : /CriOS|Chrome/i.test(u) ? 'Chrome' : /Safari/i.test(u) ? 'Safari' : 'Browser';
  return `${kind} · ${browser} · ${tokenHash.slice(0, 4).toUpperCase()}`;
}

/** Called by a phone the first time it has something to upload. Only the token's hash is stored, so a database leak does not expose working tokens. */
export async function registerDevice(ua: string, ip: string | null) {
  const store = getStore();
  const token = randomToken('cars_');
  const tokenHash = sha256(token);
  const device = await store.registerDevice({ label: deviceLabelFromUa(ua, tokenHash), tokenHash, model: ua.slice(0, 190) || null });
  await store.addAudit({ actor: 'device:' + device.label, action: 'device.registered', target: device.id, ip });
  return { device, token, settings: await store.getSettings() };
}

export async function revokeDevice(staff: Staff, id: string, ip: string | null) {
  const store = getStore();
  await store.revokeDevice(id);
  await store.addAudit({ actor: staff.email, action: 'device.revoked', target: id, ip });
}
