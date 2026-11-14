'use strict';
/* usage: node run_printed_area.js scan1.jpg scan2.jpg ...   -> prints one line per scan: name, box, seconds */
const fs = require('fs'), path = require('path'), jpeg = require('jpeg-js');
async function loadCv() {
  let cv = require('@techstark/opencv-js');
  if (cv instanceof Promise) cv = await cv;
  else if (typeof cv.then === 'function') cv = await new Promise(r => cv.then(x => { delete x.then; r(x); }));
  else if (!cv.Mat) await new Promise(r => { cv.onRuntimeInitialized = r; });
  return cv;
}
(async () => {
  const cv = await loadCv();
  const { redScaled, printedBox } = require('./printed_area');
  const out = [];
  for (const p of process.argv.slice(2)) {
    const t0 = Date.now();
    const img = jpeg.decode(fs.readFileSync(p), { useTArray: true, maxMemoryUsageInMB: 2048 });
    const t1 = Date.now();
    const r = redScaled(cv, img.data, img.width, img.height);
    const t2 = Date.now();
    const box = printedBox(cv, r);
    const t3 = Date.now();
    r.delete();
    const line = { file: path.basename(p), box, decode_s: (t1 - t0) / 1000, scale_s: (t2 - t1) / 1000, box_s: (t3 - t2) / 1000 };
    console.log(JSON.stringify(line));
    out.push(line);
  }
})().catch(e => { console.error(e); process.exit(1); });
