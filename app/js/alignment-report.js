/* Book Compare: the alignment report (0.17.0, owner 27 Nov 2026: "Testing on my PC: that sounds good to me").
   Desktop program, a project saved as a file, with stored alignments (from the Compare tab or "Align in the background").
   Menu ⋮ → Project → "Alignment report …" writes ONE html file the owner saves where he likes (for example into a folder Claude can read):
     - every stored pair: copy, page, share of ink without partner after the alignment, largest movement, "almost empty page";
     - the pages with the most ink without partner as small superimposed pictures (the same colours as the Compare tab);
     - how long bending each of those pages took on this computer;
     - the same numbers as data (JSON) at the end, for reading by a program.
   Nothing is aligned anew and no scan is changed: the stored movements are only applied and drawn. */
(function () {
  'use strict';
  var H = 1100;                                        // height of the small pictures (px)
  function T() { return window.BookWorkspace && window.BookWorkspace.tab; }
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pct(u) { return u == null ? '' : (100 * u).toFixed(1) + ' %'; }

  // every stored pair of the project, with its row and the copies' names
  function pairs() {
    var t = T(), pk = t.pack && t.pack(); if (!pk) return [];
    var copies = t.copyList(), byId = {}; copies.forEach(function (c) { byId[c.id] = c; });
    var rows = t.rowCount(), out = [];
    Object.keys(pk.moves).forEach(function (name) {
      var m = (pk.moves[name] || {}).meta || {};
      if (typeof m.valid !== 'string' || m.valid.indexOf(BCResults.ENGINE + '|') !== 0) return;
      var row = -1;
      for (var r = 0; r < rows && row < 0; r++) if (t.cellKey(m.c0, r) === m.k0 && t.cellKey(m.c1, r) === m.k1) row = r;
      out.push({ name: name, c0: m.c0, c1: m.c1, k0: m.k0, k1: m.k1, row: row, label: row >= 0 ? t.rowLabel(row) : '(no longer in the grid)',
        copy0: byId[m.c0] ? byId[m.c0].name : '?', copy1: byId[m.c1] ? byId[m.c1].name : '?', u: m.u != null ? m.u : null, max: m.max != null ? m.max : null, sparse: !!m.sparse });
    });
    out.sort(function (a, b) { return (b.u || 0) - (a.u || 0); });
    return out;
  }

  // one pair as a small superimposed picture: the reference in copy 1's colour, the stored movement applied to the other copy in copy 2's
  async function picture(engine, p) {
    var t = T(), f0 = await t.scanFile(p.c0, p.row), f1 = await t.scanFile(p.c1, p.row);
    var bin = await t.pack().getMove(p.name);
    var t0 = performance.now(), rs = await engine.warpStored(f1, bin), bend = (performance.now() - t0) / 1000;
    var b0 = await createImageBitmap(f0), w = Math.round(b0.width * H / b0.height);
    var a = document.createElement('canvas'); a.width = w; a.height = H;
    var ca = a.getContext('2d', { willReadFrequently: true }); ca.imageSmoothingQuality = 'high'; ca.drawImage(b0, 0, 0, w, H); b0.close();
    var full = document.createElement('canvas'); full.width = rs.w; full.height = rs.h;
    full.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rs.pixels), rs.w, rs.h), 0, 0); rs.pixels = null;
    var b = document.createElement('canvas'); b.width = w; b.height = H;
    var cb = b.getContext('2d', { willReadFrequently: true }); cb.imageSmoothingQuality = 'high'; cb.drawImage(full, 0, 0, w, H); full.width = full.height = 1;
    inkLayer(ca, DIFF_COLOR_1, 0); inkLayer(cb, DIFF_COLOR_2, 0);              // (viz.js: the same ink layers as the Superimposed view)
    ca.globalCompositeOperation = 'multiply'; ca.drawImage(b, 0, 0);
    return { url: a.toDataURL('image/jpeg', 0.8), bend_s: bend, size: [rs.w, rs.h] };
  }

  async function run(n, say) {
    var t = T(), list = pairs(), engine = AlignEngine.create(), shots = [];
    try {
      await engine.init();
      var pick = list.filter(function (p) { return p.row >= 0; }).slice(0, n);
      for (var i = 0; i < pick.length; i++) {
        say('Drawing page ' + (i + 1) + ' of ' + pick.length + ' (' + pick[i].copy1 + ', ' + pick[i].label + ') …');
        try { var s = await picture(engine, pick[i]); shots.push(Object.assign({}, pick[i], s)); }
        catch (e) { shots.push(Object.assign({}, pick[i], { error: String(e && e.message || e) })); }
      }
    } finally { try { engine.terminate(); } catch (x) { /* ignore */ } }
    return { list: list, shots: shots };
  }

  function html(res) {
    var t = T(), info = window.BookWorkspace.projectInfo ? window.BookWorkspace.projectInfo() : {}, when = new Date();
    var by = {}; res.list.forEach(function (p) { (by[p.copy1] = by[p.copy1] || []).push(p.u || 0); });
    var med = function (a) { a = a.slice().sort(function (x, y) { return x - y; }); return a.length ? a[Math.floor(a.length / 2)] : 0; };
    var h = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Alignment report: ' + esc(info.title || info.name || 'project') + '</title>' +
      '<style>body{font:14px/1.45 system-ui,sans-serif;margin:24px;color:#1b2a2a}table{border-collapse:collapse}td,th{padding:3px 10px;border-bottom:1px solid #dde;text-align:left}' +
      'th{background:#eef5f5}.bad{color:#b42318;font-weight:600}figure{display:inline-block;margin:0 18px 24px 0;vertical-align:top}figcaption{font-size:13px;max-width:780px}img{max-height:' + H + 'px;border:1px solid #ccd}</style></head><body>' +
      '<h1>Alignment report: ' + esc(info.title || info.name || 'project') + '</h1><p>Made by Book Compare ' + esc(window.BookWorkspace.version ? BookWorkspace.version() : '') + ' on ' + esc(when.toLocaleString()) +
      '. ' + res.list.length + ' stored pairs. “Unmatched” = share of the ink (in the printed area) that has no partner in the other copy after the alignment: ' +
      'real differences, but also anything the alignment could not bring together.</p>';
    h += '<h2>Per copy (median unmatched)</h2><table><tr><th>Copy</th><th>Pairs</th><th>Median</th><th>Worst</th></tr>' +
      Object.keys(by).sort().map(function (k) { var a = by[k]; return '<tr><td>' + esc(k) + '</td><td>' + a.length + '</td><td>' + pct(med(a)) + '</td><td>' + pct(Math.max.apply(null, a)) + '</td></tr>'; }).join('') + '</table>';
    h += '<h2>The pages with the most unmatched ink</h2>' + res.shots.map(function (s) {
      return '<figure>' + (s.url ? '<img alt="" src="' + s.url + '">' : '<p class="bad">Could not be drawn: ' + esc(s.error) + '</p>') +
        '<figcaption><b>' + esc(s.copy1) + '</b> onto <b>' + esc(s.copy0) + '</b>, ' + esc(s.label) + ' (' + esc(s.k1) + ' / ' + esc(s.k0) + '): ' + pct(s.u) + ' unmatched, largest movement ' + (s.max != null ? s.max + ' px' : '?') +
        (s.sparse ? ', almost empty page' : '') + (s.bend_s != null ? '; bent in ' + s.bend_s.toFixed(1) + ' s' : '') + '</figcaption></figure>';
    }).join('');
    h += '<h2>All stored pairs</h2><table><tr><th>Copy</th><th>Onto</th><th>Page</th><th>Unmatched</th><th>Largest movement</th><th></th></tr>' + res.list.map(function (p) {
      return '<tr><td>' + esc(p.copy1) + '</td><td>' + esc(p.copy0) + '</td><td>' + esc(p.label) + '</td><td' + ((p.u || 0) > 0.15 ? ' class="bad"' : '') + '>' + pct(p.u) + '</td><td>' + (p.max != null ? p.max + ' px' : '') + '</td><td>' + (p.sparse ? 'almost empty' : '') + '</td></tr>';
    }).join('') + '</table>';
    var data = { version: window.BookWorkspace.version ? BookWorkspace.version() : '', at: when.toISOString(), project: info.title || info.name || '', engine: BCResults.ENGINE,
      cpus: navigator.hardwareConcurrency || null, memoryGB: t.memoryGB ? t.memoryGB() : null,
      pairs: res.list.map(function (p) { return { copy: p.copy1, onto: p.copy0, page: p.label, row: p.row, file: p.k1, ref: p.k0, u: p.u, max: p.max, sparse: p.sparse }; }),
      drawn: res.shots.map(function (s) { return { copy: s.copy1, page: s.label, bend_s: s.bend_s != null ? +s.bend_s.toFixed(2) : null, size: s.size || null, error: s.error || null }; }) };
    h += '<script type="application/json" id="bc-report-data">' + JSON.stringify(data).replace(/</g, '\\u003c') + '</script></body></html>';
    return h;
  }

  function open() {
    var t = T();
    if (!t.isDesktop()) return t.toast('The alignment report needs the desktop program.');
    if (!t.hasProjectFile()) return t.toast('Save the project as a file first: the stored alignments are kept inside it.');
    var n = pairs().length;
    if (!n) return t.toast('No stored alignments yet: compare pages, or use “Align in the background”, first.');
    var sc = t.modal('<h3>Alignment report</h3><p>Book Compare writes one file (a web page) about the ' + n + ' stored alignment' + (n === 1 ? '' : 's') + ' of this project: ' +
      'for every pair how much ink found no partner, and pictures of the pages where most is left over. Nothing is aligned anew and no scan is changed. ' +
      'Save the file where Claude can read it (for example in your Dropbox).</p>' +
      '<label class="inl">Pictures of the <input type="number" id="ar-n" min="0" max="200" value="' + Math.min(24, n) + '" style="width:64px"> pages with the most unmatched ink</label>' +
      '<p id="ar-say" class="ws-sub" aria-live="polite"></p>' +
      '<div class="acts"><button class="ws-tb" data-close id="ar-cancel">Cancel</button><button class="ws-tb primary" id="ar-go">Make the report</button></div>');
    var go = sc.querySelector('#ar-go'), say = function (m) { var e = sc.querySelector('#ar-say'); if (e) e.textContent = m; };
    go.onclick = async function () {
      go.disabled = true; var k = Math.max(0, Math.min(200, parseInt(sc.querySelector('#ar-n').value, 10) || 0));
      try {
        var res = await run(k, say), page = html(res), info = window.BookWorkspace.projectInfo ? window.BookWorkspace.projectInfo() : {};
        var a = document.createElement('a'), url = URL.createObjectURL(new Blob([page], { type: 'text/html' }));
        a.href = url; a.download = ((info.title || info.name || 'Book Compare').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Book Compare') + ' - alignment report.html';
        document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
        t.closeModal(); t.toast('The alignment report is ready (' + res.list.length + ' pairs, ' + res.shots.length + ' pictures).');
      } catch (e) { go.disabled = false; say('Could not make the report: ' + (e && e.message || e)); }
    };
  }
  window.BCAlignReport = { open: open, pairs: pairs, html: html, run: run };
})();
