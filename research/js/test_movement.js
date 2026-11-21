'use strict';
/* Check of the movement map and the shifted-block hint (V16) on a real scan:
     node test_movement.js <scan.jpg>
   The scan is aligned against an altered copy of itself (at the working height of 3000 px, nothing is written anywhere):
     1. unchanged                                   -> no hint
     2. one band of about two lines moved 25 px      -> EITHER the fine alignment pulled it back: then a hint of about 25 px,
        sideways (a re-set line moved as a whole)       placed on that band; OR it did not (largest movement under 10 px):
                                                          then the shift stays visible in the overlay and no hint is needed
     3. the whole page bent smoothly by up to 6 px   -> no hint (paper, not a re-setting)
   Exit code 1 on failure. */
const { loadCv, loadRed } = require('./align_chain');
const { prepareReference, alignCopy } = require('./pipeline');
const { movementMap } = require('./movement');

(async () => {
  const cv = await loadCv();
  const red = loadRed(cv, process.argv[2]), W = red.cols, H = red.rows;
  const st = prepareReference(cv, red);
  const [bx0, by0, bx1, by1] = st.box;
  // the band: about 120 px around the middle of the printed area, cut at the emptiest rows (least ink), like shift_test.js
  const src = red.data32F.slice();
  const rowInk = y => { let n = 0; for (let x = bx0; x < bx1; x += 2) if (src[y * W + x] < 120) n++; return n; };
  const emptiest = (a, b) => { let best = a, bv = 1e9; for (let y = a; y <= b; y++) { const v = rowInk(y); if (v < bv) { bv = v; best = y; } } return best; };
  const mid = Math.round((by0 + by1) / 2), y0 = emptiest(mid - 110, mid - 40), y1 = emptiest(mid + 40, mid + 110);
  const paper = (() => { const v = []; for (let i = 0; i < src.length; i += 97) v.push(src[i]); v.sort((a, b) => a - b); return v[Math.floor(v.length * 0.7)]; })();
  function variant(kind) {
    const m = new cv.Mat(H, W, cv.CV_32F), d = m.data32F;
    d.set(src);
    if (kind === 'shift') {
      for (let y = y0; y < y1; y++) for (let x = 0; x < W; x++) d[y * W + x] = paper;
      for (let y = y0; y < y1; y++) for (let x = 0; x < W; x++) { const X = x + 25; if (X < W) d[y * W + X] = src[y * W + x]; }
    } else if (kind === 'bend') {
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const sx = Math.round(x - 6 * Math.sin(y / H * Math.PI)), sy = Math.round(y - 6 * Math.sin(x / W * Math.PI));
        d[y * W + x] = sx >= 0 && sx < W && sy >= 0 && sy < H ? src[sy * W + sx] : paper;
      }
    }
    return m;
  }
  let fail = 0;
  for (const [kind, expect] of [['unchanged', null], ['shift', 25], ['bend', null]]) {
    const mov = variant(kind), r = alignCopy(cv, st, mov, { composeMap: true }); mov.delete();
    const mv = movementMap(r, st.ref.cols, st.ref.rows, st.box);
    r.aligned.delete(); r.map.mx.delete(); r.map.my.delete();
    const h = mv.hint, bandMid = (y0 + y1) / 2 / H;
    const ok = expect == null ? !h : (h ? Math.abs(h.px - expect) <= 6 && h.y <= bandMid && h.y + h.h >= bandMid : mv.max < 10);
    console.log((ok ? 'PASS ' : 'FAIL ') + kind + ': largest movement ' + mv.max + ' px, hint ' + (h ? JSON.stringify(h) : 'none') + (kind === 'shift' ? ' (band rows ' + y0 + '-' + y1 + (h ? '; pulled back, hint given' : '; not pulled back, the shift stays visible') + ')' : ''));
    if (!ok) fail++;
  }
  console.log(fail ? 'MOVEMENT CHECK FAILED' : 'MOVEMENT CHECK OK');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
