'use strict';
/* Step 1 of the alignment experiment: printed-area detection, ported from research/ink_map.py and
   research/printed_area.py to OpenCV.js. Same recipe, same numbers, so the results can be compared box by box. */
const { dilateRect, openRect, closeRect } = require('./rectmorph');
const H0 = 3000;

function ones(cv, rows, cols) { return cv.Mat.ones(rows, cols, cv.CV_8U); }

/* A5 (20 Nov 2026): a list of Mats that are freed together, also when something throws half-way. Before, a page that failed (for example
   "box too small" in the tile step) kept about 100 MB of WebAssembly memory for good, which a whole-book run in one worker cannot afford
   (test_memory.js: 6 failing pages grew the memory from 278 to 806 MB). add(m) registers a Mat and returns it; release(m) takes it off the list
   (the Mat that is handed back to the caller); free() deletes the rest. A Mat that was already deleted by hand is skipped. */
function scope() {
  const l = [];
  return {
    add(m) { if (!l.includes(m)) l.push(m); return m; },
    release(m) { const i = l.indexOf(m); if (i >= 0) l.splice(i, 1); return m; },
    free() { for (const m of l) { try { if (!m.isDeleted()) m.delete(); } catch (e) { /* gone already */ } } l.length = 0; }
  };
}

/* red channel (8-bit, RGBA input) scaled to height H0 with INTER_AREA, returned as 32-bit float Mat */
function redScaled(cv, rgba, w, h) {
  const S = scope();
  try {
  const red = S.add(new cv.Mat(h, w, cv.CV_8U));
  const r = red.data;
  // research switch INKCH (node only): which colour part of the scan the ink map is made from. Default 'r' = red channel (red print nearly disappears);
  // 'g' = green channel, 'min' = darkest of red, green, blue per pixel (sees black AND red print as ink)
  const ch = (typeof process !== 'undefined' && process.env && process.env.INKCH) || 'r';
  if (ch === 'min') for (let i = 0, j = 0; i < r.length; i++, j += 4) r[i] = Math.min(rgba[j], rgba[j + 1], rgba[j + 2]);
  else if (ch === 'g') for (let i = 0, j = 0; i < r.length; i++, j += 4) r[i] = rgba[j + 1];
  else for (let i = 0, j = 0; i < r.length; i++, j += 4) r[i] = rgba[j];
  const s = H0 / h;
  const out8 = S.add(new cv.Mat());
  if (h === H0) red.copyTo(out8);                       // already at the working height (the browser worker scales while decoding)
  else cv.resize(red, out8, new cv.Size(Math.round(w * s), H0), 0, 0, cv.INTER_AREA);
  const out = S.add(new cv.Mat());
  out8.convertTo(out, cv.CV_32F);
  return S.release(out);
  } finally { S.free(); }
}

/* 0.15.0: the darkest of red, green and blue per pixel, scaled like redScaled - black AND red (or other coloured) print are dark in it.
   Used only to find lines of print beside the block of text (extendBoxByHeadLines); the alignment itself keeps the red channel (A6/B5). */
function darkScaled(cv, rgba, w, h) {
  const S = scope();
  try {
    const m8 = S.add(new cv.Mat(h, w, cv.CV_8U)), r = m8.data;
    for (let i = 0, j = 0; i < r.length; i++, j += 4) { const a = rgba[j], b = rgba[j + 1], c = rgba[j + 2]; r[i] = a < b ? (a < c ? a : c) : (b < c ? b : c); }
    const out8 = S.add(new cv.Mat());
    if (h === H0) m8.copyTo(out8); else cv.resize(m8, out8, new cv.Size(Math.round(w * H0 / h), H0), 0, 0, cv.INTER_AREA);
    const out = S.add(new cv.Mat()); out8.convertTo(out, cv.CV_32F);
    return S.release(out);
  } finally { S.free(); }
}

/* Otsu threshold of a uint8 array (OpenCV's own, via a Mat) */
function otsu(cv, u8, rows, cols) {
  const S = scope();
  try {
    const m = S.add(new cv.Mat(rows, cols, cv.CV_8U)); m.data.set(u8);
    const d = S.add(new cv.Mat());
    return cv.threshold(m, d, 0, 255, cv.THRESH_OTSU);
  } finally { S.free(); }
}

/* ink map: 1 = printed ink, 0 = paper (32-bit float Mat, same size as r) */
function inkMap(cv, r) {
  const S = scope();
  try {
  const h = r.rows, w = r.cols;
  const dil = S.add(new cv.Mat());
  const k15 = S.add(ones(cv, 15, 15));
  cv.dilate(r, dil, k15);
  const paper = S.add(smoothBlur(cv, dil, 25));
  const n = S.add(new cv.Mat(h, w, cv.CV_32F));
  const rd = r.data32F, pd = paper.data32F, nd = n.data32F;
  for (let i = 0; i < nd.length; i++) {
    const v = rd[i] / Math.max(pd[i], 1);
    nd[i] = v < 0 ? 0 : (v > 1.2 ? 1.2 : v);
  }
  // Otsu from the central half (nd is re-read after the allocations below)
  const y0 = Math.floor(h / 4), y1 = Math.floor(3 * h / 4), x0 = Math.floor(w / 4), x1 = Math.floor(3 * w / 4);
  const ch = y1 - y0, cw = x1 - x0, cen = new Uint8Array(ch * cw);
  for (let y = 0, p = 0; y < ch; y++) for (let x = 0; x < cw; x++, p++) {
    let v = nd[(y + y0) * w + x + x0]; v = v < 0 ? 0 : (v > 1 ? 1 : v);
    cen[p] = Math.floor(v * 255);          // same as numpy astype(uint8)
  }
  const t = otsu(cv, cen, ch, cw) / 255;
  const k = S.add(new cv.Mat());
  cv.GaussianBlur(n, k, new cv.Size(0, 0), 0.7);
  const out = S.add(new cv.Mat(h, w, cv.CV_32F));
  const kd = k.data32F, od = out.data32F;      // views are taken after the last allocation (WebAssembly memory may move on growth)
  const den = 0.5 * (1 - t) + 1e-4;
  for (let i = 0; i < od.length; i++) {
    const v = 0.5 + (t - kd[i]) / den * 0.5;
    od[i] = v < 0 ? 0 : (v > 1 ? 1 : v);
  }
  return S.release(out);
  } finally { S.free(); }
}

/* Gaussian blur for very smooth results (sigma 25): done on a picture 4 times smaller, then enlarged again.
   About 10 times faster than blurring at full size; the difference is far below what the later thresholds can see. */
function smoothBlur(cv, src, sigma) {
  const S = scope(), f = 4, small = S.add(new cv.Mat()), blurred = S.add(new cv.Mat()), dst = S.add(new cv.Mat());
  try {
    cv.resize(src, small, new cv.Size(Math.floor(src.cols / f), Math.floor(src.rows / f)), 0, 0, cv.INTER_AREA);
    cv.GaussianBlur(small, blurred, new cv.Size(0, 0), sigma / f);
    cv.resize(blurred, dst, new cv.Size(src.cols, src.rows), 0, 0, cv.INTER_LINEAR);
    return S.release(dst);
  } finally { S.free(); }
}

function mask8(cv, rows, cols) { return new cv.Mat(rows, cols, cv.CV_8U); }

/* bitwise or of two 8-bit masks into a new Mat */
function or8(cv, a, b) { const o = new cv.Mat(); cv.bitwise_or(a, b, o); return o; }

/* the box (x0, y0, x1, y1) of the printed area at height H0 */
function printedBox(cv, r, opts = {}) {
  const S = scope();
  try { return printedBoxIn(cv, r, S, opts); } finally { S.free(); }
}
/* opts.border (A4): fraction of the picture along every edge whose ink is ignored (a dark scan border or ruler must not shape the box) */
function printedBoxIn(cv, r, S, opts) {
  const Hh = r.rows, Ww = r.cols;
  const aMat = S.add(inkMap(cv, r));
  if (opts.border > 0) {
    const bx = Math.round(opts.border * Ww), by = Math.round(opts.border * Hh), a = aMat.data32F;
    for (let y = 0; y < Hh; y++) for (let x = 0; x < Ww; x++) if (x < bx || x >= Ww - bx || y < by || y >= Hh - by) a[y * Ww + x] = 0;
  }
  // 1. big dark blobs touching the border (table, cover, spine shadow)
  {
    const dark = S.add(mask8(cv, Hh, Ww)), rd = r.data32F, dd = dark.data;
    for (let i = 0; i < dd.length; i++) dd[i] = rd[i] < 60 ? 1 : 0;
    const lab = S.add(new cv.Mat()), st = S.add(new cv.Mat()), cen = S.add(new cv.Mat());
    const nl = cv.connectedComponentsWithStats(dark, lab, st, cen, 8);
    const kill = new Uint8Array(nl);
    for (let i = 1; i < nl; i++) {
      const x = st.intAt(i, 0), y = st.intAt(i, 1), w = st.intAt(i, 2), h = st.intAt(i, 3), ar = st.intAt(i, 4);
      if (ar > 20000 && (x <= 2 || y <= 2 || x + w >= Ww - 2 || y + h >= Hh - 2)) kill[i] = 1;
    }
    const ld = lab.data32S, a = aMat.data32F;
    for (let i = 0; i < ld.length; i++) if (kill[ld[i]]) a[i] = 0;
    dark.delete(); lab.delete(); st.delete(); cen.delete();
  }
  // 2. long thin straight lines (page edges, frames, staff lines) are not used; thick black areas are kept
  //    (the long rectangle filters come from rectmorph.js: much faster than OpenCV.js for long kernels, same result)
  const N = Hh * Ww;
  let b = new Uint8Array(N);
  { const a = aMat.data32F; for (let i = 0; i < N; i++) b[i] = a[i] > 0.5 ? 1 : 0; }
  const bMat = S.add(new cv.Mat(Hh, Ww, cv.CV_8U)); bMat.data.set(b);
  const e9 = S.add(cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(9, 9))), tmpM = S.add(new cv.Mat());
  cv.morphologyEx(bMat, tmpM, cv.MORPH_OPEN, e9);
  const thick = dilateRect(new Uint8Array(tmpM.data), Ww, Hh, 7, 7);
  const Ln = 250;
  const lh = openRect(dilateRect(b, Ww, Hh, 7, 1), Ww, Hh, 1, Ln);
  const lv = openRect(dilateRect(b, Ww, Hh, 1, 7), Ww, Hh, Ln, 1);
  for (let i = 0; i < N; i++) lh[i] |= lv[i];
  const lines = dilateRect(lh, Ww, Hh, 9, 9);
  { const a = aMat.data32F; for (let i = 0; i < N; i++) if (lines[i] && !thick[i]) a[i] = 0; }
  // 2b. long thick bands (scanner/board edges, page-edge shadows, frames)
  const bandA = openRect(b, Ww, Hh, 1200, 15), bandB = openRect(b, Ww, Hh, 15, 1000);
  for (let i = 0; i < N; i++) bandA[i] |= bandB[i];
  const bands = dilateRect(bandA, Ww, Hh, 21, 21);
  { const a = aMat.data32F; for (let i = 0; i < N; i++) if (bands[i]) a[i] = 0; }
  // 3. density of what is left, joined into regions; thin leftovers removed
  const bl = S.add(smoothBlur(cv, aMat, 25));
  let bw = new Uint8Array(N);
  { const bld = bl.data32F; for (let i = 0; i < N; i++) bw[i] = bld[i] > 0.06 ? 1 : 0; }
  bw = closeRect(bw, Ww, Hh, 61, 61); bw = openRect(bw, Ww, Hh, 101, 101);
  const tmp2 = S.add(new cv.Mat(Hh, Ww, cv.CV_8U)); tmp2.data.set(bw);
  const lab = S.add(new cv.Mat()), st = S.add(new cv.Mat()), cen = S.add(new cv.Mat());
  const nl = cv.connectedComponentsWithStats(tmp2, lab, st, cen, 8);
  let box;
  if (nl < 2) box = [0, 0, Ww, Hh];
  else {
    const S = (i, j) => st.intAt(i, j);
    const touches = i => S(i, 0) <= 2 || S(i, 1) <= 2 || S(i, 0) + S(i, 2) >= Ww - 2 || S(i, 1) + S(i, 3) >= Hh - 2;
    let cand = []; for (let i = 1; i < nl; i++) if (!touches(i)) cand.push(i);
    let bi, pool;
    const biggest = list => list.reduce((m, i) => S(i, 4) > S(m, 4) ? i : m, list[0]);
    if (cand.length) { bi = biggest(cand); pool = cand; }
    else { pool = []; for (let i = 1; i < nl; i++) pool.push(i); bi = biggest(pool); }
    const bx0 = S(bi, 0), bx1 = S(bi, 0) + S(bi, 2);
    const keep = [bi];
    for (const i of pool) {
      if (i === bi || S(i, 4) < 0.05 * S(bi, 4)) continue;
      const overlap = Math.min(bx1, S(i, 0) + S(i, 2)) - Math.max(bx0, S(i, 0));
      if (overlap >= 0.5 * S(i, 2)) keep.push(i);
    }
    box = [
      Math.min(...keep.map(i => S(i, 0))), Math.min(...keep.map(i => S(i, 1))),
      Math.max(...keep.map(i => S(i, 0) + S(i, 2))), Math.max(...keep.map(i => S(i, 1) + S(i, 3)))
    ];
  }
  return box;
}

/* A1 (20 Nov 2026): staves are long thin lines, so printedBox removes them and can lose staves that carry few notes (the lowest system of a page,
   or the top half of a page whose lower staves are full). This stretches the box vertically over the rows in which at least 45 % of the box width is ink
   (a staff line, even if short notes sit on it), ignoring the outer 3 % of the image where page edges give long lines (ref = ink map).
   NEW: (1) only thin rows count (a run of such rows thicker than 12 px is a dark band, shadow or ruler at the page edge, not a staff line); (2) the stretch
   only goes on while the next such row lies within `gap` pixels (3 % of the height) of the last one, so it follows a staff system that hangs on the box but
   no longer jumps to a far-away row. The old version, which took every such row of the page, made the Antiphonarium pair worse (0.6 % -> 12.4 % unmatched);
   a first contiguous version still reached the dark page edge on Liber f.8 D-ARk (1.1 % -> 9.8 % unmatched) until (1) was added. */
function extendBoxByStaves(box, ref, gapFrac = 0.03) {
  const [x0, y0, x1, y1] = box, w = ref.cols, h = ref.rows, d = ref.data32F, need = 0.45 * (x1 - x0), margin = Math.round(0.03 * h), gap = Math.round(gapFrac * h);
  const q = new Uint8Array(h);
  for (let y = margin; y < h - margin; y++) { let c = 0; for (let x = x0; x < x1; x++) if (d[y * w + x] > 0.5) c++; q[y] = c >= need ? 1 : 0; }
  for (let y = 0; y < h;) { if (!q[y]) { y++; continue; } let e = y; while (e < h && q[e]) e++; if (e - y > 12) q.fill(0, y, e); y = e; }
  let sy0 = y0, sy1 = y1;
  for (let y = y0 - 1, last = y0; y >= margin && last - y <= gap; y--) if (q[y]) { sy0 = y; last = y; }
  for (let y = y1 + 1, last = y1; y < h - margin && y - last <= gap; y++) if (q[y]) { sy1 = y; last = y; }
  return [x0, sy0, x1, sy1];
}

/* 0.15.0 (owner, 26 Nov 2026: the Winterburger Antiphonarius never had its folio number and headline inside the printed area). A headline, a folio
   number, a catchword or a signature - a line or a few lines of print just above or below the block of text - belong to the printed area, but
   printedBox leaves them out: one line is too thin for its density regions (the 101 px opening), and red print hardly shows in the red channel.
   This adds them, from the darkest-channel picture (dark, see darkScaled): ink without long straight lines (rules, staff lines, page edges), in
   the band up to `up` (12 %) of the height above the box and `down` (6 %) below it; only pieces whose middle lies across the width of the box,
   that do not run into the sides of the band (a sliver of the next page, a page edge), and that are text-sized (not dust: 21 px high or 300 px
   of ink); a round or oval stamp (a large hollow ring) is left out with everything inside it. A piece joins while it lies within `gap` (4.5 % of the height) of the box or of a piece already taken, so a far-away mark does not.
   Returns { box, top, bottom } (top / bottom: how many pixels were added there). */
function extendBoxByHeadLines(cv, box, dark, o = {}) {
  const up = o.up != null ? o.up : 0.12, down = o.down != null ? o.down : 0.06, gapF = o.gap != null ? o.gap : 0.045;
  const W = dark.cols, H = dark.rows, [bx0, by0, bx1, by1] = box;
  const tol = Math.round(0.03 * W), gap = Math.round(gapF * H), ex = Math.round(0.02 * W), ey = Math.round(0.02 * H), minH = Math.round(0.007 * H);
  const zx0 = Math.max(ex, bx0 - tol), zx1 = Math.min(W - ex, bx1 + tol), zw = zx1 - zx0;
  if (zw < 100) return { box, top: 0, bottom: 0 };
  const S = scope();
  try {
    const ink = S.add(inkMap(cv, dark)), d = ink.data32F;
    // the pieces of print in rows ya..yb (within the band zx0..zx1), long straight lines taken out first
    const pieces = (ya, yb) => {
      const zh = yb - ya; if (zh < 8) return [];
      let b = new Uint8Array(zw * zh);
      for (let y = 0; y < zh; y++) for (let x = 0; x < zw; x++) b[y * zw + x] = d[(y + ya) * W + x + zx0] > 0.5 ? 1 : 0;
      const lh = openRect(dilateRect(b, zw, zh, 7, 1), zw, zh, 1, Math.min(250, Math.round(zw * 0.5)));
      const lv = openRect(dilateRect(b, zw, zh, 1, 7), zw, zh, Math.min(150, Math.round(zh * 0.7)), 1);
      for (let i = 0; i < lh.length; i++) lh[i] |= lv[i];
      const lines = dilateRect(lh, zw, zh, 5, 5);
      for (let i = 0; i < b.length; i++) if (lines[i]) b[i] = 0;
      const m = S.add(new cv.Mat(zh, zw, cv.CV_8U)); m.data.set(b);
      const lab = S.add(new cv.Mat()), st = S.add(new cv.Mat()), cen = S.add(new cv.Mat());
      const n = cv.connectedComponentsWithStats(m, lab, st, cen, 8), out = [], rings = [];
      for (let i = 1; i < n; i++) {
        const x = st.intAt(i, 0), y = st.intAt(i, 1), w = st.intAt(i, 2), h = st.intAt(i, 3), a = st.intAt(i, 4);
        if (x <= 1 || x + w >= zw - 1) continue;                                          // runs into the side of the band
        // a library stamp (owner's scans: round or oval, often red or violet, so it shows in this picture): a large hollow ring - left out,
        // with everything inside it
        if (h > 0.035 * H && w > 0.5 * h && w < 2.2 * h && a < 0.35 * w * h) { rings.push([zx0 + x, ya + y, zx0 + x + w, ya + y + h]); continue; }
        const mid = zx0 + x + w / 2; if (mid < bx0 || mid > bx1) continue;                 // its middle is not across the box
        if (h > 0.06 * H) continue;                                                        // a big blot, not a line of print
        if (h < minH && a < 300) continue;                                                 // dust
        out.push({ x0: zx0 + x, x1: zx0 + x + w, y0: ya + y, y1: ya + y + h, a });
      }
      m.delete(); lab.delete(); st.delete(); cen.delete();
      return out.filter(p => !rings.some(r => (p.x0 + p.x1) / 2 >= r[0] && (p.x0 + p.x1) / 2 <= r[2] && (p.y0 + p.y1) / 2 >= r[1] && (p.y0 + p.y1) / 2 <= r[3]));
    };
    let nx0 = bx0, ny0 = by0, nx1 = bx1, ny1 = by1;
    // above
    {
      const P = pieces(Math.max(ey, by0 - Math.round(up * H)), by0), used = new Set();
      let cur = by0, moved = true, area = 0;
      while (moved) { moved = false; for (let i = 0; i < P.length; i++) if (!used.has(i) && P[i].y1 >= cur - gap) { used.add(i); area += P[i].a; if (P[i].y0 < cur) { cur = P[i].y0; moved = true; } } }
      if (used.size && area >= 250 && cur < by0) {
        ny0 = Math.max(0, cur - 6);
        for (const i of used) { nx0 = Math.min(nx0, P[i].x0 - 4); nx1 = Math.max(nx1, P[i].x1 + 4); }
      }
    }
    // below
    {
      const P = pieces(by1, Math.min(H - ey, by1 + Math.round(down * H))), used = new Set();
      let cur = by1, moved = true, area = 0;
      while (moved) { moved = false; for (let i = 0; i < P.length; i++) if (!used.has(i) && P[i].y0 <= cur + gap) { used.add(i); area += P[i].a; if (P[i].y1 > cur) { cur = P[i].y1; moved = true; } } }
      if (used.size && area >= 250 && cur > by1) {
        ny1 = Math.min(H, cur + 6);
        for (const i of used) { nx0 = Math.min(nx0, P[i].x0 - 4); nx1 = Math.max(nx1, P[i].x1 + 4); }
      }
    }
    nx0 = Math.max(0, nx0); nx1 = Math.min(W, nx1);
    return { box: [nx0, ny0, nx1, ny1], top: by0 - ny0, bottom: ny1 - by1 };
  } finally { S.free(); }
}

module.exports = { H0, redScaled, darkScaled, inkMap, printedBox, smoothBlur, extendBoxByStaves, extendBoxByHeadLines, scope };
