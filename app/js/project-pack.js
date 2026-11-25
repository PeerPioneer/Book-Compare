/* Book Compare: the project file (0.12.0, owner 25 Nov 2026: "keep everything that we save in one single file").

   A .bookcompare file holds the project AND its stored alignments. Until 0.11.0 it was a JSON text, and the alignments lay in a folder
   "<name>.bookcompare results" next to it (desktop program only; the website could not make that folder, so it stored nothing).

   The file is a short log of records that are only ever added at the end, so that saving never has to write the whole file again and a
   save that is cut off (power failure, crash) never spoils what was saved before:
     the 8 bytes 89 42 43 50 0D 0A 1A 0A  ("\x89BCP\r\n\x1a\n", like the start of a PNG file: shows when a file was damaged as text)
     then records, each: 4 letters (the kind) | length of the content (4 bytes) | CRC-32 of the content (4 bytes) | the content
       PROJ  the project as JSON (the same as the old file's text). The last good one counts; every save adds one.
       MOVE  one stored alignment: length of its name (2 bytes) | name | length of its description (4 bytes) | description (JSON, what
             it is valid for: see results-store.js) | the packed movement (research/js/stored_movement.js, about 100-250 KB)
             The last one of a name counts.
       DROP  names of stored alignments that were removed (JSON list)
   Records that are no longer the last of their name are "garbage". When there is much of it (and once the project is opened), the file
   is written anew with only what counts ("tidy up": write a new file, then replace the old one in one step).
   A record cut off at the end (its length runs past the end, or its CRC does not fit) is left out; the next save writes over it.

   The same code runs on the website (File System Access: a file handle) and in the desktop program (desktop/server.js reads parts of the
   file, adds at the end, replaces it, and copies the parts that count when tidying up). Only the project file is ever written. */
(function () {
  'use strict';
  var MAGIC = [0x89, 0x42, 0x43, 0x50, 0x0d, 0x0a, 0x1a, 0x0a];
  var HEAD = 12, WINDOW = 4 << 20;
  var KINDS = { PROJ: 1, MOVE: 1, DROP: 1 };
  var enc = new TextEncoder(), dec = new TextDecoder();

  var TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(u) { var c = 0xffffffff; for (var i = 0; i < u.length; i++) c = TABLE[(c ^ u[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

  function isPack(bytes) {
    var b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (b.length < MAGIC.length) return false;
    for (var i = 0; i < MAGIC.length; i++) if (b[i] !== MAGIC[i]) return false;
    return true;
  }
  function record(kind, content) {
    var h = new Uint8Array(HEAD), v = new DataView(h.buffer);
    for (var i = 0; i < 4; i++) h[i] = kind.charCodeAt(i);
    v.setUint32(4, content.length, true); v.setUint32(8, crc32(content), true);
    return new Blob([h, content]);
  }
  function moveContent(name, meta, bin) {
    var n = enc.encode(name), m = enc.encode(JSON.stringify(meta || {})), b = new Uint8Array(bin);
    var out = new Uint8Array(2 + n.length + 4 + m.length + b.length), v = new DataView(out.buffer);
    v.setUint16(0, n.length, true); out.set(n, 2);
    v.setUint32(2 + n.length, m.length, true); out.set(m, 6 + n.length);
    out.set(b, 6 + n.length + m.length);
    return out;
  }

  // Reads the file from `at` on in windows of a few MB (the desktop program answers each window with one request).
  function reader(io, size) {
    var buf = null, bufAt = 0;
    return async function (at, len) {
      if (at + len > size) return null;
      if (!buf || at < bufAt || at + len > bufAt + buf.length) {
        var n = Math.min(size - at, Math.max(len, WINDOW));
        buf = new Uint8Array(await io.read(at, n)); bufAt = at;
        if (buf.length < len) return null;
      }
      return buf.subarray(at - bufAt, at - bufAt + len);
    };
  }

  function Pack(io) {
    this.io = io; this.end = MAGIC.length; this.size = MAGIC.length;
    this.proj = null;                     // { at, len, crc }: the PROJ record that counts (at = where its content starts)
    this.projText = '';
    this.moves = {};                      // name -> { at, len, crc, meta, binAt, binLen }
    this.garbage = 0; this.q = Promise.resolve(); this.broken = null;
  }
  Pack.prototype.recordSize = function (r) { return HEAD + r.len; };
  // what is in the file (called once, when it is opened)
  Pack.prototype.scan = async function () {
    var io = this.io, size = await io.size(), read = reader(io, size);
    this.size = size;
    var head = await read(0, MAGIC.length);
    if (!head || !isPack(head)) throw new Error('This is not a Book Compare project file.');
    var off = MAGIC.length, projs = [];
    while (off + HEAD <= size) {
      var h = await read(off, HEAD); if (!h) break;
      var kind = String.fromCharCode(h[0], h[1], h[2], h[3]), v = new DataView(h.buffer, h.byteOffset, HEAD);
      var len = v.getUint32(4, true), crc = v.getUint32(8, true), at = off + HEAD;
      if (!KINDS[kind] || at + len > size) break;                                           // the end, or a record cut off
      var r = { at: at, len: len, crc: crc };
      if (kind === 'PROJ') projs.push(r);
      else if (kind === 'MOVE') {
        var p = await read(at, Math.min(len, 2)); if (!p || len < 6) break;
        var nl = p[0] | (p[1] << 8), p2 = await read(at + 2, nl + 4); if (!p2) break;
        var name = dec.decode(p2.subarray(0, nl)), ml = new DataView(p2.buffer, p2.byteOffset + nl, 4).getUint32(0, true);
        var mb = await read(at + 6 + nl, ml); if (!mb) break;
        var meta = null; try { meta = JSON.parse(dec.decode(mb)); } catch (e) { meta = null; }
        if (this.moves[name]) this.garbage += this.recordSize(this.moves[name]);
        if (meta) { r.meta = meta; r.binAt = at + 6 + nl + ml; r.binLen = len - 6 - nl - ml; this.moves[name] = r; }
        else { delete this.moves[name]; this.garbage += HEAD + len; }
      } else if (kind === 'DROP') {
        var d = await read(at, len), names = []; try { names = JSON.parse(dec.decode(d)); } catch (e) { names = []; }
        var self = this;
        (Array.isArray(names) ? names : []).forEach(function (nm) { var m = self.moves[nm]; if (m) { self.garbage += self.recordSize(m); delete self.moves[nm]; } });
        this.garbage += HEAD + len;
      }
      off = at + len;
    }
    this.end = off;                                                                          // (a record cut off after it is written over by the next save)
    // the newest project that reads correctly
    for (var i = projs.length - 1; i >= 0; i--) {
      var c = new Uint8Array(await io.read(projs[i].at, projs[i].len));
      if (crc32(c) === projs[i].crc) { this.proj = projs[i]; this.projText = dec.decode(c); break; }
    }
    if (!this.proj) throw new Error('The project file is damaged: no readable project in it.');
    for (var j = 0; j < projs.length; j++) if (projs[j] !== this.proj) this.garbage += HEAD + projs[j].len;
    return this;
  };
  Pack.prototype.project = function () { return JSON.parse(this.projText); };

  // writing: one after the other, always at the end of what counts
  Pack.prototype.add = function (blob) {
    var self = this;
    var job = this.q.then(async function () {
      if (self.broken) throw self.broken;
      var at = self.end;
      try { await self.io.append(at, blob); }
      catch (e) { if (e && e.changed) self.broken = e; throw e; }
      self.end = at + blob.size; self.size = self.end;
      return at;
    });
    this.q = job.catch(function () { });
    return job;
  };
  Pack.prototype.writeProject = async function (text) {
    var c = enc.encode(text), at = await this.add(record('PROJ', c));
    if (this.proj) this.garbage += HEAD + this.proj.len;
    this.proj = { at: at + HEAD, len: c.length, crc: crc32(c) }; this.projText = text;
    if (this.needsTidy()) this.tidy().catch(function () { });
  };
  Pack.prototype.putMove = async function (name, meta, bin) {
    var c = moveContent(name, meta, bin), at = await this.add(record('MOVE', c));
    var old = this.moves[name]; if (old) this.garbage += this.recordSize(old);
    var nl = enc.encode(name).length, ml = enc.encode(JSON.stringify(meta || {})).length;
    this.moves[name] = { at: at + HEAD, len: c.length, crc: crc32(c), meta: meta, binAt: at + HEAD + 6 + nl + ml, binLen: c.length - 6 - nl - ml };
  };
  Pack.prototype.getMove = async function (name) {
    var r = this.moves[name]; if (!r) return null;
    await this.q;                                                                            // (after what is being written)
    var c = new Uint8Array(await this.io.read(r.at, r.len));
    if (c.length !== r.len || crc32(c) !== r.crc) return null;                               // damaged: aligned again
    return c.slice(r.binAt - r.at).buffer;
  };
  Pack.prototype.drop = async function (names) {
    var self = this, gone = names.filter(function (n) { return self.moves[n]; });
    if (!gone.length) return 0;
    var c = enc.encode(JSON.stringify(gone));
    await this.add(record('DROP', c));
    gone.forEach(function (n) { self.garbage += self.recordSize(self.moves[n]); delete self.moves[n]; });
    this.garbage += HEAD + c.length;
    return gone.length;
  };
  Pack.prototype.entries = function () { var o = {}, m = this.moves; Object.keys(m).forEach(function (k) { o[k] = m[k].meta; }); return o; };
  Pack.prototype.stats = function () {
    var n = 0, bytes = 0, m = this.moves; Object.keys(m).forEach(function (k) { n++; bytes += HEAD + m[k].len; });
    return { count: n, bytes: bytes, size: this.end, garbage: this.garbage };
  };
  // tidy up when more than a third of the file no longer counts (and at least 8 MB), or when asked (after removing stored alignments)
  Pack.prototype.needsTidy = function () { return this.garbage > 8 * 1048576 && this.garbage > this.end / 3; };
  Pack.prototype.tidy = function () {
    var self = this;
    var job = this.q.then(async function () {
      if (self.broken) throw self.broken;
      var keep = [], names = Object.keys(self.moves);
      names.forEach(function (n) { var r = self.moves[n]; keep.push([r.at - HEAD, HEAD + r.len, n]); });
      keep.sort(function (a, b) { return a[0] - b[0]; });
      if (self.proj) keep.push([self.proj.at - HEAD, HEAD + self.proj.len, null]);              // the project last: it is the newest anyway
      await self.io.compact(keep.map(function (k) { return [k[0], k[1]]; }), MAGIC.length);
      var off = MAGIC.length;
      keep.forEach(function (k) {
        var shift = off - k[0];
        if (k[2] === null) { self.proj.at += shift; }
        else { var r = self.moves[k[2]]; r.at += shift; r.binAt += shift; }
        off += k[1];
      });
      self.end = off; self.size = off; self.garbage = 0;
    });
    this.q = job.catch(function () { });
    return job;
  };
  Pack.prototype.flush = function () { return this.q; };

  // A new project file (Save as, or a project of an older version brought up to date): the whole file at once, in one step.
  // moves: [{ name, meta, bin }] (the stored alignments of an older version's results folder)
  async function create(io, text, moves) {
    var parts = [new Uint8Array(MAGIC)], p = new Pack(io), off = MAGIC.length;
    (moves || []).forEach(function (m) {
      var c = moveContent(m.name, m.meta, m.bin), nl = enc.encode(m.name).length, ml = enc.encode(JSON.stringify(m.meta || {})).length;
      parts.push(record('MOVE', c));
      p.moves[m.name] = { at: off + HEAD, len: c.length, crc: crc32(c), meta: m.meta, binAt: off + HEAD + 6 + nl + ml, binLen: c.length - 6 - nl - ml };
      off += HEAD + c.length;
    });
    var pc = enc.encode(text);
    parts.push(record('PROJ', pc));
    p.proj = { at: off + HEAD, len: pc.length, crc: crc32(pc) }; p.projText = text;
    off += HEAD + pc.length;
    await io.replace(new Blob(parts, { type: 'application/octet-stream' }));
    p.end = off; p.size = off;
    return p;
  }
  // the file as a whole, for "Download project file" (browsers without File System Access): the project only
  function blobOf(text) {
    var pc = enc.encode(text);
    return new Blob([new Uint8Array(MAGIC), record('PROJ', pc)], { type: 'application/octet-stream' });
  }
  // A file's contents as one piece (a file chosen in a browser without File System Access): the project in it, whichever format
  async function projectFromBlob(blob) {
    var head = new Uint8Array(await blob.slice(0, MAGIC.length).arrayBuffer());
    if (!isPack(head)) return JSON.parse((await blob.text()).replace(/^﻿/, ''));
    var p = new Pack(blobIO(blob)); await p.scan(); return p.project();
  }
  function blobIO(blob) {
    return { size: async function () { return blob.size; }, read: async function (at, len) { return blob.slice(at, at + len).arrayBuffer(); },
      append: async function () { throw new Error('read only'); }, replace: async function () { throw new Error('read only'); }, compact: async function () { throw new Error('read only'); } };
  }
  // The file of a File System Access handle (website). Note: browsers write such a file by copying it first, so on the website every save
  // costs about as much as the file is big (workspace.js saves less often when the file has grown large).
  function fsaIO(getHandle) {
    return {
      size: async function () { return (await (await getHandle()).getFile()).size; },
      read: async function (at, len) { return (await (await getHandle()).getFile()).slice(at, at + len).arrayBuffer(); },
      append: async function (at, blob) {
        var fh = await getHandle(), size = (await fh.getFile()).size;
        if (size < at) { var e = new Error('The project file was changed by another program. Please open it again.'); e.changed = true; throw e; }
        var w = await fh.createWritable({ keepExistingData: true });
        try { if (size > at) await w.truncate(at); await w.write({ type: 'write', position: at, data: blob }); await w.close(); }
        catch (e2) { try { await w.abort(); } catch (e3) { /* ignore */ } throw e2; }
      },
      replace: async function (blob) { var w = await (await getHandle()).createWritable(); await w.write(blob); await w.close(); },
      compact: async function (ranges, prefix) {
        var fh = await getHandle(), f = await fh.getFile(), parts = [f.slice(0, prefix)];
        ranges.forEach(function (r) { parts.push(f.slice(r[0], r[0] + r[1])); });
        var blob = new Blob([await new Blob(parts).arrayBuffer()]);                           // (read before the file is replaced)
        var w = await fh.createWritable(); await w.write(blob); await w.close();
      }
    };
  }

  window.BCPack = {
    MAGIC: MAGIC, isPack: isPack, crc32: crc32,
    open: async function (io) { var p = new Pack(io); return p.scan(); },
    create: create, blobOf: blobOf, projectFromBlob: projectFromBlob, fsaIO: fsaIO, blobIO: blobIO
  };
})();
