'use strict';
/* The whole alignment chain for one pair of scans (printed area -> ink maps -> rough -> tiles), shared by the run and check scripts. */
const fs = require('fs'), jpeg = require('jpeg-js');
const { redScaled, inkMap, printedBox } = require('./printed_area');
const { roughAlign, warp } = require('./rough_align');
const { tileAlign } = require('./tile_align');

async function loadCv() {
  let cv = require('@techstark/opencv-js');
  if (cv instanceof Promise) cv = await cv;
  else if (typeof cv.then === 'function') cv = await new Promise(r => cv.then(x => { delete x.then; r(x); }));
  else if (!cv.Mat) await new Promise(r => { cv.onRuntimeInitialized = r; });
  return cv;
}

function loadRed(cv, p) {
  const i = jpeg.decode(fs.readFileSync(p), { useTArray: true, maxMemoryUsageInMB: 2048 });
  return redScaled(cv, i.data, i.width, i.height);
}

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

/* ref and other: paths to scans. Returns {ref, rough, aligned (ink maps), box, tbox, W, stats, times} */
function alignPair(cv, refPath, movPath, refCache) {
  const T = () => Date.now(), tm = {}; let t = T();
  const cache = refCache || {};
  if (!cache.ref) {
    const rr = loadRed(cv, refPath); tm.decode_ref_s = (T() - t) / 1000; t = T();
    cache.box = printedBox(cv, rr); tm.box_s = (T() - t) / 1000; t = T();
    cache.ref = inkMap(cv, rr); rr.delete(); tm.ink_ref_s = (T() - t) / 1000;
  }
  t = T();
  const rm = loadRed(cv, movPath); tm.decode_s = (T() - t) / 1000; t = T();
  const mov = inkMap(cv, rm); rm.delete(); tm.ink_s = (T() - t) / 1000; t = T();
  const { ref, box } = cache;
  const res = roughAlign(cv, ref, mov, box, { q: 4, fastScales: true }); tm.rough_s = (T() - t) / 1000; t = T();
  const rough = warp(cv, mov, res.W, ref.cols, ref.rows);
  const [x0, y0, x1, y1] = box, w = ref.cols, h = ref.rows;
  const m = Math.max(60, Math.floor(0.02 * Math.max(x1 - x0, y1 - y0)));
  const tbox = [Math.max(60, x0 - m), Math.min(w - 60, x1 + m), Math.max(60, y0 - m), Math.min(h - 60, y1 + m)];
  t = T();
  const { aligned, stats } = tileAlign(cv, ref, rough, tbox); tm.tiles_s = (T() - t) / 1000;
  mov.delete();
  return { ref, rough, aligned, box, tbox, W: res.W, stats, times: tm, cache };
}

function overlayJpeg(cv, ref, aligned, path, scale = 0.3, crop = null) {
  const w = ref.cols, h = ref.rows, r = ref.data32F, g = aligned.data32F, rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) { const a = Math.min(1, Math.max(0, r[i])), b = Math.min(1, Math.max(0, g[i])); rgba[4 * i] = 255 - 255 * b; rgba[4 * i + 1] = 255 - 255 * Math.max(a, b); rgba[4 * i + 2] = 255 - 255 * a; rgba[4 * i + 3] = 255; }
  let big = new cv.Mat(h, w, cv.CV_8UC4); big.data.set(rgba); const sm = new cv.Mat();
  if (crop) { const c = big.roi(new cv.Rect(crop[0], crop[1], crop[2] - crop[0], crop[3] - crop[1])); big = c.clone(); c.delete(); }
  cv.resize(big, sm, new cv.Size(Math.round(big.cols * scale), Math.round(big.rows * scale)), 0, 0, cv.INTER_AREA);
  fs.writeFileSync(path, jpeg.encode({ data: Buffer.from(sm.data), width: sm.cols, height: sm.rows }, 88).data);
  big.delete(); sm.delete();
}

module.exports = { loadCv, loadRed, alignPair, unmatchedShare, overlayJpeg };
