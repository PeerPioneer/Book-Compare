/* Book Compare: aligning copies onto the reference copy in the background (V8, V9; desktop program only).
   Pages tab → button "Align in the background …": the chosen copies are aligned page by page onto the reference copy
   (V7; where it has no page, the copy standing in for it), by several helpers at the same time (Web Workers, js/align-engine.js).
   Only the movement of each page is kept, inside the project file (0.12.0; js/results-store.js, js/project-pack.js, V10); pages that are
   already stored and still fit are skipped, so a stopped run can simply be started again. Afterwards a comparison with the reference
   opens at once in the Compare tab.
   A strip in the Pages view shows how far it is and about how long it will still take, with Pause and Stop. A page where more than
   30 % of the ink has no partner (the rows of the grid may be out of step there, V18) pauses the run and asks.
   Nothing here touches a scan: scans are only read. */
(function () {
  'use strict';
  var MISMATCH = 0.30, MAX_JOBS = 40;
  var R = null;                        // the current run (null = none)
  function T() { return window.BookWorkspace && window.BookWorkspace.tab; }
  function esc(t) { return String(t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  // helpers at the same time: at most one per processor thread, and (item 31) at most as many as the memory allows - a helper may need
  // about 1.2 GB for a large scan, and about 4 GB are left to Windows and the other programs
  function threads() {
    var n = Math.max(1, navigator.hardwareConcurrency || 2), t = T(), gb = t && t.memoryGB ? t.memoryGB() : null;
    if (gb) n = Math.min(n, Math.max(1, Math.floor((gb - 4) / 1.2)));
    return n;
  }
  function half() { return Math.max(1, Math.floor(threads() / 2)); }
  function copyName(id) { var l = T().copyList().filter(function (c) { return c.id === id; })[0]; return l ? l.name : 'copy ' + id; }

  /* ---------------------------------------------------------------- starting */
  function open() {
    var t = T();
    if (!t.isDesktop()) return t.toast('Aligning in the background needs the desktop program.');
    if (R && !R.finished) return render(true);
    if (!t.hasProjectFile()) {
      var s1 = t.modal('<h3>Save the project first</h3><p>The background alignment keeps its results inside the project file. Save the project as a file first (not in one of your scan folders).</p>' +
        '<div class="acts"><button class="ws-tb" data-close>Cancel</button><button class="ws-tb primary" id="bg-save">Save project …</button></div>');
      s1.querySelector('#bg-save').onclick = function () { t.closeModal(); Promise.resolve(t.saveAs()).then(function () { if (t.hasProjectFile()) open(); }); };
      return;
    }
    if (t.refCopy() == null) {
      var s2 = t.modal('<h3>Choose the reference copy first</h3><p>The other copies are aligned onto the reference copy. Book Compare proposes one; you confirm it.</p>' +
        '<div class="acts"><button class="ws-tb" data-close>Cancel</button><button class="ws-tb primary" id="bg-ref">Choose the reference copy …</button></div>');
      s2.querySelector('#bg-ref').onclick = function () { t.closeModal(); t.refDialog(); };
      return;
    }
    // 0.15.0 (owner): no copy is ticked at first ("Select all" ticks them); copies whose pages are all aligned already are greyed out;
    // the reference copy is in the list, in bold, without a box to tick, and can be changed right here
    var ref = t.refCopy(), all = t.copyList();
    var h = '<h3>Align copies in the background</h3><p>The copies you tick are aligned page by page onto the reference copy. ' +
      'Only how each page had to be moved is kept, inside the project file (about 0.2 MB a page). ' +
      'Afterwards, comparing a page with the reference opens at once. Pages that are already stored are skipped. You can go on working meanwhile.</p>' +
      '<div class="ws-bgopts ws-bglist" id="bg-list">';
    all.forEach(function (c) {
      if (c.id === ref) {
        h += '<div class="ws-bgref"><span class="ws-bgrefname"><b>★ ' + esc(c.name) + '</b> · ' + c.pages + ' page' + (c.pages === 1 ? '' : 's') + '</span>' +
          '<span class="ws-bgrefwhy">the reference copy: the others are aligned onto it</span></div>';
        return;
      }
      var a = t.alignedOf ? t.alignedOf(c.id) : { n: c.pages, b: 0 }, full = a.n > 0 && a.b >= a.n, none = a.n === 0;
      h += '<label class="' + (full || none ? 'done' : '') + '"' + (full ? ' title="All its pages are aligned onto the reference copy already"' : none ? ' title="No page of this copy has a reference page beside it"' : '') + '>' +
        '<input type="checkbox" class="bg-copy" value="' + c.id + '"' + (full || none ? ' disabled' : '') + '> <b>' + esc(c.name) + '</b> · ' + c.pages + ' page' + (c.pages === 1 ? '' : 's') +
        (full ? ' · all aligned' : a.b ? ' · ' + a.b + ' of ' + a.n + ' aligned' : '') + '</label>';
    });
    h += '</div><div class="ws-bgsel"><button class="ws-tb" id="bg-all">Select all</button>' +
      '<label class="ws-bgchref">Reference copy <select id="bg-ref" aria-label="Reference copy">' + all.map(function (c) { return '<option value="' + c.id + '"' + (c.id === ref ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('') + '</select></label></div>';
    h += '<div class="ws-bgopts"><label><input type="radio" name="bg-n" value="' + half() + '" checked> ' + half() + ' helper' + (half() === 1 ? '' : 's') + ' at the same time (half of this computer; recommended)</label>';
    if (threads() > half()) h += '<label><input type="radio" name="bg-n" value="' + threads() + '"> ' + threads() + ' helpers (all of this computer: quicker, but the computer is slow meanwhile and needs more memory)</label>';
    h += '</div><div class="acts"><button class="ws-tb" data-close>Cancel</button><button class="ws-tb primary" id="bg-go">Start</button></div>';
    var sc = t.modal(h);
    sc.querySelector('#bg-all').onclick = function () { Array.prototype.forEach.call(sc.querySelectorAll('.bg-copy:not(:disabled)'), function (x) { x.checked = true; }); };
    sc.querySelector('#bg-ref').onchange = function () {                              // another reference copy: the list is drawn again for it
      var id = +this.value; t.closeModal(); if (t.setRef) t.setRef(id);
      t.toast('“' + copyName(id) + '” is the reference copy now.'); open();
    };
    sc.querySelector('#bg-go').onclick = function () {
      var ids = Array.prototype.map.call(sc.querySelectorAll('.bg-copy:checked'), function (x) { return +x.value; });
      var n = +((sc.querySelector('input[name=bg-n]:checked') || {}).value || half());
      if (!ids.length) return t.toast('Tick at least one copy (or “Select all”).');
      t.closeModal(); start(ids, n);
    };
  }
  function start(ids, n) {
    stop(true);
    var t = T(), rows = t.rowCount(), q = [];
    ids.forEach(function (c) { for (var r = 0; r < rows; r++) { var b = t.refFor(r); if (t.cellKey(c, r) && b != null && b !== c) q.push({ c: c, row: r }); } });
    R = { ids: ids, n: Math.max(1, Math.min(n || half(), threads())), queue: q, pos: 0, done: 0, skipped: 0, failed: [], times: [], workers: [], paused: false, warn: null, stopped: false,
      finished: false, ignore: {}, t0: Date.now(), resultsId: t.resultsId() };
    offered = null; if (t.setBgRun) t.setBgRun({ ids: ids.slice(), n: R.n });       // kept in the project until the run is finished or stopped (item 21)
    for (var i = 0; i < R.n; i++) R.workers.push(newWorker());
    render(); pump();
  }
  function newWorker() { return { e: AlignEngine.create(), ready: false, busy: false, jobs: 0 }; }
  function freshWorker(w) { try { w.e.terminate(); } catch (e) { /* ignore */ } w.e = AlignEngine.create(); w.ready = false; w.jobs = 0; }

  /* ---------------------------------------------------------------- the work */
  function pump() {
    if (!R || R.stopped || R.paused) return;
    R.workers.forEach(function (w) { if (!w.busy && R.pos < R.queue.length && !R.paused && !R.stopped) run(w, R.queue[R.pos++], R); });
    if (R.pos >= R.queue.length && R.workers.every(function (w) { return !w.busy; }) && !R.finished) finish();
  }
  async function run(w, job, run0) {
    w.busy = true;
    var t = T(), c = job.c, row = job.row, startT = performance.now(), aligned = false;
    try {
      if (t.resultsId() !== run0.resultsId) throw new Error('another project');
      var b = t.refFor(row), k0 = b != null ? t.cellKey(b, row) : null, k1 = t.cellKey(c, row);
      if (b == null || b === c || !k0 || !k1) { run0.skipped++; return; }               // (the grid was changed meanwhile)
      var tiles = t.tileSetting(row, c), quad = t.boxSetting(row, b), p = { c0: b, k0: k0, c1: c, k1: k1, tiles: tiles, quad: quad, i0: await t.scanInfo(b, row), i1: await t.scanInfo(c, row) };
      if (await BCResults.has(p)) { run0.skipped++; return; }
      var f0 = await t.scanFile(b, row), f1 = await t.scanFile(c, row);
      p.i0 = await BCResults.fileInfo(f0); p.i1 = await BCResults.fileInfo(f1);
      if (run0.stopped) return;
      if (!w.ready) { await w.e.init(); w.ready = true; }
      var r = await w.e.alignStore(f0, b + '#' + k0 + '#' + p.i0.size + '#' + p.i0.mtime + '#' + JSON.stringify(quad || null), f1, tiles, quad);
      w.jobs++; aligned = true;
      if (run0.stopped) return;
      await BCResults.save(p, r.bin, { u: r.unmatched_tiles, max: r.max, sparse: !!r.sparse });
      run0.done++; run0.times.push((performance.now() - startT) / 1000);
      if (!r.sparse && r.unmatched_tiles > MISMATCH && !run0.ignore[c]) { run0.paused = true; run0.warn = { c: c, row: row, share: r.unmatched_tiles, ref: b }; }
    } catch (e) {
      if (run0.stopped) return;
      run0.failed.push({ c: c, row: row, msg: (e && e.message) || String(e) });
      if (!aligned) freshWorker(w);                                                    // (a helper that failed gives its memory back, A5)
    } finally {
      w.busy = false;
      if (w.jobs >= MAX_JOBS && !run0.stopped) freshWorker(w);
      if (R === run0) { render(); pump(); }
    }
  }
  function finish() {
    R.finished = true; BCResults.flush();
    var t = T(); if (t && t.setBgRun && t.resultsId() === R.resultsId) t.setBgRun(null);
    R.workers.forEach(function (w) { try { w.e.terminate(); } catch (e) { /* ignore */ } }); R.workers = [];
    render();
  }
  function stop(quiet) {
    if (!R) return;
    var old = R; old.stopped = true; R = null;
    old.workers.forEach(function (w) { try { w.e.terminate(); } catch (e) { /* ignore */ } });
    if (window.BCResults) BCResults.flush();
    if (!quiet) render(); else hideStrip();
  }
  function hideStrip() { var t = T(), el = t && t.bgSlot(); if (el) { el.hidden = true; el.innerHTML = ''; } popOpen = false; renderProg(); renderCompare(); renderButton(); }
  // 0.12.0 (owner): the Compare tab, where one works most of the time, shows the warning too (with the same buttons; "Go to the page"
  // opens that page there), and, small, how far the run is
  function renderCompare() {
    var cs = window.CompareTab && CompareTab.bgSlot ? CompareTab.bgSlot() : null; if (!cs) return;
    if (!R || R.finished || !R.warn) { cs.hidden = true; cs.innerHTML = ''; return; }      // (0.16.0: how far it is shows at the top)
    if (R.warn) {
      var w = R.warn, t = T();
      cs.className = 'ct-bgslot warn';
      cs.innerHTML = '<span><b>Background alignment paused:</b> on ' + esc(t.rowLabel(w.row)) + ', ' + Math.round(100 * w.share) + ' % of the ink of “' + esc(copyName(w.c)) + '” has no partner on “' + esc(copyName(w.ref)) + '”. The rows of the grid may be out of step there.</span>' +
        '<button data-bg="goto">Go to the page</button><button data-bg="go">Continue</button><button data-bg="ignore">Do not ask again for “' + esc(copyName(w.c)) + '”</button><button data-bg="stop">Stop</button>';
    }
    cs.hidden = false;
    if (!cs.__bc) { cs.__bc = true; cs.addEventListener('click', onClick); }
  }

  /* ---------------------------------------------------------------- the strip in the Pages view */
  function minutes(s) { return s < 90 ? 'about a minute' : s < 3600 ? 'about ' + Math.round(s / 60) + ' minutes' : 'about ' + (s / 3600).toFixed(1).replace('.0', '') + ' hours'; }
  function shortTime(s) { return s < 90 ? '1 min' : s < 3600 ? Math.round(s / 60) + ' min' : (s / 3600).toFixed(1).replace('.0', '') + ' h'; }
  function who() { return R.ids.length === 1 ? '“' + esc(copyName(R.ids[0])) + '”' : R.ids.length + ' copies'; }
  // how long the rest takes: the last jobs' times, shared out among the helpers (null until two pages are done)
  function secondsLeft() {
    var avg = 0, k = R.times.slice(-24); k.forEach(function (x) { avg += x; }); avg = k.length ? avg / k.length : 0;
    var through = R.done + R.skipped + R.failed.length;
    return R.times.length >= 2 ? (R.queue.length - through) * avg / R.n : null;
  }
  function render() {
    var t = T(), el = t && t.bgSlot();
    renderProg();
    if (!el) { renderCompare(); return; }
    if (!R || (!R.finished && !R.warn)) { el.hidden = true; el.innerHTML = ''; renderCompare(); renderButton(); return; }
    var h = '';
    el.className = 'ws-banner ws-bg' + (R.warn ? ' warn' : '');
    if (R.finished) {
      h = '<span><b>Background alignment finished</b> for ' + who() + ': ' + R.done + ' page' + (R.done === 1 ? '' : 's') + ' aligned' + (R.skipped ? ', ' + R.skipped + ' already stored' : '') +
        (R.failed.length ? ', <b>' + R.failed.length + ' could not be aligned</b>' : '') + '. Comparisons with the reference now open at once.</span>' +
        (R.failed.length ? '<button class="ws-tb" data-bg="details">Details …</button>' : '') + '<button class="ws-tb primary" data-bg="close">Close</button>';
    } else {
      var w = R.warn;
      h = '<span><b>Paused:</b> on ' + esc(t.rowLabel(w.row)) + ', ' + Math.round(100 * w.share) + ' % of the ink of “' + esc(copyName(w.c)) + '” has no partner on “' + esc(copyName(w.ref)) + '”. ' +
        'The two scans may not show the same page: the rows of the grid may be out of step there (a page missing or extra in one copy).</span>' +
        '<button class="ws-tb" data-bg="goto">Go to the page</button><button class="ws-tb" data-bg="go">Continue</button><button class="ws-tb" data-bg="ignore">Continue, do not ask again for “' + esc(copyName(w.c)) + '”</button><button class="ws-tb" data-bg="stop">Stop</button>';
    }
    el.innerHTML = h; el.hidden = false;
    if (!el.__bc) { el.__bc = true; el.addEventListener('click', onClick); }
    renderCompare(); renderButton();
  }
  /* ---------------------------------------------------------------- 0.16.0 (owner): how far it is, at the top of both tabs, left of "Pages" */
  // A small bar with the pages done and the time left; a click opens the details with Pause / Continue / Stop.
  var popOpen = false;
  function renderProg() {
    var els = document.querySelectorAll('.bc-bgprog');
    Array.prototype.forEach.call(els, function (el) {
      if (!R) { el.hidden = true; el.innerHTML = ''; return; }
      var total = R.queue.length, through = R.done + R.skipped + R.failed.length, pct = total ? Math.round(100 * through / total) : 100, left = secondsLeft();
      var state = R.finished ? 'done' : R.warn ? 'warn' : R.paused ? 'paused' : 'run';
      var txt = state === 'done' ? 'Background alignment finished' : state === 'warn' ? 'Paused: please look' : state === 'paused' ? 'Paused · ' + through + ' of ' + total :
        through + ' of ' + total + (left != null ? ' · ' + shortTime(left) + ' left' : '');
      var pop = '';
      if (popOpen) {
        if (state === 'done') pop = '<p><b>Finished</b> for ' + who() + ': ' + R.done + ' page' + (R.done === 1 ? '' : 's') + ' aligned' + (R.skipped ? ', ' + R.skipped + ' already stored' : '') +
          (R.failed.length ? ', <b>' + R.failed.length + ' could not be aligned</b>' : '') + '.</p><div class="bc-bgacts">' + (R.failed.length ? '<button data-bg="details">Details …</button>' : '') + '<button class="primary" data-bg="close">Close</button></div>';
        else pop = '<p><b>' + (state === 'run' ? 'Aligning in the background' : 'Paused') + '</b>: ' + who() + ' onto the reference copy.</p>' +
          '<p>' + through + ' of ' + total + ' page' + (total === 1 ? '' : 's') + (state === 'run' ? (left != null ? ' · ' + minutes(left) + ' left' : ' · working out how long it takes …') : '') +
          ' · ' + R.n + ' helper' + (R.n === 1 ? '' : 's') + (R.failed.length ? ' · ' + R.failed.length + ' failed' : '') + '</p>' +
          (state === 'warn' ? '<p class="bc-bgwarn">A page needs your answer: see the message below the top bar.</p>' : '') +
          '<div class="bc-bgacts">' + (state === 'run' ? '<button data-bg="pause">Pause</button>' : state === 'paused' ? '<button data-bg="go">Continue</button>' : '') + '<button data-bg="stop">Stop</button></div>';
      }
      el.className = 'bc-bgprog ' + state;
      el.innerHTML = '<button class="bc-bgpbtn" data-bg="pop" aria-expanded="' + popOpen + '" title="Background alignment: click for the details">' +
        (state === 'done' ? '<span class="bc-bgok" aria-hidden="true">✓</span>' : '<span class="bc-bgbar" aria-hidden="true"><i style="width:' + pct + '%"></i></span>') +
        '<span class="bc-bgtxt">' + txt + '</span></button>' + (popOpen ? '<div class="bc-bgpop" role="dialog" aria-label="Background alignment">' + pop + '</div>' : '');
      el.hidden = false;
      if (!el.__bc) { el.__bc = true; el.addEventListener('click', onClick); }
    });
  }
  document.addEventListener('pointerdown', function (e) {                                     // a click elsewhere closes the details
    if (popOpen && !(e.target.closest && e.target.closest('.bc-bgprog'))) { popOpen = false; renderProg(); }
  }, true);
  document.addEventListener('keydown', function (e) { if (popOpen && e.key === 'Escape') { popOpen = false; renderProg(); } }, true);
  function renderButton() { var t = T(); if (t && t.refreshBgButton) t.refreshBgButton(); }
  // A run that did not finish (the program was closed meanwhile): when the project is opened again, offer to go on (item 21)
  var offered = null;
  function offer(run) {
    var t = T(), el = t && t.bgSlot(); if (!el || R || !run) return;
    var ref = t.refCopy(), ids = (run.ids || []).filter(function (id) { return id !== ref && t.copyList().some(function (c) { return c.id === id; }); });
    if (!ids.length || ref == null || !t.hasProjectFile() || !t.isDesktop()) return;
    offered = { ids: ids, n: run.n || half() };
    var who = ids.length === 1 ? '“' + esc(copyName(ids[0])) + '”' : ids.length + ' copies';
    el.className = 'ws-banner ws-bg';
    el.innerHTML = '<span><b>The background alignment was not finished</b> (' + who + ' onto the reference copy). Going on skips the pages that are already stored.</span>' +
      '<button class="ws-tb primary" data-bg="resume">Continue aligning</button><button class="ws-tb" data-bg="forget">No, thanks</button>';
    el.hidden = false;
    if (!el.__bc) { el.__bc = true; el.addEventListener('click', onClick); }
  }
  function onClick(e) {
    var b = e.target.closest && e.target.closest('[data-bg]'); if (!b) return;
    var a = b.dataset.bg, t = T();
    if (a === 'pop') { popOpen = !popOpen; renderProg(); return; }
    if (a === 'resume' && offered) { var o = offered; offered = null; start(o.ids, o.n); return; }
    if (a === 'forget') { offered = null; if (t.setBgRun) t.setBgRun(null); hideStrip(); return; }
    if (!R) return;
    if (a === 'pause') { R.paused = true; render(); }
    else if (a === 'go' || a === 'ignore') { if (a === 'ignore' && R.warn) R.ignore[R.warn.c] = true; R.warn = null; R.paused = false; render(); pump(); }
    else if (a === 'goto' && R.warn) { if (window.CompareTab && CompareTab.isOpen() && t.compareAt) t.compareAt(R.warn.ref, R.warn.c, R.warn.row); else t.goTo(R.warn.c, R.warn.row); }
    else if (a === 'stop') { var r = R; stop(true); if (t.setBgRun) t.setBgRun(null); t.toast('Background alignment stopped: ' + r.done + ' page' + (r.done === 1 ? '' : 's') + ' aligned and kept. Starting it again goes on where it stopped.'); }
    else if (a === 'close') { R = null; popOpen = false; render(); }
    else if (a === 'details') {
      var h = '<h3>Pages that could not be aligned</h3><div class="ws-bgfail"><ul>' + R.failed.map(function (f) { return '<li><b>' + esc(copyName(f.c)) + '</b>, ' + esc(t.rowLabel(f.row)) + ': ' + esc(f.msg) + '</li>'; }).join('') +
        '</ul></div><div class="acts"><button class="ws-tb primary" data-close>Close</button></div>';
      t.modal(h);
    }
  }

  window.BCBackground = {
    open: open, start: start, stop: function () { stop(true); offered = null; }, render: render, offer: offer,
    running: function () { return !!(R && !R.finished); },
    state: function () { return R ? { total: R.queue.length, done: R.done, skipped: R.skipped, failed: R.failed.length, paused: R.paused, warn: R.warn, finished: R.finished, helpers: R.n } : null; },
    MISMATCH: MISMATCH
  };
})();
