'use strict';
/* The alignment chain without any file handling, so that it can run in Node.js (research scripts) and in the browser's worker (app).
   Input: the red channel of a scan scaled to 3000 px height as a 32-bit float Mat (see printed_area.js: redScaled). */
const { inkMap, printedBox, extendBoxByStaves } = require('./printed_area');
const { roughAlign, warp } = require('./rough_align');
const { tileAlign } = require('./tile_align');

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/* share of ink (in the box x0,y0,x1,y1) that has no partner within 1 pixel in the other picture; as in align_pair.py */
function unmatchedShare(cv, a_, b_, box) {
  const [x0, y0, x1, y1] = box, w = a_.cols;
  const bin = m => { const d = new cv.Mat(), o = new cv.Mat(); cv.threshold(m, d, 0.5, 1, cv.THRESH_BINARY); d.convertTo(o, cv.CV_8U); d.delete(); return o; };
  const A = bin(a_), B = bin(b_), K = cv.Mat.ones(3, 3, cv.CV_8U), Ad = new cv.Mat(), Bd = new cv.Mat();
  cv.dilate(A, Ad, K); cv.dilate(B, Bd, K);
  let ua = 0, ub = 0, na = 0, nb = 0; const a = A.data, b = B.data, ad = Ad.data, bd = Bd.data;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = y * w + x; na += a[i]; nb += b[i]; if (a[i] && !bd[i]) ua++; if (b[i] && !ad[i]) ub++; }
  for (const m of [A, B, K, Ad, Bd]) m.delete();
  return { share: (ua + ub) / Math.max(1, na + nb), ink: na + nb };
}

/* reference copy: printed area and ink map (kept for all copies that are aligned onto it) */
function prepareReference(cv, red) {
  const t0 = now();
  let box = printedBox(cv, red); const t1 = now();
  const ref = inkMap(cv, red);
  if (process.env.STAFFBOX === '1') box = extendBoxByStaves(box, ref); // experiment (research notes, Odhecaton/Canti C tests): keep sparse staves inside the box
  return { ref, box, times: { box_s: (t1 - t0) / 1000, ink_ref_s: (now() - t1) / 1000 } };
}

/* aligns one more copy (red channel Mat) onto the prepared reference. Set opts.measure to also compute the unmatched-ink shares
   (not counted in the times). Returns { aligned (Mat, caller deletes), rough (Mat or null), W, tbox, stats, times, unmatched } */
function alignCopy(cv, refState, red, opts = {}) {
  const { ref, box } = refState, tm = {}; let t = now();
  const mov = inkMap(cv, red); tm.ink_s = (now() - t) / 1000; t = now();
  const res = roughAlign(cv, ref, mov, box, { q: 4, fastScales: true }); tm.rough_s = (now() - t) / 1000; t = now();
  const rough = warp(cv, mov, res.W, ref.cols, ref.rows); tm.warp_s = (now() - t) / 1000;
  const [x0, y0, x1, y1] = box, w = ref.cols, h = ref.rows;
  const m = Math.max(60, Math.floor(0.02 * Math.max(x1 - x0, y1 - y0)));
  const tbox = [Math.max(60, x0 - m), Math.min(w - 60, x1 + m), Math.max(60, y0 - m), Math.min(h - 60, y1 + m)];
  t = now();
  const { aligned, stats, field } = tileAlign(cv, ref, rough, tbox, { trackField: !!opts.trackField }); tm.tiles_s = (now() - t) / 1000;
  tm.total_s = tm.ink_s + tm.rough_s + tm.warp_s + tm.tiles_s;
  mov.delete();
  const out = { field, aligned, rough, W: res.W, tbox, stats, times: tm, ecc: res.ecc, score: res.score, scale: res.scale };
  if (opts.measure) out.unmatched = { rough: unmatchedShare(cv, ref, rough, box).share, tiles: unmatchedShare(cv, ref, aligned, box).share };
  if (!opts.keepRough) { rough.delete(); out.rough = null; }
  return out;
}

module.exports = { prepareReference, alignCopy, unmatchedShare, now };
