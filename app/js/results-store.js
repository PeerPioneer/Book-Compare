/* Book Compare: stored alignments (V10).
   How a page of one copy was bent onto the same page of the reference copy (only the movement, see research/js/stored_movement.js,
   about 100-250 KB a page) is kept INSIDE the project file since 0.12.0 (owner 25 Nov 2026: one single file; app/js/project-pack.js), one
   record per pair of scans with a description of what it is valid for. Until 0.11.0 it lay in a folder "<project>.bookcompare results"
   next to the project file (desktop program only); workspace.js moves such a folder into the file when the project is opened.
   A stored result is used only while it still fits: the same two scan files (size and content fingerprint), the same printed area of the
   reference scan (automatic or set by hand, V2b), the same tile setting (V15) and the same alignment engine (ENGINE below). Otherwise the
   page is aligned again and the result replaced. The scans are never touched. Since the results are inside the project file, the website
   stores them too (whenever the project has a file). */
(function () {
  'use strict';
  var ENGINE = 'tiles-2026-11b';       // (b: B1 perspective rough step, 0.11.0) change this when the alignment itself changes: stored results of the old one are then made again
  function T() { return window.BookWorkspace && window.BookWorkspace.tab; }
  function P() { var t = T(); return t && t.pack ? t.pack() : null; }

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

  // p: { c0, k0, c1, k1, i0, i1, tiles, quad }   (c = copy id, k = the file in that copy, i = { size, fp } of the scan, quad = V2b shape or null)
  async function find(p) {
    if (!p || !p.i0 || !p.i1) return null;
    var pk = P(); if (!pk) return null;
    var n = nameFor(p), e = pk.moves[n];
    return e && e.meta && e.meta.valid === validity(p) ? { name: n, pack: pk } : null;
  }
  async function has(p) { return !!(await find(p)); }
  async function read(p) {
    var hit = await find(p); if (!hit) return null;
    try { return await hit.pack.getMove(hit.name); } catch (e) { return null; }
  }
  async function save(p, bin, summary) {
    var pk = P(); if (!pk || !bin) return false;
    var n = nameFor(p), meta = Object.assign({ valid: validity(p), c0: p.c0, k0: p.k0, c1: p.c1, k1: p.k1, at: Date.now(), bytes: bin.byteLength || 0 }, summary || {});
    await pk.putMove(n, meta, bin);
    try { document.dispatchEvent(new CustomEvent('bcresultschange')); } catch (e) { /* ignore */ }
    return true;
  }
  // item 28: how much is stored, and removing what is no longer needed (keep(entry) says what stays); the file is tidied up afterwards
  async function stats() {
    var pk = P(); if (!pk) return null;
    var st = pk.stats();
    return { count: st.count, bytes: st.bytes, size: st.size, file: T().projectFile ? T().projectFile() : '' };
  }
  async function prune(keep) {
    var pk = P(); if (!pk) return { removed: 0, bytes: 0 };
    var gone = [], freed = 0;
    Object.keys(pk.moves).forEach(function (n) { var e = pk.moves[n]; if (!keep(e.meta || {})) { gone.push(n); freed += 12 + e.len; } });
    if (!gone.length) return { removed: 0, bytes: 0 };
    await pk.drop(gone);
    try { await pk.tidy(); } catch (e) { /* tidied up another time */ }
    return { removed: gone.length, bytes: freed };
  }
  function current(e) { return !!e && typeof e.valid === 'string' && e.valid.indexOf(ENGINE + '|') === 0; }
  async function count(copyId) {
    var pk = P(); if (!pk) return 0;
    var n = 0; Object.keys(pk.moves).forEach(function (k) { var m = pk.moves[k].meta; if (copyId == null || (m && m.c1 === copyId)) n++; }); return n;
  }

  window.BCResults = {
    ENGINE: ENGINE,
    available: function () { return !!P(); },
    has: has, read: read, save: save,
    flush: function () { var pk = P(); return pk ? pk.flush() : Promise.resolve(); },
    reset: function () { }, count: count, nameFor: nameFor, fileInfo: fileInfo,
    // for the grid (item 21): the stored pairs of the open project (their descriptions); the scans themselves are not checked here
    stats: stats, prune: prune, current: current,
    storedSync: function () { var pk = P(); return pk ? pk.entries() : null; },
    load: function () { return Promise.resolve(!!P()); }
  };
})();
