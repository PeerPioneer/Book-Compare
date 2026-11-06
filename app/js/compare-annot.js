/* Book Compare - annotations in the Compare tab.

   A circle, a rectangle or a text note can be drawn on the superimposed picture to mark something (for example "owner added a mark here?")
   and given a comment. They come in the same six colours as the flags and
   - belong to the PAGE of the book (the row), not to one pair of copies: they show in every pairing. Each remembers the two copies it was
     drawn with (the position is exact for that pair; for another pair of copies it can be a little off)
   - are saved in the project (workspace.js keeps them; this file only asks it to add, change or delete one)
   - are shown on all three pictures (superimposed, copy 1, copy 2 aligned: they have the same size and shape), but drawn and changed only
     on the superimposed one. The eye button hides them all
   - are stored as fractions of the picture (0-1 across and down), so zoom and scan resolution do not matter
   Annotations exist only here, in the whole-book workspace; the two-image screens of the app have none.

   compare-tab.js starts this file (CompareAnnot.init) and tells it when the picture on screen changes (refresh). */
(function () {
  'use strict';

  var H = null;                         // { W: () => BookWorkspace.tab, shown: () => {row, pair} | null, stale: () => bool, say: (text) => void, changed: () => void }
  var ui = null;
  var st = { tool: 'select', col: 0, on: true, sel: null, row: -1, draft: null, typed: false, active: false };

  var ICON = {
    select: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M5 3l14 8-6 2-2 6z"/></svg>',
    ellipse: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><ellipse cx="12" cy="12" rx="9" ry="6.5" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="3.2 2.2"/></svg>',
    rect: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="3.5" y="5.5" width="17" height="13" rx="1" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="3.2 2.2"/></svg>',
    note: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.17L4 17.17V4h16v12z"/></svg>',
    eye: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>',
    eyeoff: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>'
  };
  var TOOLS = [['select', 'Select, move and resize an annotation'], ['ellipse', 'Circle: drag on the picture'], ['rect', 'Rectangle: drag on the picture'], ['note', 'Text note: click on the picture']];
  var KIND = { ellipse: 'Circle', rect: 'Rectangle', note: 'Text note' };
  var CURSOR = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' };

  function W() { return H.W(); }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function esc(t) { return String(t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function clamp(v, lo, hi) { return Math.min(Math.max(v, lo), hi); }
  function colors() { return W().flagColors; }
  function cname(k) { return W().flagNames[k]; }

  /* ---------------------------------------------------------------- what is shown */
  function editable() { return st.active && st.on && !!H.shown() && !H.stale(); }
  function visible() {
    var sh = H.shown();
    if (!st.active || !st.on || !sh) return [];
    var l = W().annList(sh.row);
    if (st.draft) l.push(st.draft);
    return l;
  }
  function find(id) { var l = visible(); for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i]; return null; }
  function copyName(id) { var n = null; W().state().copies.forEach(function (c) { if (c.id === id) n = c.name; }); return n == null ? '(removed copy)' : n; }
  function pairText(a) { return copyName(a.pair[0]) + ' and ' + copyName(a.pair[1]); }
  function samePair(a, sh) { return !!sh && ((a.pair[0] === sh.pair[0] && a.pair[1] === sh.pair[1]) || (a.pair[0] === sh.pair[1] && a.pair[1] === sh.pair[0])); }

  function shape(a, w, h, sel, edit) {
    var col = colors()[a.col], x = a.x * w, y = a.y * h, sw = a.w * w, sh = a.h * h, s = '';
    var tip = '<title>' + esc((a.text || '(no comment)') + ' · drawn with ' + pairText(a)) + '</title>', id = edit && a.id > 0 ? ' data-id="' + a.id + '"' : '';
    var line = 'fill:' + col + ';fill-opacity:.1;stroke:' + col + ';stroke-width:2;stroke-dasharray:5 3';
    if (a.t === 'ellipse') s += '<ellipse' + id + ' cx="' + (x + sw / 2) + '" cy="' + (y + sh / 2) + '" rx="' + sw / 2 + '" ry="' + sh / 2 + '" style="' + line + '">' + tip + '</ellipse>';
    else if (a.t === 'rect') s += '<rect' + id + ' x="' + x + '" y="' + y + '" width="' + sw + '" height="' + sh + '" style="' + line + '">' + tip + '</rect>';
    else {
      s += '<g' + id + ' transform="translate(' + (x - 6) + ' ' + (y - 22) + ')">' + tip +
        '<path d="M0 0h20a3 3 0 0 1 3 3v11a3 3 0 0 1-3 3h-9l-5 5v-5H0a3 3 0 0 1-3-3V3a3 3 0 0 1 3-3z" style="fill:' + col + '" stroke="#fff" stroke-width="1"/>' +
        '<path d="M4 5h14M4 9.5h10" stroke="#fff" stroke-width="1.6" fill="none"/>' +
        (sel ? '<rect x="-6" y="-3" width="35" height="31" fill="none" style="stroke:' + col + ';stroke-width:1.5;stroke-dasharray:3 2" pointer-events="none"/>' : '') + '</g>';
    }
    if (sel && a.t !== 'note' && edit) {
      var xs = [x, x + sw / 2, x + sw], ys = [y, y + sh / 2, y + sh], ns = ['nw', 'n', 'ne', 'w', 0, 'e', 'sw', 's', 'se'], q = 0;
      for (var r = 0; r < 3; r++) for (var c = 0; c < 3; c++) {
        var hn = ns[q++];
        if (hn) s += '<rect data-h="' + hn + '" data-id="' + a.id + '" x="' + (xs[c] - 4) + '" y="' + (ys[r] - 4) + '" width="8" height="8" fill="#fff" style="stroke:' + col + ';stroke-width:1.5;cursor:' + CURSOR[hn] + '"/>';
      }
    }
    return s;
  }
  function draw(o) {
    var r = o.svg.getBoundingClientRect(), w = r.width, h = r.height;
    if (!w || !h) { o.svg.innerHTML = ''; return; }
    var s = '';
    visible().forEach(function (a) { s += shape(a, w, h, o.main && a.id === st.sel, o.main); });
    o.svg.innerHTML = s;
  }
  function drawAll() { if (ui) ui.ov.forEach(draw); }

  /* ---------------------------------------------------------------- the tools */
  function renderTools() {
    if (!ui) return;
    ui.tools.querySelectorAll('button[data-t]').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.t === st.tool ? 'true' : 'false'); });
    ui.acol.style.background = colors()[st.col];
    ui.acol.title = 'Colour of new annotations (' + cname(st.col) + ')';
    ui.eye.innerHTML = st.on ? ICON.eye : ICON.eyeoff;
    ui.eye.setAttribute('aria-pressed', st.on ? 'false' : 'true');
    var t = st.on ? 'Hide annotations' : 'Show annotations';
    ui.eye.title = t; ui.eye.setAttribute('aria-label', t);
    ui.main.box.classList.toggle('draw', st.tool !== 'select');
  }
  function closePalette() { if (ui && ui.pal) ui.pal.hidden = true; }
  function openPalette() {
    ui.pal.innerHTML = colors().map(function (c, k) {
      return '<button data-c="' + k + '" style="background:' + c + '" aria-pressed="' + (st.col === k) + '" title="' + cname(k) + '" aria-label="Colour ' + cname(k) + '"></button>';
    }).join('');
    ui.pal.hidden = false;
  }

  /* ---------------------------------------------------------------- the comment card (for the selected annotation) */
  function renderCard() {
    var a = st.sel != null ? find(st.sel) : null;
    if (!a || a.id < 0) { removeCard(); return; }
    if (ui.card && +ui.card.dataset.id === a.id) return;                                    // keep it: the comment may be in the middle of being typed
    removeCard();
    var sh = H.shown(), card = el('div', 'ct-annocard'); card.dataset.id = a.id;
    card.innerHTML =
      '<div class="row"><b>' + KIND[a.t] + '</b><span class="sws">' + colors().map(function (c, k) {
        return '<button data-c="' + k + '" style="background:' + c + '" aria-pressed="' + (a.col === k) + '" title="' + cname(k) + '" aria-label="Colour ' + cname(k) + '"></button>';
      }).join('') + '</span></div>' +
      '<textarea id="ct_annText" maxlength="2000" placeholder="Add a comment (optional)" aria-label="Comment"></textarea>' +
      '<div class="row"><small>Drawn with ' + esc(pairText(a)) + (samePair(a, sh) ? '' : '. For the pair shown now its position can be a little off.') + '</small>' +
      '<button class="ct-tbtn" data-del="1" title="Delete this annotation (Delete key)" aria-label="Delete this annotation">' + ICON.trash + '</button></div>';
    card.querySelector('textarea').value = a.text;
    ui.main.pane.appendChild(card);
    ui.card = card; st.typed = false;
  }
  function removeCard() { if (ui && ui.card) { ui.card.remove(); ui.card = null; } }
  function focusText() { setTimeout(function () { var t = ui && ui.card && ui.card.querySelector('textarea'); if (t) t.focus(); }, 0); }
  function renderAll() { drawAll(); renderTools(); renderCard(); }
  function rowNow() { var sh = H.shown(); return sh ? sh.row : -1; }
  function deleteSelected() {
    if (st.sel == null || !editable()) return false;
    if (W().annDel(rowNow(), st.sel)) { st.sel = null; renderAll(); H.changed(); H.say('Annotation deleted.'); }
    return true;
  }

  /* ---------------------------------------------------------------- drawing, moving, resizing on the superimposed picture */
  function onDown(e) {
    if (e.button > 0 || !editable()) return;
    var o = ui.main, r = o.svg.getBoundingClientRect(), w = r.width, h = r.height;
    if (!w || !h) return;
    var px = e.clientX - r.left, py = e.clientY - r.top, t = e.target;
    var g = t.closest ? t.closest('[data-id]') : null, hn = t.getAttribute ? t.getAttribute('data-h') : null;
    var id = g ? +g.getAttribute('data-id') : 0, sh = H.shown(), row = sh.row, a = null, mode = null, orig = null, tool = st.tool;
    if (tool === 'select') {
      if (!id) return;
      a = find(id); if (!a) return;
      st.sel = id; mode = hn ? 'resize' : 'move'; orig = { x: a.x, y: a.y, w: a.w, h: a.h };
      closePalette(); renderAll();
    } else if (tool === 'note') {
      var nid = W().annAdd(row, { t: 'note', x: px / w, y: py / h, col: st.col, text: '', pair: sh.pair.slice() });
      if (nid) { st.sel = nid; st.tool = 'select'; closePalette(); renderAll(); H.changed(); focusText(); }
      e.preventDefault(); return;
    } else {
      a = st.draft = { id: -1, t: tool, x: px / w, y: py / h, w: 0, h: 0, col: st.col, text: '', pair: sh.pair.slice() };
      mode = 'create'; orig = { x: a.x, y: a.y, w: 0, h: 0 };
      closePalette(); drawAll();
    }
    e.preventDefault();
    var svg = o.svg, sx = px, sy = py, began = false;
    try { svg.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    function mv(ev) {
      var rr = svg.getBoundingClientRect(), qx = clamp(ev.clientX - rr.left, 0, rr.width), qy = clamp(ev.clientY - rr.top, 0, rr.height), dx = qx - sx, dy = qy - sy;
      if (mode === 'create') {
        var x0 = Math.min(sx, qx), x1 = Math.max(sx, qx), y0 = Math.min(sy, qy), y1 = Math.max(sy, qy);
        a.x = x0 / rr.width; a.y = y0 / rr.height; a.w = (x1 - x0) / rr.width; a.h = (y1 - y0) / rr.height;
        drawAll(); return;
      }
      if (!began && (Math.abs(dx) > 2 || Math.abs(dy) > 2)) { W().annBegin(); began = true; }       // the undo step is made once the gesture really moves something
      if (!began) return;
      var patch;
      if (mode === 'move') {
        patch = { x: clamp(orig.x + dx / rr.width, 0, 1 - orig.w), y: clamp(orig.y + dy / rr.height, 0, 1 - orig.h) };
      } else {
        var X0 = orig.x * rr.width, X1 = (orig.x + orig.w) * rr.width, Y0 = orig.y * rr.height, Y1 = (orig.y + orig.h) * rr.height;
        if (hn.indexOf('w') >= 0) X0 = Math.min(qx, X1 - 8);
        if (hn.indexOf('e') >= 0) X1 = Math.max(qx, X0 + 8);
        if (hn.indexOf('n') >= 0) Y0 = Math.min(qy, Y1 - 8);
        if (hn.indexOf('s') >= 0) Y1 = Math.max(qy, Y0 + 8);
        patch = { x: X0 / rr.width, y: Y0 / rr.height, w: (X1 - X0) / rr.width, h: (Y1 - Y0) / rr.height };
      }
      W().annSet(row, id, patch); drawAll();
    }
    function up(ev) {
      svg.removeEventListener('pointermove', mv); svg.removeEventListener('pointerup', up); svg.removeEventListener('pointercancel', up);
      try { svg.releasePointerCapture(ev.pointerId); } catch (err) { /* ignore */ }
      if (mode !== 'create') return;
      var d = st.draft; st.draft = null;
      if (ev.type === 'pointercancel' || !d) { drawAll(); return; }
      var rr = svg.getBoundingClientRect();
      if (d.w * rr.width < 6 && d.h * rr.height < 6) {                                              // a click without dragging: a shape of a usual size around that point
        var ww = Math.min(70 / rr.width, 1), hh = Math.min(44 / rr.height, 1);
        d.w = ww; d.h = hh; d.x = clamp(sx / rr.width - ww / 2, 0, 1 - ww); d.y = clamp(sy / rr.height - hh / 2, 0, 1 - hh);
      }
      var nid2 = W().annAdd(row, d);
      st.tool = 'select';
      if (nid2) { st.sel = nid2; H.changed(); }
      renderAll(); if (nid2) focusText();
    }
    svg.addEventListener('pointermove', mv); svg.addEventListener('pointerup', up); svg.addEventListener('pointercancel', up);
  }

  /* ---------------------------------------------------------------- building the pieces */
  function build() {
    ui = { ov: [], card: null };
    [['pane_main', true], ['pane_o1', false], ['pane_o2', false]].forEach(function (p) {
      var pane = document.getElementById(p[0]), content = pane && pane.querySelector('.pane__content'); if (!content) return;
      var box = el('div', 'ct-ann' + (p[1] ? ' edit' : ''));
      box.innerHTML = '<svg class="ct-ann-svg" aria-hidden="true"></svg>';
      content.appendChild(box);
      var o = { box: box, svg: box.firstChild, main: p[1], pane: pane };
      ui.ov.push(o);
      if (p[1]) ui.main = o;
      if (window.ResizeObserver) new ResizeObserver(function () { if (st.active) draw(o); }).observe(o.svg);     // zoom and window size change the size of the picture
    });
    if (!ui.main) { ui = null; return; }

    ui.tools = el('div', 'ct-atools');
    ui.tools.setAttribute('role', 'toolbar'); ui.tools.setAttribute('aria-label', 'Annotations');
    ui.tools.innerHTML = TOOLS.map(function (t) { return '<button class="ct-tbtn" data-t="' + t[0] + '" aria-pressed="false" title="' + t[1] + '" aria-label="' + t[1] + '">' + ICON[t[0]] + '</button>'; }).join('') +
      '<span class="ct-tsep"></span><button class="ct-acol" id="ct_acol" aria-haspopup="true"></button><span class="ct-tsep"></span>' +
      '<button class="ct-tbtn" id="ct_aeye" aria-pressed="false"></button><div class="ct-apal" id="ct_apal" hidden role="group" aria-label="Annotation colour"></div>';
    ui.main.pane.appendChild(ui.tools);
    ui.acol = ui.tools.querySelector('#ct_acol'); ui.eye = ui.tools.querySelector('#ct_aeye'); ui.pal = ui.tools.querySelector('#ct_apal');

    ui.tools.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.dataset.t) {
        st.tool = st.tool === b.dataset.t && b.dataset.t !== 'select' ? 'select' : b.dataset.t;
        st.sel = null; st.draft = null; st.on = true; closePalette(); renderAll();
      } else if (b === ui.acol) { if (ui.pal.hidden) openPalette(); else closePalette(); }
      else if (b === ui.eye) { st.on = !st.on; if (!st.on) { st.sel = null; st.draft = null; st.tool = 'select'; } closePalette(); renderAll(); }
      else if (b.dataset.c != null) {
        st.col = +b.dataset.c; closePalette();
        if (st.sel != null && editable()) { W().annBegin(); W().annSet(rowNow(), st.sel, { col: st.col }); removeCard(); }
        renderAll();
      }
    });
    ui.main.pane.addEventListener('click', function (e) {                                       // the colour squares and the bin of the comment card
      var card = e.target.closest('.ct-annocard'); if (!card) return;
      var b = e.target.closest('button'); if (!b) return;
      if (b.dataset.del) deleteSelected();
      else if (b.dataset.c != null && st.sel != null && editable()) { W().annBegin(); W().annSet(rowNow(), st.sel, { col: +b.dataset.c }); removeCard(); renderAll(); }
    });
    ui.main.pane.addEventListener('input', function (e) {
      if (e.target.id !== 'ct_annText' || st.sel == null || !editable()) return;
      if (!st.typed) { W().annBegin(); st.typed = true; }                                        // one undo step for the whole comment
      W().annSet(rowNow(), st.sel, { text: e.target.value }); drawAll();
    });
    ui.main.pane.addEventListener('keydown', function (e) {
      if (e.target.id === 'ct_annText' && e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); e.target.blur(); st.sel = null; renderAll(); }
    });
    ui.main.svg.addEventListener('pointerdown', onDown);
    document.addEventListener('pointerdown', function (e) {                                      // a press anywhere else lets go of the annotation
      if (!st.active) return;
      if (ui.pal && !ui.pal.hidden && !e.target.closest('.ct-atools')) closePalette();
      if (st.sel == null || st.tool !== 'select') return;
      if (e.target.closest && e.target.closest('.ct-ann [data-id], .ct-ann [data-h], .ct-annocard, .ct-atools')) return;
      st.sel = null; renderAll();
    }, true);
  }

  window.CompareAnnot = {
    init: function (parts) { H = parts; build(); renderTools(); },
    // the picture on screen changed (another page, pair or alignment): show the annotations of its page
    refresh: function () {
      if (!ui) return;
      var r = rowNow();
      if (r !== st.row) { st.row = r; st.sel = null; st.draft = null; removeCard(); }
      renderAll();
    },
    setActive: function (on) {
      if (!ui) return;
      st.active = !!on;
      if (!on) { st.sel = null; st.draft = null; closePalette(); removeCard(); }
      renderAll();
    },
    // keys: Delete removes the selected annotation, Escape lets go of it / of the drawing tool. Returns true if the key was used.
    key: function (e) {
      if (!ui || !st.active) return false;
      if ((e.key === 'Delete' || e.key === 'Backspace') && st.sel != null) return deleteSelected();
      if (e.key === 'Escape') {
        if (ui.pal && !ui.pal.hidden) { closePalette(); return true; }
        if (st.sel != null) { st.sel = null; renderAll(); return true; }
        if (st.tool !== 'select') { st.tool = 'select'; renderAll(); return true; }
      }
      return false;
    }
  };
})();
