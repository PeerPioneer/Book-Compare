'use strict';
/* usage: node run_full.js ref.jpg other.jpg [out_prefix]  -> printable result: unmatched ink after the rough and after the tile step, times */
const fs = require('fs'), jpeg = require('jpeg-js');
(async () => {
  let cv = require('@techstark/opencv-js');
  if (cv instanceof Promise) cv = await cv; else if (typeof cv.then === 'function') cv = await new Promise(r => cv.then(x => { delete x.then; r(x); }));
  const { redScaled, inkMap, printedBox } = require('./printed_area');
  const { roughAlign, warp } = require('./rough_align');
  const { tileAlign } = require('./tile_align');
  const load = p => { const i = jpeg.decode(fs.readFileSync(p), { useTArray: true, maxMemoryUsageInMB: 2048 }); return redScaled(cv, i.data, i.width, i.height); };
  const T = () => Date.now(); const tm = {};
  let t = T();
  const rr = load(process.argv[2]), rm = load(process.argv[3]); tm.decode_s = (T() - t) / 1000; t = T();
  const box = printedBox(cv, rr); tm.box_s = (T() - t) / 1000; t = T();
  const ref = inkMap(cv, rr), mov = inkMap(cv, rm); tm.ink_s = (T() - t) / 1000; t = T();
  const res = roughAlign(cv, ref, mov, box, { q: 4, fastScales: true }); tm.rough_s = (T() - t) / 1000; t = T();
  const rough = warp(cv, mov, res.W, ref.cols, ref.rows); tm.warp_s = (T() - t) / 1000;
  const [x0, y0, x1, y1] = box, w = ref.cols, h = ref.rows;
  const unmatched = (a_, b_) => {
    const bin = m => { const d = new cv.Mat(), o = new cv.Mat(); cv.threshold(m, d, 0.5, 1, cv.THRESH_BINARY); d.convertTo(o, cv.CV_8U); d.delete(); return o; };
    const A = bin(a_), B = bin(b_), K = cv.Mat.ones(3, 3, cv.CV_8U), Ad = new cv.Mat(), Bd = new cv.Mat();
    cv.dilate(A, Ad, K); cv.dilate(B, Bd, K);
    let ua = 0, ub = 0, na = 0, nb = 0; const a = A.data, b = B.data, ad = Ad.data, bd = Bd.data;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = y * w + x; na += a[i]; nb += b[i]; if (a[i] && !bd[i]) ua++; if (b[i] && !ad[i]) ub++; }
    for (const m of [A, B, K, Ad, Bd]) m.delete();
    return +(100 * (ua + ub) / Math.max(1, na + nb)).toFixed(1);
  };
  const uRough = unmatched(ref, rough);
  // tile box as in align_pair.py: printed area + 2 % margin (at least 60 px), at least 60 px from the border
  const m = Math.max(60, Math.floor(0.02 * Math.max(x1 - x0, y1 - y0)));
  const bx0 = Math.max(0, x0 - m), bx1 = Math.min(w, x1 + m), by0 = Math.max(0, y0 - m), by1 = Math.min(h, y1 + m);
  const tbox = [Math.max(60, bx0), Math.min(w - 60, bx1), Math.max(60, by0), Math.min(h - 60, by1)];
  t = T();
  const { aligned, stats } = tileAlign(cv, ref, rough, tbox); tm.tiles_s = (T() - t) / 1000;
  const uTile = unmatched(ref, aligned);
  console.log(JSON.stringify({ unmatched_after_rough_pct: uRough, unmatched_after_tiles_pct: uTile, times: tm, levels: stats }));
  if (process.argv[4]) {   // overlay picture: reference red, aligned copy blue (agreement dark), at 0.3 size
    const r = ref.data32F, g = aligned.data32F, rgba = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) { const a = Math.min(1, Math.max(0, r[i])), b = Math.min(1, Math.max(0, g[i])); rgba[4 * i] = 255 - 255 * a; rgba[4 * i + 1] = 255 - 255 * Math.max(a, b); rgba[4 * i + 2] = 255 - 255 * b; rgba[4 * i + 3] = 255; }
    const big = new cv.Mat(h, w, cv.CV_8UC4); big.data.set(rgba); const sm = new cv.Mat(); cv.resize(big, sm, new cv.Size(Math.round(w * 0.3), Math.round(h * 0.3)), 0, 0, cv.INTER_AREA);
    fs.writeFileSync(process.argv[4] + '_overlay.jpg', jpeg.encode({ data: Buffer.from(sm.data), width: sm.cols, height: sm.rows }, 88).data);
  }
})().catch(e => { console.error(e); process.exit(1); });
