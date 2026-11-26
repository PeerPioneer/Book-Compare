'use strict';
/* research (0.15.0): the printed area chosen for each scan (pipeline.chooseBox, as the program does), drawn on a small copy.
   usage: node run_boxes.js outdir scan1.jpg scan2.jpg ...   -> one JSON line per scan; outdir/<n>.jpg with the box drawn (red) */
const fs = require('fs'), path = require('path'), jpeg = require('jpeg-js');
const { loadCv } = require('./align_chain');
(async () => {
  const cv = await loadCv();
  const P = require('./printed_area'), Pl = require('./pipeline');
  const outdir = process.argv[2]; fs.mkdirSync(outdir, { recursive: true });
  let n = 0;
  for (const p of process.argv.slice(3)) {
    n++;
    try {
      const img = jpeg.decode(fs.readFileSync(p), { useTArray: true, maxMemoryUsageInMB: 4096 });
      const t0 = Date.now();
      const red = P.redScaled(cv, img.data, img.width, img.height);
      const dark = P.darkScaled ? P.darkScaled(cv, img.data, img.width, img.height) : null;
      const ref = P.inkMap(cv, red);
      const pick = Pl.chooseBox(cv, red, ref, dark);
      const t1 = Date.now();
      const W = red.cols, H = red.rows;
      // small preview with the box
      const s = 600 / H, w = Math.round(img.width * 600 / img.height), out = Buffer.alloc(w * 600 * 4);
      for (let y = 0; y < 600; y++) for (let x = 0; x < w; x++) {
        const sx = Math.min(img.width - 1, Math.floor(x * img.width / w)), sy = Math.min(img.height - 1, Math.floor(y * img.height / 600)), i = (sy * img.width + sx) * 4, o = (y * w + x) * 4;
        out[o] = img.data[i]; out[o + 1] = img.data[i + 1]; out[o + 2] = img.data[i + 2]; out[o + 3] = 255;
      }
      const drawBox = (bb, col) => {
        const b = bb.map((v, k) => Math.round(v * (k % 2 ? 600 / H : w / W)));
        for (let x = b[0]; x <= b[2]; x++) for (const y of [b[1], b[3]]) for (let t = -1; t <= 1; t++) { const yy = Math.min(599, Math.max(0, y + t)); const o = (yy * w + Math.min(w - 1, x)) * 4; out[o] = col[0]; out[o + 1] = col[1]; out[o + 2] = col[2]; }
        for (let y = b[1]; y <= b[3]; y++) for (const x of [b[0], b[2]]) for (let t = -1; t <= 1; t++) { const xx = Math.min(w - 1, Math.max(0, x + t)); const o = (Math.min(599, y) * w + xx) * 4; out[o] = col[0]; out[o + 1] = col[1]; out[o + 2] = col[2]; }
      };
      if (pick.before && pick.head) drawBox(pick.before, [255, 0, 200]);
      drawBox(pick.box, [0, 160, 255]);
      if (process.env.ONLY_CHANGED === '1' && !pick.head) { /* nothing drawn */ } else fs.writeFileSync(path.join(outdir, String(n).padStart(3, '0') + '.jpg'), jpeg.encode({ data: out, width: w, height: 600 }, 80).data);
      console.log(JSON.stringify({ n, file: path.relative('/mnt/user-data/uploads', p), box: pick.box, which: pick.which, stretched: pick.stretched, head: pick.head || null, s: (t1 - t0) / 1000 }));
      red.delete(); ref.delete(); if (dark) dark.delete();
    } catch (e) { console.log(JSON.stringify({ n, file: p, error: String(e && e.message || e) })); }
  }
})().catch(e => { console.error(e); process.exit(1); });
