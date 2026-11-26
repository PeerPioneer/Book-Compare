'use strict';
/* The alignment chain without any file handling, so that it can run in Node.js (research scripts) and in the browser's worker (app).
   Input: the red channel of a scan scaled to 3000 px height as a 32-bit float Mat (see printed_area.js: redScaled). */
const { inkMap, printedBox, extendBoxByStaves, extendBoxByHeadLines, scope } = require('./printed_area');
const { roughAlign, warp } = require('./rough_align');
const { tileAlign, alignMarginItems, identityMap } = require('./tile_align');

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/* share of ink (in the box x0,y0,x1,y1) that has no partner within 1 pixel in the other picture; as in align_pair.py */
function unmatchedShare(cv, a_, b_, box) {
  const S = scope();
  try {
    const [x0, y0, x1, y1] = box, w = a_.cols;
    const bin = m => { const d = S.add(new cv.Mat()), o = S.add(new cv.Mat()); cv.threshold(m, d, 0.5, 1, cv.THRESH_BINARY); d.convertTo(o, cv.CV_8U); d.delete(); return o; };
    const A = bin(a_), B = bin(b_), K = S.add(cv.Mat.ones(3, 3, cv.CV_8U)), Ad = S.add(new cv.Mat()), Bd = S.add(new cv.Mat());
    cv.dilate(A, Ad, K); cv.dilate(B, Bd, K);
    let ua = 0, ub = 0, na = 0, nb = 0; const a = A.data, b = B.data, ad = Ad.data, bd = Bd.data;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = y * w + x; na += a[i]; nb += b[i]; if (a[i] && !bd[i]) ua++; if (b[i] && !ad[i]) ub++; }
    return { share: (ua + ub) / Math.max(1, na + nb), ink: na + nb };
  } finally { S.free(); }
}

/* ink pixels (ink map > 0.5) inside a box [x0, y0, x1, y1] */
function inkIn(ink, box) {
  const W = ink.cols, H = ink.rows, d = ink.data32F;
  let n = 0;
  for (let y = Math.max(0, box[1]); y < Math.min(H, box[3]); y++) for (let x = Math.max(0, box[0]); x < Math.min(W, box[2]); x++) if (d[y * W + x] > 0.5) n++;
  return n;
}

/* A4 (20 Nov 2026): the printed-area box, with a second candidate for scans that have a dark border inside the picture.
   Such a border (gilt edge, table, ruler; Opusculum musices, Brussels: 58 of 79 pages) makes the standard box either a small fragment of the page
   (30 pages) or the whole scan (28 pages), which broke the fine alignment ("box too small") or made it meaningless. Second candidate: the same procedure
   with the outer 5 % of the picture ignored (BORDER). The standard box stays unless it is evidently wrong: (1) it touches two or more edges of the
   scan (a printed area never reaches the scan edge on two sides), or (2) the second box holds at least 8 % more ink (the standard box cuts through print).
   Where the standard box is right the two boxes are the same or differ by a few pixels (every other scan tested), so nothing changes there.
   Returns { box, which: 'standard' | 'border', standard, border, why, stretched } (stretched: A1, the box was extended over staves that hang on it). */
const BORDER = 0.05, MORE_INK = 1.08, NEAR_EMPTY = 0.02;
function chooseBox(cv, red, ink, dark) {
  const std = printedBox(cv, red), W = red.cols, H = red.rows;
  const tx = Math.round(0.01 * W), ty = Math.round(0.01 * H);
  const sides = (std[0] <= tx) + (std[2] >= W - tx) + (std[1] <= ty) + (std[3] >= H - ty);
  const bor = printedBox(cv, red, { border: BORDER });
  let which = 'standard', why = '';
  if (sides >= 2) { which = 'border'; why = 'the standard box touches ' + sides + ' edges of the scan'; }
  else if (inkIn(ink, bor) >= MORE_INK * Math.max(1, inkIn(ink, std))) { which = 'border'; why = 'the standard box cuts through print'; }
  let box = which === 'border' ? bor : std, stretched = false;
  if (!(typeof process !== 'undefined' && process.env && process.env.BC_NOSTAFF === '1')) {      // A1: a staff system hanging on the box (sparse staves) belongs to it (BC_NOSTAFF=1: research, switched off)
    const ext = extendBoxByStaves(box, ink);
    if (ext[1] !== box[1] || ext[3] !== box[3]) { box = ext; stretched = true; }
  }
  let head = null, before = box.slice();                                                               // 0.15.0: headline, folio number, catchword, signature
  if (dark && !(typeof process !== 'undefined' && process.env && process.env.BC_NOHEAD === '1')) {   // (BC_NOHEAD=1: research, switched off)
    const e = extendBoxByHeadLines(cv, box, dark);
    if (e.top || e.bottom) { head = { top: e.top, bottom: e.bottom }; box = e.box; }
  }
  const density = inkIn(ink, box) / Math.max(1, (box[2] - box[0]) * (box[3] - box[1]));                // share of the box that is ink (real pages: 0.10-0.40)
  return { box, which, standard: std, border: bor, why, stretched, density, head, before };
}

/* reference copy: printed area and ink map (kept for all copies that are aligned onto it) */
function prepareReference(cv, red, dark) {
  const t0 = now();
  const ref = inkMap(cv, red), t1 = now();
  let pick;
  try { pick = chooseBox(cv, red, ref, dark); } catch (e) { ref.delete(); throw e; }          // (a failure leaves nothing behind: printedBox and inkMap free their own memory)
  const t2 = now();
  const box = pick.box;
  return { ref, box, boxInfo: pick, times: { box_s: (t2 - t1) / 1000, ink_ref_s: (t1 - t0) / 1000 } };
}

/* V2b (21 Nov 2026): the printed area corrected by hand, as a shape with four free corners (quad: x, y of the corners clockwise from the top left,
   as fractions 0-1 of the picture). Everything outside the shape is left out of the alignment - in the reference AND in the other copy (after the
   rough step) - so a dark binding edge or a sliver of the next page no longer pulls the alignment; the box becomes the rectangle around the shape. */
function quadOk(q) {
  if (!Array.isArray(q) || q.length !== 8 || !q.every(v => typeof v === 'number' && isFinite(v) && v >= 0 && v <= 1)) return false;
  let a = 0; for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; a += q[2 * i] * q[2 * j + 1] - q[2 * j] * q[2 * i + 1]; }
  return Math.abs(a) / 2 > 0.02;                                                     // (at least 2 % of the picture)
}
function quadMask(W, H, q) {
  const px = [], py = [], m = new Uint8Array(W * H);
  for (let i = 0; i < 4; i++) { px.push(q[2 * i] * W); py.push(q[2 * i + 1] * H); }
  for (let y = 0; y < H; y++) {
    const yc = y + 0.5, xs = [];
    for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; if ((py[i] <= yc) !== (py[j] <= yc)) xs.push(px[i] + (yc - py[i]) * (px[j] - px[i]) / (py[j] - py[i])); }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) { const a = Math.max(0, Math.ceil(xs[k] - 0.5)), b = Math.min(W - 1, Math.floor(xs[k + 1] - 0.5)); for (let x = a; x <= b; x++) m[y * W + x] = 1; }
  }
  return m;
}
function applyQuad(refState, quad) {
  if (!quadOk(quad)) return false;
  const W = refState.ref.cols, H = refState.ref.rows, m = quadMask(W, H, quad), d = refState.ref.data32F;
  for (let i = 0; i < m.length; i++) if (!m[i]) d[i] = 0;
  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  for (let i = 0; i < 4; i++) { const x = quad[2 * i] * W, y = quad[2 * i + 1] * H; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  refState.autoBox = refState.box;
  refState.box = [Math.max(0, Math.floor(x0)), Math.max(0, Math.floor(y0)), Math.min(W, Math.ceil(x1)), Math.min(H, Math.ceil(y1))];
  refState.mask = m; refState.quad = quad.slice();
  return true;
}

/* aligns one more copy (red channel Mat) onto the prepared reference. Set opts.measure to also compute the unmatched-ink shares
   (not counted in the times). Returns { aligned (Mat, caller deletes), rough (Mat or null), W, tbox, stats, times, unmatched } */
function alignCopy(cv, refState, red, opts = {}) {
  const S = scope();
  try { return alignCopyIn(cv, refState, red, opts, S); } finally { S.free(); }      // whatever fails half-way gives its memory back (A5)
}
function alignCopyIn(cv, refState, red, opts, S) {
  const { ref, box } = refState, tm = {}; let t = now();
  const mov = S.add(inkMap(cv, red)); tm.ink_s = (now() - t) / 1000; t = now();
  const persp = opts.perspective !== false && !(typeof process !== 'undefined' && process.env && process.env.BC_NOPERSP === '1');
  const res = roughAlign(cv, ref, mov, box, { q: 4, fastScales: true, perspective: persp }); tm.rough_s = (now() - t) / 1000; t = now();
  const cut = (m) => { if (refState.mask) { const d = m.data32F, mk = refState.mask; for (let i = 0; i < mk.length; i++) if (!mk[i]) d[i] = 0; } };      // V2b: outside the hand-set shape
  let rough = S.add(warp(cv, mov, res.W, ref.cols, ref.rows)); cut(rough);
  let model = 'affine', roughCmp = null;
  if (res.Wp) {
    /* B1: the perspective candidate is kept only when it clearly fits better: at least 3 points less unmatched ink (of the box) and at least
       10 % less in relation. On flat scans the two are practically the same, and the simpler whole-page step stays. */
    const rp = S.add(warp(cv, mov, res.Wp, ref.cols, ref.rows)); cut(rp);
    const ua = unmatchedShare(cv, ref, rough, box).share, up = unmatchedShare(cv, ref, rp, box).share;
    roughCmp = { affine: +ua.toFixed(4), perspective: +up.toFixed(4) };
    if (up <= ua - 0.03 && up <= 0.9 * ua) { rough.delete(); rough = rp; res.W = res.Wp; model = 'perspective'; }
    else rp.delete();
  }
  tm.warp_s = (now() - t) / 1000;
  const [x0, y0, x1, y1] = box, w = ref.cols, h = ref.rows;
  const envRing = (typeof process !== 'undefined' && process.env && process.env.BC_RING) ? +process.env.BC_RING : null;     // research only (A2): ring width as a fraction of the longer box side
  const envEdge = (typeof process !== 'undefined' && process.env && process.env.BC_EDGE) ? +process.env.BC_EDGE : null;     // research only (A2): strip along the scan edge that is never fine-aligned (px)
  const m = Math.max(60, Math.floor((opts.ring != null ? opts.ring : envRing != null ? envRing : 0.02) * Math.max(x1 - x0, y1 - y0)));
  const e = opts.edge != null ? opts.edge : envEdge != null ? envEdge : 60;
  const tbox = [Math.max(e, x0 - m), Math.min(w - e, x1 + m), Math.max(e, y0 - m), Math.min(h - e, y1 + m)];
  /* A3 (20 Nov 2026): a page with almost no ink (title page, blank page, a few lines) gives the tile step nothing to hold on to: it would bend the copy
     by whatever it finds and report a number that means nothing. Ink is 4-15 % of the picture on the real pages tested (blank staves included, because
     staves are ink; the emptiest real page, Canti C p.7, has 1 %). Below NEAR_EMPTY of the whole picture, in the reference OR in the other copy,
     only the rough (whole-page) alignment is used and the result says so (sparse: true). The share is taken over the whole picture, not the box,
     because the box shrinks around whatever little there is. */
  const everything = [0, 0, w, h], density = Math.min(inkIn(ref, everything), inkIn(rough, everything)) / (w * h), sparse = density < NEAR_EMPTY;
  t = now();
  let aligned, stats = [], field = null;
  const map = opts.composeMap ? identityMap(cv, w, h) : null;                 // Compare tab (V3): the whole tile movement as one map, see tile_align.js
  const mapHolder = map ? S.add({ delete() { map.mx.delete(); map.my.delete(); } }) : null;     // (the two Mats are replaced level by level: this frees whichever are current)
  if (sparse) { aligned = rough.clone(); S.add(aligned); }
  else ({ aligned, stats, field } = tileAlign(cv, ref, rough, tbox, { trackField: !!opts.trackField, levels: opts.levels, map }));
  S.add(aligned);
  let margin = null;
  if (!sparse && !opts.noMargin && !(typeof process !== 'undefined' && process.env && process.env.BC_NOMARGIN === '1')) {      // A2: headline, folio number, signature, catchword
    const m = alignMarginItems(cv, ref, aligned, box, { map }); aligned.delete(); aligned = S.add(m.aligned); margin = { moved: m.moved, seen: m.seen };
  }
  tm.tiles_s = (now() - t) / 1000;
  tm.total_s = tm.ink_s + tm.rough_s + tm.warp_s + tm.tiles_s;
  mov.delete();
  const out = { field, map, aligned, rough, W: res.W, model, roughCmp, tbox, stats, times: tm, ecc: res.ecc, score: res.score, scale: res.scale, sparse, density, margin };
  if (opts.measure) out.unmatched = { rough: unmatchedShare(cv, ref, rough, box).share, tiles: unmatchedShare(cv, ref, aligned, box).share };
  if (!opts.keepRough) { rough.delete(); out.rough = null; }
  S.release(aligned); if (out.rough) S.release(rough);                          // handed to the caller, who deletes them
  if (mapHolder) S.release(mapHolder);
  return out;
}

module.exports = { prepareReference, chooseBox, alignCopy, unmatchedShare, now, applyQuad, quadOk, quadMask };
