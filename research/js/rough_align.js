'use strict';
/* Step 2 of the alignment experiment: rough (whole-page) alignment, ported from research/rough_align.py.
   Finds scale + rotation/shear + shift (an affine transform, W = 2x3 array, reference -> other scan) that brings the
   second scan onto the reference.  Option q (1, 2, 4 ...): the iterative refinement (ECC) runs on pictures q times
   smaller, which is much faster; q = 1 is the faithful port. */
const { smoothBlur } = require('./printed_area');
const { closeRect } = require('./rectmorph');

function gauss(cv, src, sigma) { const d = new cv.Mat(); cv.GaussianBlur(src, d, new cv.Size(0, 0), sigma); return d; }
function blur(cv, src, sigma) { return sigma >= 12 ? smoothBlur(cv, src, sigma) : gauss(cv, src, sigma); }
function scaled(cv, src, f, interp) {
  const d = new cv.Mat(); cv.resize(src, d, new cv.Size(Math.round(src.cols * f), Math.round(src.rows * f)), 0, 0, interp); return d;
}
function compose(A, B) {   // [A;0 0 1] * [B;0 0 1], top two rows
  return [A[0] * B[0] + A[1] * B[3], A[0] * B[1] + A[1] * B[4], A[0] * B[2] + A[1] * B[5] + A[2],
          A[3] * B[0] + A[4] * B[3], A[3] * B[1] + A[4] * B[4], A[3] * B[2] + A[4] * B[5] + A[5]];
}
function matOf(cv, W) { const m = new cv.Mat(2, 3, cv.CV_32F); m.data32F.set(W); return m; }
function warp(cv, src, W, w, h) {
  const m = matOf(cv, W), d = new cv.Mat();
  cv.warpAffine(src, d, m, new cv.Size(w, h), cv.INTER_LINEAR | cv.WARP_INVERSE_MAP, cv.BORDER_CONSTANT, new cv.Scalar(0));
  m.delete(); return d;
}

/* local correlation of two pictures (window sigma s) */
function localCorrelation(cv, a, b, s) {
  const n = a.data32F.length, rows = a.rows, cols = a.cols;
  const mul = (x, y) => { const o = new cv.Mat(); cv.multiply(x, y, o); return o; };
  const A = blur(cv, a, s), B = blur(cv, b, s);
  const ab = mul(a, b), aa = mul(a, a), bb = mul(b, b);
  const Bab = blur(cv, ab, s), Baa = blur(cv, aa, s), Bbb = blur(cv, bb, s);
  const out = new cv.Mat(rows, cols, cv.CV_32F);
  const A_ = A.data32F, B_ = B.data32F, ab_ = Bab.data32F, aa_ = Baa.data32F, bb_ = Bbb.data32F, o = out.data32F;
  for (let i = 0; i < n; i++) {
    const cab = ab_[i] - A_[i] * B_[i], va = aa_[i] - A_[i] * A_[i], vb = bb_[i] - B_[i] * B_[i];
    o[i] = cab / Math.sqrt(Math.max(va * vb, 1e-6));
  }
  for (const m of [A, B, ab, aa, bb, Bab, Baa, Bbb]) m.delete();
  return out;
}

/* A7 (20 Nov 2026): stop a refinement round when it improves the match (the correlation coefficient) by less than ECC_EPS.
   It used to be 1e-6. On two copies whose page is set differently from the reference (F-Pm, D-Rs on Liber f.4r) the refinement then
   ran for about 60 rounds of 55 ms in each of the three whole-page stages (8-9 s); with 1e-4 the rough step takes 4-5 s and the
   result is the same or slightly better (unmatched ink after the tiles: F-Pm 16.0 -> 14.9 %, D-Rs 21.5 -> 21.5 %, A-Wn, D-ARk unchanged).
   A count of rounds (not a clock) is used on purpose, so that the result is the same on every computer. */
const ECC_EPS = 1e-4;

/* ECC refinement in several stages [(sigma, iterations), ...]; returns [W, cc] (cc = -1 on failure) */
function ecc(cv, ref, mov, W, mask, stages, w, h) {
  let cc = -1;
  for (const [sigma, iterations] of stages) {
    const warped = warp(cv, mov, W, w, h), br = gauss(cv, ref, sigma), bw = gauss(cv, warped, sigma);
    const C = cv.Mat.eye(2, 3, cv.CV_32F);
    const crit = new cv.TermCriteria(cv.TermCriteria_EPS | cv.TermCriteria_COUNT, iterations, ECC_EPS);
    let ok = true;
    try { cc = cv.findTransformECC(br, bw, C, cv.MOTION_AFFINE, crit, mask, 5); }
    catch (e) { ok = false; }
    const Cd = Array.from(C.data32F);
    for (const m of [warped, br, bw, C]) m.delete();
    if (!ok) return [W, -1];
    W = compose(W, Cd);
  }
  return [W, cc];
}

/* ref, mov: ink maps (32-bit float Mats, same size); box = [x0, y0, x1, y1] printed area of the reference. */
function roughAlign(cv, ref, mov, box, opts = {}) {
  const q = opts.q || 1, H = ref.rows, Wd = ref.cols;
  const [rx, ry, rx1, ry1] = box, rw = rx1 - rx, rh = ry1 - ry;
  // step 1: scale and position by template matching (at a quarter of the working resolution)
  const refB = gauss(cv, ref, 3);
  const crop = refB.roi(new cv.Rect(rx, ry, rw, rh));
  const P4 = scaled(cv, crop, 0.25, cv.INTER_AREA);
  const c = gauss(cv, mov, 3);
  const c4 = opts.fastScales ? scaled(cv, c, 0.25, cv.INTER_AREA) : null;
  let best = [-1];
  for (let k = 0; 0.70 + 0.02 * k < 1.45 - 1e-9; k++) {
    const s = 0.70 + 0.02 * k, f = 0.25 / s;
    const C4 = opts.fastScales ? scaled(cv, c4, 1 / s, cv.INTER_AREA) : scaled(cv, c, f, cv.INTER_AREA);
    if (C4.rows >= P4.rows && C4.cols >= P4.cols) {
      const r = new cv.Mat();
      cv.matchTemplate(C4, P4, r, cv.TM_CCOEFF_NORMED);
      const mm = cv.minMaxLoc(r);
      if (mm.maxVal > best[0]) best = [mm.maxVal, s, mm.maxLoc.x, mm.maxLoc.y];
      r.delete();
    }
    C4.delete();
  }
  crop.delete(); refB.delete(); P4.delete(); c.delete(); if (c4) c4.delete();
  if (best[0] < 0) throw new Error('rough alignment: reference area does not fit into the other scan at any scale');
  const [mx, s, lx, ly] = best;
  const cx = lx * 4 * s, cy = ly * 4 * s;
  let W = [s, 0, cx - s * rx, 0, s, cy - s * ry];
  // step 2 and 3: refinement with ECC on (possibly smaller) pictures
  const sw = Math.round(Wd / q), sh = Math.round(H / q);
  const refS = q === 1 ? ref : scaled(cv, ref, 1 / q, cv.INTER_AREA);
  const movS = q === 1 ? mov : scaled(cv, mov, 1 / q, cv.INTER_AREA);
  const maskS = new cv.Mat.zeros(sh, sw, cv.CV_8U);
  maskS.roi(new cv.Rect(Math.round(rx / q), Math.round(ry / q), Math.round(rw / q), Math.round(rh / q))).setTo(new cv.Scalar(1));
  const sm = (W) => [W[0], W[1], W[2] / q, W[3], W[4], W[5] / q];
  const bg = (W) => [W[0], W[1], W[2] * q, W[3], W[4], W[5] * q];
  let Ws = sm(W), cc;
  [Ws, cc] = ecc(cv, refS, movS, Ws, maskS, [[8 / q, 300], [4 / q, 300], [2 / q, 400]], sw, sh);
  for (let it = 0; it < 2; it++) {
    const warped = warp(cv, movS, Ws, sw, sh);
    const lc = localCorrelation(cv, refS, warped, 40 / q), bl = blur(cv, refS, 15 / q);
    const agree = new Uint8Array(sw * sh), l = lc.data32F, b = bl.data32F;
    for (let i = 0; i < agree.length; i++) agree[i] = (l[i] > 0.5 && b[i] > 0.08) ? 1 : 0;
    const closed = closeRect(agree, sw, sh, Math.max(1, Math.round(31 / q)) | 1, Math.max(1, Math.round(31 / q)) | 1);
    const mk = maskS.data;
    for (let i = 0; i < closed.length; i++) closed[i] &= mk[i];
    const agreeM = new cv.Mat(sh, sw, cv.CV_8U); agreeM.data.set(closed);
    const [W2, cc2] = ecc(cv, refS, movS, Ws, agreeM, [[3 / q, 300], [1.5 / q, 300]], sw, sh);
    if (cc2 > 0) { Ws = W2; cc = cc2; }
    for (const m of [warped, lc, bl, agreeM]) m.delete();
  }
  if (q !== 1) { refS.delete(); movS.delete(); }
  maskS.delete();
  return { W: bg(Ws), ecc: cc, score: mx, scale: s };
}

module.exports = { roughAlign, warp, gauss, scaled };
