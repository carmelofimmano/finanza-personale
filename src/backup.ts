import { db, setMeta, TABLES } from './db';
import { today } from './dates';

const APP = 'finanza-personale';

interface PlainBackup {
  app: typeof APP;
  version: 1;
  exportedAt: string;
  data: Record<string, unknown[]>;
}

interface EncryptedBackup {
  app: typeof APP;
  version: 1;
  encrypted: true;
  salt: string;
  iv: string;
  payload: string;
}

const b64 = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(password: string, salt: Uint8Array) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: 250_000, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function buildBackup(password?: string): Promise<string> {
  const data: Record<string, unknown[]> = {};
  for (const name of TABLES) data[name] = await db.table(name).toArray();
  const plain: PlainBackup = { app: APP, version: 1, exportedAt: new Date().toISOString(), data };
  const json = JSON.stringify(plain);
  if (!password) return json;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(json));
  const enc: EncryptedBackup = { app: APP, version: 1, encrypted: true, salt: b64(salt), iv: b64(iv), payload: b64ByChunks(cipher) };
  return JSON.stringify(enc);
}

// String.fromCharCode(...buf) supera il limite di argomenti con file grandi
function b64ByChunks(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function isEncrypted(text: string): boolean {
  try {
    return JSON.parse(text).encrypted === true;
  } catch {
    return false;
  }
}

export async function restoreBackup(text: string, password?: string) {
  let parsed = JSON.parse(text) as PlainBackup | EncryptedBackup;
  if (parsed.app !== APP) throw new Error('Il file non è un backup di Finanza Personale.');
  if ('encrypted' in parsed) {
    if (!password) throw new Error('Questo backup è protetto: inserisci la password.');
    try {
      const key = await deriveKey(password, unb64(parsed.salt));
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(parsed.iv) }, key, unb64(parsed.payload));
      parsed = JSON.parse(new TextDecoder().decode(plain)) as PlainBackup;
    } catch {
      throw new Error('Password errata o file danneggiato.');
    }
  }
  const data = (parsed as PlainBackup).data;
  if (!data || !Array.isArray(data.transactions)) throw new Error('Backup non valido.');
  await db.transaction('rw', TABLES.map((t) => db.table(t)), async () => {
    for (const name of TABLES) {
      await db.table(name).clear();
      if (Array.isArray(data[name])) await db.table(name).bulkAdd(data[name]);
    }
  });
}

export function backupFileName() {
  return `finanza-backup-${today()}.json`;
}

export async function markBackupDone() {
  await setMeta('lastBackup', today());
}

export function downloadText(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Su Android apre il menu di condivisione (Drive, email, WhatsApp...). */
export async function shareText(text: string, filename: string): Promise<boolean> {
  const file = new File([text], filename, { type: 'application/json' });
  if (!navigator.canShare?.({ files: [file] })) return false;
  try {
    await navigator.share({ files: [file], title: 'Backup Finanza Personale' });
    return true;
  } catch (e) {
    if ((e as DOMException).name === 'AbortError') return false;
    throw e;
  }
}
