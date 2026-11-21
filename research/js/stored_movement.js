'use strict';
/* Stored alignments (V10): how one copy's page was bent onto the reference page, kept small enough to keep for a whole book.
   Only the MOVEMENT is stored (decided 21 Nov 2026), never a picture of the result:
     - W: the rough (whole-page) step, 6 numbers
     - the fine movement of the tiles: for every 4th working pixel of the reference (working height 3000 px) how far the place in the
       other copy lies from where the rough step puts it, in 1/16 px (16-bit numbers), and "outside the scan" as a special value
     - the colour picture of the movement map (V16), cells of 4 x 4 working pixels, mostly transparent
   From this the Compare tab rebuilds the full map and bends the other copy's scan in colour without aligning again.
   File layout (before compression): "BCM1", length of the description (4 bytes), the description (JSON), then dx, dy (Int16, each row stored as
   differences from the left neighbour, which makes the file about half as big once compressed), the movement map (RGBA).
   A page takes about 100-250 KB (every 8th pixel would halve that, but bends the scans visibly less exactly on music pages). */

var MAGIC = [66, 67, 77, 49];                                  // "BCM1"
var CELL = 4, Q = 16, OUT16 = -32768, OUTSIDE = -1e6, FAR = 2000;

// mx, my: Float32Array (W x H) = the place in the roughly aligned copy for every working pixel of the reference (OUTSIDE = no scan there)
function downsample(mx, my, W, H, cell) {
  cell = cell || CELL;
  var cols = Math.ceil((W - 1) / cell) + 1, rows = Math.ceil((H - 1) / cell) + 1;
  var dx = new Int16Array(cols * rows), dy = new Int16Array(cols * rows);
  for (var r = 0; r < rows; r++) {
    var y = Math.min(r * cell, H - 1);
    for (var c = 0; c < cols; c++) {
      var x = Math.min(c * cell, W - 1), p = y * W + x, k = r * cols + c, a = mx[p], b = my[p];
      if (!(a > -1e4) || !(b > -1e4) || Math.abs(a - x) > FAR || Math.abs(b - y) > FAR) { dx[k] = OUT16; dy[k] = OUT16; continue; }   // (far away = beyond the scan)
      dx[k] = Math.max(-32767, Math.min(32767, Math.round((a - x) * Q)));
      dy[k] = Math.max(-32767, Math.min(32767, Math.round((b - y) * Q)));
    }
  }
  return { cell: cell, cols: cols, rows: rows, dx: dx, dy: dy };
}

// back to the full working size (bilinear between the stored points; next to "outside" the place is outside too)
function upsample(s, W, H) {
  var cell = s.cell, cols = s.cols, rows = s.rows, dx = s.dx, dy = s.dy;
  var mx = new Float32Array(W * H), my = new Float32Array(W * H);
  // for every column: the stored column to its left and the weight of the one to its right
  var cx = new Int32Array(W), wx = new Float32Array(W);
  for (var x = 0; x < W; x++) {
    var c = Math.min(Math.floor(x / cell), cols - 2), x0 = Math.min(c * cell, W - 1), x1 = Math.min((c + 1) * cell, W - 1);
    if (c < 0) { c = 0; x0 = x1 = 0; }
    cx[x] = c; wx[x] = x1 > x0 ? (x - x0) / (x1 - x0) : 0;
  }
  for (var y = 0; y < H; y++) {
    var r = Math.min(Math.floor(y / cell), rows - 2), y0, y1, wy;
    if (r < 0) { r = 0; wy = 0; } else { y0 = Math.min(r * cell, H - 1); y1 = Math.min((r + 1) * cell, H - 1); wy = y1 > y0 ? (y - y0) / (y1 - y0) : 0; }
    var r1 = rows > 1 ? r + 1 : r, o = y * W;
    for (var x2 = 0; x2 < W; x2++) {
      var c0 = cx[x2], c1 = cols > 1 ? c0 + 1 : c0, w = wx[x2];
      var k00 = r * cols + c0, k01 = r * cols + c1, k10 = r1 * cols + c0, k11 = r1 * cols + c1;
      var a00 = dx[k00], a01 = dx[k01], a10 = dx[k10], a11 = dx[k11];
      if ((a00 === OUT16 && (1 - w) * (1 - wy) > 0) || (a01 === OUT16 && w * (1 - wy) > 0) || (a10 === OUT16 && (1 - w) * wy > 0) || (a11 === OUT16 && w * wy > 0)) {
        mx[o + x2] = OUTSIDE; my[o + x2] = OUTSIDE; continue;
      }
      if (a00 === OUT16) a00 = 0; if (a01 === OUT16) a01 = 0; if (a10 === OUT16) a10 = 0; if (a11 === OUT16) a11 = 0;
      var b00 = dy[k00] === OUT16 ? 0 : dy[k00], b01 = dy[k01] === OUT16 ? 0 : dy[k01], b10 = dy[k10] === OUT16 ? 0 : dy[k10], b11 = dy[k11] === OUT16 ? 0 : dy[k11];
      var ddx = ((a00 * (1 - w) + a01 * w) * (1 - wy) + (a10 * (1 - w) + a11 * w) * wy) / Q;
      var ddy = ((b00 * (1 - w) + b01 * w) * (1 - wy) + (b10 * (1 - w) + b11 * w) * wy) / Q;
      mx[o + x2] = x2 + ddx; my[o + x2] = y + ddy;
    }
  }
  return { mx: mx, my: my };
}

// rows as differences from the left neighbour (with 16-bit wrap-around, so it is exact)
function delta(a, cols) { var o = new Int16Array(a.length); for (var i = 0; i < a.length; i++) o[i] = (i % cols) ? (a[i] - a[i - 1]) << 16 >> 16 : a[i]; return o; }
function undelta(e, cols) { var o = new Int16Array(e.length); for (var i = 0; i < e.length; i++) o[i] = (i % cols) ? (o[i - 1] + e[i]) << 16 >> 16 : e[i]; return o; }

// meta: plain description (JSON); s: from downsample (or null when there is no fine map); mv: movement map RGBA (Uint8Array/Uint8ClampedArray) or null
function pack(meta, s, mv) {
  if (mv && !ArrayBuffer.isView(mv)) mv = new Uint8Array(mv);                       // (the movement map may come as a plain buffer)
  var m = Object.assign({}, meta, { v: 1, cell: s ? s.cell : 0, cols: s ? s.cols : 0, rows: s ? s.rows : 0, mvLen: mv ? mv.length : 0 });
  var json = new TextEncoder().encode(JSON.stringify(m));
  var head = 8 + json.length, pad = head % 2, n = s ? s.cols * s.rows : 0;
  var total = head + pad + n * 4 + (mv ? mv.length : 0), out = new Uint8Array(total);
  out.set(MAGIC, 0);
  new DataView(out.buffer).setUint32(4, json.length, true);
  out.set(json, 8);
  var o = head + pad;
  if (s) { var ex = delta(s.dx, s.cols), ey = delta(s.dy, s.cols); out.set(new Uint8Array(ex.buffer), o); out.set(new Uint8Array(ey.buffer), o + n * 2); o += n * 4; }
  if (mv) out.set(mv, o);
  return out;
}
function unpack(u8) {
  if (!(u8 && u8.length > 8 && u8[0] === MAGIC[0] && u8[1] === MAGIC[1] && u8[2] === MAGIC[2] && u8[3] === MAGIC[3])) throw new Error('not a stored alignment');
  var len = new DataView(u8.buffer, u8.byteOffset, u8.byteLength).getUint32(4, true);
  var meta = JSON.parse(new TextDecoder().decode(u8.subarray(8, 8 + len)));
  var o = 8 + len + ((8 + len) % 2), n = meta.cols * meta.rows;
  var buf = u8.buffer.slice(u8.byteOffset + o, u8.byteOffset + o + n * 4 + meta.mvLen);        // (copied: Int16 needs an even start)
  var s = n ? { cell: meta.cell, cols: meta.cols, rows: meta.rows, dx: undelta(new Int16Array(buf, 0, n), meta.cols), dy: undelta(new Int16Array(buf, n * 2, n), meta.cols) } : null;
  var mv = meta.mvLen ? new Uint8ClampedArray(buf, n * 4, meta.mvLen) : null;
  return { meta: meta, map: s, mv: mv };
}

// gzip in the browser (CompressionStream); without it the bytes are kept as they are (unpack recognises both)
async function compress(u8) {
  if (typeof CompressionStream === 'undefined') return u8;
  var cs = new Blob([u8]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(cs).arrayBuffer());
}
async function decompress(u8) {
  if (u8[0] !== 0x1f || u8[1] !== 0x8b) return u8;
  if (typeof DecompressionStream === 'undefined') throw new Error('this browser cannot read a stored alignment');
  var ds = new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(ds).arrayBuffer());
}

module.exports = { downsample: downsample, upsample: upsample, pack: pack, unpack: unpack, compress: compress, decompress: decompress, CELL: CELL, OUTSIDE: OUTSIDE };
