'use strict';
/* A4/A1 research: for every scan, the automatic box A, the border-masked box B, the staff-extended boxes (A+, B+) and the amount of ink inside each.
       node exp_box2.js [--border=0.05] file1.jpg ...      (one JSON line per scan) */
const { loadCv, loadRed } = require('./align_chain');
const { printedBox, inkMap, extendBoxByStaves } = require('./printed_area');
(async () => {
  const args = process.argv.slice(2), bf = args.find(a => a.startsWith('--border=')), border = bf ? +bf.slice(9) : 0.05;
  const files = args.filter(a => !a.startsWith('--')), cv = await loadCv();
  for (const f of files) {
    try {
      const r = loadRed(cv, f), ink = inkMap(cv, r), W = ink.cols, H = ink.rows, d = ink.data32F;
      const inkIn = b => { let n = 0; for (let y = Math.max(0, b[1]); y < Math.min(H, b[3]); y++) for (let x = Math.max(0, b[0]); x < Math.min(W, b[2]); x++) if (d[y * W + x] > 0.5) n++; return n; };
      const A = printedBox(cv, r), B = printedBox(cv, r, { border }), A2 = extendBoxByStaves(A, ink), B2 = extendBoxByStaves(B, ink);
      const boxes = { A, B, A2, B2 }, o = { file: f, w: W, h: H, boxes, ink: {}, total: inkIn([0, 0, W, H]) };
      for (const k of Object.keys(boxes)) o.ink[k] = inkIn(boxes[k]);
      r.delete(); ink.delete(); console.log(JSON.stringify(o));
    } catch (e) { console.log(JSON.stringify({ file: f, error: e.message })); }
  }
})();
