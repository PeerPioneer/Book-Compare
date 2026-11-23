/* Book Compare: stored alignments (V10, desktop program only).
   How a page of one copy was bent onto the same page of the reference copy (only the movement, see research/js/stored_movement.js)
   is kept in the folder "<project>.bookcompare results" next to the project file, one file per pair of scans, plus index.json:
     m-<code>.bin      the packed movement (about 150-250 KB)
     index.json        for every stored pair: which two scans (copy and file), and what it is valid for
   A stored result is used only while it still fits: the same two scan files (size and date), the same printed area of the reference scan
   (automatic or set by hand, V2b), the same tile setting (V15) and the same alignment engine (ENGINE below). Otherwise the page is aligned again and the result replaced. The scans are never touched.
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
  // A stored result fits the two scans when their size and content fingerprint are the same (item 29: not the file date, which changes
  // when the scans are copied to another computer). The fingerprint is SHA-1 of the first and last 64 KB (the same in desktop/server.js).
  function stamp(i) { return i.fp ? i.size + ':' + i.fp : i.size + '@' + i.mtime; }
  function validity(p) {
    var t = p.tiles ? p.tiles.main + 'x' + p.tiles.sub : 'std', q = p.quad ? p.quad.map(function (v) { return (+v).toFixed(4); }).join(',') : 'auto';
    return [ENGINE, stamp(p.i0), stamp(p.i1), q, t].join('|');
  }
  var FP = 65536;
  async function fileInfo(f) {
    if (!f) return null;
    if (!f.fp) {
      var n = Math.min(FP, f.size), parts = [f.slice(0, n), f.slice(Math.max(n, f.size - FP), f.size)];
      var h = new Uint8Array(await crypto.subtle.digest('SHA-1', await new Blob(parts).arrayBuffer())), x = '';
      for (var i = 0; i < 8; i++) x += ('0' + h[i].toString(16)).slice(-2);
      try { f.fp = x; } catch (e) { /* a read-only object: computed again next time */ }
      if (!f.fp) return { size: f.size, fp: x };
    }
    return { size: f.size, fp: f.fp };
  }

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
  // p: { c0, k0, c1, k1, i0, i1, tiles, quad }   (c = copy id, k = the file in that copy, i = { size, mtime } of the scan, quad = V2b shape or null)
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
    idx.entries[n] = Object.assign({ valid: validity(p), c0: p.c0, k0: p.k0, c1: p.c1, k1: p.k1, at: Date.now(), bytes: bin.byteLength || 0 }, summary || {});
    mine.changed = true; clearTimeout(mine.timer); mine.timer = setTimeout(function () { writeIndex(mine); }, 2000);
    try { document.dispatchEvent(new CustomEvent('bcresultschange')); } catch (e) { /* ignore */ }
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
  // item 28: how much is stored, and removing what is no longer needed (keep(entry) says what stays)
  async function stats() {
    var idx = await index(); if (!idx) return null;
    var n = 0, bytes = 0; Object.keys(idx.entries).forEach(function (k) { n++; bytes += idx.entries[k].bytes || 200000; });
    return { count: n, bytes: bytes, folder: cur.dir ? cur.dir.name : '' };
  }
  async function prune(keep) {
    var idx = await index(), d = cur.dir, mine = cur; if (!idx || !d) return { removed: 0, bytes: 0 };
    var gone = 0, freed = 0, names = Object.keys(idx.entries);
    for (var i = 0; i < names.length; i++) {
      var e = idx.entries[names[i]];
      if (keep(e)) continue;
      try { await d.removeEntry(names[i]); } catch (x) { continue; }
      if (mine !== cur) break;
      delete idx.entries[names[i]]; gone++; freed += e.bytes || 200000; mine.changed = true;
    }
    if (gone) await writeIndex(mine);
    return { removed: gone, bytes: freed };
  }
  function current(e) { return typeof e.valid === 'string' && e.valid.indexOf(ENGINE + '|') === 0; }
  async function count(copyId) {
    var idx = await index(); if (!idx) return 0;
    var n = 0; Object.keys(idx.entries).forEach(function (k) { if (copyId == null || idx.entries[k].c1 === copyId) n++; }); return n;
  }

  window.BCResults = {
    ENGINE: ENGINE,
    available: function () { return !!dirNow(); },
    has: has, read: read, save: save,
    flush: function () { return writeIndex(cur); },
    reset: reset, count: count, nameFor: nameFor, fileInfo: fileInfo,
    // for the grid (item 21): the stored pairs of the open project, or null while the index is not read yet (load() reads it);
    // the scans themselves are not checked here (that happens when a page is opened)
    stats: stats, prune: prune, current: current,
    storedSync: function () { var t = T(); return cur.idx && t && cur.id === t.resultsId() ? cur.idx.entries : null; },
    load: function () { return index().then(function (i) { return !!i; }, function () { return false; }); }
  };
})();
