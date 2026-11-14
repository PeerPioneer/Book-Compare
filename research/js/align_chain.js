'use strict';
/* The whole alignment chain for one pair of scans (printed area -> ink maps -> rough -> tiles), shared by the run and check scripts. */
const fs = require('fs'), jpeg = require('jpeg-js');
const { redScaled } = require('./printed_area');
const { prepareReference, alignCopy, unmatchedShare } = require('./pipeline');

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

/* ref and other: paths to scans. Returns {ref, rough, aligned (ink maps), box, tbox, W, stats, times} */
function alignPair(cv, refPath, movPath, refCache) {
  const T = () => Date.now(), tm = {}; let t = T();
  const cache = refCache || {};
  if (!cache.state) {
    const rr = loadRed(cv, refPath); tm.decode_ref_s = (T() - t) / 1000;
    cache.state = prepareReference(cv, rr); rr.delete(); Object.assign(tm, cache.state.times);
  }
  t = T();
  const rm = loadRed(cv, movPath); tm.decode_s = (T() - t) / 1000;
  const r = alignCopy(cv, cache.state, rm, { keepRough: true }); rm.delete(); Object.assign(tm, r.times);
  return { ref: cache.state.ref, rough: r.rough, aligned: r.aligned, box: cache.state.box, tbox: r.tbox, W: r.W, stats: r.stats, times: tm, cache };
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
