'use strict';
/* Music tests (PLAN.md section 4.4, tests A and C): align ONE pair of scans of a page with musical notation and measure it.
       node music_pair.js <label> <reference scan> <other scan> <output folder>
   Writes <label>_overlay.jpg (red = ink only in the reference, blue = ink only in the other copy, black = both),
          <label>_move.jpg   (movement map: how far the tile alignment had to bend the other copy, white = 0 px, red = 10 px or more),
          <label>.json       (unmatched ink for the whole printed area and for 12 horizontal strips; movement statistics).
   Scan images are never written to the repository. */
const fs = require('fs'), path = require('path'), jpeg = require('jpeg-js');
const dumpField = require('./dump_field');
const { loadCv, loadRed, alignPair, unmatchedShare, overlayJpeg } = require('./align_chain');
const { prepareReference } = require('./pipeline');

function moveJpeg(cv, field, w, h, crop, out, scale) {
  const [x0, y0, x1, y1] = crop, cw = x1 - x0, ch = y1 - y0, rgba = new Uint8Array(cw * ch * 4);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const p = (y + y0) * w + x + x0, m = Math.min(1, Math.hypot(field.fx[p], field.fy[p]) / 10), o = 4 * (y * cw + x);
    rgba[o] = 255; rgba[o + 1] = Math.round(255 * (1 - m)); rgba[o + 2] = Math.round(255 * (1 - m)); rgba[o + 3] = 255;
  }
  const big = new cv.Mat(ch, cw, cv.CV_8UC4); big.data.set(rgba); const sm = new cv.Mat();
  cv.resize(big, sm, new cv.Size(Math.round(cw * scale), Math.round(ch * scale)), 0, 0, cv.INTER_AREA);
  fs.writeFileSync(out, jpeg.encode({ data: Buffer.from(sm.data), width: sm.cols, height: sm.rows }, 88).data);
  big.delete(); sm.delete();
}

(async () => {
  const [label, refP, movP, outDir] = process.argv.slice(2);
  fs.mkdirSync(outDir, { recursive: true });
  const cv = await loadCv();
  // Research switches for the printed-area box of the REFERENCE (PLAN.md test D, extra (b): does a hand-set area rescue references with a dark scan border?)
  //   BOX=x0,y0,x1,y1  box in pixels at the working height of 3000 px, replaces the automatic one (a rectangle stands in for the four-cornered area the app will offer)
  //   BOXAUTO=<f>      automatic stand-in for a hand-set area: ignore a strip of fraction f (e.g. 0.05) of the image on all four sides, then take the 0.5 % to 99.5 % range of the ink
  let cache = null;
  if (process.env.BOX || process.env.BOXAUTO) {
    const rr = loadRed(cv, refP), st = prepareReference(cv, rr); rr.delete();
    st.autoBox = st.box.slice();
    if (process.env.BOX) st.box = process.env.BOX.split(',').map(Number);
    else {
      const f = parseFloat(process.env.BOXAUTO), w = st.ref.cols, h = st.ref.rows, d = st.ref.data32F, mx = Math.round(f * w), my = Math.round(f * h);
      const cx = new Float64Array(w), cy = new Float64Array(h); let tot = 0;
      for (let y = my; y < h - my; y++) for (let x = mx; x < w - mx; x++) if (d[y * w + x] > 0.5) { cx[x]++; cy[y]++; tot++; }
      const q = (c, p) => { let a = 0; for (let i = 0; i < c.length; i++) { a += c[i]; if (a >= p * tot) return i; } return c.length - 1; };
      st.box = [q(cx, 0.005), q(cy, 0.005), q(cx, 0.995), q(cy, 0.995)];
    }
    cache = { state: st };
  }
  const r = alignPair(cv, refP, movP, cache, { trackField: true });
  const [x0, y0, x1, y1] = r.box, w = r.ref.cols, h = r.ref.rows;
  const res = { label, box: r.box, auto_box: r.cache.state.autoBox || null, whole_rough: 100 * unmatchedShare(cv, r.ref, r.rough, r.box).share, whole_tiles: 100 * unmatchedShare(cv, r.ref, r.aligned, r.box).share, strips: [] };
  const n = 12, sh = (y1 - y0) / n;
  for (let i = 0; i < n; i++) {
    const a = Math.round(y0 + i * sh), b = Math.round(y0 + (i + 1) * sh), u = unmatchedShare(cv, r.ref, r.aligned, [x0, a, x1, b]);
    res.strips.push({ y0: a, y1: b, ink: u.ink, unmatched: +(100 * u.share).toFixed(1) });
  }
  // movement statistics inside the printed area
  const mags = []; for (let y = y0; y < y1; y += 3) for (let x = x0; x < x1; x += 3) { const p = y * w + x; mags.push(Math.hypot(r.field.fx[p], r.field.fy[p])); }
  mags.sort((a, b) => a - b);
  res.move = { median: +mags[mags.length >> 1].toFixed(2), p95: +mags[Math.floor(mags.length * 0.95)].toFixed(2), max: +mags[mags.length - 1].toFixed(2), over8: +(100 * mags.filter(v => v > 8).length / mags.length).toFixed(1) };
  // PAD (environment variable, e.g. 0.08): show a margin of that fraction of the box around the printed area, so folio numbers, signatures and headlines at the edge are visible. Measurements stay inside the box.
  const pad = parseFloat(process.env.PAD || '0'), px = Math.round(pad * (x1 - x0)), py = Math.round(pad * (y1 - y0));
  let sy0 = y0, sy1 = y1; // WIDE=1: also include the full height of the staves (rows that are mostly ink across the box width); sparse pages can lose their top or bottom staves in the box
  if (process.env.WIDE) {
    const d = r.ref.data32F, need = 0.45 * (x1 - x0), margin = Math.round(0.03 * h);
    for (let y = margin; y < h - margin; y++) { let c = 0; for (let x = x0; x < x1; x++) if (d[y * w + x] > 0.5) c++; if (c >= need) { sy0 = Math.min(sy0, y); sy1 = Math.max(sy1, y); } }
    res.wide_box = [x0, sy0, x1, sy1];
  }
  const crop = [Math.max(0, x0 - px), Math.max(0, sy0 - py), Math.min(w, x1 + px), Math.min(h, sy1 + py)];
  const os = parseFloat(process.env.OVERLAY_SCALE || '0.4');                                        // OVERLAY_SCALE=1 writes the overlay at the full working height (3000 px), for looking at single notes
  overlayJpeg(cv, r.ref, r.aligned, path.join(outDir, label + '_overlay.jpg'), os, crop);
  overlayJpeg(cv, r.ref, r.rough, path.join(outDir, label + '_rough.jpg'), 0.4, crop);
  moveJpeg(cv, r.field, w, h, crop, path.join(outDir, label + '_move.jpg'), 0.4);
  dumpField(r.field, r.ref, path.join(outDir, label + '_field'));
  fs.writeFileSync(path.join(outDir, label + '.json'), JSON.stringify(res, null, 1));
  console.log(JSON.stringify({ label, whole_rough: +res.whole_rough.toFixed(1), whole_tiles: +res.whole_tiles.toFixed(1), move: res.move, strips: res.strips.map(s => s.unmatched).join(' ') }));
})().catch(e => { console.error('ERROR', e.message); process.exit(1); });
