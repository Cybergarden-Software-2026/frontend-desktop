import { app, BrowserWindow, ipcMain, net, protocol, session, shell } from 'electron';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import backend from './backend.json' with { type: 'json' };

const scheme = 'underctrl';
const home = 'underctrl://desktop/';
const assets = path.resolve(import.meta.dirname, '../dist');
const devPort = process.env.UNDERCTRL_VITE_PORT;
const devOrigin = !app.isPackaged && /^\d+$/.test(devPort || '') ? 'http://127.0.0.1:' + devPort : null;
let backendOrigin;
let settingsPath;
let mainWindow;

protocol.registerSchemesAsPrivileged([{ scheme, privileges: {
  standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true,
} }]);

function apiOrigin(value) {
  try {
    const url = new URL(value);
    if (/^https?:$/.test(url.protocol) && !url.username && !url.password &&
        url.pathname === '/' && !url.search && !url.hash) return url.origin;
  } catch { /* Show a single actionable message for all invalid values. */ }
  throw new Error('Укажите адрес сервера HTTP(S) без пути, логина и пароля.');
}

async function loadOrigin() {
  try {
    const settings = JSON.parse(await readFile(settingsPath, 'utf8'));
    return apiOrigin(settings.origin);
  } catch { return apiOrigin(process.env.UNDERCTRL_API_ORIGIN || backend.origin); }
}

function fetchBackend(origin, pathname, init) {
  // Cookies normally span ports. Keep each configured origin in its own Chromium jar.
  const partition = 'persist:backend-' + createHash('sha256').update(origin).digest('hex');
  const headers = new Headers(init.headers);
  headers.set('Origin', origin);
  return session.fromPartition(partition).fetch(origin + pathname, {
    ...init, headers, credentials: 'include', redirect: 'error', cache: 'no-store',
  });
}

function checkSender(event) {
  if (!mainWindow || event.sender !== mainWindow.webContents ||
      event.senderFrame !== mainWindow.webContents.mainFrame ||
      !event.senderFrame.url.startsWith(home)) throw new Error('Недопустимый источник запроса.');
}

async function setConnection(event, input) {
  checkSender(event);
  const origin = apiOrigin(input);
  try {
    const signal = AbortSignal.timeout(8000);
    const status = await fetchBackend(origin, '/api/v1/auth/coordinator/session', { signal });
    if (status.status === 404) {
      // Older backends expose the event journal without a coordinator session.
      const events = await fetchBackend(origin, '/api/v1/events?limit=1', { signal });
      if (!events.ok) throw new Error();
      const page = await events.json();
      if (!Array.isArray(page?.items) || (page.nextCursor !== null && typeof page.nextCursor !== 'string')) throw new Error();
    } else {
      if (!status.ok) throw new Error();
      const info = await status.json();
      if (typeof info?.required !== 'boolean' || typeof info.authenticated !== 'boolean') throw new Error();
    }
  } catch {
    throw new Error('Проверьте адрес сервера и доступность API.');
  }
  await mkdir(path.dirname(settingsPath), { recursive: true });
  const next = settingsPath + '.' + randomUUID() + '.tmp';
  await writeFile(next, JSON.stringify({ origin }), { mode: 0o600 });
  await rename(next, settingsPath);
  backendOrigin = origin;
}

const policy = [
  "default-src 'self'",
  devOrigin ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' blob:",
  devOrigin ? "worker-src 'self' blob:" : "worker-src 'self'",
  "connect-src 'self'" + (devOrigin ? ' ' + devOrigin.replace('http:', 'ws:') : ''),
  "object-src 'none'", "frame-src 'none'", "base-uri 'none'",
].join('; ');

async function serve(request) {
  const url = new URL(request.url);
  if (url.host !== 'desktop') return new Response(null, { status: 404 });
  if (url.pathname.startsWith('/api/v1/')) {
    const headers = new Headers();
    for (const name of ['accept', 'content-type', 'last-event-id', 'x-user-id']) {
      if (request.headers.has(name)) headers.set(name, request.headers.get(name));
    }
    try {
      const upstream = await fetchBackend(backendOrigin, url.pathname + url.search, {
        method: request.method, headers, signal: request.signal,
        body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer(),
      });
      // Stream SSE unchanged. The backend session handles cookies outside the renderer.
      const responseHeaders = new Headers({ 'Cache-Control': 'no-store' });
      for (const name of ['content-type', 'x-request-id', 'retry-after']) {
        if (upstream.headers.has(name)) responseHeaders.set(name, upstream.headers.get(name));
      }
      return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
    } catch {
      return Response.json({ error: 'Нет соединения с сервером.' }, { status: 502 });
    }
  }
  if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405 });
  try {
    const requestPath = decodeURIComponent(url.pathname);
    if (requestPath.includes('\\') || requestPath.includes('\0')) return new Response(null, { status: 400 });
    const file = path.resolve(assets, '.' + (requestPath === '/' ? '/index.html' : requestPath));
    const relative = path.relative(assets, file);
    if (relative.startsWith('..') || path.isAbsolute(relative)) return new Response(null, { status: 403 });
    const resource = devOrigin
      ? await fetch(devOrigin + url.pathname + url.search, { method: request.method, signal: request.signal })
      : await net.fetch(pathToFileURL(file).href, { method: request.method });
    const headers = new Headers(resource.headers);
    if (devOrigin) {
      headers.delete('content-encoding');
      headers.delete('content-length');
    }
    headers.set('Content-Security-Policy', policy);
    return new Response(resource.body, { status: resource.status, headers });
  } catch { return new Response(null, { status: 404 }); }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440, height: 900, minWidth: 760, minHeight: 540,
    title: 'UnderCtrl', backgroundColor: '#f5f1f8', autoHideMenuBar: true, show: false,
    webPreferences: {
      preload: path.join(import.meta.dirname, 'preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  });
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.webContents.on('will-navigate', event => {
    const target = new URL(event.url);
    if (target.href.split('#')[0] !== home) event.preventDefault();
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const target = new URL(url);
      if (/^https?:$/.test(target.protocol) && !target.username && !target.password) {
        void shell.openExternal(target.href).catch(() => {});
      }
    } catch { /* Ignore invalid external links. */ }
    return { action: 'deny' };
  });
  void mainWindow.loadURL(home);
}

app.whenReady().then(async () => {
  settingsPath = path.join(app.getPath('userData'), 'connection.json');
  backendOrigin = await loadOrigin();
  ipcMain.handle('connection:get', event => { checkSender(event); return { origin: backendOrigin }; });
  ipcMain.handle('connection:set', setConnection);
  protocol.handle(scheme, serve);
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => {
    callback(permission === 'clipboard-sanitized-write' && contents === mainWindow?.webContents && contents.getURL().startsWith(home));
  });
  session.defaultSession.on('will-download', (_event, item) => {
    item.setSaveDialogOptions({ title: 'Сохранить отчёт', defaultPath: path.join(app.getPath('downloads'), path.basename(item.getFilename())) });
  });
  createWindow();
  app.on('activate', () => { if (!mainWindow) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
