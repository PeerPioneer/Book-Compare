'use strict';
/* A4 research: which box does prepareReference choose (and why) for each scan?   node exp_box3.js file1.jpg ... */
const { loadCv, loadRed } = require('./align_chain');
const { prepareReference } = require('./pipeline');
(async () => {
  const files = process.argv.slice(2), cv = await loadCv();
  for (const f of files) {
    try {
      const r = loadRed(cv, f), W = r.cols, H = r.rows, st = prepareReference(cv, r); r.delete();
      const a = b => (b[2] - b[0]) * (b[3] - b[1]) / W / H, i = st.boxInfo;
      console.log(JSON.stringify({ file: f.split('/').pop(), which: i.which, why: i.why, area: +a(st.box).toFixed(2), standard: i.standard, border: i.border, box: st.box, dens: +i.density.toFixed(3), stretched: i.stretched, s: +(st.times.box_s).toFixed(1) }));
      st.ref.delete();
    } catch (e) { console.log(JSON.stringify({ file: f, error: e.message })); }
  }
})();
