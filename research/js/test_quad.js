'use strict';
/* Check of the printed area set by hand (V2b, pipeline.js: quadOk, quadMask, applyQuad).
     node test_quad.js                       -> the shape is filled correctly (area, inside / outside), wrong shapes are refused
     node test_quad.js ref.jpg other.jpg     -> also a real pair: with a shape that leaves out a dark stripe added to the other copy's edge,
                                                the ink outside the shape is gone in the reference, and the alignment is not worse than without the stripe
   Exit code 1 on failure. Nothing is written anywhere. */
const P = require('./pipeline');
let fail = 0;
function check(ok, what) { if (!ok) { console.log('  FAILED: ' + what); fail++; } }
// 1. the mask of a slanted shape
const W = 400, H = 600, q = [0.1, 0.05, 0.9, 0.1, 0.85, 0.95, 0.15, 0.9];
const m = P.quadMask(W, H, q);
let n = 0; for (const v of m) n += v;
let area = 0; for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; area += q[2 * i] * W * q[2 * j + 1] * H - q[2 * j] * W * q[2 * i + 1] * H; } area = Math.abs(area) / 2;
console.log('shape: ' + n + ' pixels filled, area ' + area.toFixed(0));
check(Math.abs(n - area) / area < 0.01, 'filled area');
check(m[Math.round(0.5 * H) * W + Math.round(0.5 * W)] === 1 && m[2 * W + 2] === 0 && m[(H - 3) * W + W - 3] === 0, 'inside / outside');
check(P.quadOk(q) && !P.quadOk([0, 0, 1, 0, 1, 1]) && !P.quadOk([0, 0, 0.01, 0, 0.01, 0.01, 0, 0.01]) && !P.quadOk([0, 0, 2, 0, 1, 1, 0, 1]) && !P.quadOk(null), 'shapes that are refused');

(async () => {
  if (process.argv[3]) {
    const fs = require('fs'), jpeg = require('jpeg-js');
    const { loadCv } = require('./align_chain');
    const { redScaled, H0 } = require('./printed_area');
    const cv = await loadCv();
    const red = (p, stripe) => { const i = jpeg.decode(fs.readFileSync(p), { useTArray: true, maxMemoryUsageInMB: 4096 }); const w = Math.round(i.width * H0 / i.height);
      const src = cv.matFromArray(i.height, i.width, cv.CV_8UC4, i.data), sm = new cv.Mat(); cv.resize(src, sm, new cv.Size(w, H0), 0, 0, cv.INTER_AREA); src.delete();
      if (stripe) { const d = sm.data; for (let y = 0; y < H0; y++) for (let x = 0; x < Math.round(w * 0.06); x++) { const o = (y * w + x) * 4; d[o] = d[o + 1] = d[o + 2] = 25; } }    // a dark binding edge
      const r = redScaled(cv, sm.data, w, H0); sm.delete(); return r; };
    const prep = (quad) => { const r = red(process.argv[2]), st = P.prepareReference(cv, r); r.delete(); if (quad) P.applyQuad(st, quad); return st; };
    const run = (st, stripe) => { const m = red(process.argv[3], stripe), r = P.alignCopy(cv, st, m, { measure: true }); m.delete(); r.aligned.delete(); return r.unmatched.tiles; };
    const a = prep(null), base = run(a, false), withStripe = run(a, true);
    const b0 = a.box, Wr = a.ref.cols, Hr = a.ref.rows;
    // the shape: the automatic box, widened a little, but never further left than 9 % of the page (the stripe is 6 %)
    const qx0 = Math.max(0.09, b0[0] / Wr - 0.02), qx1 = Math.min(0.99, b0[2] / Wr + 0.02), qy0 = Math.max(0.01, b0[1] / Hr - 0.02), qy1 = Math.min(0.99, b0[3] / Hr + 0.02);
    const st = prep([qx0, qy0, qx1, qy0, qx1, qy1, qx0, qy1]);
    let outside = 0; const d = st.ref.data32F; for (let i = 0; i < d.length; i++) if (!st.mask[i] && d[i] > 0) outside++;
    const handSet = run(st, true);
    console.log('real pair: unmatched ink ' + (100 * base).toFixed(1) + ' % (no stripe), ' + (100 * withStripe).toFixed(1) + ' % (stripe, automatic box), ' + (100 * handSet).toFixed(1) + ' % (stripe, shape set by hand)');
    check(outside === 0, 'no ink left outside the shape in the reference');
    check(handSet <= base + 0.02, 'with the shape the stripe does not make the alignment worse');
    a.ref.delete(); st.ref.delete();
  }
  console.log(fail ? 'PRINTED AREA CHECK FAILED' : 'PRINTED AREA CHECK OK');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
