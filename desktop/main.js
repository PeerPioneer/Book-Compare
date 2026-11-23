'use strict';
/* Book Compare as a desktop program (V5, Electron; decided 20 Nov 2026, D3).
   One window with the pages of the folder "app". The program reads the scan folders itself (desktop/server.js; this replaced the
   former helper program, removed 21 Nov 2026).
   The folder and picture windows are the ordinary Windows ones (Electron's dialog).

   For the automatic test on GitHub:  "Book Compare.exe" --smoke-test <result file> [<project file>.bookcompare]
   opens the program without showing the window, checks that the page and the scan reader answer (and that the project file opens),
   writes the result and quits.
   A double-clicked project file (.bookcompare, registered by the installer) arrives as an argument; it is handed to the page,
   which asks for it (/api/pending) when it starts, or at once if the program is already open (second-instance). */
const { app, BrowserWindow, dialog, shell, Menu } = require('electron');
const path = require('path'), fs = require('fs');
const { createServer, VERSION } = require('./server');

const PORTS = [8790, 8791, 8792, 8793, 8794];              // a fixed address keeps the remembered project between starts
const smokeIdx = process.argv.indexOf('--smoke-test'), SMOKE = smokeIdx >= 0 ? process.argv[smokeIdx + 1] : null;
const appDir = app.isPackaged ? path.join(process.resourcesPath, 'app') : path.join(__dirname, '..', 'app');
let win = null, port = 0, server = null;
// A project file that was double-clicked (Windows starts the program with its address) waits here until the page asks for it.
function projectArg(argv) { return (argv || []).slice(1).find(a => /\.bookcompare$/i.test(a) && fs.existsSync(a)) || null; }
let pendingOpen = projectArg(process.argv);
const SMOKE_OPEN = SMOKE && pendingOpen ? path.basename(pendingOpen) : null;     // test mode with a project file: it must open

app.commandLine.appendSwitch('js-flags', '--max-old-space-size=8192');   // big scans: let the page use more memory than a browser tab gets

if (!SMOKE && !app.requestSingleInstanceLock()) { app.quit(); }
else {
  app.on('second-instance', (e, argv) => {
    const f = projectArg(argv);
    if (f) pendingOpen = f;
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
    if (f) win.webContents.executeJavaScript('window.BookWorkspace && window.BookWorkspace.openPending && window.BookWorkspace.openPending()').catch(() => { });
  });
  app.whenReady().then(start).catch(e => { dialog.showErrorBox('Book Compare could not start', String(e && e.message || e)); app.quit(); });
}
app.on('window-all-closed', () => app.quit());

function log(text) {
  try { fs.mkdirSync(app.getPath('userData'), { recursive: true }); fs.appendFileSync(path.join(app.getPath('userData'), 'book-compare.log'), new Date().toISOString() + ' ' + text + '\n'); } catch (e) { /* no log */ }
}

// One-click update (item 35): the page finds a newer version on the Releases page and asks the person; then electron-updater downloads
// the installer of that release (checked against the size and SHA-512 listed in its latest.yml) and installs it silently after Book
// Compare closes, then starts the new version. The program is not signed (no certificate): Windows may show its usual warning once.
let updater = null;
const upd = { state: 'idle', version: '', percent: 0, error: '' };
function getUpdater() {
  if (updater || !app.isPackaged) return updater;
  try {
    updater = require('electron-updater').autoUpdater;
    updater.autoDownload = false; updater.autoInstallOnAppQuit = false; updater.allowPrerelease = false;
    updater.on('update-available', i => { upd.state = 'available'; upd.version = i.version; });
    updater.on('update-not-available', () => { upd.state = 'none'; });
    updater.on('download-progress', p => { upd.state = 'downloading'; upd.percent = Math.round(p.percent || 0); });
    updater.on('update-downloaded', i => { upd.state = 'ready'; upd.version = i.version; upd.percent = 100; });
    updater.on('error', e => { upd.state = 'error'; upd.error = String(e && e.message || e).split('\n')[0]; log('update: ' + upd.error); });
  } catch (e) { log('update: ' + e.message); updater = null; }
  return updater;
}
async function update(cmd) {
  const u = getUpdater();
  if (!u) return { state: 'unavailable', error: app.isPackaged ? 'The updater could not be loaded.' : 'Not in the installed program.' };
  if (cmd === 'check' && upd.state !== 'downloading' && upd.state !== 'ready') { upd.state = 'checking'; upd.error = ''; await u.checkForUpdates().catch(() => { }); }
  else if (cmd === 'download' && (upd.state === 'available' || upd.state === 'error')) { upd.state = 'downloading'; upd.percent = 0; upd.error = ''; u.downloadUpdate().catch(() => { }); }
  else if (cmd === 'install' && upd.state === 'ready') { setTimeout(() => { closingForUpdate = true; u.quitAndInstall(true, true); }, 300); return Object.assign({ installing: true }, upd); }
  return Object.assign({}, upd);
}
let closingForUpdate = false;

const PROJECT_FILTER = { name: 'Book Compare project', extensions: ['bookcompare'] };
async function pick(kind, start, title, name) {
  const o = { title, defaultPath: start || undefined };
  if (kind === 'save-project') {
    const r = await dialog.showSaveDialog(win, { title, defaultPath: path.join(start || app.getPath('documents'), name || 'Book project.bookcompare'),
      filters: [PROJECT_FILTER], properties: ['showOverwriteConfirmation', 'createDirectory'] });
    return r.canceled || !r.filePath ? null : r.filePath;
  }
  if (kind === 'open-project') {
    o.properties = ['openFile'];
    o.filters = [PROJECT_FILTER, { name: 'Project of an older version (book-compare-project.json)', extensions: ['json'] }];
    const r = await dialog.showOpenDialog(win, o);
    return r.canceled || !r.filePaths.length ? null : r.filePaths[0];
  }
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
    const s = createServer({ port: p, appDir, dataDir: app.getPath('userData'), pick, log, quit: () => app.quit(), update,
      takeOpen: () => { const f = pendingOpen; pendingOpen = null; return f; } });
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
  // Closing with unsaved changes (item 27): a project that has a file is saved first, without asking; a project that was never saved
  // gets the question Save … / Close without saving / Cancel.
  let closing = false, asking = false;
  const closeNow = () => { closing = true; if (win && !win.isDestroyed()) win.close(); };
  const ask = (err) => {
    const c = dialog.showMessageBoxSync(win, { type: 'question', buttons: ['Save …', 'Close without saving', 'Cancel'], defaultId: 0, cancelId: 2,
      title: 'Book Compare', message: err ? 'The project could not be saved.' : 'The project is not saved yet.',
      detail: err ? err + '\n\nSave it somewhere else, or close Book Compare without saving?' : 'Save it as a project file before Book Compare closes? Otherwise the changes are lost.' });
    if (c === 1) return closeNow();
    if (c === 0) win.webContents.executeJavaScript('window.BookWorkspace ? BookWorkspace.saveForClose() : true').then(ok => { if (ok) closeNow(); }).catch(() => {});
  };
  win.webContents.on('will-prevent-unload', e => {
    if (closing || closingForUpdate) { e.preventDefault(); return; }    // (asked already, or saved before the update: close)
    if (asking) return;
    asking = true;
    win.webContents.executeJavaScript('window.BookWorkspace && BookWorkspace.beforeClose ? BookWorkspace.beforeClose() : { ok: false }')
      .then(r => { asking = false; if (r && r.ok) closeNow(); else ask(r && r.err); })
      .catch(() => { asking = false; ask(''); });
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
      let opened = '';
      for (let i = 0; i < 100 && ${JSON.stringify(!!SMOKE_OPEN)} && !(opened = BookWorkspace.projectInfo().file); i++) await new Promise(r => setTimeout(r, 100));
      return { workspace: !!window.BookWorkspace, compare: !!window.CompareTab, engine: !!(window.AlignEngine && AlignEngine.supported()), desktopAgent: /BookCompareDesktop/.test(navigator.userAgent), ping, opened };
    })()`);
    const r = out.result;
    out.ok = r.workspace && r.compare && r.engine && r.desktopAgent && r.ping.app === 'BookCompare' && r.ping.desktop === true && r.ping.pick === 'dialog'
      && (!SMOKE_OPEN || r.opened === SMOKE_OPEN);
    out.version = app.getVersion(); out.port = port;
    // the one-click update (item 35): the updater is part of the program and knows where to look
    out.updater = !!getUpdater() || !app.isPackaged;
    out.updateConfig = app.isPackaged ? fs.existsSync(path.join(process.resourcesPath, 'app-update.yml')) : true;
    out.ok = out.ok && out.updater && out.updateConfig;
  } catch (e) { out.error = String(e && e.message || e); }
  fs.writeFileSync(SMOKE, JSON.stringify(out, null, 1));
  app.exit(out.ok ? 0 : 1);
}
