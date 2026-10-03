import { DEFAULT_PROVIDER_ID, getProvider } from './providers';

/** 访客的 key 只存在自己的浏览器 localStorage 里，本站没有后端、不上传、不落日志。 */
export interface Cred {
  apiKey: string;
  model: string;
}

export type CredMap = Record<string, Cred>;

const CRED_KEY = 'expwall.llm.creds.v1';
const PREF_KEY = 'expwall.llm.pref.v1';

function safeLocal(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadCreds(): CredMap {
  const store = safeLocal();
  if (!store) return {};
  try {
    const raw = store.getItem(CRED_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as CredMap;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function saveCred(providerId: string, cred: Cred): void {
  const store = safeLocal();
  if (!store) return;
  const all = loadCreds();
  all[providerId] = { apiKey: cred.apiKey.trim(), model: cred.model.trim() };
  store.setItem(CRED_KEY, JSON.stringify(all));
  store.setItem(PREF_KEY, providerId);
}

export function clearCred(providerId: string): void {
  const store = safeLocal();
  if (!store) return;
  const all = loadCreds();
  delete all[providerId];
  store.setItem(CRED_KEY, JSON.stringify(all));
}

export function getCred(providerId: string): Cred | null {
  const c = loadCreds()[providerId];
  return c && c.apiKey ? c : null;
}

export function loadPreferred(): string {
  const store = safeLocal();
  const id = store ? store.getItem(PREF_KEY) : null;
  if (id && getProvider(id)) return id;
  return DEFAULT_PROVIDER_ID;
}

export function savePreferred(id: string): void {
  const store = safeLocal();
  if (store) store.setItem(PREF_KEY, id);
}

export function maskKey(key: string): string {
  if (!key) return '';
  if (key.length <= 10) return '••••';
  return key.slice(0, 4) + '••••' + key.slice(-4);
}
