// Test of tools/photoshop/Split-double-pages.jsx with a STAND-IN for Photoshop (no Photoshop needed).
// The stand-in implements the few Photoshop functions the script uses (open, duplicate, crop, saveAs, close) with Python/Pillow, so the
// pictures that come out can be checked pixel by pixel: left page = left part, right page = right part, in the right order, and the
// original files untouched. What this can NOT check is Photoshop itself (that the real functions behave as documented).
//   run:   node tests/photoshop/test_split_script.js      (needs python3 with Pillow)
'use strict';
const fs = require('fs'), path = require('path'), cp = require('child_process'), vm = require('vm'), os = require('os'), crypto = require('crypto');
const HERE = __dirname, SCRIPT = path.join(HERE, '..', '..', 'tools', 'photoshop', 'Split-double-pages.jsx'), HELPER = path.join(HERE, 'crop_helper.py');
const assert = require('assert');
const py = (...a) => cp.execFileSync('python3', [HELPER, ...a.map(String)]).toString();

// ---------------------------------------------------------------------------------------------- stand-in for Photoshop / ExtendScript
function makeWorld(log) {
  class FileM {
    constructor(p) { this.p = path.resolve(decodeURI(String(p))); }
    get name() { return path.basename(this.p); } get fsName() { return this.p; } get exists() { return fs.existsSync(this.p); }
    copy(dest) { fs.copyFileSync(this.p, dest.p); return true; }
    open(mode) { this.buf = ''; return true; } write(t) { this.buf += t; return true; } close() { fs.writeFileSync(this.p, this.buf); return true; }
  }
  class FolderM {
    constructor(p) { this.p = path.resolve(decodeURI(String(p))); }
    get name() { return path.basename(this.p); } get fsName() { return this.p; }
    get exists() { return fs.existsSync(this.p) && fs.statSync(this.p).isDirectory(); } create() { fs.mkdirSync(this.p, { recursive: true }); return true; }
    get absoluteURI() { return this.p.split(path.sep).map(encodeURIComponent).join('/'); }
    getFiles() { return fs.readdirSync(this.p).map(n => { const q = path.join(this.p, n); return fs.statSync(q).isDirectory() ? new FolderM(q) : new FileM(q); }); }
  }
  const DONOTSAVE = { dontSave: true };
  class Doc {
    constructor(src, box) { this.src = src; const d = JSON.parse(py('size', src)); this.box = box || [0, 0, d[0], d[1]]; this.isCopy = !!box; log.opened.push(src); this.open = true; }
    get width() { return { as: u => { assert.strictEqual(u, 'px'); return this.box[2] - this.box[0]; } }; }
    get height() { return { as: u => this.box[3] - this.box[1] }; }
    duplicate() { return new Doc(this.src, this.box.slice()); }
    crop(b) { assert(Array.isArray(b) && b.length === 4); assert.strictEqual(world.app.preferences.rulerUnits, 'px', 'pixels must be the unit while cropping'); this.box = [this.box[0] + b[0], this.box[1] + b[1], this.box[0] + b[2], this.box[1] + b[3]]; }
    saveAs(file, opts, asCopy, ext) {
      assert.strictEqual(asCopy, true, 'must save a COPY'); assert(file instanceof FileM);
      if (log.inDir && (file.p + path.sep).startsWith(log.inDir + path.sep)) log.badWrites.push(file.p);
      if (log.failOn && path.basename(this.src) === log.failOn) throw new Error('mock: cannot save');
      py('save', this.src, ...this.box, file.p, opts.kind, opts.quality || 0); log.saved.push(file.p);
    }
    close(o) { this.open = false; if (o !== DONOTSAVE) log.badClose.push(this.src); log.closed++; }
  }
  const world = {
    File: FileM, Folder: FolderM, Doc,
    app: { preferences: { rulerUnits: 'in' }, displayDialogs: 'all', bringToFront() {}, open(f) {
      if (log.cancelAt != null && log.opened.length >= log.cancelAt) { const e = new Error('User cancelled'); e.number = 8007; throw e; }
      if (log.corrupt && log.corrupt.indexOf(f.name) >= 0) throw new Error('mock: not a readable picture');
      return new Doc(f.p); } },
    Units: { PIXELS: 'px' }, DialogModes: { NO: 'no' }, SaveOptions: { DONOTSAVECHANGES: DONOTSAVE },
    JPEGSaveOptions: function () { this.kind = 'jpg'; }, TiffSaveOptions: function () { this.kind = 'tif'; }, PNGSaveOptions: function () { this.kind = 'png'; },
    FormatOptions: { STANDARDBASELINE: 1 }, MatteType: { NONE: 0 }, TIFFEncoding: { TIFFLZW: 5 }, Extension: { LOWERCASE: 2 },
    alert() {}, Window: function () { throw new Error('no windows in the test'); }
  };
  return world;
}
let world;
function runScript(options, log) {
  log.opened = []; log.saved = []; log.badWrites = []; log.badClose = []; log.closed = 0;
  world = makeWorld(log);
  const BC_TEST = { options: typeof options === 'function' ? options(world) : options }, ctx = vm.createContext(Object.assign({ BC_TEST, console }, world));
  const src = fs.readFileSync(SCRIPT, 'utf8').split(/\r?\n/).filter(l => !/^#target/.test(l)).join('\n');
  vm.runInContext(src, ctx, { filename: 'Split-double-pages.jsx' });
  return { BC_TEST, world };
}

// ---------------------------------------------------------------------------------------------- made-up scans
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bc_split_ä '));
const IN = path.join(TMP, 'Scans IA 443'), OUT = path.join(TMP, 'Neue Seiten');
fs.mkdirSync(IN);
const mk = (name, w, h, kind) => { cp.execFileSync('python3', ['-c', `
from PIL import Image, ImageDraw
im = Image.new('RGB', (${w}, ${h}), (240, 230, 200)); d = ImageDraw.Draw(im)
for x in range(${w}): d.line([(x, 0), (x, ${h})], fill=(int(255 * x / ${w}), 60, 255 - int(255 * x / ${w})))   # colour tells the position across the picture
d.text((10, 10), '${name}', fill=(0, 0, 0))
im.save(r'''${path.join(IN, name)}''', '${kind}')
`]); };
const spreads = ['00001.jpg', '00002.JPG', '00003.jpg', '00010.jpg'];
mk('00000.jpg', 500, 700, 'JPEG'); spreads.forEach(n => mk(n, 1000, 700, 'JPEG')); mk('00275.jpg', 500, 700, 'JPEG'); mk('00011.png', 1000, 700, 'PNG'); mk('00012.tif', 1000, 700, 'TIFF');
fs.writeFileSync(path.join(IN, 'Thumbs.db'), 'x'); fs.writeFileSync(path.join(IN, 'notes.txt'), 'x'); fs.mkdirSync(path.join(IN, 'sub'));
const hashAll = d => { const o = {}; fs.readdirSync(d).forEach(n => { const q = path.join(d, n); if (fs.statSync(q).isFile()) { const st = fs.statSync(q); o[n] = crypto.createHash('sha1').update(fs.readFileSync(q)).digest('hex') + '|' + st.mtimeMs + '|' + st.size; } }); return o; };
const BEFORE = hashAll(IN);
const pixel = (f, x, y) => JSON.parse(cp.execFileSync('python3', ['-c', `
from PIL import Image
import json; im = Image.open(r'''${f}''').convert('RGB'); print(json.dumps([im.size, im.getpixel((${x}, ${y}))]))`]).toString());
// (the folders must be made with the stand-in classes of the run itself, so `instanceof File` works inside the script)
const opts = (extra) => (w) => { const o = Object.assign({ inFolder: new w.Folder(IN), outFolder: new w.Folder(OUT), percent: 50, quality: 12, copySingles: true }, extra || {}); if (o.outFolder && o.outFolder.p === undefined && typeof o.outFolder === 'string') o.outFolder = new w.Folder(o.outFolder); if (extra && 'outFolder' in extra) o.outFolder = extra.outFolder === null ? null : new w.Folder(extra.outFolder); return o; };

// ---------------------------------------------------------------------------------------------- 1. a normal run
let log = { inDir: IN };
let r = runScript(opts(), log), res = r.BC_TEST.result;
assert(!r.BC_TEST.error, r.BC_TEST.error);
let out = fs.readdirSync(OUT).filter(n => n !== 'split-log.txt');
const expectOrder = ['00000_single.jpg', '00001_L.jpg', '00001_R.jpg', '00002_L.jpg', '00002_R.jpg', '00003_L.jpg', '00003_R.jpg', '00010_L.jpg', '00010_R.jpg', '00011_L.png', '00011_R.png', '00012_L.tif', '00012_R.tif', '00275_single.jpg'];
assert.deepStrictEqual(out, expectOrder, out.join(', '));                          // plain sorting by name = reading order
assert.strictEqual(res.total, 8, 'Thumbs.db, notes.txt and the sub-folder are not pictures'); assert.strictEqual(res.split, 6); assert.strictEqual(res.singles, 2); assert.strictEqual(res.failed.length, 0);
// order of work: natural order of the originals (00010 after 00003, not after 00001)
assert.deepStrictEqual(log.opened.filter((p, i, a) => a.indexOf(p) === i).map(p => path.basename(p)).slice(0, 5), ['00000.jpg', '00001.jpg', '00002.JPG', '00003.jpg', '00010.jpg']);
// pixels: left page = left half, right page = right half
let [sz, px] = pixel(path.join(OUT, '00001_L.jpg'), 10, 5); assert.deepStrictEqual(sz, [500, 700]); assert(Math.abs(px[0] - 255 * 10 / 1000) < 12 && px[2] > 235, px);
[sz, px] = pixel(path.join(OUT, '00001_R.jpg'), 10, 5); assert.deepStrictEqual(sz, [500, 700]); assert(Math.abs(px[0] - 255 * 510 / 1000) < 14, px);     // starts at x = 500 of the original
assert.strictEqual(pixel(path.join(OUT, '00012_R.tif'), 0, 0)[0][0], 500); assert.strictEqual(pixel(path.join(OUT, '00011_L.png'), 0, 0)[0][0], 500);
// single pages are the original bytes
assert(fs.readFileSync(path.join(OUT, '00000_single.jpg')).equals(fs.readFileSync(path.join(IN, '00000.jpg'))));
// the originals: nothing changed, nothing written next to them, every picture closed without saving, settings put back
assert.deepStrictEqual(hashAll(IN), BEFORE, 'originals must be unchanged'); assert.deepStrictEqual(fs.readdirSync(IN).sort(), ['00000.jpg', '00001.jpg', '00002.JPG', '00003.jpg', '00010.jpg', '00011.png', '00012.tif', '00275.jpg', 'Thumbs.db', 'notes.txt', 'sub'].sort());
assert.deepStrictEqual(log.badWrites, []); assert.deepStrictEqual(log.badClose, []); assert.strictEqual(log.closed, log.opened.length, 'every opened picture is closed');
assert.strictEqual(world.app.preferences.rulerUnits, 'in'); assert.strictEqual(world.app.displayDialogs, 'all');
assert(fs.readFileSync(path.join(OUT, 'split-log.txt'), 'utf8').includes('Double pages split: 6'));
console.log('  normal run: ok');

// ---------------------------------------------------------------------------------------------- 2. run again: everything is skipped (resume)
log = { inDir: IN }; r = runScript(opts(), log); res = r.BC_TEST.result;
assert.strictEqual(res.skipped, 8); assert.strictEqual(res.split, 0); assert.strictEqual(log.opened.length, 0, 'finished files are not even opened'); assert.strictEqual(log.saved.length, 0);
console.log('  second run skips everything: ok');

// ---------------------------------------------------------------------------------------------- 3. another cut position, singles left out, a broken file, a stop with Esc
fs.rmSync(OUT, { recursive: true });
log = { inDir: IN, corrupt: ['00002.JPG'] }; r = runScript(opts({ percent: 49.2, copySingles: false }), log); res = r.BC_TEST.result;
assert.strictEqual(res.failed.length, 1); assert(res.failed[0].startsWith('00002.JPG')); assert.strictEqual(res.ignored, 2); assert.strictEqual(res.singles, 0);
assert.strictEqual(pixel(path.join(OUT, '00001_L.jpg'), 0, 0)[0][0], 492); assert.strictEqual(pixel(path.join(OUT, '00001_R.jpg'), 0, 0)[0][0], 508);
assert(!fs.existsSync(path.join(OUT, '00000_single.jpg')) && !fs.existsSync(path.join(OUT, '00002_L.jpg')) && fs.existsSync(path.join(OUT, '00003_L.jpg')), 'one broken file does not stop the others');
assert.deepStrictEqual(hashAll(IN), BEFORE);
fs.rmSync(OUT, { recursive: true });
log = { inDir: IN, cancelAt: 4 }; r = runScript(opts(), log); res = r.BC_TEST.result;
assert.strictEqual(res.stopped, true); assert.strictEqual(res.failed.length, 0);
const partial = fs.readdirSync(OUT).filter(n => n !== 'split-log.txt'); assert(partial.length > 0 && partial.length < expectOrder.length, partial.join(','));
log = { inDir: IN }; r = runScript(opts(), log); res = r.BC_TEST.result;                              // start again: carries on
assert.deepStrictEqual(fs.readdirSync(OUT).filter(n => n !== 'split-log.txt'), expectOrder); assert(res.skipped > 0 && res.stopped === false);
assert.deepStrictEqual(hashAll(IN), BEFORE);
console.log('  other cut position, broken file, Esc and resume: ok');

// ---------------------------------------------------------------------------------------------- 4. the output folder must not be the scan folder or inside it
for (const bad of [IN, path.join(IN, 'sub'), path.join(IN, 'Split into single pages'), IN + path.sep]) {
  const before = fs.readdirSync(IN).sort(); log = { inDir: IN };
  r = runScript(opts({ outFolder: bad }), log);
  assert(r.BC_TEST.error && /DIFFERENT folder/.test(r.BC_TEST.error), 'refused: ' + bad); assert.strictEqual(log.opened.length, 0);
  assert.deepStrictEqual(fs.readdirSync(IN).sort(), before, 'nothing created in the scan folder');
}
r = runScript(opts({ percent: 5 }), { inDir: IN }); assert(/between 20 and 80/.test(r.BC_TEST.error));
r = runScript(opts({ quality: 40 }), { inDir: IN }); assert(/1 to 12/.test(r.BC_TEST.error));
r = runScript(opts({ outFolder: null }), { inDir: IN }); assert(/folder for the new/.test(r.BC_TEST.error));
assert.deepStrictEqual(hashAll(IN), BEFORE);
console.log('  safety refusals: ok');

// ---------------------------------------------------------------------------------------------- 5. the script itself is plain old JavaScript (ES3), as ExtendScript needs
const text = fs.readFileSync(SCRIPT, 'utf8');
for (const bad of [/\bconst\b/, /\blet\b/, /=>/, /\.forEach\(/, /\.map\(/, /\.filter\(/, /\.indexOf\(\s*['"]/, /\bJSON\./, /\.trim\(/, /Object\.keys/, /`/])
  assert(!bad.test(text.replace(/\/\/.*$/gm, '')), 'not ES3: ' + bad);
try { const acorn = require(process.env.ACORN || 'acorn'); acorn.parse(text.split(/\r?\n/).map(l => /^#target/.test(l) ? '' : l).join('\n'), { ecmaVersion: 3 }); console.log('  ES3 syntax (acorn): ok'); }
catch (e) { if (e.code === 'MODULE_NOT_FOUND') console.log('  (acorn not installed: ES3 syntax check skipped)'); else throw e; }
fs.rmSync(TMP, { recursive: true, force: true });
console.log('ALL PHOTOSHOP SCRIPT TESTS PASSED');
