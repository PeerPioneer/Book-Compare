'use strict';
/* Check of the stored alignments (V10, stored_movement.js).
     node test_stored.js                     -> made-up movement: packed, compressed, read back and rebuilt
     node test_stored.js ref.jpg other.jpg   -> also a real pair: the other copy bent with the REBUILT movement must look like
                                                the copy bent with the engine's own movement (and how big a stored page is)
   Exit code 1 on failure. Nothing is written anywhere. */
const S = require('./stored_movement');

function synthetic() {
  const W = 701, H = 1003, mx = new Float32Array(W * H), my = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = y * W + x;
    if (x < 9 || y > H - 13) { mx[p] = my[p] = -1e6; continue; }                            // outside the scan
    mx[p] = x + 3.2 * Math.sin(y / 97) + (x > 350 ? 1.5 : 0) * Math.min(1, (x - 350) / 24); // a smooth bend and a soft step
    my[p] = y - 2.7 * Math.cos(x / 131) + 0.004 * x;
  }
  return { W, H, mx, my };
}
function compare(a, b, W, H) {
  let n = 0, big = 0, worst = 0, outA = 0, outB = 0, mism = 0;
  for (let p = 0; p < W * H; p++) {
    const oa = a.mx[p] < -1e4, ob = b.mx[p] < -1e4;
    if (oa) outA++; if (ob) outB++;
    if (oa !== ob) { mism++; continue; }
    if (oa) continue;
    const d = Math.max(Math.abs(a.mx[p] - b.mx[p]), Math.abs(a.my[p] - b.my[p]));
    n++; if (d > 0.1) big++; if (d > worst) worst = d;
  }
  return { n, big, worst, outA, outB, mism };
}

(async () => {
  let fail = 0;
  // 1. made-up movement
  const t = synthetic(), s = S.downsample(t.mx, t.my, t.W, t.H);
  const mv = new Uint8ClampedArray(Math.ceil(t.W / 4) * Math.ceil(t.H / 4) * 4); mv[7] = 200;
  const raw = S.pack({ W: [1, 0, 0, 0, 1, 0], Wr: t.W, Hr: t.H, note: 'ä' }, s, mv);
  const z = await S.compress(raw), back = S.unpack(await S.decompress(z));
  const ok1 = back.meta.note === 'ä' && back.meta.Wr === t.W && back.mv[7] === 200 && back.map.dx.length === s.dx.length && back.map.dx.every((v, i) => v === s.dx[i]);
  const u = S.upsample(back.map, t.W, t.H), c = compare(t, u, t.W, t.H);
  console.log('made-up movement: ' + (raw.length / 1024).toFixed(0) + ' KB, compressed ' + (z.length / 1024).toFixed(0) + ' KB; worst difference ' + c.worst.toFixed(3) +
    ' px, over 0.1 px: ' + (100 * c.big / c.n).toFixed(2) + ' %; outside: ' + c.outA + ' -> ' + c.outB + ' (differing ' + c.mism + ')');
  // (the soft step and the edge of the scan lose a little; nearly everything must be within 0.1 px, and the edge may grow by one cell only)
  if (!ok1 || c.big / c.n > 0.01 || c.worst > 0.6 || c.outB < c.outA || c.mism > (t.W + t.H) * (S.CELL + 1)) { console.log('  FAILED'); fail++; }
  const plain = S.unpack(raw); if (plain.meta.v !== 1 || !plain.map) { console.log('  reading the uncompressed form FAILED'); fail++; }
  // extreme numbers survive the row-difference coding exactly
  const ext = { cell: 8, cols: 3, rows: 2, dx: Int16Array.from([-32767, 32767, -32768, 32767, -32767, 0]), dy: Int16Array.from([1, -1, 2, -2, 3, -3]) };
  const eb = S.unpack(S.pack({}, ext, null)).map;
  if (!ext.dx.every((v, i) => v === eb.dx[i]) || !ext.dy.every((v, i) => v === eb.dy[i])) { console.log('  difference coding FAILED', eb.dx, eb.dy); fail++; }

  // 2. a real pair
  if (process.argv[3]) {
    const fs = require('fs'), jpeg = require('jpeg-js');
    const { loadCv } = require('./align_chain');
    const { redScaled, H0 } = require('./printed_area');
    const { prepareReference, alignCopy } = require('./pipeline');
    const { movementMap } = require('./movement');
    const cv = await loadCv();
    const red = p => { const i = jpeg.decode(fs.readFileSync(p), { useTArray: true, maxMemoryUsageInMB: 4096 }); const w = Math.round(i.width * H0 / i.height);
      const src = cv.matFromArray(i.height, i.width, cv.CV_8UC4, i.data), sm = new cv.Mat(); cv.resize(src, sm, new cv.Size(w, H0), 0, 0, cv.INTER_AREA); src.delete();
      const r = redScaled(cv, sm.data, w, H0); sm.delete(); return r; };
    const rr = red(process.argv[2]), st = prepareReference(cv, rr); rr.delete();
    const mr = red(process.argv[3]);
    const r = alignCopy(cv, st, mr, { composeMap: true, measure: true });
    const Wr = st.ref.cols, Hr = st.ref.rows, mx = r.map.mx.data32F, my = r.map.my.data32F;
    const d = S.downsample(mx, my, Wr, Hr), m = movementMap(r, Wr, Hr, st.box);
    const packed = S.pack({ W: Array.from(r.W), Wr, Hr }, d, m.pixels), zz = await S.compress(packed);
    const rb = S.unpack(await S.decompress(zz)), up = S.upsample(rb.map, Wr, Hr), cc = compare({ mx, my }, up, Wr, Hr);
    // bend the other copy's red channel both ways and compare inside the printed area
    function bend(ax, ay) {
      const X = new cv.Mat(Hr, Wr, cv.CV_32F), Y = new cv.Mat(Hr, Wr, cv.CV_32F), a = X.data32F, b = Y.data32F, W = rb.meta.W;
      for (let p = 0; p < Wr * Hr; p++) { if (ax[p] < -1e4) { a[p] = b[p] = -1e5; continue; } a[p] = W[0] * ax[p] + W[1] * ay[p] + W[2]; b[p] = W[3] * ax[p] + W[4] * ay[p] + W[5]; }
      const o = new cv.Mat(); cv.remap(mr, o, X, Y, cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(255)); X.delete(); Y.delete(); return o;
    }
    const e1 = bend(mx, my), e2 = bend(up.mx, up.my), [x0, y0, x1, y1] = st.box;
    let sum = 0, n = 0, big = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const q = Math.abs(e1.data32F[y * Wr + x] - e2.data32F[y * Wr + x]); sum += q; n++; if (q > 40) big++; }
    console.log('real pair: stored page ' + (zz.length / 1024).toFixed(0) + ' KB (uncompressed ' + (packed.length / 1024).toFixed(0) + ' KB); movement: worst ' + cc.worst.toFixed(2) +
      ' px, over 0.1 px ' + (100 * cc.big / cc.n).toFixed(2) + ' %; bent scans differ by ' + (sum / n).toFixed(2) + ' grey levels on average, ' + (100 * big / n).toFixed(3) + ' % of the pixels by more than 40');
    if (cc.big / cc.n > 0.02 || sum / n > 1.0 || big / n > 0.002 || zz.length > 3e6) { console.log('  FAILED'); fail++; }
    e1.delete(); e2.delete(); mr.delete(); r.aligned.delete(); r.map.mx.delete(); r.map.my.delete();
  }
  console.log(fail ? 'STORED ALIGNMENT CHECK FAILED' : 'STORED ALIGNMENT CHECK OK');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
