// Unit test of app/js/project-pack.js (0.12.0, the project file with the stored alignments inside), in Node with a file kept in memory.
// Run:  node tests/unit/test_project_pack.js
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path');
global.window = {};
eval(fs.readFileSync(path.join(__dirname, '../../app/js/project-pack.js'), 'utf8'));
const P = window.BCPack;

// a file in memory, with the same rules as desktop/server.js (append cuts a longer file at "at", refuses a shorter one)
function memIO() {
  const io = { buf: new Uint8Array(0), reads: 0 };
  io.size = async () => io.buf.length;
  io.read = async (at, len) => { io.reads++; return io.buf.slice(at, at + len).buffer; };
  io.append = async (at, blob) => {
    if (io.buf.length < at) { const e = new Error('changed'); e.changed = true; throw e; }
    const add = new Uint8Array(await blob.arrayBuffer()), n = new Uint8Array(at + add.length);
    n.set(io.buf.subarray(0, at)); n.set(add, at); io.buf = n;
  };
  io.replace = async (blob) => { io.buf = new Uint8Array(await blob.arrayBuffer()); };
  io.compact = async (ranges, prefix) => {
    const parts = [io.buf.slice(0, prefix)].concat(ranges.map(r => io.buf.slice(r[0], r[0] + r[1])));
    const n = new Uint8Array(parts.reduce((a, p) => a + p.length, 0)); let o = 0; parts.forEach(p => { n.set(p, o); o += p.length; }); io.buf = n;
  };
  return io;
}
const bin = (n, seed) => { const b = new Uint8Array(n); for (let i = 0; i < n; i++) b[i] = (i * 31 + seed) & 255; return b.buffer; };
const same = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;

(async () => {
  // a new file: magic, the alignments carried over, the project
  const io = memIO();
  let pk = await P.create(io, JSON.stringify({ format: 'book-compare-project', n: 1 }), [{ name: 'm-a', meta: { valid: 'x' }, bin: bin(1000, 1) }]);
  assert(P.isPack(io.buf.subarray(0, 8)));
  // read back
  pk = await P.open(io);
  assert.deepStrictEqual(pk.project(), { format: 'book-compare-project', n: 1 });
  assert.deepStrictEqual(pk.entries(), { 'm-a': { valid: 'x' } });
  assert(same(await pk.getMove('m-a'), bin(1000, 1)));
  // saves add at the end; the last project counts; a replaced alignment and the old projects are garbage
  for (let i = 2; i <= 5; i++) await pk.writeProject(JSON.stringify({ n: i }));
  await pk.putMove('m-b', { valid: 'y' }, bin(50000, 2));
  await pk.putMove('m-a', { valid: 'x2' }, bin(2000, 3));
  pk = await P.open(io);
  assert.deepStrictEqual(pk.project(), { n: 5 });
  assert.deepStrictEqual(pk.entries(), { 'm-a': { valid: 'x2' }, 'm-b': { valid: 'y' } });
  assert(same(await pk.getMove('m-a'), bin(2000, 3)) && same(await pk.getMove('m-b'), bin(50000, 2)));
  assert(pk.garbage > 1000, pk.garbage);
  // removing
  assert.strictEqual(await pk.drop(['m-b', 'm-zz']), 1);
  pk = await P.open(io);
  assert.deepStrictEqual(Object.keys(pk.entries()), ['m-a']);
  // a save cut off in the middle (crash): left out; the next save writes over it
  const before = io.buf.length;
  await pk.writeProject(JSON.stringify({ n: 6 }));
  io.buf = io.buf.slice(0, io.buf.length - 3);
  pk = await P.open(io);
  assert.deepStrictEqual(pk.project(), { n: 5 }, 'the cut-off project is left out');
  assert.strictEqual(pk.end, before);
  await pk.writeProject(JSON.stringify({ n: 7 }));
  pk = await P.open(io);
  assert.deepStrictEqual(pk.project(), { n: 7 });
  // a project whose CRC does not fit (a damaged sector): the one before counts
  const last = pk.proj.at; io.buf[last + 2] ^= 0xff;
  pk = await P.open(io);
  assert.deepStrictEqual(pk.project(), { n: 5 });
  io.buf[last + 2] ^= 0xff;
  // a damaged alignment is not handed out (it is aligned again)
  pk = await P.open(io);
  const ma = pk.moves['m-a']; io.buf[ma.binAt + 10] ^= 0xff;
  assert.strictEqual(await pk.getMove('m-a'), null); io.buf[ma.binAt + 10] ^= 0xff;
  // tidying up: only what counts stays, in a new file, and still reads the same
  pk = await P.open(io);
  const size0 = io.buf.length; await pk.tidy();
  assert(io.buf.length < size0 && pk.garbage === 0 && pk.end === io.buf.length, [io.buf.length, size0]);
  assert(same(await pk.getMove('m-a'), bin(2000, 3)));
  await pk.writeProject(JSON.stringify({ n: 8 }));
  pk = await P.open(io);
  assert.deepStrictEqual(pk.project(), { n: 8 }); assert.deepStrictEqual(pk.entries(), { 'm-a': { valid: 'x2' } });
  // many saves at once are written one after the other
  await Promise.all([1, 2, 3, 4, 5].map(i => pk.putMove('m-' + i, { i }, bin(3000 + i, i))));
  pk = await P.open(io);
  for (let i = 1; i <= 5; i++) assert(same(await pk.getMove('m-' + i), bin(3000 + i, i)));
  // reading needs few requests (windows of a few MB), even with many records
  io.reads = 0; pk = await P.open(io); assert(io.reads < 10, io.reads);
  // a file of an older version (JSON) and the download form
  assert.deepStrictEqual(await P.projectFromBlob(new Blob(['﻿{"format":"book-compare-project","old":1}'])), { format: 'book-compare-project', old: 1 });
  assert.deepStrictEqual(await P.projectFromBlob(P.blobOf('{"x":2}')), { x: 2 });
  // the file of someone else's changes: shorter than expected -> refused, and nothing more is written
  pk = await P.open(io); io.buf = io.buf.slice(0, 100);
  await assert.rejects(pk.writeProject('{}'), e => e.changed);
  await assert.rejects(pk.putMove('m-q', {}, bin(10, 1)), e => e.changed);
  // not a project file
  const bad = memIO(); bad.buf = new TextEncoder().encode('hello world');
  await assert.rejects(P.open(bad));
  console.log('PROJECT FILE (pack) TESTS PASSED');
})().catch(e => { console.error(e); process.exit(1); });
