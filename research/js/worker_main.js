/* Entry of the browser worker: the alignment chain (printed area, rough step, tiles) on scans, off the page's main thread.
   Messages in:  { id, cmd: 'init' }  |  { id, cmd: 'reference', file }  |  { id, cmd: 'align', file, measure }  |  { id, cmd: 'alignColor', file, tiles, store }
                 { id, cmd: 'alignStore', refFile, refKey, file, tiles, quad }  (background alignment, V8-V10: only the movement comes back, packed for storing)
                 (quad, also for 'reference': the printed area set by hand for the reference scan, V2b)
                 { id, cmd: 'warpStored', file, bin }                     (a stored movement applied to the copy: no aligning)
   (tiles: { main, sub }, the tile settings of this copy on this page, V15; left out = standard)
   Messages out: { id, ok: true, result } or { id, ok: false, error }
   OpenCV.js (about 13 MB) is loaded once, by 'init'. */
var OPENCV_URL = '../deps/opencv/opencv.js';
var cvReady = null, refState = null, lastJob = null;          // lastJob: the copy of the last alignColor / warpStored and its rough step (V16 rough view)

function loadOpenCv() {
  if (cvReady) return cvReady;
  cvReady = (async function () {
    var t0 = performance.now();
    importScripts(OPENCV_URL);
    var c = self.cv;
    if (c instanceof Promise) c = await c;
    else if (c && typeof c.then === 'function') c = await new Promise(function (r) { c.then(function (x) { delete x.then; r(x); }); });
    else if (!c.Mat) await new Promise(function (r) { c.onRuntimeInitialized = r; });
    self.cv = c;
    return { cv: c, load_s: (performance.now() - t0) / 1000 };
  })();
  return cvReady;
}

/* a scan -> red channel at the working height of 3000 px (32-bit float Mat); keep = true also keeps the opened picture (bmp) for the caller */
async function decodeRed(cv, file, keep) {
  var P = require('./printed_area');
  var t0 = performance.now(), bmp;
  try { bmp = await createImageBitmap(file); }
  catch (e) { throw new Error('The browser could not open the scan "' + (file.name || 'picture') + '" (' + (file.size / 1e6).toFixed(1) + ' MB).'); }
  var w0 = bmp.width, h0 = bmp.height, w = Math.round(w0 * P.H0 / h0);
  var oc = new OffscreenCanvas(w, P.H0), ctx = oc.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, w, P.H0); if (!keep) bmp.close();
  var id = ctx.getImageData(0, 0, w, P.H0);
  var red = P.redScaled(cv, id.data, w, P.H0);
  return { red: red, w0: w0, h0: h0, bmp: keep ? bmp : null, decode_s: (performance.now() - t0) / 1000 };
}

/* The other copy in colour, bent onto the reference at the reference's full size (Compare tab, V3).
   The movement found at working size (rough step W, then the tile map) is read for every pixel of the full-size result and applied to the
   full-size colour scan, in strips, so only one strip of the maps exists at a time. Pixels from outside the scan stay transparent. */
function warpColour(cv, bmp, r, ref, refW0, refH0) {
  var Tl = require('./tile_align');
  var mw = bmp.width, mh = bmp.height, oc = new OffscreenCanvas(mw, mh), ctx = oc.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0); bmp.close();
  var src = cv.matFromImageData(ctx.getImageData(0, 0, mw, mh)); oc.width = oc.height = 1;
  var Wr = ref.cols, Hr = ref.rows, Wm = Math.round(mw * 3000 / mh), Hm = 3000;          // working sizes (reference and other copy)
  var W = r.W, P = W.length === 9, mxA = r.map ? r.map.mx.data32F.slice() : null, myA = r.map ? r.map.my.data32F.slice() : null;
  var out = new Uint8ClampedArray(refW0 * refH0 * 4), STRIP = 256;
  // for every column / row of the result: the two neighbouring working pixels and the weight
  function axis(n0, n) { var i0 = new Int32Array(n0), wt = new Float32Array(n0), f = n / n0; for (var k = 0; k < n0; k++) { var v = Math.min(Math.max((k + 0.5) * f - 0.5, 0), n - 1.001); i0[k] = Math.floor(v); wt[k] = v - i0[k]; } return { i: i0, w: wt }; }
  var cx = axis(refW0, Wr), cy = axis(refH0, Hr), sx = mw / Wm, sy = mh / Hm, OUT = -1e5;
  try {
    for (var y0 = 0; y0 < refH0; y0 += STRIP) {
      var h = Math.min(STRIP, refH0 - y0), mapx = new cv.Mat(h, refW0, cv.CV_32F), mapy = new cv.Mat(h, refW0, cv.CV_32F), dst = new cv.Mat();
      try {
        var ax = mapx.data32F, ay = mapy.data32F;
        for (var yy = 0; yy < h; yy++) {
          var j = cy.i[y0 + yy], wy = cy.w[y0 + yy], o = yy * refW0;
          for (var x = 0; x < refW0; x++) {
            var i = cx.i[x], wx = cx.w[x], px, py;
            if (mxA) {
              var p00 = j * Wr + i, p01 = p00 + 1, p10 = p00 + Wr, p11 = p10 + 1;
              var a00 = mxA[p00], a01 = mxA[p01], a10 = mxA[p10], a11 = mxA[p11];
              if (a00 < -1e4 || a01 < -1e4 || a10 < -1e4 || a11 < -1e4) { ax[o + x] = OUT; ay[o + x] = OUT; continue; }
              px = (a00 * (1 - wx) + a01 * wx) * (1 - wy) + (a10 * (1 - wx) + a11 * wx) * wy;
              py = (myA[p00] * (1 - wx) + myA[p01] * wx) * (1 - wy) + (myA[p10] * (1 - wx) + myA[p11] * wx) * wy;
            } else { px = i + wx; py = j + wy; }
            var u = W[0] * px + W[1] * py + W[2], v = W[3] * px + W[4] * py + W[5];           // working place in the other copy
            if (P) { var dn = W[6] * px + W[7] * py + W[8]; u /= dn; v /= dn; }                 // (B1: a perspective rough step)
            ax[o + x] = (u + 0.5) * sx - 0.5; ay[o + x] = (v + 0.5) * sy - 0.5;               // its full-size place
          }
        }
        cv.remap(src, dst, mapx, mapy, cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(0, 0, 0, 0));
        out.set(dst.data.subarray(0, h * refW0 * 4), y0 * refW0 * 4);
      } finally { mapx.delete(); mapy.delete(); dst.delete(); }
    }
  } finally { src.delete(); }
  return out;
}

// quad (V2b): the printed area set by hand for this scan (four corners, fractions of the picture), or nothing = the automatic box
async function setReference(cv, file, key, quad) {
  var Pl = require('./pipeline');
  if (refState) { refState.ref.delete(); refState = null; } lastJob = null;
  var d = await decodeRed(cv, file);
  try { refState = Pl.prepareReference(cv, d.red); } finally { d.red.delete(); }     // a page that fails keeps no memory (A5)
  refState.w0 = d.w0; refState.h0 = d.h0; refState.key = key || null;
  var Wr = refState.ref.cols, Hr = refState.ref.rows, b = refState.box;
  refState.autoBoxF = [b[0] / Wr, b[1] / Hr, b[2] / Wr, b[3] / Hr];                   // the automatic box, as fractions (shown in the Compare tab)
  if (quad) Pl.applyQuad(refState, quad);
  return d;
}
// the movement of one aligned page, packed for storing (V10, stored_movement.js): compressed bytes
async function packMovement(r, mv, extra) {
  var Sm = require('./stored_movement'), Wr = refState.ref.cols, Hr = refState.ref.rows;
  var s = r.map ? Sm.downsample(r.map.mx.data32F, r.map.my.data32F, Wr, Hr) : null;
  var meta = Object.assign({ W: Array.prototype.slice.call(r.W), Wr: Wr, Hr: Hr, refW0: refState.w0, refH0: refState.h0, mvw: mv.w, mvh: mv.h, max: mv.max, hint: mv.hint,
    box: refState.autoBoxF, quad: refState.quad || null,
    unmatched_tiles: r.unmatched ? r.unmatched.tiles : null, unmatched_rough: r.unmatched ? r.unmatched.rough : null, sparse: !!r.sparse, ink_density: r.density }, extra || {});
  return (await Sm.compress(Sm.pack(meta, s, mv.pixels))).buffer;
}

var handlers = {
  init: async function () { var o = await loadOpenCv(); return { load_s: o.load_s }; },
  reference: async function (m) {
    var cv = (await loadOpenCv()).cv;
    var d = await setReference(cv, m.file, null, m.quad);
    return { w: d.w0, h: d.h0, decode_s: d.decode_s, box: refState.box, auto_box: refState.autoBoxF, quad: refState.quad || null, box_which: refState.boxInfo.which, box_why: refState.boxInfo.why, box_s: refState.times.box_s, ink_s: refState.times.ink_ref_s };
  },
  // background alignment (V8-V10): the copy onto the reference page (prepared again only when it is another page), only the movement comes back
  alignStore: async function (m) {
    var cv = (await loadOpenCv()).cv, Pl = require('./pipeline'), t0 = performance.now();
    if (!refState || !m.refKey || refState.key !== m.refKey) await setReference(cv, m.refFile, m.refKey, m.quad);
    var d = await decodeRed(cv, m.file), r = null;
    try {
      try { r = Pl.alignCopy(cv, refState, d.red, { measure: true, composeMap: true, levels: m.tiles ? require('./tile_align').levelsFor(m.tiles.main, m.tiles.sub) : undefined }); } finally { d.red.delete(); }
      r.aligned.delete();
      var mv = require('./movement').movementMap(r, refState.ref.cols, refState.ref.rows, refState.box);
      var bin = await packMovement(r, mv, { w0: d.w0, h0: d.h0 });
      return { bin: bin, unmatched_tiles: r.unmatched.tiles, unmatched_rough: r.unmatched.rough, sparse: !!r.sparse, max: mv.max, hint: mv.hint, total_s: (performance.now() - t0) / 1000, transfer: [bin] };
    } finally { if (r && r.map) { r.map.mx.delete(); r.map.my.delete(); } }
  },
  // a stored movement applied to the copy: the same colour picture as alignColor, without aligning again
  warpStored: async function (m) {
    var cv = (await loadOpenCv()).cv, Sm = require('./stored_movement'), t0 = performance.now();
    var st = Sm.unpack(await Sm.decompress(new Uint8Array(m.bin))), meta = st.meta, map = null;
    var up = null;
    if (st.map) { up = Sm.upsample(st.map, meta.Wr, meta.Hr); map = { mx: { data32F: up.mx }, my: { data32F: up.my } }; }
    var bmp;
    try { bmp = await createImageBitmap(m.file); }
    catch (e) { throw new Error('The browser could not open the scan "' + (m.file.name || 'picture') + '" (' + (m.file.size / 1e6).toFixed(1) + ' MB).'); }
    var px = warpColour(cv, bmp, { W: meta.W, map: map }, { cols: meta.Wr, rows: meta.Hr }, meta.refW0, meta.refH0);
    lastJob = { file: m.file, W: meta.W, Wr: meta.Wr, Hr: meta.Hr, w0: meta.refW0, h0: meta.refH0 };
    var res = { w: meta.refW0, h: meta.refH0, pixels: px.buffer, stored: true, colour_s: (performance.now() - t0) / 1000,
      unmatched_tiles: meta.unmatched_tiles, unmatched_rough: meta.unmatched_rough, sparse: meta.sparse, ink_density: meta.ink_density, margin_moved: 0, movement: null,
      box: meta.box || null, quad: meta.quad || null };
    res.transfer = [px.buffer];
    if (st.mv) {
      var mvpx = new Uint8ClampedArray(st.mv), mw = meta.mvw, Mv = require('./movement');
      // the arrows again from the stored map: only where the movement picture is coloured (moved by 2 px or more, inside the tile area)
      var arrows = up ? Mv.movementArrows(up.mx, up.my, meta.Wr, meta.Hr, function (x, y) { return mvpx[(Math.floor(y / 4) * mw + Math.floor(x / 4)) * 4 + 3] > 0; }) : [];
      res.movement = { w: mw, h: meta.mvh, pixels: mvpx.buffer, max: meta.max, hint: meta.hint, arrows: arrows, W: meta.Wr, H: meta.Hr }; res.transfer.push(mvpx.buffer);
    }
    return res;
  },
  align: async function (m) {
    var cv = (await loadOpenCv()).cv, Pl = require('./pipeline');
    if (!refState) throw new Error('no reference copy has been set');
    var d = await decodeRed(cv, m.file);
    var r; try { r = Pl.alignCopy(cv, refState, d.red, { measure: !!m.measure }); } finally { d.red.delete(); }
    r.aligned.delete();
    var t = r.times;
    return { w: d.w0, h: d.h0, decode_s: d.decode_s, ink_s: t.ink_s, rough_s: t.rough_s, tiles_s: t.tiles_s + t.warp_s,
      total_s: d.decode_s + t.total_s, unmatched_rough: r.unmatched && r.unmatched.rough, unmatched_tiles: r.unmatched && r.unmatched.tiles,
      scale: r.scale, ecc: r.ecc, sparse: r.sparse, ink_density: r.density };
  },
  // Compare tab (V16): the copy of the last alignColor job again, bent by the rough (whole-page) step only - "what the fine alignment changed"
  roughColor: async function () {
    var cv = (await loadOpenCv()).cv;
    if (!lastJob) throw new Error('nothing has been aligned yet');
    var d = await decodeRed(cv, lastJob.file, true);
    d.red.delete();
    var px = warpColour(cv, d.bmp, { W: lastJob.W, map: null }, { cols: lastJob.Wr, rows: lastJob.Hr }, lastJob.w0, lastJob.h0);
    return { w: lastJob.w0, h: lastJob.h0, pixels: px.buffer, transfer: [px.buffer] };
  },
  // Compare tab: the other copy bent onto the reference, in colour, as big as the reference scan (RGBA, sent back without copying)
  alignColor: async function (m) {
    var cv = (await loadOpenCv()).cv, Pl = require('./pipeline');
    if (!refState) throw new Error('no reference copy has been set');
    var d = await decodeRed(cv, m.file, true), r = null;
    try {
      try { r = Pl.alignCopy(cv, refState, d.red, { measure: true, composeMap: true, levels: m.tiles ? require('./tile_align').levelsFor(m.tiles.main, m.tiles.sub) : undefined }); } finally { d.red.delete(); }
      r.aligned.delete();
      var t0 = performance.now();
      var px = warpColour(cv, d.bmp, r, refState.ref, refState.w0, refState.h0); d.bmp = null;
      var t = r.times, mv = require('./movement').movementMap(r, refState.ref.cols, refState.ref.rows, refState.box);
      lastJob = { file: m.file, W: Array.prototype.slice.call(r.W), Wr: refState.ref.cols, Hr: refState.ref.rows, w0: refState.w0, h0: refState.h0 };   // for the rough view (roughColor)
      var bin = m.store ? await packMovement(r, mv, { w0: d.w0, h0: d.h0 }) : null;          // (kept by the page when this pair is one with the reference, V10)
      var res = { w: refState.w0, h: refState.h0, pixels: px.buffer, decode_s: d.decode_s, rough_s: t.rough_s, tiles_s: t.tiles_s + t.warp_s, colour_s: (performance.now() - t0) / 1000,
        unmatched_rough: r.unmatched.rough, unmatched_tiles: r.unmatched.tiles, sparse: r.sparse, ink_density: r.density, margin_moved: r.margin ? r.margin.moved.length : 0,
        box: refState.autoBoxF, quad: refState.quad || null,
        movement: { w: mv.w, h: mv.h, pixels: mv.pixels, max: mv.max, hint: mv.hint, arrows: mv.arrows, W: mv.W, H: mv.H } };
      res.transfer = [px.buffer, mv.pixels];
      if (bin) { res.bin = bin; res.transfer.push(bin); }
      return res;
    } finally {
      if (d.bmp) d.bmp.close();
      if (r && r.map) { r.map.mx.delete(); r.map.my.delete(); }
    }
  }
};

self.onmessage = function (ev) {
  var m = ev.data;
  handlers[m.cmd](m).then(function (res) { var tr = (res && res.transfer) || []; if (res) delete res.transfer; self.postMessage({ id: m.id, ok: true, result: res }, tr); },
    function (e) { self.postMessage({ id: m.id, ok: false, error: (typeof e === 'number' && self.cv && self.cv.exceptionFromPtr) ? self.cv.exceptionFromPtr(e).msg : ((e && e.message) || String(e)) }); });
};
