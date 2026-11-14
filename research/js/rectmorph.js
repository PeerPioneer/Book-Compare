'use strict';
/* Fast erosion / dilation / opening / closing with all-ones rectangles on 0/1 masks (Uint8Array, row by row).
   OpenCV.js (WebAssembly) is slow for long thin kernels (1200 x 15 pixels takes about 7 s); here the time does not depend
   on the kernel length, because each pass over a row or column uses running totals (prefix sums).
   Same conventions as OpenCV's defaults: anchor in the middle, outside the picture counts as 'ink' for erosion (so it
   never erodes from the border) and as 'paper' for dilation. */

function pass(src, dst, w, h, L, vertical, erode) {
  const n = vertical ? h : w, lines = vertical ? w : h;
  const step = vertical ? w : 1, lineStep = vertical ? 1 : w;
  const a = L >> 1;
  const P = new Int32Array(n + 1);
  for (let ln = 0; ln < lines; ln++) {
    const base = ln * lineStep;
    for (let i = 0, p = base; i < n; i++, p += step) P[i + 1] = P[i] + src[p];
    for (let x = 0, p = base; x < n; x++, p += step) {
      let lo = x - a, hi = x - a + L - 1;
      if (lo < 0) lo = 0;
      if (hi > n - 1) hi = n - 1;
      const ones = hi >= lo ? P[hi + 1] - P[lo] : 0;
      dst[p] = erode ? (ones === hi - lo + 1 ? 1 : 0) : (ones > 0 ? 1 : 0);
    }
  }
}

function rect(src, w, h, kh, kw, erode) {
  const t = new Uint8Array(src.length), o = new Uint8Array(src.length);
  if (erode) { pass(src, t, w, h, kh, true, true); pass(t, o, w, h, kw, false, true); }
  else { pass(src, t, w, h, kw, false, false); pass(t, o, w, h, kh, true, false); }
  return o;
}
const erodeRect = (s, w, h, kh, kw) => rect(s, w, h, kh, kw, true);
const dilateRect = (s, w, h, kh, kw) => rect(s, w, h, kh, kw, false);
const openRect = (s, w, h, kh, kw) => dilateRect(erodeRect(s, w, h, kh, kw), w, h, kh, kw);
const closeRect = (s, w, h, kh, kw) => erodeRect(dilateRect(s, w, h, kh, kw), w, h, kh, kw);

module.exports = { erodeRect, dilateRect, openRect, closeRect };
