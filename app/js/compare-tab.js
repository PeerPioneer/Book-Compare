/* Book Compare - the Compare tab (first version).

   Shown after COMPARE in the whole-book workspace. It reuses the result screen of the two-image app (superimposed picture on the
   left, copy 1 and copy 2 on the right) and adds what is needed to go through a whole book:
   - a left panel with the two copies (menus, swap button) and the list of pages, with a search box
   - the tabs COMPARE | PAGES at the top (PAGES = back to the grid of copies and pages)
   - ONE bar at the bottom (the teal bar): previous page / where you are / next page and the flag button on the left, the view switcher
     (Difference, Toggle, ...) in the middle, "Linked" and "More" as small symbols on the right. The keys are  Page Up / Page Down  (page),
     1 to 6 (view) and F (flag); the arrow keys are NOT used: they move the picture inside the panel, as they always did
   - the two pages are aligned automatically whenever the page or a copy changes (a moment after the last key press)
   - flags: a colour mark on a page (button "Flag page" or the key F; six colours); flagged pages show in the page list, which can be
     filtered to the flagged ones, and in the book map. Flags belong to the page of the book, not to a pair of copies, and are saved in the project.
   - annotations (circle, rectangle, text note with a comment, in the six flag colours) on the superimposed picture: see js/compare-annot.js
   - focus mode (button at the top right, Esc leaves it): everything except the pictures is hidden; the keys keep working and a short
     message at the bottom says which page you are on and what a key did (short messages always appear at the bottom of the pictures)
   - the book map: a thin strip at the bottom edge that opens when the pointer comes near; one tick per page of the book (grey = a copy lacks
     the page, colour = flag), a mark for the page on screen, a click jumps there, and a small picture of the page appears while you hover.

   It never reads or writes a scan file itself: the workspace (js/workspace.js) hands it two pictures through BookWorkspace.tab.
   The alignment (V3, 20 Nov 2026): by default Book Compare's own tile alignment (printed area, rough step, tiles, items in the margin), which runs
   in a background helper (js/align-engine.js + js/align-worker.js) and sends back copy 2 already bent onto copy 1, in colour and at full size;
   the three older types (Perspective, Affine, Thin Plate Spline) remain in the menu and use the usual alignment code of the app (js/viz.js). The two-image screens that start from the first page of the
   app are not changed by this file. */
(function () {
  'use strict';

  var E = null;                         // pieces of the base app: { compare, result, action_bar, go_to_screen }
  var ui = null;                        // our own elements
  var st = {
    on: false, token: 0, timer: 0, skip: true, q: '', side: true, transform: (window.AlignEngine && AlignEngine.supported()) ? 'tiles' : 'perspective',
    shown: null,                        // which pair and row the pictures on screen belong to
    stale: false,
    focus: false,                       // focus mode: only the pictures are shown
    shownRow: null, shownPair: null,    // the row and the two copies of the picture on screen (annotations belong to this row)
    filter: 'all', fcol: null,          // page list: all pages / flagged pages, and one flag colour only
    pin: false                          // the book map stays open
  };
  var TRANSFORMS = [['perspective', 'Perspective (older)'], ['affine', 'Affine (older)'], ['tps', 'Thin Plate Spline (older)']];
  if (window.AlignEngine && AlignEngine.supported()) TRANSFORMS.unshift(['tiles', 'Tiles (recommended)']);

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
      '<button class="ct-tab" role="tab" aria-selected="false" id="ct_tab_pages">Pages</button></div>' +
      '<button class="ct-iconbtn" id="ct_focusbtn" title="Focus mode: hide everything except the pictures (Esc leaves it)" aria-label="Focus mode: hide everything except the pictures">' +
      '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M21 11V3h-8l3.29 3.29-10 10L3 13v8h8l-3.29-3.29 10-10z"/></svg></button>';

    ui.side = el('aside', 'ct-side');
    ui.side.innerHTML =
      '<div class="ct-copies">' +
      '<div class="ct-copy c1"><span class="ct-lab">Copy 1</span><select id="ct_c1" aria-label="Copy 1"></select><span class="ct-n" id="ct_n1"></span></div>' +
      '<button class="ct-swap" id="ct_swap" title="Swap copy 1 and copy 2" aria-label="Swap copy 1 and copy 2">&#8645;</button>' +
      '<div class="ct-copy c2"><span class="ct-lab">Copy 2</span><div class="ct-row"><select id="ct_c2" aria-label="Copy 2"></select>' +
      '<button class="ct-step" id="ct_c2up" title="Previous copy as copy 2" aria-label="Previous copy">&#9650;</button>' +
      '<button class="ct-step" id="ct_c2dn" title="Next copy as copy 2" aria-label="Next copy">&#9660;</button></div><span class="ct-n" id="ct_n2"></span></div>' +
      '</div>' +
      '<label class="ct-align"><span>Alignment</span><select id="ct_tf" title="How the second page is bent onto the first. Tiles is the alignment made for printed pages (best in most cases); the older types bend the whole page at once.">' +
      TRANSFORMS.map(function (t) { return '<option value="' + t[0] + '">' + t[1] + '</option>'; }).join('') + '</select></label>' +
      '<div class="ct-listhead"><h3>Pages</h3></div>' +
      '<div class="ct-filters" id="ct_filters"></div><div class="ct-fcols" id="ct_fcols" hidden></div>' +
      '<label class="ct-search"><input id="ct_q" type="search" placeholder="Find page, e.g. 4r or Index" autocomplete="off"></label>' +
      '<ul class="ct-list" id="ct_list" role="listbox" aria-label="Pages"></ul>' +
      '<label class="ct-foot"><input type="checkbox" id="ct_skip" checked><span>Skip pages that one of the two copies lacks</span></label>' +
      '<div class="ct-keys"><kbd>Page Up</kbd> <kbd>Page Down</kbd> page<br><kbd>1</kbd>–<kbd>6</kbd> view · <kbd>F</kbd> flag<br>Arrow keys move the picture (click it first)</div>';

    ui.busy = el('div', 'ct-busy');
    ui.busy.hidden = true;
    ui.busy.innerHTML = '<div class="ct-busybox"><div class="ct-spin" id="ct_spin"></div><p id="ct_busytxt"></p><div class="ct-busyacts" id="ct_busyacts"></div></div>';

    // the left part of the ONE bar at the bottom: page turning and the flag
    ui.bar = el('div', 'ct-barleft');
    ui.bar.innerHTML =
      '<button class="ct-bb" id="ct_prev" title="Previous page (Page Up)" aria-label="Previous page"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg></button>' +
      '<div class="ct-where" id="ct_where" aria-live="polite"></div>' +
      '<button class="ct-bb" id="ct_next" title="Next page (Page Down)" aria-label="Next page"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg></button>' +
      '<span class="ct-flagwrap"><button class="ct-bb ct-flagbtn" id="ct_flag" aria-pressed="false" aria-haspopup="true" aria-label="Flag page" title="Flag this page (F). Click again to change the colour."><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path id="ct_flagpath" fill="currentColor"></path></svg></button>' +
      '<div class="ct-flagpal" id="ct_flagpal" role="group" aria-label="Flag colour" hidden></div></span>';

    // the middle part: the view switcher. Only the name of the view on screen is shown (with one dot for each of the six views);
    // the six names unfold when the pointer rests on it (or when it is clicked or tapped), a click on a name switches.
    ui.view = el('div', 'ct-view');
    ui.view.innerHTML =
      '<button class="ct-vpill" id="ct_vpill" aria-haspopup="true" aria-expanded="false" title="Change the view (keys 1 to 6)"><span id="ct_vlab">Difference</span><span class="ct-vdots" id="ct_vdots" aria-hidden="true"></span></button>' +
      '<div class="ct-vpop" id="ct_vpop" role="menu" aria-label="Views" hidden></div>';

    ui.map = el('div', 'ct-map'); ui.map.id = 'ct_map';
    ui.map.hidden = true;
    ui.map.innerHTML =
      '<div class="ct-map-in"><span class="ct-map-l">Book map</span>' +
      '<svg id="ct_mapsvg" viewBox="0 0 100 12" preserveAspectRatio="none" role="img" aria-label="Map of the whole book. Click to jump to a page."></svg>' +
      '<span class="ct-map-leg" id="ct_mapleg"></span>' +
      '<button class="ct-pin" id="ct_pin" aria-pressed="false" aria-label="Keep the book map open" title="Keep the book map open"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M16 9V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z"/></svg></button></div>' +
      '<div class="ct-map-hov" id="ct_maphov"></div><div class="ct-tip" id="ct_tip" hidden></div>';

    ui.leave = el('button', 'ct-leave', 'Leave focus mode'); ui.leave.hidden = true; ui.leave.title = 'Bring back the panel, tabs and bars (Esc)';
    ui.toast = el('div', 'ct-toast'); ui.toast.hidden = true; ui.toast.setAttribute('role', 'status');
    rc.appendChild(ui.top); rc.appendChild(ui.side); rc.appendChild(ui.busy); rc.appendChild(ui.leave); rc.appendChild(ui.toast);
    var tealbar = footer.querySelector('.bar');                                             // the dark teal bar: the only bar below the pictures
    tealbar.insertBefore(ui.bar, tealbar.firstChild);
    tealbar.insertBefore(ui.view, tealbar.querySelector('.bar_right'));
    footer.insertBefore(ui.map, tealbar);
    ui.tealbar = tealbar;
    ui.rc = rc;
    [ui.top, ui.side, ui.bar, ui.view].forEach(function (e) { e.hidden = true; });

    var $ = function (id) { return document.getElementById(id); };
    ui.c1 = $('ct_c1'); ui.c2 = $('ct_c2'); ui.list = $('ct_list'); ui.q = $('ct_q'); ui.where = $('ct_where');
    ui.vpill = $('ct_vpill'); ui.vpop = $('ct_vpop'); ui.vlab = $('ct_vlab'); ui.vdots = $('ct_vdots');
    ui.tf = $('ct_tf'); ui.skip = $('ct_skip');
    ui.filters = $('ct_filters'); ui.fcols = $('ct_fcols'); ui.flag = $('ct_flag'); ui.pal = $('ct_flagpal');
    ui.svg = $('ct_mapsvg'); ui.tip = $('ct_tip'); ui.hov = $('ct_maphov'); ui.pin = $('ct_pin');
    ui.flagpath = $('ct_flagpath'); ui.flagpath.setAttribute('d', W().flagPath);
    try { st.pin = localStorage.getItem('bc-map-pinned') === '1'; } catch (e) { /* no browser storage: not remembered */ }
    if (window.CompareAnnot) CompareAnnot.init({
      W: W, say: function (t) { note(t); }, changed: function () { renderList(); },
      shown: function () { return st.shownRow == null ? null : { row: st.shownRow, pair: st.shownPair }; },
      stale: function () { return st.stale; }
    });

    $('ct_sidebtn').onclick = function () { st.side = !st.side; layout(); };
    $('ct_focusbtn').onclick = function () { setFocus(true); };
    ui.leave.onclick = function () { setFocus(false); };
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
    ui.filters.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-f]'); if (!b) return;
      st.filter = b.dataset.f; if (st.filter === 'all') st.fcol = null;
      renderList();
    });
    ui.fcols.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-c]'); if (!b) return;
      st.fcol = st.fcol === +b.dataset.c ? null : +b.dataset.c;
      renderList();
    });
    ui.flag.onclick = function () {
      var s = W().state();
      if (W().rowInfo(s.row).flag == null) { setFlag(s.row, 0); closePalette(); }
      else if (ui.pal.hidden) openPalette(); else closePalette();
    };
    ui.pal.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      var s = W().state();
      if (b.dataset.rm) setFlag(s.row, null); else setFlag(s.row, +b.dataset.c);
      closePalette();
    });
    document.addEventListener('click', function (e) {
      if (!ui.pal.hidden && !e.target.closest('.ct-flagwrap')) closePalette();
      if (!e.target.closest('.ct-map')) ui.map.classList.remove('open');                  // (opened by a tap on a touch screen)
      if (!e.target.closest('.ct-view')) closeView();
    });
    wireViews();
    ui.svg.addEventListener('pointermove', function (e) { if (e.pointerType === 'mouse' || e.pointerType === 'pen') showTip(e); });
    ui.svg.addEventListener('pointerleave', hideTip);
    ui.svg.addEventListener('click', function (e) {
      var closed = ui.map.querySelector('.ct-map-in').offsetHeight < 20;                  // touch screens have no pointer to open the map: the first tap opens it
      if (closed && !st.pin && !ui.map.classList.contains('open')) { ui.map.classList.add('open'); return; }
      goRow(nearestRow(mapRow(e)));
    });
    ui.pin.onclick = function () {
      st.pin = !st.pin; ui.map.classList.remove('open'); renderPin();
      try { localStorage.setItem('bc-map-pinned', st.pin ? '1' : '0'); } catch (e) { /* ignore */ }
    };
    if (window.ResizeObserver) new ResizeObserver(function () {                                // a wider or narrower window: draw the map again
      var w = ui.svg.getBoundingClientRect().width;
      if (st.on && w > 0 && Math.abs(w - mapW) >= 1) renderMap();
    }).observe(ui.svg);
    document.addEventListener('keydown', onKey);
  }

  /* ---------------------------------------------------------------- showing the pieces */
  function layout() {
    ui.rc.classList.toggle('ct-on', st.on);
    ui.rc.classList.toggle('ct-noside', st.on && !st.side);
    var f = st.on && st.focus;                                                               // focus mode: only the pictures
    ui.rc.classList.toggle('ct-focus', f); document.body.classList.toggle('ct-focus', f);
    ui.top.hidden = !st.on || f; ui.side.hidden = !st.on || !st.side || f; ui.bar.hidden = !st.on; ui.view.hidden = !st.on; ui.map.hidden = !st.on; ui.leave.hidden = !f;
    if (!st.on) ui.toast.hidden = true;
    ui.map.style.setProperty('--ct-map-left', (st.on && st.side ? 300 : 0) + 'px');           // the opened map does not cover the left panel
    document.body.classList.toggle('ct-active', st.on);
    renderPin();
    if (window.CompareAnnot) CompareAnnot.setActive(st.on);
  }
  function renderCopies(s) {
    var opts = s.copies.map(function (c) { return '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>'; }).join('');
    ui.c1.innerHTML = opts; ui.c2.innerHTML = opts;
    ui.c1.value = s.pair[0]; ui.c2.value = s.pair[1];
    var byId = {}; s.copies.forEach(function (c) { byId[c.id] = c; });
    document.getElementById('ct_n1').textContent = byId[s.pair[0]] ? byId[s.pair[0]].pages + ' of ' + s.rows + ' pages' : '';
    document.getElementById('ct_n2').textContent = byId[s.pair[1]] ? byId[s.pair[1]].pages + ' of ' + s.rows + ' pages' : '';
  }
  function flagSvg(c, n) {
    return '<svg class="ct-fl" viewBox="0 0 24 24" width="' + n + '" height="' + n + '" role="img" aria-label="Flagged (' + W().flagNames[c] + ')" style="color:' + W().flagColors[c] + '"><path fill="currentColor" d="' + W().flagPath + '"/></svg>';
  }
  function renderList() {
    var s = W().state(), html = [], nf = 0, shown = 0, rows = [];
    for (var i = 0; i < s.rows; i++) { var r = W().rowInfo(i); rows.push(r); if (r.flag != null) nf++; }
    if (!nf) { st.filter = 'all'; st.fcol = null; }                                         // nothing flagged: there is nothing to filter
    for (var j = 0; j < s.rows; j++) {
      var r2 = rows[j];
      if (st.filter === 'flag' && (r2.flag == null || (st.fcol != null && r2.flag !== st.fcol))) continue;
      if (st.q && r2.label.toLowerCase().indexOf(st.q) < 0) continue;
      var cls = (j === s.row ? 'cur ' : '') + (r2.skip ? 'skip ' : '') + (!r2.skip && !(r2.a && r2.b) ? 'miss' : '');
      var tip = r2.skip ? 'Not compared' : (!r2.a || !r2.b) ? 'One of the two copies has no page here' : '';
      html.push('<li data-i="' + j + '" role="option" class="' + cls + '"' + (tip ? ' title="' + tip + '"' : '') + (j === s.row ? ' aria-selected="true"' : '') + '><i class="dot"></i><span class="l">' + esc(r2.label) + '</span>' +
        (r2.ann ? '<svg class="ct-an" viewBox="0 0 24 24" width="14" height="14" role="img" aria-label="' + r2.ann + ' annotation' + (r2.ann > 1 ? 's' : '') + '"><title>' + r2.ann + ' annotation' + (r2.ann > 1 ? 's' : '') + '</title><path fill="currentColor" d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.17L4 17.17V4h16v12z"/></svg>' : '') +
        (r2.flag != null ? flagSvg(r2.flag, 14) : '') + '<span class="n">' + (j + 1) + '</span></li>');
      shown++;
    }
    ui.list.innerHTML = html.join('') || '<li class="none">' + (st.filter === 'flag' ? 'No flagged page' + (st.fcol != null ? ' in this colour' : '') + '.' : 'No page found.') + '</li>';
    ui.filters.hidden = !nf;
    ui.filters.innerHTML = nf ? '<button class="ct-chip" data-f="all" aria-pressed="' + (st.filter === 'all') + '">All</button><button class="ct-chip" data-f="flag" aria-pressed="' + (st.filter === 'flag') + '">Flagged ' + nf + '</button>' : '';
    ui.fcols.hidden = !(nf && st.filter === 'flag');
    ui.fcols.innerHTML = W().flagColors.map(function (c, k) {
      return '<button data-c="' + k + '" style="background:' + c + '" aria-pressed="' + (st.fcol === k) + '" title="Show only ' + W().flagNames[k] + ' flags" aria-label="Show only ' + W().flagNames[k] + ' flags"></button>';
    }).join('');
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
    renderFlagBtn(r); moveMarker(s);
  }
  function render() {
    var s = W().state();
    renderCopies(s); renderList(); renderBar(s); renderMap(s); renderView(); layout();
    ui.tf.value = st.transform;
  }

  /* ---------------------------------------------------------------- flags */
  function renderFlagBtn(r) {
    var f = r.flag;
    ui.flag.setAttribute('aria-pressed', f != null ? 'true' : 'false');
    ui.flag.style.setProperty('--ct-flag', f != null ? W().flagColors[f] : 'currentColor');
    ui.flag.title = f != null ? 'Flagged (' + W().flagNames[f] + '). Click to change the colour or remove the flag (F removes it).' : 'Flag this page (F). Click again to change the colour.';
  }
  function setFlag(row, c) {
    var before = W().rowInfo(row).flag;
    W().setFlag(row, c);
    var lbl = W().rowInfo(row).label;
    note(c == null ? 'Flag removed from ' + lbl + '.' : (before == null ? lbl + ' flagged.' : 'Flag colour changed.'));
    renderList(); renderFlagBtn(W().rowInfo(row)); renderMap();
  }
  function toggleFlag() {
    var s = W().state();
    setFlag(s.row, W().rowInfo(s.row).flag == null ? 0 : null);
  }
  function openPalette() {
    var s = W().state(), cur = W().rowInfo(s.row).flag;
    ui.pal.innerHTML = W().flagColors.map(function (c, k) {
      return '<button data-c="' + k + '" style="background:' + c + '" aria-pressed="' + (cur === k) + '" title="' + W().flagNames[k] + '" aria-label="Colour ' + W().flagNames[k] + '"></button>';
    }).join('') + '<button class="rm" data-rm="1">Remove flag</button>';
    ui.pal.hidden = false;
  }
  function closePalette() { if (ui.pal) ui.pal.hidden = true; }

  /* ---------------------------------------------------------------- the book map */
  var tipRow = -1, tipTimer = 0, tipTok = 0;
  function renderPin() {
    ui.map.classList.toggle('pinned', st.pin && st.on);
    ui.pin.setAttribute('aria-pressed', st.pin ? 'true' : 'false');
    var t = st.pin ? 'Let the book map close again' : 'Keep the book map open';
    ui.pin.title = t; ui.pin.setAttribute('aria-label', t);
  }
  // The map is drawn in real pixels (one unit = one pixel across), so ticks keep the same thickness for 20 pages or for 544.
  var mapW = 0;
  function mapX(i, n, w) { return (i + 0.5) * w / n; }
  function renderMap(s) {
    s = s || W().state();
    var n = Math.max(1, s.rows), w = ui.svg.getBoundingClientRect().width || 800, slot = w / n;
    var gt = Math.min(Math.max(slot * 0.7, 1.5), 4), ft = Math.min(Math.max(slot * 0.9, 2.5), 6);
    var gaps = '', flags = '', rows = [], fl = 0;
    mapW = w;
    for (var i = 0; i < s.rows; i++) {
      var r = W().rowInfo(i), cx = mapX(i, n, w);
      if (!r.skip && !(r.a && r.b)) gaps += '<rect class="mgap" x="' + (cx - gt / 2).toFixed(2) + '" y="3" width="' + gt.toFixed(2) + '" height="6"/>';
      if (r.flag != null) { flags += '<rect x="' + (cx - ft / 2).toFixed(2) + '" y="0" width="' + ft.toFixed(2) + '" height="12" style="fill:' + W().flagColors[r.flag] + '"/>'; fl++; }
    }
    ui.svg.setAttribute('viewBox', '0 0 ' + w.toFixed(2) + ' 12');
    ui.svg.innerHTML = '<rect class="mtrack" x="0" y="0" width="' + w.toFixed(2) + '" height="12"/>' + gaps +
      '<rect class="mcur" id="ct_mapcur" x="' + (mapX(s.row, n, w) - (ft + 6) / 2).toFixed(2) + '" y="0" width="' + (ft + 6).toFixed(2) + '" height="12"/>' + flags;
    document.getElementById('ct_mapleg').innerHTML = '<span><i class="lg-gap"></i>no page in one copy</span><span><i class="lg-flag"></i>flag</span><span><i class="lg-cur"></i>this page</span>';
  }
  function moveMarker(s) {
    var c = document.getElementById('ct_mapcur'); if (!c) return;
    s = s || W().state();
    var n = Math.max(1, s.rows), wd = +c.getAttribute('width');
    c.setAttribute('x', (mapX(s.row, n, mapW || 800) - wd / 2).toFixed(2));
  }
  function mapRow(e) {
    var r = ui.svg.getBoundingClientRect(), n = W().state().rows;
    return Math.max(0, Math.min(n - 1, Math.floor((e.clientX - r.left) / r.width * n)));
  }
  function nearestRow(i) {                                                                   // with "skip" on, a click lands on the nearest page both copies have
    var n = W().state().rows;
    if (!st.skip || comparable(i)) return i;
    for (var d = 1; d < n; d++) { if (i - d >= 0 && comparable(i - d)) return i - d; if (i + d < n && comparable(i + d)) return i + d; }
    return i;
  }
  function showTip(e) {
    var s = W().state(), i = mapRow(e), box = ui.map.getBoundingClientRect(), x = e.clientX - box.left;
    if (i !== tipRow) {
      tipRow = i; var tok = ++tipTok, r = W().rowInfo(i), names = {};
      s.copies.forEach(function (c) { names[c.id] = c.name; });
      var status = r.skip ? 'Not compared' : r.flag != null ? 'Flagged (' + W().flagNames[r.flag] + ')' : (!r.a && !r.b) ? 'No page in either copy' : !r.a ? 'No page in ' + esc(names[s.pair[0]] || 'copy 1') : !r.b ? 'No page in ' + esc(names[s.pair[1]] || 'copy 2') : (i + 1) + ' of ' + s.rows;
      ui.tip.innerHTML = '<div class="tp"><span class="ph">…</span></div><b>' + esc(r.label) + '</b><small>' + status + '</small>';
      clearTimeout(tipTimer);
      tipTimer = setTimeout(function () {                                                    // a picture only when the pointer rests (sweeping over the map loads nothing)
        W().thumb(i).then(function (t) {
          if (tok !== tipTok) return;
          var tp = ui.tip.querySelector('.tp'); if (!tp) return;
          tp.innerHTML = t.url ? '<img alt="" src="' + t.url + '">' : '<span class="ph">' + (t.none ? 'No page' : esc(t.err || 'Not available')) + '</span>';
        });
      }, 140);
    }
    ui.tip.hidden = false;
    ui.tip.style.left = Math.max(4, Math.min(box.width - ui.tip.offsetWidth - 4, x - ui.tip.offsetWidth / 2)) + 'px';
    ui.hov.style.display = 'block'; ui.hov.style.left = x + 'px';
  }
  function hideTip() { tipRow = -1; tipTok++; clearTimeout(tipTimer); ui.tip.hidden = true; ui.hov.style.display = 'none'; }
  function note(msg) { toast(msg); }
  // short messages ("Page 11 flagged.", "This is the last page to compare.") appear for a moment at the bottom of the pictures
  function toast(msg) {
    if (!msg) return;
    ui.toast.textContent = msg; ui.toast.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(function () { ui.toast.hidden = true; }, 2600);
  }
  function setFocus(on) {
    on = !!on; if (st.focus === on || !st.on) return;
    st.focus = on; closePalette(); hideTip();
    layout();
    window.requestAnimationFrame(function () { window.dispatchEvent(new Event('resize')); });   // the pictures got more (or less) room
    if (on) { ui.leave.focus(); toast('Focus mode. Press Esc to leave it.'); }
    else document.getElementById('ct_focusbtn').focus();
  }
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


  /* ---------------------------------------------------------------- the view switcher (middle of the bar) */
  var VIEWS = [['diff', 'Difference'], ['toggle', 'Toggle'], ['topbottom', 'Top and bottom'], ['leftright', 'Left and right'], ['onlyimage1', 'Copy 1'], ['onlyimage2', 'Copy 2']];
  var vt = { open: 0, close: 0 };
  function viewIndex() { var m = E && E.action_bar ? E.action_bar.MODE : 'diff'; for (var i = 0; i < VIEWS.length; i++) if (VIEWS[i][0] === m) return i; return 0; }
  function copyName(slot) {
    var s = W().state(), n = '';
    s.copies.forEach(function (c) { if (c.id === s.pair[slot]) n = c.name; });
    return n;
  }
  function renderView() {
    if (!ui || !ui.vpill || !st.on) return;                                                  // (the two-image screens have no copies and no switcher)
    var cur = viewIndex();
    ui.vlab.textContent = VIEWS[cur][1];
    var dots = ''; VIEWS.forEach(function (v, i) { dots += '<i' + (i === cur ? ' class="on"' : '') + '></i>'; });
    ui.vdots.innerHTML = dots;
    var h = '';
    VIEWS.forEach(function (v, i) {
      var tip = i === 4 ? copyName(0) : i === 5 ? copyName(1) : '';
      h += '<button role="menuitemradio" aria-checked="' + (i === cur) + '" data-i="' + i + '"' + (i === cur ? ' class="on"' : '') + (tip ? ' title="' + esc(tip) + '"' : '') + '><span class="k">' + (i + 1) + '</span>' + esc(v[1]) + '</button>';
    });
    ui.vpop.innerHTML = h;
  }
  function openView() {
    clearTimeout(vt.close); clearTimeout(vt.open);
    if (!ui.vpop.hidden) return;
    closePalette();
    var bar = ui.tealbar, lk = document.getElementById('link_toggle');
    var left = ui.bar.offsetLeft + ui.bar.offsetWidth + 10;                                  // the free middle of the bar lies between the left part ...
    var right = (lk && lk.offsetParent ? lk.offsetLeft : bar.clientWidth - 100) - 10;         // ... and the symbols on the right
    ui.vpop.hidden = false; ui.vpop.classList.remove('col'); ui.vpop.style.cssText = '';
    // the six names in one row, over the middle of the bar, if they fit there; else one under the other above the view name
    var free = right - left;
    ui.vpop.style.left = left + 'px'; ui.vpop.style.right = (bar.clientWidth - right) + 'px';
    var need = 0; [].forEach.call(ui.vpop.children, function (b) { need += b.offsetWidth + 2; });
    if (need + 24 > free) {
      ui.vpop.classList.add('col'); ui.vpop.style.cssText = '';
      var pr = ui.vpill.getBoundingClientRect(), br = bar.getBoundingClientRect();
      var cx = pr.left + pr.width / 2 - br.left, w = ui.vpop.offsetWidth;
      ui.vpop.style.left = Math.max(6, Math.min(bar.clientWidth - w - 6, cx - w / 2)) + 'px';
    }
    ui.vpill.setAttribute('aria-expanded', 'true');
    ui.view.classList.add('open'); ui.view.classList.toggle('rowopen', !ui.vpop.classList.contains('col'));      // in a row the names take the place of the pill
  }
  function closeView() {
    clearTimeout(vt.close); clearTimeout(vt.open);
    if (!ui || !ui.vpop || ui.vpop.hidden) return;
    ui.vpop.hidden = true; ui.vpill.setAttribute('aria-expanded', 'false'); ui.view.classList.remove('open', 'rowopen');
  }
  function setView(i, says) {
    var v = VIEWS[i]; if (!v || !E) return;
    E.compare.visualisation_select.MDCSelect.setValue(v[0]);                                // the base app reacts to this menu (hidden in the Compare tab)
    renderView(); closeView();
    if (says && st.focus) toast('View: ' + v[1]);
  }
  function wireViews() {
    ui.vpill.onclick = function (e) {
      if (ui.vpop.hidden) { openView(); if (e.detail === 0) { var c = ui.vpop.querySelector('.on'); if (c) c.focus(); } }
      else closeView();
    };
    ui.view.addEventListener('pointerenter', function (e) {
      if (e.pointerType !== 'mouse') return;
      clearTimeout(vt.close); clearTimeout(vt.open); vt.open = setTimeout(openView, 180);       // rests for a moment: the others unfold (a quick pass does nothing)
    });
    ui.view.addEventListener('pointerleave', function (e) {
      if (e.pointerType !== 'mouse') return;
      clearTimeout(vt.open); vt.close = setTimeout(closeView, 350);
    });
    ui.vpop.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-i]'); if (b) setView(+b.dataset.i);
    });
    ui.view.addEventListener('keydown', function (e) {
      if (ui.vpop.hidden) return;
      var bs = [].slice.call(ui.vpop.querySelectorAll('button')), i = bs.indexOf(document.activeElement);
      if (e.key === 'Escape') { closeView(); ui.vpill.focus(); }
      else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') bs[(i + 1) % bs.length].focus();
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') bs[(i + bs.length - 1) % bs.length].focus();
      else if (e.key === 'Home') bs[0].focus();
      else if (e.key === 'End') bs[bs.length - 1].focus();
      else return;
      e.preventDefault(); e.stopPropagation();
    });
    document.addEventListener('modechange', renderView);
  }

  /* ---------------------------------------------------------------- moving around */
  function comparable(i) { var r = W().rowInfo(i); return r.a && r.b && !r.skip; }
  function goRow(i) {
    var s = W().state();
    if (i === s.row && !st.stale) return;
    closePalette(); W().setRow(i); markCurrent(); renderBar(); markStale(); schedule(350);
    if (st.focus) { var r = W().rowInfo(i); toast(r.label + ' · position ' + (i + 1) + ' of ' + s.rows + (r.flag != null ? ' · flagged' : '')); }
  }
  function stepPage(dir) {
    var s = W().state(), i = s.row + dir;
    while (i >= 0 && i < s.rows && st.skip && !comparable(i)) i += dir;
    if (i < 0 || i >= s.rows) return note(dir > 0 ? 'This is the last page to compare.' : 'This is the first page to compare.');
    goRow(i);
  }
  function afterCopies() { var s = W().state(); renderCopies(s); renderList(); renderMap(s); markStale(); schedule(350); }
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
    if (e.key === 'Escape' && !ui.pal.hidden) { closePalette(); ui.flag.focus(); e.preventDefault(); return; }
    var t = e.target, tag = t && t.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || (t && t.isContentEditable)) return;
    if (window.CompareAnnot && CompareAnnot.key(e)) { e.preventDefault(); return; }
    if (e.key === 'Escape' && st.focus) { setFocus(false); e.preventDefault(); return; }
    if (e.key === 'f' || e.key === 'F') { if (e.shiftKey) return; closePalette(); toggleFlag(); }
    else if (e.key === 'PageDown') stepPage(1);                                              // (the arrow keys are left alone: they move the picture)
    else if (e.key === 'PageUp') stepPage(-1);
    else if (/^[1-6]$/.test(e.key) && !e.shiftKey) setView(+e.key - 1, true);
    else return;
    e.preventDefault();
  }

  /* ---------------------------------------------------------------- aligning */
  function schedule(ms) { clearTimeout(st.timer); st.timer = setTimeout(align, ms); }
  // The background helper for the tile alignment. One job at a time (a job that is no longer wanted when its turn comes is skipped);
  // the reference page (copy 1) is kept, so changing copy 2 does not prepare it again. A helper that failed, or has done many pages,
  // is replaced: OpenCV.js keeps some memory after a failed step (A5), and a fresh helper gives all of it back.
  var eng = null, chain = Promise.resolve(), MAX_JOBS = 40;
  function serial(fn) { var p = chain.then(fn, fn); chain = p.catch(function () { }); return p; }
  function dropEngine() { if (eng) { try { eng.e.terminate(); } catch (x) { /* ignore */ } } eng = null; }
  async function tileJob(d, my) {
    if (my !== st.token) { d.urls.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (x) { /* ignore */ } }); return null; }   // no longer wanted: let the pictures go
    if (eng && eng.jobs >= MAX_JOBS) dropEngine();
    if (!eng) eng = { e: AlignEngine.create(), ref: null, jobs: 0, ready: false };
    var g = eng, loading = E.compare.load_images(d.urls, d.names);
    loading.catch(function () { });
    try {
      if (!g.ready) { setBusy('Starting the alignment helper … (the first time, the browser loads about 13 MB)'); await g.e.init(); g.ready = true; }
      if (my !== st.token) return null;
      if (g.ref !== d.key) {
        setBusy('Preparing copy 1 (finding the printed area) …');
        g.ref = null; await g.e.reference(d.files[0]); g.ref = d.key;
      }
      if (my !== st.token) return null;
      setBusy('Aligning copy 2 onto copy 1 … (rough position, then the fine alignment in tiles; a few seconds)');
      g.jobs++;
      var r = await g.e.alignColor(d.files[1]);
      await loading;
      if (my !== st.token) return null;
      E.compare.show_aligned(d.names, new ImageData(new Uint8ClampedArray(r.pixels), r.w, r.h));
      r.pixels = null;
      return r;
    } catch (e) {
      if (eng === g) dropEngine();
      throw e;
    }
  }
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
    var done = false, tiles = st.transform === 'tiles' && d.files, info = null;
    window.BC_COPY_NAMES = [copyName(0), copyName(1)];                                       // the colour note of the Difference view names the copies (js/panes.js)
    try {
      if (tiles) { info = await serial(function () { return tileJob(d, my); }); done = !!info; }
      else done = await E.compare.align_images(d.urls, d.names, st.transform, function () { return my === st.token; });
    }
    catch (e) {
      if (my === st.token) setBusy('Book Compare could not align these two pages (' + ((e && e.message) || e) + '). Try another alignment (left panel) or another page.', true,
        tiles ? [['Try Perspective', function () { ui.tf.value = 'perspective'; ui.tf.onchange(); }], ['Go to the pages', toPages]]
          : [['Try Affine', function () { ui.tf.value = 'affine'; ui.tf.onchange(); }], ['Go to the pages', toPages]]);
      return;
    }
    if (!done || my !== st.token) return;
    st.lastTiles = info;                                                                     // (for the tests and for the movement map later: unmatched ink, near-empty page)
    st.shown = key(s); st.shownRow = s.row; st.shownPair = s.pair.slice();
    E.compare.back_btn.onclick = toPages;                                                    // "Back" in the teal bar returns to the pages
    labelPanels(s);
    clearStale(); setBusy(null);
    if (info && info.sparse) note('This page has almost no ink: only the whole-page alignment was used, without the fine alignment in tiles.');
    if (window.CompareAnnot) CompareAnnot.refresh();
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
      clearStale(); setBusy(null);
      if (window.CompareAnnot) CompareAnnot.refresh();
      return;
    }
    markStale();
    st.token++;
    clearTimeout(st.timer);
    st.timer = setTimeout(function () { align(first); }, 30);
  }
  function toPages() {
    st.token++; clearTimeout(st.timer); setBusy(null); closePalette(); hideTip();
    st.focus = false; st.on = false; layout(); closeView();
    window.BC_COPY_NAMES = null;
    W().showPages();
  }

  window.CompareTab = {
    init: function (parts) { E = parts; build(); },
    enter: enter,
    leave: toPages,
    isOpen: function () { return st.on; },
    inFocus: function () { return st.on && st.focus; },
    transform: function () { return st.transform === 'tiles' ? 'perspective' : st.transform; },   // the OLDER alignment type to time in the speed test (it measures the tiles separately)
    lastTiles: function () { return st.lastTiles || null; }                                  // what the tile alignment of the picture on screen reported (tests)
  };
})();
