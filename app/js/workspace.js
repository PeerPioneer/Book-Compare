/* Book Compare - whole-book workspace.

   A full-screen layer on top of the app. Columns = copies, rows = page positions. Each copy is a folder of scans on your
   disk. The scans stay where they are: this code only READS them (it never writes, renames or deletes anything in a scan folder).
   The project (which file sits in which row, row names, ...) is saved as one small file, <name>.bookcompare, which never lies in a
   folder that holds scans of the project. (Before 0.9.0 a project was a folder holding book-compare-project.json: those still open.)

   Scan folders are remembered as "roots": a folder you pick once (for example the folder that holds all copies of a book).
   A copy points into a root. After a project is reopened the browser only has to be asked about the roots (one click),
   not about every single copy.

   Pages are placed in file-name order and then corrected by hand (automatic page matching is a later step).
   A chosen pair of pages is handed to the Compare tab (js/compare-tab.js), which aligns it and lets you go through the book page by page;
   its PAGES tab (or Back) returns to this layer.

   Three ways to reach the scan folders:
   - Desktop program ("helper mode" in the code): the program itself (desktop/server.js) reads the scan folders and writes the
     project file. Folders are remembered as plain addresses, so nothing has to be allowed again after a restart.
   - On the website, Edge/Chrome use the File System Access API (folder picker, remembered folders, automatic saving).
   - Other browsers fall back to a plain folder upload (kept in memory only) and a downloaded project file. */
(function () {
  'use strict';

  var HAS_FSA = typeof window.showDirectoryPicker === 'function';
  var IMG_RE = /\.(jpe?g|png)$/i;
  var OTHER_IMG_RE = /\.(tiff?|webp|bmp|gif)$/i;
  // A project is ONE file, <name>.bookcompare (from 0.9.0). Projects of older versions were a folder holding book-compare-project.json:
  // they still open, and "Save project as" turns them into a project file (the old folder is left as it is).
  var LEGACY_FILE = 'book-compare-project.json', PROJECT_EXT = '.bookcompare';
  var ROW_H = 40, COL_W = 172, LBL_W = 96, HEAD_H = 74, OVERSCAN = 4;

  var root = null;
  var S = null;                      // project state
  var REG = {};                      // every copy object of this session by id (so undo can bring a removed copy back)
  var hist = { undo: [], redo: [] };
  // proj.target: where the project is saved: { dir, file } (desktop program: the folder of the file and its name) or { fh } (browser: the file)
  // proj.legacy: a project of an older version that was opened (it is not saved automatically until it is saved as a project file)
  var proj = { target: null, pack: null, carry: null, legacy: null, state: 'none', name: '', err: '', timer: 0, saving: false, again: false };
  var dirty = false;                 // changes not yet written to the project file
  var lastProject = null;            // remembered project { target, name, projectId }
  var cb = { compare: null, leave: null };

  /* ---------------------------------------------------------------- small helpers */
  function $(s) { return root.querySelector(s); }
  function esc(t) { return String(t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function nat(a, b) { return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }); }
  function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }
  function baseName(key) { var i = key.lastIndexOf('/'); return i < 0 ? key : key.slice(i + 1); }
  function niceError(e) {
    var n = e && e.name, m = e && e.message ? e.message : String(e);
    if (n === 'NotAllowedError' || n === 'SecurityError') return 'The browser did not allow access to that folder or file.';
    if (n === 'NotFoundError') return 'A file or folder was not found. It may have been moved or renamed.';
    if (e && e.busy) return 'Another program is using this file right now.';
    if (n === 'TypeError' || /Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Book Compare lost the connection to your scan folders.';
    return m;
  }
  function refusal(msg) { var e = new Error(msg); e.name = 'Refused'; return e; }
  // A key names a picture inside a copy: "name.jpg" lives in the copy's first folder, "@2/name.jpg" in its third (see c.locs).
  function splitKey(k) {
    if (k.charAt(0) === '@') { var i = k.indexOf('/'); return { n: parseInt(k.slice(1, i), 10) || 0, rel: k.slice(i + 1) }; }
    return { n: 0, rel: k };
  }
  function joinKey(n, rel) { return n === 0 ? rel : '@' + n + '/' + rel; }
  function joinPath(a, b) { return a && b ? a + '/' + b : (a || b || ''); }

  /* ---------------------------------------------------------------- small database in the browser (remembers folders and thumbnails) */
  var idbP = null;
  function idb() {
    if (!idbP) {
      idbP = new Promise(function (res, rej) {
        try {
          var r = indexedDB.open('book-compare', 1);
          r.onupgradeneeded = function () { var d = r.result; d.createObjectStore('handles'); d.createObjectStore('thumbs'); d.createObjectStore('meta'); };
          r.onsuccess = function () { res(r.result); };
          r.onerror = function () { rej(r.error); };
        } catch (e) { rej(e); }
      });
    }
    return idbP;
  }
  function idbGet(store, key) {
    return idb().then(function (d) {
      return new Promise(function (res, rej) {
        var q = d.transaction(store).objectStore(store).get(key);
        q.onsuccess = function () { res(q.result); };
        q.onerror = function () { rej(q.error); };
      });
    }).catch(function () { return undefined; });
  }
  function idbPut(store, key, val) {
    return idb().then(function (d) {
      return new Promise(function (res, rej) {
        var tx = d.transaction(store, 'readwrite');
        tx.objectStore(store).put(val, key);
        tx.oncomplete = function () { res(true); };
        tx.onerror = function () { rej(tx.error); };
      });
    }).catch(function () { return false; });
  }


  /* ---------------------------------------------------------------- website or desktop program (21 Nov 2026) */
  // The same pages run on the website and inside the desktop program. The desktop program adds "BookCompareDesktop/<version>" to the
  // name its browser engine reports (desktop/main.js), so the page can tell where it runs: the website shows where to download the
  // program (the start screen in index.html, and the More menu here); the program itself does not, but says when a newer version is
  // on the download page.
  var DESKTOP = (/BookCompareDesktop\/([0-9][0-9.]*)/.exec(navigator.userAgent) || [])[1] || null;   // the version of the desktop program, or null
  var RELEASES = 'https://github.com/PeerPioneer/Book-Compare/releases/latest';                   // always the newest installer
  var RELEASES_API = 'https://api.github.com/repos/PeerPioneer/Book-Compare/releases/latest';
  function openDownloadPage() { window.open(RELEASES, '_blank', 'noopener'); }
  // "1.10.0" > "1.9.2"
  function newerVersion(a, b) {
    var x = String(a).replace(/^v/i, '').split('.').map(Number), y = String(b).replace(/^v/i, '').split('.').map(Number);
    for (var i = 0; i < Math.max(x.length, y.length); i++) { var p = x[i] || 0, q = y[i] || 0; if (p !== q) return p > q; }
    return false;
  }
  // Desktop program only (0.12.0, the notice did not show in 0.10.0/0.11.0: it lived in the Pages view only and the newest version
  // was looked up at most once a day): at every start, a few seconds in, the program asks for the newest version, first the
  // updater itself (the same latest.yml that "Update now" uses), else GitHub. A newer one is announced by a card in the bottom right
  // corner, on every screen (start screen, Pages, Compare). "Later" hides it until the next day; the menu (⋮ → Check for updates)
  // and "About Book Compare" always show the state and can start the update.
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* no storage */ } }
  var updInfo = { state: 'unknown', latest: null };          // state: unknown | checking | newer | newest | failed
  async function lookForUpdate() {
    if (!DESKTOP) return updInfo;
    updInfo.state = 'checking';
    var latest = null;
    try { await helperReady; if (HELPER) { var st = await hjson('/api/update', { cmd: 'check' }); if (st && (st.state === 'available' || st.state === 'downloading' || st.state === 'ready') && st.version) latest = st.version; else if (st && st.state === 'none') latest = DESKTOP; } } catch (e) { /* ask GitHub */ }
    if (!latest && window.fetch) {
      try {
        var r = await fetch(RELEASES_API, { cache: 'no-store', headers: { Accept: 'application/vnd.github+json' } });
        if (r.ok) { var j = await r.json(); if (j && j.tag_name) latest = String(j.tag_name).replace(/^v/i, ''); }
      } catch (e) { /* offline */ }
    }
    if (!latest) latest = lsGet('bc_latest_version');                       // (the last answer, when offline)
    else lsSet('bc_latest_version', latest);
    updInfo.latest = latest;
    updInfo.state = !latest ? 'failed' : newerVersion(latest, DESKTOP) ? 'newer' : 'newest';
    return updInfo;
  }
  function updCard() {
    var c = document.getElementById('bc-update');
    if (!c) {
      c = document.createElement('div'); c.id = 'bc-update'; c.className = 'bc-update'; c.setAttribute('role', 'status'); c.hidden = true;
      document.body.appendChild(c);
      c.addEventListener('click', function (e) {
        var t = e.target.closest('[data-act]'); if (!t) return;
        var a = t.dataset.act;
        if (a === 'upd-dl') { hideUpdate(); openDownloadPage(); } else if (a === 'upd-now') updateNow(); else if (a === 'upd-install') installUpdate(); else if (a === 'upd-later') hideUpdate(); else if (a === 'upd-close') c.hidden = true;
      });
    }
    return c;
  }
  function showUpdateCard(force) {
    if (updInfo.state !== 'newer') return false;
    if (!force && Date.now() - (+lsGet('bc_update_shown') || 0) < 20 * 3600 * 1000) return false;      // "Later": not again today
    var c = updCard();
    c.innerHTML = '<p><b>Book Compare ' + esc(updInfo.latest) + ' is available.</b> You have ' + esc(DESKTOP) + '. The update is downloaded and installed by Book Compare itself; your projects stay as they are.</p>' +
      '<div class="acts"><button class="bc-ub pri" data-act="upd-now">Update now</button><button class="bc-ub" data-act="upd-dl">What is new</button><button class="bc-ub" data-act="upd-later">Later</button></div>';
    c.hidden = false;
    return true;
  }
  async function checkForUpdate() {
    if (!DESKTOP) return;
    await lookForUpdate();
    showUpdateCard(false);
  }
  // ⋮ → Check for updates (and the button in About)
  async function checkUpdatesNow() {
    if (!DESKTOP) return;
    var say = function (msg) {                                                   // (on the start screen there is no toast: the card says it)
      if (root) return toast(msg);
      var c = updCard(); c.innerHTML = '<p>' + esc(msg) + '</p><div class="acts"><button class="bc-ub" data-act="upd-close">OK</button></div>'; c.hidden = false;
      clearTimeout(c.t); c.t = setTimeout(function () { if (c.querySelector('[data-act=upd-close]')) c.hidden = true; }, 6000);
    };
    say('Looking for a new version …');
    await lookForUpdate();
    if (updInfo.state === 'newer') showUpdateCard(true);
    else if (updInfo.state === 'newest') say('You have the newest version of Book Compare (' + DESKTOP + ').');
    else say('Book Compare could not find out which version is the newest (no internet connection?).');
  }
  function hideUpdate() { var c = document.getElementById('bc-update'); if (c) c.hidden = true; lsSet('bc_update_shown', String(Date.now())); }
  // One-click update (item 35, desktop program): download the new version, then close, install it and start again (desktop/main.js)
  async function updateNow() {
    var b = updCard(), call = function (cmd) { return hjson('/api/update', { cmd: cmd }); }, st;
    var show = function (html) { b.innerHTML = html; b.hidden = false; };
    var fallback = function (why) {
      show('<p>The new version could not be downloaded here' + (why ? ' (' + esc(why) + ')' : '') + '. Please download it from the Releases page.</p><div class="acts"><button class="bc-ub pri" data-act="upd-dl">Go to the download page</button><button class="bc-ub" data-act="upd-later">Later</button></div>');
    };
    show('<p>Looking for the new version …</p>');
    try { st = await call('check'); } catch (e) { return fallback(niceError(e)); }
    if (st.state !== 'available' && st.state !== 'downloading' && st.state !== 'ready') return fallback(st.error || '');
    if (st.state === 'available') { try { st = await call('download'); } catch (e) { return fallback(niceError(e)); } }
    while (st.state === 'downloading') {
      show('<p>Downloading Book Compare ' + esc(st.version || '') + ' … ' + (st.percent || 0) + ' %</p><span class="bc-ubar"><i style="width:' + (st.percent || 0) + '%"></i></span>');
      await new Promise(function (r) { setTimeout(r, 700); });
      try { st = await call('state'); } catch (e) { return fallback(niceError(e)); }
    }
    if (st.state !== 'ready') return fallback(st.error || '');
    show('<p><b>Book Compare ' + esc(st.version || '') + ' is ready.</b> Book Compare closes, installs it and starts again (Windows may ask once whether it may run).</p>' +
      '<div class="acts"><button class="bc-ub pri" data-act="upd-install">Install and restart</button><button class="bc-ub" data-act="upd-later">Later</button></div>');
  }
  async function installUpdate() {
    var r = (S && root) ? await beforeClose() : { ok: true };                               // the project is saved first
    if (!r.ok) {
      var go = await confirmDialog('The project is not saved', 'The project has changes that are not saved in a project file. Install the new version anyway? The changes are lost.', 'Install anyway');
      if (!go) return;
    }
    try { await hjson('/api/update', { cmd: 'install' }); } catch (e) { toast(niceError(e)); }
  }
  if (DESKTOP) setTimeout(function () { checkForUpdate().catch(function () { }); }, 3000);     // at every start, on the start screen already

  /* ---------------------------------------------------------------- desktop mode (folders read by the desktop program itself, see desktop/server.js) */
  // (Called "helper" in the code for historical reasons: until 21 Nov 2026 a separate helper program, launcher/serve.ps1, did this
  // for the browser; the desktop program gives the same answers. On the website there is no such reader: detectHelper() finds nothing.)
  // HDir / HFile imitate the folder and file objects of the browser's File System Access API, so the rest of this file does not
  // care where a folder comes from. A folder is a root (registered with the helper under a random id) plus a path inside it.
  var HELPER = null;                 // the helper's answer to /api/ping, or null when there is no helper
  var helperStart = { scans: null, project: null, files: null };
  var helperReady = detectHelper();
  async function detectHelper() {
    if (!/^https?:$/.test(location.protocol) || !window.fetch) return false;
    try {
      var ctl = window.AbortController ? new AbortController() : null, t = ctl ? setTimeout(function () { ctl.abort(); }, 2500) : 0;
      var r = await fetch('api/ping', { cache: 'no-store', signal: ctl ? ctl.signal : undefined });
      if (t) clearTimeout(t);
      if (!r.ok) return false;
      var j = await r.json();
      if (!j || j.app !== 'BookCompare') return false;
      HELPER = j; HAS_FSA = true;
      return true;
    } catch (e) { return false; }
  }
  function helperError(status, j) {
    var code = j && j.error, e = new Error((j && j.message) || 'Book Compare refused the request.');
    e.code = code; e.busy = (code === 'busy');
    e.name = status === 404 ? 'NotFoundError' : status === 403 ? 'NotAllowedError' : 'Error';
    return e;
  }
  function helperLost() { var e = new Error('Book Compare cannot read the scan folders right now. Please close Book Compare and open it again.'); e.name = 'Lost'; e.net = true; return e; }
  async function hrequest(method, url, body, headers) {
    var resp;
    try { resp = await fetch(url, { method: method, headers: Object.assign({ 'X-BookCompare': '1' }, headers || {}), body: body, cache: 'no-store' }); }
    catch (e) { throw helperLost(); }
    return resp;
  }
  async function hjson(url, obj) {
    var resp = await hrequest('POST', url, JSON.stringify(obj || {}));
    var j = null; try { j = await resp.json(); } catch (e) { j = null; }
    if (!resp.ok) throw helperError(resp.status, j);
    return j;
  }
  // a request about a folder that was registered before; if the helper was restarted meanwhile, the folder is registered again
  async function hcall(ref, method, endpoint, rel, body, query, headers) {
    for (var attempt = 0; attempt < 2; attempt++) {
      var resp = await hrequest(method, endpoint + '?root=' + encodeURIComponent(ref.id) + '&path=' + encodeURIComponent(rel) + (query || ''), body, headers);
      if (resp.ok) return resp;
      var j = null; try { j = await resp.json(); } catch (e) { j = null; }
      if (j && j.error === 'unknown-root' && attempt === 0) { var again = await hjson('/api/register', { path: ref.path, kind: ref.kind }); ref.id = again.id; continue; }
      throw helperError(resp.status, j);
    }
  }
  function slashPath(p) { return String(p).replace(/\\/g, '/'); }
  function hsegs(h) {
    var base = slashPath(h.ref.path).split('/').filter(function (x) { return x; });
    return h.rel ? base.concat(h.rel.split('/')) : base;
  }
  function hsame(a, b) { return HELPER && HELPER.os === 'windows' ? a.toLowerCase() === b.toLowerCase() : a === b; }
  function HDir(ref, rel, name) { this.kind = 'directory'; this.isHelper = true; this.ref = ref; this.rel = rel; this.name = name; }
  Object.defineProperty(HDir.prototype, 'rootPath', { get: function () { return this.ref.path; } });
  HDir.prototype.removeEntry = function (name) { return hcall(this.ref, 'POST', '/api/remove', joinPath(this.rel, name)).then(function () { }); };
  HDir.prototype.dir_remove = HDir.prototype.removeEntry;   // (stored alignments only, item 28)
  HDir.prototype._stat = function (rel) { return hcall(this.ref, 'GET', '/api/stat', joinPath(this.rel, rel)).then(function (r) { return r.json(); }); };
  HDir.prototype.getDirectoryHandle = async function (name) {
    var st = await this._stat(name);
    if (!st.dir) { var e = new Error('Not a folder: ' + name); e.name = 'TypeMismatchError'; throw e; }
    return new HDir(this.ref, joinPath(this.rel, name), name);
  };
  HDir.prototype.getFileHandle = async function (name, opts) {
    var f = new HFile(this, name);
    if (opts && opts.create) return f;
    var st = await this._stat(name);
    if (st.dir) { var e = new Error('Not a file: ' + name); e.name = 'TypeMismatchError'; throw e; }
    f._info = st;
    return f;
  };
  HDir.prototype.entries = function () {
    var self = this, list = null, i = 0, it = {};
    it[Symbol.asyncIterator] = function () { return it; };
    it.next = async function () {
      if (!list) {
        var j = await (await hcall(self.ref, 'GET', '/api/list', self.rel)).json();
        list = j.entries.map(function (e) {
          if (e.d) return [e.n, new HDir(self.ref, joinPath(self.rel, e.n), e.n)];
          var f = new HFile(self, e.n); f._info = { size: e.s, mtime: e.m }; return [e.n, f];
        });
      }
      if (i >= list.length) return { done: true, value: undefined };
      return { done: false, value: list[i++] };
    };
    return it;
  };
  HDir.prototype.isSameEntry = async function (o) {
    if (!o || !o.isHelper) return false;
    var a = hsegs(this), b = hsegs(o);
    return a.length === b.length && a.every(function (x, k) { return hsame(x, b[k]); });
  };
  // the path of folder o inside this folder (as a list of names), [] if it is this folder, null if it lies elsewhere
  HDir.prototype.resolve = async function (o) {
    if (!o || !o.isHelper) return null;
    var a = hsegs(this), b = hsegs(o);
    if (b.length < a.length) return null;
    for (var k = 0; k < a.length; k++) if (!hsame(a[k], b[k])) return null;
    return b.slice(a.length);
  };
  HDir.prototype.queryPermission = async function () { try { await this._stat(''); return 'granted'; } catch (e) { return 'denied'; } };
  HDir.prototype.requestPermission = async function () { await this._stat(''); return 'granted'; };
  function HFile(dir, name) { this.kind = 'file'; this.isHelper = true; this.dir = dir; this.name = name; this._info = null; }
  // A picture can fail for a moment: another program (Dropbox, a virus scanner) has the file open, or the connection breaks while it is sent.
  // That is tried again twice, a little later, before it is reported.
  HFile.prototype.getFile = async function () {
    var waits = [0, 450, 1300], last = null;
    for (var k = 0; k < waits.length; k++) {
      if (waits[k]) await new Promise(function (r) { setTimeout(r, waits[k]); });
      try {
        var resp = await hcall(this.dir.ref, 'GET', '/api/file', joinPath(this.dir.rel, this.name));
        var blob = await resp.blob();                                    // rejects with a TypeError when the connection broke in the middle
        var m = parseInt(resp.headers.get('X-Mtime-Ms'), 10) || (this._info && this._info.mtime) || Date.now();
        var file = new File([blob], this.name, { type: blob.type, lastModified: m });
        if (this._info && this._info.fp && this._info.size === file.size) file.fp = this._info.fp;      // (computed by the helper already, item 29)
        return file;
      } catch (e) {
        if (e && e.name === 'TypeError') { var broken = new Error('The connection was interrupted while the picture was being read.'); broken.net = true; e = broken; }
        last = e;
        if (!(e && (e.net || e.busy))) throw e;
      }
    }
    throw last;
  };
  HFile.prototype.createWritable = async function () {
    var self = this, parts = [];
    return {
      write: async function (d) { parts.push(d); },
      close: async function () { await hcall(self.dir.ref, 'PUT', '/api/write', joinPath(self.dir.rel, self.name), new Blob(parts, { type: 'application/octet-stream' })); }
    };
  };
  async function helperRegister(path, kind) {
    var j = await hjson('/api/register', { path: path, kind: kind });
    return new HDir({ id: j.id, path: j.path, kind: j.kind }, '', j.name);
  }
  // the Windows folder window, opened by the helper. If it cannot be shown, the folder address can be pasted instead.
  async function helperPick(kind) {
    var j;
    try { j = await hjson('/api/pick', { kind: kind, start: helperStart[kind] || null }); }
    catch (e) {
      if (e && e.code !== 'no-dialog') throw e;
      var typed = window.prompt('Book Compare could not open the Windows folder window.\nPaste the address of the folder here (in Explorer: click the address bar, copy, paste):', '');
      if (!typed || !typed.trim()) { var ab = new Error('cancelled'); ab.name = 'AbortError'; throw ab; }
      return helperRegister(typed.trim().replace(/^"|"$/g, ''), kind);
    }
    if (j.cancelled) { var ab2 = new Error('cancelled'); ab2.name = 'AbortError'; throw ab2; }
    return new HDir({ id: j.id, path: j.path, kind: j.kind }, '', j.name);
  }

  /* ---------------------------------------------------------------- state */
  // the example in the empty name field (N2): a famous book of the 16th century, with printer, place and year of one edition
  var TITLE_EXAMPLE = 'De humani corporis fabrica · Oporinus, Basel 1543';
  // Folder addresses relative to the project file's folder (item 30). Windows addresses (C:\\…) are compared without regard to case;
  // two different drives have no relative address (null).
  function pathSegs(p) { var x = String(p).replace(/\\/g, '/').replace(/\/+$/, ''); return x.split('/'); }
  function relPath(from, to) {
    var a = pathSegs(from), b = pathSegs(to), win = /^[a-z]:$/i.test(a[0]) || /^[a-z]:$/i.test(b[0]);
    var same = function (x, y) { return win ? x.toLowerCase() === y.toLowerCase() : x === y; };
    if (!a.length || !b.length || !same(a[0], b[0])) return null;
    var k = 0; while (k < a.length && k < b.length && same(a[k], b[k])) k++;
    var up = []; for (var i = k; i < a.length; i++) up.push('..');
    return up.concat(b.slice(k)).join('/');
  }
  function joinRelPath(base, rel) {
    var win = /^[a-z]:/i.test(base) || /\\/.test(base), out = pathSegs(base);
    String(rel).split('/').forEach(function (s) { if (!s || s === '.') return; if (s === '..') { if (out.length > 1) out.pop(); } else out.push(s); });
    return out.join(win ? '\\' : '/') || null;
  }
  function blank() {
    return { title: '', lblw: 0, projectId: uid(), roots: [], copies: [], labels: {}, ns: 0, skip: {}, flags: {}, annots: {}, tiles: {}, boxes: {}, paper: {}, thumbs: false, nextAnn: 1, folio: true, nextCopy: 1, sel: { ci: null, row: 0 }, pair: [null, null], ref: null };
  }
  function rows() { var m = 0; S.copies.forEach(function (c) { if (c.cells.length > m) m = c.cells.length; }); return m; }
  function trim(c) { while (c.cells.length && c.cells[c.cells.length - 1] === null) c.cells.pop(); }
  function copyById(id) { for (var i = 0; i < S.copies.length; i++) if (S.copies[i].id === id) return S.copies[i]; return null; }
  // Column widths: every copy has its own width (c.w, in pixels; empty = standard). Drag the right edge of a heading to change it.
  var MIN_W = 80, MAX_W = 700;
  function limitW(w) { return Math.min(MAX_W, Math.max(MIN_W, Math.round(+w) || MIN_W)); }
  function clampW(w) { w = Math.round(+w); return isFinite(w) && w > 0 ? limitW(w) : 0; }                    // from a project file: 0 = standard width
  function cw(c) { return c.w || COL_W; }
  function lblW() { return S && S.lblw ? S.lblw : LBL_W; }          // the first column (row names): its width can be changed too (N6)
  function gridW() { var w = lblW() + COL_W; S.copies.forEach(function (c) { w += cw(c); }); return w; }
  function colLeft(ci) { var x = lblW(); for (var i = 0; i < ci; i++) x += cw(S.copies[i]); return x; }
  // A range of rows marked with Shift in ONE column (not saved with the project): from the row where Shift began to the active row S.sel.row.
  var anchor = null;
  function range() {
    var s = S.sel;
    if (!anchor || s.ci == null || anchor.ci !== s.ci || anchor.row === s.row || !S.copies[s.ci]) return null;
    return { ci: s.ci, lo: Math.min(anchor.row, s.row), hi: Math.max(anchor.row, s.row) };
  }
  function rowLabel(i) {
    if (S.labels[i] != null) return S.labels[i];
    var j = i - S.ns;
    if (j < 0) return 'Front ' + (i + 1);
    if (S.folio) return (Math.floor(j / 2) + 1) + (j % 2 === 0 ? 'r' : 'v');
    return 'Page ' + (j + 1);
  }
  // Flags: a colour mark on a row (a position in the book), the same in every pairing. Six colours; 0 is the standard one.
  var FLAG_COLORS = ['#ef476f', '#f78c6b', '#ffd166', '#06d6a0', '#118ab2', '#073b4c'];
  var FLAG_NAMES = ['pink-red', 'coral', 'yellow', 'green', 'blue', 'dark teal'];
  var FLAG_PATH = 'M14.4 6 14 4H5v17h2v-7h5.6l.4 2h7V6z';
  function cleanFlags(f) {                                            // from a project file: only row numbers with a colour 0-5
    var out = {};
    if (f && typeof f === 'object') Object.keys(f).forEach(function (k) { var v = f[k]; if (/^\d+$/.test(k) && typeof v === 'number' && v >= 0 && v < FLAG_COLORS.length && v === Math.floor(v)) out[k] = v; });
    return out;
  }
  // Annotations: circle, rectangle or text note on a row (a position in the book), in the same six colours. They are drawn on the superimposed
  // picture, whose size is that of the page of copy 1, so the position is stored as a FRACTION of the picture (0-1 across and down): it does not
  // depend on zoom or on the scan resolution. "pair" remembers the two copies the annotation was drawn with (its position is exact for that pair).
  var ANN_TYPES = ['ellipse', 'rect', 'note'];
  function num(v, lo, hi) { v = +v; return isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo; }
  function cleanAnn(a, id) {
    if (!a || ANN_TYPES.indexOf(a.t) < 0) return null;
    var note = a.t === 'note';
    var col = typeof a.col === 'number' && a.col >= 0 && a.col < FLAG_COLORS.length && a.col === Math.floor(a.col) ? a.col : 0;
    var pr = Array.isArray(a.pair) ? a.pair.slice(0, 2).map(function (x) { return typeof x === 'number' && isFinite(x) ? x : null; }) : [null, null];
    while (pr.length < 2) pr.push(null);
    return { id: id, t: a.t, x: num(a.x, 0, 1), y: num(a.y, 0, 1), w: note ? 0 : num(a.w, 0, 1), h: note ? 0 : num(a.h, 0, 1), col: col, text: typeof a.text === 'string' ? a.text.slice(0, 2000) : '', pair: pr };
  }
  function cleanAnnots(f) {                                           // from a project file: only real rows, known shapes, numbers in range
    var out = {}, seen = {};
    if (f && typeof f === 'object') Object.keys(f).forEach(function (k) {
      if (!/^\d+$/.test(k) || !Array.isArray(f[k])) return;
      var list = [];
      f[k].slice(0, 200).forEach(function (a) {
        var id = a && typeof a.id === 'number' && a.id >= 1 && a.id === Math.floor(a.id) && !seen[a.id] ? a.id : 0;
        if (!id) { id = 1; while (seen[id]) id++; }                  // a missing or repeated number: take a free one
        var c = cleanAnn(a, id); if (c) { seen[id] = true; list.push(c); }
      });
      if (list.length) out[k] = list;
    });
    return out;
  }
  // tile settings (V15): main tiles 4-16, sub-tiles 1-4; anything else is dropped
  function cleanTile(t) { var m = Math.round(+t.main), u = Math.round(+t.sub); return (m >= 4 && m <= 16 && u >= 1 && u <= 4) ? { main: m, sub: u } : null; }
  function cleanTiles(o) { var out = {}; if (o && typeof o === 'object') Object.keys(o).forEach(function (k) { var c = /^[\w-]+\|\d+$/.test(k) && cleanTile(o[k] || {}); if (c) out[k] = c; }); return out; }
  // V2b: the printed area set by hand, per scan ("copy id|file key"): four corners as fractions, clockwise from the top left
  function cleanQuad(q) {
    if (!Array.isArray(q) || q.length !== 8) return null;
    var v = q.map(function (x) { return Math.round(Math.min(1, Math.max(0, +x)) * 10000) / 10000; });
    if (v.some(function (x) { return !isFinite(x); })) return null;
    var a = 0; for (var i = 0; i < 4; i++) { var j = (i + 1) % 4; a += v[2 * i] * v[2 * j + 1] - v[2 * j] * v[2 * i + 1]; }
    return Math.abs(a) / 2 > 0.02 ? v : null;
  }
  function cleanBoxes(o) { var out = {}; if (o && typeof o === 'object') Object.keys(o).forEach(function (k) { var q = /^\d+\|.+$/.test(k) && cleanQuad(o[k]); if (q) out[k] = q; }); return out; }
  // 0.11.0: "whiter paper" per copy (display only: 1 = whiter, 2 = whitest), keyed by copy id
  function cleanPaper(o) { var out = {}; if (o && typeof o === 'object') Object.keys(o).forEach(function (k) { var v = +o[k]; if (/^\d+$/.test(k) && (v === 1 || v === 2)) out[k] = v; }); return out; }
  function maxAnnId() { var m = 0; Object.keys(S.annots).forEach(function (k) { S.annots[k].forEach(function (a) { if (a.id > m) m = a.id; }); }); return m; }
  function findAnnot(row, id) { var l = S.annots[row] || []; for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i]; return null; }
  function selected() {
    var ci = S.sel.ci;
    if (ci == null || !S.copies[ci]) return null;
    return { ci: ci, row: S.sel.row, c: S.copies[ci], key: S.copies[ci].cells[S.sel.row] || null };
  }
  function ensurePair() {
    var ids = S.copies.map(function (c) { return c.id; });
    var a = ids.indexOf(S.pair[0]) >= 0 ? S.pair[0] : null;
    var b = ids.indexOf(S.pair[1]) >= 0 && S.pair[1] !== a ? S.pair[1] : null;
    ids.forEach(function (id) { if (a == null && id !== b) a = id; else if (b == null && id !== a) b = id; });
    S.pair = [a, b];
  }
  function canCompare() {
    var a = copyById(S.pair[0]), b = copyById(S.pair[1]), r = S.sel.row;
    return !!(a && b && a.cells[r] && b.cells[r]);
  }

  /* ---------------------------------------------------------------- undo / redo */
  function snap() {
    return JSON.stringify({ c: S.copies.map(function (c) { return { id: c.id, name: c.name, cells: c.cells }; }), l: S.labels, ns: S.ns, f: S.folio, sk: S.skip, fl: S.flags, an: S.annots, ti: S.tiles, bx: S.boxes, s: S.sel, p: S.pair, rf: S.ref });
  }
  function restore(str) {
    var o = JSON.parse(str);
    S.copies = o.c.map(function (r) { var c = REG[r.id]; c.name = r.name; c.cells = r.cells; return c; });
    S.labels = o.l; S.ns = o.ns; S.folio = !!o.f; S.skip = o.sk; S.flags = o.fl || {}; S.annots = o.an || {}; S.tiles = o.ti || {}; S.boxes = o.bx || {}; S.sel = o.s; S.pair = o.p; S.ref = o.rf != null ? o.rf : null;
    if (S.sel.ci != null && !S.copies[S.sel.ci]) S.sel.ci = S.copies.length ? 0 : null;
    anchor = null;
  }
  function commit() { hist.undo.push(snap()); if (hist.undo.length > 60) hist.undo.shift(); hist.redo = []; }
  function undo() { if (!hist.undo.length) return toast('Nothing to undo.'); hist.redo.push(snap()); restore(hist.undo.pop()); changed(); toast('Undone.'); }
  function redo() { if (!hist.redo.length) return; hist.undo.push(snap()); restore(hist.redo.pop()); changed(); }
  function changed() { touch(); renderAll(); }

  /* ---------------------------------------------------------------- operations on the grid (all of them only change the project, never a scan file) */
  function insertGap(c, row, n) { while (c.cells.length < row) c.cells.push(null); for (var i = 0; i < n; i++) c.cells.splice(row, 0, null); }
  function closeGap(c, row, n) { var k = 0; while (k < n && row < c.cells.length && c.cells[row] === null) { c.cells.splice(row, 1); k++; } return k; }
  function deleteCell(c, row) { if (!c.cells[row]) return false; c.cells.splice(row, 1); return true; }
  // New files go into empty cells first; where a cell is taken, the pages below move down. start < 0 means "at the end".
  function placeKeys(c, keys, start) {
    if (start < 0) { trim(c); start = c.cells.length; }
    var row = start;
    keys.forEach(function (k) {
      while (c.cells.length < row) c.cells.push(null);
      if (c.cells[row] == null) c.cells[row] = k; else c.cells.splice(row, 0, k);
      row++;
    });
    return start;
  }

  /* ---------------------------------------------------------------- scan folders ("roots"), read only */
  function rootById(id) { for (var i = 0; i < S.roots.length; i++) if (S.roots[i].id === id) return S.roots[i]; return null; }
  function newRoot(name) { var r = { id: uid(), name: name, handle: null, files: null, ok: false }; S.roots.push(r); return r; }
  function rootReady(r) { return !!r && (!!r.files || (!!r.handle && r.ok)); }
  // Which of a copy's folders are actually used by its pictures (the first one always counts).
  function usedLocs(c) {
    var u = { 0: true };
    for (var i = 0; i < c.cells.length; i++) { var k = c.cells[i]; if (k && k.charAt(0) === '@') u[splitKey(k).n] = true; }
    return Object.keys(u).map(Number);
  }
  function copyLost(c) {
    if (!c.locs || !c.locs.length) return true;
    var u = usedLocs(c);
    for (var i = 0; i < u.length; i++) { var l = c.locs[u[i]]; if (!l || !rootReady(rootById(l.root))) return true; }
    return false;
  }
  function lostWhy(c) {
    var u = usedLocs(c);
    for (var i = 0; i < u.length; i++) { var l = c.locs && c.locs[u[i]], r = l && rootById(l.root); if (!r || (!r.handle && !r.files)) return 'folder not found'; }
    return 'permission needed';
  }
  function usedRoots() {
    var seen = {}, out = [];
    S.copies.forEach(function (c) { usedLocs(c).forEach(function (n) { var l = c.locs && c.locs[n], r = l && rootById(l.root); if (r && !seen[r.id]) { seen[r.id] = 1; out.push(r); } }); });
    return out;
  }
  function rootUsed(r) { return usedRoots().indexOf(r) >= 0; }
  async function refreshRootState(r) {
    if (!r.handle) return;
    try { r.ok = (await r.handle.queryPermission({ mode: 'read' })) === 'granted'; } catch (e) { r.ok = false; }
  }
  async function ensureAccess(r) {
    if (rootReady(r)) return true;
    if (!r.handle) return false;
    var p = await r.handle.requestPermission({ mode: 'read' });     // must come from a click
    if (p === 'granted') { r.ok = true; thumbMem.clear(); return true; }
    return false;
  }

  function groupsFromKeys(keys, ignored) {
    var by = {};
    keys.forEach(function (k) { var i = k.lastIndexOf('/'), p = i < 0 ? '' : k.slice(0, i + 1); (by[p] = by[p] || []).push(k); });
    var groups = Object.keys(by).sort(nat).map(function (p) { return { path: p, keys: by[p].sort(nat), on: false }; });
    return { groups: groups, ignored: ignored };
  }
  async function dirAt(r, path) {
    var d = r.handle;
    if (path) { var parts = path.split('/'); for (var i = 0; i < parts.length; i++) d = await d.getDirectoryHandle(parts[i]); }
    return d;
  }
  // list the pictures in folder `path` of root `r` (and in the folders directly inside it, two levels at most)
  async function scanLoc(r, path) {
    var keys = [], ignored = 0;
    if (r.files) {
      var pre = path ? path + '/' : '';
      Object.keys(r.files).forEach(function (k) {
        if (k.indexOf(pre) !== 0) return;
        var rel = k.slice(pre.length);
        if (rel.split('/').length > 3) return;
        if (IMG_RE.test(rel)) keys.push(rel); else if (OTHER_IMG_RE.test(rel)) ignored++;
      });
      return groupsFromKeys(keys, ignored);
    }
    async function walk(d, p, depth) {
      var subs = [];
      for await (var entry of d.entries()) {
        var name = entry[0], h = entry[1];
        if (name.charAt(0) === '.') continue;
        if (h.kind === 'file') { if (IMG_RE.test(name)) keys.push(p + name); else if (OTHER_IMG_RE.test(name)) ignored++; }
        else if (depth < 2) subs.push([name, h]);
      }
      subs.sort(function (a, b) { return nat(a[0], b[0]); });
      for (var i = 0; i < subs.length; i++) await walk(subs[i][1], p + subs[i][0] + '/', depth + 1);
    }
    await walk(await dirAt(r, path), '', 0);
    return groupsFromKeys(keys, ignored);
  }
  function fromFileList(files) {
    // folder upload fallback: webkitRelativePath = "<picked folder>/<sub>/<file>"; the map is keyed relative to the picked folder
    var map = {}, rootName = '';
    files.forEach(function (f) {
      var p = f.webkitRelativePath || f.name, parts = p.split('/');
      if (!rootName) rootName = parts[0];
      var key = parts.slice(1).join('/');
      if (!key) return;
      if (parts.some(function (s) { return s.charAt(0) === '.'; })) return;
      map[key] = f;
    });
    return { name: rootName, files: map };
  }
  function pickFolderFallback() {
    return new Promise(function (resolve) {
      var inp = $('#ws-dirinput');
      inp.value = '';
      inp.onchange = function () { var files = Array.prototype.slice.call(inp.files || []); resolve(files.length ? fromFileList(files) : null); };
      inp.click();
    });
  }
  // Scans must not be read from the folder that holds the project file.
  // (the project file may lie in a folder that holds the scan folders, but not in the scan folder itself)
  async function checkNotProjectFolder(dir) {
    var t = proj.target; if (!t) return;
    var rel = null;
    try { rel = t.dir ? await t.dir.resolve(dir) : await dir.resolve(t.fh); } catch (e) { rel = null; }
    if (rel && rel.length === (t.dir ? 0 : 1)) throw refusal('That folder holds your project file. Scans and project must be in different folders.');
  }
  // The folders that really hold the scans of this project (one entry per folder, not the whole root).
  async function usedImageDirs() {
    var seen = {}, out = [];
    for (var i = 0; i < S.copies.length; i++) {
      var c = S.copies[i];
      for (var j = 0; j < c.cells.length; j++) {
        var k = c.cells[j]; if (!k) continue;
        var sk = splitKey(k), l = c.locs && c.locs[sk.n], r = l && rootById(l.root);
        if (!r || !r.handle) continue;
        var cut = sk.rel.lastIndexOf('/'), rel = joinPath(l.path, cut < 0 ? '' : sk.rel.slice(0, cut)), mk = r.id + '|' + rel;
        if (seen[mk]) continue; seen[mk] = 1;
        try { out.push({ d: await dirAt(r, rel), name: rel ? rel.split('/').pop() : r.name }); } catch (e) { /* not reachable right now: skipped */ }
      }
    }
    return out;
  }
  // The project file may lie next to the scan folders, or in a folder that holds them,
  // but never in (or inside) a folder that holds scans used by this project.
  async function projectConflict(t) {
    var dirs = await usedImageDirs(), h = t.fh || t.dir;
    for (var i = 0; i < dirs.length; i++) { var rel = null; try { rel = await dirs[i].d.resolve(h); } catch (e) { rel = null; } if (rel) return dirs[i].name; }
    return null;
  }
  async function checkNotScanFolder(t) {
    var n = await projectConflict(t);
    if (n) throw refusal('That place is (or is inside) the scan folder “' + n + '”. Save the project in another folder, so that your scan folders are never touched.');
  }
  // A picked folder becomes (or joins) a root. If a known root already covers it, that root is reused, so one permission is enough.
  async function rootFor(h, granted) {
    var i, r, rel;
    for (i = 0; i < S.roots.length; i++) {
      r = S.roots[i]; if (!r.handle || (granted && !rootReady(r))) continue;      // a freshly picked folder may only join a root that is readable now
      try { rel = await r.handle.resolve(h); } catch (e) { rel = null; }          // [] = the same folder, ['a','b'] = inside
      if (rel) return { root: r, path: rel.join('/') };
    }
    var nr = newRoot(h.name); nr.handle = h; nr.ok = !!granted;
    for (i = S.roots.length - 2; i >= 0; i--) {                                    // older roots that lie inside the new one are folded into it
      r = S.roots[i]; if (!r.handle) continue;
      try { rel = await h.resolve(r.handle); } catch (e) { rel = null; }
      if (rel) { repoint(r, nr, rel.join('/')); S.roots.splice(i, 1); }
    }
    if (!h.isHelper) idbPut('handles', S.projectId + '/root/' + nr.id, h);
    return { root: nr, path: '' };
  }
  function repoint(from, to, pre) {
    Object.keys(REG).forEach(function (id) {
      (REG[id].locs || []).forEach(function (l) { if (l.root === from.id) { l.root = to.id; l.path = l.path ? (pre ? pre + '/' + l.path : l.path) : pre; } });
    });
  }
  // The Windows folder window opens where you chose a folder last time. The browser does not always remember that by itself
  // (it often does not when the app is opened from a file), so the last folder is kept here and passed as the starting point.
  async function pickDir(kind, mode) {
    if (HELPER) return helperPick(mode === 'read' ? 'scans' : 'project');
    var start = await idbGet('meta', 'start:' + kind), opts = { id: kind, mode: mode };
    if (start) opts.startIn = start;
    var h;
    try { h = await window.showDirectoryPicker(opts); }
    catch (e) {
      if (!start || (e && (e.name === 'AbortError' || e.name === 'SecurityError'))) throw e;
      delete opts.startIn; h = await window.showDirectoryPicker(opts);                // the remembered folder is gone: start anywhere
    }
    idbPut('meta', 'start:' + kind, h);
    return h;
  }
  // result: { root, path, name, groups, ignored }
  async function pickScanFolder() {
    if (!HAS_FSA) {
      var f = await pickFolderFallback(); if (!f) return null;
      var r = newRoot(f.name); r.files = f.files;
      var g0 = await scanLoc(r, '');
      return { root: r, path: '', name: f.name, groups: g0.groups, ignored: g0.ignored };
    }
    var dir = await pickDir('book-scans', 'read');
    await checkNotProjectFolder(dir);
    var loc = await rootFor(dir, true);
    if (loc.path && loc.root.handle) {                                                          // next time start in the folder that holds the others
      if (loc.root.handle.isHelper) helperStart.scans = loc.root.handle.rootPath; else idbPut('meta', 'start:book-scans', loc.root.handle);
    }
    var g = await scanLoc(loc.root, loc.path);
    return { root: loc.root, path: loc.path, name: dir.name, groups: g.groups, ignored: g.ignored };
  }
  // Single pictures (S10): the ordinary Windows "Open" window, opened by the helper; several pictures with Ctrl- or Shift-click.
  // Result like pickScanFolder, with exactly the chosen pictures as the only group (they are ticked in the dialog).
  function canPickFiles() { return !!(HELPER && (HELPER.pick === 'dialog' || HELPER.pick === 'test')); }
  async function pickScanFiles() {
    var j;
    try { j = await hjson('/api/pick', { kind: 'files', start: helperStart.files || helperStart.scans || null }); }
    catch (e) {
      if (e && e.code === 'no-dialog') throw refusal('Book Compare could not open the Windows window for pictures. Use “Choose another folder …” instead and tick the pictures there.');
      throw e;
    }
    if (j.cancelled) { var ab = new Error('cancelled'); ab.name = 'AbortError'; throw ab; }
    var dir = new HDir({ id: j.id, path: j.path, kind: j.kind }, '', j.name);
    await checkNotProjectFolder(dir);
    var loc = await rootFor(dir, true);
    helperStart.files = j.path;                                                                   // next time the window opens in this folder again
    var names = (j.files || []).slice().sort(nat), g = groupsFromKeys(names, 0);
    return { root: loc.root, path: loc.path, name: dir.name, groups: g.groups, ignored: 0, only: names };
  }
  async function getScan(copy, key) {
    var sk = splitKey(key), loc = copy.locs && copy.locs[sk.n], r = loc && rootById(loc.root);
    if (!rootReady(r)) { var e = new Error('No access to the scans of "' + copy.name + '" yet.'); e.name = 'Lost'; throw e; }
    var full = joinPath(loc.path, sk.rel);
    if (r.files) {
      var f = r.files[full];
      if (!f) { var e2 = new Error('File not found: ' + full); e2.name = 'NotFoundError'; throw e2; }
      return f;
    }
    var parts = full.split('/'), d = r.handle;
    for (var i = 0; i < parts.length - 1; i++) d = await d.getDirectoryHandle(parts[i]);
    var fh = await d.getFileHandle(parts[parts.length - 1]);
    return fh.getFile();
  }
  // size and date of a scan without loading it (helper mode only; null otherwise)
  async function statScan(copy, key) {
    var sk = splitKey(key), loc = copy.locs && copy.locs[sk.n], r = loc && rootById(loc.root);
    if (!r || !r.handle || !r.handle.isHelper || !rootReady(r)) return null;
    var parts = joinPath(loc.path, sk.rel).split('/'), d = r.handle;
    for (var i = 0; i < parts.length - 1; i++) d = await d.getDirectoryHandle(parts[i]);
    var fh = await d.getFileHandle(parts[parts.length - 1]);
    return fh._info ? { size: fh._info.size, mtime: fh._info.mtime, fp: fh._info.fp || null } : null;
  }

  /* ---------------------------------------------------------------- thumbnails (small copies made in the browser; the scans are not changed) */
  var thumbMem = new Map(), thumbUrl = new Map(), thumbQueue = [], thumbActive = 0, THUMB_W = 260, thumbFail = {};
  function thumbPromise(copy, key) {
    var mk = copy.id + '|' + key;
    if (thumbMem.has(mk)) return thumbMem.get(mk);
    var p = new Promise(function (resolve) { thumbQueue.push({ copy: copy, key: key, resolve: resolve, mk: mk }); pumpThumbs(); });
    thumbMem.set(mk, p);
    // a picture that could not be loaded is not remembered for long: the next look (or "Reload") tries again
    p.then(function (r) { if (r && r.url && thumbMem.get(mk) === p) thumbUrl.set(mk, r.url); if (r && r.err) { thumbFail[mk] = true; setTimeout(function () { if (thumbMem.get(mk) === p) { thumbMem.delete(mk); delete thumbFail[mk]; } }, 4000); } else delete thumbFail[mk]; });
    if (thumbMem.size > 700) { var first = thumbMem.keys().next().value; var old = thumbMem.get(first); thumbMem.delete(first); thumbUrl.delete(first); old.then(function (r) { if (r && r.url) URL.revokeObjectURL(r.url); }); }
    return p;
  }
  function pumpThumbs() {
    while (thumbActive < 3 && thumbQueue.length) {
      var job = thumbQueue.pop();                      // newest request first: what you look at now loads first
      thumbActive++;
      makeThumb(job.copy, job.key).then(job.resolve, function (e) {
        if (e && (e.busy || (e.net && e.name !== 'Lost')) && !job.again) { job.again = true; setTimeout(function () { thumbQueue.push(job); pumpThumbs(); }, 1500); return; }      // once more, a moment later
        job.resolve({ err: e && e.name === 'Lost' ? 'lost' : 'missing', msg: niceError(e) });
      }).then(function () { thumbActive--; pumpThumbs(); });
    }
  }
  // A small picture is kept in the browser for every page you have looked at. It is shown even while the browser has the
  // scan folder locked (after a restart); once the folder is readable the kept picture is checked against the file.
  async function makeThumb(copy, key) {
    var ck = 'v2|' + S.projectId + '|' + copy.id + '|' + key, cached = await idbGet('thumbs', ck), file;
    if (cached && cached.blob && HELPER) {                       // helper mode: the picture only has to be loaded if the file changed
      try { var st = await statScan(copy, key); if (st && st.size === cached.size && st.mtime === cached.mtime) return { url: URL.createObjectURL(cached.blob) }; } catch (e0) { /* load it below */ }
    }
    try { file = await getScan(copy, key); }
    catch (e) { if (cached && cached.blob && e && e.name === 'Lost') return { url: URL.createObjectURL(cached.blob), kept: true }; throw e; }
    if (cached && cached.blob && cached.size === file.size && cached.mtime === file.lastModified) return { url: URL.createObjectURL(cached.blob) };
    var blob = await decodeToBlob(file);
    if (!blob) return { err: 'decode', msg: 'This file could not be shown as a picture.' };
    idbPut('thumbs', ck, { blob: blob, size: file.size, mtime: file.lastModified });
    return { url: URL.createObjectURL(blob) };
  }
  async function decodeToBlob(file) {
    var bmp = null;
    try { bmp = await createImageBitmap(file, { resizeWidth: THUMB_W, resizeQuality: 'medium' }); }
    catch (e) { try { bmp = await createImageBitmap(file); } catch (e2) { return null; } }
    var w = Math.min(THUMB_W, bmp.width), h = Math.max(1, Math.round(bmp.height * w / bmp.width));
    var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    cv.getContext('2d').drawImage(bmp, 0, 0, w, h);
    if (bmp.close) bmp.close();
    return new Promise(function (res) { cv.toBlob(function (b) { res(b); }, 'image/jpeg', 0.72); });
  }

  /* ---------------------------------------------------------------- saving and opening projects */
  // "Reload": every picture of the selected row that failed is tried again (the ones that are shown stay as they are)
  function reloadThumb(ci) {
    S.copies.forEach(function (c) {
      var key = c.cells[S.sel.row], mk = key ? c.id + '|' + key : null;
      if (mk && thumbFail[mk]) { thumbMem.delete(mk); delete thumbFail[mk]; }
    });
    renderPreview();
  }
  function serialize() {
    var used = {};
    S.copies.forEach(function (c) { (c.locs || []).forEach(function (l) { used[l.root] = true; }); });
    return {
      format: 'book-compare-project', version: 2, projectId: S.projectId, savedAt: new Date().toISOString(), title: S.title || '', lblw: S.lblw || 0, bgRun: S.bgRun || null,
      nextCopy: S.nextCopy, ns: S.ns, folio: S.folio, labels: S.labels, skip: S.skip, flags: S.flags, annotations: S.annots, tiles: S.tiles, boxes: S.boxes, paper: S.paper, thumbs: !!S.thumbs, nextAnn: S.nextAnn, pair: S.pair, sel: S.sel, ref: S.ref, noRefWarn: !!S.noRefWarn,
      roots: S.roots.filter(function (r) { return used[r.id]; }).map(function (r) {
        var path = r.handle && r.handle.isHelper ? r.handle.rootPath : r.path;
        if (!path) return { id: r.id, name: r.name };
        var o = { id: r.id, name: r.name, path: path }, pd = proj.target && proj.target.dir && proj.target.dir.rootPath;
        var rel = pd ? relPath(pd, path) : null; if (rel != null) o.rel = rel;                // item 30: also where it lies seen from the project file
        return o;
      }),
      copies: S.copies.map(function (c) { var o = { id: c.id, name: c.name, folder: c.folder, locs: c.locs, keys: c.keys, cells: c.cells }; if (c.w) o.w = c.w; return o; })
    };
  }
  function touch() { dirty = true; if (proj.target) { proj.state = 'dirty'; clearTimeout(proj.timer); proj.timer = setTimeout(saveNow, saveDelay()); } renderSave(); }
  // (0.12.0: on the website a browser writes a file by copying it whole first: a project file that holds many stored alignments is saved
  //  a little less often there, up to every 10 s; in the desktop program a save only adds the project at the end of the file)
  function saveDelay() { var mbs = !HELPER && proj.pack ? proj.pack.end / 1048576 : 0; return Math.round(700 + Math.min(9300, mbs * 90)); }
  function targetFile(t) { return t.fh ? t.fh.name : t.file; }
  function targetName(t) { return targetFile(t).replace(/\.bookcompare$/i, ''); }
  function isLegacy(t) { return targetFile(t) === LEGACY_FILE; }
  function abortError() { var e = new Error('cancelled'); e.name = 'AbortError'; return e; }
  // 0.12.0: the project file holds the project and its stored alignments (app/js/project-pack.js). The ONLY file ever written.
  function ioFor(t) {
    if (t.dir && t.dir.isHelper) {
      var ref = t.dir.ref, rel = joinPath(t.dir.rel, t.file);
      return {
        size: async function () { var r = await hcall(ref, 'POST', '/api/stat', rel); var j = await r.json(); if (!j.exists) { var e = new Error('The project file was not found.'); e.name = 'NotFoundError'; throw e; } return j.size; },
        read: async function (at, len) { if (len <= 0) return new ArrayBuffer(0); var r = await hcall(ref, 'GET', '/api/file', rel, undefined, '', { Range: 'bytes=' + at + '-' + (at + len - 1) }); return r.arrayBuffer(); },
        append: async function (at, blob) {
          try { await hcall(ref, 'POST', '/api/append', rel, blob, '&at=' + at); }
          catch (e) { if (e && e.code === 'changed') e.changed = true; throw e; }
        },
        replace: async function (blob) { await hcall(ref, 'PUT', '/api/write', rel, blob); },
        compact: async function (ranges, prefix) { await hcall(ref, 'POST', '/api/compact', rel, JSON.stringify({ ranges: ranges, prefix: prefix })); }
      };
    }
    return BCPack.fsaIO(function () { return t.fh ? Promise.resolve(t.fh) : t.dir.getFileHandle(t.file, { create: true }); });
  }
  // the project in a file: { json, pack } (pack: null for a file of an older version, which was JSON text)
  async function targetRead(t) {
    var io = ioFor(t), size = await io.size();
    if (BCPack.isPack(await io.read(0, Math.min(size, 8)))) { var pk = await BCPack.open(io); pk.target = t; return { json: pk.project(), pack: pk }; }
    return { json: JSON.parse(new TextDecoder().decode(await io.read(0, size)).replace(/^\uFEFF/, '')), pack: null };
  }
  async function targetWrite(t, text) {
    if (proj.pack && proj.pack.target === t) return proj.pack.writeProject(text);
    var pk = await BCPack.create(ioFor(t), text, proj.carry || []);                          // a new file (or one of an older version, brought up to date)
    pk.target = t; proj.pack = pk; proj.carry = null;
  }
  async function saveNow() {
    if (!proj.target) return;
    clearTimeout(proj.timer);
    if (proj.saving) { proj.again = true; return; }
    proj.saving = true; proj.state = 'saving'; renderSave();
    try {
      await targetWrite(proj.target, JSON.stringify(serialize()));
      proj.state = 'saved'; dirty = false; proj.savedAt = new Date();
    } catch (e) { proj.state = 'error'; proj.err = niceError(e); }
    proj.saving = false;
    if (proj.again) { proj.again = false; proj.timer = setTimeout(saveNow, 50); }
    renderSave();
  }
  // Closing the program (item 27, desktop: js in desktop/main.js asks this): a project with a file is saved and the stored results'
  // index written (item 32) without asking; only a project that has never been saved needs a question.
  async function beforeClose() {
    try { if (window.BCBackground) BCBackground.stop(); if (window.BCResults) await BCResults.flush(); } catch (e) { /* closing anyway */ }
    if (!S || !S.copies.length || !dirty || S.examples) return { ok: true };
    if (proj.target && proj.state !== 'error') { await flushSave(); return { ok: !dirty }; }
    return { ok: false, err: proj.state === 'error' ? proj.err : '' };
  }
  async function saveForClose() {
    if (!proj.target) await saveProjectAs(); else await flushSave();
    return !!proj.target && !dirty;
  }
  // before another project is opened: a change that is still waiting to be saved is saved now
  async function flushSave() { if (proj.target && (proj.state === 'dirty' || proj.saving)) { await saveNow(); for (var i = 0; i < 50 && proj.saving; i++) await new Promise(function (r) { setTimeout(r, 100); }); } }
  // true if the work so far may be replaced by another project (asks when there are changes that are saved nowhere)
  async function mayReplace() {
    await flushSave();
    if (!S || !S.copies.length || !dirty || proj.target || S.examples) return true;
    return confirmDialog('The project is not saved', 'The changes to the project you are working on are not saved anywhere. Open the other project anyway?', 'Open anyway');
  }
  function renderSave() {
    if (!root) return;
    var b = $('#ws-save'), c = saveChip();
    b.className = c.cls; b.textContent = c.text; b.title = c.title;
    if (window.CompareTab && CompareTab.saveChanged) CompareTab.saveChanged();
  }
  // the save state as the chip in the top bar shows it (both views). 0.16.0 (owner): only the state; the rest is in its tooltip and
  // in the message a click on it gives
  function saveChip() {
    var t = '', cls = 'ws-save', why = '';
    if (!S) return { text: '', cls: cls, title: '' };
    if (S.examples) return { text: 'Examples: not saved', cls: cls, title: 'The examples come with Book Compare. What you change here is not kept; start your own project with ⋮ → New project.' };
    if (!HAS_FSA) { t = dirty ? 'Not saved' : '✓ Saved'; cls += dirty ? ' warn' : ' ok'; why = dirty ? 'Click to download the project file with your changes.' : ''; }
    else if (!proj.target) {
      t = !S.copies.length ? 'No project yet' : proj.legacy ? 'Older project: not saved' : 'Not saved yet';
      cls += S.copies.length ? ' warn' : '';
    }
    else if (proj.state === 'saving' || proj.state === 'dirty') { t = 'Saving …'; }
    else if (proj.state === 'error') { t = 'Could not save'; cls += ' bad'; why = 'Could not save: ' + proj.err + '. Click to try again.'; }
    else { t = '✓ Saved'; cls += ' ok'; why = proj.savedAt ? 'Last saved at ' + hhmm(proj.savedAt) + '. ' : ''; }
    return { text: t, cls: cls,
      title: (why ? why + ' ' : '') + (proj.target ? 'Every change is saved by itself in the project file “' + targetFile(proj.target) + '”, about a second after you make it. You never have to save by hand (Ctrl+S saves at once).'
      : proj.legacy ? 'This project was saved by an older version of Book Compare. Click to save it as a project file and keep your changes; the old project folder stays as it is.'
      : 'Click to save the project as a file (not in one of your scan folders).') };
  }
  function hhmm(d) { return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
  function chipClick() { if (S && S.examples) return toast('The examples are not saved. Start your own project with ⋮ → New project.'); return proj.target ? (proj.state === 'error' ? saveNow() : toast('Every change is saved automatically in “' + targetFile(proj.target) + '”' + (proj.savedAt ? ' (last time at ' + hhmm(proj.savedAt) + ')' : '') + '. You never have to save by hand.')) : saveProjectAs(); }
  // Ctrl+S (0.11.0): saves at once (a project without a file asks where to save it)
  async function saveKey() {
    if (!S || !S.copies.length) return;
    if (S.examples) return toast('The examples are not saved. Start your own project with ⋮ → New project.');
    if (!proj.target) return HAS_FSA ? saveProjectAs() : downloadProject();
    await saveNow();
    if (proj.state === 'saved') toast('Saved in “' + targetFile(proj.target) + '”. (Every change is also saved automatically.)');
  }
  // the start screen (index.html): Continue / Open project … / New project
  async function startInfo() {
    if (S && S.copies.length) return { open: true, name: S.title || proj.name || 'this project' };
    await helperReady;
    if (!lastProject) { try { lastProject = await loadLastProject(); } catch (e) { lastProject = null; } }
    return lastProject ? { open: false, name: lastProject.name || '' } : null;
  }
  async function startAction(kind) {
    var had = !!(S && S.copies.length);
    show();
    if (kind === 'continue') { if (!had && lastProject) await continueLast(); }
    else if (kind === 'open') await openProject();
    else if (kind === 'examples') await openExamples();
    else if (kind === 'new') { if (had) await newProject(); }
  }
  function suggestedName() {
    var n = proj.legacy ? (proj.legacy.dir ? proj.legacy.dir.name : '') : proj.name;
    if (!proj.target && S.title) n = S.title.replace(/[<>:"\/\\|?*\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);   // a new project file is named after the project
    return (n && !/[<>:"\/\\|?*\x00-\x1f]/.test(n) ? n : 'Book project') + PROJECT_EXT;
  }
  // the Windows "Save as" or "Open" window for a project file
  async function pickProjectFile(save) {
    if (HELPER) {
      var body = { kind: save ? 'save-project' : 'open-project' };
      if (save) body.name = suggestedName();
      if (proj.legacy && proj.legacy.dir.isHelper) body.start = proj.legacy.dir.rootPath + (/\\/.test(proj.legacy.dir.rootPath) ? '\\' : '/') + 'x';
      var j = await hjson('/api/pick', body);
      if (j.cancelled) throw abortError();
      return { dir: new HDir({ id: j.id, path: j.path, kind: j.kind }, '', j.name), file: j.file };
    }
    var types = [{ description: 'Book Compare project', accept: { 'application/json': [PROJECT_EXT] } }];
    if (save) return { fh: await window.showSaveFilePicker({ id: 'book-project', suggestedName: suggestedName(), types: types }) };
    types.push({ description: 'Project of an older version (book-compare-project.json)', accept: { 'application/json': ['.json'] } });
    var arr = await window.showOpenFilePicker({ id: 'book-project', types: types, multiple: false });
    if (!arr || !arr.length) throw abortError();
    return { fh: arr[0] };
  }
  async function saveProjectAs() {
    if (!HAS_FSA || (!HELPER && typeof window.showSaveFilePicker !== 'function')) { downloadProject(); return; }
    var t;
    try { t = await pickProjectFile(true); } catch (e) { if (e && e.name === 'AbortError') return; return toast(niceError(e)); }
    try { await checkNotScanFolder(t); }
    catch (e) {
      if (t.fh && t.fh.remove) { try { if ((await t.fh.getFile()).size === 0) await t.fh.remove(); } catch (e2) { /* nothing to remove */ } }   // (the browser may have made an empty file already)
      return toast(niceError(e));
    }
    var before = { target: proj.target, legacy: proj.legacy, name: proj.name, pack: proj.pack };
    if (window.BCBackground) window.BCBackground.stop(true);        // (the stored alignments stay in the old file: the new file starts afresh)
    if (window.BCResults) window.BCResults.reset();
    proj.target = t; proj.legacy = null; proj.name = targetName(t); proj.pack = null;
    await saveNow();
    if (proj.state === 'error') {
      var why = proj.err;
      proj.target = before.target; proj.legacy = before.legacy; proj.name = before.name; proj.pack = before.pack; proj.state = proj.target ? 'saved' : 'none'; renderSave();
      return toast('The project could not be saved there: ' + why);
    }
    await rememberProject();
    renderAll();
    toast('Project saved as “' + proj.name + '”. From now on changes are saved automatically.');
  }
  function downloadProject() {
    var blob = BCPack.blobOf(JSON.stringify(serialize()));
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = suggestedName();
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    dirty = false; renderSave(); toast('Project file downloaded.');
  }
  async function rememberProject() {
    if (!proj.target) return;
    var t = proj.target;
    lastProject = { target: t, name: proj.name, projectId: S.projectId };
    if (t.dir && t.dir.isHelper) await idbPut('meta', 'lastProjectH', { path: t.dir.rootPath, file: t.file, name: proj.name, projectId: S.projectId });   // remembered by its address
    else await idbPut('meta', 'lastProject', { fh: t.fh, dir: t.dir || null, file: t.file || null, name: proj.name, projectId: S.projectId });
  }
  // the remembered project, as saved by this version or an older one
  async function loadLastProject() {
    var lp = null;
    if (HELPER) {
      var rec = await idbGet('meta', 'lastProjectH');
      if (rec && rec.path) { try { lp = { target: { dir: await helperRegister(rec.path, 'project'), file: rec.file || LEGACY_FILE }, name: rec.name, projectId: rec.projectId }; } catch (e) { lp = null; } }
    } else {
      var r = await idbGet('meta', 'lastProject');
      if (r && r.fh) lp = { target: { fh: r.fh }, name: r.name, projectId: r.projectId };
      else if (r && (r.dir || r.handle)) lp = { target: { dir: r.dir || r.handle, file: r.file || LEGACY_FILE }, name: r.name, projectId: r.projectId };
    }
    return lp;
  }
  async function readProject(t) {
    var got;
    try { got = await targetRead(t); }
    catch (e) {
      if (e && e.name === 'NotFoundError') toast(isLegacy(t) && t.dir ? 'There is no Book Compare project in the folder “' + t.dir.name + '”.' : 'The project file “' + targetFile(t) + '” was not found.');
      else toast('The project file “' + targetFile(t) + '” could not be read' + (e && /damaged|not a Book Compare/.test(e.message) ? ': ' + e.message : '.'));
      return false;
    }
    if (!(await adopt(got.json, t))) return false;
    if (proj.target === t) {
      proj.pack = got.pack;
      if (!got.pack) await upgradeFile(t);                                                   // a project file of version 0.11.0 or older
      else if (got.pack.needsTidy()) got.pack.tidy().catch(function () { });
    }
    return true;
  }
  // 0.12.0: a project file of an older version (JSON text) becomes a project file of this version at once; in the desktop program the
  // stored alignments of its results folder ("<name>.bookcompare results") move into it and the folder is removed. (On the website the
  // file is brought up to date with the next save, which may need the browser's permission.)
  async function upgradeFile(t) {
    if (!(t.dir && t.dir.isHelper)) return;
    var carry = [], rd = null, names = [];
    try {
      rd = new HDir(t.dir.ref, joinPath(t.dir.rel, t.file + ' results'), t.file + ' results');
      var idx = JSON.parse(await (await (await rd.getFileHandle('index.json')).getFile()).text());
      var es = idx && idx.entries || {};
      names = Object.keys(es);
      for (var i = 0; i < names.length; i++) {
        var e = es[names[i]];
        if (!(window.BCResults && BCResults.current(e))) continue;                              // (made by an older alignment: not kept)
        try { carry.push({ name: names[i], meta: e, bin: await (await (await rd.getFileHandle(names[i])).getFile()).arrayBuffer() }); } catch (x) { /* missing: aligned again */ }
      }
    } catch (e) { rd = null; }                                                                 // no results folder
    try {
      proj.carry = carry; await targetWrite(t, JSON.stringify(serialize())); proj.state = 'saved'; renderSave();
    } catch (e) { proj.carry = null; proj.pack = null; return; }                                // (not writable now: brought up to date with the next save)
    if (rd) {
      for (var j = 0; j < names.length; j++) { try { await rd.dir_remove(names[j]); } catch (x) { /* left */ } }
      try { await hcall(t.dir.ref, 'POST', '/api/remove', joinPath(rd.rel, 'index.json')); await hcall(t.dir.ref, 'POST', '/api/remove', rd.rel); } catch (x) { /* left */ }
    }
    toast('This project file was brought up to date for version 0.12' + (carry.length ? ': its ' + carry.length + ' stored alignment' + (carry.length === 1 ? ' is' : 's are') + ' now inside it.' : '.'));
  }
  async function openProject() {
    if (!HAS_FSA || (!HELPER && typeof window.showOpenFilePicker !== 'function')) { $('#ws-jsoninput').value = ''; $('#ws-jsoninput').click(); return; }
    if (!(await mayReplace())) return;
    var t;
    try { t = await pickProjectFile(false); } catch (e) { if (e && e.name === 'AbortError') return; return toast(niceError(e)); }
    await readProject(t);
  }
  async function continueLast() {
    if (!lastProject) return;
    var t = lastProject.target, h = t.fh || t.dir, mode = isLegacy(t) ? 'read' : 'readwrite';
    try {
      var perm = await h.queryPermission({ mode: mode });
      if (perm !== 'granted') perm = await h.requestPermission({ mode: mode });
      if (perm !== 'granted') return toast('The browser did not give access to the project file.');
    } catch (e) { return toast(niceError(e)); }
    if (!(await readProject(t))) return;
    // 0.11.0 (owner): "Continue" goes straight on in the Compare tab, with the pair of copies and the page that were open
    // (only when both scans can be read without a question: a locked or missing folder is dealt with in the Pages view first)
    var r = S.sel.row, ready = function (c) { var k = c && c.cells[r]; if (!k) return false; var l = c.locs && c.locs[splitKey(k).n]; return rootReady(l && rootById(l.root)); };
    if (S.copies.length >= 2 && ready(copyById(S.pair[0])) && ready(copyById(S.pair[1]))) await compareNow();
  }
  // desktop program: a project file that was double-clicked in Explorer
  async function openPending() {
    if (!HELPER) return false;
    var j;
    try { j = await hjson('/api/pending', {}); } catch (e) { return false; }
    if (!j || j.none || !j.file) return false;
    if (!root || root.hidden) show();
    if (!(await mayReplace())) return false;
    return readProject({ dir: new HDir({ id: j.id, path: j.path, kind: j.kind }, '', j.name), file: j.file });
  }
  // another project replaces this one: a background alignment of this one stops, its stored results are written out
  function projectChanging() { if (window.BCBackground) window.BCBackground.stop(true); if (window.BCResults) window.BCResults.reset(); if (window.CompareTab && CompareTab.forget) CompareTab.forget(); }
  async function adopt(json, t) {
    if (!json || json.format !== 'book-compare-project' || !Array.isArray(json.copies)) { toast('This is not a Book Compare project file.'); return false; }
    projectChanging();
    S = blank(); REG = {}; anchor = null;
    S.projectId = json.projectId || uid();
    S.title = typeof json.title === 'string' ? json.title.slice(0, 160) : '';
    S.lblw = +json.lblw > 0 ? Math.max(64, Math.min(420, Math.round(+json.lblw))) : 0;
    S.bgRun = json.bgRun && Array.isArray(json.bgRun.ids) ? { ids: json.bgRun.ids.filter(function (x) { return typeof x === 'number'; }), n: +json.bgRun.n || 0 } : null;
    S.ns = json.ns || 0; S.folio = !!json.folio; S.labels = json.labels || {}; S.skip = json.skip || {}; S.flags = cleanFlags(json.flags);
    S.annots = cleanAnnots(json.annotations); S.nextAnn = Math.max(+json.nextAnn || 1, maxAnnId() + 1); S.tiles = cleanTiles(json.tiles); S.boxes = cleanBoxes(json.boxes);
    S.paper = cleanPaper(json.paper); S.thumbs = json.thumbs === true;
    S.pair = json.pair || [null, null]; S.sel = json.sel || { ci: null, row: 0 };
    // (a "set aside" tray from older versions is dropped: those files can be added again with "Add files to this copy")
    (json.roots || []).forEach(function (r) { S.roots.push({ id: r.id, name: r.name, path: r.path || '', rel: typeof r.rel === 'string' ? r.rel : null, handle: null, files: null, ok: false }); });
    var maxId = 0, legacy = [];
    for (var i = 0; i < json.copies.length; i++) {
      var r = json.copies[i], c = { id: r.id, name: r.name, folder: r.folder, w: clampW(r.w) || 0, keys: r.keys || [], cells: r.cells || [], locs: (r.locs || []).map(function (l) { return { root: l.root, path: l.path || '' }; }) };
      REG[c.id] = c; S.copies.push(c); if (c.id > maxId) maxId = c.id;
      if (!c.locs.length) legacy.push(c);
    }
    S.nextCopy = Math.max(json.nextCopy || 1, maxId + 1);
    S.ref = json.ref != null && copyById(json.ref) ? json.ref : null; S.noRefWarn = !!json.noRefWarn;
    if (S.sel.ci != null && !S.copies[S.sel.ci]) S.sel.ci = S.copies.length ? 0 : null;
    hist = { undo: [], redo: [] };
    thumbMem.clear();
    var oldFormat = !!(t && isLegacy(t));                      // (a project folder of an older version)
    proj.pack = null; proj.target = t && !oldFormat ? t : null; proj.legacy = oldFormat ? t : null; proj.name = !t ? '' : oldFormat ? (t.dir ? t.dir.name : '') : targetName(t);
    proj.state = proj.target ? 'saved' : 'none'; dirty = false;
    // folders this browser remembers for the project
    for (var k = 0; k < S.roots.length; k++) {
      var rt = S.roots[k];
      if (HELPER) {                                              // helper mode: the project file holds the folder's address
        if (rt.path) { try { rt.handle = await helperRegister(rt.path, 'scans'); rt.ok = true; } catch (e) { rt.handle = null; } }
        // item 30: the folder is not where it was, but the project and the scans were moved together (another drive, another computer):
        // the folder's place relative to the project file is tried
        var pd = t && t.dir && t.dir.rootPath;
        if (!rt.handle && rt.rel != null && pd) {
          var alt = joinRelPath(pd, rt.rel);
          if (alt) { try { rt.handle = await helperRegister(alt, 'scans'); rt.ok = true; rt.path = rt.handle.rootPath || alt; } catch (e) { rt.handle = null; } }
        }
        continue;
      }
      var hh = await idbGet('handles', S.projectId + '/root/' + rt.id);
      if (hh) { rt.handle = hh; await refreshRootState(rt); }
    }
    // projects of the first version stored one folder per copy: those become roots
    for (var q = 0; q < legacy.length; q++) {
      var lc = legacy[q], lh = HELPER ? null : await idbGet('handles', S.projectId + '/' + lc.id);
      if (lh) { var loc = await rootFor(lh, false); await refreshRootState(loc.root); lc.locs = [{ root: loc.root.id, path: loc.path }]; }
      else { var pr = newRoot(lc.folder || lc.name); lc.locs = [{ root: pr.id, path: '' }]; }
    }
    ensurePair();
    var unsafe = false;
    if (proj.target) {
      // safety: a project file that lies in (or inside) a folder that holds scans of this project is never written to
      try { unsafe = !!(await projectConflict(proj.target)); }
      catch (e) { unsafe = true; }
      if (unsafe) { proj.target = null; proj.pack = null; proj.state = 'none'; }
    }
    if (proj.target) await rememberProject();
    renderAll(); renderSave();
    var copies = S.copies.length + ' cop' + (S.copies.length === 1 ? 'y' : 'ies');
    if (unsafe) toast('This project file lies in a folder that holds scans, so automatic saving is switched off. Save the project in another folder (menu ⋮ → Save project as …).');
    else if (oldFormat) toast('Project opened (' + copies + '). It was saved by an older version of Book Compare: to keep your changes, save it as a project file (menu ⋮ → Save project as …). The old project folder stays as it is.');
    else toast('Project opened: ' + copies + '.' + (proj.target ? ' Changes are saved automatically.' : ''));
    if (HELPER && proj.target && S.bgRun && window.BCBackground && BCBackground.offer) BCBackground.offer(S.bgRun);   // a run that did not finish (item 21)
    if (S.copies.length >= 2 && window.CompareTab && CompareTab.preload) setTimeout(CompareTab.preload, 1500);         // item 33
    return true;
  }

  /* ---------------------------------------------------------------- getting the scans back after a project was reopened */
  var allowing = false;
  async function allowAccess(quiet) {
    if (allowing) return;
    allowing = true;
    var todo = usedRoots().filter(function (r) { return r.handle && !r.ok; }), n = 0, rest = 0;
    for (var i = 0; i < todo.length; i++) {
      var r = todo[i];
      try {
        var p = await r.handle.requestPermission({ mode: 'read' });
        if (p === 'granted') { r.ok = true; n++; } else { rest = todo.length - i; if (!quiet) toast('The browser did not give access to “' + r.name + '”.'); break; }
      } catch (e) {
        if (e && e.name === 'NotFoundError') { r.handle = null; }                   // the folder was moved, renamed or deleted
        else { rest = todo.length - i; if (!quiet && e && e.name !== 'SecurityError') toast(niceError(e)); else if (!quiet) toast('Click the button once more to allow the next folder.'); break; }
      }
    }
    allowing = false;
    thumbMem.clear(); renderAll();
    if (!quiet && n && !rest) toast('Access allowed. Your scans are available again.');
  }
  // The first picture of any copy in root r, as a path from r: used to check that a folder really is the one that was meant.
  function probePath(r) {
    for (var i = 0; i < S.copies.length; i++) {
      var c = S.copies[i];
      for (var j = 0; j < c.cells.length; j++) {
        var k = c.cells[j]; if (!k) continue;
        var sk = splitKey(k), l = c.locs && c.locs[sk.n];
        if (l && l.root === r.id) return joinPath(l.path, sk.rel);
      }
    }
    return null;
  }
  async function dirHasPath(dir, full) {
    try { var parts = full.split('/'), d = dir; for (var i = 0; i < parts.length - 1; i++) d = await d.getDirectoryHandle(parts[i]); await d.getFileHandle(parts[parts.length - 1]); return true; }
    catch (e) { return false; }
  }
  // "Choose scan folder": one picked folder can hold the scans of many copies. Every folder that is found inside it is merged into
  // ONE root (the picked folder), so a single permission is enough from now on.
  async function reconnectScans() {
    var pending = usedRoots().filter(function (r) { return !rootReady(r); });
    if (!pending.length) return toast('All scans are reachable.');
    if (!HAS_FSA) { var inp = $('#ws-dirinput'); inp.value = ''; inp.onchange = function () { attachFiles(Array.prototype.slice.call(inp.files || [])); }; inp.click(); return; }
    var dir;
    try { dir = await pickDir('book-scans', 'read'); } catch (e) { if (e && e.name === 'AbortError') return; return toast(niceError(e)); }
    try { await checkNotProjectFolder(dir); } catch (e) { return toast(niceError(e)); }
    var total = pending.length, base = await rootFor(dir, true);                       // roots that lie inside the picked folder are folded in here
    pending = pending.filter(function (r) { return rootById(r.id); });
    var n = total - pending.length, single = pending.length === 1;
    for (var i = 0; i < pending.length; i++) {
      var r = pending[i], probe = probePath(r), cands = [];
      if (dir.name === r.name || single) cands.push({ h: dir, rel: '' });
      try { cands.push({ h: await dir.getDirectoryHandle(r.name), rel: r.name }); } catch (e) { /* not a direct child */ }
      if (cands.length < 2) {                                                         // one level deeper
        try { for await (var en of dir.entries()) { if (en[1].kind !== 'directory' || en[0].charAt(0) === '.') continue; try { cands.push({ h: await en[1].getDirectoryHandle(r.name), rel: en[0] + '/' + r.name }); break; } catch (e2) { /* next */ } } } catch (e3) { /* ignore */ }
      }
      for (var k = 0; k < cands.length; k++) {
        if (!probe || await dirHasPath(cands[k].h, probe)) { repoint(r, base.root, joinPath(base.path, cands[k].rel)); S.roots.splice(S.roots.indexOf(r), 1); n++; break; }
      }
    }
    thumbMem.clear(); renderAll(); touch();
    toast(n === total ? 'All scans reconnected.' : (n ? 'Reconnected ' + n + ' of ' + total + ' folders. Choose the folder that holds the others.' : 'That folder does not contain the scans of this project. Try its parent folder, or the folder you first picked.'));
  }
  function attachFiles(files) {
    var pending = usedRoots().filter(function (r) { return !rootReady(r); }), pk = fromFileList(files), total = pending.length, n = 0, single = total === 1;
    var base = newRoot(pk.name); base.files = pk.files;
    pending.forEach(function (r) {
      var probe = probePath(r), rel = null, pre = r.name + '/';
      if (pk.name === r.name || single) rel = '';
      if (rel === null || (probe && !pk.files[probe])) {                              // maybe the picked folder holds the root folder
        rel = Object.keys(pk.files).some(function (k) { return k.indexOf(pre) === 0; }) ? r.name : null;
        if (rel !== null && probe && !pk.files[joinPath(rel, probe)]) rel = null;
      }
      if (rel !== null) { repoint(r, base, rel); S.roots.splice(S.roots.indexOf(r), 1); n++; }
    });
    if (!n) S.roots.splice(S.roots.indexOf(base), 1);
    thumbMem.clear(); renderAll(); touch();
    toast(n === total ? 'All scans reconnected.' : (n ? 'Reconnected ' + n + ' of ' + total + ' folders.' : 'That folder does not contain the scans of this project.'));
  }

  /* ---------------------------------------------------------------- rendering */
  // The toolbar (items 17, 18): only what is used all the time; everything else is in the menu of the right mouse button (on a cell,
  // on a row name, on a copy's heading). 0.16.0 (owner): no "More for this cell" button any more.
  function renderToolbar() {
    var s = selected(), tb = $('#ws-toolbar');
    var rg = range(), nrg = 0;
    if (rg) for (var q = rg.lo; q <= rg.hi; q++) if (s.c.cells[q]) nrg++;
    // 0.17.0 (owner): no text naming the selected cell (the panel on the right names the row), not even for marked rows
    tb.innerHTML = '' +
      '<button class="ws-tb" data-act="gap"' + (s ? '' : ' disabled') + ' title="Inserts empty cells ABOVE the selected cell: this cell and everything below it in this copy move down. Book Compare asks how many.">Insert gap above …</button>' +
      '<button class="ws-tb" data-act="closegap"' + (s && !s.key ? '' : ' disabled') + ' title="Select an empty cell: it is removed and everything below it moves up">Close gap</button>' +
      '<button class="ws-tb" data-act="del"' + ((rg ? nrg : s && s.key) ? '' : ' disabled') + ' title="' + (rg ? 'Removes all the marked rows of this column from the workspace; the pages below move up.' : 'Removes this file from the workspace (for covers, flyleaves, duplicates). Hold Shift and click another cell (or press Shift + arrow) to mark several in one go.') + ' The scan files on your disk are not touched. Undo brings them back.">' + (rg ? 'Delete ' + nrg + ' file' + (nrg === 1 ? '' : 's') : 'Delete file') + '</button>' +
      '<span class="ws-vsep"></span>' +
      '<button class="ws-tb" data-act="undo"' + (hist.undo.length ? '' : ' disabled') + ' title="Undo (Ctrl+Z)">Undo</button>' +
      '<button class="ws-tb" data-act="redo"' + (hist.redo.length ? '' : ' disabled') + ' title="Redo (Ctrl+Y)">Redo</button>' +
      '<span class="ws-vsep"></span>' +
      '<button class="ws-tb ws-tog" id="ws-pics" data-act="pics" aria-pressed="' + !!S.thumbs + '" title="Show a small picture of every page in the grid (kept in the project). The rows get taller.">' +
      '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3 3.5-4.5 4.5 6H5l3.5-4.5z"/></svg> Pictures in the grid</button>' +
      bgButton();
  }
  // 0.15.0 (owner): the background alignment has its own button in the Pages tab (while it runs it is highlighted)
  function bgButton() {
    var B = window.BCBackground, st = B && B.state ? B.state() : null, run = st && !st.finished;
    var off = !HELPER || S.copies.length < 2 || !!S.examples;
    var tip = !HELPER ? 'Only in the desktop program: aligns the other copies onto the reference copy page by page and keeps the results' : 'Align the other copies onto the reference copy, page by page, while you go on working';
    var lab = 'Align in the background …';                     // 0.16.0 (owner): how far it is shows at the top, left of the tab Pages
    return '<span class="ws-vsep"></span><button class="ws-tb ws-bgbtn' + (run ? ' on' : '') + '" id="ws-bgbtn" data-act="bgopen"' + (off && !run ? ' disabled' : '') + ' title="' + esc(tip) + '">' +
      '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M12 4V1L8 5l4 4V6a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z"/></svg> ' + esc(lab) + '</button>';
  }
  // the menu for a cell (right mouse button): its copy, its row
  function cellMenuHtml() {
    var s = selected(); if (!s) return '';
    var it = function (a, label, off, tip) { return '<button role="menuitem" data-act="' + a + '"' + (off ? ' disabled' : '') + (tip ? ' title="' + esc(tip) + '"' : '') + '>' + label + '</button>'; };
    var other = S.ref != null && S.ref !== s.c.id && copyById(S.ref) && copyById(S.ref).cells[s.row];
    return '<div class="ws-mhead">This cell</div>' +
      it('gap', 'Insert gap above …') + it('closegap', 'Close gap', !!s.key) + it('del', 'Delete file', !s.key) +
      it('cmpref', 'Compare with the reference copy', !s.key || !other, 'The same as a double-click on the cell' + (other ? '' : ': needs a reference copy (menu ⋮) with a page in this row')) +
      '<hr><div class="ws-mhead">This copy · <span>' + esc(s.c.name) + '</span></div>' +
      it('addfiles', 'Add files to this copy …') +
      it('mvl', '&#9664; Move copy to the left', s.ci <= 0) + it('mvr', 'Move copy to the right &#9654;', s.ci >= S.copies.length - 1) +
      it('renamecopy', 'Rename copy …') + it('setref', S.ref === s.c.id ? '★ Is the reference copy' : 'Make it the reference copy', S.ref === s.c.id) +
      // 0.17.0 (owner): copy 1 and copy 2 of the Compare tab are chosen here (a copy that is already the other one changes places with it)
      it('mk1', S.pair[0] === s.c.id ? 'Is copy 1' : 'Make it copy 1' + (S.pair[1] === s.c.id ? ' (swaps 1 and 2)' : ''), S.pair[0] === s.c.id) +
      it('mk2', S.pair[1] === s.c.id ? 'Is copy 2' : 'Make it copy 2' + (S.pair[0] === s.c.id ? ' (swaps 1 and 2)' : ''), S.pair[1] === s.c.id) +
      '<hr><div class="ws-mhead">This row · <span>' + esc(rowLabel(s.row)) + '</span></div>' +
      it('startnum', 'Start numbering at this row …') + it('renamerow', 'Rename this row …') +
      (function () {                                                      // 0.15.0 (owner): for all the marked rows at once
        var rg = range(), lo = rg ? rg.lo : s.row, hi = rg ? rg.hi : s.row, n = hi - lo + 1;
        return it('skiprow', S.skip[s.row] ? (n > 1 ? 'Compare these ' + n + ' rows again' : 'Compare this row again') : (n > 1 ? 'Don’t compare these ' + n + ' rows' : 'Don’t compare this row'));
      })();
  }
  function openCellMenu(x, y) {
    closeCellMenu();
    var h = cellMenuHtml(); if (!h) return;
    var m = document.createElement('div'); m.className = 'ws-menu ws-ctx'; m.id = 'ws-ctx'; m.setAttribute('role', 'menu'); m.innerHTML = h;
    root.appendChild(m);
    var w = m.offsetWidth, hh = m.offsetHeight;
    m.style.left = Math.max(6, Math.min(x, window.innerWidth - w - 6)) + 'px'; m.style.top = Math.max(6, Math.min(y, window.innerHeight - hh - 6)) + 'px';
    var f = m.querySelector('button:not(:disabled)'); if (f) f.focus();
  }
  function closeCellMenu() { var m = root && root.querySelector('#ws-ctx'); if (m) m.remove(); }
  // Insert gap above … / Close gap: how many (N5: the gap goes ABOVE the selected cell)
  function gapDialog(s) {
    var sc = modal('<h3>Insert gap above</h3><p>Empty cells are put <b>above</b> ' + (s.key ? '“' + esc(baseName(s.key)) + '”' : 'the selected cell') + ' in <b>' + esc(s.c.name) + '</b> (' + esc(rowLabel(s.row)) + '). This cell and everything below it in this copy move down. The other copies stay as they are.</p>' +
      '<label class="inl">How many empty cells <input type="number" id="gapN" min="1" max="999" value="1"></label>' +
      '<div class="acts"><button class="ws-tb" data-close>Cancel</button><button class="ws-tb primary" id="gap-ok">Insert</button></div>');
    var inp = sc.querySelector('#gapN'), go = function () {
      var n = Math.max(1, Math.min(999, parseInt(inp.value, 10) || 1)); closeModal();
      commit(); insertGap(s.c, s.row, n); changed(); toast('Inserted ' + n + ' empty cell' + (n > 1 ? 's' : '') + ' above ' + rowLabel(s.row + n) + '.', true);
    };
    sc.querySelector('#gap-ok').onclick = go;
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); go(); } });
    inp.focus(); inp.select();
  }
  function closeGapAction(s) {
    var run = 0; while (s.row + run < s.c.cells.length && s.c.cells[s.row + run] == null) run++;
    var doIt = function (n) { commit(); var k = closeGap(s.c, s.row, n); trim(s.c); changed(); toast(k ? 'Closed ' + k + ' empty cell' + (k > 1 ? 's' : '') + '.' : 'Nothing to close.', true); };
    if (run <= 1) return doIt(1);
    var sc = modal('<h3>Close gap</h3><p>' + run + ' empty cells follow each other here in <b>' + esc(s.c.name) + '</b>. How many should be removed? The pages below move up.</p>' +
      '<label class="inl">Empty cells to remove <input type="number" id="cgN" min="1" max="' + run + '" value="' + run + '"></label>' +
      '<div class="acts"><button class="ws-tb" data-close>Cancel</button><button class="ws-tb primary" id="cg-ok">Close gap</button></div>');
    var inp = sc.querySelector('#cgN'), go = function () { var n = Math.max(1, Math.min(run, parseInt(inp.value, 10) || 1)); closeModal(); doIt(n); };
    sc.querySelector('#cg-ok').onclick = go;
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); go(); } });
    inp.focus(); inp.select();
  }
  // a double-click on a cell (item 20): this page of this copy against the same row of the reference copy
  function compareWithRef(ci, row) {
    var c = S.copies[ci]; if (!c || !c.cells[row]) return;
    var ref = S.ref != null ? copyById(S.ref) : null;
    S.sel.ci = ci; S.sel.row = row; anchor = null;
    if (ref && ref !== c && ref.cells[row]) S.pair = [ref.id, c.id];
    else if (S.pair[0] === c.id || S.pair[1] === c.id) { /* keep the marked pair */ }
    else if (S.pair[0] != null) S.pair = [S.pair[0], c.id];
    touch(); renderAll();
    if (canCompare()) compareNow();
    else toast(ref ? 'The reference copy has no page in this row.' : 'Choose a reference copy first (right-click a page of a copy → Make it the reference copy), or mark two pages with “1” and “2”.');
  }

  function nameList(list) {
    var names = list.map(function (c) { return c.name; });
    return esc(names.length > 4 ? names.slice(0, 4).join(', ') + ' and ' + (names.length - 4) + ' more' : names.join(', '));
  }
  function renderSummary() {
    var lost = S.copies.filter(copyLost), bn = $('#ws-banner'), used = usedRoots();
    var allow = used.filter(function (r) { return r.handle && !r.ok; }), find = used.filter(function (r) { return !r.handle && !r.files; });
    bn.hidden = !lost.length || (!allow.length && !find.length);
    if (bn.hidden) return;
    var h = '';
    if (allow.length) h += '<span>The browser locks your scans after a restart (<b>' + nameList(lost) + '</b>). Pictures you have seen before are still shown. When you compare two pages the browser asks for permission by itself; to see every page now, allow access here. <i>Tip: choose “Allow on every visit” when Chrome or Edge asks, or install the website as an app (the symbol at the right of the address bar): then it does not ask again.</i></span><button class="ws-tb primary" data-act="allow">Allow access now</button>';
    if (find.length) h += '<span>' + (allow.length ? 'For some copies the folder is not known on this computer. ' : 'Book Compare cannot find the scans of <b>' + nameList(lost) + '</b> on this computer. ') + 'Choose the folder that holds them (one choice is enough for all copies inside it).</span><button class="ws-tb' + (allow.length ? '' : ' primary') + '" data-act="reconnect">Choose scan folder …</button>';
    else if (allow.length > 1) h += '<button class="ws-tb" data-act="reconnect" title="Pick the folder that holds all your copies once. After that a single permission is enough.">Choose one folder for all …</button>';
    bn.innerHTML = h;
  }
  function renderGridShell() {
    var gb = $('#ws-gridbox');
    ROW_H = S.thumbs ? 96 : 40;                                       // 0.11.0: taller rows with a small picture of every page
    if (root) { root.style.setProperty('--ws-rowh', ROW_H + 'px'); root.classList.toggle('ws-pics', !!S.thumbs); }
    if (!S.copies.length) {
      gb.innerHTML = '<div class="ws-empty"><h2>No copies yet</h2><p>Add the first copy to start. Each copy is one folder of scans on your disk. You can add the others one by one afterwards.</p><div class="acts"><button class="ws-tb primary" data-act="add" style="padding:10px 18px;font-size:15px">Add first copy</button><button class="ws-tb" data-act="openproj" style="padding:10px 18px;font-size:15px">Open project …</button>' +
        (lastProject ? '<button class="ws-tb" data-act="continue" style="padding:10px 18px;font-size:15px">Continue “' + esc(lastProject.name) + '”</button>' : '') + '</div></div>';
      return;
    }
    var w = gridW(), stH = storedEntries();
    var h = '<div class="ws-vp" id="ws-vp" tabindex="0" aria-label="Page grid. Arrow keys move the selection."><div class="ws-inner" id="ws-inner" style="width:' + w + 'px;height:' + (HEAD_H + rows() * ROW_H) + 'px">';
    root.style.setProperty('--ws-lblw', lblW() + 'px');
    h += '<div class="ws-hrow" style="width:' + w + 'px"><div class="ws-corner">Page<div class="ws-rz" data-c="lbl" title="Drag to change the width of this column. Double-click: fit the names of the rows."></div></div>';
    S.copies.forEach(function (c, i) {
      var cnt = 0; c.cells.forEach(function (x) { if (x) cnt++; });
      var k = c.id === S.pair[0] ? ' k1' : c.id === S.pair[1] ? ' k2' : '', lost = copyLost(c);
      // 0.16.0 (owner): copy 1 and copy 2 have their colour as the background of the heading, "★" in front of the reference copy's
      // name, "1" or "2" after it; the number of files only when the copy lacks pages
      var star = c.id === S.ref ? '<span class="ws-star" title="Reference copy: the other copies are aligned onto it (to choose another one: right-click a page of that copy → Make it the reference copy)">★</span>' : '';
      var num = k ? '<b class="ws-hpm" title="' + (k === ' k1' ? 'Copy 1' : 'Copy 2') + ' in the Compare tab">' + (k === ' k1' ? '1' : '2') + '</b>' : '';
      var meta = lost ? lostWhy(c) : [cnt < rows() ? cnt + ' file' + (cnt === 1 ? '' : 's') + ' in grid' : '', storedCount(stH, c)].filter(Boolean).join(' · ');
      h += '<div class="ws-hcell' + k + '" draggable="true" data-c="' + i + '" style="width:' + cw(c) + 'px;flex-basis:' + cw(c) + 'px" title="Drag the heading to move this column"><div class="ws-hline">' + star + '<div class="ws-hname" data-act="rename" data-c="' + i + '" title="Click to rename">' + esc(c.name) + '</div>' + num + '</div><div class="ws-hmeta' + (lost ? ' lost' : '') + '">' + meta + '</div><button class="x" data-act="remove" data-c="' + i + '" aria-label="Remove copy ' + esc(c.name) + '" title="Remove this copy from the project (your scan files are not touched)">&times;</button><div class="ws-rz" data-c="' + i + '" title="Drag to change the width of this column. Double-click: fit the file names."></div></div>';
    });
    h += '<div class="ws-addcell"><button class="ws-addbtn" data-act="add"><span class="plus">+</span><small>Add new copy</small></button></div></div><div id="ws-rowshost"></div></div></div>';
    gb.innerHTML = h;
    $('#ws-vp').addEventListener('scroll', renderRows);
  }
  function flagMark(i) {                                              // the small flag at the right edge of a row label
    var f = S.flags[i]; if (f == null) return '';
    return '<svg class="ws-flag" viewBox="0 0 24 24" width="15" height="15" role="img" style="color:' + FLAG_COLORS[f] + '"><title>Flagged (' + FLAG_NAMES[f] + ')</title><path fill="currentColor" d="' + FLAG_PATH + '"/></svg>';
  }
  // Stored alignments (item 21, desktop program): a small dot in a cell whose page is aligned onto the reference copy and stored
  var stLoad = null;
  function storedEntries() {
    if (!proj.target || !window.BCResults || !BCResults.available()) return null;
    return BCResults.storedSync();
  }
  function isStored(st, c, row, key) {
    if (!st || !key) return false;
    var b = refFor(row); if (b == null || b === c.id) return false;
    var rc = copyById(b), rk = rc && rc.cells[row]; if (!rk) return false;
    var e = st[BCResults.nameFor({ c0: b, k0: rk, c1: c.id, k1: key })];
    return !!(e && typeof e.valid === 'string' && e.valid.indexOf(BCResults.ENGINE + '|') === 0);
  }
  function storedCount(st, c) {
    if (!st) return '';
    var b = 0, n = 0;
    for (var r = 0; r < c.cells.length; r++) { if (!c.cells[r]) continue; var f = refFor(r); if (f == null || f === c.id) continue; n++; if (isStored(st, c, r, c.cells[r])) b++; }
    return n && b ? b + ' aligned' : '';
  }
  var soonT = 0;
  function renderAllSoon() { if (soonT) return; soonT = setTimeout(function () { soonT = 0; if (root && !root.hidden) renderAll(); }, 1200); }   // (at most about once a second while helpers store pages)
  document.addEventListener('bcresultschange', renderAllSoon);
  function renderRows() {
    var vp = $('#ws-vp'), host = $('#ws-rowshost'); if (!vp || !host) return;
    var N = rows(), top = vp.scrollTop, vh = vp.clientHeight, stE = storedEntries();
    var a = Math.max(0, Math.floor((top - HEAD_H) / ROW_H) - OVERSCAN), b = Math.min(N - 1, Math.ceil((top + vh) / ROW_H) + OVERSCAN), h = '';
    var lostC = S.copies.map(copyLost), rg = range();
    for (var i = a; i <= b; i++) {
      var n = 0, cells = '';
      S.copies.forEach(function (c, ci) {
        var key = c.cells[i] || null, sel = (S.sel.ci === ci && S.sel.row === i) ? ' sel' : (rg && rg.ci === ci && i >= rg.lo && i <= rg.hi ? ' rng' : ''), wst = ' style="width:' + cw(c) + 'px;flex-basis:' + cw(c) + 'px"';
        var pm = c.id === S.pair[0] ? ' p1' : c.id === S.pair[1] ? ' p2' : '';            // (0.16.0: a light tint of the copy's colour, no "1"/"2" in every cell)
        // 0.17.0 (owner): a small check mark (not a dot) for a page that is aligned onto the reference copy and stored
        var dot = isStored(stE, c, i, key) ? '<svg class="ws-st" viewBox="0 0 16 16" width="13" height="13" role="img" aria-label="aligned"><title>Aligned onto the reference copy and stored: comparing it with the reference opens at once</title><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M3.5 8.5l3 3 6-7"/></svg>' : '';
        var pic = '';                                     // (0.17.0, owner: no grey page symbol before the file name; thumbnails on request)
        if (key && S.thumbs) { var tu = thumbUrlNow(c, key); pic = '<span class="tn" data-mk="' + esc(c.id + '|' + key) + '">' + (tu ? '<img alt="" src="' + tu + '">' : '') + '</span>'; }
        if (key) { n++; cells += '<div class="ws-cell filled' + pm + (lostC[ci] ? ' lostc' : '') + sel + '" draggable="true" data-c="' + ci + '" data-r="' + i + '"' + wst + '>' + pic + '<span class="fn" title="' + esc(key) + '">' + esc(baseName(key)) + '</span>' + dot + '</div>'; }
        else cells += '<div class="ws-cell empty' + pm + sel + '" data-c="' + ci + '" data-r="' + i + '"' + wst + '><span class="gap">no page</span></div>';
      });
      var sk = !!S.skip[i], small = sk ? 'not compared' : (i === S.ns && S.ns > 0 ? 'starts here' : n < S.copies.length ? n + ' of ' + S.copies.length + ' copies' : '');   // (0.16.0: only when a copy lacks the page)
      h += '<div class="ws-row' + (S.sel.row === i ? ' selrow' : '') + (sk ? ' skipped' : '') + (i === S.ns && S.ns > 0 ? ' numstart' : '') + '" style="top:' + (HEAD_H + i * ROW_H) + 'px" data-r="' + i + '"><div class="ws-lbl" data-act="lbl" data-r="' + i + '"><b>' + esc(rowLabel(i)) + '</b><small>' + small + '</small>' + flagMark(i) + '</div>' + cells + '</div>';
    }
    host.innerHTML = h;
    if (S.thumbs) fillGridPics(a, b);
  }
  // the small pictures in the grid: the ones already made are put in at once, the others when they are ready
  function thumbUrlNow(c, key) { var mk = c.id + '|' + key; return thumbMem.has(mk) ? thumbUrl.get(mk) || null : null; }
  function fillGridPics(a, b) {
    for (var i = a; i <= b; i++) S.copies.forEach(function (c, ci) {
      var key = c.cells[i]; if (!key || thumbUrlNow(c, key)) return;
      thumbPromise(c, key).then(function (r) {
        if (!S.thumbs || !r || !r.url) return;
        var el = root.querySelector('.ws-cell[data-c="' + ci + '"][data-r="' + i + '"] .tn');
        if (el && el.dataset.mk === c.id + '|' + key && !el.firstChild) el.innerHTML = '<img alt="" src="' + r.url + '">';
      });
    });
  }
  var pvTok = 0;
  function renderPreview() {
    var tok = ++pvTok, row = S.sel.row, h = '';
    $('#ws-pvtitle').textContent = S.copies.length ? rowLabel(row) : 'Row';
    var sub = !S.copies.length ? 'Previews appear here.' : S.skip[row] ? 'This row will not be compared.' : 'The same page in every copy. Mark two with “1” and “2” (or right-click a copy → Make it copy 1 / copy 2), then compare them.';
    $('#ws-pvsub').innerHTML = '<span class="txt">' + esc(sub) + '</span>';      // (0.17.0, owner: no "Swap 1 and 2" button)
    S.copies.forEach(function (c, ci) {
      var key = c.cells[row] || null;
      if (!key) { h += '<div class="ws-th miss"><div class="pg">no page in this copy</div><div class="nm">' + esc(c.name) + '</div></div>'; return; }
      var cls = (ci === S.sel.ci ? ' cur' : '') + (c.id === S.pair[0] ? ' p1' : c.id === S.pair[1] ? ' p2' : '');
      h += '<div class="ws-th' + cls + '"><div class="pg" data-ci="' + ci + '" data-act="selcell"><span class="ws-nopv">Loading …</span></div><div class="nm">' + esc(c.name) + '</div><div class="fnm" title="' + esc(key) + '">' + esc(baseName(key)) + '</div>' +
        '<div class="pick"><button data-act="pick" data-ci="' + ci + '" data-slot="0" class="' + (c.id === S.pair[0] ? 'on1' : '') + '" title="Use this page as copy 1">1</button><button data-act="pick" data-ci="' + ci + '" data-slot="1" class="' + (c.id === S.pair[1] ? 'on2' : '') + '" title="Use this page as copy 2">2</button></div></div>';
    });
    $('#ws-thumbs').innerHTML = h;
    for (var ci = S.copies.length - 1; ci >= 0; ci--) {
      (function (c, ci) {
        var key = c.cells[row]; if (!key) return;
        var pg = root.querySelector('#ws-thumbs .pg[data-ci="' + ci + '"]');
        thumbPromise(c, key).then(function (r) {
          if (tok !== pvTok || !pg || !pg.isConnected) return;
          if (r && r.url) pg.innerHTML = '<img alt="" src="' + r.url + '">';
          else pg.innerHTML = '<span class="ws-nopv">' + (r && r.err === 'lost' ? (HELPER ? 'Book Compare cannot read the scans right now' : 'Not seen before: needs access to the scans') : esc((r && r.msg) || 'Not available')) + '</span>' +
            '<button class="ws-rl" data-act="reload" data-ci="' + ci + '" title="Try to load this picture again">Reload</button>';
        });
      })(S.copies[ci], ci);
    }
  }
  function renderBar() {
    var ok = canCompare();
    $('#ws-compare').classList.toggle('notready', !ok);
    var t = $('#ws-title'); if (t && document.activeElement !== t && t.value !== (S.title || '')) t.value = S.title || '';
    fitTitle();
  }
  function renderAll() {
    if (!root) return;
    renderToolbar(); renderSummary();
    var vp = $('#ws-vp'), st = vp ? vp.scrollTop : 0, sl = vp ? vp.scrollLeft : 0;
    renderGridShell();
    var v = $('#ws-vp'); if (v) { v.scrollTop = st; v.scrollLeft = sl; renderRows(); }
    renderPreview(); renderBar(); renderSave();
    keepFocus();
  }
  function keepFocus() {
    // redrawing the toolbar removes the button that was clicked; without this the keyboard shortcuts would stop working
    if (!root || root.hidden || $('#ws-scrim')) return;
    var a = document.activeElement;
    if (!a || a === document.body || !root.contains(a)) { var v = $('#ws-vp'); if (v) v.focus({ preventScroll: true }); }
  }
  function selectCell(ci, row) { anchor = null; S.sel = { ci: ci, row: row }; renderToolbar(); renderRows(); renderPreview(); renderBar(); keepFocus(); }
  // Shift + click / Shift + arrow: mark everything from where Shift began down (or up) to this row, in one column
  function extendTo(ci, row) {
    if (S.sel.ci == null || ci !== S.sel.ci) return selectCell(ci, row);
    if (!anchor || anchor.ci !== ci) anchor = { ci: ci, row: S.sel.row };
    S.sel = { ci: ci, row: row };
    renderToolbar(); renderRows(); renderPreview(); renderBar(); keepFocus();
  }
  function ensureColVisible(ci) {
    var vp = $('#ws-vp'), c = S.copies[ci]; if (!vp || !c) return;
    var l = colLeft(ci), r = l + cw(c);
    if (l < vp.scrollLeft + lblW()) vp.scrollLeft = Math.max(0, l - lblW());
    else if (r > vp.scrollLeft + vp.clientWidth) vp.scrollLeft = r - vp.clientWidth;
  }
  function ensureVisible(row) {
    var vp = $('#ws-vp'); if (!vp) return;
    var t = HEAD_H + row * ROW_H;
    if (t < vp.scrollTop + HEAD_H) vp.scrollTop = Math.max(0, t - HEAD_H);
    else if (t + ROW_H > vp.scrollTop + vp.clientHeight) vp.scrollTop = t + ROW_H - vp.clientHeight;
    renderRows();
  }

  /* ---------------------------------------------------------------- messages and dialogs */
  var toastT = null;
  function toast(msg, withUndo) {
    if (root.hidden && window.CompareTab && CompareTab.isOpen && CompareTab.isOpen()) return CompareTab.toast(msg);   // the Compare tab is on screen
    var old = $('#ws-toast'); if (old) old.remove();
    var d = document.createElement('div'); d.id = 'ws-toast'; d.className = 'ws-toast' + ($('#ws-scrim') ? ' top' : ''); d.setAttribute('role', 'status');
    d.innerHTML = '<span>' + esc(msg) + '</span>' + (withUndo ? '<button data-act="undo">Undo</button>' : '');
    root.appendChild(d); clearTimeout(toastT); toastT = setTimeout(function () { d.remove(); }, withUndo ? 7000 : 4500);
  }
  function modal(html) {
    closeModal();
    var sc = document.createElement('div'); sc.className = 'ws-scrim'; sc.id = 'ws-scrim';
    sc.innerHTML = '<div class="ws-dlg" role="dialog" aria-modal="true">' + html + '</div>';
    if (root.hidden) {                                                                      // asked from the Compare tab: the Pages layer is hidden
      var fl = document.createElement('div'); fl.className = 'ws ws-float'; fl.id = 'ws-float';
      fl.addEventListener('click', onClick);                                                // (data-close and the other buttons work as in the layer)
      fl.appendChild(sc); document.body.appendChild(fl);
    } else $('#ws-layer').appendChild(sc);
    sc.addEventListener('mousedown', function (e) { if (e.target === sc) closeModal(); });
    return sc;
  }
  function closeModal() {
    var s = root && ($('#ws-scrim') || document.getElementById('ws-scrim')); if (s) s.remove();
    var fl = document.getElementById('ws-float'); if (fl) fl.remove();
  }
  function confirmDialog(title, text, okLabel) {
    return new Promise(function (resolve) {
      var sc = modal('<h3>' + esc(title) + '</h3><p>' + text + '</p><div class="acts"><button class="ws-tb" id="cf-no">Cancel</button><button class="ws-tb primary" id="cf-yes">' + esc(okLabel) + '</button></div>');
      sc.querySelector('#cf-no').onclick = function () { closeModal(); resolve(false); };
      sc.querySelector('#cf-yes').onclick = function () { closeModal(); resolve(true); };
    });
  }
  function helpDialog() {
    modal('<h3>How this screen works</h3><ul>' +
      '<li>The <b>name of the project</b> goes into the field at the top left. It is shown in both tabs and proposed as the name of the project file.</li>' +
      '<li><b>Saving:</b> once the project has a file (⋮ → Save project …), every change is saved into it by itself, about a second after you make it. The chip next to the name says “✓ Saved”; its tooltip gives the time. Ctrl+S saves at once.</li>' +
      '<li>Each <b>column</b> is one copy: a folder of scans on your disk. Each <b>row</b> is one page position. The pages in a row will be compared with each other.</li>' +
      '<li>Book Compare only <b>reads</b> your scan folders. Everything you do here (gaps, renaming, deleting files) changes only the project, never a scan file.</li>' +
      '<li>A copy with missing pages has <b>empty cells</b>. Select a cell and use <b>Insert gap here</b> to push the following files down, or <b>Close gap</b> to pull them up.</li>' +
      '<li>Covers, flyleaves and duplicates can be removed from the grid with <b>Delete file</b>. The scan itself stays on your disk, and <b>Add files to this copy</b> brings it back.</li>' +
      '<li><b>Add files to this copy</b> also adds pictures from another folder, for example pages that were scanned later.</li>' +
      '<li><b>Right-click a cell</b> for everything else about that cell, its copy and its row (add files, move or rename the copy, make it the reference copy, start numbering, don’t compare a row).</li>' +
      '<li>The headings of <b>copy 1</b> and <b>copy 2</b> (the two pages the Compare tab shows) have their colours and the number 1 or 2 after the name; their columns are lightly tinted.</li>' +
      '<li>The <b>reference copy</b> (★ in its heading) is the copy the others are compared with; right-click a page of a copy → <b>Make it the reference copy</b> chooses it. ' + (HELPER ? 'The button <b>Align in the background</b> aligns the other copies onto it page by page and keeps the results in the project file, so that comparisons with the reference open at once.' : 'In the desktop program the other copies can be aligned onto it in the background.') + '</li>' +
      '<li>What the comparison cannot show (light inks such as red, small shifts, ...) is explained in the help of the Compare tab (its “?” button), under “What the comparison cannot show”.</li>' +
      '<li>Rows are positions in the book, not tied to any copy. If the first rows hold a cover or flyleaf, select the row of the first printed page and choose <b>Start numbering at this row</b>: you decide there between pagination (Page 1, 2, 3 …) and foliation (1r, 1v, 2r …). You can switch later in the menu <b>⋮</b>. Double-click a row name to rename it.</li>' +
      '<li><b>Don’t compare this row</b> keeps a row in the grid but leaves it out of the comparison.</li>' +
      '<li>On the right you see the page of every copy in the selected row. Mark two of them with <b>1</b> and <b>2</b>, then press the tab <b>Compare</b> at the top: they open in the <b>Compare tab</b>, which aligns them by itself. There you can go through the book page by page, flag pages (key F), draw circles, rectangles and notes on the superimposed picture, and see the whole book on the book map. The arrows button at the top right (<b>focus mode</b>) hides everything except the pictures; Esc brings it back. The tab <b>Pages</b> brings you here again.</li>' +
      '<li>When you reopen a saved project the browser asks once for permission to read your scans again. Click <b>Allow access to scans</b>; you do not have to pick the folders again.</li>' +
      '<li><b>Delete several files at once:</b> click the first cell, hold <b>Shift</b> and click the last one (or press Shift + the up/down arrow). The whole range is marked; <b>Delete</b> removes it and the pages below move up.</li>' +
      '<li><b>Column width:</b> drag the right edge of a column heading; a double-click fits the longest file name. <b>⋮ → Standard width for all columns</b> resets them.</li>' +
      '<li><b>Pictures in the grid</b> (toolbar) shows a small picture of every page in the cells; the rows get taller. It is kept in the project.</li>' +
      '<li><b>Moving a copy:</b> drag its heading to another place, or use <b>Move copy</b> in the toolbar. Undo works for this too.</li>' +
      '<li>If a preview says it could not be loaded, press <b>Reload</b> under it. Ctrl+Z undoes the last change. Arrow keys move the selection.</li>' +
      '</ul>' +
      '<div class="acts"><button class="ws-tb primary" data-close>Got it</button></div>');
  }

  /* folder chooser used by the "Add a copy" and "Add files" dialogs */
  function knownSources(extra) {
    var out = [], seen = {}, ex = {};
    (extra || []).forEach(function (l) { ex[l.root] = true; });
    function add(r, path, label) { var k = r.id + '|' + path; if (seen[k]) return; seen[k] = 1; out.push({ root: r, path: path, label: label }); }
    var used = usedRoots();
    S.roots.forEach(function (r) { if ((r.handle || r.files) && (used.indexOf(r) >= 0 || ex[r.id])) add(r, '', r.name); });
    (extra || []).forEach(function (l) { var r = rootById(l.root); if (r && (r.handle || r.files) && l.path) add(r, l.path, r.name + ' / ' + l.path.replace(/\//g, ' / ')); });
    return out;
  }
  function srcBlock(p) {
    return '<div class="row2"><select id="' + p + '-known" aria-label="Folders used so far"></select><button class="ws-tb" id="' + p + '-folder">Choose another folder …</button>' +
      (canPickFiles() ? '<button class="ws-tb" id="' + p + '-files" title="Opens the ordinary Windows “Open” window: choose one picture, or several with Ctrl- or Shift-click">Add single pictures …</button>' : '') + '</div>' +
      '<div id="' + p + '-info" class="note">No folder chosen</div>';
  }
  function wireSrc(sc, p, extra, onPick) {
    var sel = sc.querySelector('#' + p + '-known'), info = sc.querySelector('#' + p + '-info'), err = sc.querySelector('#' + p + '-err'), list = [];
    function rebuild(cur) {
      list = knownSources(extra);
      var h = '<option value="">' + (list.length ? 'Folders used so far …' : 'No folder chosen yet') + '</option>';
      list.forEach(function (x, i) { h += '<option value="' + i + '"' + (cur === x.root.id + '|' + x.path ? ' selected' : '') + '>' + esc(x.label) + '</option>'; });
      sel.innerHTML = h; sel.disabled = !list.length;
    }
    async function choose(x) {
      err.textContent = ''; info.textContent = 'Reading folder …';
      try {
        if (!(await ensureAccess(x.root))) throw refusal('The browser did not give access to “' + x.root.name + '”.');
        var g = await scanLoc(x.root, x.path);
        rebuild(x.root.id + '|' + x.path);
        onPick({ root: x.root, path: x.path, name: x.path ? x.path.split('/').pop() : x.root.name, groups: g.groups, ignored: g.ignored });
      } catch (e) { info.textContent = 'No folder chosen'; err.textContent = niceError(e); }
    }
    sel.onchange = function () { var x = list[+sel.value]; if (x) choose(x); };
    sc.querySelector('#' + p + '-folder').onclick = function () {
      err.textContent = '';
      pickScanFolder().then(function (pk) {
        if (!pk) return;
        extra.push({ root: pk.root.id, path: pk.path });
        rebuild(pk.root.id + '|' + pk.path);
        onPick(pk);
      }, function (e) { if (e && e.name === 'AbortError') return; err.textContent = niceError(e); info.textContent = 'No folder chosen'; });
    };
    var fb = sc.querySelector('#' + p + '-files');
    if (fb) fb.onclick = function () {
      err.textContent = '';
      pickScanFiles().then(function (pk) {
        extra.push({ root: pk.root.id, path: pk.path });
        rebuild(pk.root.id + '|' + pk.path);
        onPick(pk);
      }, function (e) { if (e && e.name === 'AbortError') return; err.textContent = niceError(e); });
    };
    rebuild('');
    return { choose: choose, info: info };
  }
  function usedPictures(rootId) {          // path from the root -> name of the copy that already has this picture
    var m = {};
    S.copies.forEach(function (c) {
      (c.keys || []).forEach(function (k) { var sk = splitKey(k), l = c.locs && c.locs[sk.n]; if (l && l.root === rootId) m[joinPath(l.path, sk.rel)] = c.name; });
    });
    return m;
  }
  function pictureCount(groups) { var t = 0; groups.forEach(function (g) { t += g.keys.length; }); return t; }
  function ignoredNote(n) { return n ? ' (' + n + ' other image file' + (n === 1 ? '' : 's') + ' such as TIFF are ignored: only JPG and PNG work)' : ''; }

  function addDialog() {
    var picked = null, extra = [];
    var sc = modal('<h3>Add a copy</h3>' +
      '<label>Name of the copy<input type="text" id="ac-name" autocomplete="off" placeholder="e. g. Austria, Austrian National Library"></label>' +
      srcBlock('ac') +
      '<div id="ac-groups"></div>' +
      '<label>Place the first file at row<input type="number" id="ac-start" min="1" value="1"></label>' +
      '<p class="note">One file per row, in name order; you fix the order in the grid. Book Compare only reads the folder.</p>' +
      '<div class="err" id="ac-err"></div>' +
      '<div class="acts"><button class="ws-tb" data-close>Cancel</button><button class="ws-tb primary" id="ac-ok">Add copy</button></div>');
    // Whole folders are the usual way (a folder with one tick takes all its pictures); a folder can also be opened to take single pictures.
    function chosenKeys(g) { return g.keys.filter(function (k) { return g.chosen && g.chosen[k]; }); }
    function syncGroup(gr, i) {
      var g = picked.groups[i], n = chosenKeys(g).length, box = gr.querySelector('input[data-g="' + i + '"]'), cnt = gr.querySelector('[data-gn="' + i + '"]');
      if (box) { box.checked = n === g.keys.length; box.indeterminate = n > 0 && n < g.keys.length; }
      if (cnt) cnt.textContent = (n > 0 && n < g.keys.length ? n + ' of ' + g.keys.length : g.keys.length) + (g.by ? ' · already used by ' + g.by : '');
    }
    function fillFiles(gr, i) {
      var list = gr.querySelector('[data-gl="' + i + '"]'), g = picked.groups[i]; if (!list || list.dataset.done) return;
      list.dataset.done = '1';
      var h = ''; g.keys.forEach(function (k, j) { h += '<label class="inl"><input type="checkbox" data-gi="' + i + '" data-j="' + j + '"' + (g.chosen[k] ? ' checked' : '') + '><span class="mono">' + esc(baseName(k)) + '</span></label>'; });
      list.innerHTML = h;
    }
    function showPicked(pk) {
      picked = pk;
      var info = sc.querySelector('#ac-info'), gr = sc.querySelector('#ac-groups');
      if (!pk.groups.length) { info.textContent = 'No JPG or PNG files found in “' + pk.name + '” or in the folders directly inside it.'; gr.innerHTML = ''; return; }
      var total = pictureCount(pk.groups), used = usedPictures(pk.root.id);
      info.textContent = pk.only ? total + ' single picture' + (total === 1 ? '' : 's') + ' chosen in “' + pk.name + '”' : '“' + pk.name + '”: ' + total + ' picture' + (total === 1 ? '' : 's') + ignoredNote(pk.ignored);
      pk.groups.forEach(function (g) {
        g.chosen = {}; if (pk.groups.length === 1 || !g.path) g.keys.forEach(function (k) { g.chosen[k] = true; });          // one folder, or the pictures directly in the chosen folder (0.11.0): ticked at first
        g.by = used[joinPath(pk.path, g.keys[0])] || '';
      });
      var h = '<div class="note">' + (pk.groups.length === 1 ? 'Folder used:' : 'The pictures are in several folders. Tick the ones that belong to this copy:') + '</div><div class="groups big">';
      pk.groups.forEach(function (g, i) {
        h += '<details data-gi="' + i + '"><summary><label><input type="checkbox" data-g="' + i + '"' + (pk.groups.length === 1 || !g.path ? ' checked' : '') + '> ' + (g.path ? esc(g.path) : 'directly in “' + esc(pk.name) + '”') + ' <span class="note">· <span data-gn="' + i + '"></span></span></label></summary><div class="flist" data-gl="' + i + '"></div></details>';
      });
      gr.innerHTML = h + '</div><div class="note">Only some of the pictures? Click the little arrow in front of a folder and tick them one by one.</div>';
      pk.groups.forEach(function (g, i) { syncGroup(gr, i); });
    }
    (function () {                                                           // wired once; the lists are rebuilt for every folder that is chosen
      var gr = sc.querySelector('#ac-groups');
      gr.addEventListener('change', function (e) {
        var t = e.target, i;
        if (!picked) return;
        if (t.dataset.g != null) {                                           // a whole folder
          i = +t.dataset.g; var g = picked.groups[i]; g.chosen = {}; if (t.checked) g.keys.forEach(function (k) { g.chosen[k] = true; });
          Array.prototype.forEach.call(gr.querySelectorAll('input[data-gi="' + i + '"]'), function (x) { x.checked = t.checked; });
          syncGroup(gr, i);
        } else if (t.dataset.j != null) {                                    // one picture
          i = +t.dataset.gi; var g2 = picked.groups[i], k = g2.keys[+t.dataset.j]; if (t.checked) g2.chosen[k] = true; else delete g2.chosen[k];
          syncGroup(gr, i);
        }
      });
      gr.addEventListener('toggle', function (e) { var d = e.target; if (picked && d && d.tagName === 'DETAILS' && d.open) fillFiles(gr, +d.dataset.gi); }, true);
    })();
    wireSrc(sc, 'ac', extra, showPicked);
    function finish() {
      var name = sc.querySelector('#ac-name').value.trim(), err = sc.querySelector('#ac-err');
      if (!name) { err.textContent = 'Give the copy a name, for example “Austria, Austrian National Library”.'; sc.querySelector('#ac-name').focus(); return; }
      if (S.copies.some(function (c) { return c.name.toLowerCase() === name.toLowerCase(); })) { err.textContent = 'A copy with this name already exists.'; return; }
      if (!picked) { err.textContent = 'Choose the scan folder of this copy first.'; return; }
      var keys = []; picked.groups.forEach(function (g) { keys = keys.concat(chosenKeys(g)); });
      if (!keys.length) { err.textContent = picked.groups.length ? 'Tick at least one folder or picture.' : 'That folder has no JPG or PNG files.'; return; }
      keys.sort(nat);
      var start = Math.max(1, parseInt(sc.querySelector('#ac-start').value, 10) || 1), cells = [];
      for (var i = 1; i < start; i++) cells.push(null);
      commit();
      var c = { id: S.nextCopy++, name: name, folder: picked.name, locs: [{ root: picked.root.id, path: picked.path }], keys: keys.slice(), cells: cells.concat(keys) };
      REG[c.id] = c; S.copies.push(c);
      ensurePair();
      S.sel = { ci: S.copies.length - 1, row: start - 1 };
      closeModal(); changed(); toast('Added ' + name + ' with ' + keys.length + ' file' + (keys.length === 1 ? '' : 's') + '.', true);
    }
    sc.querySelector('#ac-ok').onclick = finish;
    sc.querySelector('#ac-name').addEventListener('keydown', function (e) { if (e.key === 'Enter') finish(); });
    sc.querySelector('#ac-name').focus();
  }

  function addFilesDialog() {
    var s = selected();
    if (!s) return toast('Select a cell of the copy first.');
    var c = s.c, extra = (c.locs || []).map(function (l) { return { root: l.root, path: l.path }; }), pk = null, n = -1, groups = [], checked = {};
    var startRow = s.key ? 0 : s.row + 1;                                     // 0 = at the end
    var sc = modal('<h3>Add files to ' + esc(c.name) + '</h3>' +
      '<p class="note">Pages you deleted, or pages stored in another folder.</p>' +
      srcBlock('af') +
      '<div id="af-list"></div>' +
      '<fieldset class="place"><legend>Where should they go?</legend>' +
      '<label class="inl"><input type="radio" name="af-where" value="end"' + (startRow ? '' : ' checked') + '> At the end of the copy</label>' +
      '<label class="inl"><input type="radio" name="af-where" value="row"' + (startRow ? ' checked' : '') + '> Starting at row <input type="number" id="af-row" min="1" value="' + (startRow || s.row + 1) + '"> <span class="note" id="af-rowlbl"></span></label>' +
      '</fieldset><p class="note">Empty cells are filled first; where a cell is taken, the pages below move down.</p>' +
      '<div class="err" id="af-err"></div>' +
      '<div class="acts"><button class="ws-tb" data-close>Cancel</button><button class="ws-tb primary" id="af-ok">Add files</button></div>');
    var listEl = sc.querySelector('#af-list'), rowIn = sc.querySelector('#af-row');
    function rowNote() { var r = parseInt(rowIn.value, 10); sc.querySelector('#af-rowlbl').textContent = r > 0 ? '(' + rowLabel(r - 1) + ')' : ''; }
    rowIn.oninput = function () { sc.querySelector('input[name=af-where][value=row]').checked = true; rowNote(); };
    rowNote();
    function count() { var t = 0; Object.keys(checked).forEach(function (k) { if (checked[k]) t++; }); return t; }
    function updCount() { var e = sc.querySelector('#af-cnt'); if (e) e.textContent = count() + ' selected'; }
    function showFiles(p) {
      pk = p; checked = {}; n = -1;
      for (var i = 0; i < c.locs.length; i++) if (c.locs[i].root === p.root.id && c.locs[i].path === p.path) { n = i; break; }
      var inGrid = {}; c.cells.forEach(function (k) { if (k) inGrid[k] = true; });
      groups = [];
      p.groups.forEach(function (g) {
        var ks = g.keys.filter(function (rel) { return !(n >= 0 && inGrid[joinKey(n, rel)]); });
        if (ks.length) groups.push({ path: g.path, keys: ks });
      });
      var info = sc.querySelector('#af-info'), total = pictureCount(groups);
      if (!total) { info.textContent = 'All pictures of “' + p.name + '” are already in the grid of this copy.' + ignoredNote(p.ignored); listEl.innerHTML = ''; return; }
      info.textContent = '“' + p.name + '”: ' + total + ' picture' + (total === 1 ? '' : 's') + ' that can be added' + ignoredNote(p.ignored);
      var h = '<div class="note">Tick single pictures, or tick a folder to take everything in it. <span id="af-cnt">0 selected</span></div><div class="groups big">';
      groups.forEach(function (g, gi) {
        h += '<details data-gi="' + gi + '"' + (groups.length === 1 ? ' open' : '') + '><summary><label><input type="checkbox" data-gall="' + gi + '"> ' + (g.path ? esc(g.path) : 'directly in “' + esc(p.name) + '”') + ' <span class="note">· ' + g.keys.length + '</span></label></summary><div class="flist" data-gl="' + gi + '"></div></details>';
      });
      listEl.innerHTML = h + '</div>';
      if (p.only) {                                                     // single pictures chosen in the Windows window: they are ticked already
        groups.forEach(function (g) { g.keys.forEach(function (rel) { checked[rel] = true; }); });
        info.textContent = total + ' single picture' + (total === 1 ? '' : 's') + ' chosen in “' + p.name + '”' + (total < p.only.length ? ' (' + (p.only.length - total) + ' already in the grid of this copy)' : '');
        Array.prototype.forEach.call(listEl.querySelectorAll('input[data-gall]'), function (x) { x.checked = true; });
      }
      groups.forEach(function (g, gi) { if (groups.length === 1) fillGroup(gi); });
      updCount();
    }
    function fillGroup(gi) {
      var box = listEl.querySelector('[data-gl="' + gi + '"]'); if (!box || box.dataset.done) return;
      box.dataset.done = '1';
      var h = '';
      groups[gi].keys.forEach(function (rel, j) { h += '<label class="inl"><input type="checkbox" data-gi="' + gi + '" data-j="' + j + '"' + (checked[rel] ? ' checked' : '') + '><span class="mono">' + esc(baseName(rel)) + '</span></label>'; });
      box.innerHTML = h;
    }
    listEl.addEventListener('toggle', function (e) { var d = e.target; if (d && d.tagName === 'DETAILS' && d.open) fillGroup(+d.dataset.gi); }, true);
    listEl.addEventListener('change', function (e) {
      var t = e.target;
      if (t.dataset.gall != null) {
        var gi = +t.dataset.gall;
        groups[gi].keys.forEach(function (rel) { checked[rel] = t.checked; });
        Array.prototype.forEach.call(listEl.querySelectorAll('input[data-gi][data-j]'), function (x) { if (+x.dataset.gi === gi) x.checked = t.checked; });
      } else if (t.dataset.j != null) {
        checked[groups[+t.dataset.gi].keys[+t.dataset.j]] = t.checked;
      }
      updCount();
    });
    var w = wireSrc(sc, 'af', extra, showFiles);
    var l0 = c.locs && c.locs[0], r0 = l0 && rootById(l0.root);
    if (r0 && rootReady(r0)) w.choose({ root: r0, path: l0.path });
    function finish() {
      var err = sc.querySelector('#af-err');
      if (!pk) { err.textContent = 'Choose the folder with the pictures first.'; return; }
      var rels = Object.keys(checked).filter(function (k) { return checked[k]; });
      if (!rels.length) { err.textContent = 'Tick at least one picture.'; return; }
      rels.sort(nat);
      var atRow = sc.querySelector('input[name=af-where]:checked').value === 'row', row = parseInt(rowIn.value, 10);
      if (atRow && !(row > 0)) { err.textContent = 'Type a row number, or choose “At the end”.'; return; }
      commit();
      if (n < 0) { c.locs.push({ root: pk.root.id, path: pk.path }); n = c.locs.length - 1; }
      var keys = rels.map(function (rel) { return joinKey(n, rel); }), have = {};
      c.keys.forEach(function (k) { have[k] = true; });
      keys.forEach(function (k) { if (!have[k]) c.keys.push(k); });
      var first = placeKeys(c, keys, atRow ? row - 1 : -1);
      S.sel = { ci: S.copies.indexOf(c), row: first };
      closeModal(); changed(); ensureVisible(first);
      toast('Added ' + keys.length + ' file' + (keys.length === 1 ? '' : 's') + ' to ' + c.name + '.', true);
    }
    sc.querySelector('#af-ok').onclick = finish;
  }

  function numberingDialog(s) {
    var row = s.row, folio = S.folio;
    var sc = modal('<h3>Start numbering at row ' + (row + 1) + '</h3>' +
      '<p>' + (row ? 'The rows above become front matter (Front 1, Front 2 …). ' : '') + 'This row becomes the first numbered page. How should the pages be numbered?</p>' +
      '<label class="inl opt"><input type="radio" name="nm-style" value="folio"' + (folio ? ' checked' : '') + '><span><b>Foliation</b><br>Every leaf gets a number, front and back: 1r, 1v, 2r, 2v …</span></label>' +
      '<label class="inl opt"><input type="radio" name="nm-style" value="page"' + (folio ? '' : ' checked') + '><span><b>Pagination</b><br>Every page gets a number: Page 1, Page 2, Page 3 …</span></label>' +
      '<p class="note">You can switch later (menu ⋮). Row names you typed yourself are kept.</p>' +
      '<div class="acts"><button class="ws-tb" data-close>Cancel</button><button class="ws-tb primary" id="nm-ok">Start numbering</button></div>');
    sc.querySelector('#nm-ok').onclick = function () {
      var f = sc.querySelector('input[name=nm-style]:checked').value === 'folio';
      commit(); S.ns = row; S.folio = f; closeModal(); changed();
      toast((row ? 'Rows above are front matter now. ' : '') + 'Row ' + (row + 1) + ' is ' + (f ? 'folio 1r' : 'Page 1') + '.', true);
    };
    sc.querySelector('#nm-ok').focus();
  }

  // The one menu (⋮ in the top bar), the same in both views (items 12-16): Project, Grid (Pages tab only), Export (Compare tab only),
  // Font and Help. The Compare tab hands over what only it can do (export) with BookWorkspace.compareMenu(handlers).
  // 0.16.0 (owner): no "Reference copy …" (the Compare tab asks for one), no "Align copies in the background …" (its button in the
  // Pages tab), no "How … works" (the "?" at the top), and the export entries only where they work, in the Compare tab.
  var cmpMenu = null;
  function menuHtml(where) {
    var cmp = where === 'compare', lost = usedRoots().some(function (r) { return !rootReady(r); });
    var item = function (m, label, off, tip) { return '<button role="menuitem" data-m="' + m + '"' + (off ? ' disabled' : '') + (tip ? ' title="' + esc(tip) + '"' : '') + '><span class="tick"></span>' + label + '</button>'; };
    var h = '<div class="ws-mhead">Project</div>' +
      item('save', HAS_FSA ? (proj.target ? 'Save project as …' : 'Save project …') : 'Download project file', !!S.examples, S.examples ? 'The examples are not saved' : '') +
      item('open', 'Open project …') + item('new', 'New project') +
      (lost ? item('reconnect', 'Choose scan folder again …') : '') +
      item('stored', 'Stored alignments …', !proj.target || !!S.examples, proj.target ? '' : 'Save the project as a file first: the stored alignments are kept inside it') +
      (HELPER ? item('report', 'Alignment report …', !proj.target || !!S.examples, 'A file about the stored alignments of this project, with pictures of the pages where most is left over (0.17.0)') : '') +
      item('start', 'Back to the start screen');
    if (!cmp) h += '<hr><div class="ws-mhead">Grid</div>' +
      item('folio', S.folio ? 'Switch to pagination (Page 1, Page 2 …)' : 'Switch to foliation (1r, 1v, 2r …)') +
      item('colw', 'Standard width for all columns');
    if (cmp) h += '<hr><div class="ws-mhead">Export</div>' +
      item('x-aligned', 'Aligned pages (two pictures)', false, 'Copy 1 and copy 2 as aligned, as two picture files') +
      item('x-toggle', 'Toggle view (moving picture, GIF)') +
      item('x-view', 'Current view (picture)', false, 'The picture as it is shown now, e.g. Superimposed');
    h += '<hr><div class="ws-mhead">Font</div>' +
      item('font', '<span>Choose the font …<small class="ws-mdesk">now: ' + esc(fontName(currentFont())) + '</small></span>');
    h += '<hr><div class="ws-mhead">Help</div>' +
      (DESKTOP ? '' : item('download', 'Desktop program for Windows …')) +
      (DESKTOP ? item('updates', updInfo.state === 'newer' ? '<span>Update to version ' + esc(updInfo.latest) + ' …<small class="ws-mdesk">you have ' + esc(DESKTOP) + '</small></span>' : 'Check for updates …') : '') +
      item('licenses', 'Licenses') + item('about', 'About Book Compare …');
    return h;
  }
  // 0.16.0 (owner): the font of Book Compare, chosen in a window that shows every font in itself (the list: BC_FONTS in index.html)
  function fontList() { return window.BC_FONTS || [{ id: 'roboto', name: 'Roboto', group: 'earlier' }]; }
  function currentFont() { return document.documentElement.getAttribute('data-bcfont') || 'roboto'; }
  function fontName(id) { var f = fontList().filter(function (x) { return x.id === id; })[0]; return f ? f.name : 'Roboto'; }
  function fontStyle(id) {                                   // (inline and !important, so that it wins over the font chosen for everything)
    var fam = id === 'roboto' ? 'Roboto, Arial, sans-serif' : id === 'garamond' ? '"EB Garamond", Garamond, serif' : '"BC ' + fontName(id) + '", Roboto, sans-serif';
    var f = fontList().filter(function (x) { return x.id === id; })[0];
    return 'font-family:' + fam + ' !important;font-size-adjust:' + (id === 'roboto' ? 'none' : id === 'garamond' ? '0.47' : (f && f.fsa) || '0.52') + ' !important';
  }
  function setFont(id) {
    if (id === 'roboto') document.documentElement.removeAttribute('data-bcfont'); else document.documentElement.setAttribute('data-bcfont', id);
    try { localStorage.setItem('bookcompare_font', id); } catch (x) { /* private mode: only for now */ }
    window.dispatchEvent(new Event('resize'));                                              // the panels measure their text again
    if (root) renderMenu();
  }
  function fontDialog() {
    // 0.17.0 (owner): Google's seven kinds of sans-serif fonts, three of each, every one with a bold and an italic (shown in the sample)
    var groups = [['humanist', 'Humanist', 'shaped like handwriting with a broad pen: open and lively'],
                  ['geometric', 'Geometric', 'built from circles and straight lines'],
                  ['grotesque', 'Grotesque', 'like the first sans-serif type of the 19th century: plain, a little irregular'],
                  ['neogrotesque', 'Neo-grotesque', 'smooth and neutral, like Helvetica (1950s)'],
                  ['rounded', 'Rounded', 'with rounded ends: soft and friendly'],
                  ['superellipse', 'Superellipse', 'curves between a circle and a square: technical'],
                  ['glyphic', 'Glyphic', 'strokes that widen at the ends, like letters cut in stone'],
                  ['earlier', 'Used before in Book Compare', '']];
    var notes = { roboto: 'the standard font', garamond: 'with serifs (tried in 0.15.0)' };
    var cur = currentFont(), h = '<h3>Font</h3><p>All the text of Book Compare is set in the font you choose; the change is shown at once. All these fonts are free for any use.</p><div class="ws-fonts">';
    groups.forEach(function (g) {
      var fs = fontList().filter(function (f) { return f.group === g[0]; }); if (!fs.length) return;
      h += '<div class="ws-fgroup"><div class="ws-fghead"><b>' + g[1] + '</b>' + (g[2] ? ' · ' + g[2] : '') + '</div><div class="ws-fopts">';
      fs.forEach(function (f) {
        h += '<label class="ws-fopt"><input type="radio" name="ws-font" value="' + f.id + '"' + (f.id === cur ? ' checked' : '') + '>' +
          '<span class="ws-ftxt" style=\'' + fontStyle(f.id) + '\'><span class="ws-fname">' + esc(f.name) + '</span>' +
          '<span class="ws-fsamp">' + (notes[f.id] ? esc(notes[f.id]) : 'Folio 19v · <b>Copy 1</b> · <i>12 of 340</i>') + '</span></span></label>';
      });
      h += '</div></div>';
    });
    h += '</div><div class="acts"><button class="ws-tb primary" data-close>Done</button></div>';
    var sc = modal(h);
    var dlg = sc.querySelector('.ws-dlg'); if (dlg) dlg.classList.add('ws-dlg-fonts');
    sc.querySelector('.ws-fonts').addEventListener('change', function (e) { if (e.target.name === 'ws-font') setFont(e.target.value); });
    var c = sc.querySelector('input[name=ws-font]:checked'); if (c) c.focus();
  }
  function renderMenu() { $('#ws-menu').innerHTML = menuHtml('pages'); }
  // the same menu over the Compare tab (the Pages layer is hidden there): a floating copy under the ⋮ button
  function floatMenu(anchor) {
    var old = document.getElementById('ws-fmenu'); if (old) { old.remove(); return; }
    var w = document.createElement('div'); w.className = 'ws-vars ws-fmenuwrap'; w.id = 'ws-fmenu';
    w.innerHTML = '<div class="ws-menu" role="menu">' + menuHtml('compare') + '</div>';
    document.body.appendChild(w);
    var r = anchor.getBoundingClientRect(), m = w.firstChild;
    m.style.top = Math.round(r.bottom + 4) + 'px'; m.style.right = Math.max(6, Math.round(window.innerWidth - r.right)) + 'px';
    var close = function () { w.remove(); document.removeEventListener('pointerdown', away, true); document.removeEventListener('keydown', esc1, true); };
    var away = function (e) { if (!w.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) close(); };
    var esc1 = function (e) { if (e.key === 'Escape') { close(); e.stopPropagation(); anchor.focus(); } };
    document.addEventListener('pointerdown', away, true); document.addEventListener('keydown', esc1, true);
    w.addEventListener('click', function (e) { var b = e.target.closest('[data-m]'); if (!b || b.disabled) return; close(); menuAction(b.dataset.m, 'compare'); });
    var first = m.querySelector('button:not(:disabled)'); if (first) first.focus();
  }
  function menuAction(m, where) {
    var cmp = where === 'compare';
    if (m === 'save') saveProjectAs();
    else if (m === 'open') openProject();
    else if (m === 'new') newProject();
    else if (m === 'reconnect') reconnectScans();
    else if (m === 'stored') storedDialog();
    else if (m === 'start') { if (cmp && cmpMenu && cmpMenu.leave) cmpMenu.leave(); else leave(); }
    else if (m === 'folio') { commit(); S.folio = !S.folio; changed(); toast(S.folio ? 'Rows are numbered as folios now (1r, 1v, 2r …).' : 'Rows are numbered as pages now (Page 1, Page 2 …).', true); }
    else if (m === 'colw') resetWidths();
    else if (/^x-/.test(m)) { if (cmpMenu && cmpMenu[m]) cmpMenu[m](); }
    else if (m === 'download') openDownloadPage();
    else if (m === 'licenses') { var a = document.createElement('a'); a.href = 'licenses.txt'; a.target = '_blank'; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove(); }
    else if (m === 'about') aboutDialog();
    else if (m === 'font') fontDialog();
    else if (m === 'report') { if (window.BCAlignReport) BCAlignReport.open(); }
    else if (m === 'updates') { if (updInfo.state === 'newer') { showUpdateCard(true); updateNow(); } else checkUpdatesNow(); }
  }
  // item 28: how much room the stored alignments take, and removing those that are no longer needed (pages that left the grid, an older
  // alignment). A pair that is still in the grid stays, even when its scans changed: it is replaced the next time it is aligned.
  async function storedDialog() {
    if (!window.BCResults || !BCResults.available()) return toast('Save the project as a file first: the stored alignments are kept inside it.');
    var st = await BCResults.stats(); if (!st) return toast('The stored alignments could not be read.');
    var inGrid = {};
    S.copies.forEach(function (c) { c.cells.forEach(function (k) { if (k) inGrid[c.id + '|' + k] = true; }); });
    var keep = function (e) { return BCResults.current(e) && inGrid[e.c0 + '|' + e.k0] && inGrid[e.c1 + '|' + e.k1]; };
    var idx = BCResults.storedSync() || {}, old = 0, oldB = 0;
    Object.keys(idx).forEach(function (k) { if (!keep(idx[k])) { old++; oldB += idx[k].bytes || 200000; } });
    var mb = function (b) { return (b / 1048576).toFixed(b < 10485760 ? 1 : 0).replace('.0', '') + ' MB'; };
    var sc = modal('<h3>Stored alignments</h3><p><b>' + st.count + '</b> page' + (st.count === 1 ? '' : 's') + ' stored, about <b>' + mb(st.bytes) + '</b>, inside the project file “' + esc(st.file) + '” (' + mb(st.size) + ' in all).</p>' +
      (old ? '<p>' + old + ' of them ' + (old === 1 ? 'is' : 'are') + ' no longer needed (' + mb(oldB) + '): their pages left the grid, or they were made by an older version.</p>' : '<p>All of them are still needed.</p>') +
      '<div class="acts"><button class="ws-tb" data-close>Close</button>' + (old ? '<button class="ws-tb primary" id="st-prune">Remove those ' + old + '</button>' : '') + '</div>');
    var b = sc.querySelector('#st-prune');
    if (b) b.onclick = async function () { b.disabled = true; var r = await BCResults.prune(keep); closeModal(); toast('Removed ' + r.removed + ' stored alignment' + (r.removed === 1 ? '' : 's') + ' (' + mb(r.bytes) + ').'); renderAll(); };
  }
  function aboutDialog() {
    modal('<h3>About Book Compare</h3>' +
      '<p>Book Compare finds the differences between copies of the same early printed book: it aligns the scans of two copies page by page and shows them on top of each other.</p>' +
      '<p><b>Version:</b> ' + (DESKTOP ? esc(DESKTOP) + ' (desktop program for Windows)' : 'website (always the newest version)') + '</p>' +
      (!DESKTOP ? '' : updInfo.state === 'newer'
        ? '<div class="ws-aboutupd new"><span><b>A newer version is available: ' + esc(updInfo.latest) + '.</b> Book Compare downloads and installs it itself.</span><button class="ws-tb primary" data-about="upd">Update now</button></div>'
        : '<div class="ws-aboutupd"><span>' + (updInfo.state === 'newest' ? 'This is the newest version.' : updInfo.state === 'checking' ? 'Looking for a newer version …' : 'Whether a newer version exists is not known yet.') + '</span><button class="ws-tb" data-about="check">Check for updates</button></div>') +
      '<p>Made by Torge Schiefelbein. Book Compare grew out of <a href="https://www.robots.ox.ac.uk/~vgg/software/image-compare/" target="_blank" rel="noopener">Image Compare</a> by the Visual Geometry Group (VGG), University of Oxford.</p>' +
      '<p>Source code and downloads: <a href="https://github.com/PeerPioneer/Book-Compare" target="_blank" rel="noopener">github.com/PeerPioneer/Book-Compare</a>. The licences of the parts it uses are listed under Help › Licenses.</p>' +
      '<div class="acts"><button class="ws-tb primary" data-close>Close</button></div>');
    var sc = $('#ws-scrim');
    if (sc) sc.addEventListener('click', function (e) {
      var b = e.target.closest('[data-about]'); if (!b) return;
      closeModal();
      if (b.dataset.about === 'upd') { showUpdateCard(true); updateNow(); }
      else checkUpdatesNow().then(function () { });
    });
  }

  /* ---------------------------------------------------------------- hand a pair of pages to the Compare tab */
  // Loads the two scans of the current row (copy 1 and copy 2). Asks the browser for a locked folder if needed (that needs a click).
  // Throws an Error whose message can be shown to the person as it is.
  async function loadPair() {
    var a = copyById(S.pair[0]), b = copyById(S.pair[1]), r = S.sel.row;
    if (!a || !b) throw refusal('First mark two pages with “1” and “2” in the preview on the right.');
    if (!a.cells[r] || !b.cells[r]) throw refusal('In this row ' + (!a.cells[r] ? a.name : b.name) + ' has no page. Pick another page, or another copy.');
    // the original scans are needed now: if the browser has locked a folder, ask for it here, at the click
    var need = [];
    [[a, a.cells[r]], [b, b.cells[r]]].forEach(function (x) {
      var sk = splitKey(x[1]), l = x[0].locs && x[0].locs[sk.n], rt = l && rootById(l.root);
      if (rt && rt.handle && !rt.ok && need.indexOf(rt) < 0) need.push(rt);
    });
    for (var i = 0; i < need.length; i++) {
      var granted = false;
      try { granted = await ensureAccess(need[i]); }
      catch (e) { renderAll(); throw refusal(e && e.name === 'SecurityError' ? 'The browser asks for one folder per click. Press COMPARE once more to allow the next folder.' : niceError(e)); }
      if (!granted) { renderAll(); throw refusal('The browser did not give access to “' + need[i].name + '”. COMPARE needs the original scans.'); }
    }
    if (need.length) renderAll();
    var f1, f2;
    try { f1 = await getScan(a, a.cells[r]); f2 = await getScan(b, b.cells[r]); }
    catch (e) { if (HELPER && e && e.name === 'Lost') throw refusal(e.message); throw refusal(e && e.name === 'Lost' ? 'Book Compare cannot find the scans of ' + (usedRoots().some(function (x) { return !x.handle && !x.files; }) ? 'these copies on this computer. Click “Choose scan folder” at the top.' : 'these copies. Click “Allow access now” at the top.') : 'Could not open the scan: ' + niceError(e)); }
    return { urls: [URL.createObjectURL(f1), URL.createObjectURL(f2)], names: [f1.name, f2.name], files: [f1, f2], key: a.id + '#' + a.cells[r],
      ids: [a.id, b.id], keys: [a.cells[r], b.cells[r]], row: r };
  }
  // the two scans of another row of the same pair, for preparing the next page (no question to the browser: null when a folder is locked)
  async function loadRow(r) {
    var a = copyById(S.pair[0]), b = copyById(S.pair[1]);
    if (!a || !b || !a.cells[r] || !b.cells[r]) return null;
    try { return { files: [await getScan(a, a.cells[r]), await getScan(b, b.cells[r])], ids: [a.id, b.id], keys: [a.cells[r], b.cells[r]], row: r }; }
    catch (e) { return null; }
  }

  /* ---------------------------------------------------------------- the reference copy (V7) */
  // The other copies are aligned onto it (in the background, V8-V10). Where it has no page, the first copy from the left that has one stands in.
  function refFor(row) {
    var r = copyById(S.ref); if (!r || S.copies.indexOf(r) < 0) return null;
    if (r.cells[row]) return r.id;
    for (var i = 0; i < S.copies.length; i++) { var c = S.copies[i]; if (c.id !== r.id && c.cells[row]) return c.id; }
    return null;
  }
  async function firstScanSize(c) {
    var key = null; for (var i = 0; i < c.cells.length && !key; i++) key = c.cells[i];
    if (!key) return null;
    try { var st = await statScan(c, key); if (st) return st.size; } catch (e) { /* not known */ }
    try { var sk = splitKey(key), l = c.locs && c.locs[sk.n], rt = l && rootById(l.root); if (rootReady(rt)) return (await getScan(c, key)).size; } catch (e) { /* not known */ }
    return null;
  }
  // proposed: the copy with the most pages; with equally many, the one with the bigger scans (more detail), then the one further left
  function proposeRef(sizes) {
    var best = null, bp = -1, bs = -1;
    S.copies.forEach(function (c) {
      var p = c.cells.filter(Boolean).length, z = sizes[c.id] || 0;
      if (p > bp || (p === bp && z > bs)) { best = c; bp = p; bs = z; }
    });
    return best ? best.id : null;
  }
  // The reference copy: the copy the others are compared with. 0.16.0 (owner): there is no menu entry for it any more; when the
  // Compare tab is opened and the project has none, this window explains it (warn = true) and offers to choose one, with "Don't warn
  // me again" for this project. Later: right-click a page of a copy → "Make it the reference copy", or the background window.
  async function refDialog(warn) {
    if (S.copies.length < 2) return toast('Add at least two copies first.');
    var sizes = {};
    for (var i = 0; i < S.copies.length; i++) sizes[S.copies[i].id] = await firstScanSize(S.copies[i]);
    var prop = proposeRef(sizes), cur = S.ref != null ? S.ref : prop;
    var bg = HELPER ? 'Book Compare can align the other copies onto it in the background (button “Align in the background” in the Pages tab) and keeps the results in the project file, so that a comparison with the reference copy opens at once.'
                    : 'In the desktop program, Book Compare can align the other copies onto it in the background, so that a comparison with the reference copy opens at once.';
    var h = warn
      ? '<h3>Choose a reference copy</h3><p>This project has no <b>reference copy</b> yet. The reference copy is the copy that the others are compared with: usually the most complete copy, or the one with the best scans. It is marked with ★.</p>' +
        '<ul class="ws-refwhy"><li>A double-click on a page in the Pages tab compares it with the same page of the reference copy.</li><li>' + bg + '</li></ul>' +
        '<p>Book Compare proposes a copy; you can change it later (right-click a page of a copy → Make it the reference copy).</p><div class="ws-reflist">'
      : '<h3>Reference copy</h3><p>The other copies are compared with the reference copy. ' + bg + ' Where the reference copy has no page, the first copy from the left that has the page stands in for it.</p><div class="ws-reflist">';
    S.copies.forEach(function (c) {
      var p = c.cells.filter(Boolean).length, z = sizes[c.id];
      var tie = S.copies.some(function (x) { return x !== c && x.cells.filter(Boolean).length === p; });
      h += '<label><input type="radio" name="ws-ref" value="' + c.id + '"' + (c.id === cur ? ' checked' : '') + '> <b>' + esc(c.name) + '</b> · ' + p + ' page' + (p === 1 ? '' : 's') +
        (z ? ' · first scan ' + (z / 1048576).toFixed(1) + ' MB' : '') + (c.id === prop ? ' <i>(proposed: ' + (tie ? 'as many pages as another copy, bigger scans' : 'most pages') + ')</i>' : '') + '</label>';
    });
    h += '</div>' + (warn ? '<label class="chk ws-nowarn"><input type="checkbox" id="rf-nowarn"> Don’t warn me again in this project</label>' : '') +
      '<div class="acts"><button class="ws-tb" id="rf-cancel">' + (warn ? 'Not now' : 'Cancel') + '</button>' + (!warn && S.ref != null ? '<button class="ws-tb" id="rf-none">No reference copy</button>' : '') + '<button class="ws-tb primary" id="rf-ok">Use this copy</button></div>';
    var sc = modal(h);
    var noWarn = function () { var x = sc.querySelector('#rf-nowarn'); if (x && x.checked && !S.noRefWarn) { S.noRefWarn = true; touch(); } };
    sc.querySelector('#rf-ok').onclick = function () {
      var v = sc.querySelector('input[name=ws-ref]:checked'), id = v ? +v.value : null;
      noWarn(); closeModal(); if (id == null || id === S.ref) return;
      commit(); S.ref = id; touch(); renderAll();
      toast('“' + copyById(id).name + '” is the reference copy now.' + (HELPER ? ' “Align in the background” in the Pages tab aligns the others onto it.' : ''));
    };
    sc.querySelector('#rf-cancel').onclick = function () { noWarn(); closeModal(); };
    var none = sc.querySelector('#rf-none');
    if (none) none.onclick = function () { closeModal(); commit(); S.ref = null; touch(); renderAll(); toast('No reference copy.'); };
    sc.querySelector('#rf-ok').focus();
  }
  // opening the Compare tab: a project of two or more copies without a reference copy gets the explanation (once each time, until
  // "Don't warn me again" is ticked; the examples never)
  function maybeWarnRef() {
    if (S.examples || S.ref != null || S.noRefWarn || S.copies.length < 2 || $('#ws-scrim')) return;
    if (navigator.webdriver && !window.BC_TEST_REFWARN) return;           // (automatic tests: only when a test asks for this window)
    refDialog(true);
  }
  function resultsDir() {
    var t = proj.target;
    if (!HELPER || !t || !t.dir || !t.dir.isHelper) return null;
    return new HDir(t.dir.ref, joinPath(t.dir.rel, t.file + ' results'), t.file + ' results');
  }
  function goTo(copyId, row) {
    var ci = -1; S.copies.forEach(function (c, i) { if (c.id === copyId) ci = i; });
    if (ci < 0 || row < 0 || row >= rows()) return;
    if (!root || root.hidden) show();
    S.sel = { ci: ci, row: row }; anchor = null;
    renderAll();
    var vp = $('#ws-vp'); if (vp) { vp.scrollTop = Math.max(0, HEAD_H + row * ROW_H - vp.clientHeight / 2); vp.scrollLeft = Math.max(0, colLeft(ci) - 40); }
  }
  // COMPARE in the Pages view: check that the two scans can be read (errors stay here as a message), then open the Compare tab.
  async function compareNow() {
    var d;
    try { d = await loadPair(); } catch (e) { return toast(e && e.message ? e.message : String(e)); }
    hide();
    if (cb.compare) cb.compare(d);
    maybeWarnRef();
  }

  /* ---------------------------------------------------------------- what the Compare tab (js/compare-tab.js) may ask for and change */
  // It never touches the scan files; it only reads the project and changes which row and which two copies are shown.
  var tabApi = {
    state: function () {
      ensurePair();
      return {
        name: proj.name || '', rows: rows(), row: S.sel.row, folio: S.folio,
        copies: S.copies.map(function (c) { return { id: c.id, name: c.name, pages: c.cells.filter(Boolean).length }; }),
        pair: S.pair.slice()
      };
    },
    rowInfo: function (i) {
      var a = copyById(S.pair[0]), b = copyById(S.pair[1]);
      return { label: rowLabel(i), a: !!(a && a.cells[i]), b: !!(b && b.cells[i]), skip: !!S.skip[i], flag: S.flags[i] != null ? S.flags[i] : null, ann: (S.annots[i] || []).length };
    },
    // Annotations of a row (copies, so the caller can not change the project by accident); every change goes through the three methods below
    annList: function (row) { return (S.annots[row] || []).map(function (a) { var c = cleanAnn(a, a.id); return c; }); },
    annBegin: function () { commit(); },                                 // one undo step before a gesture (moving, resizing, typing a comment)
    annAdd: function (row, a) {
      if (row < 0 || row >= rows()) return 0;
      var list = S.annots[row] || (S.annots[row] = []);
      if (list.length >= 200) return 0;
      var c = cleanAnn(a, S.nextAnn); if (!c) return 0;
      commit(); S.nextAnn++; list.push(c); touch();
      return c.id;
    },
    annSet: function (row, id, patch) {                                  // x y w h col text; the undo step is made by annBegin
      var a = findAnnot(row, id); if (!a || !patch) return false;
      var m = Object.assign({}, a);
      ['x', 'y', 'w', 'h', 'col', 'text'].forEach(function (k) { if (k in patch) m[k] = patch[k]; });          // nothing else can be changed
      var c = cleanAnn(m, id);
      if (c) { Object.assign(a, c); touch(); }
      return !!c;
    },
    annDel: function (row, id) {
      var l = S.annots[row] || [], k = -1;
      l.forEach(function (a, i) { if (a.id === id) k = i; });
      if (k < 0) return false;
      commit(); l.splice(k, 1); if (!l.length) delete S.annots[row]; touch();
      return true;
    },
    // Tile settings (V15) for one copy on one page: { main, sub } (main tiles over the page height, times each is split again), or null = standard
    tileSetting: function (row, copyId) { var t = S.tiles[copyId + '|' + row]; return t ? { main: t.main, sub: t.sub } : null; },
    setTileSetting: function (row, copyId, t) {
      var k = copyId + '|' + row, now = S.tiles[k] || null, c = t ? cleanTile(t) : null;
      if (JSON.stringify(now) === JSON.stringify(c)) return;
      commit(); if (c) S.tiles[k] = c; else delete S.tiles[k]; touch();
    },
    // The printed area set by hand (V2b) for the scan of a copy on a page: four corners (fractions), or null = the automatic box.
    // It belongs to the scan, so it moves with the scan when the grid is changed. setBoxSetting returns false for a shape that is too small.
    boxSetting: function (row, copyId) { var c = copyById(copyId), k = c && c.cells[row]; var q = k ? S.boxes[copyId + '|' + k] : null; return q ? q.slice() : null; },
    setBoxSetting: function (row, copyId, q) {
      var c = copyById(copyId), k = c && c.cells[row]; if (!k) return false;
      var key = copyId + '|' + k, now = S.boxes[key] || null, v = q == null ? null : cleanQuad(q);
      if (q != null && !v) return false;
      if (JSON.stringify(now) === JSON.stringify(v)) return true;
      commit(); if (v) S.boxes[key] = v; else delete S.boxes[key]; touch();
      return true;
    },
    // "whiter paper" of a copy in the Superimposed view (0.11.0; display only, not part of undo)
    examples: function () { return !!(S && S.examples); },
    paper: function (copyId) { return S.paper[copyId] || 0; },
    setPaper: function (copyId, v) { v = v === 1 || v === 2 ? v : 0; if ((S.paper[copyId] || 0) === v || !copyById(copyId)) return; if (v) S.paper[copyId] = v; else delete S.paper[copyId]; touch(); },
    flagColors: FLAG_COLORS.slice(), flagNames: FLAG_NAMES.slice(), flagPath: FLAG_PATH,
    // colour 0-5 puts a flag on the row, null takes it away (every change can be undone in the Pages view)
    setFlag: function (i, c) {
      if (i < 0 || i >= rows()) return;
      var now = S.flags[i] != null ? S.flags[i] : null;
      if (c != null && !(c >= 0 && c < FLAG_COLORS.length)) return;
      if (now === c) return;
      commit();
      if (c == null) delete S.flags[i]; else S.flags[i] = c;
      touch(); if (root && !root.hidden) renderAll();
    },
    // a small picture of the page at this row for the book map: from copy 1, otherwise copy 2; resolves to { url, copy } or { none: true } / { err }
    thumb: function (i) {
      var cs = [copyById(S.pair[0]), copyById(S.pair[1])];
      for (var k = 0; k < 2; k++) {
        var c = cs[k], key = c && c.cells[i];
        if (key) return thumbPromise(c, key).then(function (r) { return r && r.url ? { url: r.url, copy: this.name } : { err: (r && r.msg) || 'Not available' }; }.bind(c));
      }
      return Promise.resolve({ none: true });
    },
    // ---- for the reference copy and the background alignment (js/results-store.js, js/background-align.js, V7-V10)
    refCopy: function () { return S.ref; },
    // 0.15.0: for the window of the background alignment - how many pages of a copy need the reference, and how many of them are stored
    alignedOf: function (id) {
      var c = copyById(id), st = storedEntries(), n = 0, b = 0; if (!c) return { n: 0, b: 0 };
      for (var r = 0; r < c.cells.length; r++) { if (!c.cells[r]) continue; var f = refFor(r); if (f == null || f === c.id) continue; n++; if (isStored(st, c, r, c.cells[r])) b++; }
      return { n: n, b: b };
    },
    refreshBgButton: function () { var b = root && document.getElementById('ws-bgbtn'); if (b) b.outerHTML = bgButton().replace('<span class="ws-vsep"></span>', ''); },
    setRef: function (id) { if (id == null || id === S.ref || !copyById(id)) return; commit(); S.ref = id; changed(); },
    refFor: refFor,
    refDialog: refDialog,
    cellKey: function (copyId, row) { var c = copyById(copyId); return (c && S.copies.indexOf(c) >= 0 && c.cells[row]) || null; },
    scanFile: function (copyId, row) { var c = copyById(copyId); if (!c || !c.cells[row]) return Promise.reject(new Error('no page')); return getScan(c, c.cells[row]); },
    scanInfo: function (copyId, row) { var c = copyById(copyId); if (!c || !c.cells[row]) return Promise.resolve(null); return statScan(c, c.cells[row]).catch(function () { return null; }); },
    loadRow: loadRow,
    rowCount: rows,
    copyList: function () { return S.copies.map(function (c) { return { id: c.id, name: c.name, pages: c.cells.filter(Boolean).length }; }); },
    resultsDir: resultsDir,
    pack: function () { return proj.target && proj.pack && proj.pack.target === proj.target ? proj.pack : null; },
    projectFile: function () { return proj.target ? targetFile(proj.target) : ''; },
    resultsId: function () { var t = proj.target; return t && t.dir ? (t.dir.rootPath || t.dir.name) + '|' + t.file : ''; },
    isDesktop: function () { return !!HELPER; },
    hasProjectFile: function () { return !!proj.target; },
    saveAs: function () { return saveProjectAs(); },
    goTo: goTo,
    // the Compare tab at that page, with copy0 as copy 1 and copy1 as copy 2 (0.12.0: "Go to the page" of the background alignment's warning)
    compareAt: function (copy0, copy1, row) {
      if (!copyById(copy0) || !copyById(copy1) || row < 0 || row >= rows()) return;
      S.pair = [copy0, copy1]; S.sel.row = row; touch(); compareNow();
    },
    bgSlot: function () { return root ? $('#ws-bg') : null; },
    rowLabel: function (i) { return rowLabel(i); },
    toast: function (t) { toast(t); },
    memoryGB: function () { return HELPER && HELPER.mem ? HELPER.mem / 1073741824 : (navigator.deviceMemory || null); },
    setBgRun: function (r) { var was = JSON.stringify(S.bgRun || null), now = JSON.stringify(r || null); if (was !== now) { S.bgRun = r || null; touch(); } },
    modal: modal, closeModal: closeModal,
    setRow: function (i) { if (i < 0 || i >= rows()) return; S.sel = { ci: S.sel.ci != null && S.copies[S.sel.ci] ? S.sel.ci : 0, row: i }; touch(); },
    setCopy: function (slot, id) {                                     // slot 0 = copy 1, slot 1 = copy 2; choosing the other one's copy swaps them
      var c = null; S.copies.forEach(function (x) { if (String(x.id) === String(id)) c = x; });      // (a menu hands over the id as text)
      if (!c) return;
      var o = 1 - slot;
      if (S.pair[o] === c.id) S.pair[o] = S.pair[slot];
      S.pair[slot] = c.id; touch();
    },
    swap: function () { S.pair = [S.pair[1], S.pair[0]]; touch(); },
    loadPair: loadPair,
    // 0.15.0 (owner): coming from the Compare tab, the page shown there is selected in the grid (in the column of copy 1) and scrolled into view
    showPages: function () {
      var row = S && S.sel ? S.sel.row : 0, c1 = S && S.pair ? S.pair[0] : null;
      if (c1 != null && copyById(c1) && row >= 0 && row < rows()) goTo(c1, row); else show();
    }
  };

  /* ---------------------------------------------------------------- events */
  function startRename(el, getVal, setVal) {
    var inp = document.createElement('input'); inp.value = getVal(); el.replaceWith(inp);
    var hc = inp.closest && inp.closest('.ws-hcell'); if (hc) hc.draggable = false;                  // so the text can be selected with the mouse
    inp.focus(); inp.select();
    var done = false;
    function fin(save) { if (done) return; done = true; var v = inp.value.trim(); if (save && v && v !== getVal()) { commit(); setVal(v); changed(); } else renderAll(); }
    inp.addEventListener('keydown', function (ev) { ev.stopPropagation(); if (ev.key === 'Enter') fin(true); if (ev.key === 'Escape') fin(false); });
    inp.addEventListener('blur', function () { fin(true); });
  }
  function deleteSelected() {
    var s = selected(), rg = range();
    if (rg) {
      var c = S.copies[rg.ci], n = 0;
      for (var i = rg.lo; i <= rg.hi; i++) if (c.cells[i]) n++;
      if (!n) return toast('There is no file in the marked rows.');
      commit(); c.cells.splice(rg.lo, rg.hi - rg.lo + 1); trim(c);                    // the whole block goes, the pages below move up
      S.sel = { ci: rg.ci, row: rg.lo }; anchor = null; changed();
      toast('Deleted ' + n + ' file' + (n === 1 ? '' : 's') + ' from the workspace. The scan files on your disk are untouched.', true);
      return;
    }
    if (!s || !s.key) return;
    commit(); deleteCell(s.c, s.row); trim(s.c); changed();
    toast('Deleted from the workspace. The scan file on your disk is untouched.', true);
  }
  // Moving a whole column (a copy) to another place; the files in it, its name and its width go with it.
  function moveCopy(from, to) {
    var n = S.copies.length;
    if (from === to || from < 0 || to < 0 || from >= n || to >= n) return false;
    var selId = S.sel.ci != null && S.copies[S.sel.ci] ? S.copies[S.sel.ci].id : null;
    commit(); var c = S.copies.splice(from, 1)[0]; S.copies.splice(to, 0, c);
    if (selId != null) for (var i = 0; i < S.copies.length; i++) if (S.copies[i].id === selId) S.sel.ci = i;
    anchor = null; changed(); ensureColVisible(to);
    return true;
  }
  // Column width by dragging the right edge of the heading; a double-click fits the longest file name.
  var rz = null;
  function applyWidths() {
    var inner = $('#ws-inner'), hr = root.querySelector('.ws-hrow'); if (!inner || !hr) return;
    var w = gridW() + 'px'; inner.style.width = w; hr.style.width = w; root.style.setProperty('--ws-lblw', lblW() + 'px');
    Array.prototype.forEach.call(hr.querySelectorAll('.ws-hcell'), function (h) { var c = S.copies[+h.dataset.c]; if (c) { h.style.width = cw(c) + 'px'; h.style.flexBasis = cw(c) + 'px'; } });
    renderRows();
  }
  function fitWidth(ci) {
    var c = S.copies[ci]; if (!c) return;
    var ctx = document.createElement('canvas').getContext('2d'), fam = (getComputedStyle(root).getPropertyValue('--ws-mono') || '').trim() || 'Consolas, monospace', best = 0;
    ctx.font = '12.5px ' + fam;
    c.cells.forEach(function (k) { if (k) best = Math.max(best, ctx.measureText(baseName(k)).width); });
    c.w = clampW(best + 74) || 0; applyWidths(); touch();
  }
  function onPointerDown(e) {
    var h = e.target.closest && e.target.closest('.ws-rz'); if (!h || e.button) return;
    if (h.dataset.c === 'lbl') {
      e.preventDefault(); e.stopPropagation();
      rz = { lbl: true, x: e.clientX, w: lblW(), moved: false };
      try { h.setPointerCapture(e.pointerId); } catch (_) {}
      root.classList.add('rzing'); return;
    }
    var c = S.copies[+h.dataset.c]; if (!c) return;
    e.preventDefault(); e.stopPropagation();
    rz = { ci: +h.dataset.c, x: e.clientX, w: cw(c), moved: false };
    try { h.setPointerCapture(e.pointerId); } catch (_) {}
    root.classList.add('rzing');
  }
  function onPointerMove(e) {
    if (!rz) return;
    if (rz.lbl) { rz.moved = true; S.lblw = Math.max(64, Math.min(420, Math.round(rz.w + e.clientX - rz.x))); applyWidths(); return; }
    var c = S.copies[rz.ci]; if (!c) return;
    rz.moved = true; c.w = limitW(rz.w + e.clientX - rz.x); applyWidths();
  }
  function onPointerUp() {
    if (!rz) return;
    var was = rz; rz = null; root.classList.remove('rzing');
    if (was.moved) touch();
  }
  function fitLabels() {
    var ctx = document.createElement('canvas').getContext('2d'), best = 0, N = rows();
    ctx.font = '500 13px Roboto, Arial, sans-serif';
    for (var i = 0; i < N; i++) best = Math.max(best, ctx.measureText(rowLabel(i)).width);
    S.lblw = Math.max(64, Math.min(420, Math.ceil(best) + 26)); applyWidths(); touch();
  }
  function resetWidths() { S.lblw = 0; S.copies.forEach(function (c) { c.w = 0; }); applyWidths(); touch(); toast('All columns have the standard width again.'); }
  function onClick(e) {
    var t = e.target, el;
    if (t.closest('[data-close]')) return closeModal();
    if (!t.closest('#ws-menu') && !t.closest('#ws-more')) $('#ws-menu').hidden = true;
    if (!t.closest('#ws-ctx')) closeCellMenu();
    if ((el = t.closest('[data-m]'))) {
      $('#ws-menu').hidden = true;
      if (!el.disabled) menuAction(el.dataset.m, 'pages');
      return;
    }
    var cell = t.closest('.ws-cell');
    if (cell && !t.closest('[data-act]')) {
      var cc = +cell.dataset.c, cr = +cell.dataset.r, now = Date.now();
      // a double-click (item 20; counted here, because the first click draws the grid anew and the browser then sees two different cells)
      if (!e.shiftKey && lastCellClick && lastCellClick.c === cc && lastCellClick.r === cr && now - lastCellClick.t < 450 && cell.classList.contains('filled')) { lastCellClick = null; compareWithRef(cc, cr); return; }
      lastCellClick = { c: cc, r: cr, t: now };
      if (e.shiftKey) extendTo(cc, cr); else selectCell(cc, cr); var v = $('#ws-vp'); if (v) v.focus({ preventScroll: true }); return;
    }
    var a = t.closest('[data-act]'); if (!a) return;
    var act = a.dataset.act, s = selected();
    switch (act) {
      case 'add': if (S.examples) return toast('The examples cannot be extended. Start your own project with ⋮ → New project.'); return addDialog();
      case 'addfiles': closeCellMenu(); return addFilesDialog();
      case 'undo': return undo();
      case 'redo': return redo();
      case 'help': return helpDialog();
      case 'back': return leave();
      case 'more': renderMenu(); $('#ws-menu').hidden = !$('#ws-menu').hidden; return;
      case 'compare': return compareNow();
      case 'pics': S.thumbs = !S.thumbs; touch(); renderAll(); return;
      case 'bgopen': if (window.BCBackground) window.BCBackground.open(); return;
      case 'savechip': return chipClick();
      case 'openproj': return openProject();
      case 'continue': return continueLast();
      case 'allow': return allowAccess(false);
      case 'reconnect': return reconnectScans();
      case 'swap': S.pair = [S.pair[1], S.pair[0]]; touch(); renderAll(); return;
      case 'pick': var cp = S.copies[+a.dataset.ci], slot = +a.dataset.slot; if (cp) { var o = 1 - slot; if (S.pair[o] === cp.id) S.pair[o] = S.pair[slot]; S.pair[slot] = cp.id; touch(); renderAll(); } return;
      case 'selcell': selectCell(+a.dataset.ci, S.sel.row); return;
      case 'reload': reloadThumb(+a.dataset.ci); return;
      case 'mvl': closeCellMenu(); if (s && s.ci > 0) moveCopy(s.ci, s.ci - 1); return;
      case 'mvr': closeCellMenu(); if (s && s.ci < S.copies.length - 1) moveCopy(s.ci, s.ci + 1); return;
      case 'startnum': closeCellMenu(); if (s) numberingDialog(s); return;
      case 'skiprow': closeCellMenu(); if (s) {
        var rg2 = range(), lo2 = rg2 ? rg2.lo : s.row, hi2 = rg2 ? rg2.hi : s.row, off2 = !S.skip[s.row], n2 = hi2 - lo2 + 1;
        commit(); for (var q2 = lo2; q2 <= hi2; q2++) { if (off2) S.skip[q2] = true; else delete S.skip[q2]; }
        changed(); toast(n2 > 1 ? (off2 ? 'These ' + n2 + ' rows will not be compared.' : 'These ' + n2 + ' rows will be compared again.') : (off2 ? 'This row will not be compared.' : 'This row will be compared again.'), true);
      } return;
      case 'gap': closeCellMenu(); if (s) gapDialog(s); return;
      case 'closegap': closeCellMenu(); if (s && !s.key) closeGapAction(s); return;
      case 'cellmenu': { var bb = a.getBoundingClientRect(); if (root.querySelector('#ws-ctx')) closeCellMenu(); else openCellMenu(bb.left, bb.bottom + 4); return; }
      case 'cmpref': closeCellMenu(); if (s) compareWithRef(s.ci, s.row); return;
      case 'renamecopy': { closeCellMenu(); if (!s) return; var hn = root.querySelector('.ws-hname[data-c="' + s.ci + '"]'); if (hn) hn.click(); return; }
      case 'renamerow': { closeCellMenu(); if (!s) return; var lb = root.querySelector('.ws-lbl[data-r="' + s.row + '"] b'); if (lb) startRename(lb, function () { return rowLabel(s.row); }, function (v) { S.labels[s.row] = v; }); return; }
      case 'mk1': case 'mk2':
        closeCellMenu(); if (!s) return;
        var slot = a.dataset.act === 'mk1' ? 0 : 1, oth = 1 - slot;
        if (S.pair[slot] === s.c.id) return;
        if (S.pair[oth] === s.c.id) S.pair[oth] = S.pair[slot];                     // it was the other one: the two change places
        S.pair[slot] = s.c.id; touch(); renderAll(); toast('“' + s.c.name + '” is copy ' + (slot + 1) + ' now.'); return;
      case 'setref': closeCellMenu(); if (s && S.ref !== s.c.id) { commit(); S.ref = s.c.id; changed(); toast('“' + s.c.name + '” is the reference copy now.', true); } return;
      case 'del': closeCellMenu(); return deleteSelected();
      case 'remove':
        var ci = +a.dataset.c, nm = S.copies[ci].name; commit(); if (S.copies[ci].id === S.ref) S.ref = null; S.copies.splice(ci, 1);
        S.sel.ci = S.copies.length ? Math.min(S.sel.ci == null ? 0 : S.sel.ci, S.copies.length - 1) : null; ensurePair();
        changed(); toast('Removed ' + nm + ' from the project. Your scan files were not touched.', true); return;
      case 'rename': var ci2 = +a.dataset.c, cc = S.copies[ci2]; startRename(a, function () { return cc.name; }, function (v) {
        if (S.copies.some(function (x) { return x !== cc && x.name.toLowerCase() === v.toLowerCase(); })) { toast('A copy with this name already exists.'); return; } cc.name = v; }); return;
      case 'lbl': var r = +a.dataset.r; if (S.sel.row === r) return; anchor = null; S.sel.row = r; if (S.sel.ci == null && S.copies.length) S.sel.ci = 0; renderToolbar(); renderRows(); renderPreview(); renderBar(); return;
    }
  }
  // the right mouse button on a cell, a row name or a copy's heading: the menu for that cell (item 17)
  function onContextMenu(e) {
    if ($('#ws-scrim') || e.target.closest('input, textarea')) return;
    var cell = e.target.closest('.ws-cell'), lbl = e.target.closest('.ws-lbl'), hc = e.target.closest('.ws-hcell');
    if (!cell && !lbl && !hc) return;
    e.preventDefault();
    if (cell) {
      var ci = +cell.dataset.c, r = +cell.dataset.r, rg = range();
      if (!(rg && S.sel.ci === ci && r >= rg.lo && r <= rg.hi)) selectCell(ci, r);
    } else if (lbl) { var r2 = +lbl.dataset.r; selectCell(S.sel.ci == null ? 0 : S.sel.ci, r2); }
    else { selectCell(+hc.dataset.c, S.sel.row || 0); }
    openCellMenu(e.clientX, e.clientY);
  }
  var lastCellClick = null;
  function onDblClick(e) {
    var z = e.target.closest && e.target.closest('.ws-rz'); if (z) { if (z.dataset.c === 'lbl') fitLabels(); else fitWidth(+z.dataset.c); return; }
    if (e.target.closest && e.target.closest('.ws-cell')) return;                        // (a double-click on a cell is counted in onClick)
    var l0 = e.target.closest('.ws-lbl'); if (!l0) return;
    var r = +l0.dataset.r, l = root.querySelector('.ws-lbl[data-r="' + r + '"]'), b = l && l.querySelector('b');
    if (!b) return;
    startRename(b, function () { return rowLabel(r); }, function (v) { S.labels[r] = v; });
  }
  function onKey(e) {
    if (e.key === 'Escape') { if ($('#ws-scrim')) closeModal(); else if (root.querySelector('#ws-ctx')) { closeCellMenu(); var cm = $('#ws-vp'); if (cm) cm.focus({ preventScroll: true }); } else if (!$('#ws-menu').hidden) $('#ws-menu').hidden = true; e.stopPropagation(); return; }
    if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { var sc0 = root.querySelector('.ws-cell.sel'); if (sc0 && !$('#ws-scrim')) { e.preventDefault(); var rb = sc0.getBoundingClientRect(); openCellMenu(rb.left + 20, rb.bottom); } return; }
    if ($('#ws-scrim')) return;
    if (e.target.id === 'ws-title') return;                                       // typing the project's name (its own undo)
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); return e.shiftKey ? redo() : undo(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); return redo(); }
    if (!$('#ws-vp') || e.target.tagName === 'INPUT') return;
    var s = S.sel; if (s.ci == null) return;
    var N = rows(), nc = S.copies.length;
    if (e.shiftKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {         // Shift + up/down: mark a range in this column
      if (!anchor || anchor.ci !== s.ci) anchor = { ci: s.ci, row: s.row };
      s.row = e.key === 'ArrowDown' ? Math.min(N - 1, s.row + 1) : Math.max(0, s.row - 1);
      e.preventDefault(); renderToolbar(); renderRows(); renderPreview(); renderBar(); ensureVisible(s.row); return;
    }
    if (e.key === 'ArrowDown') { s.row = Math.min(N - 1, s.row + 1); anchor = null; }
    else if (e.key === 'ArrowUp') { s.row = Math.max(0, s.row - 1); anchor = null; }
    else if (e.key === 'ArrowRight') { s.ci = Math.min(nc - 1, s.ci + 1); anchor = null; }
    else if (e.key === 'ArrowLeft') { s.ci = Math.max(0, s.ci - 1); anchor = null; }
    else if (e.key === 'Delete') { deleteSelected(); return; }
    else if (e.key === '1' || e.key === '2') { var cp = S.copies[s.ci], slot = +e.key - 1, o = 1 - slot; if (cp) { if (S.pair[o] === cp.id) S.pair[o] = S.pair[slot]; S.pair[slot] = cp.id; touch(); renderAll(); } e.preventDefault(); return; }
    else return;
    e.preventDefault(); renderToolbar(); renderRows(); renderPreview(); renderBar(); ensureVisible(s.row); ensureColVisible(s.ci);
  }
  var drag = null, hdrag = null;
  function onDragStart(e) {
    if (rz) { e.preventDefault(); return; }                          // the edge of a heading is being dragged, not the heading
    var hc = e.target.closest && e.target.closest('.ws-hcell');
    if (hc) { hdrag = { ci: +hc.dataset.c }; e.dataTransfer.setData('text/plain', 'column'); e.dataTransfer.effectAllowed = 'move'; return; }
    var c = e.target.closest && e.target.closest('.ws-cell.filled');
    if (c) { drag = { ci: +c.dataset.c, row: +c.dataset.r }; e.dataTransfer.setData('text/plain', 'x'); e.dataTransfer.effectAllowed = 'move'; }
  }
  function clearDrop() { Array.prototype.forEach.call(root.querySelectorAll('.ws-cell.dropok, .ws-cell.ins-top, .ws-cell.ins-bot, .ws-hcell.dl, .ws-hcell.dr, .ws-addcell.dl'), function (x) { x.classList.remove('dropok', 'ins-top', 'ins-bot', 'dl', 'dr'); }); }
  // Where a dragged file would land (same copy only). On a file: it is INSERTED before it (upper half) or behind it (lower half), so
  // the files in between move by one place. On an empty cell ("no page"): the file goes into that cell and leaves an empty cell behind.
  function fileTarget(e) {
    var c = e.target.closest && e.target.closest('.ws-cell'); if (!c || !drag || +c.dataset.c !== drag.ci) return null;
    var row = +c.dataset.r;
    if (!c.classList.contains('filled')) return { el: c, row: row, into: true };
    var r = c.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
    return { el: c, row: row, into: false, at: row + (after ? 1 : 0), cls: after ? 'ins-bot' : 'ins-top' };      // at = the boundary between two rows
  }
  // the cells of a copy after moving the file of row `from` (pure: used by the drop and by the test)
  function insertMove(cells, from, t) {
    var out = cells.slice(), f = out[from];
    out.splice(from, 1); if (t > from) t--;
    out.splice(t, 0, f);
    return { cells: out, row: t };
  }
  // where a dragged heading would land: before or after the heading under the pointer (or at the end, over the "+" cell)
  function headTarget(e) {
    var h = e.target.closest && e.target.closest('.ws-hcell, .ws-addcell'); if (!h) return null;
    if (h.classList.contains('ws-addcell')) return { el: h, idx: S.copies.length, cls: 'dl' };
    var r = h.getBoundingClientRect(), after = e.clientX > r.left + r.width / 2;
    return { el: h, idx: +h.dataset.c + (after ? 1 : 0), cls: after ? 'dr' : 'dl' };
  }
  function onDragOver(e) {
    if (hdrag) { clearDrop(); var t = headTarget(e); if (t) { e.preventDefault(); t.el.classList.add(t.cls); } return; }
    clearDrop(); var t = fileTarget(e); if (!t) return;
    e.preventDefault();
    if (t.into) t.el.classList.add('dropok'); else if (t.at !== drag.row && t.at !== drag.row + 1) t.el.classList.add(t.cls);      // no line where nothing would change
  }
  function onDrop(e) {
    if (hdrag) {
      var t = headTarget(e), from = hdrag.ci; clearDrop(); hdrag = null;
      if (t) { e.preventDefault(); moveCopy(from, t.idx > from ? t.idx - 1 : t.idx); }
      return;
    }
    var t = fileTarget(e); clearDrop();
    if (!t) { drag = null; return; }
    e.preventDefault();
    var ci = drag.ci, from = drag.row, cp = S.copies[ci]; drag = null;
    if (t.into) {                                                      // onto an empty cell: the file moves there, an empty cell stays behind
      if (t.row === from) return;
      commit(); while (cp.cells.length <= t.row) cp.cells.push(null);
      cp.cells[t.row] = cp.cells[from]; cp.cells[from] = null; trim(cp);
      S.sel = { ci: ci, row: t.row }; changed(); return;
    }
    if (t.at === from || t.at === from + 1) return;                    // dropped next to its own place: nothing changes
    commit(); var mv = insertMove(cp.cells, from, t.at); cp.cells = mv.cells; trim(cp);
    S.sel = { ci: ci, row: mv.row }; changed();
  }
  async function newProject() {
    if (S.copies.length && dirty && !S.examples && !(await confirmDialog('Start a new project?', 'The current project has changes that are not saved. They will be lost.', 'Start new project'))) return;
    projectChanging();
    S = blank(); REG = {}; hist = { undo: [], redo: [] }; thumbMem.clear(); anchor = null; proj.target = null; proj.pack = null; proj.legacy = null; proj.state = 'none'; proj.name = ''; dirty = false;
    // 0.15.0 (owner): a new project always starts in the (empty) Pages tab, also when "New project" was chosen in the Compare tab
    if (window.CompareTab && CompareTab.isOpen && CompareTab.isOpen()) CompareTab.toPages(); else if (root && root.hidden) show();
    renderAll();
  }

  /* ---------------------------------------------------------------- the examples project (0.11.0, js/examples.js) */
  // A project made of pictures that come with Book Compare: one row per example, two copies. It lives in memory only (nothing is
  // saved); its pictures are fetched from the program's own files and kept as File objects, like scans from a folder chosen in Firefox.
  async function openExamples() {
    var X = window.BCExamples; if (!X) return false;
    show();
    if (S && S.copies.length && !S.examples && !(await mayReplace())) return false;
    var nc = X.copies.length, files = [], cells = [];
    for (var c0 = 0; c0 < nc; c0++) { files.push({}); cells.push([]); }
    try {
      for (var i = 0; i < X.list.length; i++) for (var k = 0; k < nc; k++) {
        var src = X.list[i].files[k];
        if (!src) { cells[k].push(null); continue; }                                           // (a copy without this page)
        var name = (i + 1) + ' ' + X.list[i].label + ' - ' + src.split('/').pop();
        var resp = await fetch(src); if (!resp.ok) throw new Error(src + ': ' + resp.status);
        var blob = await resp.blob();
        files[k][name] = new File([blob], name, { type: blob.type || 'image/jpeg', lastModified: 0 }); cells[k].push(name);
      }
    } catch (e) { toast('The examples could not be loaded (' + ((e && e.message) || e) + ').'); return false; }
    projectChanging();
    S = blank(); REG = {}; hist = { undo: [], redo: [] }; thumbMem.clear(); anchor = null;
    S.examples = true; S.title = 'Examples'; S.projectId = 'examples';
    for (var c = 0; c < nc; c++) {
      var r = newRoot(X.copies[c]); r.files = files[c];
      var keys = cells[c].filter(function (x) { return x; });
      var cp = { id: c + 1, name: X.copies[c], folder: r.name, w: 0, keys: keys, cells: cells[c].slice(), locs: [{ root: r.id, path: '' }] };
      REG[cp.id] = cp; S.copies.push(cp);
    }
    S.nextCopy = nc + 1; X.list.forEach(function (e, j) { S.labels[String(j)] = e.label; });
    S.flags = cleanFlags(X.flags || {}); S.annots = cleanAnnots(X.annotations || {}); S.nextAnn = maxAnnId() + 1;
    S.pair = [1, 2]; S.sel = { ci: 0, row: 0 };
    proj.target = null; proj.pack = null; proj.legacy = null; proj.state = 'none'; proj.name = 'Examples'; dirty = false;
    renderAll(); renderSave();
    await compareNow();
    return true;
  }

  // 0.16.0 (owner): the project's name field is as wide as its text, so that the save state follows the name closely, on the left, as in
  // the Compare tab (and not in the middle of the top bar)
  var fitCv = null;
  function fitTitle() {
    var ti = root && $('#ws-title'); if (!ti) return;
    var cs = getComputedStyle(ti), txt = ti.value || ti.placeholder || '';
    fitCv = fitCv || document.createElement('canvas');
    var x = fitCv.getContext('2d'); x.font = ti.value ? cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily : 'italic 400 15px ' + cs.fontFamily;
    ti.style.width = Math.round(Math.max(120, Math.min(430, x.measureText(txt).width + 22))) + 'px';
  }
  /* ---------------------------------------------------------------- showing and hiding the layer */
  function build() {
    root = document.createElement('div'); root.className = 'ws'; root.id = 'ws'; root.hidden = true;
    root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', 'Copies and pages'); root.tabIndex = -1;
    root.innerHTML =
      // one top bar for both views (items 13-16): name, project name, save state, the two tabs, help and the one menu
      // 0.17.0 (owner): no "Book Compare" (the window's title says it): the project's name first, large and bold; the background
      // alignment's progress follows it; the save state sits on the right, next to the tabs, which are a clear switch with icons
      '<div class="ws-top">' +
      '<input class="ws-title" id="ws-title" type="text" maxlength="160" spellcheck="false" autocomplete="off" aria-label="Name of the project" title="Name of the project (shown here and in the Compare tab; it is also proposed as the name of the project file)" placeholder="Name of the project, e.g. ' + TITLE_EXAMPLE + '">' +
      '<div class="bc-bgprog" id="ws-bgprog" hidden></div><div class="ws-sp"></div>' +
      '<button class="ws-save" id="ws-save" data-act="savechip"></button>' +
      '<div class="ws-tabs bc-tabs" role="tablist"><button class="ws-tab" role="tab" aria-selected="true" tabindex="-1"><svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path fill="currentColor" d="M3 3h8v8H3V3zm2 2v4h4V5H5zm8-2h8v8h-8V3zm2 2v4h4V5h-4zM3 13h8v8H3v-8zm2 2v4h4v-4H5zm8-2h8v8h-8v-8zm2 2v4h4v-4h-4z"/></svg><span>Pages</span></button><button class="ws-tab" role="tab" aria-selected="false" id="ws-compare" data-act="compare" title="Compare the two pages marked “1” and “2”"><svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path fill="currentColor" d="M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4v2h2V1H9v2zm0 15H5l4-5v5zm10-15h-5v2h5v13l-5-6v9h5a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z"/></svg><span>Compare</span></button></div>' +
      '<button class="ws-icon" data-act="help" aria-label="Help: how this screen works" title="How this screen works">?</button>' +
      '<button class="ws-icon ws-dots" id="ws-more" data-act="more" aria-label="Menu" aria-haspopup="true" title="Menu: project, export, help">&#8942;</button>' +
      '<div class="ws-menu" id="ws-menu" role="menu" hidden></div></div>' +
      '<div class="ws-banner" id="ws-banner" hidden></div><div class="ws-banner ws-bg" id="ws-bg" hidden></div>' +
      '<div class="ws-stage"><div class="ws-main"><div class="ws-toolbar" id="ws-toolbar"></div><div class="ws-gridbox" id="ws-gridbox"></div></div>' +
      // (0.15.0, owner: no "Compare 1 and 2" button under the previews any more - the Compare tab at the top right does it)
      '<aside class="ws-panel"><h2 id="ws-pvtitle"></h2><div class="ws-sub" id="ws-pvsub"></div><div class="ws-thumbs" id="ws-thumbs"></div></aside></div>' +
      '<div id="ws-layer"></div>' +
      '<input type="file" id="ws-dirinput" class="ws-hidden" webkitdirectory multiple><input type="file" id="ws-jsoninput" class="ws-hidden" accept=".bookcompare,.json,application/json">';
    document.body.appendChild(root);
    // the marks "1" and "2" have the colours chosen for the Superimposed view (0.11.0)
    var inkOn = function (hex) {                                       // white or near-black, whichever reads better on the colour
      var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || '')); if (!m) return '#fff';
      var lin = function (v) { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
      var L = 0.2126 * lin(parseInt(m[1], 16)) + 0.7152 * lin(parseInt(m[2], 16)) + 0.0722 * lin(parseInt(m[3], 16));
      return (1.05 / (L + 0.05)) >= ((L + 0.05) / 0.05) ? '#fff' : '#111';
    };
    var paintPair = function () { try { root.style.setProperty('--ws-c1', DIFF_COLOR_1); root.style.setProperty('--ws-c2', DIFF_COLOR_2); root.style.setProperty('--ws-c1ink', inkOn(DIFF_COLOR_1)); root.style.setProperty('--ws-c2ink', inkOn(DIFF_COLOR_2)); } catch (e) { /* viz.js not loaded */ } };
    paintPair(); document.addEventListener('diffcolorschange', paintPair);
    root.addEventListener('click', onClick);
    root.addEventListener('dblclick', onDblClick);
    root.addEventListener('contextmenu', onContextMenu);
    document.addEventListener('keydown', function (e) { if (root && !root.hidden) onKey(e); });
    document.addEventListener('keydown', function (e) {                       // Ctrl+S saves at once, in both views (0.11.0)
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || String(e.key).toLowerCase() !== 's') return;
      var on = (root && !root.hidden) || !!document.querySelector('div.result_container.ct-on');
      if (!on || !S || !S.copies.length || $('#ws-scrim')) return;
      e.preventDefault(); saveKey();
    }, true);
    root.addEventListener('dragstart', onDragStart);
    root.addEventListener('dragover', onDragOver);
    root.addEventListener('drop', onDrop);
    root.addEventListener('dragend', function () { drag = null; hdrag = null; clearDrop(); });
    root.addEventListener('pointerdown', onPointerDown);
    root.addEventListener('pointermove', onPointerMove);
    root.addEventListener('pointerup', onPointerUp);
    root.addEventListener('pointercancel', onPointerUp);
    var ti = $('#ws-title');
    ti.addEventListener('input', function () { S.title = ti.value.slice(0, 160); touch(); fitTitle(); if (window.CompareTab && CompareTab.titleChanged) CompareTab.titleChanged(); });
    window.addEventListener('resize', fitTitle);                                              // (also when another font is chosen)
    try { document.fonts.addEventListener('loadingdone', fitTitle); document.fonts.ready.then(fitTitle); } catch (e) { /* old browser */ }
    fitTitle();
    ti.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); ti.blur(); var v = $('#ws-vp'); if (v) v.focus({ preventScroll: true }); } });
    $('#ws-jsoninput').onchange = function () {
      var f = this.files && this.files[0]; if (!f) return;
      mayReplace().then(function (ok) { if (ok) return BCPack.projectFromBlob(f).then(function (j) { adopt(j, null); }); }).catch(function () { toast('That file could not be read as a project.'); });
    };
    window.addEventListener('resize', function () { if (root && !root.hidden) renderRows(); });
    window.addEventListener('beforeunload', function (e) {
      if (window.BCResults) BCResults.flush();                                              // (item 32: what is stored is listed in the index)
      if (S && S.copies.length && dirty) { if (proj.target) saveNow(); e.preventDefault(); e.returnValue = ''; }
    });
  }
  function show() {
    if (!S) S = blank();
    if (!root) build();
    root.hidden = false;
    renderAll();
    setTimeout(function () { if (S && S.copies.length >= 2 && window.CompareTab && CompareTab.preload) CompareTab.preload(); }, 1500);   // item 33
    helperReady.then(async function () {                        // the helper (if there is one) is known now
      var lp = await loadLastProject();
      if (lp && !S.copies.length) lastProject = lp;
      renderAll();
    });
    var vp = $('#ws-vp'); (vp || root).focus();
  }
  function hide() { if (root) { root.hidden = true; $('#ws-menu').hidden = true; closeModal(); } }
  function leave() { hide(); if (cb.leave) cb.leave(); }

  window.BookWorkspace = {
    open: show,
    show: show,
    hide: hide,
    onCompare: function (fn) { cb.compare = fn; },
    onLeave: function (fn) { cb.leave = fn; },
    openPending: openPending,
    projectInfo: function () { return { name: proj.name, title: S ? S.title || '' : '', file: proj.target ? targetFile(proj.target) : '', state: proj.state, legacy: !!proj.legacy, copies: S ? S.copies.length : 0 }; },
    menu: function (anchor) { if (!S) S = blank(); floatMenu(anchor); },
    compareMenu: function (h) { cmpMenu = h; },
    saveChip: function () { return saveChip(); },
    chipClick: function () { return chipClick(); },
    startInfo: startInfo,
    about: function () { if (!S) S = blank(); if (!root) build(); aboutDialog(); },
    beforeClose: beforeClose,
    saveForClose: saveForClose,
    startAction: startAction,
    openExamples: openExamples,
    checkUpdates: checkUpdatesNow,
    version: function () { return DESKTOP; },
    tab: tabApi
  };
  // desktop program: a project file that was double-clicked opens at once
  helperReady.then(function (h) {
    if (!h) return;
    var go = function () { openPending().catch(function () { }); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else setTimeout(go, 0);
  });
})();
