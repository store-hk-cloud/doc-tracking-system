const { app, BrowserWindow, protocol, session } = require('electron');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const supabaseOrigin = require('./web/origin.json');

const appUrl = 'app://receipt/index.html';
const assets = new Map([
  ['/index.html', 'text/html; charset=utf-8'],
  ['/app.js', 'text/javascript; charset=utf-8'],
  ['/api.js', 'text/javascript; charset=utf-8'],
  ['/app.css', 'text/css; charset=utf-8'],
  ['/ui-kit.css', 'text/css; charset=utf-8'],
  ['/hillkoff-emblem.png', 'image/png'],
  ['/icon-512.png', 'image/png'],
]);
const contentPolicy = [
  "default-src 'none'", "script-src 'self'", "style-src 'self'", "img-src 'self'",
  `connect-src ${supabaseOrigin}`, "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
].join('; ');

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [window] = BrowserWindow.getAllWindows();
    if (window?.isMinimized()) window.restore();
    window?.focus();
  });
  app.whenReady().then(async () => {
    protocol.handle('app', async request => {
      const url = new URL(request.url);
      const type = assets.get(url.pathname);
      if (url.host !== 'receipt' || request.method !== 'GET' || !type) return new Response(null, { status: 404 });
      const body = await readFile(path.join(__dirname, 'web', url.pathname.slice(1)));
      return new Response(body, {
        headers: { 'Content-Type': type, 'Content-Security-Policy': contentPolicy, 'X-Content-Type-Options': 'nosniff' },
      });
    });
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, allow) => allow(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    const window = new BrowserWindow({
      width: 1100, height: 790, minWidth: 720, minHeight: 540, autoHideMenuBar: true,
      icon: path.join(__dirname, 'web', 'icon-512.png'),
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, devTools: false },
    });
    window.removeMenu();
    window.webContents.on('will-navigate', (event, url) => {
      if (url !== appUrl) event.preventDefault();
    });
    window.webContents.on('will-attach-webview', event => event.preventDefault());
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    await window.loadURL(appUrl);
  }).catch(error => {
    console.error(error.message);
    app.exit(1);
  });
  app.on('window-all-closed', () => app.quit());
}
