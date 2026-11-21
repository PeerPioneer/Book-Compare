'use strict';
/* Book Compare desktop program: the part that reads the scan folders (V5).
   It replaced the former helper program (launcher/serve.ps1, removed 21 Nov 2026) and gives the same answers (the same /api), so the
   pages in "app" use it unchanged ("helper mode" in app/js/workspace.js). It runs inside the desktop program (desktop/main.js), on this
   computer only (address 127.0.0.1), and can also be started on its own with Node for the automatic tests:

     node desktop/server.js --port 8790 --data-dir <folder> --test-pick-file <file>

   Scan folders are only READ. It writes only the project file (<name>.bookcompare) and the files in the results folder next to it
   (<name>.bookcompare results), and never in a folder that holds pictures. Project folders of older versions (book-compare-project.json)
   are only read. */
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');

const VERSION = '2.0-desktop';
const IMG_EXT = ['.jpg', '.jpeg', '.png', '.tif', '.tiff', '.webp', '.bmp', '.gif'];
const LEGACY_FILE = 'book-compare-project.json';                 // the project file of versions before 0.9 (one project per folder): only read
const PROJECT_EXT = '.bookcompare', RESULTS_SUFFIX = ' results';
const PROJECT_RE = /^.+\.bookcompare$/i, RESULTS_RE = /^.+\.bookcompare results$/i;
const IS_WIN = process.platform === 'win32';
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.map': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.tif': 'image/tiff', '.tiff': 'image/tiff', '.webp': 'image/webp', '.bmp': 'image/bmp', '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.wasm': 'application/wasm'
};
const BAD_NAME = /[<>:"/\\|?*\x00-\x1f]/;

function same(a, b) { return IS_WIN ? a.toLowerCase() === b.toLowerCase() : a === b; }
function isImage(name) { return IMG_EXT.includes(path.extname(name).toLowerCase()); }

// What a path inside a project folder is: 'root' (the folder itself), 'file' (a project file), 'legacy' (the project file of older versions),
// 'results' (the results folder of a project, or anything in it) or null (anything else, which is never touched).
function projectPart(rel) {
  rel = rel.replace(/^\/+|\/+$/g, '');
  if (rel === '') return 'root';
  const parts = rel.split('/');
  if (parts.length === 1 && parts[0] === LEGACY_FILE) return 'legacy';
  if (parts.length === 1 && PROJECT_RE.test(parts[0])) return 'file';
  if (RESULTS_RE.test(parts[0])) return 'results';
  return null;
}

/* opts: { port, appDir, dataDir, testPickFile, pick(kind, start, title, name) -> Promise<null | string | {folder, files}>, takeOpen() -> path | null,
           quit(), log(text) } */
function createServer(opts) {
  const port = opts.port, appDir = path.resolve(opts.appDir), appRoot = appDir + path.sep;
  const allowedHosts = ['localhost:' + port, '127.0.0.1:' + port], allowedOrigins = ['http://localhost:' + port, 'http://127.0.0.1:' + port];
  const roots = new Map();
  let pickOpen = false;
  const log = opts.log || (() => { });
  const settingsFile = path.join(opts.dataDir, 'settings.json');

  function readSettings() { try { return Object.assign({ lastScans: '', lastProject: '' }, JSON.parse(fs.readFileSync(settingsFile, 'utf8'))); } catch (e) { return { lastScans: '', lastProject: '' }; } }
  function saveSettings(s) { try { fs.mkdirSync(opts.dataDir, { recursive: true }); fs.writeFileSync(settingsFile, JSON.stringify(s, null, 1)); } catch (e) { log('settings: ' + e.message); } }

  function send(res, code, ctype, body, extra) {
    const b = Buffer.isBuffer(body) ? body : Buffer.from(body || '', 'utf8');
    res.writeHead(code, Object.assign({ 'Content-Type': ctype, 'Content-Length': b.length }, extra || {}));
    res.end(b);
  }
  function json(res, code, obj) { send(res, code, 'application/json; charset=utf-8', JSON.stringify(obj), { 'Cache-Control': 'no-store' }); }
  function err(res, code, e, msg) { json(res, code, { error: e, message: msg || '' }); }

  function isDir(p) { try { return fs.statSync(p).isDirectory(); } catch (e) { return false; } }
  function isFile(p) { try { return fs.statSync(p).isFile(); } catch (e) { return false; } }

  function registerRoot(p, kind) {
    if (!p || !path.isAbsolute(p)) return null;
    let full;
    try { full = path.resolve(p); } catch (e) { return null; }
    if (full.length > path.parse(full).root.length) full = full.replace(/[\\/]+$/, '');
    if (!isDir(full)) return null;
    for (const [id, r] of roots) if (r.kind === kind && same(r.path, full)) return { id, root: r };
    const name = path.basename(full) || full.replace(/[\\/]+$/, '');
    const id = crypto.randomBytes(16).toString('hex'), r = { path: full, kind, name };
    roots.set(id, r);
    return { id, root: r };
  }
  function rootJson(id, r) { return { id, path: r.path, name: r.name, kind: r.kind }; }
  function resolveInRoot(r, rel) {
    rel = rel.replace(/^\/+|\/+$/g, '');
    if (rel === '') return r.path;
    const parts = rel.split('/');
    for (const q of parts) if (q === '' || q === '.' || q === '..' || BAD_NAME.test(q)) return null;
    const full = path.resolve(r.path, ...parts), base = r.path.replace(/[\\/]+$/, '') + path.sep;
    if (!(IS_WIN ? full.toLowerCase().startsWith(base.toLowerCase()) : full.startsWith(base))) return null;
    return full;
  }
  function startDir(requested, kind) {
    let cand = requested;
    if (!cand) { const s = readSettings(), last = kind === 'project' ? s.lastProject : s.lastScans; if (last) cand = path.dirname(last); }
    for (let i = 0; i < 40 && cand; i++) { if (isDir(cand)) return cand; const p = path.dirname(cand); if (p === cand) break; cand = p; }
    return '';
  }
  function readBody(req, max) {
    return new Promise((resolve, reject) => {
      const chunks = []; let total = 0;
      req.on('data', c => { total += c.length; if (total > max) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  }
  async function readJson(req) { const b = await readBody(req, 65536); if (!b.length) return null; try { return JSON.parse(b.toString('utf8')); } catch (e) { return null; } }

  function finishPick(res, kind, chosen) {
    const reg = registerRoot(chosen, kind);
    if (!reg) return err(res, 404, 'not-found', 'That folder does not exist.');
    const s = readSettings(); if (kind === 'project') s.lastProject = reg.root.path; else s.lastScans = reg.root.path; saveSettings(s);
    json(res, 200, rootJson(reg.id, reg.root));
  }
  // A project file chosen in the Save or Open window: its folder becomes a project folder; the answer names the file.
  function finishPickProject(res, full, save) {
    if (!full || !path.isAbsolute(full)) return err(res, 400, 'bad-path', 'Bad path.');
    full = path.resolve(full);
    let name = path.basename(full);
    if (save && !PROJECT_RE.test(name)) name += PROJECT_EXT;
    if (BAD_NAME.test(name)) return err(res, 400, 'bad-path', 'Bad file name.');
    if (!save && !PROJECT_RE.test(name) && name !== LEGACY_FILE) return err(res, 400, 'not-project', 'That is not a Book Compare project.');
    if (!save && !isFile(path.join(path.dirname(full), name))) return err(res, 404, 'not-found', 'That file does not exist.');
    const reg = registerRoot(path.dirname(full), 'project');
    if (!reg) return err(res, 404, 'not-found', 'That folder does not exist.');
    const s = readSettings(); s.lastProject = path.join(reg.root.path, name); saveSettings(s);
    json(res, 200, Object.assign(rootJson(reg.id, reg.root), { file: name }));
  }
  function finishPickFiles(res, folder, names) {
    const reg = registerRoot(folder, 'scans');
    if (!reg) return err(res, 404, 'not-found', 'That folder does not exist.');
    const ok = names.map(n => n.trim()).filter(n => n && n !== '.' && n !== '..' && !BAD_NAME.test(n) && isImage(n) && isFile(path.join(reg.root.path, n)));
    if (!ok.length) return err(res, 404, 'not-found', 'None of the chosen files is a picture that Book Compare can read.');
    const s = readSettings(); s.lastScans = path.join(reg.root.path, 'x'); saveSettings(s);     // next time the window opens IN this folder
    json(res, 200, Object.assign(rootJson(reg.id, reg.root), { files: ok }));
  }
  async function startPick(req, res) {
    const body = await readJson(req);
    const KINDS = ['project', 'files', 'save-project', 'open-project'];
    const kind = body && KINDS.includes(body.kind) ? body.kind : 'scans', isProj = kind === 'save-project' || kind === 'open-project';
    const start = startDir(body && body.start ? String(body.start) : '', kind === 'files' ? 'scans' : isProj ? 'project' : kind);
    const suggested = body && typeof body.name === 'string' && body.name.trim() && !BAD_NAME.test(body.name) ? body.name.trim() : 'Book project' + PROJECT_EXT;
    if (opts.testPickFile) {                                     // automatic tests: hand out the next line of the file (one folder per line; for pictures: folder|name|name)
      let lines = [];
      try { lines = fs.readFileSync(opts.testPickFile, 'utf8').split(/\r?\n/).filter(l => l.trim()); } catch (e) { /* none */ }
      if (!lines.length) return json(res, 200, { cancelled: true });
      const first = lines[0].trim();
      fs.writeFileSync(opts.testPickFile, lines.slice(1).join('\n') + (lines.length > 1 ? '\n' : ''));
      if (first === 'FAIL') return err(res, 501, 'no-dialog', 'test: no folder window');
      if (first === 'CANCEL') return json(res, 200, { cancelled: true });
      if (kind === 'files') { const p = first.split('|'); return finishPickFiles(res, p[0], p.slice(1)); }
      if (isProj) return finishPickProject(res, first, kind === 'save-project');
      return finishPick(res, kind, first);
    }
    if (!opts.pick) return err(res, 501, 'no-dialog', 'This computer cannot show a folder window.');
    if (pickOpen) return err(res, 409, 'busy', 'A folder window is already open.');
    const title = kind === 'project' ? 'Book Compare: choose the project folder (not one of your scan folders)'
      : kind === 'save-project' ? 'Book Compare: save the project (not in one of your scan folders)'
      : kind === 'open-project' ? 'Book Compare: open a project'
      : kind === 'files' ? 'Book Compare: choose one or several pictures (Ctrl- or Shift-click for several)' : 'Book Compare: choose the folder with the scans';
    pickOpen = true;
    let r;
    try { r = await opts.pick(kind, start, title, suggested); }
    catch (e) { log('folder window: ' + e.message); return err(res, 501, 'no-dialog', 'The folder window did not work.'); }
    finally { pickOpen = false; }
    if (!r) return json(res, 200, { cancelled: true });
    if (kind === 'files') return finishPickFiles(res, r.folder, r.files);
    if (isProj) return finishPickProject(res, r, kind === 'save-project');
    return finishPick(res, kind, r);
  }
  // A folder that holds pictures is never written to (safety for the scan folders).
  function holdsPictures(dir) {
    try { return fs.readdirSync(dir, { withFileTypes: true }).some(d => d.isFile() && isImage(d.name)); } catch (e) { return true; }
  }

  function apiAllowed(req) {
    const m = req.method;
    if (!['GET', 'HEAD', 'POST', 'PUT'].includes(m)) return 'method';
    const sfs = req.headers['sec-fetch-site'];
    if (sfs && sfs !== 'same-origin' && sfs !== 'none') return 'cross-site';             // another web site is asking: refused
    const origin = req.headers.origin;
    if (origin && !allowedOrigins.includes(origin.toLowerCase())) return 'cross-site';
    if ((m === 'POST' || m === 'PUT') && req.headers['x-bookcompare'] !== '1') return 'header';
    return null;
  }

  async function api(req, res, url) {
    const p = url.pathname, m = req.method;
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    const why = apiAllowed(req);
    if (why) return err(res, 403, 'refused', 'Refused (' + why + ').');
    if (p === '/api/ping') return json(res, 200, { app: 'BookCompare', api: 1, version: VERSION, desktop: true, os: IS_WIN ? 'windows' : 'other', dir: appRoot,
      pick: opts.testPickFile ? 'test' : (opts.pick ? 'dialog' : 'none'), autostart: false });
    if (p === '/api/quit') {
      if (m !== 'POST') return err(res, 405, 'method');
      json(res, 200, { ok: true });
      setTimeout(() => (opts.quit || (() => process.exit(0)))(), 50);
      return;
    }
    if (p === '/api/pick') { if (m !== 'POST') return err(res, 405, 'method'); return startPick(req, res); }
    if (p === '/api/pending') {                                  // a project file that was double-clicked (or dropped on the program's icon)
      if (m !== 'POST') return err(res, 405, 'method');
      const f = opts.takeOpen ? opts.takeOpen() : null;
      if (!f) return json(res, 200, { none: true });
      return finishPickProject(res, f, false);
    }
    if (p === '/api/register') {
      if (m !== 'POST') return err(res, 405, 'method');
      const b = await readJson(req), reg = b ? registerRoot(String(b.path || ''), b.kind === 'project' ? 'project' : 'scans') : null;
      if (!reg) return err(res, 404, 'not-found', 'That folder does not exist (or is not a full folder address).');
      return json(res, 200, rootJson(reg.id, reg.root));
    }
    // everything below works on a folder that was registered before
    const r = roots.get(url.searchParams.get('root') || '');
    if (!r) return err(res, 404, 'unknown-root', 'This folder is not known (Book Compare was restarted?).');
    const rel = url.searchParams.get('path') || '', full = resolveInRoot(r, rel);
    if (!full) return err(res, 400, 'bad-path', 'Bad path.');
    const part = r.kind === 'project' ? projectPart(rel) : null;

    if (p === '/api/list') {
      if (r.kind !== 'scans' && part !== 'results') return err(res, 403, 'refused', 'Not a scan folder.');
      if (!isDir(full)) return err(res, 404, 'not-found', 'Folder not found.');
      const entries = [];
      for (const d of fs.readdirSync(full, { withFileTypes: true })) {
        try {
          if (d.isDirectory()) entries.push({ n: d.name, d: true });
          else if (part === 'results' || isImage(d.name)) { const st = fs.statSync(path.join(full, d.name)); if (st.isFile()) entries.push({ n: d.name, d: false, s: st.size, m: Math.round(st.mtimeMs) }); }
        } catch (e) { /* unreadable entry: skipped */ }
      }
      return json(res, 200, { entries });
    }
    if (p === '/api/stat') {
      if (r.kind === 'project' && !part) return err(res, 403, 'refused', 'Not allowed.');
      let st = null; try { st = fs.statSync(full); } catch (e) { /* missing */ }
      if (st && st.isDirectory()) return json(res, 200, { exists: true, dir: true });
      if (st && st.isFile() && (r.kind === 'project' || isImage(full))) return json(res, 200, { exists: true, dir: false, size: st.size, mtime: Math.round(st.mtimeMs) });
      return err(res, 404, 'not-found', 'Not found.');
    }
    if (p === '/api/file') {
      if (m !== 'GET' && m !== 'HEAD') return err(res, 405, 'method');
      if (r.kind === 'project') { if (!part || part === 'root') return err(res, 403, 'refused', 'Not allowed.'); }
      else if (!isImage(full)) return err(res, 403, 'refused', 'Only pictures can be read.');
      let st; try { st = fs.statSync(full); } catch (e) { st = null; }
      if (!st || !st.isFile()) return err(res, 404, 'not-found', 'File not found.');
      const head = { 'Content-Type': TYPES[path.extname(full).toLowerCase()] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'no-store', 'X-Mtime-Ms': String(Math.round(st.mtimeMs)) };
      if (m === 'HEAD') { res.writeHead(200, head); return res.end(); }
      // the file is opened BEFORE the answer starts: if another program holds it, the page gets a clear "busy" answer
      let fd;
      try { fd = fs.openSync(full, 'r'); } catch (e) { log('file busy: ' + path.basename(full) + ': ' + e.message); return err(res, 423, 'busy', 'Another program is using this file right now.'); }
      res.writeHead(200, head);
      const s = fs.createReadStream(null, { fd, highWaterMark: 1 << 20 });
      s.on('error', e => { log('file interrupted: ' + e.message); res.destroy(); });
      s.pipe(res);
      return;
    }
    if (p === '/api/write') {                                    // the ONLY things this program writes: the project file and its results folder
      if (m !== 'PUT') return err(res, 405, 'method');
      if (r.kind !== 'project' || (part !== 'file' && part !== 'results') || rel.replace(/^\/+|\/+$/g, '').split('/').length < (part === 'results' ? 2 : 1))
        return err(res, 403, 'refused', 'Only the project file and its results can be written.');
      let bytes; try { bytes = await readBody(req, 256 * 1024 * 1024); } catch (e) { return err(res, 413, 'too-large', 'Too large.'); }
      if (!isDir(r.path)) return err(res, 404, 'not-found', 'The project folder does not exist.');
      if (holdsPictures(r.path)) return err(res, 403, 'scan-folder', 'This folder holds pictures, so Book Compare does not save anything in it. Save the project in another folder.');
      if (part === 'results') { try { fs.mkdirSync(path.dirname(full), { recursive: true }); } catch (e) { return err(res, 500, 'mkdir', 'The results folder could not be made.'); } }
      if (isDir(full)) return err(res, 409, 'is-folder', 'There is a folder of that name.');
      const tmp = full + '.tmp';
      fs.writeFileSync(tmp, bytes);
      for (let i = 0; ; i++) {                                    // replaces the old file in one step (retried: Dropbox or a virus scanner may hold it a moment)
        try { fs.renameSync(tmp, full); break; }
        catch (e) { if (i >= 20) { log('write: ' + e.message); return err(res, 423, 'busy', 'Another program is using the project file right now.'); } await new Promise(r => setTimeout(r, 100)); }
      }
      return json(res, 200, { ok: true });
    }
    return err(res, 404, 'not-found', 'Unknown request.');
  }

  function stat(req, res, url) {
    res.setHeader('Cache-Control', 'no-cache');
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'text/plain; charset=utf-8', 'Method not allowed');
    let rel;
    try { rel = decodeURIComponent(url.pathname).replace(/^\/+/, ''); } catch (e) { return send(res, 400, 'text/plain; charset=utf-8', 'Bad request'); }
    let full = path.resolve(appDir, rel);
    if (!(full + path.sep).toLowerCase().startsWith(appRoot.toLowerCase())) return send(res, 403, 'text/plain; charset=utf-8', 'Forbidden');
    if (isDir(full)) full = path.join(full, 'index.html');
    if (!isFile(full)) return send(res, 404, 'text/plain; charset=utf-8', 'Not found');
    const b = fs.readFileSync(full);
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(full).toLowerCase()] || 'application/octet-stream', 'Content-Length': b.length });
    res.end(req.method === 'GET' ? b : undefined);
  }

  const server = http.createServer((req, res) => {
    res.setHeader('X-Served-By', 'BookCompareDesktop');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const host = (req.headers.host || '').toLowerCase();
    if (!allowedHosts.includes(host)) return send(res, 403, 'text/plain; charset=utf-8', 'Forbidden (wrong host name)');
    let url;
    try { url = new URL(req.url, 'http://' + host); } catch (e) { return send(res, 400, 'text/plain; charset=utf-8', 'Bad request'); }
    const done = url.pathname.startsWith('/api/') ? api(req, res, url) : stat(req, res, url);
    Promise.resolve(done).catch(e => { log('request: ' + e.message); try { if (!res.headersSent) err(res, 500, 'error', 'Something went wrong.'); else res.destroy(); } catch (x) { /* closed */ } });
  });
  return {
    listen() { return new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => resolve()); }); },
    close() { return new Promise(resolve => server.close(() => resolve())); }
  };
}

module.exports = { createServer, projectPart, VERSION };

if (require.main === module) {                                   // started on its own (automatic tests)
  const a = process.argv.slice(2), arg = (n, d) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : d; };
  const s = createServer({ port: +arg('--port', 8790), appDir: arg('--app-dir', path.join(__dirname, '..', 'app')), dataDir: arg('--data-dir', path.join(require('os').tmpdir(), 'bookcompare-test')),
    testPickFile: arg('--test-pick-file', ''), log: t => process.stderr.write(t + '\n'), quit: () => process.exit(0),
    takeOpen: () => { const i = a.indexOf('--open'); if (i < 0) return null; const f = a[i + 1]; a.splice(i, 2); return f || null; } });   // --open <file>: as if it had been double-clicked
  s.listen().then(() => process.stderr.write('Book Compare server ready\n'), e => { process.stderr.write('could not start: ' + e.message + '\n'); process.exit(1); });
}
