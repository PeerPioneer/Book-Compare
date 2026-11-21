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
  var proj = { target: null, legacy: null, state: 'none', name: '', err: '', timer: 0, saving: false, again: false };
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
  // Desktop program only: at most once a day, ask GitHub which version is the newest; if it is newer than this one, say so
  // (once a day at most). Nothing is downloaded or changed by itself: "Download" opens the download page in the browser.
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* no storage */ } }
  async function checkForUpdate() {
    if (!DESKTOP || !window.fetch) return;
    var now = Date.now(), DAY = 20 * 3600 * 1000, latest = lsGet('bc_latest_version');
    if (!latest || now - (+lsGet('bc_update_checked') || 0) > DAY) {
      try {
        var r = await fetch(RELEASES_API, { cache: 'no-store', headers: { Accept: 'application/vnd.github+json' } });
        if (r.ok) { var j = await r.json(); if (j && j.tag_name) { latest = String(j.tag_name).replace(/^v/i, ''); lsSet('bc_latest_version', latest); } }
        lsSet('bc_update_checked', String(now));
      } catch (e) { return; }                                                     // offline: try again next time
    }
    if (!latest || !newerVersion(latest, DESKTOP)) return;
    if (now - (+lsGet('bc_update_shown') || 0) < DAY) return;                     // "Later": not again today
    var b = $('#ws-update'); if (!b) return;
    b.innerHTML = '<span>A new version of Book Compare is available: <b>' + esc(latest) + '</b> (you have ' + esc(DESKTOP) + ').</span>' +
      '<button class="ws-tb primary" data-act="upd-dl">Go to the download page</button><button class="ws-tb" data-act="upd-later">Later</button>';
    b.hidden = false;
  }
  function hideUpdate() { var b = $('#ws-update'); if (b) b.hidden = true; lsSet('bc_update_shown', String(Date.now())); }

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
  async function hrequest(method, url, body) {
    var resp;
    try { resp = await fetch(url, { method: method, headers: { 'X-BookCompare': '1' }, body: body, cache: 'no-store' }); }
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
  async function hcall(ref, method, endpoint, rel, body) {
    for (var attempt = 0; attempt < 2; attempt++) {
      var resp = await hrequest(method, endpoint + '?root=' + encodeURIComponent(ref.id) + '&path=' + encodeURIComponent(rel), body);
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
        return new File([blob], this.name, { type: blob.type, lastModified: m });
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
  function blank() {
    return { projectId: uid(), roots: [], copies: [], labels: {}, ns: 0, skip: {}, flags: {}, annots: {}, tiles: {}, nextAnn: 1, folio: false, nextCopy: 1, sel: { ci: null, row: 0 }, pair: [null, null] };
  }
  function rows() { var m = 0; S.copies.forEach(function (c) { if (c.cells.length > m) m = c.cells.length; }); return m; }
  function trim(c) { while (c.cells.length && c.cells[c.cells.length - 1] === null) c.cells.pop(); }
  function copyById(id) { for (var i = 0; i < S.copies.length; i++) if (S.copies[i].id === id) return S.copies[i]; return null; }
  // Column widths: every copy has its own width (c.w, in pixels; empty = standard). Drag the right edge of a heading to change it.
  var MIN_W = 80, MAX_W = 700;
  function limitW(w) { return Math.min(MAX_W, Math.max(MIN_W, Math.round(+w) || MIN_W)); }
  function clampW(w) { w = Math.round(+w); return isFinite(w) && w > 0 ? limitW(w) : 0; }                    // from a project file: 0 = standard width
  function cw(c) { return c.w || COL_W; }
  function gridW() { var w = LBL_W + COL_W; S.copies.forEach(function (c) { w += cw(c); }); return w; }
  function colLeft(ci) { var x = LBL_W; for (var i = 0; i < ci; i++) x += cw(S.copies[i]); return x; }
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
    return JSON.stringify({ c: S.copies.map(function (c) { return { id: c.id, name: c.name, cells: c.cells }; }), l: S.labels, ns: S.ns, f: S.folio, sk: S.skip, fl: S.flags, an: S.annots, ti: S.tiles, s: S.sel, p: S.pair });
  }
  function restore(str) {
    var o = JSON.parse(str);
    S.copies = o.c.map(function (r) { var c = REG[r.id]; c.name = r.name; c.cells = r.cells; return c; });
    S.labels = o.l; S.ns = o.ns; S.folio = !!o.f; S.skip = o.sk; S.flags = o.fl || {}; S.annots = o.an || {}; S.tiles = o.ti || {}; S.sel = o.s; S.pair = o.p;
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
    return fh._info ? { size: fh._info.size, mtime: fh._info.mtime } : null;
  }

  /* ---------------------------------------------------------------- thumbnails (small copies made in the browser; the scans are not changed) */
  var thumbMem = new Map(), thumbQueue = [], thumbActive = 0, THUMB_W = 260, thumbFail = {};
  function thumbPromise(copy, key) {
    var mk = copy.id + '|' + key;
    if (thumbMem.has(mk)) return thumbMem.get(mk);
    var p = new Promise(function (resolve) { thumbQueue.push({ copy: copy, key: key, resolve: resolve, mk: mk }); pumpThumbs(); });
    thumbMem.set(mk, p);
    // a picture that could not be loaded is not remembered for long: the next look (or "Reload") tries again
    p.then(function (r) { if (r && r.err) { thumbFail[mk] = true; setTimeout(function () { if (thumbMem.get(mk) === p) { thumbMem.delete(mk); delete thumbFail[mk]; } }, 4000); } else delete thumbFail[mk]; });
    if (thumbMem.size > 700) { var first = thumbMem.keys().next().value; var old = thumbMem.get(first); thumbMem.delete(first); old.then(function (r) { if (r && r.url) URL.revokeObjectURL(r.url); }); }
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
      format: 'book-compare-project', version: 2, projectId: S.projectId, savedAt: new Date().toISOString(),
      nextCopy: S.nextCopy, ns: S.ns, folio: S.folio, labels: S.labels, skip: S.skip, flags: S.flags, annotations: S.annots, tiles: S.tiles, nextAnn: S.nextAnn, pair: S.pair, sel: S.sel,
      roots: S.roots.filter(function (r) { return used[r.id]; }).map(function (r) {
        var path = r.handle && r.handle.isHelper ? r.handle.rootPath : r.path;
        return path ? { id: r.id, name: r.name, path: path } : { id: r.id, name: r.name };
      }),
      copies: S.copies.map(function (c) { var o = { id: c.id, name: c.name, folder: c.folder, locs: c.locs, keys: c.keys, cells: c.cells }; if (c.w) o.w = c.w; return o; })
    };
  }
  function touch() { dirty = true; if (proj.target) { proj.state = 'dirty'; clearTimeout(proj.timer); proj.timer = setTimeout(saveNow, 700); } renderSave(); }
  function targetFile(t) { return t.fh ? t.fh.name : t.file; }
  function targetName(t) { return targetFile(t).replace(/\.bookcompare$/i, ''); }
  function isLegacy(t) { return targetFile(t) === LEGACY_FILE; }
  function abortError() { var e = new Error('cancelled'); e.name = 'AbortError'; return e; }
  async function targetWrite(t, text) {                                   // the ONLY place that writes: the project file
    var fh = t.fh || await t.dir.getFileHandle(t.file, { create: true });
    var w = await fh.createWritable();
    await w.write(text);
    await w.close();
  }
  async function targetRead(t) {
    var fh = t.fh || await t.dir.getFileHandle(t.file);
    return JSON.parse((await (await fh.getFile()).text()).replace(/^\uFEFF/, ''));
  }
  async function saveNow() {
    if (!proj.target) return;
    clearTimeout(proj.timer);
    if (proj.saving) { proj.again = true; return; }
    proj.saving = true; proj.state = 'saving'; renderSave();
    try {
      await targetWrite(proj.target, JSON.stringify(serialize(), null, 1));
      proj.state = 'saved'; dirty = false;
    } catch (e) { proj.state = 'error'; proj.err = niceError(e); }
    proj.saving = false;
    if (proj.again) { proj.again = false; proj.timer = setTimeout(saveNow, 50); }
    renderSave();
  }
  // before another project is opened: a change that is still waiting to be saved is saved now
  async function flushSave() { if (proj.target && (proj.state === 'dirty' || proj.saving)) { await saveNow(); for (var i = 0; i < 50 && proj.saving; i++) await new Promise(function (r) { setTimeout(r, 100); }); } }
  // true if the work so far may be replaced by another project (asks when there are changes that are saved nowhere)
  async function mayReplace() {
    await flushSave();
    if (!S || !S.copies.length || !dirty || proj.target) return true;
    return confirmDialog('The project is not saved', 'The changes to the project you are working on are not saved anywhere. Open the other project anyway?', 'Open anyway');
  }
  function renderSave() {
    if (!root) return;
    var b = $('#ws-save'), t = '', cls = 'ws-save';
    if (!HAS_FSA) { t = dirty ? 'Not saved · save project file' : 'Project file saved'; cls += dirty ? ' warn' : ' ok'; }
    else if (!proj.target) {
      t = !S.copies.length ? 'No project yet' : proj.legacy ? 'Older project · save it as a project file' : 'Not saved yet · save the project';
      cls += S.copies.length ? ' warn' : '';
    }
    else if (proj.state === 'saving' || proj.state === 'dirty') { t = 'Saving …'; }
    else if (proj.state === 'error') { t = 'Could not save · ' + proj.err; cls += ' bad'; }
    else { t = '✓ Saved · “' + proj.name + '”'; cls += ' ok'; }
    b.className = cls; b.textContent = t;
    b.title = proj.target ? 'Project file: ' + targetFile(proj.target) + '. Changes are saved automatically.'
      : proj.legacy ? 'This project was saved by an older version of Book Compare. Save it as a project file to keep your changes; the old project folder stays as it is.'
      : 'Save the project as a file (not in one of your scan folders).';
  }
  function suggestedName() {
    var n = proj.legacy ? (proj.legacy.dir ? proj.legacy.dir.name : '') : proj.name;
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
    var before = { target: proj.target, legacy: proj.legacy, name: proj.name };
    proj.target = t; proj.legacy = null; proj.name = targetName(t);
    await saveNow();
    if (proj.state === 'error') {
      var why = proj.err;
      proj.target = before.target; proj.legacy = before.legacy; proj.name = before.name; proj.state = proj.target ? 'saved' : 'none'; renderSave();
      return toast('The project could not be saved there: ' + why);
    }
    await rememberProject();
    renderAll();
    toast('Project saved as “' + proj.name + '”. From now on changes are saved automatically.');
  }
  function downloadProject() {
    var blob = new Blob([JSON.stringify(serialize(), null, 1)], { type: 'application/json' });
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
    var json;
    try { json = await targetRead(t); }
    catch (e) {
      if (e && e.name === 'NotFoundError') toast(isLegacy(t) && t.dir ? 'There is no Book Compare project in the folder “' + t.dir.name + '”.' : 'The project file “' + targetFile(t) + '” was not found.');
      else toast('The project file “' + targetFile(t) + '” could not be read.');
      return false;
    }
    return adopt(json, t);
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
    await readProject(t);
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
  async function adopt(json, t) {
    if (!json || json.format !== 'book-compare-project' || !Array.isArray(json.copies)) { toast('This is not a Book Compare project file.'); return false; }
    S = blank(); REG = {}; anchor = null;
    S.projectId = json.projectId || uid();
    S.ns = json.ns || 0; S.folio = !!json.folio; S.labels = json.labels || {}; S.skip = json.skip || {}; S.flags = cleanFlags(json.flags);
    S.annots = cleanAnnots(json.annotations); S.nextAnn = Math.max(+json.nextAnn || 1, maxAnnId() + 1); S.tiles = cleanTiles(json.tiles);
    S.pair = json.pair || [null, null]; S.sel = json.sel || { ci: null, row: 0 };
    // (a "set aside" tray from older versions is dropped: those files can be added again with "Add files to this copy")
    (json.roots || []).forEach(function (r) { S.roots.push({ id: r.id, name: r.name, path: r.path || '', handle: null, files: null, ok: false }); });
    var maxId = 0, legacy = [];
    for (var i = 0; i < json.copies.length; i++) {
      var r = json.copies[i], c = { id: r.id, name: r.name, folder: r.folder, w: clampW(r.w) || 0, keys: r.keys || [], cells: r.cells || [], locs: (r.locs || []).map(function (l) { return { root: l.root, path: l.path || '' }; }) };
      REG[c.id] = c; S.copies.push(c); if (c.id > maxId) maxId = c.id;
      if (!c.locs.length) legacy.push(c);
    }
    S.nextCopy = Math.max(json.nextCopy || 1, maxId + 1);
    if (S.sel.ci != null && !S.copies[S.sel.ci]) S.sel.ci = S.copies.length ? 0 : null;
    hist = { undo: [], redo: [] };
    thumbMem.clear();
    var oldFormat = !!(t && isLegacy(t));                      // (a project folder of an older version)
    proj.target = t && !oldFormat ? t : null; proj.legacy = oldFormat ? t : null; proj.name = !t ? '' : oldFormat ? (t.dir ? t.dir.name : '') : targetName(t);
    proj.state = proj.target ? 'saved' : 'none'; dirty = false;
    // folders this browser remembers for the project
    for (var k = 0; k < S.roots.length; k++) {
      var rt = S.roots[k];
      if (HELPER) {                                              // helper mode: the project file holds the folder's address
        if (rt.path) { try { rt.handle = await helperRegister(rt.path, 'scans'); rt.ok = true; } catch (e) { rt.handle = null; } }
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
      if (unsafe) { proj.target = null; proj.state = 'none'; }
    }
    if (proj.target) await rememberProject();
    renderAll(); renderSave();
    var copies = S.copies.length + ' cop' + (S.copies.length === 1 ? 'y' : 'ies');
    if (unsafe) toast('This project file lies in a folder that holds scans, so automatic saving is switched off. Save the project in another folder (More → Save project as …).');
    else if (oldFormat) toast('Project opened (' + copies + '). It was saved by an older version of Book Compare: to keep your changes, save it as a project file (More → Save project as …). The old project folder stays as it is.');
    else toast('Project opened: ' + copies + '.');
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
  function renderToolbar() {
    var s = selected(), tb = $('#ws-toolbar'), n = tb.querySelector('#gapN') ? tb.querySelector('#gapN').value : '1';
    var rg = range(), nrg = 0;
    if (rg) for (var q = rg.lo; q <= rg.hi; q++) if (s.c.cells[q]) nrg++;
    var where = s ? '<b>' + esc(s.c.name) + '</b> · ' + (rg ? esc(rowLabel(rg.lo)) + ' to ' + esc(rowLabel(rg.hi)) + ' (' + (rg.hi - rg.lo + 1) + ' rows)' : esc(rowLabel(s.row))) : 'Select a cell';
    tb.innerHTML = '<div class="sel">' + where + '</div>' +
      '<button class="ws-tb" data-act="addfiles"' + (s ? '' : ' disabled') + ' title="Add pictures to this copy: ones you deleted, or pages that are stored in another folder">Add files to this copy …</button>' +
      '<button class="ws-tb" data-act="mvl"' + (s && s.ci > 0 ? '' : ' disabled') + ' title="Moves the whole column of this copy one place to the left (you can also drag the heading of a column)">&#9664; Move copy</button>' +
      '<button class="ws-tb" data-act="mvr"' + (s && s.ci < S.copies.length - 1 ? '' : ' disabled') + ' title="Moves the whole column of this copy one place to the right">Move copy &#9654;</button>' +
      '<span class="ws-vsep"></span>' +
      '<span class="ws-numwrap">Pages <input type="number" id="gapN" min="1" max="999" value="' + esc(n) + '" aria-label="Number of pages"></span>' +
      '<button class="ws-tb" data-act="gap"' + (s ? '' : ' disabled') + ' title="Pushes this cell and everything below it down">Insert gap here</button>' +
      '<button class="ws-tb" data-act="closegap"' + (s && !s.key ? '' : ' disabled') + ' title="Pulls everything below up again">Close gap</button>' +
      '<button class="ws-tb" data-act="del"' + ((rg ? nrg : s && s.key) ? '' : ' disabled') + ' title="' + (rg ? 'Removes all the marked rows of this column from the workspace; the pages below move up.' : 'Removes this file from the workspace (for covers, flyleaves, duplicates). Hold Shift and click another cell (or press Shift + arrow) to mark several in one go.') + ' The scan files on your disk are not touched. Undo brings them back.">' + (rg ? 'Delete ' + nrg + ' file' + (nrg === 1 ? '' : 's') : 'Delete file') + '</button>' +
      '<span class="ws-vsep"></span>' +
      '<button class="ws-tb" data-act="startnum"' + (s ? '' : ' disabled') + ' title="Rows above become front matter (Front 1, Front 2 …). This row becomes the first numbered page. You choose pagination or foliation.">Start numbering at this row</button>' +
      '<button class="ws-tb" data-act="skiprow"' + (s ? '' : ' disabled') + ' title="Keeps the row in the grid but leaves it out of the comparison">' + (s && S.skip[s.row] ? 'Compare this row again' : 'Don’t compare this row') + '</button>' +
      '<span class="ws-vsep"></span>' +
      '<button class="ws-tb" data-act="undo"' + (hist.undo.length ? '' : ' disabled') + '>Undo</button>' +
      '<button class="ws-tb" data-act="redo"' + (hist.redo.length ? '' : ' disabled') + '>Redo</button>';
  }
  function nameList(list) {
    var names = list.map(function (c) { return c.name; });
    return esc(names.length > 4 ? names.slice(0, 4).join(', ') + ' and ' + (names.length - 4) + ' more' : names.join(', '));
  }
  function renderSummary() {
    var n = S.copies.length;
    $('#ws-summary').innerHTML = '<span>' + n + ' cop' + (n === 1 ? 'y' : 'ies') + '</span><span>' + rows() + ' rows</span>';
    var lost = S.copies.filter(copyLost), bn = $('#ws-banner'), used = usedRoots();
    var allow = used.filter(function (r) { return r.handle && !r.ok; }), find = used.filter(function (r) { return !r.handle && !r.files; });
    bn.hidden = !lost.length || (!allow.length && !find.length);
    if (bn.hidden) return;
    var h = '';
    if (allow.length) h += '<span>The browser locks your scans after a restart (<b>' + nameList(lost) + '</b>). Pictures you have seen before are still shown. When you press COMPARE the browser asks for permission by itself; to see every page now, allow access here.</span><button class="ws-tb primary" data-act="allow">Allow access now</button>';
    if (find.length) h += '<span>' + (allow.length ? 'For some copies the folder is not known on this computer. ' : 'Book Compare cannot find the scans of <b>' + nameList(lost) + '</b> on this computer. ') + 'Choose the folder that holds them (one choice is enough for all copies inside it).</span><button class="ws-tb' + (allow.length ? '' : ' primary') + '" data-act="reconnect">Choose scan folder …</button>';
    else if (allow.length > 1) h += '<button class="ws-tb" data-act="reconnect" title="Pick the folder that holds all your copies once. After that a single permission is enough.">Choose one folder for all …</button>';
    bn.innerHTML = h;
  }
  function renderGridShell() {
    var gb = $('#ws-gridbox');
    if (!S.copies.length) {
      gb.innerHTML = '<div class="ws-empty"><h2>No copies yet</h2><p>Add the first copy to start. Each copy is one folder of scans on your disk. You can add the others one by one afterwards.</p><div class="acts"><button class="ws-tb primary" data-act="add" style="padding:10px 18px;font-size:15px">Add first copy</button><button class="ws-tb" data-act="openproj" style="padding:10px 18px;font-size:15px">Open saved project …</button>' +
        (lastProject ? '<button class="ws-tb" data-act="continue" style="padding:10px 18px;font-size:15px">Continue “' + esc(lastProject.name) + '”</button>' : '') + '</div></div>';
      return;
    }
    var w = gridW();
    var h = '<div class="ws-vp" id="ws-vp" tabindex="0" aria-label="Page grid. Arrow keys move the selection."><div class="ws-inner" id="ws-inner" style="width:' + w + 'px;height:' + (HEAD_H + rows() * ROW_H) + 'px">';
    h += '<div class="ws-hrow" style="width:' + w + 'px"><div class="ws-corner">Page</div>';
    S.copies.forEach(function (c, i) {
      var cnt = 0; c.cells.forEach(function (x) { if (x) cnt++; });
      var k = c.id === S.pair[0] ? ' k1' : c.id === S.pair[1] ? ' k2' : '', lost = copyLost(c);
      h += '<div class="ws-hcell' + k + '" draggable="true" data-c="' + i + '" style="width:' + cw(c) + 'px;flex-basis:' + cw(c) + 'px" title="Drag the heading to move this column"><div class="ws-hname" data-act="rename" data-c="' + i + '" title="Click to rename">' + esc(c.name) + '</div><div class="ws-hmeta' + (lost ? ' lost' : '') + '">' + (lost ? lostWhy(c) : cnt + ' file' + (cnt === 1 ? '' : 's') + ' in grid') + '</div><button class="x" data-act="remove" data-c="' + i + '" aria-label="Remove copy ' + esc(c.name) + '" title="Remove this copy from the project (your scan files are not touched)">&times;</button><div class="ws-rz" data-c="' + i + '" title="Drag to change the width of this column. Double-click: fit the file names."></div></div>';
    });
    h += '<div class="ws-addcell"><button class="ws-addbtn" data-act="add"><span class="plus">+</span><small>Add new copy</small></button></div></div><div id="ws-rowshost"></div></div></div>';
    gb.innerHTML = h;
    $('#ws-vp').addEventListener('scroll', renderRows);
  }
  function flagMark(i) {                                              // the small flag at the right edge of a row label
    var f = S.flags[i]; if (f == null) return '';
    return '<svg class="ws-flag" viewBox="0 0 24 24" width="15" height="15" role="img" style="color:' + FLAG_COLORS[f] + '"><title>Flagged (' + FLAG_NAMES[f] + ')</title><path fill="currentColor" d="' + FLAG_PATH + '"/></svg>';
  }
  function renderRows() {
    var vp = $('#ws-vp'), host = $('#ws-rowshost'); if (!vp || !host) return;
    var N = rows(), top = vp.scrollTop, vh = vp.clientHeight;
    var a = Math.max(0, Math.floor((top - HEAD_H) / ROW_H) - OVERSCAN), b = Math.min(N - 1, Math.ceil((top + vh) / ROW_H) + OVERSCAN), h = '';
    var lostC = S.copies.map(copyLost), rg = range();
    for (var i = a; i <= b; i++) {
      var n = 0, cells = '';
      S.copies.forEach(function (c, ci) {
        var key = c.cells[i] || null, sel = (S.sel.ci === ci && S.sel.row === i) ? ' sel' : (rg && rg.ci === ci && i >= rg.lo && i <= rg.hi ? ' rng' : ''), wst = ' style="width:' + cw(c) + 'px;flex-basis:' + cw(c) + 'px"';
        var pm = c.id === S.pair[0] ? '<b class="pm m1">1</b>' : c.id === S.pair[1] ? '<b class="pm m2">2</b>' : '';
        if (key) { n++; cells += '<div class="ws-cell filled' + (lostC[ci] ? ' lostc' : '') + sel + '" draggable="true" data-c="' + ci + '" data-r="' + i + '"' + wst + '><i class="ico"></i><span class="fn" title="' + esc(key) + '">' + esc(baseName(key)) + '</span>' + pm + '</div>'; }
        else cells += '<div class="ws-cell empty' + sel + '" data-c="' + ci + '" data-r="' + i + '"' + wst + '><span class="gap">no page</span></div>';
      });
      var sk = !!S.skip[i], small = sk ? 'not compared' : (i === S.ns && S.ns > 0 ? 'starts here' : n + ' of ' + S.copies.length + ' copies');
      h += '<div class="ws-row' + (S.sel.row === i ? ' selrow' : '') + (sk ? ' skipped' : '') + (i === S.ns && S.ns > 0 ? ' numstart' : '') + '" style="top:' + (HEAD_H + i * ROW_H) + 'px" data-r="' + i + '"><div class="ws-lbl" data-act="lbl" data-r="' + i + '"><b>' + esc(rowLabel(i)) + '</b><small>' + small + '</small>' + flagMark(i) + '</div>' + cells + '</div>';
    }
    host.innerHTML = h;
  }
  var pvTok = 0;
  function renderPreview() {
    var tok = ++pvTok, row = S.sel.row, h = '';
    $('#ws-pvtitle').textContent = S.copies.length ? rowLabel(row) : 'Row';
    var sub = !S.copies.length ? 'Previews appear here.' : S.skip[row] ? 'This row will not be compared.' : 'The same page in every copy. Mark two with “1” and “2”, then press COMPARE.';
    $('#ws-pvsub').innerHTML = '<span class="txt">' + esc(sub) + '</span>' + (S.copies.length > 1 ? '<button class="ws-tb" data-act="swap" title="Swap copy 1 and copy 2">⇄ Swap 1 and 2</button>' : '');
    S.copies.forEach(function (c, ci) {
      var key = c.cells[row] || null;
      if (!key) { h += '<div class="ws-th miss"><div class="pg">no page in this copy</div><div class="nm">' + esc(c.name) + '</div></div>'; return; }
      var cls = (ci === S.sel.ci ? ' cur' : '') + (c.id === S.pair[0] ? ' p1' : c.id === S.pair[1] ? ' p2' : '');
      h += '<div class="ws-th' + cls + '"><div class="pg" data-ci="' + ci + '" data-act="selcell"><span class="ws-nopv">Loading …</span></div><div class="nm">' + esc(c.name) + '</div><div class="fnm" title="' + esc(key) + '">' + esc(baseName(key)) + '</div>' +
        '<div class="pick"><button data-act="pick" data-ci="' + ci + '" data-slot="0" class="' + (c.id === S.pair[0] ? 'on1' : '') + '" title="Use this page as copy 1 (red)">1</button><button data-act="pick" data-ci="' + ci + '" data-slot="1" class="' + (c.id === S.pair[1] ? 'on2' : '') + '" title="Use this page as copy 2 (green)">2</button></div></div>';
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
    var b = $('#ws-compare');
    b.classList.toggle('notready', !canCompare());
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
    if (l < vp.scrollLeft + LBL_W) vp.scrollLeft = Math.max(0, l - LBL_W);
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
    var old = $('#ws-toast'); if (old) old.remove();
    var d = document.createElement('div'); d.id = 'ws-toast'; d.className = 'ws-toast'; d.setAttribute('role', 'status');
    d.innerHTML = '<span>' + esc(msg) + '</span>' + (withUndo ? '<button data-act="undo">Undo</button>' : '');
    root.appendChild(d); clearTimeout(toastT); toastT = setTimeout(function () { d.remove(); }, withUndo ? 7000 : 4500);
  }
  function modal(html) {
    closeModal();
    var sc = document.createElement('div'); sc.className = 'ws-scrim'; sc.id = 'ws-scrim';
    sc.innerHTML = '<div class="ws-dlg" role="dialog" aria-modal="true">' + html + '</div>';
    $('#ws-layer').appendChild(sc);
    sc.addEventListener('mousedown', function (e) { if (e.target === sc) closeModal(); });
    return sc;
  }
  function closeModal() { var s = root && $('#ws-scrim'); if (s) s.remove(); }
  function confirmDialog(title, text, okLabel) {
    return new Promise(function (resolve) {
      var sc = modal('<h3>' + esc(title) + '</h3><p>' + text + '</p><div class="acts"><button class="ws-tb" id="cf-no">Cancel</button><button class="ws-tb primary" id="cf-yes">' + esc(okLabel) + '</button></div>');
      sc.querySelector('#cf-no').onclick = function () { closeModal(); resolve(false); };
      sc.querySelector('#cf-yes').onclick = function () { closeModal(); resolve(true); };
    });
  }
  function helpDialog() {
    modal('<h3>How this screen works</h3><ul>' +
      '<li>Each <b>column</b> is one copy: a folder of scans on your disk. Each <b>row</b> is one page position. The pages in a row will be compared with each other.</li>' +
      '<li>Book Compare only <b>reads</b> your scan folders. Everything you do here (gaps, renaming, deleting files) changes only the project, never a scan file.</li>' +
      '<li>A copy with missing pages has <b>empty cells</b>. Select a cell and use <b>Insert gap here</b> to push the following files down, or <b>Close gap</b> to pull them up.</li>' +
      '<li>Covers, flyleaves and duplicates can be removed from the grid with <b>Delete file</b>. The scan itself stays on your disk, and <b>Add files to this copy</b> brings it back.</li>' +
      '<li><b>Add files to this copy</b> also adds pictures from another folder, for example pages that were scanned later.</li>' +
      '<li>Rows are positions in the book, not tied to any copy. If the first rows hold a cover or flyleaf, select the row of the first printed page and choose <b>Start numbering at this row</b>: you decide there between pagination (Page 1, 2, 3 …) and foliation (1r, 1v, 2r …). You can switch later under <b>More</b>. Double-click a row name to rename it.</li>' +
      '<li><b>Don’t compare this row</b> keeps a row in the grid but leaves it out of the comparison.</li>' +
      '<li>On the right you see the page of every copy in the selected row. Mark two of them with <b>1</b> and <b>2</b>, then press <b>COMPARE</b>: they open in the <b>Compare tab</b>, which aligns them by itself. There you can go through the book page by page, flag pages (key F), draw circles, rectangles and notes on the superimposed picture, and see the whole book on the book map. The arrows button at the top right (<b>focus mode</b>) hides everything except the pictures; Esc brings it back. The <b>Pages</b> tab or <b>Back</b> there brings you here again.</li>' +
      '<li>When you reopen a saved project the browser asks once for permission to read your scans again. Click <b>Allow access to scans</b>; you do not have to pick the folders again.</li>' +
      '<li><b>Delete several files at once:</b> click the first cell, hold <b>Shift</b> and click the last one (or press Shift + the up/down arrow). The whole range is marked; <b>Delete</b> removes it and the pages below move up.</li>' +
      '<li><b>Column width:</b> drag the right edge of a column heading; a double-click fits the longest file name. <b>More › Standard width for all columns</b> resets them.</li>' +
      '<li><b>Moving a copy:</b> drag its heading to another place, or use <b>Move copy</b> in the toolbar. Undo works for this too.</li>' +
      '<li>If a preview says it could not be loaded, press <b>Reload</b> under it. Ctrl+Z undoes the last change. Arrow keys move the selection.</li>' +
      '<li><b>More › Measure speed on this computer</b> aligns a few real pages one after the other and shows how long each step takes here. It only reads your scans.</li></ul>' +
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
      '<p class="note">Files are placed in name order, one per row. You fix the placement afterwards in the grid. Book Compare only reads the scan folder; it never changes anything in it. If one folder holds the scans of several copies, choose it once: for the next copy it is in the list of folders used so far.</p>' +
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
        g.chosen = {}; if (pk.groups.length === 1) g.keys.forEach(function (k) { g.chosen[k] = true; });          // one folder: all of it is the default
        g.by = used[joinPath(pk.path, g.keys[0])] || '';
      });
      var h = '<div class="note">' + (pk.groups.length === 1 ? 'Folder used:' : 'The pictures are in several folders. Tick the ones that belong to this copy:') + '</div><div class="groups big">';
      pk.groups.forEach(function (g, i) {
        h += '<details data-gi="' + i + '"><summary><label><input type="checkbox" data-g="' + i + '"' + (pk.groups.length === 1 ? ' checked' : '') + '> ' + (g.path ? esc(g.path) : 'directly in “' + esc(pk.name) + '”') + ' <span class="note">· <span data-gn="' + i + '"></span></span></label></summary><div class="flist" data-gl="' + i + '"></div></details>';
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
      '<p class="note">Add pictures that are not in the grid yet: pages you deleted, or pages that are stored in another folder.</p>' +
      srcBlock('af') +
      '<div id="af-list"></div>' +
      '<fieldset class="place"><legend>Where should they go?</legend>' +
      '<label class="inl"><input type="radio" name="af-where" value="end"' + (startRow ? '' : ' checked') + '> At the end of the copy</label>' +
      '<label class="inl"><input type="radio" name="af-where" value="row"' + (startRow ? ' checked' : '') + '> Starting at row <input type="number" id="af-row" min="1" value="' + (startRow || s.row + 1) + '"> <span class="note" id="af-rowlbl"></span></label>' +
      '</fieldset><p class="note">Empty cells are filled first. If a cell is already taken, the pages below move down.</p>' +
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
      '<label class="inl opt"><input type="radio" name="nm-style" value="page"' + (folio ? '' : ' checked') + '><span><b>Pagination</b><br>Every page gets a number: Page 1, Page 2, Page 3 …</span></label>' +
      '<label class="inl opt"><input type="radio" name="nm-style" value="folio"' + (folio ? ' checked' : '') + '><span><b>Foliation</b><br>Every leaf gets a number, front and back: 1r, 1v, 2r, 2v …</span></label>' +
      '<p class="note">You can switch between the two later under More. Row names you typed yourself are kept.</p>' +
      '<div class="acts"><button class="ws-tb" data-close>Cancel</button><button class="ws-tb primary" id="nm-ok">Start numbering</button></div>');
    sc.querySelector('#nm-ok').onclick = function () {
      var f = sc.querySelector('input[name=nm-style]:checked').value === 'folio';
      commit(); S.ns = row; S.folio = f; closeModal(); changed();
      toast((row ? 'Rows above are front matter now. ' : '') + 'Row ' + (row + 1) + ' is ' + (f ? 'folio 1r' : 'Page 1') + '.', true);
    };
    sc.querySelector('#nm-ok').focus();
  }

  function renderMenu() {
    var m = $('#ws-menu'), lost = usedRoots().some(function (r) { return !rootReady(r); });
    m.innerHTML =
      '<button data-m="save"><span class="tick"></span>' + (HAS_FSA ? (proj.target ? 'Save project as …' : 'Save project …') : 'Download project file') + '</button>' +
      '<button data-m="open"><span class="tick"></span>Open project …</button>' +
      '<button data-m="reconnect"' + (lost ? '' : ' disabled') + '><span class="tick"></span>Choose scan folder again …</button><hr>' +
      '<button data-m="folio"><span class="tick"></span>' + (S.folio ? 'Switch to pagination (Page 1, Page 2 …)' : 'Switch to foliation (1r, 1v, 2r …)') + '</button>' +
      '<button data-m="colw"><span class="tick"></span>Standard width for all columns</button>' +
      '<button data-m="help"><span class="tick"></span>How this screen works</button>' +
      '<button data-m="speed"><span class="tick"></span>Measure speed on this computer …</button><hr>' +
      '<button data-m="new"><span class="tick"></span>Start a new empty project</button>' +
      (DESKTOP ? '' : '<hr><button data-m="download"><span class="tick"></span>Desktop program for Windows …</button>');
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
    return { urls: [URL.createObjectURL(f1), URL.createObjectURL(f2)], names: [f1.name, f2.name], files: [f1, f2], key: a.id + '#' + a.cells[r] };
  }
  // COMPARE in the Pages view: check that the two scans can be read (errors stay here as a message), then open the Compare tab.
  async function compareNow() {
    var d;
    try { d = await loadPair(); } catch (e) { return toast(e && e.message ? e.message : String(e)); }
    hide();
    if (cb.compare) cb.compare(d);
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
    // ---- for the speed test (js/speedtest.js): it reads scans and changes nothing in the project
    modal: modal, closeModal: closeModal,
    // Which page to time: the selected row if copy 1 and another copy have a page there, otherwise the row that most copies share with copy 1.
    // Also counts the comparisons a whole book would need (every copy against copy 1, and every copy against every other).
    speedPlan: function () {
      ensurePair();
      var ref = copyById(S.pair[0]), n = rows(), i;
      if (!ref || S.copies.length < 2) return { ok: false, msg: 'The speed test needs a project with at least two copies. Add the copies in the Pages view first.' };
      function count(r) { var k = 0; S.copies.forEach(function (c) { if (c.cells[r]) k++; }); return k; }
      var pairsRef = 0, rowsRef = 0, pairsAll = 0, row = -1, best = 1;
      for (i = 0; i < n; i++) {
        if (S.skip[i]) continue;
        var k = count(i); pairsAll += k * (k - 1) / 2;
        if (ref.cells[i]) { rowsRef++; pairsRef += k - 1; if (k > best) { best = k; row = i; } }
      }
      if (S.sel.row >= 0 && S.sel.row < n && !S.skip[S.sel.row] && ref.cells[S.sel.row] && count(S.sel.row) >= 2) row = S.sel.row;
      if (row < 0) return { ok: false, msg: 'Copy 1 (' + ref.name + ') shares no page with another copy. Choose another copy as copy 1 or another row, then try again.' };
      var items = [], locked = [];
      function checkLock(c) {
        var sk = splitKey(c.cells[row]), l = c.locs && c.locs[sk.n], r = l && rootById(l.root);
        if (r && !rootReady(r) && locked.indexOf(r.name) < 0) locked.push(r.name);
      }
      checkLock(ref);
      S.copies.forEach(function (c) { if (c.id !== ref.id && c.cells[row]) { items.push({ id: c.id, name: c.name }); checkLock(c); } });
      return { ok: true, ref: { id: ref.id, name: ref.name }, row: row, rowLabel: rowLabel(row), items: items, locked: locked, pairsRef: pairsRef, rowsRef: rowsRef, pairsAll: pairsAll, rows: n, copies: S.copies.length };
    },
    // the scan (a File) of a copy in a row; throws an Error whose message can be shown as it is
    speedFile: async function (id, row) {
      var c = copyById(id), key = c && c.cells[row];
      if (!key) throw refusal('This copy has no page in this row.');
      try { return await getScan(c, key); }
      catch (e) { throw refusal(e && e.name === 'Lost' ? e.message : 'Could not open the scan: ' + niceError(e)); }
    },
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
    showPages: function () { show(); }
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
    var w = gridW() + 'px'; inner.style.width = w; hr.style.width = w;
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
    var c = S.copies[+h.dataset.c]; if (!c) return;
    e.preventDefault(); e.stopPropagation();
    rz = { ci: +h.dataset.c, x: e.clientX, w: cw(c), moved: false };
    try { h.setPointerCapture(e.pointerId); } catch (_) {}
    root.classList.add('rzing');
  }
  function onPointerMove(e) {
    if (!rz) return;
    var c = S.copies[rz.ci]; if (!c) return;
    rz.moved = true; c.w = limitW(rz.w + e.clientX - rz.x); applyWidths();
  }
  function onPointerUp() {
    if (!rz) return;
    var was = rz; rz = null; root.classList.remove('rzing');
    if (was.moved) touch();
  }
  function resetWidths() { S.copies.forEach(function (c) { c.w = 0; }); applyWidths(); touch(); toast('All columns have the standard width again.'); }
  function onClick(e) {
    var t = e.target, el;
    if (t.closest('[data-close]')) return closeModal();
    if (!t.closest('#ws-menu') && !t.closest('#ws-more')) $('#ws-menu').hidden = true;
    if ((el = t.closest('[data-m]'))) {
      var m = el.dataset.m; $('#ws-menu').hidden = true;
      if (m === 'save') saveProjectAs();
      else if (m === 'open') openProject();
      else if (m === 'reconnect') reconnectScans();
      else if (m === 'folio') { commit(); S.folio = !S.folio; changed(); toast(S.folio ? 'Rows are numbered as folios now (1r, 1v, 2r …).' : 'Rows are numbered as pages now (Page 1, Page 2 …).', true); }
      else if (m === 'help') helpDialog();
      else if (m === 'colw') resetWidths();
      else if (m === 'speed') { if (window.SpeedTest) window.SpeedTest.open(); }
      else if (m === 'new') newProject();
      else if (m === 'download') openDownloadPage();
      return;
    }
    var cell = t.closest('.ws-cell');
    if (cell && !t.closest('[data-act]')) { if (e.shiftKey) extendTo(+cell.dataset.c, +cell.dataset.r); else selectCell(+cell.dataset.c, +cell.dataset.r); var v = $('#ws-vp'); if (v) v.focus({ preventScroll: true }); return; }
    var a = t.closest('[data-act]'); if (!a) return;
    var act = a.dataset.act, s = selected();
    switch (act) {
      case 'add': return addDialog();
      case 'addfiles': return addFilesDialog();
      case 'undo': return undo();
      case 'redo': return redo();
      case 'help': return helpDialog();
      case 'back': return leave();
      case 'more': renderMenu(); $('#ws-menu').hidden = !$('#ws-menu').hidden; return;
      case 'compare': return compareNow();
      case 'savechip': return proj.target ? (proj.state === 'error' ? saveNow() : toast('Project file: “' + targetFile(proj.target) + '”. Changes are saved automatically.')) : saveProjectAs();
      case 'openproj': return openProject();
      case 'continue': return continueLast();
      case 'upd-dl': hideUpdate(); return openDownloadPage();
      case 'upd-later': return hideUpdate();
      case 'allow': return allowAccess(false);
      case 'reconnect': return reconnectScans();
      case 'swap': S.pair = [S.pair[1], S.pair[0]]; touch(); renderAll(); return;
      case 'pick': var cp = S.copies[+a.dataset.ci], slot = +a.dataset.slot; if (cp) { var o = 1 - slot; if (S.pair[o] === cp.id) S.pair[o] = S.pair[slot]; S.pair[slot] = cp.id; touch(); renderAll(); } return;
      case 'selcell': selectCell(+a.dataset.ci, S.sel.row); return;
      case 'reload': reloadThumb(+a.dataset.ci); return;
      case 'mvl': if (s && s.ci > 0) moveCopy(s.ci, s.ci - 1); return;
      case 'mvr': if (s && s.ci < S.copies.length - 1) moveCopy(s.ci, s.ci + 1); return;
      case 'startnum': if (s) numberingDialog(s); return;
      case 'skiprow': if (s) { commit(); if (S.skip[s.row]) delete S.skip[s.row]; else S.skip[s.row] = true; changed(); toast(S.skip[s.row] ? 'This row will not be compared.' : 'This row will be compared again.', true); } return;
      case 'gap': if (s) { var n = Math.max(1, parseInt($('#gapN').value, 10) || 1); commit(); insertGap(s.c, s.row, n); changed(); toast('Inserted ' + n + ' empty page' + (n > 1 ? 's' : '') + '.', true); } return;
      case 'closegap': if (s) { var n2 = Math.max(1, parseInt($('#gapN').value, 10) || 1); commit(); var k = closeGap(s.c, s.row, n2); trim(s.c); changed(); toast(k ? 'Closed ' + k + ' gap' + (k > 1 ? 's' : '') + '.' : 'Nothing to close.', true); } return;
      case 'del': return deleteSelected();
      case 'remove':
        var ci = +a.dataset.c, nm = S.copies[ci].name; commit(); S.copies.splice(ci, 1);
        S.sel.ci = S.copies.length ? Math.min(S.sel.ci == null ? 0 : S.sel.ci, S.copies.length - 1) : null; ensurePair();
        changed(); toast('Removed ' + nm + ' from the project. Your scan files were not touched.', true); return;
      case 'rename': var ci2 = +a.dataset.c, cc = S.copies[ci2]; startRename(a, function () { return cc.name; }, function (v) {
        if (S.copies.some(function (x) { return x !== cc && x.name.toLowerCase() === v.toLowerCase(); })) { toast('A copy with this name already exists.'); return; } cc.name = v; }); return;
      case 'lbl': var r = +a.dataset.r; if (S.sel.row === r) return; anchor = null; S.sel.row = r; if (S.sel.ci == null && S.copies.length) S.sel.ci = 0; renderToolbar(); renderRows(); renderPreview(); renderBar(); return;
    }
  }
  function onDblClick(e) {
    var z = e.target.closest && e.target.closest('.ws-rz'); if (z) { fitWidth(+z.dataset.c); return; }
    var l0 = e.target.closest('.ws-lbl'); if (!l0) return;
    var r = +l0.dataset.r, l = root.querySelector('.ws-lbl[data-r="' + r + '"]'), b = l && l.querySelector('b');
    if (!b) return;
    startRename(b, function () { return rowLabel(r); }, function (v) { S.labels[r] = v; });
  }
  function onKey(e) {
    if (e.key === 'Escape') { if ($('#ws-scrim')) closeModal(); else if (!$('#ws-menu').hidden) $('#ws-menu').hidden = true; e.stopPropagation(); return; }
    if ($('#ws-scrim')) return;
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
    if (S.copies.length && dirty && !(await confirmDialog('Start a new project?', 'The current project has changes that are not saved. They will be lost.', 'Start new project'))) return;
    S = blank(); REG = {}; hist = { undo: [], redo: [] }; thumbMem.clear(); anchor = null; proj.target = null; proj.legacy = null; proj.state = 'none'; proj.name = ''; dirty = false;
    renderAll();
  }

  /* ---------------------------------------------------------------- showing and hiding the layer */
  function build() {
    root = document.createElement('div'); root.className = 'ws'; root.id = 'ws'; root.hidden = true;
    root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', 'Copies and pages'); root.tabIndex = -1;
    root.innerHTML =
      '<div class="ws-head"><div class="ws-headtext"><h1>Copies and pages</h1><p>Each column is one copy, each row one page position. Check that every row shows the same page in all copies, then mark two pages and compare them.</p></div>' +
      '<button class="ws-save" id="ws-save" data-act="savechip"></button><button class="ws-icon" data-act="help" aria-label="Help">?</button></div>' +
      '<div class="ws-banner" id="ws-banner" hidden></div><div class="ws-banner ws-update" id="ws-update" hidden></div>' +
      '<div class="ws-stage"><div class="ws-main"><div class="ws-toolbar" id="ws-toolbar"></div><div class="ws-summary" id="ws-summary"></div><div class="ws-gridbox" id="ws-gridbox"></div></div>' +
      '<aside class="ws-panel"><h2 id="ws-pvtitle"></h2><div class="ws-sub" id="ws-pvsub"></div><div class="ws-thumbs" id="ws-thumbs"></div></aside></div>' +
      '<div class="ws-bar"><button class="ws-side" id="ws-back" data-act="back"><span class="g">&#8249;</span>Back</button><button class="ws-compare" id="ws-compare" data-act="compare">COMPARE</button><button class="ws-side" id="ws-more" data-act="more"><span class="g">&#8942;</span>More</button><div class="ws-menu" id="ws-menu" hidden></div></div>' +
      '<div id="ws-layer"></div>' +
      '<input type="file" id="ws-dirinput" class="ws-hidden" webkitdirectory multiple><input type="file" id="ws-jsoninput" class="ws-hidden" accept=".bookcompare,.json,application/json">';
    document.body.appendChild(root);
    root.addEventListener('click', onClick);
    root.addEventListener('dblclick', onDblClick);
    document.addEventListener('keydown', function (e) { if (root && !root.hidden) onKey(e); });
    root.addEventListener('dragstart', onDragStart);
    root.addEventListener('dragover', onDragOver);
    root.addEventListener('drop', onDrop);
    root.addEventListener('dragend', function () { drag = null; hdrag = null; clearDrop(); });
    root.addEventListener('pointerdown', onPointerDown);
    root.addEventListener('pointermove', onPointerMove);
    root.addEventListener('pointerup', onPointerUp);
    root.addEventListener('pointercancel', onPointerUp);
    $('#ws-jsoninput').onchange = function () {
      var f = this.files && this.files[0]; if (!f) return;
      mayReplace().then(function (ok) { if (ok) return f.text().then(function (t) { adopt(JSON.parse(t), null); }); }).catch(function () { toast('That file could not be read as a project.'); });
    };
    window.addEventListener('resize', function () { if (root && !root.hidden) renderRows(); });
    window.addEventListener('beforeunload', function (e) { if (S && S.copies.length && dirty) { e.preventDefault(); e.returnValue = ''; } });
    setTimeout(function () { checkForUpdate().catch(function () { }); }, 2500);
  }
  function show() {
    if (!S) S = blank();
    if (!root) build();
    root.hidden = false;
    renderAll();
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
    projectInfo: function () { return { name: proj.name, file: proj.target ? targetFile(proj.target) : '', state: proj.state, legacy: !!proj.legacy, copies: S ? S.copies.length : 0 }; },
    tab: tabApi
  };
  // desktop program: a project file that was double-clicked opens at once
  helperReady.then(function (h) {
    if (!h) return;
    var go = function () { openPending().catch(function () { }); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else setTimeout(go, 0);
  });
})();
