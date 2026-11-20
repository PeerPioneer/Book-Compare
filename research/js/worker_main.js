/* Entry of the browser worker: the alignment chain (printed area, rough step, tiles) on scans, off the page's main thread.
   Messages in:  { id, cmd: 'init' }  |  { id, cmd: 'reference', file }  |  { id, cmd: 'align', file, measure }
   Messages out: { id, ok: true, result } or { id, ok: false, error }
   OpenCV.js (about 13 MB) is loaded once, by 'init'. */
var OPENCV_URL = '../deps/opencv/opencv.js';
var cvReady = null, refState = null;

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

/* a scan -> red channel at the working height of 3000 px (32-bit float Mat) */
async function decodeRed(cv, file) {
  var P = require('./printed_area');
  var t0 = performance.now(), bmp;
  try { bmp = await createImageBitmap(file); }
  catch (e) { throw new Error('The browser could not open the scan "' + file.name + '" (' + (file.size / 1e6).toFixed(1) + ' MB).'); }
  var w0 = bmp.width, h0 = bmp.height, w = Math.round(w0 * P.H0 / h0);
  var oc = new OffscreenCanvas(w, P.H0), ctx = oc.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, w, P.H0); bmp.close();
  var id = ctx.getImageData(0, 0, w, P.H0);
  var red = P.redScaled(cv, id.data, w, P.H0);
  return { red: red, w0: w0, h0: h0, decode_s: (performance.now() - t0) / 1000 };
}

var handlers = {
  init: async function () { var o = await loadOpenCv(); return { load_s: o.load_s }; },
  reference: async function (m) {
    var cv = (await loadOpenCv()).cv, Pl = require('./pipeline');
    if (refState) { refState.ref.delete(); refState = null; }
    var d = await decodeRed(cv, m.file);
    try { refState = Pl.prepareReference(cv, d.red); } finally { d.red.delete(); }     // a page that fails keeps no memory (A5)
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
  }
};

self.onmessage = function (ev) {
  var m = ev.data;
  handlers[m.cmd](m).then(function (res) { self.postMessage({ id: m.id, ok: true, result: res }); },
    function (e) { self.postMessage({ id: m.id, ok: false, error: (typeof e === 'number' && self.cv && self.cv.exceptionFromPtr) ? self.cv.exceptionFromPtr(e).msg : ((e && e.message) || String(e)) }); });
};
