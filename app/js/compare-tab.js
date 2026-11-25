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
    pin: false,                         // the book map stays open
    dir: 1                              // the way the pages were last stepped through (the next page is prepared in that direction)
  };
  var TRANSFORMS = [['perspective', 'Perspective (older)'], ['affine', 'Affine (older)'], ['tps', 'Thin Plate Spline (older)']];
  if (window.AlignEngine && AlignEngine.supported()) TRANSFORMS.unshift(['tiles', 'Tiles (recommended)']);

  function W() { return window.BookWorkspace.tab; }
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function esc(t) { return String(t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function frames(n) { return new Promise(function (res) { (function f(k) { if (k <= 0) res(); else requestAnimationFrame(function () { f(k - 1); }); })(n); }); }
  function key(s) { return s.pair.join('|') + '#' + s.row + '#' + st.transform + '#' + JSON.stringify(W().tileSetting ? W().tileSetting(s.row, s.pair[1]) : null) + '#' + JSON.stringify(W().boxSetting ? W().boxSetting(s.row, s.pair[0]) : null); }

  /* ---------------------------------------------------------------- building the pieces */
  function build() {
    var rc = document.querySelector('div.result_container');
    var footer = E.compare.footer;

    ui = {};
    ui.top = el('div', 'ct-top ws-vars');
    ui.top.innerHTML =
      '<div class="ct-brand">Book Compare</div><div class="ct-proj" id="ct_proj"></div><button class="ws-save" id="ct_save"></button><div class="ct-sp"></div>' +
      '<div class="ct-tabs" role="tablist"><button class="ct-tab" role="tab" aria-selected="false" id="ct_tab_pages">Pages</button>' +
      '<button class="ct-tab" role="tab" aria-selected="true" id="ct_tab_compare" tabindex="-1">Compare</button></div>' +
      '<button class="ct-iconbtn ct-helpbtn" id="ct_helpbtn" title="How the Compare tab works, and its keys" aria-label="Help: how the Compare tab works, and its keys">?</button>' +
      '<button class="ct-iconbtn ct-dots" id="ct_more" title="Menu: project, export, help" aria-label="Menu" aria-haspopup="true">&#8942;</button>' +
      '<button class="ct-iconbtn" id="ct_focusbtn" title="Focus mode: hide everything except the pictures (Esc leaves it)" aria-label="Focus mode: hide everything except the pictures">' +
      '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M21 11V3h-8l3.29 3.29-10 10L3 13v8h8l-3.29-3.29 10-10z"/></svg></button>';

    ui.side = el('aside', 'ct-side');
    ui.side.innerHTML =
      // option C (owner 23 Nov 2026): the two copies right under each other (no Swap button), then ONE folded section for the alignment of
      // this page, so that the page list gets the rest of the height
      '<div class="ct-copies">' +
      '<div class="ct-copy c1"><span class="ct-lab">Copy 1</span><select id="ct_c1" aria-label="Copy 1"></select><span class="ct-n" id="ct_n1"></span></div>' +
      '<div class="ct-copy c2"><span class="ct-lab">Copy 2</span><div class="ct-row"><select id="ct_c2" aria-label="Copy 2"></select>' +
      '<button class="ct-step" id="ct_c2up" title="Previous copy as copy 2 (key ,)" aria-label="Previous copy">&#8249;</button>' +
      '<button class="ct-step" id="ct_c2dn" title="Next copy as copy 2 (key .)" aria-label="Next copy">&#8250;</button></div><span class="ct-n" id="ct_n2"></span></div>' +
      '</div>' +
      '<div class="ct-alsec" id="ct_tiles">' +
      '<button class="ct-alhead" id="ct_alhead" aria-expanded="false" aria-controls="ct_albody"><span class="ct-tri" aria-hidden="true"></span><span class="ct-altitle">Alignment of this page</span><span class="ct-alval" id="ct_alval">Standard</span></button>' +
      '<div class="ct-albody" id="ct_albody" hidden>' +
      // V15: how freely the tiles of copy 2 may move on this page (owner's Aruspix idea, decided 17 Nov)
      '<div class="ct-seg" role="group" aria-label="Fine alignment of copy 2 on this page">' +
      '<button data-tp="stiff" title="Larger regions move together. Real differences are not pulled away, but paper and scanning show more. Try this when the alignment bends something it should not.">Stiffer</button>' +
      '<button data-tp="std" title="The standard setting: 8 main tiles across the height of the page, each split 3 times">Standard</button>' +
      '<button data-tp="flex" title="Smaller pieces may move on their own. Fixes lines that stay doubled, but can hide a real difference.">Flexible</button></div>' +
      '<button class="ct-tadvbtn" id="ct_tadvbtn" aria-expanded="false">Advanced …</button>' +
      '<div class="ct-tadv" id="ct_tadv" hidden>' +
      '<label title="How many large tiles cover the height of the page (standard 8)">Main tiles <input type="number" id="ct_tmain" min="4" max="16" step="1"></label>' +
      '<label title="How many times each tile is split again (standard 3)">Sub-tiles <input type="number" id="ct_tsub" min="1" max="4" step="1"></label>' +
      '<button class="ct-tapply" id="ct_tapply">Apply</button></div>' +
      '<p class="ct-tnote" id="ct_tnote"></p>' +
      // V16: what the fine alignment did
      '<div class="ct-check"><label title="Colours and arrows over the picture: how far, and in which direction, the fine alignment moved each part of copy 2"><input type="checkbox" id="ct_mv"> Movement map</label></div>' +
      // V2b: the printed area, shown and corrected by hand (js/compare-box.js)
      '<div class="ct-check ct-boxrow"><label title="Show the area the alignment works on; its corners can be dragged"><input type="checkbox" id="ct_box"> Printed area</label>' +
      '<button class="ct-tadvbtn" id="ct_boxauto" hidden title="Forget the shape set by hand and use the box found automatically">Back to automatic</button></div>' +
      '<p class="ct-tnote" id="ct_boxnote" hidden></p>' +
      '</div></div>' +
      '<p class="ct-mvleg" id="ct_mvleg" hidden><i style="background:#ffe000"></i>2 to 4 px <i style="background:#ff8c00"></i>under 8 <i style="background:#e61e1e"></i>under 15 <i style="background:#c800c8"></i>15 px or more <span>(at 3000 px page height)</span><br><b class="ct-mvarr">&#8599;</b> arrows: the direction in which that part of copy 2 was moved (drawn longer than the real shift)</p>' +
      '<p class="ct-hint" id="ct_hint" hidden></p>' +
      '<div class="ct-warn" id="ct_warn" hidden></div>' +
      '<div class="ct-listhead"><h3>Pages</h3></div>' +
      '<div class="ct-filters" id="ct_filters"></div><div class="ct-fcols" id="ct_fcols" hidden></div>' +
      '<label class="ct-search"><input id="ct_q" type="search" placeholder="Find page, e.g. 4r or Index" autocomplete="off"></label>' +
      '<ul class="ct-list" id="ct_list" role="listbox" aria-label="Pages"></ul>' +
      '<label class="ct-foot"><input type="checkbox" id="ct_skip" checked><span>Skip pages that one of the two copies lacks</span></label>';

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
      '<button class="ct-vpill" id="ct_vpill" aria-haspopup="true" aria-expanded="false" title="Change the view (keys 1 to 6)"><span id="ct_vlab">Superimposed</span><span class="ct-vdots" id="ct_vdots" aria-hidden="true"></span></button>' +
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
    ui.sideh = el('button', 'ct-sideh'); ui.sideh.id = 'ct_sidebtn'; ui.sideh.type = 'button';      // the fold handle on the right edge of the left panel
    rc.appendChild(ui.top); rc.appendChild(ui.side); rc.appendChild(ui.sideh); rc.appendChild(ui.busy); rc.appendChild(ui.leave); rc.appendChild(ui.toast);
    var tealbar = footer.querySelector('.bar');                                             // the dark teal bar: the only bar below the pictures
    tealbar.insertBefore(ui.bar, tealbar.firstChild);
    tealbar.insertBefore(ui.view, tealbar.querySelector('.bar_right'));
    footer.insertBefore(ui.map, tealbar);
    ui.tealbar = tealbar;
    ui.rc = rc;
    [ui.top, ui.side, ui.bar, ui.view].forEach(function (e) { e.hidden = true; });
    // the coloured edge of the two copy boxes shows the colours chosen for the Superimposed view (0.11.0)
    var paintCopies = function () {
      try { ui.side.style.setProperty('--ct-c1', DIFF_COLOR_1); ui.side.style.setProperty('--ct-c2', DIFF_COLOR_2); } catch (e) { /* viz.js not loaded */ }
    };
    paintCopies();
    document.addEventListener('diffcolorschange', paintCopies);

    var $ = function (id) { return document.getElementById(id); };
    ui.c1 = $('ct_c1'); ui.c2 = $('ct_c2'); ui.list = $('ct_list'); ui.q = $('ct_q'); ui.where = $('ct_where');
    ui.vpill = $('ct_vpill'); ui.vpop = $('ct_vpop'); ui.vlab = $('ct_vlab'); ui.vdots = $('ct_vdots');
    ui.skip = $('ct_skip');
    ui.filters = $('ct_filters'); ui.fcols = $('ct_fcols'); ui.flag = $('ct_flag'); ui.pal = $('ct_flagpal');
    ui.svg = $('ct_mapsvg'); ui.tip = $('ct_tip'); ui.hov = $('ct_maphov'); ui.pin = $('ct_pin');
    ui.flagpath = $('ct_flagpath'); ui.flagpath.setAttribute('d', W().flagPath);
    try { st.pin = localStorage.getItem('bc-map-pinned') === '1'; } catch (e) { /* no browser storage: not remembered */ }
    if (window.CompareAnnot) CompareAnnot.init({
      W: W, say: function (t) { note(t); }, changed: function () { renderList(); },
      shown: function () { return st.shownRow == null ? null : { row: st.shownRow, pair: st.shownPair }; },
      stale: function () { return st.stale; }
    });

    if (window.CompareBox) CompareBox.init({
      W: W, say: function (t) { note(t); }, info: function () { return st.lastTiles || null; }, tiles: function () { return st.transform === 'tiles'; },
      shown: function () { return st.shownRow == null ? null : { row: st.shownRow, pair: st.shownPair }; },
      stale: function () { return st.stale; },
      realign: function () { markStale(); schedule(60); }
    });

    $('ct_sidebtn').onclick = function () { st.side = !st.side; layout(); };
    $('ct_focusbtn').onclick = function () { setFocus(true); };
    $('ct_helpbtn').onclick = helpDialog;
    $('ct_more').onclick = function () { window.BookWorkspace.menu(this); };
    $('ct_save').onclick = function () { window.BookWorkspace.chipClick(); };
    window.BookWorkspace.compareMenu({                                                       // what only this tab can do, for the one menu (js/workspace.js)
      'x-aligned': function () { E.action_bar.export_aligned_images(); },
      'x-toggle': function () { E.action_bar.export_gif(); },
      'x-view': function () { E.action_bar.export_current_view(); },
      help: helpDialog,
      leave: function () {                                                                    // "Back to the start screen"
        st.token++; clearTimeout(st.timer); setBusy(null); closePalette(); hideTip();
        st.focus = false; st.on = false; layout(); closeView();
        window.BC_COPY_NAMES = null; window.BC_PANE_NAMES = null;
        if (E.toStart) E.toStart();
      }
    });
    ui.leave.onclick = function () { setFocus(false); };
    $('ct_tab_pages').onclick = toPages;
    ui.c1.onchange = function () { W().setCopy(0, ui.c1.value); afterCopies(); };
    ui.c2.onchange = function () { W().setCopy(1, ui.c2.value); afterCopies(); };
    $('ct_c2up').onclick = function () { stepCopy(1, -1); };
    $('ct_c2dn').onclick = function () { stepCopy(1, 1); };
    ui.tiles = $('ct_tiles');
    // the section "Alignment of this page" is folded at first; whether it is open is remembered on this computer
    var alOpen = false; try { alOpen = localStorage.getItem('bookcompare_alsec') === 'open'; } catch (x) { /* private mode */ }
    var setAl = function (open, keep) {
      $('ct_albody').hidden = !open; $('ct_alhead').setAttribute('aria-expanded', String(open)); ui.tiles.classList.toggle('open', open);
      if (keep) { try { localStorage.setItem('bookcompare_alsec', open ? 'open' : 'folded'); } catch (x) { /* private mode */ } }
    };
    setAl(alOpen, false);
    $('ct_alhead').onclick = function () { setAl($('ct_albody').hidden, true); };
    ui.tiles.querySelector('.ct-seg').onclick = function (e) {
      var b = e.target.closest('button[data-tp]'); if (!b) return;
      setTiles(PRESETS[b.dataset.tp]);
    };
    $('ct_mv').onchange = function () { st.mvOn = this.checked; drawMovement(); var hb = $('ct_hintshow'); if (hb) { hb.textContent = st.mvOn ? 'Hide' : 'Show'; hb.setAttribute('aria-pressed', String(st.mvOn)); } };
    $('ct_tadvbtn').onclick = function () { var a = $('ct_tadv'); a.hidden = !a.hidden; this.setAttribute('aria-expanded', String(!a.hidden)); this.textContent = a.hidden ? 'Advanced …' : '▴ Hide advanced'; };
    $('ct_tapply').onclick = function () {
      var m = Math.round(+$('ct_tmain').value), u = Math.round(+$('ct_tsub').value);
      if (!(m >= 4 && m <= 16 && u >= 1 && u <= 4)) { $('ct_tnote').textContent = 'Main tiles: 4 to 16; sub-tiles: 1 to 4.'; return; }
      setTiles(m === 8 && u === 3 ? null : { main: m, sub: u });
    };
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
    document.addEventListener('openpaper', function () { if (st.on) paperDialog(); });
  }

  // "Paper …" next to the colour legend (0.11.0): blank paper is made white automatically (measured on the page itself and part by
  // part); where a copy's paper still shows its colour (stains, a grey photo, show-through) it can be made whiter, per copy, display only
  var PAPER_L = [0, 0.5, 1];
  function setPaperNow() {
    var s = W().state();
    window.BC_PAPER = [PAPER_L[W().paper(s.pair[0])] || 0, PAPER_L[W().paper(s.pair[1])] || 0];
  }
  function paperDialog() {
    var s = W().state(), names = [copyName(0), copyName(1)], cols = [DIFF_COLOR_1, DIFF_COLOR_2];
    var row = function (k) {
      var v = W().paper(s.pair[k]);
      return '<div class="ct-prow"><span class="ct-psw" style="background:' + cols[k] + '"></span><b>' + esc(names[k]) + '</b><div class="ct-seg" data-k="' + k + '" role="group" aria-label="Paper of ' + esc(names[k]) + '">' +
        [['0', 'Normal'], ['1', 'Whiter'], ['2', 'Whitest']].map(function (o) { return '<button type="button" data-v="' + o[0] + '" aria-pressed="' + (String(v) === o[0]) + '">' + o[1] + '</button>'; }).join('') + '</div></div>';
    };
    var sc = W().modal('<h3>Paper</h3><p>Before the two copies are laid over each other, Book Compare makes blank paper white. Where the paper of a copy still shows that copy’s colour (a stain, a grey photo, ink showing through from the other side of the leaf), make it whiter here.</p>' +
      row(0) + row(1) +
      '<p class="ct-pnote">Only the picture on screen changes, not the alignment. The setting is kept for the copy in the project. “Whitest” can also make very pale ink disappear.</p>' +
      '<div class="acts"><button class="ws-tb primary" data-close>Done</button></div>');
    if (!sc) return;
    sc.addEventListener('click', function (e) {
      var b = e.target.closest('.ct-seg button[data-v]'); if (!b) return;
      var k = +b.parentNode.dataset.k, v = +b.dataset.v;
      b.parentNode.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      W().setPaper(W().state().pair[k], v); setPaperNow();
      document.dispatchEvent(new CustomEvent('paperchange'));
    });
  }

  /* ---------------------------------------------------------------- showing the pieces */
  function layout() {
    ui.rc.classList.toggle('ct-on', st.on);
    ui.rc.classList.toggle('ct-noside', st.on && !st.side);
    var f = st.on && st.focus;                                                               // focus mode: only the pictures
    ui.rc.classList.toggle('ct-focus', f); document.body.classList.toggle('ct-focus', f);
    ui.sideh.hidden = !st.on || f;
    ui.sideh.innerHTML = st.side ? '&#8249;' : '&#8250;';
    ui.sideh.title = st.side ? 'Fold the left panel away' : 'Show the left panel (copies and pages)';
    ui.sideh.setAttribute('aria-label', ui.sideh.title); ui.sideh.setAttribute('aria-expanded', st.side ? 'true' : 'false');
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
    renderTitle();
    renderFlagBtn(r); moveMarker(s); renderTiles(s);
  }
  // the project's name (set in the Pages view) and the save state, as in the top bar there
  function renderTitle() {
    var i = window.BookWorkspace ? BookWorkspace.projectInfo() : {}, p = document.getElementById('ct_proj');
    if (p) { p.textContent = i.title || i.name || ''; p.title = i.title ? 'Name of the project (change it in the Pages view)' : ''; }
    renderSaveChip();
  }
  function renderSaveChip() {
    var b = document.getElementById('ct_save'); if (!b || !window.BookWorkspace) return;
    var c = BookWorkspace.saveChip(); b.className = c.cls; b.textContent = c.text; b.title = c.title; b.hidden = !c.text;
  }
  // V15: the tile settings of copy 2 on this page (null = standard); a change aligns the pair again at once
  var PRESETS = { stiff: { main: 8, sub: 2 }, std: null, flex: { main: 8, sub: 4 } };
  function renderTiles(s) {
    if (!ui.tiles) return;
    s = s || W().state();
    ui.tiles.hidden = st.transform !== 'tiles' || !s.pair[1];
    if (ui.tiles.hidden) return;
    var t = W().tileSetting(s.row, s.pair[1]), cur = !t ? 'std' : (t.main === 8 && t.sub === 2) ? 'stiff' : (t.main === 8 && t.sub === 4) ? 'flex' : 'custom';
    Array.prototype.forEach.call(ui.tiles.querySelectorAll('.ct-seg button'), function (b) { b.setAttribute('aria-pressed', String(b.dataset.tp === cur)); });
    $('ct_tmain').value = t ? t.main : 8; $('ct_tsub').value = t ? t.sub : 3;
    $('ct_alval').textContent = cur === 'std' ? 'Standard' : cur === 'stiff' ? 'Stiffer' : cur === 'flex' ? 'Flexible' : t.main + ' × ' + t.sub;
    $('ct_alhead').title = 'How ' + copyName(1) + ' is bent onto ' + copyName(0) + ' on this page: tile settings, movement map, printed area';
    var looser = t && (t.sub > 3 || t.main > 8);
    $('ct_tnote').textContent = !t ? '' : 'Only for ' + copyName(1) + ' on this page' + (cur === 'custom' ? ' (' + t.main + ' main tiles, ' + t.sub + ' sub-tiles)' : '') + '.' +
      (looser ? ' More flexible settings can also pull real differences into place.' : '');
    if (cur === 'custom') $('ct_tadv').hidden = false;
  }
  // V16: the movement map layer over the superimposed picture (stretched to the picture like the annotations)
  function mvLayer() {
    if (ui.mv) return ui.mv;
    var content = document.querySelector('#pane_main .pane__content'); if (!content) return null;
    ui.mv = el('div', 'ct-mv'); ui.mv.setAttribute('aria-hidden', 'true'); ui.mv.hidden = true;            // (a box, not a bare canvas: the app styles every canvas directly in a pane)
    ui.mvc = document.createElement('canvas'); ui.mv.appendChild(ui.mvc); content.appendChild(ui.mv);
    return ui.mv;
  }
  function drawMovement() {
    var cvs = mvLayer(), m = st.lastTiles && st.lastTiles.movement, on = !!(st.mvOn && m && st.transform === 'tiles' && !st.roughOn);
    $('ct_mvleg').hidden = !on;
    if (!cvs) return;
    cvs.hidden = !on;
    if (!on) return;
    if (cvs.dataset.k !== String(st.mvStamp)) {
      var c = ui.mvc; c.width = m.w; c.height = m.h;
      var x = c.getContext('2d'); x.putImageData(new ImageData(new Uint8ClampedArray(m.pixels), m.w, m.h), 0, 0);
      if (m.hint) { x.strokeStyle = '#c800c8'; x.lineWidth = 2; x.setLineDash([6, 4]); x.strokeRect(m.hint.x * m.w - 3, m.hint.y * m.h - 3, m.hint.w * m.w + 6, m.hint.h * m.h + 6); }
      drawArrows(m);
      cvs.dataset.k = String(st.mvStamp);
    }
  }
  // the arrows: in which direction each part of copy 2 was moved (drawn as lines in the page's own pixels, so they stay sharp when zoomed;
  // the length is exaggerated - a shift of a few pixels would not be visible otherwise)
  function drawArrows(m) {
    if (ui.mva) { ui.mva.remove(); ui.mva = null; }
    var A = m.arrows || []; if (!A.length || !m.W) return;
    var S = m.H / 18, path = '';
    A.forEach(function (a) {
      var d = Math.hypot(a[2], a[3]); if (!(d > 0)) return;
      var L = Math.min(S * 0.85, S * 0.25 + d * S * 0.04), ux = a[2] / d, uy = a[3] / d;
      var x0 = a[0] - ux * L / 2, y0 = a[1] - uy * L / 2, x1 = a[0] + ux * L / 2, y1 = a[1] + uy * L / 2, hd = Math.min(L * 0.4, S * 0.22);
      var hx = x1 - ux * hd, hy = y1 - uy * hd, px = -uy * hd * 0.55, py = ux * hd * 0.55;
      path += 'M' + x0.toFixed(1) + ' ' + y0.toFixed(1) + 'L' + x1.toFixed(1) + ' ' + y1.toFixed(1) +
        'M' + (hx + px).toFixed(1) + ' ' + (hy + py).toFixed(1) + 'L' + x1.toFixed(1) + ' ' + y1.toFixed(1) + 'L' + (hx - px).toFixed(1) + ' ' + (hy - py).toFixed(1);
    });
    var ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + m.W + ' ' + m.H); svg.setAttribute('preserveAspectRatio', 'none'); svg.setAttribute('class', 'ct-mvarrows');
    svg.innerHTML = '<path d="' + path + '" stroke="#fff" stroke-width="3.6" fill="none" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" opacity=".85"/>' +
      '<path d="' + path + '" stroke="#1a1a1a" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>';
    ui.mv.appendChild(svg); ui.mva = svg;
  }
  // V18 (owner 21 Nov: no search among neighbouring pages): when much of the ink has no partner, the two scans may not show the same page
  var MISMATCH = 0.30;
  function showMismatch() {
    var w = $('ct_warn'), t = st.lastTiles;
    if (!t || t.sparse || st.transform !== 'tiles' || !(t.unmatched_tiles > MISMATCH)) { w.hidden = true; return; }
    w.hidden = false;
    w.title = 'The two scans may not show the same page: perhaps a page is missing or extra in one copy, and the rows of the grid are out of step here.';
    w.innerHTML = '<b>' + Math.round(t.unmatched_tiles * 100) + ' % of the ink has no partner</b>: not the same page? ' +
      '<span class="ct-warnacts"><button class="ct-tapply" id="ct_warnpages">Go to the pages</button><button class="ct-tadvbtn" id="ct_warnok">Continue</button></span>';
    $('ct_warnpages').onclick = toPages;
    $('ct_warnok').onclick = function () { w.hidden = true; };
  }
  function showHint() {
    var h = $('ct_hint'), m = st.lastTiles && st.lastTiles.movement;
    if (!m || !m.hint || st.transform !== 'tiles') { h.hidden = true; return; }
    h.hidden = false;
    h.title = 'Part of this page was moved by about ' + m.hint.px + ' px by the fine alignment, with a sharp edge: a line or block may have been re-set or shifted here.';
    h.innerHTML = '<b>Shifted block, about ' + m.hint.px + ' px</b> <button class="ct-hintbtn" id="ct_hintshow" aria-pressed="' + !!st.mvOn + '">' + (st.mvOn ? 'Hide' : 'Show') + '</button>';
    $('ct_hintshow').onclick = function () {                                     // (0.12.0: shows and hides the movement map)
      st.mvOn = !st.mvOn; $('ct_mv').checked = st.mvOn; drawMovement();
      this.textContent = st.mvOn ? 'Hide' : 'Show'; this.setAttribute('aria-pressed', String(st.mvOn));
    };
  }
  // the rough view: copy 2 placed by the whole-page step only; switching back shows the fine result again (kept, not computed again)
  async function showRough(on) {
    st.roughOn = on; drawMovement();
    if (!st.fineImg || st.transform !== 'tiles') return;
    var my = st.token;
    if (!on) { E.compare.show_aligned(st.fineNames, st.fineImg); drawMovement(); return; }
    setBusy('Placing copy 2 by the whole-page step only …');
    try {
      var r = await serial(function () { return eng && eng.ready ? eng.e.roughColor() : null; });
      if (my !== st.token || !st.roughOn) return;
      if (r) E.compare.show_aligned(st.fineNames, new ImageData(new Uint8ClampedArray(r.pixels), r.w, r.h));
    } catch (e) { note('The rough view could not be shown (' + ((e && e.message) || e) + ').'); st.roughOn = false; }
    setBusy(null); drawMovement();
  }
  function setTiles(t) {
    var s = W().state(); if (!s.pair[1]) return;
    W().setTileSetting(s.row, s.pair[1], t);
    renderTiles(s); markStale(); schedule(60);
  }
  function render() {
    var s = W().state();
    renderCopies(s); renderList(); renderBar(s); renderMap(s); renderView(); layout(); renderExCard();
  }

  /* ---------------------------------------------------------------- the examples project (0.11.0, js/examples.js): a card per example */
  var exHidden = {};
  function renderExCard() {
    var pane = document.getElementById('pane_main'); if (!pane) return;
    var card = document.getElementById('ct_excard');
    var X = window.BCExamples, s = st.on && W().examples() ? W().state() : null, ex = s && X && X.list[s.row];
    if (!ex || exHidden[s.row]) { if (card) card.hidden = true; return; }
    if (!card) {
      card = el('div', 'ct-excard'); card.id = 'ct_excard'; card.setAttribute('role', 'note');
      pane.appendChild(card);
      card.addEventListener('click', function (e) {
        var b = e.target.closest('button[data-ex]'); if (!b) return;
        var a = b.dataset.ex;
        if (a === 'close') { exHidden[W().state().row] = true; renderExCard(); }
        else if (a === 'next') stepPage(1);
        else if (a === 'own') { toPages(); BookWorkspace.startAction('new'); }
      });
    }
    var n = X.list.length, last = s.row >= n - 1;
    var sq = function (c) { return '<span class="sq" style="background:' + c + '"></span>'; };
    card.innerHTML = '<button class="x" data-ex="close" aria-label="Close this note" title="Close this note">&times;</button>' +
      '<div class="k">Example ' + (s.row + 1) + ' of ' + n + '</div><h4>' + esc(ex.title) + '</h4><p>' + esc(ex.text) + '</p>' +
      (ex.welcome ? '<p class="leg">' + sq(DIFF_COLOR_1) + ' only in copy A &nbsp; ' + sq(DIFF_COLOR_2) + ' only in copy B &nbsp; ' + sq('#2a1a24') + ' in both</p>' +
        '<p>Page Down (or the arrow at the bottom) goes to the next example. The “?” at the top explains the rest.</p>' : '') +
      '<div class="acts">' + (last ? '' : '<button class="ct-btn pri" data-ex="next">Next example &#8250;</button>') +
      '<button class="ct-btn' + (last ? ' pri' : '') + '" data-ex="own">Start your own project</button></div>' +
      (ex.welcome ? '<small>' + esc(X.credit) + '</small>' : '');
    card.hidden = false;
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
  function markStale() { st.stale = true; ui.rc.classList.add('ct-stale'); if (window.CompareBox) CompareBox.refresh(); if (ui.busy.classList.contains('bad')) setBusy(null); if (ui.mv) ui.mv.hidden = true; var h = document.getElementById('ct_hint'); if (h) h.hidden = true; var w = document.getElementById('ct_warn'); if (w) w.hidden = true; }   // a new wish makes an old message obsolete
  function clearStale() { st.stale = false; ui.rc.classList.remove('ct-stale'); }


  /* ---------------------------------------------------------------- the view switcher (middle of the bar) */
  var VIEWS = [['diff', 'Superimposed'], ['toggle', 'Toggle'], ['topbottom', 'Top and bottom'], ['leftright', 'Left and right'], ['onlyimage1', 'Copy 1'], ['onlyimage2', 'Copy 2']];
  var vt = { open: 0, close: 0, w: 0 };
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
  // The view switcher (0.12.0, owner): resting on the bubble (or a click) lets it grow smoothly to the right and shows the six views
  // in it; what stands to its right in the bar (the options of the view, Linked) slides along. The bar keeps its colour. Only where
  // the bar has no room for that (a narrow window) do the six names open in a list above the bubble.
  function openView() {
    clearTimeout(vt.close); clearTimeout(vt.open);
    if (!ui.vpop.hidden) return;
    closePalette();
    var bar = ui.tealbar;
    ui.vpop.classList.remove('col'); ui.vpop.style.cssText = ''; ui.vpill.style.width = '';
    ui.vpop.hidden = false;                                                                   // (laid out, but not visible yet: see .ct-vpop)
    var pw = ui.vpill.offsetWidth, rw = ui.vpop.offsetWidth;
    // room: from the bubble to the right end of the bar, less what stands to the right of the bubble
    var br = bar.getBoundingClientRect(), pr = ui.vpill.getBoundingClientRect(), after = 0;
    [].forEach.call(bar.children, function (c) { if (c !== ui.view && c.offsetParent && c.getBoundingClientRect().left >= pr.right - 1) after += c.offsetWidth + 8; });
    if (pr.left + rw + after + 14 > br.right) {
      ui.vpop.classList.add('col');
      var w = ui.vpop.offsetWidth, cx = pr.left + pr.width / 2 - ui.view.getBoundingClientRect().left;
      ui.vpop.style.left = Math.max(-pr.left + br.left + 6, cx - w / 2) + 'px';
      ui.view.classList.add('open');
    } else {
      ui.vpill.style.width = pw + 'px'; void ui.vpill.offsetWidth;                               // from the bubble's own width ...
      ui.vpill.style.width = rw + 'px';                                                         // ... smoothly to the width of the six names
      ui.view.classList.add('open', 'rowopen');
    }
    ui.vpill.setAttribute('aria-expanded', 'true');
  }
  function closeView() {
    clearTimeout(vt.close); clearTimeout(vt.open);
    if (!ui || !ui.vpop || ui.vpop.hidden) return;
    var row = ui.view.classList.contains('rowopen');
    ui.vpop.hidden = true; ui.vpill.setAttribute('aria-expanded', 'false'); ui.view.classList.remove('open', 'rowopen');
    if (!row) { ui.vpill.style.width = ''; return; }
    var cur = ui.vpill.offsetWidth;                                                            // back to the bubble's own width, smoothly
    ui.vpill.style.transition = 'none'; ui.vpill.style.width = ''; var nw = ui.vpill.offsetWidth;
    ui.vpill.style.width = cur + 'px'; void ui.vpill.offsetWidth; ui.vpill.style.transition = '';
    ui.vpill.style.width = nw + 'px';
    clearTimeout(vt.w); vt.w = setTimeout(function () { if (ui.vpop.hidden) ui.vpill.style.width = ''; }, 300);
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
    closePalette(); W().setRow(i); markCurrent(); renderBar(); markStale(); schedule(350); renderExCard();
    if (st.focus) { var r = W().rowInfo(i); toast(r.label + ' · position ' + (i + 1) + ' of ' + s.rows + (r.flag != null ? ' · flagged' : '')); }
  }
  function stepPage(dir) {
    st.dir = dir < 0 ? -1 : 1;
    var s = W().state(), i = s.row + dir;
    while (i >= 0 && i < s.rows && st.skip && !comparable(i)) i += dir;
    if (i < 0 || i >= s.rows) return note(dir > 0 ? 'This is the last page to compare.' : 'This is the first page to compare.');
    goRow(i);
  }
  function afterCopies() { var s = W().state(); renderCopies(s); renderList(); renderMap(s); renderTiles(s); markStale(); schedule(350); }
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
    else if (e.key === ',') stepCopy(1, -1);                                                 // previous / next copy as copy 2 (item 6a)
    else if (e.key === '.') stepCopy(1, 1);
    else return;
    e.preventDefault();
  }

  // "?" in the top bar (item 4): how the tab works, with all its keys (they used to stand at the bottom of the left panel)
  function helpDialog() {
    var k = function (t) { return '<kbd>' + t + '</kbd>'; };
    W().modal('<h3>The Compare tab</h3>' +
      '<p>Copy 2 is moved and bent onto copy 1, page by page. Ink that is in both copies turns dark; ink that is only in one copy keeps that copy’s colour.</p>' +
      '<table class="ct-keytbl"><tbody>' +
      '<tr><td>' + k('Page Down') + ' ' + k('Page Up') + '</td><td>next / previous page</td></tr>' +
      '<tr><td>' + k('1') + ' … ' + k('6') + '</td><td>view: 1 Superimposed, 2 Toggle, 3 Top and bottom, 4 Left and right, 5 Copy 1, 6 Copy 2</td></tr>' +
      '<tr><td>' + k(',') + ' ' + k('.') + '</td><td>previous / next copy as copy 2</td></tr>' +
      '<tr><td>' + k('F') + '</td><td>flag this page (or take the flag away)</td></tr>' +
      '<tr><td>arrow keys</td><td>move the picture (click the picture first)</td></tr>' +
      '<tr><td>mouse wheel</td><td>zoom in and out</td></tr>' +
      '<tr><td>' + k('Delete') + '</td><td>delete the selected annotation</td></tr>' +
      '<tr><td>' + k('Esc') + '</td><td>let go of an annotation; leave focus mode</td></tr>' +
      '</tbody></table>' +
      '<ul><li><b>Left panel:</b> the two copies, how they are aligned, and the pages. The small tab on its right edge folds it away.</li>' +
      '<li><b>Copy 1 and copy 2</b> can be shown in two small panels beside the superimposed picture: the strip at the right edge opens them.</li>' +
      '<li><b>Copy 2 view</b> (key 6): <b>Aligned</b> shows copy 2 as the alignment moved it, <b>Original scan</b> as it was scanned. Copy 1 is never changed.</li>' +
      '<li><b>Movement map</b> (left panel) colours the parts of copy 2 that the fine alignment moved, with arrows for the direction.</li>' +
      '<li><b>Alignment of this page</b> (left panel, folded at first): Stiffer / Standard / Flexible sets how small the pieces of copy 2 may be that move on their own; the movement map shows what moved; “Printed area” shows the area that is aligned, and its corners can be dragged.</li>' +
      '<li><b>Annotations:</b> the pen button in the zoom column of the superimposed picture (above the ▲ arrow) unfolds the tools: circle, rectangle, text note, colour, and the eye that hides all annotations.</li>' +
      '<li>The arrows button at the top right is <b>focus mode</b>: only the pictures. Esc brings everything back.</li></ul>' +
      // B5: what the comparison cannot show (owner 18 Nov / 21 Nov; was at the bottom of the left panel)
      '<details class="ct-help" id="ct_help"><summary>What the comparison cannot show</summary><ul>' +
      '<li><b>Lighter inks.</b> Only dark ink takes part in the alignment and in the differences. Red print (staves, rubrics, initials) and other light colours are not looked at: a difference that exists only in red ink cannot be seen here. Look at the two scans side by side for those.</li>' +
      '<li><b>Small shifts.</b> The fine alignment bends small parts of the page onto each other. A line, a note or a block moved by a few pixels (up to about one staff space) is pulled into place and does not show as a difference. The movement map shows where the alignment moved something; a sharp shift of about 15 px or more is pointed out. Shifts of a few pixels cannot be detected at all.</li>' +
      '<li><b>Tile settings.</b> “Flexible” can pull real differences into place; “Stiffer” is safer but shows more differences that are only paper and scanning.</li>' +
      '<li><b>Pages with almost no ink</b> (title pages, blank pages) are placed by the whole-page step only.</li>' +
      '<li><b>Outside the printed area</b> set by hand nothing is aligned; there the picture only follows the nearest aligned parts.</li>' +
      '<li><b>Paper and scanning</b> (stains, show-through, pencil, a curved page, a dark binding edge) can show as differences. A photo taken at a slant is straightened as a whole first; a wrong page in one copy shows as a page full of differences (more than 30 % of the ink without partner is pointed out).</li>' +
      '</ul><button type="button" class="ct-helphide" onclick="this.parentNode.open = false">&#9652; Hide this note</button></details>' +
      '<div class="acts"><button class="ws-tb primary" data-close>Got it</button></div>');
  }

  /* ---------------------------------------------------------------- aligning */
  function schedule(ms) { clearTimeout(st.timer); st.timer = setTimeout(align, ms); }
  // The background helper for the tile alignment. One job at a time (a job that is no longer wanted when its turn comes is skipped);
  // the reference page (copy 1) is kept, so changing copy 2 does not prepare it again. A helper that failed, or has done many pages,
  // is replaced: OpenCV.js keeps some memory after a failed step (A5), and a fresh helper gives all of it back.
  var eng = null, chain = Promise.resolve(), MAX_JOBS = 40;
  function serial(fn) { var p = chain.then(fn, fn); chain = p.catch(function () { }); return p; }
  function dropEngine() { if (eng) { try { eng.e.terminate(); } catch (x) { /* ignore */ } } eng = null; }
  // item 33: the helper is started while the Pages view is still open, so that the first comparison does not wait for it
  function preload() {
    if (eng || !window.AlignEngine || !AlignEngine.supported()) return;
    var g = eng = { e: AlignEngine.create(), ref: null, jobs: 0, ready: false };
    g.loading = g.e.init().then(function () { g.ready = true; g.loading = null; }, function () { g.loading = null; if (eng === g) dropEngine(); });
  }
  // Stored alignments (V10, desktop program): a pair whose copy 1 is the reference copy (or stands in for it on this page) is kept in the
  // project file (0.12.0); when it is there and still fits, the page is shown from it at once. Other pairs are aligned directly, and the next page
  // in the direction of travel is prepared meanwhile (D2, kept in memory only, prepared by a second helper).
  async function storeKey(d) {
    if (!d.ids || !window.BCResults || !BCResults.available() || !W().refFor || W().refFor(d.row) !== d.ids[0]) return null;
    return { c0: d.ids[0], k0: d.keys[0], c1: d.ids[1], k1: d.keys[1], i0: await BCResults.fileInfo(d.files[0]), i1: await BCResults.fileInfo(d.files[1]), tiles: d.tiles || null, quad: d.quad || null };
  }
  function preKey(d) { return d.ids ? [d.ids[0], d.keys[0], d.files[0].size, d.files[0].lastModified, d.ids[1], d.keys[1], d.files[1].size, d.files[1].lastModified, JSON.stringify(d.tiles || null), JSON.stringify(d.quad || null)].join('|') : null; }
  var pre = { e: null, ready: false, jobs: 0, cache: new Map(), busy: null };          // the helper that prepares the next page, and what it prepared
  function preTake(d) { var k = preKey(d), v = k && pre.cache.get(k); if (v) pre.cache.delete(k); return v || null; }
  async function stored(d) {
    var hit = preTake(d); if (hit) return hit;
    var p = await storeKey(d); return p ? BCResults.read(p) : null;
  }
  function prepareNext(s) {
    if (st.transform !== 'tiles' || !st.on) return;
    var n = s.rows, i = s.row + st.dir;
    while (i >= 0 && i < n && !comparable(i)) i += st.dir;
    if (i < 0 || i >= n || pre.busy != null) return;
    var my = st.token;
    pre.busy = i;
    (async function () {
      try {
        var d = await W().loadRow(i); if (!d || my !== st.token) return;
        d.tiles = W().tileSetting(i, d.ids[1]); d.quad = W().boxSetting(i, d.ids[0]);
        var k = preKey(d); if (pre.cache.has(k)) return;
        var p = await storeKey(d); if (p && await BCResults.has(p)) return;                       // stored already: nothing to prepare
        if (pre.e && pre.jobs >= MAX_JOBS) { try { pre.e.terminate(); } catch (x) { /* ignore */ } pre.e = null; }
        if (!pre.e) { pre.e = AlignEngine.create(); pre.ready = false; pre.jobs = 0; }
        if (!pre.ready) { await pre.e.init(); pre.ready = true; }
        var r = await pre.e.alignStore(d.files[0], d.ids[0] + '#' + d.keys[0] + '#' + d.files[0].size + '#' + d.files[0].lastModified + '#' + JSON.stringify(d.quad || null), d.files[1], d.tiles, d.quad);
        pre.jobs++;
        if (p) BCResults.save(p, r.bin, { u: r.unmatched_tiles, max: r.max, sparse: !!r.sparse }).catch(function () { });
        else { pre.cache.set(k, r.bin); while (pre.cache.size > 3) pre.cache.delete(pre.cache.keys().next().value); }
      } catch (e) { if (pre.e) { try { pre.e.terminate(); } catch (x) { /* ignore */ } } pre.e = null; }
      finally { pre.busy = null; }
    })();
  }
  async function tileJob(d, my) {
    if (my !== st.token) { d.urls.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (x) { /* ignore */ } }); return null; }   // no longer wanted: let the pictures go
    if (eng && eng.jobs >= MAX_JOBS) dropEngine();
    if (!eng) eng = { e: AlignEngine.create(), ref: null, jobs: 0, ready: false };
    var g = eng, loading = E.compare.load_images(d.urls, d.names);
    loading.catch(function () { });
    try {
      if (!g.ready) { setBusy('Starting the alignment helper … (the first time, the browser loads about 13 MB)'); await (g.loading || g.e.init()); g.ready = true; }
      if (my !== st.token) return null;
      var bin = null; try { bin = await stored(d); } catch (x) { bin = null; }
      if (bin && my === st.token) {
        setBusy('Showing the stored alignment …');
        try {
          var rs = await g.e.warpStored(d.files[1], bin);
          await loading;
          if (my !== st.token) return null;
          st.fineImg = new ImageData(new Uint8ClampedArray(rs.pixels), rs.w, rs.h); st.fineNames = d.names;
          E.compare.show_aligned(d.names, st.fineImg);
          rs.pixels = null;
          return rs;
        } catch (x) { /* a stored result that cannot be used: aligned again below */ }
      }
      if (my !== st.token) return null;
      var rk = d.key + '#' + JSON.stringify(d.quad || null);
      if (g.ref !== rk) {
        setBusy('Preparing copy 1 (finding the printed area) …');
        g.ref = null; await g.e.reference(d.files[0], d.quad); g.ref = rk;
      }
      if (my !== st.token) return null;
      setBusy('Aligning copy 2 onto copy 1 … (rough position, then the fine alignment in tiles; a few seconds)');
      g.jobs++;
      var sk = await storeKey(d), r = await g.e.alignColor(d.files[1], d.tiles, !!sk);
      if (sk && r.bin) BCResults.save(sk, r.bin, { u: r.unmatched_tiles, max: r.movement && r.movement.max, sparse: !!r.sparse }).catch(function () { });
      r.bin = null;
      await loading;
      if (my !== st.token) return null;
      st.fineImg = new ImageData(new Uint8ClampedArray(r.pixels), r.w, r.h); st.fineNames = d.names;
      E.compare.show_aligned(d.names, st.fineImg);
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
    setPaperNow();
    window.BC_COPY_NAMES = [copyName(0), copyName(1)];                                       // the colour note of the Difference view names the copies (js/panes.js)
    try {
      if (tiles) { d.tiles = W().tileSetting(s.row, s.pair[1]); d.quad = W().boxSetting(s.row, s.pair[0]); info = await serial(function () { return tileJob(d, my); }); done = !!info; }
      else done = await E.compare.align_images(d.urls, d.names, st.transform, function () { return my === st.token; });
    }
    catch (e) {
      if (my === st.token) setBusy('Book Compare could not align these two pages (' + ((e && e.message) || e) + '). Try another setting under “Alignment of this page”, correct the printed area, or go to another page.', true,
        [['Stiffer', function () { setTiles(PRESETS.stiff); }], ['Go to the pages', toPages]]);
      return;
    }
    if (!done || my !== st.token) return;
    st.lastTiles = info;                                                                     // (unmatched ink, near-empty page, movement map: tests and V16)
    st.mvStamp = (st.mvStamp || 0) + 1; st.roughOn = false;
    if (!info) st.fineImg = null;
    drawMovement(); showHint(); showMismatch();
    st.shown = key(s); st.shownRow = s.row; st.shownPair = s.pair.slice();
    E.compare.back_btn.onclick = toPages;                                                    // "Back" in the teal bar returns to the pages
    labelPanels(s);
    clearStale(); setBusy(null);
    if (info && info.sparse) note('This page has almost no ink: only the whole-page alignment was used, without the fine alignment in tiles.');
    if (window.CompareAnnot) CompareAnnot.refresh();
    if (window.CompareBox) CompareBox.refresh();
    if (tiles) prepareNext(s);
  }
  // the panels say which copy and page they show (the file names stay the names of the exported files)
  function labelPanels(s) {
    var r = W().rowInfo(s.row), byId = {}; s.copies.forEach(function (c) { byId[c.id] = c; });
    window.BC_PANE_NAMES = [0, 1].map(function (i) { return byId[s.pair[i]] ? byId[s.pair[i]].name + ' · ' + r.label : ''; });   // (js/panes.js writes the labels)
    if (window.BCCopy2View) BCCopy2View.relabel();
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
    st.focus = false; st.on = false; layout(); closeView(); renderExCard();
    window.BC_COPY_NAMES = null; window.BC_PANE_NAMES = null;
    W().showPages();
  }

  window.CompareTab = {
    init: function (parts) { E = parts; build(); },
    enter: enter,
    leave: toPages,
    isOpen: function () { return st.on; },
    inFocus: function () { return st.on && st.focus; },
    transform: function () { return st.transform === 'tiles' ? 'perspective' : st.transform; },   // the OLDER alignment type to time in the speed test (it measures the tiles separately)
    lastTiles: function () { return st.lastTiles || null; },                                 // what the tile alignment of the picture on screen reported (tests)
    prepared: function () { return { busy: pre.busy, cached: pre.cache.size }; },            // the next page being prepared (tests)
    toast: function (t) { if (ui) toast(t); },
    preload: function () { try { preload(); } catch (e) { /* not important */ } },
    titleChanged: function () { if (ui) renderTitle(); },
    saveChanged: function () { if (ui) renderSaveChip(); }
  };
})();
