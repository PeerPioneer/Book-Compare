'use strict';
/* Test B (PLAN.md section 4.4): is a line of notation that was only SHIFTED still visible after the tile alignment?
   One system (staff, notes, text under it) of a real music page is cut out of the second copy and moved by a known amount
   (dx, dy in pixels at the working height of 3000 px), then the copy is aligned onto the reference as usual.
       node shift_test.js <label> <reference scan> <other scan> <output folder> <dx> <dy> <band top y> <band bottom y>
   The band (rows of the reference at 3000 px height) is only a rough position; the real cut is made in the emptiest rows near its ends.
   Measured in the band: unmatched ink (share of ink without a partner within 1 px) and the movement the alignment applied there
   (mean of the displacement field) compared with the shift that was built in. Scans are never written to the repository. */
const fs = require('fs'), path = require('path'), jpeg = require('jpeg-js');
const dumpField = require('./dump_field');
const { loadCv, loadRed, unmatchedShare, overlayJpeg } = require('./align_chain');
const { redScaled } = require('./printed_area');
const { prepareReference, alignCopy } = require('./pipeline');

(async () => {
  const [label, refP, movP, outDir, dxS, dyS, topS, botS] = process.argv.slice(2);
  const dx = +dxS, dy = +dyS, top = +topS, bot = +botS;
  fs.mkdirSync(outDir, { recursive: true });
  const cv = await loadCv();
  const img = jpeg.decode(fs.readFileSync(movP), { useTArray: true, maxMemoryUsageInMB: 2048 });
  const { width: W, height: H, data } = img, sc = 3000 / H;                      // working px = scan px * sc
  const rowInk = y => { let n = 0; for (let x = 0; x < W; x += 2) if (data[4 * (y * W + x)] < 110) n++; return n; };
  const emptiest = (a, b) => { let best = a, bv = 1e9; for (let y = a; y <= b; y++) { const v = rowInk(y); if (v < bv) { bv = v; best = y; } } return best; };
  const y0 = emptiest(Math.round(top / sc) - 30, Math.round(top / sc) + 30), y1 = emptiest(Math.round(bot / sc) - 30, Math.round(bot / sc) + 30);
  if (dx !== 0 || dy !== 0) {
    const sdx = Math.round(dx / sc), sdy = Math.round(dy / sc);
    const bandH = y1 - y0, band = new Uint8Array(W * bandH * 4);
    for (let y = 0; y < bandH; y++) band.set(data.subarray(4 * ((y0 + y) * W), 4 * ((y0 + y + 1) * W)), 4 * y * W);
    const fill = [0, 1, 2].map(c => { const v = []; for (let y = 0; y < bandH; y += 3) for (let x = 0; x < W; x += 3) v.push(band[4 * (y * W + x) + c]); v.sort((a, b) => a - b); return v[Math.floor(v.length * 0.9)]; });
    for (let y = y0; y < y1; y++) for (let x = 0; x < W; x++) { const o = 4 * (y * W + x); data[o] = fill[0]; data[o + 1] = fill[1]; data[o + 2] = fill[2]; }
    for (let y = 0; y < bandH; y++) for (let x = 0; x < W; x++) {
      const nx = x + sdx, ny = y0 + y + sdy; if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
      const s = 4 * (y * W + x), o = 4 * (ny * W + nx);
      if (band[s] < data[o]) { data[o] = band[s]; data[o + 1] = band[s + 1]; data[o + 2] = band[s + 2]; }      // the darker pixel stays (ink of neighbouring lines is kept)
    }
  }
  const redMov = redScaled(cv, data, W, H);
  const rr = loadRed(cv, refP), state = prepareReference(cv, rr); rr.delete();
  const r = alignCopy(cv, state, redMov, { keepRough: true, trackField: true }); redMov.delete();
  const [bx0, by0, bx1, by1] = [state.box[0], top, state.box[2], bot];
  const band = [bx0, by0, bx1, by1];
  const un = unmatchedShare(cv, state.ref, r.aligned, band), unRough = unmatchedShare(cv, state.ref, r.rough, band);
  // movement in the band, taken only where the reference has ink (staff lines, notes, text): mean displacement
  const w = state.ref.cols, rd = state.ref.data32F; let n = 0, sx = 0, sy = 0;
  for (let y = by0; y < by1; y++) for (let x = bx0; x < bx1; x++) { const p = y * w + x; if (rd[p] > 0.5) { n++; sx += r.field.fx[p]; sy += r.field.fy[p]; } }
  const res = { label, dx, dy, band, unmatched_tiles: +(100 * un.share).toFixed(1), unmatched_rough: +(100 * unRough.share).toFixed(1), field_dx: +(sx / Math.max(n, 1)).toFixed(2), field_dy: +(sy / Math.max(n, 1)).toFixed(2), whole_tiles: +(100 * unmatchedShare(cv, state.ref, r.aligned, state.box).share).toFixed(1) };
  dumpField(r.field, state.ref, path.join(outDir, label + '_field'));
  fs.writeFileSync(path.join(outDir, label + '.json'), JSON.stringify(res));
  overlayJpeg(cv, state.ref, r.aligned, path.join(outDir, label + '_overlay.jpg'), 0.5, [bx0, Math.max(0, by0 - 40), bx1, Math.min(state.ref.rows, by1 + 40)]);
  console.log(JSON.stringify(res));
})().catch(e => { console.error('ERROR', e.stack); process.exit(1); });
