const { app, BrowserWindow, ipcMain, protocol, safeStorage, session, shell } = require('electron');
const { readFile, rename, rm, writeFile } = require('node:fs/promises');
const path = require('node:path');
const { assetFor, allowExternal, localUrl, sessionKey } = require('./full-policy.cjs');
const config = require('./full-web/desktop-config.json');

const appUrl = 'app://desktop/';
const assets = path.join(__dirname, 'full-web');
const mediaTypes = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2',
};
const contentPolicy = [
  "default-src 'none'", "script-src 'self'", "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${config.supabaseOrigin}`, "font-src 'self'", `connect-src 'self' ${config.supabaseOrigin}`,
  "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
].join('; ');

function installSessionStorage() {
  const volatile = new Map();
  function register(channel, action) {
    ipcMain.handle('desktop-session:' + channel, (event, key, value) => {
      const frame = event.senderFrame;
      if (!frame || frame !== event.sender.mainFrame || !localUrl(frame.url) || !sessionKey(key, config)) {
        throw new Error('Invalid desktop session request');
      }
      return action(key, value);
    });
  }
  const location = key => path.join(app.getPath('userData'), key + '.dpapi');
  register('get', async key => {
    if (!safeStorage.isEncryptionAvailable()) return volatile.get(key) ?? null;
    try { return safeStorage.decryptString(await readFile(location(key))); }
    catch (error) {
      if (error.code === 'ENOENT') return null;
      await rm(location(key), { force: true });
      return null;
    }
  });
  register('set', async (key, value) => {
    if (typeof value !== 'string' || value.length > 64 * 1024) throw new Error('Invalid desktop session data');
    if (!safeStorage.isEncryptionAvailable()) {
      volatile.set(key, value);
      return;
    }
    const target = location(key);
    await writeFile(target + '.tmp', safeStorage.encryptString(value));
    await rename(target + '.tmp', target);
  });
  register('remove', async key => {
    volatile.delete(key);
    await rm(location(key), { force: true });
    await rm(location(key) + '.tmp', { force: true });
  });
}

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
    installSessionStorage();
    protocol.handle('app', async request => {
      const asset = assetFor(request.url);
      if (!asset || request.method !== 'GET') return new Response(null, { status: 404 });
      try {
        const body = await readFile(path.join(assets, asset));
        return new Response(body, {
          headers: { 'Content-Type': mediaTypes[path.extname(asset)], 'Content-Security-Policy': contentPolicy, 'X-Content-Type-Options': 'nosniff' },
        });
      } catch (error) {
        if (error.code === 'ENOENT') return new Response(null, { status: 404 });
        throw error;
      }
    });
    const isLocation = (permission, origin, mainFrame) => permission === 'geolocation' && mainFrame && Boolean(localUrl(origin));
    session.defaultSession.setPermissionRequestHandler((_contents, permission, allow, details) =>
      allow(isLocation(permission, details.requestingUrl, details.isMainFrame)));
    session.defaultSession.setPermissionCheckHandler((_contents, permission, origin, details) =>
      isLocation(permission, origin, details.isMainFrame));
    const window = new BrowserWindow({
      width: 1280, height: 860, minWidth: 720, minHeight: 540, autoHideMenuBar: true,
      icon: path.join(assets, 'icons', 'icon-512.png'),
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, devTools: false, preload: path.join(__dirname, 'full-preload.cjs') },
    });
    function openExternal(url) {
      if (allowExternal(url, config)) void shell.openExternal(url).catch(() => {});
    }
    window.removeMenu();
    window.webContents.on('will-navigate', (event, url) => {
      if (!localUrl(url)) {
        event.preventDefault();
        openExternal(url);
      }
    });
    window.webContents.on('will-redirect', (event, url) => {
      if (!localUrl(url)) event.preventDefault();
    });
    window.webContents.on('will-attach-webview', event => event.preventDefault());
    window.webContents.setWindowOpenHandler(({ url }) => {
      openExternal(url);
      return { action: 'deny' };
    });
    await window.loadURL(appUrl);
  }).catch(error => {
    console.error(error.message);
    app.exit(1);
  });
  app.on('window-all-closed', () => app.quit());
}
