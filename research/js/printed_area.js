'use strict';
/* Step 1 of the alignment experiment: printed-area detection, ported from research/ink_map.py and
   research/printed_area.py to OpenCV.js. Same recipe, same numbers, so the results can be compared box by box. */
const { dilateRect, openRect, closeRect } = require('./rectmorph');
const H0 = 3000;

function ones(cv, rows, cols) { return cv.Mat.ones(rows, cols, cv.CV_8U); }

/* red channel (8-bit, RGBA input) scaled to height H0 with INTER_AREA, returned as 32-bit float Mat */
function redScaled(cv, rgba, w, h) {
  const red = new cv.Mat(h, w, cv.CV_8U);
  const r = red.data;
  for (let i = 0, j = 0; i < r.length; i++, j += 4) r[i] = rgba[j];
  const s = H0 / h;
  const out8 = new cv.Mat();
  cv.resize(red, out8, new cv.Size(Math.round(w * s), H0), 0, 0, cv.INTER_AREA);
  const out = new cv.Mat();
  out8.convertTo(out, cv.CV_32F);
  red.delete(); out8.delete();
  return out;
}

/* Otsu threshold of a uint8 array (OpenCV's own, via a Mat) */
function otsu(cv, u8, rows, cols) {
  const m = new cv.Mat(rows, cols, cv.CV_8U); m.data.set(u8);
  const d = new cv.Mat();
  const t = cv.threshold(m, d, 0, 255, cv.THRESH_OTSU);
  m.delete(); d.delete();
  return t;
}

/* ink map: 1 = printed ink, 0 = paper (32-bit float Mat, same size as r) */
function inkMap(cv, r) {
  const h = r.rows, w = r.cols;
  const dil = new cv.Mat();
  const k15 = ones(cv, 15, 15);
  cv.dilate(r, dil, k15);
  const paper = smoothBlur(cv, dil, 25);
  const n = new cv.Mat(h, w, cv.CV_32F);
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
  const k = new cv.Mat();
  cv.GaussianBlur(n, k, new cv.Size(0, 0), 0.7);
  const out = new cv.Mat(h, w, cv.CV_32F);
  const kd = k.data32F, od = out.data32F;      // views are taken after the last allocation (WebAssembly memory may move on growth)
  const den = 0.5 * (1 - t) + 1e-4;
  for (let i = 0; i < od.length; i++) {
    const v = 0.5 + (t - kd[i]) / den * 0.5;
    od[i] = v < 0 ? 0 : (v > 1 ? 1 : v);
  }
  dil.delete(); paper.delete(); n.delete(); k.delete(); k15.delete();
  return out;
}

/* Gaussian blur for very smooth results (sigma 25): done on a picture 4 times smaller, then enlarged again.
   About 10 times faster than blurring at full size; the difference is far below what the later thresholds can see. */
function smoothBlur(cv, src, sigma) {
  const f = 4, small = new cv.Mat(), blurred = new cv.Mat(), dst = new cv.Mat();
  cv.resize(src, small, new cv.Size(Math.floor(src.cols / f), Math.floor(src.rows / f)), 0, 0, cv.INTER_AREA);
  cv.GaussianBlur(small, blurred, new cv.Size(0, 0), sigma / f);
  cv.resize(blurred, dst, new cv.Size(src.cols, src.rows), 0, 0, cv.INTER_LINEAR);
  small.delete(); blurred.delete();
  return dst;
}

function mask8(cv, rows, cols) { return new cv.Mat(rows, cols, cv.CV_8U); }

/* bitwise or of two 8-bit masks into a new Mat */
function or8(cv, a, b) { const o = new cv.Mat(); cv.bitwise_or(a, b, o); return o; }

/* the box (x0, y0, x1, y1) of the printed area at height H0 */
function printedBox(cv, r) {
  const Hh = r.rows, Ww = r.cols;
  const aMat = inkMap(cv, r);
  // 1. big dark blobs touching the border (table, cover, spine shadow)
  {
    const dark = mask8(cv, Hh, Ww), rd = r.data32F, dd = dark.data;
    for (let i = 0; i < dd.length; i++) dd[i] = rd[i] < 60 ? 1 : 0;
    const lab = new cv.Mat(), st = new cv.Mat(), cen = new cv.Mat();
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
  const bMat = new cv.Mat(Hh, Ww, cv.CV_8U); bMat.data.set(b);
  const e9 = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(9, 9)), tmpM = new cv.Mat();
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
  const bl = smoothBlur(cv, aMat, 25);
  let bw = new Uint8Array(N);
  { const bld = bl.data32F; for (let i = 0; i < N; i++) bw[i] = bld[i] > 0.06 ? 1 : 0; }
  bw = closeRect(bw, Ww, Hh, 61, 61); bw = openRect(bw, Ww, Hh, 101, 101);
  const tmp2 = new cv.Mat(Hh, Ww, cv.CV_8U); tmp2.data.set(bw);
  const lab = new cv.Mat(), st = new cv.Mat(), cen = new cv.Mat();
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
  for (const m of [aMat, bMat, tmpM, tmp2, e9, bl, lab, st, cen]) m.delete();
  return box;
}

module.exports = { H0, redScaled, inkMap, printedBox };
