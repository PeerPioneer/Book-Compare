/* Entry of the browser worker: the alignment chain (printed area, rough step, tiles) on scans, off the page's main thread.
   Messages in:  { id, cmd: 'init' }  |  { id, cmd: 'reference', file }  |  { id, cmd: 'align', file, measure }  |  { id, cmd: 'alignColor', file, tiles }
   (tiles: { main, sub }, the tile settings of this copy on this page, V15; left out = standard)
   Messages out: { id, ok: true, result } or { id, ok: false, error }
   OpenCV.js (about 13 MB) is loaded once, by 'init'. */
var OPENCV_URL = '../deps/opencv/opencv.js';
var cvReady = null, refState = null, lastJob = null;          // lastJob: the copy of the last alignColor and its rough step (V16 rough view)

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
  var W = r.W, mxA = r.map ? r.map.mx.data32F.slice() : null, myA = r.map ? r.map.my.data32F.slice() : null;
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

var handlers = {
  init: async function () { var o = await loadOpenCv(); return { load_s: o.load_s }; },
  reference: async function (m) {
    var cv = (await loadOpenCv()).cv, Pl = require('./pipeline');
    if (refState) { refState.ref.delete(); refState = null; } lastJob = null;
    var d = await decodeRed(cv, m.file);
    try { refState = Pl.prepareReference(cv, d.red); } finally { d.red.delete(); }     // a page that fails keeps no memory (A5)
    refState.w0 = d.w0; refState.h0 = d.h0;
    return { w: d.w0, h: d.h0, decode_s: d.decode_s, box: refState.box, box_which: refState.boxInfo.which, box_why: refState.boxInfo.why, box_s: refState.times.box_s, ink_s: refState.times.ink_ref_s };
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
    if (!refState || !lastJob) throw new Error('nothing has been aligned yet');
    var d = await decodeRed(cv, lastJob.file, true);
    d.red.delete();
    var px = warpColour(cv, d.bmp, { W: lastJob.W, map: null }, refState.ref, refState.w0, refState.h0);
    return { w: refState.w0, h: refState.h0, pixels: px.buffer, transfer: [px.buffer] };
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
      lastJob = { file: m.file, W: Array.prototype.slice.call(r.W) };                        // for the rough view (roughColor)
      var res = { w: refState.w0, h: refState.h0, pixels: px.buffer, decode_s: d.decode_s, rough_s: t.rough_s, tiles_s: t.tiles_s + t.warp_s, colour_s: (performance.now() - t0) / 1000,
        unmatched_rough: r.unmatched.rough, unmatched_tiles: r.unmatched.tiles, sparse: r.sparse, ink_density: r.density, margin_moved: r.margin ? r.margin.moved.length : 0,
        movement: { w: mv.w, h: mv.h, pixels: mv.pixels, max: mv.max, hint: mv.hint } };
      res.transfer = [px.buffer, mv.pixels];
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
