'use strict';
/* Book Compare as a desktop program (V5, Electron; decided 20 Nov 2026, D3).
   One window with the pages of the folder "app". The program reads the scan folders itself (desktop/server.js; this replaced the
   former helper program, removed 21 Nov 2026).
   The folder and picture windows are the ordinary Windows ones (Electron's dialog).

   For the automatic test on GitHub:  "Book Compare.exe" --smoke-test <result file>
   opens the program without showing the window, checks that the page and the scan reader answer, writes the result and quits. */
const { app, BrowserWindow, dialog, shell, Menu } = require('electron');
const path = require('path'), fs = require('fs');
const { createServer, VERSION } = require('./server');

const PORTS = [8790, 8791, 8792, 8793, 8794];              // a fixed address keeps the remembered project between starts
const smokeIdx = process.argv.indexOf('--smoke-test'), SMOKE = smokeIdx >= 0 ? process.argv[smokeIdx + 1] : null;
const appDir = app.isPackaged ? path.join(process.resourcesPath, 'app') : path.join(__dirname, '..', 'app');
let win = null, port = 0, server = null;

app.commandLine.appendSwitch('js-flags', '--max-old-space-size=8192');   // big scans: let the page use more memory than a browser tab gets

if (!SMOKE && !app.requestSingleInstanceLock()) { app.quit(); }
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(start).catch(e => { dialog.showErrorBox('Book Compare could not start', String(e && e.message || e)); app.quit(); });
}
app.on('window-all-closed', () => app.quit());

function log(text) {
  try { fs.mkdirSync(app.getPath('userData'), { recursive: true }); fs.appendFileSync(path.join(app.getPath('userData'), 'book-compare.log'), new Date().toISOString() + ' ' + text + '\n'); } catch (e) { /* no log */ }
}

async function pick(kind, start, title) {
  const o = { title, defaultPath: start || undefined };
  if (kind === 'files') {
    o.properties = ['openFile', 'multiSelections'];
    o.filters = [{ name: 'Pictures', extensions: ['jpg', 'jpeg', 'png', 'tif', 'tiff'] }, { name: 'All files', extensions: ['*'] }];
  } else o.properties = ['openDirectory', 'createDirectory'];
  const r = await dialog.showOpenDialog(win, o);
  if (r.canceled || !r.filePaths.length) return null;
  if (kind !== 'files') return r.filePaths[0];
  const folder = path.dirname(r.filePaths[0]);
  return { folder, files: r.filePaths.filter(f => path.dirname(f) === folder).map(f => path.basename(f)) };   // (Windows lets you choose from one folder only)
}

async function start() {
  Menu.setApplicationMenu(null);
  let lastErr = null;
  for (const p of PORTS) {
    const s = createServer({ port: p, appDir, dataDir: app.getPath('userData'), pick, log, quit: () => app.quit() });
    try { await s.listen(); server = s; port = p; break; } catch (e) { lastErr = e; }
  }
  if (!server) throw new Error('No free address on this computer (' + (lastErr && lastErr.message) + ').');
  log('Book Compare ' + app.getVersion() + ' (server ' + VERSION + ') on port ' + port);

  win = new BrowserWindow({
    width: 1400, height: 900, show: false, title: 'Book Compare', backgroundColor: '#ffffff',
    icon: path.join(__dirname, 'build', 'icon.ico'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false }
  });
  win.webContents.setUserAgent(win.webContents.getUserAgent() + ' BookCompareDesktop/' + app.getVersion());
  const origin = 'http://127.0.0.1:' + port;
  // links to other web sites open in the ordinary browser; Book Compare's own pages stay in the window
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(origin + '/')) return { action: 'allow' };
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(origin + '/')) { e.preventDefault(); if (/^https?:\/\//.test(url)) shell.openExternal(url); } });
  // the page asks before it is closed with unsaved changes: show that question as an ordinary window
  win.webContents.on('will-prevent-unload', e => {
    const c = dialog.showMessageBoxSync(win, { type: 'question', buttons: ['Close without saving', 'Cancel'], defaultId: 1, cancelId: 1,
      title: 'Book Compare', message: 'The project has changes that are not saved.', detail: 'Close Book Compare anyway? The changes will be lost.' });
    if (c === 0) e.preventDefault();
  });
  win.webContents.on('render-process-gone', (e, d) => { log('page stopped: ' + d.reason); if (!SMOKE && d.reason !== 'clean-exit') dialog.showErrorBox('Book Compare', 'The page stopped (' + d.reason + '). It will be loaded again; your last saved project is kept.'); if (win && !win.isDestroyed()) win.reload(); });

  if (SMOKE) return smokeTest(origin);
  win.once('ready-to-show', () => { win.maximize(); win.show(); });
  await win.loadURL(origin + '/index.html');
}

async function smokeTest(origin) {
  const out = { ok: false };
  try {
    await win.loadURL(origin + '/index.html');
    out.result = await win.webContents.executeJavaScript(`(async () => {
      for (let i = 0; i < 100 && !(window.BookWorkspace && window.CompareTab); i++) await new Promise(r => setTimeout(r, 100));
      const ping = await (await fetch('/api/ping')).json();
      return { workspace: !!window.BookWorkspace, compare: !!window.CompareTab, engine: !!(window.AlignEngine && AlignEngine.supported()), desktopAgent: /BookCompareDesktop/.test(navigator.userAgent), ping };
    })()`);
    const r = out.result;
    out.ok = r.workspace && r.compare && r.engine && r.desktopAgent && r.ping.app === 'BookCompare' && r.ping.desktop === true && r.ping.pick === 'dialog';
    out.version = app.getVersion(); out.port = port;
  } catch (e) { out.error = String(e && e.message || e); }
  fs.writeFileSync(SMOKE, JSON.stringify(out, null, 1));
  app.exit(out.ok ? 0 : 1);
}
