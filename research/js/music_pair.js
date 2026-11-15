'use strict';
/* Music tests (PLAN.md section 4.4, tests A and C): align ONE pair of scans of a page with musical notation and measure it.
       node music_pair.js <label> <reference scan> <other scan> <output folder>
   Writes <label>_overlay.jpg (red = ink only in the reference, blue = ink only in the other copy, black = both),
          <label>_move.jpg   (movement map: how far the tile alignment had to bend the other copy, white = 0 px, red = 10 px or more),
          <label>.json       (unmatched ink for the whole printed area and for 12 horizontal strips; movement statistics).
   Scan images are never written to the repository. */
const fs = require('fs'), path = require('path'), jpeg = require('jpeg-js');
const { loadCv, alignPair, unmatchedShare, overlayJpeg } = require('./align_chain');

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
  const r = alignPair(cv, refP, movP, null, { trackField: true });
  const [x0, y0, x1, y1] = r.box, w = r.ref.cols, h = r.ref.rows;
  const res = { label, box: r.box, whole_rough: 100 * unmatchedShare(cv, r.ref, r.rough, r.box).share, whole_tiles: 100 * unmatchedShare(cv, r.ref, r.aligned, r.box).share, strips: [] };
  const n = 12, sh = (y1 - y0) / n;
  for (let i = 0; i < n; i++) {
    const a = Math.round(y0 + i * sh), b = Math.round(y0 + (i + 1) * sh), u = unmatchedShare(cv, r.ref, r.aligned, [x0, a, x1, b]);
    res.strips.push({ y0: a, y1: b, ink: u.ink, unmatched: +(100 * u.share).toFixed(1) });
  }
  // movement statistics inside the printed area
  const mags = []; for (let y = y0; y < y1; y += 3) for (let x = x0; x < x1; x += 3) { const p = y * w + x; mags.push(Math.hypot(r.field.fx[p], r.field.fy[p])); }
  mags.sort((a, b) => a - b);
  res.move = { median: +mags[mags.length >> 1].toFixed(2), p95: +mags[Math.floor(mags.length * 0.95)].toFixed(2), max: +mags[mags.length - 1].toFixed(2), over8: +(100 * mags.filter(v => v > 8).length / mags.length).toFixed(1) };
  const crop = [x0, y0, x1, y1];
  overlayJpeg(cv, r.ref, r.aligned, path.join(outDir, label + '_overlay.jpg'), 0.4, crop);
  overlayJpeg(cv, r.ref, r.rough, path.join(outDir, label + '_rough.jpg'), 0.4, crop);
  moveJpeg(cv, r.field, w, h, crop, path.join(outDir, label + '_move.jpg'), 0.4);
  fs.writeFileSync(path.join(outDir, label + '.json'), JSON.stringify(res, null, 1));
  console.log(JSON.stringify({ label, whole_rough: +res.whole_rough.toFixed(1), whole_tiles: +res.whole_tiles.toFixed(1), move: res.move, strips: res.strips.map(s => s.unmatched).join(' ') }));
})().catch(e => { console.error('ERROR', e.message); process.exit(1); });
