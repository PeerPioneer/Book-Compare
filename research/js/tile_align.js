'use strict';
/* Step 3 of the alignment experiment: tile-based (local) alignment, ported from research/tile_align.py.
   After the rough step the page is cut into overlapping tiles; every tile of the reference is searched for in the other copy,
   the small shifts found are repaired (empty tiles and outliers get the median of their neighbours), smoothed into a
   movement field and used to bend the other copy onto the reference. Four levels with smaller and smaller tiles.
   Level = [tile size, step, search radius, outlier threshold] in pixels at the 3000 px working height. */
const { scope } = require('./printed_area');
const LEVELS = [[384, 192, 56, 8.0], [192, 96, 14, 3.0], [96, 48, 6, 2.0], [48, 24, 3, 1.5]];

/* Tile settings (V15, owner 17 Nov 2026): "main tiles" = how many large tiles cover the page height (standard about 8: 3000 / 384),
   "sub-tiles" = how many times each is split again (standard 3, so four levels in all). Each level halves the tile size; the search
   range and the repair threshold of a level are those of the standard level with the same number (a fifth level: 2 px, 1.2).
   main 8 + sub 3 gives exactly LEVELS. Fewer levels = stiffer (whole regions move together); more = more flexible (smaller pieces
   may move on their own, which can also pull real differences into place: §10 of PLAN.md). */
const SEARCH = [56, 14, 6, 3, 2], THRESH = [8.0, 3.0, 2.0, 1.5, 1.2];
function levelsFor(main, sub, height = 3000) {
  if (main === 8 && sub === 3) return LEVELS;
  const t0 = main === 8 ? 384 : Math.round(height / main), out = [];
  for (let i = 0; i <= sub; i++) { const t = Math.max(16, Math.round(t0 / Math.pow(2, i))); out.push([t, Math.round(t / 2), SEARCH[Math.min(i, 4)], THRESH[Math.min(i, 4)]]); }
  return out;
}

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
  let inked = 0, matched = 0;
  try {
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const x = xs[i], y = ys[j];
    // mean ink of the tile (cheap, directly on the array)
    let sum = 0;
    for (let yy = y; yy < y + tile; yy++) { const o = yy * W + x; for (let xx = 0; xx < tile; xx++) sum += rd[o + xx]; }
    if (sum / (tile * tile) < minInk) continue;
    inked++;
    const t = S.add(ref.roi(new cv.Rect(x, y, tile, tile)));
    const s = S.add(mov.roi(new cv.Rect(x - search, y - search, tile + 2 * search, tile + 2 * search)));
    cv.matchTemplate(s, t, r, cv.TM_CCOEFF_NORMED);
    const mm = cv.minMaxLoc(r);
    t.delete(); s.delete();
    if (mm.maxVal < minCorr) continue;
    matched++;
    const px = mm.maxLoc.x, py = mm.maxLoc.y, n = r.cols, m = r.rows, d = r.data32F;
    SX[j * cols + i] = subpixel(k => d[py * n + k], px, n) - search;
    SY[j * cols + i] = subpixel(k => d[k * n + px], py, m) - search;
  }
  } finally { S.free(); }
  return { cx: xs.map(x => x + tile / 2), cy: ys.map(y => y + tile / 2), SX, SY, rows, cols, inked, matched };
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

/* The whole movement as ONE map (Compare tab, V3): map.mx / map.my (CV_32F, size of the reference) say, for every pixel of the result, where it was
   taken from in the picture before the tile step. Each level takes the result of the level before at x + f(x), so the map is the old map read at
   that place: new(x) = old(x + f(x)). Pixels taken from outside the picture get a far-away place (they stay empty, as in the ink map). */
const OUTSIDE = -1e6;
function composeMap(cv, map, mapx, mapy) {
  const nx = new cv.Mat(), ny = new cv.Mat();
  try {
    cv.remap(map.mx, nx, mapx, mapy, cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(OUTSIDE));
    cv.remap(map.my, ny, mapx, mapy, cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(OUTSIDE));
  } catch (e) { nx.delete(); ny.delete(); throw e; }
  map.mx.delete(); map.my.delete(); map.mx = nx; map.my = ny;
}
function identityMap(cv, W, H) {
  const mx = new cv.Mat(H, W, cv.CV_32F), my = new cv.Mat(H, W, cv.CV_32F), a = mx.data32F, b = my.data32F;
  for (let y = 0, p = 0; y < H; y++) for (let x = 0; x < W; x++, p++) { a[p] = x; b[p] = y; }
  return { mx, my };
}

/* bend `mov` onto `ref` (ink maps of the same size, already roughly aligned). box = [x0, x1, y0, y1]. Returns a new Mat.
   opts.map (optional): a map from identityMap(), brought up to date with every level (see composeMap). */
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
    const { cx, cy, SX, SY, rows, cols, inked, matched } = measureLevel(cv, refB, movB, box, tile, step, search);
    movB.delete();
    const t1 = Date.now();
    const fx = denseField(cv, cx, cy, repair(SX, rows, cols, threshold).S, rows, cols, W, H);
    const fy = denseField(cv, cx, cy, repair(SY, rows, cols, threshold).S, rows, cols, W, H);
    if (total) for (let p = 0; p < W * H; p++) { total.fx[p] += fx[p]; total.fy[p] += fy[p]; }
    const mapx = S.add(new cv.Mat(H, W, cv.CV_32F)), mapy = S.add(new cv.Mat(H, W, cv.CV_32F));
    { const mx = mapx.data32F, my = mapy.data32F; for (let y = 0, p = 0; y < H; y++) for (let x = 0; x < W; x++, p++) { mx[p] = x + fx[p]; my[p] = y + fy[p]; } }
    const next = S.add(new cv.Mat());
    cv.remap(cur, next, mapx, mapy, cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(0));
    if (opts.map) composeMap(cv, opts.map, mapx, mapy);
    mapx.delete(); mapy.delete();
    if (cur !== mov) cur.delete();
    cur = next;
    stats.push({ tile, tiles: rows * cols, inked, matched, measure_s: (t1 - t0) / 1000, field_s: (Date.now() - t1) / 1000 });
  }
  return { aligned: S.release(cur), stats, field: total };
  } finally {
    S.free();                                                                  // (a page that fails here keeps no memory: A5)
  }
}

/* A2 (20 Nov 2026): items outside the printed area (headline, folio number, signature, catchword) are too small for the tiles: a tile that holds only a
   letter has far too little ink to be measured, and the rough alignment leaves such an item 10-50 px off, which shows as a false red/blue pair (Odhecaton H1r,
   the signature). Here every ink blob outside the box (not within `edge` px of the scan edge, not a speck) is searched in the other copy within +-`search` px by
   template matching; where it is found (correlation >= minCorr) the patch of the other copy is moved onto it. An item that is not found (a real difference:
   Canti C folio "21" against a handwritten "12") stays where it is. ref, aligned: ink maps of the same size; box = [x0, y0, x1, y1] printed area.
   Returns { aligned: new Mat (the caller deletes it and the old one), moved: [{x, y, w, h, dx, dy, corr}], seen: number of items looked at }. */
function alignMarginItems(cv, ref, aligned, box, opts = {}) {
  const S = scope();
  try {
    const W = ref.cols, H = ref.rows, edge = opts.edge || 60, search = opts.search || 60, minCorr = opts.minCorr || 0.5, pad = 8, minArea = opts.minArea || 60;
    const [x0, y0, x1, y1] = box;
    const bin = S.add(cv.Mat.zeros(H, W, cv.CV_8U)), rd = ref.data32F, bd = bin.data;      // (a new Mat is not zeroed)
    for (let y = edge; y < H - edge; y++) for (let x = edge; x < W - edge; x++) if (rd[y * W + x] > 0.5 && !(x >= x0 && x < x1 && y >= y0 && y < y1)) bd[y * W + x] = 1;
    const joined = S.add(new cv.Mat()), k = S.add(cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(15, 15)));
    cv.dilate(bin, joined, k);
    const lab = S.add(new cv.Mat()), st = S.add(new cv.Mat()), cen = S.add(new cv.Mat());
    const n = cv.connectedComponentsWithStats(joined, lab, st, cen, 8);
    const out = S.add(aligned.clone()), moved = [], jobs = [];
    let seen = 0;
    for (let i = 1; i < n; i++) {
      const bx = st.intAt(i, 0), by = st.intAt(i, 1), bw = st.intAt(i, 2), bh = st.intAt(i, 3);
      // the ink of the blob itself (without the dilation), inside its bounding box
      const bdNow = bin.data;                                                   // (a fresh view: the WebAssembly memory may have grown since the last one)
      let ink = 0; for (let y = by; y < by + bh; y++) for (let x = bx; x < bx + bw; x++) ink += bdNow[y * W + x];
      if (ink < minArea || bw > 0.5 * W || bh > 0.5 * H) continue;               // specks, and long things (frame lines, rules)
      seen++;
      const tx = Math.max(edge, bx - pad), ty = Math.max(edge, by - pad), tw = Math.min(W - edge, bx + bw + pad) - tx, th = Math.min(H - edge, by + bh + pad) - ty;
      const sx = Math.max(0, tx - search), sy = Math.max(0, ty - search), sw = Math.min(W, tx + tw + search) - sx, sh = Math.min(H, ty + th + search) - sy;
      if (tw < 8 || th < 8 || sw < tw || sh < th) continue;
      const hitsBox = (a, b, c, d) => a < x1 && a + c > x0 && b < y1 && b + d > y0;            // a patch must never touch the printed area (its ink is aligned by the tiles)
      if (hitsBox(tx, ty, tw, th)) continue;
      const t = S.add(ref.roi(new cv.Rect(tx, ty, tw, th))), s = S.add(aligned.roi(new cv.Rect(sx, sy, sw, sh))), r = S.add(new cv.Mat());
      cv.matchTemplate(s, t, r, cv.TM_CCOEFF_NORMED);
      const mm = cv.minMaxLoc(r);
      t.delete(); s.delete(); r.delete();
      const dx = sx + mm.maxLoc.x - tx, dy = sy + mm.maxLoc.y - ty;
      if (opts.debug) opts.debug.push({ x: tx, y: ty, w: tw, h: th, ink, dx, dy, corr: +mm.maxVal.toFixed(2) });               // where the item is in the other copy, relative to where it should be
      if (hitsBox(tx + dx, ty + dy, tw, th)) continue;
      if (mm.maxVal < minCorr || (Math.abs(dx) < 2 && Math.abs(dy) < 2) || Math.abs(dx) >= search - 1 || Math.abs(dy) >= search - 1) continue;
      jobs.push({ tx, ty, tw, th, dx, dy, corr: mm.maxVal });
    }
    // first take every found patch out, then put them all at the place of the reference (patches may overlap their own old place).
    // Plain array work (no allocations in between, so the views stay valid): copyTo into a region of a Mat did not write in OpenCV.js.
    const od = out.data32F, ad = aligned.data32F;
    const patches = jobs.map(j => { const p = new Float32Array(j.tw * j.th); for (let r = 0; r < j.th; r++) p.set(ad.subarray((j.ty + j.dy + r) * W + j.tx + j.dx, (j.ty + j.dy + r) * W + j.tx + j.dx + j.tw), r * j.tw); return p; });
    for (const j of jobs) for (let r = 0; r < j.th; r++) od.fill(0, (j.ty + j.dy + r) * W + j.tx + j.dx, (j.ty + j.dy + r) * W + j.tx + j.dx + j.tw);
    jobs.forEach((j, n) => { for (let r = 0; r < j.th; r++) od.set(patches[n].subarray(r * j.tw, (r + 1) * j.tw), (j.ty + r) * W + j.tx); moved.push({ x: j.tx, y: j.ty, w: j.tw, h: j.th, dx: j.dx, dy: j.dy, corr: j.corr }); });
    if (opts.map) for (const m of [opts.map.mx.data32F, opts.map.my.data32F]) {             // the same moves in the movement map (Compare tab)
      const ps = jobs.map(j => { const p = new Float32Array(j.tw * j.th); for (let r = 0; r < j.th; r++) p.set(m.subarray((j.ty + j.dy + r) * W + j.tx + j.dx, (j.ty + j.dy + r) * W + j.tx + j.dx + j.tw), r * j.tw); return p; });
      for (const j of jobs) for (let r = 0; r < j.th; r++) m.fill(OUTSIDE, (j.ty + j.dy + r) * W + j.tx + j.dx, (j.ty + j.dy + r) * W + j.tx + j.dx + j.tw);
      jobs.forEach((j, n) => { for (let r = 0; r < j.th; r++) m.set(ps[n].subarray(r * j.tw, (r + 1) * j.tw), (j.ty + r) * W + j.tx); });
    }
    return { aligned: S.release(out), moved, seen };
  } finally { S.free(); }
}

module.exports = { tileAlign, alignMarginItems, identityMap, levelsFor, LEVELS, OUTSIDE };
