/* Book Compare - whole-book workspace.

   A full-screen layer on top of the app. Columns = copies, rows = page positions. Each copy is a folder of scans on your
   disk. The scans stay where they are: this code only READS them (it never writes, renames or deletes anything in a scan folder).
   The project (which file sits in which row, row names, ...) is saved as one small file in a SEPARATE project folder.

   Scan folders are remembered as "roots": a folder you pick once (for example the folder that holds all copies of a book).
   A copy points into a root. After a project is reopened the browser only has to be asked about the roots (one click),
   not about every single copy.

   Pages are placed in file-name order and then corrected by hand (automatic page matching is a later step).
   A chosen pair of pages is handed to the existing two-image screen; "Back" there returns to this layer.

   Browsers: Edge/Chrome use the File System Access API (folder picker, remembered folders, automatic saving).
   Other browsers fall back to a plain folder upload (kept in memory only) and a downloaded project file. */
(function () {
  'use strict';

  var HAS_FSA = typeof window.showDirectoryPicker === 'function';
  var IMG_RE = /\.(jpe?g|png)$/i;
  var OTHER_IMG_RE = /\.(tiff?|webp|bmp|gif)$/i;
  var PROJECT_FILE = 'book-compare-project.json';
  var ROW_H = 40, COL_W = 172, LBL_W = 96, HEAD_H = 74, OVERSCAN = 4;

  var root = null;
  var S = null;                      // project state
  var REG = {};                      // every copy object of this session by id (so undo can bring a removed copy back)
  var hist = { undo: [], redo: [] };
  var proj = { handle: null, state: 'none', name: '', err: '', timer: 0, saving: false, again: false };
  var dirty = false;                 // changes not yet written to a project folder / file
  var lastProject = null;            // remembered project folder (Edge/Chrome)
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

  /* ---------------------------------------------------------------- state */
  function blank() {
    return { projectId: uid(), roots: [], copies: [], labels: {}, ns: 0, skip: {}, folio: false, nextCopy: 1, sel: { ci: null, row: 0 }, pair: [null, null] };
  }
  function rows() { var m = 0; S.copies.forEach(function (c) { if (c.cells.length > m) m = c.cells.length; }); return m; }
  function trim(c) { while (c.cells.length && c.cells[c.cells.length - 1] === null) c.cells.pop(); }
  function copyById(id) { for (var i = 0; i < S.copies.length; i++) if (S.copies[i].id === id) return S.copies[i]; return null; }
  function rowLabel(i) {
    if (S.labels[i] != null) return S.labels[i];
    var j = i - S.ns;
    if (j < 0) return 'Front ' + (i + 1);
    if (S.folio) return (Math.floor(j / 2) + 1) + (j % 2 === 0 ? 'r' : 'v');
    return 'Page ' + (j + 1);
  }
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
    return JSON.stringify({ c: S.copies.map(function (c) { return { id: c.id, name: c.name, cells: c.cells }; }), l: S.labels, ns: S.ns, f: S.folio, sk: S.skip, s: S.sel, p: S.pair });
  }
  function restore(str) {
    var o = JSON.parse(str);
    S.copies = o.c.map(function (r) { var c = REG[r.id]; c.name = r.name; c.cells = r.cells; return c; });
    S.labels = o.l; S.ns = o.ns; S.folio = !!o.f; S.skip = o.sk; S.sel = o.s; S.pair = o.p;
    if (S.sel.ci != null && !S.copies[S.sel.ci]) S.sel.ci = S.copies.length ? 0 : null;
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
  async function sameOrNested(a, b) {
    // true if folder a is the same as, inside, or contains folder b
    if (await a.isSameEntry(b)) return true;
    if (await a.resolve(b)) return true;
    if (await b.resolve(a)) return true;
    return false;
  }
  async function checkNotProjectFolder(dir) {
    if (proj.handle && await sameOrNested(dir, proj.handle)) throw refusal('That folder is (or is inside, or contains) your project folder. Scans and project must be in different folders.');
  }
  async function checkNotScanFolder(h) {
    for (var i = 0; i < S.roots.length; i++) {
      var r = S.roots[i]; if (!r.handle) continue;
      if (await sameOrNested(h, r.handle)) throw refusal('That folder is (or is inside, or contains) the scan folder “' + r.name + '”. The project must be saved in a separate folder, so that your scan folders are never touched.');
    }
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
    idbPut('handles', S.projectId + '/root/' + nr.id, h);
    return { root: nr, path: '' };
  }
  function repoint(from, to, pre) {
    Object.keys(REG).forEach(function (id) {
      (REG[id].locs || []).forEach(function (l) { if (l.root === from.id) { l.root = to.id; l.path = l.path ? (pre ? pre + '/' + l.path : l.path) : pre; } });
    });
  }
  // result: { root, path, name, groups, ignored }
  async function pickScanFolder() {
    if (!HAS_FSA) {
      var f = await pickFolderFallback(); if (!f) return null;
      var r = newRoot(f.name); r.files = f.files;
      var g0 = await scanLoc(r, '');
      return { root: r, path: '', name: f.name, groups: g0.groups, ignored: g0.ignored };
    }
    var dir = await window.showDirectoryPicker({ id: 'book-scans', mode: 'read' });
    await checkNotProjectFolder(dir);
    var loc = await rootFor(dir, true);
    var g = await scanLoc(loc.root, loc.path);
    return { root: loc.root, path: loc.path, name: dir.name, groups: g.groups, ignored: g.ignored };
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

  /* ---------------------------------------------------------------- thumbnails (small copies made in the browser; the scans are not changed) */
  var thumbMem = new Map(), thumbQueue = [], thumbActive = 0, THUMB_W = 260;
  function thumbPromise(copy, key) {
    var mk = copy.id + '|' + key;
    if (thumbMem.has(mk)) return thumbMem.get(mk);
    var p = new Promise(function (resolve) { thumbQueue.push({ copy: copy, key: key, resolve: resolve }); pumpThumbs(); });
    thumbMem.set(mk, p);
    if (thumbMem.size > 700) { var first = thumbMem.keys().next().value; var old = thumbMem.get(first); thumbMem.delete(first); old.then(function (r) { if (r && r.url) URL.revokeObjectURL(r.url); }); }
    return p;
  }
  function pumpThumbs() {
    while (thumbActive < 3 && thumbQueue.length) {
      var job = thumbQueue.pop();                      // newest request first: what you look at now loads first
      thumbActive++;
      makeThumb(job.copy, job.key).then(job.resolve, function (e) { job.resolve({ err: e && e.name === 'Lost' ? 'lost' : 'missing', msg: niceError(e) }); }).then(function () { thumbActive--; pumpThumbs(); });
    }
  }
  async function makeThumb(copy, key) {
    var file = await getScan(copy, key);
    var ck = copy.folder + '|' + key + '|' + file.size + '|' + file.lastModified;
    var blob = await idbGet('thumbs', ck);
    if (!blob) {
      blob = await decodeToBlob(file);
      if (blob) idbPut('thumbs', ck, blob);
    }
    if (!blob) return { err: 'decode', msg: 'This file could not be shown as a picture.' };
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
  function serialize() {
    var used = {};
    S.copies.forEach(function (c) { (c.locs || []).forEach(function (l) { used[l.root] = true; }); });
    return {
      format: 'book-compare-project', version: 2, projectId: S.projectId, savedAt: new Date().toISOString(),
      nextCopy: S.nextCopy, ns: S.ns, folio: S.folio, labels: S.labels, skip: S.skip, pair: S.pair, sel: S.sel,
      roots: S.roots.filter(function (r) { return used[r.id]; }).map(function (r) { return { id: r.id, name: r.name }; }),
      copies: S.copies.map(function (c) { return { id: c.id, name: c.name, folder: c.folder, locs: c.locs, keys: c.keys, cells: c.cells }; })
    };
  }
  function touch() { dirty = true; if (proj.handle) { proj.state = 'dirty'; clearTimeout(proj.timer); proj.timer = setTimeout(saveNow, 700); } renderSave(); }
  async function saveNow() {
    if (!proj.handle) return;
    clearTimeout(proj.timer);
    if (proj.saving) { proj.again = true; return; }
    proj.saving = true; proj.state = 'saving'; renderSave();
    try {
      var fh = await proj.handle.getFileHandle(PROJECT_FILE, { create: true });      // the ONLY place that writes: the project folder
      var w = await fh.createWritable();
      await w.write(JSON.stringify(serialize(), null, 1));
      await w.close();
      proj.state = 'saved'; dirty = false;
    } catch (e) { proj.state = 'error'; proj.err = niceError(e); }
    proj.saving = false;
    if (proj.again) { proj.again = false; proj.timer = setTimeout(saveNow, 50); }
    renderSave();
  }
  function renderSave() {
    if (!root) return;
    var b = $('#ws-save'), t = '', cls = 'ws-save';
    if (!HAS_FSA) { t = dirty ? 'Not saved · save project file' : 'Project file saved'; cls += dirty ? ' warn' : ' ok'; }
    else if (!proj.handle) { t = S.copies.length ? 'Not saved yet · choose a project folder' : 'No project yet'; cls += S.copies.length ? ' warn' : ''; }
    else if (proj.state === 'saving' || proj.state === 'dirty') { t = 'Saving …'; }
    else if (proj.state === 'error') { t = 'Could not save · ' + proj.err; cls += ' bad'; }
    else { t = '✓ Saved in folder “' + proj.name + '”'; cls += ' ok'; }
    b.className = cls; b.textContent = t; b.title = proj.handle ? 'Project folder: ' + proj.name + '. Changes are saved automatically.' : 'Choose a folder (not one of your scan folders) where the project is saved.';
  }
  async function chooseProjectFolder() {
    if (!HAS_FSA) { downloadProject(); return; }
    var h;
    try { h = await window.showDirectoryPicker({ id: 'book-project', mode: 'readwrite' }); } catch (e) { if (e && e.name === 'AbortError') return; return toast(niceError(e)); }
    try { await checkNotScanFolder(h); } catch (e) { return toast(niceError(e)); }
    var exists = false;
    try { await h.getFileHandle(PROJECT_FILE); exists = true; } catch (e) { exists = false; }
    if (exists && !(await confirmDialog('This folder already holds a project', 'Replace the project in the folder “' + esc(h.name) + '” with the one you are working on now?', 'Replace'))) return;
    proj.handle = h; proj.name = h.name;
    await rememberProject();
    await saveNow();
    toast('Project saved in “' + h.name + '”. From now on changes are saved automatically.');
  }
  function downloadProject() {
    var blob = new Blob([JSON.stringify(serialize(), null, 1)], { type: 'application/json' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = PROJECT_FILE;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    dirty = false; renderSave(); toast('Project file downloaded. Keep it in a folder of its own.');
  }
  async function rememberProject() {
    if (!proj.handle) return;
    lastProject = { handle: proj.handle, name: proj.name, projectId: S.projectId };
    await idbPut('meta', 'lastProject', lastProject);
  }
  async function readProjectFolder(h) {
    var fh;
    try { fh = await h.getFileHandle(PROJECT_FILE); } catch (e) { toast('There is no Book Compare project in the folder “' + h.name + '”.'); return false; }
    var json;
    try { json = JSON.parse(await (await fh.getFile()).text()); } catch (e) { toast('The project file in that folder could not be read.'); return false; }
    return adopt(json, h);
  }
  async function openProject() {
    if (!HAS_FSA) { $('#ws-jsoninput').value = ''; $('#ws-jsoninput').click(); return; }
    var h;
    try { h = await window.showDirectoryPicker({ id: 'book-project', mode: 'readwrite' }); } catch (e) { if (e && e.name === 'AbortError') return; return toast(niceError(e)); }
    await readProjectFolder(h);
  }
  async function continueLast() {
    if (!lastProject) return;
    var h = lastProject.handle;
    try {
      var perm = await h.queryPermission({ mode: 'readwrite' });
      if (perm !== 'granted') perm = await h.requestPermission({ mode: 'readwrite' });
      if (perm !== 'granted') return toast('The browser did not give access to the project folder.');
    } catch (e) { return toast(niceError(e)); }
    await readProjectFolder(h);
  }
  async function adopt(json, handle) {
    if (!json || json.format !== 'book-compare-project' || !Array.isArray(json.copies)) { toast('This is not a Book Compare project file.'); return false; }
    S = blank(); REG = {};
    S.projectId = json.projectId || uid();
    S.ns = json.ns || 0; S.folio = !!json.folio; S.labels = json.labels || {}; S.skip = json.skip || {};
    S.pair = json.pair || [null, null]; S.sel = json.sel || { ci: null, row: 0 };
    // (a "set aside" tray from older versions is dropped: those files can be added again with "Add files to this copy")
    (json.roots || []).forEach(function (r) { S.roots.push({ id: r.id, name: r.name, handle: null, files: null, ok: false }); });
    var maxId = 0, legacy = [];
    for (var i = 0; i < json.copies.length; i++) {
      var r = json.copies[i], c = { id: r.id, name: r.name, folder: r.folder, keys: r.keys || [], cells: r.cells || [], locs: (r.locs || []).map(function (l) { return { root: l.root, path: l.path || '' }; }) };
      REG[c.id] = c; S.copies.push(c); if (c.id > maxId) maxId = c.id;
      if (!c.locs.length) legacy.push(c);
    }
    S.nextCopy = Math.max(json.nextCopy || 1, maxId + 1);
    if (S.sel.ci != null && !S.copies[S.sel.ci]) S.sel.ci = S.copies.length ? 0 : null;
    hist = { undo: [], redo: [] };
    thumbMem.clear();
    proj.handle = handle || null; proj.name = handle ? handle.name : ''; proj.state = handle ? 'saved' : 'none'; dirty = false;
    // folders this browser remembers for the project
    for (var k = 0; k < S.roots.length; k++) {
      var rt = S.roots[k], hh = await idbGet('handles', S.projectId + '/root/' + rt.id);
      if (hh) { rt.handle = hh; await refreshRootState(rt); }
    }
    // projects of the first version stored one folder per copy: those become roots
    for (var q = 0; q < legacy.length; q++) {
      var lc = legacy[q], lh = await idbGet('handles', S.projectId + '/' + lc.id);
      if (lh) { var loc = await rootFor(lh, false); await refreshRootState(loc.root); lc.locs = [{ root: loc.root.id, path: loc.path }]; }
      else { var pr = newRoot(lc.folder || lc.name); lc.locs = [{ root: pr.id, path: '' }]; }
    }
    ensurePair();
    if (handle) {
      // safety: a project folder that is (or is inside, or contains) a scan folder must never be written to
      var unsafe = false;
      try { for (var m = 0; m < S.roots.length; m++) if (S.roots[m].handle && await sameOrNested(handle, S.roots[m].handle)) { unsafe = true; break; } }
      catch (e) { unsafe = true; }
      if (unsafe) { proj.handle = null; proj.state = 'none'; proj.name = ''; }
    }
    if (proj.handle) await rememberProject();
    renderAll(); renderSave();
    if (handle && !proj.handle) toast('This project folder is in, or contains, a scan folder, so automatic saving is switched off. Save the project in a separate folder (More → Save project).');
    else toast('Project opened: ' + S.copies.length + ' cop' + (S.copies.length === 1 ? 'y' : 'ies') + (S.copies.some(copyLost) ? '. The scans need your permission once.' : '.'));
    if (S.copies.some(copyLost)) allowAccess(true);       // works silently where the browser still honours the click that opened the project
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
    try { dir = await window.showDirectoryPicker({ id: 'book-scans', mode: 'read' }); } catch (e) { if (e && e.name === 'AbortError') return; return toast(niceError(e)); }
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
    var where = s ? '<b>' + esc(s.c.name) + '</b> · ' + esc(rowLabel(s.row)) : 'Select a cell';
    tb.innerHTML = '<div class="sel">' + where + '</div>' +
      '<button class="ws-tb" data-act="addfiles"' + (s ? '' : ' disabled') + ' title="Add pictures to this copy: ones you deleted, or pages that are stored in another folder">Add files to this copy …</button>' +
      '<span class="ws-vsep"></span>' +
      '<span class="ws-numwrap">Pages <input type="number" id="gapN" min="1" max="999" value="' + esc(n) + '" aria-label="Number of pages"></span>' +
      '<button class="ws-tb" data-act="gap"' + (s ? '' : ' disabled') + ' title="Pushes this cell and everything below it down">Insert gap here</button>' +
      '<button class="ws-tb" data-act="closegap"' + (s && !s.key ? '' : ' disabled') + ' title="Pulls everything below up again">Close gap</button>' +
      '<button class="ws-tb" data-act="del"' + (s && s.key ? '' : ' disabled') + ' title="Removes this file from the workspace (for covers, flyleaves, duplicates). The scan file on your disk is not touched. Undo brings it back.">Delete file</button>' +
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
    if (allow.length) h += '<span>Book Compare needs your permission to read the scans of <b>' + nameList(lost) + '</b> again. The browser asks once after a project is reopened. One click is enough for all copies in the same folder.</span><button class="ws-tb primary" data-act="allow">Allow access to scans</button>';
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
    var w = LBL_W + COL_W * (S.copies.length + 1);
    var h = '<div class="ws-vp" id="ws-vp" tabindex="0" aria-label="Page grid. Arrow keys move the selection."><div class="ws-inner" id="ws-inner" style="width:' + w + 'px;height:' + (HEAD_H + rows() * ROW_H) + 'px">';
    h += '<div class="ws-hrow" style="width:' + w + 'px"><div class="ws-corner">Page</div>';
    S.copies.forEach(function (c, i) {
      var cnt = 0; c.cells.forEach(function (x) { if (x) cnt++; });
      var k = c.id === S.pair[0] ? ' k1' : c.id === S.pair[1] ? ' k2' : '', lost = copyLost(c);
      h += '<div class="ws-hcell' + k + '"><div class="ws-hname" data-act="rename" data-c="' + i + '" title="Click to rename">' + esc(c.name) + '</div><div class="ws-hmeta' + (lost ? ' lost' : '') + '">' + (lost ? 'scans not reachable' : cnt + ' file' + (cnt === 1 ? '' : 's') + ' in grid') + '</div><button class="x" data-act="remove" data-c="' + i + '" aria-label="Remove copy ' + esc(c.name) + '" title="Remove this copy from the project (your scan files are not touched)">&times;</button></div>';
    });
    h += '<div class="ws-addcell"><button class="ws-addbtn" data-act="add"><span class="plus">+</span><small>Add new copy</small></button></div></div><div id="ws-rowshost"></div></div></div>';
    gb.innerHTML = h;
    $('#ws-vp').addEventListener('scroll', renderRows);
  }
  function renderRows() {
    var vp = $('#ws-vp'), host = $('#ws-rowshost'); if (!vp || !host) return;
    var N = rows(), top = vp.scrollTop, vh = vp.clientHeight;
    var a = Math.max(0, Math.floor((top - HEAD_H) / ROW_H) - OVERSCAN), b = Math.min(N - 1, Math.ceil((top + vh) / ROW_H) + OVERSCAN), h = '';
    var lostC = S.copies.map(copyLost);
    for (var i = a; i <= b; i++) {
      var n = 0, cells = '';
      S.copies.forEach(function (c, ci) {
        var key = c.cells[i] || null, sel = (S.sel.ci === ci && S.sel.row === i) ? ' sel' : '';
        var pm = c.id === S.pair[0] ? '<b class="pm m1">1</b>' : c.id === S.pair[1] ? '<b class="pm m2">2</b>' : '';
        if (key) { n++; cells += '<div class="ws-cell filled' + (lostC[ci] ? ' lostc' : '') + sel + '" draggable="true" data-c="' + ci + '" data-r="' + i + '"><i class="ico"></i><span class="fn" title="' + esc(key) + '">' + esc(baseName(key)) + '</span>' + pm + '</div>'; }
        else cells += '<div class="ws-cell empty' + sel + '" data-c="' + ci + '" data-r="' + i + '"><span class="gap">no page</span></div>';
      });
      var sk = !!S.skip[i], small = sk ? 'not compared' : (i === S.ns && S.ns > 0 ? 'starts here' : n + ' of ' + S.copies.length + ' copies');
      h += '<div class="ws-row' + (S.sel.row === i ? ' selrow' : '') + (sk ? ' skipped' : '') + (i === S.ns && S.ns > 0 ? ' numstart' : '') + '" style="top:' + (HEAD_H + i * ROW_H) + 'px" data-r="' + i + '"><div class="ws-lbl" data-act="lbl" data-r="' + i + '"><b>' + esc(rowLabel(i)) + '</b><small>' + small + '</small></div>' + cells + '</div>';
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
          else pg.innerHTML = '<span class="ws-nopv">' + (r && r.err === 'lost' ? 'Scans not reachable yet' : esc((r && r.msg) || 'Not available')) + '</span>';
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
  function selectCell(ci, row) { S.sel = { ci: ci, row: row }; renderToolbar(); renderRows(); renderPreview(); renderBar(); keepFocus(); }
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
      '<li>On the right you see the page of every copy in the selected row. Mark two of them with <b>1</b> and <b>2</b>, then press <b>COMPARE</b>: they open in the two-image screen. <b>Back</b> there brings you here again.</li>' +
      '<li>When you reopen a saved project the browser asks once for permission to read your scans again. Click <b>Allow access to scans</b>; you do not have to pick the folders again.</li>' +
      '<li>Ctrl+Z undoes the last change. Arrow keys move the selection.</li></ul>' +
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
    return '<div class="row2"><select id="' + p + '-known" aria-label="Folders used so far"></select><button class="ws-tb" id="' + p + '-folder">Choose another folder …</button></div>' +
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
      '<label>Name of the copy<input type="text" id="ac-name" autocomplete="off" placeholder="Austria, Austrian National Library"></label>' +
      srcBlock('ac') +
      '<div id="ac-groups"></div>' +
      '<label>Place the first file at row<input type="number" id="ac-start" min="1" value="1"></label>' +
      '<p class="note">Files are placed in name order, one per row. You fix the placement afterwards in the grid. Book Compare only reads the scan folder; it never changes anything in it. If one folder holds the scans of several copies, choose it once: for the next copy it is in the list of folders used so far.</p>' +
      '<div class="err" id="ac-err"></div>' +
      '<div class="acts"><button class="ws-tb" data-close>Cancel</button><button class="ws-tb primary" id="ac-ok">Add copy</button></div>');
    function showPicked(pk) {
      picked = pk;
      var info = sc.querySelector('#ac-info'), gr = sc.querySelector('#ac-groups');
      if (!pk.groups.length) { info.textContent = 'No JPG or PNG files found in “' + pk.name + '” or in the folders directly inside it.'; gr.innerHTML = ''; return; }
      var total = pictureCount(pk.groups), used = usedPictures(pk.root.id);
      info.textContent = '“' + pk.name + '”: ' + total + ' picture' + (total === 1 ? '' : 's') + ignoredNote(pk.ignored);
      if (pk.groups.length === 1) pk.groups[0].on = true;
      var h = '<div class="note">' + (pk.groups.length === 1 ? 'Folder used:' : 'The pictures are in several folders. Tick the ones that belong to this copy:') + '</div><div class="groups">';
      pk.groups.forEach(function (g, i) {
        var by = used[joinPath(pk.path, g.keys[0])];
        h += '<label><input type="checkbox" data-g="' + i + '"' + (g.on ? ' checked' : '') + '>' + (g.path ? esc(g.path) : 'directly in “' + esc(pk.name) + '”') + ' <span class="note">· ' + g.keys.length + (by ? ' · already used by ' + esc(by) : '') + '</span></label>';
      });
      gr.innerHTML = h + '</div>';
      Array.prototype.forEach.call(gr.querySelectorAll('input[data-g]'), function (cbx) { cbx.onchange = function () { pk.groups[+cbx.dataset.g].on = cbx.checked; }; });
    }
    wireSrc(sc, 'ac', extra, showPicked);
    function finish() {
      var name = sc.querySelector('#ac-name').value.trim(), err = sc.querySelector('#ac-err');
      if (!name) { err.textContent = 'Give the copy a name, for example “Austria, Austrian National Library”.'; sc.querySelector('#ac-name').focus(); return; }
      if (S.copies.some(function (c) { return c.name.toLowerCase() === name.toLowerCase(); })) { err.textContent = 'A copy with this name already exists.'; return; }
      if (!picked) { err.textContent = 'Choose the scan folder of this copy first.'; return; }
      var keys = []; picked.groups.forEach(function (g) { if (g.on) keys = keys.concat(g.keys); });
      if (!keys.length) { err.textContent = picked.groups.length ? 'Tick at least one folder.' : 'That folder has no JPG or PNG files.'; return; }
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
      groups.forEach(function (g, gi) { if (groups.length === 1) fillGroup(gi); });
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
      '<button data-m="save"><span class="tick"></span>' + (HAS_FSA ? (proj.handle ? 'Choose another project folder …' : 'Save project in a folder …') : 'Download project file') + '</button>' +
      '<button data-m="open"><span class="tick"></span>Open saved project …</button>' +
      '<button data-m="reconnect"' + (lost ? '' : ' disabled') + '><span class="tick"></span>Choose scan folder again …</button><hr>' +
      '<button data-m="folio"><span class="tick"></span>' + (S.folio ? 'Switch to pagination (Page 1, Page 2 …)' : 'Switch to foliation (1r, 1v, 2r …)') + '</button>' +
      '<button data-m="help"><span class="tick"></span>How this screen works</button><hr>' +
      '<button data-m="new"><span class="tick"></span>Start a new empty project</button>';
  }

  /* ---------------------------------------------------------------- hand a pair of pages to the two-image screen */
  async function compareNow() {
    var a = copyById(S.pair[0]), b = copyById(S.pair[1]), r = S.sel.row;
    if (!a || !b) return toast('First mark two pages with “1” and “2” in the preview on the right.');
    if (!a.cells[r] || !b.cells[r]) return toast('In this row ' + (!a.cells[r] ? a.name : b.name) + ' has no page. Pick another row, or other copies with “1” and “2”.');
    var f1, f2;
    try { f1 = await getScan(a, a.cells[r]); f2 = await getScan(b, b.cells[r]); }
    catch (e) { return toast((e && e.name === 'Lost' ? e.message + ' Click “Allow access to scans” at the top first.' : 'Could not open the scan: ' + niceError(e))); }
    var urls = [URL.createObjectURL(f1), URL.createObjectURL(f2)];
    hide();
    if (cb.compare) cb.compare({ urls: urls, names: [f1.name, f2.name] });
  }

  /* ---------------------------------------------------------------- events */
  function startRename(el, getVal, setVal) {
    var inp = document.createElement('input'); inp.value = getVal(); el.replaceWith(inp); inp.focus(); inp.select();
    var done = false;
    function fin(save) { if (done) return; done = true; var v = inp.value.trim(); if (save && v && v !== getVal()) { commit(); setVal(v); changed(); } else renderAll(); }
    inp.addEventListener('keydown', function (ev) { ev.stopPropagation(); if (ev.key === 'Enter') fin(true); if (ev.key === 'Escape') fin(false); });
    inp.addEventListener('blur', function () { fin(true); });
  }
  function deleteSelected() {
    var s = selected();
    if (!s || !s.key) return;
    commit(); deleteCell(s.c, s.row); trim(s.c); changed();
    toast('Deleted from the workspace. The scan file on your disk is untouched.', true);
  }
  function onClick(e) {
    var t = e.target, el;
    if (t.closest('[data-close]')) return closeModal();
    if (!t.closest('#ws-menu') && !t.closest('#ws-more')) $('#ws-menu').hidden = true;
    if ((el = t.closest('[data-m]'))) {
      var m = el.dataset.m; $('#ws-menu').hidden = true;
      if (m === 'save') chooseProjectFolder();
      else if (m === 'open') openProject();
      else if (m === 'reconnect') reconnectScans();
      else if (m === 'folio') { commit(); S.folio = !S.folio; changed(); toast(S.folio ? 'Rows are numbered as folios now (1r, 1v, 2r …).' : 'Rows are numbered as pages now (Page 1, Page 2 …).', true); }
      else if (m === 'help') helpDialog();
      else if (m === 'new') newProject();
      return;
    }
    var cell = t.closest('.ws-cell');
    if (cell && !t.closest('[data-act]')) { selectCell(+cell.dataset.c, +cell.dataset.r); var v = $('#ws-vp'); if (v) v.focus({ preventScroll: true }); return; }
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
      case 'savechip': return proj.handle ? (proj.state === 'error' ? saveNow() : toast('Project folder: “' + proj.name + '”. Changes are saved automatically.')) : chooseProjectFolder();
      case 'openproj': return openProject();
      case 'continue': return continueLast();
      case 'allow': return allowAccess(false);
      case 'reconnect': return reconnectScans();
      case 'swap': S.pair = [S.pair[1], S.pair[0]]; touch(); renderAll(); return;
      case 'pick': var cp = S.copies[+a.dataset.ci], slot = +a.dataset.slot; if (cp) { var o = 1 - slot; if (S.pair[o] === cp.id) S.pair[o] = S.pair[slot]; S.pair[slot] = cp.id; touch(); renderAll(); } return;
      case 'selcell': selectCell(+a.dataset.ci, S.sel.row); return;
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
      case 'lbl': var r = +a.dataset.r; if (S.sel.row === r) return; S.sel.row = r; if (S.sel.ci == null && S.copies.length) S.sel.ci = 0; renderToolbar(); renderRows(); renderPreview(); renderBar(); return;
    }
  }
  function onDblClick(e) {
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
    if (e.key === 'ArrowDown') s.row = Math.min(N - 1, s.row + 1);
    else if (e.key === 'ArrowUp') s.row = Math.max(0, s.row - 1);
    else if (e.key === 'ArrowRight') s.ci = Math.min(nc - 1, s.ci + 1);
    else if (e.key === 'ArrowLeft') s.ci = Math.max(0, s.ci - 1);
    else if (e.key === 'Delete') { deleteSelected(); return; }
    else if (e.key === '1' || e.key === '2') { var cp = S.copies[s.ci], slot = +e.key - 1, o = 1 - slot; if (cp) { if (S.pair[o] === cp.id) S.pair[o] = S.pair[slot]; S.pair[slot] = cp.id; touch(); renderAll(); } e.preventDefault(); return; }
    else return;
    e.preventDefault(); renderToolbar(); renderRows(); renderPreview(); renderBar(); ensureVisible(s.row);
  }
  var drag = null;
  function onDragStart(e) {
    var c = e.target.closest && e.target.closest('.ws-cell.filled');
    if (c) { drag = { ci: +c.dataset.c, row: +c.dataset.r }; e.dataTransfer.setData('text/plain', 'x'); e.dataTransfer.effectAllowed = 'move'; }
  }
  function clearDrop() { Array.prototype.forEach.call(root.querySelectorAll('.ws-cell.dropok'), function (x) { x.classList.remove('dropok'); }); }
  function onDragOver(e) {
    var c = e.target.closest && e.target.closest('.ws-cell'); clearDrop();
    if (!c || !drag) return;
    if (+c.dataset.c === drag.ci) { e.preventDefault(); c.classList.add('dropok'); }
  }
  function onDrop(e) {
    var c = e.target.closest && e.target.closest('.ws-cell'); clearDrop();
    if (!c || !drag) return;
    e.preventDefault();
    var ci = +c.dataset.c, row = +c.dataset.r, cp = S.copies[ci];
    if (ci !== drag.ci || row === drag.row) { drag = null; return; }
    commit(); var a = cp.cells[drag.row], b = cp.cells[row] || null; while (cp.cells.length <= row) cp.cells.push(null); cp.cells[row] = a; cp.cells[drag.row] = b; trim(cp);
    S.sel = { ci: ci, row: row }; drag = null; changed();
  }
  async function newProject() {
    if (S.copies.length && dirty && !(await confirmDialog('Start a new project?', 'The current project has changes that are not saved. They will be lost.', 'Start new project'))) return;
    S = blank(); REG = {}; hist = { undo: [], redo: [] }; thumbMem.clear(); proj.handle = null; proj.state = 'none'; proj.name = ''; dirty = false;
    renderAll();
  }

  /* ---------------------------------------------------------------- showing and hiding the layer */
  function build() {
    root = document.createElement('div'); root.className = 'ws'; root.id = 'ws'; root.hidden = true;
    root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', 'Copies and pages'); root.tabIndex = -1;
    root.innerHTML =
      '<div class="ws-head"><div class="ws-headtext"><h1>Copies and pages</h1><p>Each column is one copy, each row one page position. Check that every row shows the same page in all copies, then mark two pages and compare them.</p></div>' +
      '<button class="ws-save" id="ws-save" data-act="savechip"></button><button class="ws-icon" data-act="help" aria-label="Help">?</button></div>' +
      '<div class="ws-banner" id="ws-banner" hidden></div>' +
      '<div class="ws-stage"><div class="ws-main"><div class="ws-toolbar" id="ws-toolbar"></div><div class="ws-summary" id="ws-summary"></div><div class="ws-gridbox" id="ws-gridbox"></div></div>' +
      '<aside class="ws-panel"><h2 id="ws-pvtitle"></h2><div class="ws-sub" id="ws-pvsub"></div><div class="ws-thumbs" id="ws-thumbs"></div></aside></div>' +
      '<div class="ws-bar"><button class="ws-side" id="ws-back" data-act="back"><span class="g">&#8249;</span>Back</button><button class="ws-compare" id="ws-compare" data-act="compare">COMPARE</button><button class="ws-side" id="ws-more" data-act="more"><span class="g">&#8942;</span>More</button><div class="ws-menu" id="ws-menu" hidden></div></div>' +
      '<div id="ws-layer"></div>' +
      '<input type="file" id="ws-dirinput" class="ws-hidden" webkitdirectory multiple><input type="file" id="ws-jsoninput" class="ws-hidden" accept=".json,application/json">';
    document.body.appendChild(root);
    root.addEventListener('click', onClick);
    root.addEventListener('dblclick', onDblClick);
    document.addEventListener('keydown', function (e) { if (root && !root.hidden) onKey(e); });
    root.addEventListener('dragstart', onDragStart);
    root.addEventListener('dragover', onDragOver);
    root.addEventListener('drop', onDrop);
    root.addEventListener('dragend', function () { drag = null; clearDrop(); });
    $('#ws-jsoninput').onchange = function () {
      var f = this.files && this.files[0]; if (!f) return;
      f.text().then(function (t) { adopt(JSON.parse(t), null); }).catch(function () { toast('That file could not be read as a project.'); });
    };
    window.addEventListener('resize', function () { if (root && !root.hidden) renderRows(); });
    window.addEventListener('beforeunload', function (e) { if (S && S.copies.length && dirty) { e.preventDefault(); e.returnValue = ''; } });
  }
  function show() {
    if (!S) S = blank();
    if (!root) build();
    root.hidden = false;
    idbGet('meta', 'lastProject').then(function (lp) { if (lp && lp.handle && !S.copies.length) { lastProject = lp; renderAll(); } });
    renderAll();
    var vp = $('#ws-vp'); (vp || root).focus();
  }
  function hide() { if (root) { root.hidden = true; $('#ws-menu').hidden = true; closeModal(); } }
  function leave() { hide(); if (cb.leave) cb.leave(); }

  window.BookWorkspace = {
    open: show,
    show: show,
    hide: hide,
    onCompare: function (fn) { cb.compare = fn; },
    onLeave: function (fn) { cb.leave = fn; }
  };
})();
