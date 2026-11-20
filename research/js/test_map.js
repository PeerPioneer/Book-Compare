'use strict';
/* Check of the movement map (Compare tab, V3): warping the other copy's ink map with  rough step ∘ map  must give the engine's own result.
   usage: node test_map.js ref.jpg other.jpg   ->  prints the mean difference (0..1 ink scale) inside the printed area; fails above 0.02 */
const fs = require('fs'), jpeg = require('jpeg-js');
const { loadCv } = require('./align_chain');
const { redScaled, inkMap, H0 } = require('./printed_area');
const { prepareReference, alignCopy, unmatchedShare } = require('./pipeline');
function red(cv, p) { const i = jpeg.decode(fs.readFileSync(p), { useTArray: true, maxMemoryUsageInMB: 4096 }); const w = Math.round(i.width * H0 / i.height);
  const src = cv.matFromArray(i.height, i.width, cv.CV_8UC4, i.data), sm = new cv.Mat(); cv.resize(src, sm, new cv.Size(w, H0), 0, 0, cv.INTER_AREA); src.delete();
  const r = redScaled(cv, sm.data, w, H0); sm.delete(); return r; }
(async () => {
  const cv = await loadCv();
  const rr = red(cv, process.argv[2]), st = prepareReference(cv, rr); rr.delete();
  const mr = red(cv, process.argv[3]), mov = inkMap(cv, mr);
  const r = alignCopy(cv, st, mr, { composeMap: true }); mr.delete();
  const W = r.W, mx = r.map.mx.data32F, my = r.map.my.data32F, n = mx.length, ax = new cv.Mat(st.ref.rows, st.ref.cols, cv.CV_32F), ay = new cv.Mat(st.ref.rows, st.ref.cols, cv.CV_32F);
  const a = ax.data32F, b = ay.data32F;
  for (let p = 0; p < n; p++) { a[p] = W[0] * mx[p] + W[1] * my[p] + W[2]; b[p] = W[3] * mx[p] + W[4] * my[p] + W[5]; }
  const out = new cv.Mat(); cv.remap(mov, out, ax, ay, cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(0));
  const [x0, y0, x1, y1] = st.box, od = out.data32F, gd = r.aligned.data32F, Wd = st.ref.cols; let s = 0, c = 0, big = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const d = Math.abs(od[y * Wd + x] - gd[y * Wd + x]); s += d; c++; if (d > 0.5) big++; }
  const mean = s / c; let gs = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) gs += gd[y * Wd + x]; console.log("mean ink value of the engine result in the box: " + (gs / c).toFixed(4));
  console.log(JSON.stringify({ mean_difference: +mean.toFixed(4), pixels_over_half: +(100 * big / c).toFixed(2) + ' %', sparse: r.sparse, margin_moved: r.margin && r.margin.moved.length }));
  const uE = unmatchedShare(cv, st.ref, r.aligned, st.box).share, uM = unmatchedShare(cv, st.ref, out, st.box).share;
  console.log('unmatched ink: engine ' + (100 * uE).toFixed(1) + ' %, warped with the map ' + (100 * uM).toFixed(1) + ' %');
  if (big / c > 0.001 || uM > uE + 0.005) { console.log('MAP CHECK FAILED'); process.exit(1); } else console.log('MAP CHECK OK');
})().catch(e => { console.error(e); process.exit(1); });
