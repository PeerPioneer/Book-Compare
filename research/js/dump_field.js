'use strict';
/* research helper: writes the movement field (sum of all tile levels) and the reference ink map, reduced 8 times, for offline analysis.
   <out>.json holds {w, h, step}; <out>.bin holds fx, fy, ink as Float32 (h*w each). */
const fs = require('fs');
module.exports = function dumpField(field, ref, out, step = 8) {
  const W = ref.cols, H = ref.rows, w = Math.floor(W / step), h = Math.floor(H / step), a = new Float32Array(3 * w * h), rd = ref.data32F;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    let fx = 0, fy = 0, ink = 0;
    for (let y = 0; y < step; y++) for (let x = 0; x < step; x++) { const p = (j * step + y) * W + i * step + x; fx += field.fx[p]; fy += field.fy[p]; ink += rd[p] > 0.5 ? 1 : 0; }
    const n = step * step; a[j * w + i] = fx / n; a[w * h + j * w + i] = fy / n; a[2 * w * h + j * w + i] = ink / n;
  }
  fs.writeFileSync(out + '.bin', Buffer.from(a.buffer)); fs.writeFileSync(out + '.json', JSON.stringify({ w, h, step }));
};
