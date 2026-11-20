'use strict';
/* A4 research: for every scan given, print the automatic printed-area box and the boxes of variants (border ignored: 0.03 / 0.05 / 0.08).
       node exp_box.js [--variants=0,0.05] file1.jpg file2.jpg ...      (one JSON line per scan) */
const path = require('path');
const { loadCv, loadRed } = require('./align_chain');
const { printedBox } = require('./printed_area');
(async () => {
  const args = process.argv.slice(2), vf = args.find(a => a.startsWith('--variants=')), vars = (vf ? vf.slice(11) : '0,0.03,0.05,0.08').split(',').map(Number);
  const files = args.filter(a => !a.startsWith('--')), cv = await loadCv();
  for (const f of files) {
    try {
      const r = loadRed(cv, f), o = { file: f, w: r.cols, h: r.rows, boxes: {} };
      for (const v of vars) { const t = Date.now(); o.boxes[v] = printedBox(cv, r, { border: v }); o.boxes[v].push(Date.now() - t); }
      r.delete(); console.log(JSON.stringify(o));
    } catch (e) { console.log(JSON.stringify({ file: f, error: e.message })); }
  }
})();
