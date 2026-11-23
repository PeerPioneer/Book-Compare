'use strict';
/* Movement map (V16, decided 17 Nov 2026): how far the fine alignment moved each part of the page (on top of the rough, whole-page step),
   as a small picture of colours to lay over the overlay: transparent where (almost) nothing moved, then yellow, orange, red, magenta.
   One cell = 4 x 4 working pixels (working height 3000 px). Also a cautious hint (V16 point 3): inside the printed area, a region moved by
   about 15 px or more whose edge is sharp (within ~100 px the movement drops by 12 px or more) - a re-set line or block shifted as a whole,
   rather than paper that is bent smoothly. False alarms start below about 10 px (§4.4), so smaller shifts are not reported. */
var MV_CELL = 4, MV_BIG = 15, MV_EDGE = 12, MV_R = 24, MV_MIN = 25;
function movementMap(r, W, H, box) {
  var F = MV_CELL, mw = Math.ceil(W / F), mh = Math.ceil(H / F), D = new Float32Array(mw * mh), mx = r.map ? r.map.mx.data32F : null, my = r.map ? r.map.my.data32F : null, max = 0;
  // only where the fine alignment works (the tile area r.tbox = [x0, x1, y0, y1]): outside it the tile fields are merely carried on to the edge
  var tb = r.tbox || [0, W, 0, H];
  for (var cy = 0; cy < mh; cy++) for (var cx = 0; cx < mw; cx++) {
    var x = Math.min(W - 1, cx * F + (F >> 1)), y = Math.min(H - 1, cy * F + (F >> 1)), p = y * W + x, d = 0;
    if (x < tb[0] || x >= tb[1] || y < tb[2] || y >= tb[3]) { D[cy * mw + cx] = -1; continue; }
    if (mx) { if (!(mx[p] > -50 && mx[p] < W + 50 && my[p] > -50 && my[p] < H + 50)) d = -1; else d = Math.hypot(mx[p] - x, my[p] - y); }   // (near the edge the map mixes in the far-away 'outside' value: no movement there)
    D[cy * mw + cx] = d; if (d > max) max = d;
  }
  var px = new Uint8ClampedArray(mw * mh * 4);
  for (var i = 0; i < D.length; i++) {
    var v = D[i], c = v < 2 ? null : v < 4 ? [255, 224, 0, 60] : v < 8 ? [255, 140, 0, 130] : v < MV_BIG ? [230, 30, 30, 150] : [200, 0, 200, 170];
    if (c) { px[i * 4] = c[0]; px[i * 4 + 1] = c[1]; px[i * 4 + 2] = c[2]; px[i * 4 + 3] = c[3]; }
  }
  // the sharp-edged large shifts inside the printed area: local minimum over a square of +-MV_R cells (two passes: rows, then columns)
  var big = 0; for (i = 0; i < D.length; i++) if (D[i] >= MV_BIG) { big++; break; }
  var hint = null;
  if (big) {
    var T = new Float32Array(D.length), M = new Float32Array(D.length), q, k;
    for (cy = 0; cy < mh; cy++) for (cx = 0; cx < mw; cx++) { var m = 1e9; for (k = Math.max(0, cx - MV_R); k <= Math.min(mw - 1, cx + MV_R); k++) { q = D[cy * mw + k]; if (q >= 0 && q < m) m = q; } T[cy * mw + cx] = m; }
    for (cx = 0; cx < mw; cx++) for (cy = 0; cy < mh; cy++) { m = 1e9; for (k = Math.max(0, cy - MV_R); k <= Math.min(mh - 1, cy + MV_R); k++) { q = T[k * mw + cx]; if (q < m) m = q; } M[cy * mw + cx] = m; }
    var bx0 = Math.floor(box[0] / F), by0 = Math.floor(box[1] / F), bx1 = Math.ceil(box[2] / F), by1 = Math.ceil(box[3] / F), n = 0, best = 0, X0 = 1e9, Y0 = 1e9, X1 = -1, Y1 = -1;
    for (cy = Math.max(0, by0); cy < Math.min(mh, by1); cy++) for (cx = Math.max(0, bx0); cx < Math.min(mw, bx1); cx++) {
      var dv = D[cy * mw + cx];
      if (dv >= MV_BIG && dv - M[cy * mw + cx] >= MV_EDGE) { n++; if (dv > best) best = dv; if (cx < X0) X0 = cx; if (cy < Y0) Y0 = cy; if (cx > X1) X1 = cx; if (cy > Y1) Y1 = cy; }
    }
    if (n >= MV_MIN) hint = { px: Math.round(best), cells: n, x: X0 / mw, y: Y0 / mh, w: (X1 + 1 - X0) / mw, h: (Y1 + 1 - Y0) / mh };
  }
  var arrows = mx ? movementArrows(mx, my, W, H, function (x, y) { return D[Math.floor(y / F) * mw + Math.floor(x / F)] >= 2; }) : [];
  return { w: mw, h: mh, pixels: px.buffer, max: Math.round(max * 10) / 10, hint: hint, arrows: arrows, W: W, H: H };
}
// The arrows of the movement map (owner 21 Nov 2026): on a coarse grid (18 rows of arrows on the page), the direction in which the fine
// alignment moved that part of copy 2, as [x, y, dx, dy] in working pixels; only where it moved by 2 px or more (keep(x, y)).
// The map gives, for every place of the result, where in the (roughly placed) copy its ink came from: the ink moved by (x - mx, y - my).
var MV_ROWS = 18;
function movementArrows(mx, my, W, H, keep) {
  var S = Math.max(16, Math.round(H / MV_ROWS)), out = [];
  for (var y = S >> 1; y < H; y += S) for (var x = S >> 1; x < W; x += S) {
    var p = y * W + x, sx = mx[p], sy = my[p];
    if (!(sx > -50 && sx < W + 50 && sy > -50 && sy < H + 50)) continue;
    if (keep && !keep(x, y)) continue;
    var dx = x - sx, dy = y - sy;
    if (Math.hypot(dx, dy) < 2) continue;
    out.push([x, y, Math.round(dx * 10) / 10, Math.round(dy * 10) / 10]);
  }
  return out;
}


module.exports = { movementMap, movementArrows, MV_BIG, MV_EDGE };
