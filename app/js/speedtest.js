/* Book Compare: speed test (Pages view, menu "More" > "Measure speed on this computer …").
   Aligns real page pairs from the open project one after the other, times every step and shows what that means for a whole book.
   It only READS the scans. Nothing is saved, nothing in the project and nothing on screen in the Compare tab is changed:
   the pictures are decoded and aligned on separate, temporary canvases.
   The engine is the same one the Compare tab uses (E.result.transform, a WebAssembly module); it runs inside the page, so the page
   freezes for as long as one alignment takes. That freeze is part of what is measured. */
(function () {
  'use strict';
  var E = null;                       // { compare, result } from index.html
  var busy = false;
  var TYPES = [['affine', 'Affine'], ['perspective', 'Perspective'], ['tps', 'Thin plate spline']];
  var MAX_COPIES = 10;                // a quick test: at most this many other copies, spread over the list

  function W() { return window.BookWorkspace && window.BookWorkspace.tab; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function now() { return performance.now(); }
  function frame() { return new Promise(function (r) { requestAnimationFrame(function () { setTimeout(r, 0); }); }); }
  function typeName(m) { for (var i = 0; i < TYPES.length; i++) if (TYPES[i][0] === m) return TYPES[i][1]; return m; }
  function s1(ms) { var s = ms / 1000; return (s >= 9.95 ? Math.round(s) : s.toFixed(1)) + ' s'; }
  function mp(w, h) { return (w * h / 1e6).toFixed(1) + ' MP'; }
  function num(n) { return Math.round(n).toLocaleString('en-US'); }
  function dur(sec) {
    if (!isFinite(sec)) return 'unknown';
    if (sec < 90) return 'about ' + Math.max(1, Math.round(sec)) + ' seconds';
    var m = sec / 60;
    if (m < 90) return 'about ' + Math.round(m) + ' minutes';
    var h = m / 60;
    if (h < 48) return 'about ' + (h < 10 ? (Math.round(h * 2) / 2) : Math.round(h)) + ' hours';
    return 'about ' + (Math.round(h / 24 * 2) / 2) + ' days';
  }
  function median(a) { var b = a.slice().sort(function (x, y) { return x - y; }), n = b.length; return n ? (n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2) : 0; }
  function sum(a) { return a.reduce(function (x, y) { return x + y; }, 0); }

  function spread(items, n) {         // n items spread evenly over the list
    if (items.length <= n) return items.slice();
    var out = [];
    for (var i = 0; i < n; i++) out.push(items[Math.round(i * (items.length - 1) / (n - 1))]);
    return out;
  }

  /* ---------------------------------------------------------------- measuring */
  async function decode(file) {
    var url = URL.createObjectURL(file), im = new Image();
    try { im.src = url; await im.decode(); }
    catch (e) { URL.revokeObjectURL(url); throw e; }
    return { im: im, url: url };
  }
  // opens one scan like the Compare tab does and returns its pixels; times are written into rec
  async function openScan(id, row, rec) {
    var t0 = now(), file = await W().speedFile(id, row), t1 = now(), d;
    rec.file = file.name; rec.mb = file.size / 1e6;
    try { d = await decode(file); }
    catch (e) { throw new Error('The browser could not open the scan “' + file.name + '” (' + rec.mb.toFixed(1) + ' MB). It may be too large for this browser or in a format it does not read.'); }
    var t2 = now(), pix;
    try { rec.w = d.im.naturalWidth; rec.h = d.im.naturalHeight; pix = E.result.getImageData(d.im); }
    catch (e) { throw new Error('The browser ran out of memory while reading the scan “' + file.name + '” (' + mp(rec.w || 0, rec.h || 0) + ').'); }
    finally { URL.revokeObjectURL(d.url); d.im.removeAttribute('src'); }
    var t3 = now();
    rec.read = t1 - t0; rec.decode = t2 - t1; rec.pixels = t3 - t2;
    return pix;
  }
  // finds the alignment of `pix` onto `ref` and draws the aligned picture, like Visualization.process does (but into nothing visible)
  function align(pix, ref, mode, rec) {
    var T = E.result.transform;
    var t0 = now(), buf = T.estimate_transform(pix.data, pix.height, ref.data, ref.height, mode), t1 = now();
    var H = new Float64Array(buf.buffer, buf.byteOffset, buf.length / Float64Array.BYTES_PER_ELEMENT).slice();
    var t2 = now(); T.warp_image(pix.data, pix.height, H, ref.height, ref.width, mode); var t3 = now();
    rec.find = t1 - t0; rec.draw = t3 - t2; rec.hn = H.length;
  }

  async function runTest(plan, mode, withTypes, ui) {
    var res = { when: new Date(), plan: plan, mode: mode, ref: { name: plan.ref.name }, copies: [], types: null, stopped: false };
    var refPix = null, keep = null;
    ui.status('Opening the first copy (' + plan.ref.name + ') …', 0);
    await frame();
    try { refPix = await openScan(plan.ref.id, plan.row, res.ref); }
    catch (e) { res.fatal = e.message || String(e); return res; }
    var items = spread(plan.items, MAX_COPIES);
    for (var i = 0; i < items.length; i++) {
      if (ui.stopped()) { res.stopped = true; break; }
      var it = items[i], rec = { name: it.name, ok: false };
      res.copies.push(rec);
      ui.status('Copy ' + (i + 1) + ' of ' + items.length + ': ' + it.name + ' – opening the scan …', i / items.length);
      await frame();
      var pix = null;
      try { pix = await openScan(it.id, plan.row, rec); }
      catch (e) { rec.err = e.message || String(e); ui.line(rec); continue; }
      ui.status('Copy ' + (i + 1) + ' of ' + items.length + ': ' + it.name + ' – aligning (the window may freeze for a moment) …', (i + 0.5) / items.length);
      await frame();
      try { align(pix, refPix, mode, rec); rec.ok = true; }
      catch (e) { rec.err = 'The alignment failed for this pair (' + ((e && e.message) || e) + ').'; }
      if (rec.ok && !keep) keep = pix;
      pix = null;
      ui.line(rec);
    }
    if (withTypes && keep && !res.stopped) {
      res.types = [];
      for (var k = 0; k < TYPES.length; k++) {
        if (ui.stopped()) { res.stopped = true; break; }
        var tr = { mode: TYPES[k][0] };
        ui.status('Comparing the alignment types: ' + TYPES[k][1] + ' (the thin plate spline is slow) …', 0.9);
        await frame();
        try { align(keep, refPix, tr.mode, tr); tr.ok = true; } catch (e) { tr.err = (e && e.message) || String(e); }
        res.types.push(tr);
      }
    }
    return res;
  }

  /* ---------------------------------------------------------------- reading the numbers */
  function stats(res) {
    var ok = res.copies.filter(function (r) { return r.ok; });
    var tot = ok.map(function (r) { return r.read + r.decode + r.pixels + r.find + r.draw; });
    var s = { n: ok.length, failed: res.copies.length - ok.length };
    if (!ok.length) return s;
    s.mean = sum(tot) / ok.length; s.median = median(tot);
    s.minI = tot.indexOf(Math.min.apply(null, tot)); s.maxI = tot.indexOf(Math.max.apply(null, tot));
    s.min = tot[s.minI]; s.max = tot[s.maxI]; s.minName = ok[s.minI].name; s.maxName = ok[s.maxI].name;
    s.open = sum(ok.map(function (r) { return r.read + r.decode + r.pixels; })) / ok.length;
    s.find = sum(ok.map(function (r) { return r.find; })) / ok.length;
    s.draw = sum(ok.map(function (r) { return r.draw; })) / ok.length;
    s.freeze = s.find + s.draw + sum(ok.map(function (r) { return r.pixels; })) / ok.length;   // what the page does without letting go
    s.maxFreeze = Math.max.apply(null, ok.map(function (r) { return r.find + r.draw + r.pixels; }));
    s.maxPx = Math.max.apply(null, ok.map(function (r) { return r.w * r.h; }));
    return s;
  }
  function machine() {
    var ua = navigator.userAgent || '', b = 'unknown browser', m;
    if ((m = /Edg\/([\d.]+)/.exec(ua))) b = 'Edge ' + m[1].split('.')[0];
    else if ((m = /Firefox\/([\d.]+)/.exec(ua))) b = 'Firefox ' + m[1].split('.')[0];
    else if ((m = /Chrome\/([\d.]+)/.exec(ua))) b = 'Chrome ' + m[1].split('.')[0];
    else if ((m = /Version\/([\d.]+).*Safari/.exec(ua))) b = 'Safari ' + m[1].split('.')[0];
    var os = /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'unknown system';
    var t = navigator.hardwareConcurrency ? navigator.hardwareConcurrency + ' processor threads' : 'processor threads unknown';
    var mem = navigator.deviceMemory ? ', memory reported by the browser: ' + (navigator.deviceMemory >= 8 ? '8 GB or more' : navigator.deviceMemory + ' GB') : '';
    return b + ' on ' + os + ', ' + t + mem;
  }
  function estimates(res, st) {
    var p = res.plan, e = {};
    e.pairs = p.pairsRef; e.all = p.pairsAll;
    e.ref = (st.mean * p.pairsRef) / 1000;                             // seconds, every scan opened and aligned as the app does it today
    e.refNoDraw = ((st.mean - st.draw) * p.pairsRef) / 1000;           // if only the alignment numbers were kept
    e.all = (st.mean * p.pairsAll) / 1000;
    return e;
  }
  function plainSummary(res, st) {
    var out = [];
    if (!st.n) return out;
    out.push('Opening two scans and aligning them took <b>' + s1(st.mean) + '</b> on average on this computer (fastest ' + s1(st.min) + ' for ' + esc(st.minName) + ', slowest ' + s1(st.max) + ' for ' + esc(st.maxName) + ').');
    out.push('Of that, opening the scan takes about ' + s1(st.open) + ', finding the alignment about ' + s1(st.find) + ' and drawing the aligned picture about ' + s1(st.draw) + '. The page freezes for about <b>' + s1(st.freeze) + '</b> each time, up to ' + s1(st.maxFreeze) + ' for the largest scan, because the alignment runs inside the page itself.');
    var e = estimates(res, st);
    if (e.pairs > 0) {
      out.push('Your project has ' + num(res.plan.rowsRef) + ' page' + (res.plan.rowsRef === 1 ? '' : 's') + ' in ' + esc(res.plan.ref.name) + ', and ' + num(e.pairs) + ' comparison' + (e.pairs === 1 ? '' : 's') + ' of the other copies with ' + (res.plan.rowsRef === 1 ? 'it' : 'them') + '. Doing all of them one after the other, the way the app aligns today, would take <b>' + dur(e.ref) + '</b>' +
        (e.refNoDraw < e.ref * 0.97 ? ' (' + dur(e.refNoDraw) + ' if only the alignment numbers were kept and the pictures were not drawn)' : '') + '.');
      if (res.plan.pairsAll > e.pairs * 1.5) out.push('Comparing <i>every</i> copy with <i>every other</i> copy would be ' + num(res.plan.pairsAll) + ' comparisons (' + dur(e.all) + '). That is why the plan is to align each copy with one reference copy and work out the other pairs from those.');
    }
    return out;
  }
  function reportText(res, st) {
    var p = res.plan, L = [];
    L.push('Book Compare speed test, ' + res.when.toISOString().replace('T', ' ').slice(0, 16) + ' UTC');
    L.push('Computer: ' + machine());
    L.push('Alignment type: ' + typeName(res.mode) + '. Project: ' + p.rows + ' rows, ' + p.copies + ' copies. Page tested: ' + p.rowLabel + '. First copy (reference): ' + p.ref.name + '.');
    L.push('');
    L.push('Copy | pixels | file MB | read ms | decode ms | pixels ms | find ms | draw ms | total ms');
    var r0 = res.ref;
    if (r0.w) L.push(p.ref.name + ' (reference, opened only) | ' + r0.w + 'x' + r0.h + ' | ' + r0.mb.toFixed(1) + ' | ' + Math.round(r0.read) + ' | ' + Math.round(r0.decode) + ' | ' + Math.round(r0.pixels) + ' | - | - | -');
    res.copies.forEach(function (r) {
      if (!r.ok) { L.push(r.name + ' | FAILED: ' + r.err); return; }
      L.push(r.name + ' | ' + r.w + 'x' + r.h + ' | ' + r.mb.toFixed(1) + ' | ' + Math.round(r.read) + ' | ' + Math.round(r.decode) + ' | ' + Math.round(r.pixels) + ' | ' + Math.round(r.find) + ' | ' + Math.round(r.draw) + ' | ' + Math.round(r.read + r.decode + r.pixels + r.find + r.draw));
    });
    if (res.types) {
      L.push(''); L.push('Alignment types on the first pair that worked: type | find ms | draw ms');
      res.types.forEach(function (t) { L.push(typeName(t.mode) + ' | ' + (t.ok ? Math.round(t.find) + ' | ' + Math.round(t.draw) : 'FAILED: ' + t.err)); });
    }
    if (st.n) {
      L.push(''); L.push('Mean per pair ' + Math.round(st.mean) + ' ms (median ' + Math.round(st.median) + ', min ' + Math.round(st.min) + ', max ' + Math.round(st.max) + '); mean open ' + Math.round(st.open) + ', find ' + Math.round(st.find) + ', draw ' + Math.round(st.draw) + '; longest freeze ' + Math.round(st.maxFreeze) + ' ms');
      var e = estimates(res, st);
      L.push('Whole project against the first copy: ' + num(e.pairs) + ' pairs, ' + dur(e.ref) + '. Every copy against every other: ' + num(p.pairsAll) + ' pairs, ' + dur(e.all) + '.');
    }
    if (res.stopped) L.push('(stopped early)');
    return L.join('\n');
  }

  /* ---------------------------------------------------------------- dialog */
  function dlgFrame(sc) { var d = sc.querySelector('.ws-dlg'); d.style.width = 'min(780px, 100%)'; return d; }
  function tableHtml(res) {
    var h = '<table class="sp-tbl"><thead><tr><th>Copy</th><th>Picture size</th><th>Opening the scan</th><th>Finding the alignment</th><th>Drawing the result</th><th>Total</th></tr></thead><tbody>';
    res.copies.forEach(function (r) { h += rowHtml(r); });
    return h + '</tbody></table>';
  }
  function rowHtml(r) {
    if (!r.ok) return '<tr class="bad" data-copy><td>' + esc(r.name) + '</td><td colspan="5">' + esc(r.err || 'not measured') + '</td></tr>';
    return '<tr data-copy><td>' + esc(r.name) + '</td><td>' + mp(r.w, r.h) + '</td><td>' + s1(r.read + r.decode + r.pixels) + '</td><td>' + s1(r.find) + '</td><td>' + s1(r.draw) + '</td><td><b>' + s1(r.read + r.decode + r.pixels + r.find + r.draw) + '</b></td></tr>';
  }
  function typesHtml(res) {
    if (!res.types) return '';
    var h = '<h4>The three alignment types on one page pair</h4><table class="sp-tbl"><thead><tr><th>Type</th><th>Finding the alignment</th><th>Drawing the result</th></tr></thead><tbody>';
    res.types.forEach(function (t) { h += t.ok ? '<tr><td>' + typeName(t.mode) + '</td><td>' + s1(t.find) + '</td><td>' + s1(t.draw) + '</td></tr>' : '<tr class="bad"><td>' + typeName(t.mode) + '</td><td colspan="2">' + esc(t.err) + '</td></tr>'; });
    return h + '</tbody></table>';
  }

  function showResult(sc, res) {
    var st = stats(res), text = reportText(res, st), d = dlgFrame(sc), h;
    window.SpeedTest.last = { result: res, stats: st, text: text };
    h = '<h3>Speed test: result</h3>';
    if (res.fatal) {
      h += '<p class="err" style="min-height:0">' + esc(res.fatal) + '</p><p class="note">Nothing was measured. The scan of the first copy has to open for the test to work. Pick another copy as copy 1 (Pages view) and try again.</p>';
    } else {
      h += '<p class="note">Computer: ' + esc(machine()) + '. Alignment type: ' + typeName(res.mode) + '. Page tested: ' + esc(res.plan.rowLabel) + ', first copy: ' + esc(res.plan.ref.name) + (res.stopped ? '. <b>Stopped early.</b>' : '.') + '</p>';
      plainSummary(res, st).forEach(function (t) { h += '<p>' + t + '</p>'; });
      if (!st.n) h += '<p class="err" style="min-height:0">No pair could be measured.</p>';
      h += '<div class="sp-scroll">' + tableHtml(res) + '</div>' + typesHtml(res);
      if (st.failed) h += '<p class="note">' + st.failed + ' of ' + res.copies.length + ' copies could not be measured; see the red lines. Large scans are the usual reason.</p>';
      h += '<p class="note">This measures the alignment types Book Compare has today. A finer, tile-based alignment is not built into the app yet, so its speed is not part of these numbers. Times will be a little different each run.</p>';
      h += '<details><summary>Show the numbers as plain text</summary><textarea class="sp-text" readonly rows="10"></textarea></details>';
    }
    h += '<div class="acts"><button class="ws-tb" id="sp-copy"' + (res.fatal ? ' disabled' : '') + '>Copy the result</button><button class="ws-tb" id="sp-again">Run again</button><button class="ws-tb primary" data-close>Close</button></div><div class="note" id="sp-msg" role="status"></div>';
    d.innerHTML = h;
    var ta = d.querySelector('.sp-text'); if (ta) ta.value = text;
    d.querySelector('#sp-again').onclick = function () { open(); };
    d.querySelector('#sp-copy').onclick = async function () {
      var msg = d.querySelector('#sp-msg');
      try { await navigator.clipboard.writeText(text); msg.textContent = 'Copied. You can paste it into the chat now.'; }
      catch (e) {
        var det = d.querySelector('details'); if (det) det.open = true;
        if (ta) { ta.focus(); ta.select(); }
        msg.textContent = 'The browser did not allow copying. The text is selected below: press Ctrl+C.';
      }
    };
  }

  async function start(sc, plan, withTypes) {
    busy = true;
    var d = dlgFrame(sc), stopped = false, mode = (window.CompareTab && CompareTab.transform && CompareTab.transform()) || 'perspective';
    d.innerHTML = '<h3>Speed test is running …</h3><p id="sp-st">Starting …</p><progress id="sp-pr" max="1" value="0" style="width:100%"></progress>' +
      '<div class="sp-scroll"><table class="sp-tbl"><thead><tr><th>Copy</th><th>Picture size</th><th>Opening the scan</th><th>Finding the alignment</th><th>Drawing the result</th><th>Total</th></tr></thead><tbody id="sp-rows"></tbody></table></div>' +
      '<p class="note">The page freezes for a moment at each alignment. That is normal and part of what is measured. Nothing is saved and no scan is changed.</p>' +
      '<div class="acts"><button class="ws-tb" id="sp-stop">Stop</button></div>';
    d.querySelector('#sp-stop').onclick = function () { stopped = true; this.disabled = true; this.textContent = 'Stopping …'; };
    var ui = {
      stopped: function () { return stopped || !sc.isConnected; },
      status: function (t, f) { var a = d.querySelector('#sp-st'), b = d.querySelector('#sp-pr'); if (a) a.textContent = t; if (b) b.value = f; },
      line: function (r) { var b = d.querySelector('#sp-rows'); if (b) b.insertAdjacentHTML('beforeend', rowHtml(r)); }
    };
    var res;
    try { res = await runTest(plan, mode, withTypes, ui); }
    catch (e) { res = { when: new Date(), plan: plan, mode: mode, ref: { name: plan.ref.name }, copies: [], fatal: 'The test stopped because of an unexpected problem: ' + ((e && e.message) || e) }; }
    busy = false;
    if (!sc.isConnected) { window.SpeedTest.last = { result: res, stats: stats(res), text: reportText(res, stats(res)) }; return; }   // the window was closed meanwhile
    showResult(sc, res);
  }

  function open() {
    var api = W();
    if (busy) return;
    if (!api || !E) return;
    var plan = api.speedPlan(), sc, d, h;
    sc = api.modal('<h3>Measure speed on this computer</h3>');
    d = dlgFrame(sc);
    if (!plan.ok) {
      d.innerHTML = '<h3>Measure speed on this computer</h3><p>' + esc(plan.msg) + '</p><div class="acts"><button class="ws-tb primary" data-close>Close</button></div>';
      return;
    }
    var mode = (window.CompareTab && CompareTab.transform && CompareTab.transform()) || 'perspective';
    var n = Math.min(plan.items.length, MAX_COPIES);
    h = '<h3>Measure speed on this computer</h3>' +
      '<p>Book Compare will align page <b>' + esc(plan.rowLabel) + '</b> of ' + n + ' other cop' + (n === 1 ? 'y' : 'ies') + ' with the same page of <b>' + esc(plan.ref.name) + '</b> (copy 1), one after the other, and time every step: opening the scan, finding the alignment, drawing the result.</p>' +
      '<p class="note">It takes about ' + (n <= 3 ? 'half a minute' : n <= 6 ? 'a minute' : 'one to two minutes') + ', and the page freezes for a moment at each alignment. It only reads your scans. Nothing is saved and nothing is changed. Alignment type: <b>' + typeName(mode) + '</b> (the one chosen in the Compare tab).</p>' +
      '<label class="chk"><input type="checkbox" id="sp-types"> Also try the three alignment types on one pair (about 30 seconds more; the thin plate spline is slow)</label>';
    if (plan.locked.length) h += '<p class="err" style="min-height:0">The browser still blocks the scan folder' + (plan.locked.length > 1 ? 's' : '') + ' ' + plan.locked.map(function (x) { return '“' + esc(x) + '”'; }).join(', ') + '. Close this window, click <b>Allow access to scans</b> at the top, and start again.</p>';
    h += '<div class="acts"><button class="ws-tb" data-close>Cancel</button><button class="ws-tb primary" id="sp-go"' + (plan.locked.length ? ' disabled' : '') + '>Start the test</button></div>';
    d.innerHTML = h;
    d.querySelector('#sp-go').onclick = function () { start(sc, plan, d.querySelector('#sp-types').checked); };
  }

  window.SpeedTest = {
    init: function (parts) { E = parts; },
    open: open,
    last: null
  };
})();
