// The renderer always requests the same origin. Electron selects the backend in its main process.
export const defaultOrigin = 'http://127.0.0.1:8080';

export function readLocal(key: string, fallback = '') {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}

export function saveLocal(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* Storage can be unavailable in a restricted profile. */ }
}

export function normalizedOrigin(value: string) {
  const url = new URL(value.trim());
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Укажите адрес HTTP(S) без пути, логина и пароля.');
  }
  return url.origin;
}
