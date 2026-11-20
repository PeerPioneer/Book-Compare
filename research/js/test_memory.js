'use strict';
/* A5 (PLAN.md): the alignment chain must give back its memory after every page, also when a page fails, because the background alignment of a
   whole book runs thousands of pages in ONE worker. This script aligns the two sample scans of the app many times in one process and watches the
   memory of the process; WebAssembly memory only ever grows, so a leak shows as growth from round to round (after the first rounds have
   reached their peak). Two kinds of rounds: normal ones, and ones that fail on purpose ("box too small", as 22 Opusculum pages did).
       node test_memory.js [rounds]
   Exit code 1 and a message when the memory still grows by more than 8 MB between round 3 and the last round. */
const path = require('path');
const { loadCv, loadRed } = require('./align_chain');
const { prepareReference, alignCopy } = require('./pipeline');

const A = path.join(__dirname, '..', '..', 'app', 'images', 'usecases', 'book', 'case2-traherne2-a-original.jpg');
const B = path.join(__dirname, '..', '..', 'app', 'images', 'usecases', 'book', 'case2-traherne2-b-original.jpg');
let CV = null;
/* size of the WebAssembly memory in MB: the data view of any Mat points into it */
const mb = () => { const m = new CV.Mat(1, 1, CV.CV_8U), n = m.data.buffer.byteLength; m.delete(); return n / 1e6; };

async function series(cv, label, rounds, oneRound) {
  const m = [];
  for (let i = 0; i < rounds; i++) { await oneRound(i); if (global.gc) global.gc(); m.push(mb()); }
  const growth = m[m.length - 1] - m[Math.min(2, m.length - 1)];
  console.log(label + ': memory per round (MB) ' + m.map(x => x.toFixed(0)).join(' ') + '  -> growth after round 3: ' + growth.toFixed(1) + ' MB');
  return growth;
}

(async () => {
  const rounds = +process.argv[2] || 8, cv = await loadCv(); CV = cv;
  const rr = loadRed(cv, A), st = prepareReference(cv, rr); rr.delete();
  const okGrowth = await series(cv, 'normal pages ', rounds, async () => {
    const mov = loadRed(cv, B); const r = alignCopy(cv, st, mov, { measure: true }); mov.delete(); r.aligned.delete();
  });
  /* a tile larger than the printed area: the tile step cannot work and throws "box too small" (what 22 Opusculum pages did).
     Not used: a tiny box for the rough step, because OpenCV.js itself loses about 17 MB inside every FAILED call of its ECC step
     (C++ exceptions do not clean up there); that cannot be freed from our code, so the app must restart a helper that has grown too large. */
  const failGrowth = await series(cv, 'failing pages', rounds, async () => {
    const mov = loadRed(cv, B); let failed = false;
    try { const r = alignCopy(cv, st, mov, { levels: [[5000, 2500, 56, 8]] }); r.aligned.delete(); } catch (e) { failed = true; } finally { mov.delete(); }
    if (!failed) throw new Error('the page was expected to fail (box too small)');
  });
  const bad = okGrowth > 8 || failGrowth > 8;
  console.log(bad ? 'MEMORY LEAK: the chain does not give its memory back' : 'MEMORY OK');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('ERROR', e && e.message || e); process.exit(1); });
