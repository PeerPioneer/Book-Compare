/* Book Compare - the printed area in the Compare tab, shown and corrected by hand (V2b, owner 17 Nov 2026).

   "Printed area" (left panel, tile alignment only) shows the area the alignment works on, on all three pictures (they have the same size and
   shape: copy 2 is bent onto copy 1). It starts as the automatic box (a rectangle, dashed). Each of its four corners can be dragged on its
   own on the superimposed picture: everything outside the shape is then left out of the alignment, in both copies (main use: a slanted dark
   binding edge or a sliver of the next page). When a corner is let go, the pair is aligned again at once. "Back to automatic" removes the shape.
   The shape belongs to the SCAN of copy 1 (the page that the other copy is bent onto) and is saved in the project (workspace.js keeps it).
   Corners are stored as fractions of the picture (0-1 across and down), clockwise from the top left.

   compare-tab.js starts this file (CompareBox.init) and tells it when the picture on screen changes (refresh). */
(function () {
  'use strict';
  var H = null, ui = null;
  var st = { on: false, quad: null, hand: false, drag: -1 };

  function W() { return H.W(); }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function clamp(v, lo, hi) { return Math.min(Math.max(v, lo), hi); }
  function esc(t) { return String(t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function boxQuad(b) { return [b[0], b[1], b[2], b[1], b[2], b[3], b[0], b[3]]; }
  function copyName(id) { var n = 'copy 1'; W().state().copies.forEach(function (c) { if (c.id === id) n = c.name; }); return n; }

  function usable() { var sh = H.shown(), inf = H.info(); return st.on && H.tiles() && sh && !H.stale() && inf && (inf.box || inf.quad); }
  function current() {
    var sh = H.shown(), inf = H.info(), hand = sh ? W().boxSetting(sh.row, sh.pair[0]) : null;
    st.hand = !!hand;
    return hand || (inf && inf.quad) || (inf && inf.box ? boxQuad(inf.box) : null);
  }
  function draw(o) {
    var svg = o.svg, r = svg.getBoundingClientRect(), w = r.width, h = r.height, q = st.quad;
    if (!q || !w || !h) { svg.innerHTML = ''; return; }
    var pts = [0, 1, 2, 3].map(function (i) { return (q[2 * i] * w).toFixed(1) + ',' + (q[2 * i + 1] * h).toFixed(1); });
    var s = '<path d="M0,0H' + w + 'V' + h + 'H0Z M' + pts.join(' L') + 'Z" style="fill:#000;fill-opacity:.28;fill-rule:evenodd;stroke:none"/>' +
      '<polygon points="' + pts.join(' ') + '" style="fill:none;stroke:#00a19a;stroke-width:2' + (st.hand ? '' : ';stroke-dasharray:7 4') + '"/>';
    if (o.main) for (var i = 0; i < 4; i++) s += '<circle data-h="' + i + '" cx="' + (q[2 * i] * w).toFixed(1) + '" cy="' + (q[2 * i + 1] * h).toFixed(1) + '" r="8" style="fill:#fff;stroke:#00807a;stroke-width:3"><title>Drag this corner</title></circle>';
    svg.innerHTML = s;
  }
  function render() {
    if (!ui) return;
    var ok = usable();
    if (st.drag < 0) st.quad = ok ? current() : null;
    ui.ov.forEach(function (o) { o.box.hidden = !ok; if (ok) draw(o); });
    var pm = document.getElementById('pane_main'); if (pm) pm.classList.toggle('ct-boxedit', !!ok);      // (the annotation tools would cover a corner)
    ui.auto.hidden = !(ok && st.hand);
    var sh = H.shown();
    ui.note.hidden = !st.on;
    ui.note.innerHTML = !st.on ? '' : !ok ? 'The printed area is shown when the pages are aligned.' :
      (st.hand ? '<b>Set by hand</b> for this scan of ' + esc(copyName(sh.pair[0])) + '. ' : 'Found automatically. ') +
      'Drag a corner on the superimposed picture: everything outside the shape is left out of the alignment (for example a dark binding edge or a sliver of the next page). The pages are aligned again at once.';
  }
  function onDown(e) {
    var c = e.target.closest && e.target.closest('[data-h]'); if (!c || !usable()) return;
    e.preventDefault(); e.stopPropagation();
    var svg = ui.main.svg, i = +c.dataset.h;
    st.drag = i;
    try { svg.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
    function mv(ev) {
      var r = svg.getBoundingClientRect();
      st.quad[2 * i] = clamp((ev.clientX - r.left) / r.width, 0, 1); st.quad[2 * i + 1] = clamp((ev.clientY - r.top) / r.height, 0, 1);
      ui.ov.forEach(draw);
    }
    function up() {
      svg.removeEventListener('pointermove', mv); svg.removeEventListener('pointerup', up); svg.removeEventListener('pointercancel', up);
      st.drag = -1;
      var sh = H.shown(); if (!sh) return;
      var q = st.quad.map(function (v) { return Math.round(v * 10000) / 10000; });
      if (W().setBoxSetting(sh.row, sh.pair[0], q) === false) { H.say('That shape is too small: drag the corners further apart.'); render(); return; }
      H.realign();
    }
    svg.addEventListener('pointermove', mv); svg.addEventListener('pointerup', up); svg.addEventListener('pointercancel', up);
  }
  function build() {
    ui = { ov: [], check: document.getElementById('ct_box'), auto: document.getElementById('ct_boxauto'), note: document.getElementById('ct_boxnote') };
    if (!ui.check) { ui = null; return; }
    [['pane_main', true], ['pane_o1', false], ['pane_o2', false]].forEach(function (p) {
      var pane = document.getElementById(p[0]), content = pane && pane.querySelector('.pane__content'); if (!content) return;
      var box = el('div', 'ct-qbox' + (p[1] ? ' edit' : ''));
      box.innerHTML = '<svg aria-hidden="true"></svg>'; box.hidden = true;
      content.appendChild(box);
      var o = { box: box, svg: box.firstChild, main: p[1] };
      ui.ov.push(o); if (p[1]) ui.main = o;
      if (window.ResizeObserver) new ResizeObserver(function () { if (!box.hidden) draw(o); }).observe(o.svg);
    });
    if (ui.main) ui.main.svg.addEventListener('pointerdown', onDown);
    ui.check.onchange = function () { st.on = this.checked; render(); };
    ui.auto.onclick = function () { var sh = H.shown(); if (!sh) return; W().setBoxSetting(sh.row, sh.pair[0], null); H.realign(); render(); };
  }

  window.CompareBox = {
    init: function (hooks) { H = hooks; build(); render(); },
    refresh: render,
    isOn: function () { return st.on; },
    quad: function () { return st.quad ? st.quad.slice() : null; }       // what is drawn (tests)
  };
})();
