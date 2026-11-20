'use strict';
/* Step 3 of the alignment experiment: tile-based (local) alignment, ported from research/tile_align.py.
   After the rough step the page is cut into overlapping tiles; every tile of the reference is searched for in the other copy,
   the small shifts found are repaired (empty tiles and outliers get the median of their neighbours), smoothed into a
   movement field and used to bend the other copy onto the reference. Four levels with smaller and smaller tiles.
   Level = [tile size, step, search radius, outlier threshold] in pixels at the 3000 px working height. */
const { scope } = require('./printed_area');
const LEVELS = [[384, 192, 56, 8.0], [192, 96, 14, 3.0], [96, 48, 6, 2.0], [48, 24, 3, 1.5]];

function subpixel(v, i, n) {          // v(k) for k = 0..n-1 given as function
  if (i > 0 && i < n - 1) {
    const den = v(i - 1) - 2 * v(i) + v(i + 1);
    return den ? i + 0.5 * (v(i - 1) - v(i + 1)) / den : i;
  }
  return i;
}

/* shift of every tile. box = [x0, x1, y0, y1]. Returns {cx, cy, SX, SY (Float32Array rows*cols, NaN = missing), rows, cols} */
function measureLevel(cv, ref, mov, box, tile, step, search, minInk = 0.04, minCorr = 0.45) {
  const [x0, x1, y0, y1] = box;
  const xs = [], ys = [];
  for (let x = x0; x < x1 - tile; x += step) xs.push(x);
  for (let y = y0; y < y1 - tile; y += step) ys.push(y);
  const rows = ys.length, cols = xs.length;
  const SX = new Float32Array(rows * cols).fill(NaN), SY = SX.slice();
  const W = ref.cols, rd = ref.data32F;
  const S = scope(), r = S.add(new cv.Mat());
  try {
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const x = xs[i], y = ys[j];
    // mean ink of the tile (cheap, directly on the array)
    let sum = 0;
    for (let yy = y; yy < y + tile; yy++) { const o = yy * W + x; for (let xx = 0; xx < tile; xx++) sum += rd[o + xx]; }
    if (sum / (tile * tile) < minInk) continue;
    const t = S.add(ref.roi(new cv.Rect(x, y, tile, tile)));
    const s = S.add(mov.roi(new cv.Rect(x - search, y - search, tile + 2 * search, tile + 2 * search)));
    cv.matchTemplate(s, t, r, cv.TM_CCOEFF_NORMED);
    const mm = cv.minMaxLoc(r);
    t.delete(); s.delete();
    if (mm.maxVal < minCorr) continue;
    const px = mm.maxLoc.x, py = mm.maxLoc.y, n = r.cols, m = r.rows, d = r.data32F;
    SX[j * cols + i] = subpixel(k => d[py * n + k], px, n) - search;
    SY[j * cols + i] = subpixel(k => d[k * n + px], py, m) - search;
  }
  } finally { S.free(); }
  return { cx: xs.map(x => x + tile / 2), cy: ys.map(y => y + tile / 2), SX, SY, rows, cols };
}

function median(a) { a.sort((p, q) => p - q); const n = a.length; return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2; }

/* fill missing tiles with the median of their valid neighbours; replace outliers by the local 3 x 3 median */
function repair(S, rows, cols, threshold) {
  S = S.slice();
  for (let it = 0; it < 6; it++) {
    let anyMissing = false;
    const next = S.slice();
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      if (!Number.isNaN(S[j * cols + i])) continue;
      anyMissing = true;
      const v = [];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const jj = j + dy, ii = i + dx;
        if (jj < 0 || jj >= rows || ii < 0 || ii >= cols) continue;
        const val = S[jj * cols + ii];
        if (!Number.isNaN(val)) v.push(val);
      }
      if (v.length) next[j * cols + i] = median(v);
    }
    S = next;
    if (!anyMissing) break;
  }
  for (let i = 0; i < S.length; i++) if (Number.isNaN(S[i])) S[i] = 0;        // nan_to_num
  const med = new Float32Array(S.length);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const v = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const jj = Math.min(rows - 1, Math.max(0, j + dy)), ii = Math.min(cols - 1, Math.max(0, i + dx));   // mode 'nearest'
      v.push(S[jj * cols + ii]);
    }
    med[j * cols + i] = median(v);
  }
  let bad = 0;
  for (let i = 0; i < S.length; i++) if (Math.abs(S[i] - med[i]) > threshold) { S[i] = med[i]; bad++; }
  return { S, bad };
}

/* movement field for every pixel: bilinear interpolation between tile centres, clamped outside (as RegularGridInterpolator) */
function denseField(cv, cx, cy, S, rows, cols, W, H) {
  const out = new Float32Array(W * H);
  // for every pixel column / row: the two neighbouring tile centres and the weight
  const colIdx = new Int32Array(W), colW = new Float32Array(W), rowIdx = new Int32Array(H), rowW = new Float32Array(H);
  const prep = (c, n, idx, wt, len) => {
    let k = 0;
    for (let p = 0; p < len; p++) {
      const v = Math.min(Math.max(p, c[0]), c[n - 1]);
      while (k < n - 2 && v > c[k + 1]) k++;
      idx[p] = k;
      wt[p] = n === 1 ? 0 : (v - c[k]) / (c[k + 1] - c[k]);
    }
  };
  if (cols < 2 || rows < 2) throw new Error('box too small for this level');
  prep(cx, cols, colIdx, colW, W); prep(cy, rows, rowIdx, rowW, H);
  for (let y = 0; y < H; y++) {
    const j = rowIdx[y], wy = rowW[y], r0 = j * cols, r1 = (j + 1) * cols, o = y * W;
    for (let x = 0; x < W; x++) {
      const i = colIdx[x], wx = colW[x];
      const a = S[r0 + i] * (1 - wx) + S[r0 + i + 1] * wx, b = S[r1 + i] * (1 - wx) + S[r1 + i + 1] * wx;
      out[o + x] = a * (1 - wy) + b * wy;
    }
  }
  return out;
}

/* bend `mov` onto `ref` (ink maps of the same size, already roughly aligned). box = [x0, x1, y0, y1]. Returns a new Mat. */
function tileAlign(cv, ref, mov, box, opts = {}) {
  const envLevels = (typeof process !== 'undefined' && process.env && process.env.BC_LEVELS) ? LEVELS.slice(0, +process.env.BC_LEVELS) : null;   // research only: use just the first N levels (a stiffer alignment)
  const levels = opts.levels || envLevels || LEVELS, W = ref.cols, H = ref.rows, stats = [];
  const S = scope(), refB = S.add(new cv.Mat()); cv.GaussianBlur(ref, refB, new cv.Size(0, 0), 0.8);
  let cur = mov;
  try {
  const total = opts.trackField ? { fx: new Float32Array(W * H), fy: new Float32Array(W * H) } : null;   // sum of all level fields (research: movement map)
  for (const [tile, step, search, threshold] of levels) {
    const t0 = Date.now();
    const movB = S.add(new cv.Mat()); cv.GaussianBlur(cur, movB, new cv.Size(0, 0), 0.8);
    const { cx, cy, SX, SY, rows, cols } = measureLevel(cv, refB, movB, box, tile, step, search);
    movB.delete();
    const t1 = Date.now();
    const fx = denseField(cv, cx, cy, repair(SX, rows, cols, threshold).S, rows, cols, W, H);
    const fy = denseField(cv, cx, cy, repair(SY, rows, cols, threshold).S, rows, cols, W, H);
    if (total) for (let p = 0; p < W * H; p++) { total.fx[p] += fx[p]; total.fy[p] += fy[p]; }
    const mapx = S.add(new cv.Mat(H, W, cv.CV_32F)), mapy = S.add(new cv.Mat(H, W, cv.CV_32F));
    { const mx = mapx.data32F, my = mapy.data32F; for (let y = 0, p = 0; y < H; y++) for (let x = 0; x < W; x++, p++) { mx[p] = x + fx[p]; my[p] = y + fy[p]; } }
    const next = S.add(new cv.Mat());
    cv.remap(cur, next, mapx, mapy, cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(0));
    mapx.delete(); mapy.delete();
    if (cur !== mov) cur.delete();
    cur = next;
    stats.push({ tile, tiles: rows * cols, measure_s: (t1 - t0) / 1000, field_s: (Date.now() - t1) / 1000 });
  }
  return { aligned: S.release(cur), stats, field: total };
  } finally {
    S.free();                                                                  // (a page that fails here keeps no memory: A5)
  }
}

module.exports = { tileAlign, LEVELS };
