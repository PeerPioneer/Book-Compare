'use strict';
/* usage: node run_full.js ref.jpg other.jpg [out_prefix]  -> unmatched ink after the rough and after the tile step, times */
const { loadCv, alignPair, unmatchedShare, overlayJpeg } = require('./align_chain');
(async () => {
  const cv = await loadCv();
  const r = alignPair(cv, process.argv[2], process.argv[3]);
  const uRough = unmatchedShare(cv, r.ref, r.rough, r.box).share, uTile = unmatchedShare(cv, r.ref, r.aligned, r.box).share;
  console.log(JSON.stringify({ unmatched_after_rough_pct: +(100 * uRough).toFixed(1), unmatched_after_tiles_pct: +(100 * uTile).toFixed(1),
    times: r.times, levels: r.stats }));
  if (process.argv[4]) overlayJpeg(cv, r.ref, r.aligned, process.argv[4] + '_overlay.jpg');
})().catch(e => { console.error(e); process.exit(1); });
