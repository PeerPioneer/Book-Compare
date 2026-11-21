/* Book Compare: stored alignments (V10, desktop program only).
   How a page of one copy was bent onto the same page of the reference copy (only the movement, see research/js/stored_movement.js)
   is kept in the folder "<project>.bookcompare results" next to the project file, one file per pair of scans, plus index.json:
     m-<code>.bin      the packed movement (about 150-250 KB)
     index.json        for every stored pair: which two scans (copy and file), and what it is valid for
   A stored result is used only while it still fits: the same two scan files (size and date), the same tile setting (V15) and the
   same alignment engine (ENGINE below). Otherwise the page is aligned again and the result replaced. The scans are never touched.
   The website has no results folder: there nothing is stored (decided 21 Nov 2026). */
(function () {
  'use strict';
  var ENGINE = 'tiles-2026-11';        // change this when the alignment itself changes: stored results of the old one are then made again
  var INDEX = 'index.json';
  var cur = fresh();
  function fresh() { return { id: null, dir: null, idx: null, loading: null, timer: 0, writing: null, again: false, changed: false }; }
  function T() { return window.BookWorkspace && window.BookWorkspace.tab; }

  function fnv(s, seed) { var h = seed >>> 0; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return ('0000000' + h.toString(16)).slice(-8); }
  // one file per pair of scans: reference copy and file, other copy and file (the row may change when the grid is edited; this does not)
  function nameFor(p) { var s = p.c0 + '|' + p.k0 + '|' + p.c1 + '|' + p.k1; return 'm-' + fnv(s, 0x811c9dc5) + fnv(s, 0x01234567) + '.bin'; }
  function validity(p) {
    var t = p.tiles ? p.tiles.main + 'x' + p.tiles.sub : 'std';
    return [ENGINE, p.i0.size, p.i0.mtime, p.i1.size, p.i1.mtime, t].join('|');
  }
  function fileInfo(f) { return f ? { size: f.size, mtime: f.mtime != null ? f.mtime : f.lastModified } : null; }

  function dirNow() { var t = T(); return t && t.resultsDir ? t.resultsDir() : null; }
  async function index() {
    var d = dirNow(); if (!d) return null;
    var id = T().resultsId();
    if (cur.id !== id) { reset(); cur.id = id; cur.dir = d; }
    if (cur.idx) return cur.idx;
    if (cur.loading) return cur.loading;
    var mine = cur;
    mine.loading = (async function () {
      var idx = null;
      try { var fh = await d.getFileHandle(INDEX); idx = JSON.parse(await (await fh.getFile()).text()); } catch (e) { idx = null; }
      if (!idx || idx.format !== 'book-compare-results' || !idx.entries || typeof idx.entries !== 'object') idx = { format: 'book-compare-results', version: 1, entries: {} };
      mine.idx = idx; mine.loading = null;
      return idx;
    })();
    return mine.loading;
  }
  // p: { c0, k0, c1, k1, i0, i1, tiles }   (c = copy id, k = the file in that copy, i = { size, mtime } of the scan)
  async function find(p) {
    if (!p || !p.i0 || !p.i1) return null;
    var idx = await index(); if (!idx) return null;
    var n = nameFor(p), e = idx.entries[n];
    return e && e.valid === validity(p) ? { name: n, entry: e } : null;
  }
  async function has(p) { return !!(await find(p)); }
  async function read(p) {
    var hit = await find(p); if (!hit) return null;
    try { var fh = await cur.dir.getFileHandle(hit.name); return await (await fh.getFile()).arrayBuffer(); }
    catch (e) { return null; }
  }
  async function save(p, bin, summary) {
    var idx = await index(), d = cur.dir; if (!idx || !d || !bin) return false;
    var mine = cur, n = nameFor(p);
    var fh = await d.getFileHandle(n, { create: true }), w = await fh.createWritable();
    await w.write(new Blob([bin], { type: 'application/octet-stream' }));
    await w.close();
    if (mine !== cur) return false;                                        // (another project was opened meanwhile)
    idx.entries[n] = Object.assign({ valid: validity(p), c0: p.c0, k0: p.k0, c1: p.c1, k1: p.k1, at: Date.now() }, summary || {});
    mine.changed = true; clearTimeout(mine.timer); mine.timer = setTimeout(function () { writeIndex(mine); }, 2000);
    return true;
  }
  async function writeIndex(st) {
    st = st || cur;
    clearTimeout(st.timer);
    if (!st.changed || !st.idx || !st.dir) return;
    if (st.writing) { st.again = true; return st.writing; }
    st.changed = false;
    st.writing = (async function () {
      try { var fh = await st.dir.getFileHandle(INDEX, { create: true }), w = await fh.createWritable(); await w.write(JSON.stringify(st.idx)); await w.close(); }
      catch (e) { st.changed = true; }                                     // (tried again with the next change)
      st.writing = null;
      if (st.again) { st.again = false; await writeIndex(st); }
    })();
    return st.writing;
  }
  // another project (or the project saved under another name): what is still to be written goes to the old place, then start afresh
  function reset() { var old = cur; cur = fresh(); if (old.changed) writeIndex(old); }
  async function count(copyId) {
    var idx = await index(); if (!idx) return 0;
    var n = 0; Object.keys(idx.entries).forEach(function (k) { if (copyId == null || idx.entries[k].c1 === copyId) n++; }); return n;
  }

  window.BCResults = {
    ENGINE: ENGINE,
    available: function () { return !!dirNow(); },
    has: has, read: read, save: save,
    flush: function () { return writeIndex(cur); },
    reset: reset, count: count, nameFor: nameFor, fileInfo: fileInfo
  };
})();
