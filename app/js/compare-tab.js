/* Book Compare - the Compare tab (first version).

   Shown after COMPARE in the whole-book workspace. It reuses the result screen of the two-image app (superimposed picture on the
   left, copy 1 and copy 2 on the right) and adds what is needed to go through a whole book:
   - a left panel with the two copies (menus, swap button) and the list of pages, with a search box
   - the tabs COMPARE | PAGES at the top (PAGES = back to the grid of copies and pages)
   - a bar with "previous page / next page" above the teal bar, and the keys  ← →  (page),  ↑ ↓  (copy 2),  Shift + ↑ ↓  (copy 1)
   - the two pages are aligned automatically whenever the page or a copy changes (a moment after the last key press)

   It never reads or writes a scan file itself: the workspace (js/workspace.js) hands it two pictures through BookWorkspace.tab,
   and the usual alignment code of the app (js/viz.js) does the work. The two-image screens that start from the first page of the
   app are not changed by this file. */
(function () {
  'use strict';

  var E = null;                         // pieces of the base app: { compare, result, action_bar, go_to_screen }
  var ui = null;                        // our own elements
  var st = {
    on: false, token: 0, timer: 0, skip: true, q: '', side: true, transform: 'perspective',
    shown: null,                        // which pair and row the pictures on screen belong to
    stale: false
  };
  var TRANSFORMS = [['perspective', 'Perspective'], ['affine', 'Affine'], ['tps', 'Thin Plate Spline']];

  function W() { return window.BookWorkspace.tab; }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function esc(t) { return String(t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function frames(n) { return new Promise(function (res) { (function f(k) { if (k <= 0) res(); else requestAnimationFrame(function () { f(k - 1); }); })(n); }); }
  function key(s) { return s.pair.join('|') + '#' + s.row + '#' + st.transform; }

  /* ---------------------------------------------------------------- building the pieces */
  function build() {
    var rc = document.querySelector('div.result_container');
    var footer = E.compare.footer;

    ui = {};
    ui.top = el('div', 'ct-top');
    ui.top.innerHTML =
      '<button class="ct-iconbtn" id="ct_sidebtn" title="Show or hide the left panel" aria-label="Show or hide the left panel">&#9776;</button>' +
      '<div class="ct-brand">Book Compare</div><div class="ct-proj" id="ct_proj"></div><div class="ct-sp"></div>' +
      '<div class="ct-tabs" role="tablist"><button class="ct-tab" role="tab" aria-selected="true" id="ct_tab_compare">Compare</button>' +
      '<button class="ct-tab" role="tab" aria-selected="false" id="ct_tab_pages">Pages</button></div>';

    ui.side = el('aside', 'ct-side');
    ui.side.innerHTML =
      '<div class="ct-copies">' +
      '<div class="ct-copy c1"><span class="ct-lab">Copy 1</span><select id="ct_c1" aria-label="Copy 1"></select><span class="ct-n" id="ct_n1"></span></div>' +
      '<button class="ct-swap" id="ct_swap" title="Swap copy 1 and copy 2" aria-label="Swap copy 1 and copy 2">&#8645;</button>' +
      '<div class="ct-copy c2"><span class="ct-lab">Copy 2</span><div class="ct-row"><select id="ct_c2" aria-label="Copy 2"></select>' +
      '<button class="ct-step" id="ct_c2up" title="Previous copy as copy 2 (↑)" aria-label="Previous copy">&#9650;</button>' +
      '<button class="ct-step" id="ct_c2dn" title="Next copy as copy 2 (↓)" aria-label="Next copy">&#9660;</button></div><span class="ct-n" id="ct_n2"></span></div>' +
      '</div>' +
      '<label class="ct-align"><span>Alignment</span><select id="ct_tf" title="How the second page is bent onto the first. Perspective is a good start.">' +
      TRANSFORMS.map(function (t) { return '<option value="' + t[0] + '">' + t[1] + '</option>'; }).join('') + '</select></label>' +
      '<div class="ct-listhead"><h3>Pages</h3></div>' +
      '<label class="ct-search"><input id="ct_q" type="search" placeholder="Find page, e.g. 4r or Index" autocomplete="off"></label>' +
      '<ul class="ct-list" id="ct_list" role="listbox" aria-label="Pages"></ul>' +
      '<label class="ct-foot"><input type="checkbox" id="ct_skip" checked><span>Skip pages that one of the two copies lacks</span></label>' +
      '<div class="ct-keys"><kbd>←</kbd> <kbd>→</kbd> page · <kbd>↑</kbd> <kbd>↓</kbd> copy 2 · <kbd>Shift</kbd>+<kbd>↑</kbd> <kbd>↓</kbd> copy 1</div>';

    ui.busy = el('div', 'ct-busy');
    ui.busy.hidden = true;
    ui.busy.innerHTML = '<div class="ct-busybox"><div class="ct-spin" id="ct_spin"></div><p id="ct_busytxt"></p><div class="ct-busyacts" id="ct_busyacts"></div></div>';

    ui.bar = el('div', 'ct-pagebar');
    ui.bar.innerHTML =
      '<button class="ct-nav" id="ct_prev" title="Previous page (←)"><span>&#8249;</span> Page</button>' +
      '<div class="ct-where" id="ct_where" aria-live="polite"></div>' +
      '<button class="ct-nav" id="ct_next" title="Next page (→)">Page <span>&#8250;</span></button>' +
      '<div class="ct-note" id="ct_note"></div>';

    rc.appendChild(ui.top); rc.appendChild(ui.side); rc.appendChild(ui.busy);
    footer.insertBefore(ui.bar, footer.querySelector('.bar'));
    ui.rc = rc;
    [ui.top, ui.side, ui.bar].forEach(function (e) { e.hidden = true; });

    var $ = function (id) { return document.getElementById(id); };
    ui.c1 = $('ct_c1'); ui.c2 = $('ct_c2'); ui.list = $('ct_list'); ui.q = $('ct_q'); ui.where = $('ct_where'); ui.note = $('ct_note');
    ui.tf = $('ct_tf'); ui.skip = $('ct_skip');

    $('ct_sidebtn').onclick = function () { st.side = !st.side; layout(); };
    $('ct_tab_pages').onclick = toPages;
    $('ct_swap').onclick = function () { W().swap(); afterCopies(); };
    ui.c1.onchange = function () { W().setCopy(0, ui.c1.value); afterCopies(); };
    ui.c2.onchange = function () { W().setCopy(1, ui.c2.value); afterCopies(); };
    $('ct_c2up').onclick = function () { stepCopy(1, -1); };
    $('ct_c2dn').onclick = function () { stepCopy(1, 1); };
    ui.tf.onchange = function () { st.transform = ui.tf.value; E.compare.current_transform = st.transform; markStale(); schedule(80); };
    ui.skip.onchange = function () { st.skip = ui.skip.checked; };
    ui.q.oninput = function () { st.q = ui.q.value.trim().toLowerCase(); renderList(); };
    $('ct_prev').onclick = function () { stepPage(-1); };
    $('ct_next').onclick = function () { stepPage(1); };
    ui.list.addEventListener('click', function (e) {
      var li = e.target.closest('li[data-i]');
      if (li) goRow(+li.dataset.i);
    });
    document.addEventListener('keydown', onKey);
  }

  /* ---------------------------------------------------------------- showing the pieces */
  function layout() {
    ui.rc.classList.toggle('ct-on', st.on);
    ui.rc.classList.toggle('ct-noside', st.on && !st.side);
    ui.top.hidden = !st.on; ui.side.hidden = !st.on || !st.side; ui.bar.hidden = !st.on;
    document.body.classList.toggle('ct-active', st.on);
  }
  function renderCopies(s) {
    var opts = s.copies.map(function (c) { return '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>'; }).join('');
    ui.c1.innerHTML = opts; ui.c2.innerHTML = opts;
    ui.c1.value = s.pair[0]; ui.c2.value = s.pair[1];
    var byId = {}; s.copies.forEach(function (c) { byId[c.id] = c; });
    document.getElementById('ct_n1').textContent = byId[s.pair[0]] ? byId[s.pair[0]].pages + ' of ' + s.rows + ' pages' : '';
    document.getElementById('ct_n2').textContent = byId[s.pair[1]] ? byId[s.pair[1]].pages + ' of ' + s.rows + ' pages' : '';
  }
  function renderList() {
    var s = W().state(), html = [];
    for (var i = 0; i < s.rows; i++) {
      var r = W().rowInfo(i);
      if (st.q && r.label.toLowerCase().indexOf(st.q) < 0) continue;
      var cls = (i === s.row ? 'cur ' : '') + (r.skip ? 'skip ' : '') + (!r.skip && !(r.a && r.b) ? 'miss' : '');
      var tip = r.skip ? 'Not compared' : (!r.a || !r.b) ? 'One of the two copies has no page here' : '';
      html.push('<li data-i="' + i + '" role="option" class="' + cls + '"' + (tip ? ' title="' + tip + '"' : '') + (i === s.row ? ' aria-selected="true"' : '') + '><i class="dot"></i><span class="l">' + esc(r.label) + '</span><span class="n">' + (i + 1) + '</span></li>');
    }
    ui.list.innerHTML = html.join('') || '<li class="none">No page found.</li>';
    scrollToCurrent();
  }
  function scrollToCurrent() { var c = ui.list.querySelector('li.cur'); if (c && c.scrollIntoView) c.scrollIntoView({ block: 'nearest' }); }
  function markCurrent() {
    var s = W().state();
    var old = ui.list.querySelector('li.cur'); if (old) { old.classList.remove('cur'); old.removeAttribute('aria-selected'); }
    var nw = ui.list.querySelector('li[data-i="' + s.row + '"]'); if (nw) { nw.classList.add('cur'); nw.setAttribute('aria-selected', 'true'); }
    scrollToCurrent();
  }
  function renderBar(s) {
    s = s || W().state();
    var r = W().rowInfo(s.row);
    ui.where.innerHTML = '<b>' + esc(r.label) + '</b><span>position ' + (s.row + 1) + ' of ' + s.rows + '</span>';
    document.getElementById('ct_proj').textContent = s.name ? s.name : '';
  }
  function render() {
    var s = W().state();
    renderCopies(s); renderList(); renderBar(s); layout();
    ui.tf.value = st.transform;
  }
  function note(msg) { ui.note.textContent = msg || ''; clearTimeout(note.t); if (msg) note.t = setTimeout(function () { ui.note.textContent = ''; }, 3500); }
  function setBusy(msg, bad, acts) {
    ui.busy.hidden = !msg;
    document.getElementById('ct_busytxt').textContent = msg || '';
    document.getElementById('ct_spin').hidden = !!bad;
    ui.busy.classList.toggle('bad', !!bad);
    var a = document.getElementById('ct_busyacts'); a.innerHTML = '';
    (acts || []).forEach(function (x) { var b = el('button', 'ct-btn', esc(x[0])); b.onclick = x[1]; a.appendChild(b); });
  }
  function markStale() { st.stale = true; ui.rc.classList.add('ct-stale'); if (ui.busy.classList.contains('bad')) setBusy(null); }   // a new wish makes an old message obsolete
  function clearStale() { st.stale = false; ui.rc.classList.remove('ct-stale'); }

  /* ---------------------------------------------------------------- moving around */
  function comparable(i) { var r = W().rowInfo(i); return r.a && r.b && !r.skip; }
  function goRow(i) {
    var s = W().state();
    if (i === s.row && !st.stale) return;
    W().setRow(i); markCurrent(); renderBar(); markStale(); schedule(350);
  }
  function stepPage(dir) {
    var s = W().state(), i = s.row + dir;
    while (i >= 0 && i < s.rows && st.skip && !comparable(i)) i += dir;
    if (i < 0 || i >= s.rows) return note(dir > 0 ? 'This is the last page to compare.' : 'This is the first page to compare.');
    goRow(i);
  }
  function afterCopies() { var s = W().state(); renderCopies(s); renderList(); markStale(); schedule(350); }
  function stepCopy(slot, dir) {
    var s = W().state(), n = s.copies.length; if (n < 2) return;
    var other = s.pair[1 - slot], idx = -1;
    s.copies.forEach(function (c, i) { if (c.id === s.pair[slot]) idx = i; });
    for (var k = 1; k <= n; k++) {
      var c = s.copies[(idx + dir * k + n * k) % n];
      if (c.id !== other) { W().setCopy(slot, c.id); break; }
    }
    afterCopies();
  }
  function onKey(e) {
    if (!st.on || e.ctrlKey || e.metaKey || e.altKey) return;
    var ws = document.getElementById('ws'); if (ws && !ws.hidden) return;                    // the Pages view is on top
    if (document.querySelector('.mdc-dialog--open')) return;
    var t = e.target, tag = t && t.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || (t && t.isContentEditable)) return;
    if (e.key === 'ArrowRight') stepPage(1);
    else if (e.key === 'ArrowLeft') stepPage(-1);
    else if (e.key === 'ArrowDown') stepCopy(e.shiftKey ? 0 : 1, 1);
    else if (e.key === 'ArrowUp') stepCopy(e.shiftKey ? 0 : 1, -1);
    else return;
    e.preventDefault();
  }

  /* ---------------------------------------------------------------- aligning */
  function schedule(ms) { clearTimeout(st.timer); st.timer = setTimeout(align, ms); }
  async function align(first) {
    var my = ++st.token, s = W().state();
    if (!s.pair[0] || !s.pair[1]) { setBusy('Choose two copies to compare.', true); return; }
    markStale();
    setBusy('Loading the two pages …');
    var d = first && first.urls ? first : null;
    try { if (!d) d = await W().loadPair(); }
    catch (e) { if (my === st.token) setBusy(e && e.message ? e.message : String(e), true, [['Go to the pages', toPages]]); return; }
    if (my !== st.token) return;
    setBusy('Aligning the two pages … this can take a few seconds.');
    await frames(2);
    if (my !== st.token) return;
    var done = false;
    try { done = await E.compare.align_images(d.urls, d.names, st.transform, function () { return my === st.token; }); }
    catch (e) {
      if (my === st.token) setBusy('Book Compare could not align these two pages (' + ((e && e.message) || e) + '). Try another alignment (left panel) or another page.', true,
        [['Try Affine', function () { ui.tf.value = 'affine'; ui.tf.onchange(); }], ['Go to the pages', toPages]]);
      return;
    }
    if (!done || my !== st.token) return;
    st.shown = key(s);
    E.compare.back_btn.onclick = toPages;                                                    // "Back" in the teal bar returns to the pages
    labelPanels(s);
    clearStale(); setBusy(null);
  }
  // the panels say which copy and page they show (the file names stay the names of the exported files)
  function labelPanels(s) {
    var r = W().rowInfo(s.row), byId = {}; s.copies.forEach(function (c) { byId[c.id] = c; });
    var labs = document.querySelectorAll('#workspace .pane__label');
    labs.forEach(function (l) {
      var t = l.textContent || '';
      var i = t.indexOf('Copy 1') === 0 ? 0 : t.indexOf('Copy 2') === 0 ? 1 : -1;
      if (i < 0 || !byId[s.pair[i]]) return;
      l.textContent = (i ? 'Copy 2, aligned' : 'Copy 1') + ' · ' + byId[s.pair[i]].name + ' · ' + r.label;
    });
  }

  /* ---------------------------------------------------------------- entering and leaving */
  function enter(first) {
    var s = W().state();
    if (!st.on && !st.everShown) { E.compare.prepare_for_tab(); st.everShown = true; }
    st.on = true;
    render();
    E.go_to_screen(E.compare.cc, { inline: 'end', behavior: 'auto' });
    if (st.shown === key(s)) {                                                               // nothing changed since the pictures on screen
      if (first && first.urls) first.urls.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) { /* ignore */ } });
      clearStale(); setBusy(null); return;
    }
    markStale();
    st.token++;
    clearTimeout(st.timer);
    st.timer = setTimeout(function () { align(first); }, 30);
  }
  function toPages() {
    st.token++; clearTimeout(st.timer); setBusy(null);
    st.on = false; layout();
    W().showPages();
  }

  window.CompareTab = {
    init: function (parts) { E = parts; build(); },
    enter: enter,
    leave: toPages,
    isOpen: function () { return st.on; }
  };
})();
