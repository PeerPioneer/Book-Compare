'use strict';
/* usage: node run_rough.js ref.jpg other.jpg [q] [fast]   -> prints W, scores and times; compare with research/rough_align.py */
const fs = require('fs'), jpeg = require('jpeg-js');
(async () => {
  let cv = require('@techstark/opencv-js');
  if (cv instanceof Promise) cv = await cv; else if (typeof cv.then === 'function') cv = await new Promise(r => cv.then(x => { delete x.then; r(x); }));
  const { redScaled, inkMap, printedBox } = require('./printed_area');
  const { roughAlign, warp } = require('./rough_align');
  const load = p => { const i = jpeg.decode(fs.readFileSync(p), { useTArray: true, maxMemoryUsageInMB: 2048 }); return redScaled(cv, i.data, i.width, i.height); };
  const q = +(process.argv[4] || 1), fast = process.argv[5] === 'fast';
  const T = () => Date.now();
  let t = T();
  const rr = load(process.argv[2]), rm = load(process.argv[3]);
  const box = printedBox(cv, rr);
  const ref = inkMap(cv, rr), mov = inkMap(cv, rm);
  const tPrep = (T() - t) / 1000; t = T();
  const res = roughAlign(cv, ref, mov, box, { q, fastScales: fast });
  const tRough = (T() - t) / 1000;
  // unmatched ink share, like align_pair.py
  const warped = warp(cv, mov, res.W, ref.cols, ref.rows);
  const A = new cv.Mat(), B = new cv.Mat(), Bd = new cv.Mat(), Ad = new cv.Mat();
  const bin = (m, o) => { const d = new cv.Mat(); cv.threshold(m, d, 0.5, 1, cv.THRESH_BINARY); d.convertTo(o, cv.CV_8U); d.delete(); };
  bin(ref, A); bin(warped, B);
  const K = cv.Mat.ones(3, 3, cv.CV_8U); cv.dilate(B, Bd, K); cv.dilate(A, Ad, K);
  let ua = 0, ub = 0, na = 0, nb = 0; const w = ref.cols, [x0, y0, x1, y1] = box;
  const a = A.data, b = B.data, ad = Ad.data, bd = Bd.data;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = y * w + x; na += a[i]; nb += b[i]; if (a[i] && !bd[i]) ua++; if (b[i] && !ad[i]) ub++; }
  const unmatched = (ua + ub) / Math.max(1, na + nb);
  console.log(JSON.stringify({ q, fast, scale: +res.scale.toFixed(2), score: +res.score.toFixed(3), ecc: +res.ecc.toFixed(3),
    unmatched_pct: +(100 * unmatched).toFixed(1), W: res.W.map(v => +v.toFixed(4)), prep_s: tPrep, rough_s: tRough }));
})().catch(e => { console.error(e); process.exit(1); });
