import sys, json
from playwright.sync_api import sync_playwright
import os
URL=os.environ.get('BOOKCOMPARE_URL','http://127.0.0.1:8765/index.html')
HELPERS = r"""
window.mkScan = async (dir, name, n, variant) => {
  const w = 1200, h = 1700, cv = document.createElement('canvas'); cv.width = w; cv.height = h; const x = cv.getContext('2d');
  x.fillStyle = '#efe6d2'; x.fillRect(0,0,w,h); x.fillStyle = '#2a2622';
  for (let i = 0; i < 6; i++) { const y = 200 + i*230; for (let l = 0; l < 5; l++) x.fillRect(120, y + l*14, 960, 2);
    for (let j = 0; j < 14; j++) { x.beginPath(); x.ellipse(160 + j*66 + ((n*37+i*11+j*5) % 17), y + 70 - ((n*13 + j*7 + i) % 5)*14, 14, 10, -0.3, 0, 7); x.fill(); } }
  x.font = 'bold 120px sans-serif'; x.fillText('p' + n + (variant ? 'v'+variant : ''), 470, 130);
  const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.8));
  const fh = await dir.getFileHandle(name, {create: true}); const wr = await fh.createWritable(); await wr.write(blob); await wr.close();
};
window.snapshot = async (dir, path='') => { const out = []; for await (const [name, h] of dir.entries()) { if (h.kind === 'file') { const f = await h.getFile(); out.push(path+name+'|'+f.size+'|'+f.lastModified); } else out.push(...await window.snapshot(h, path+name+'/')); } return out.sort(); };
window.__picks = [];
// "Save as" / "Open" for the project file: the test queues a FOLDER; Save makes the file in it (as the browser does: at once, empty),
// Open takes the project file in it (a .bookcompare file, or the project file of an older version).
window.showSaveFilePicker = async function (opts) { window.__lastOpts = window.__lastOpts || []; window.__lastOpts.push(JSON.stringify({id: opts.id, save: opts.suggestedName}));
  const d = window.__picks.shift(); if (!d) throw new DOMException('no pick queued', 'AbortError');
  const fh = await d.getFileHandle(window.__saveName || opts.suggestedName, {create: true}); return fh; };
window.showOpenFilePicker = async function (opts) { window.__lastOpts = window.__lastOpts || []; window.__lastOpts.push(JSON.stringify({id: opts.id, open: true}));
  const d = window.__picks.shift(); if (!d) throw new DOMException('no pick queued', 'AbortError');
  if (d.kind === 'file') return [d];
  let legacy = null; for await (const [n, h] of d.entries()) { if (h.kind !== 'file') continue; if (/\.bookcompare$/i.test(n)) return [h]; if (n === 'book-compare-project.json') legacy = h; }
  if (legacy) return [legacy]; throw new DOMException('no project file in ' + d.name, 'AbortError'); };
window.showDirectoryPicker = async function (opts) { window.__lastOpts = window.__lastOpts || []; window.__lastOpts.push(JSON.stringify({id: opts.id, mode: opts.mode, startIn: opts.startIn ? opts.startIn.name : null})); const h = window.__picks.shift(); if (!h) throw new DOMException('no pick queued', 'AbortError'); return h; };

// Simulates what Edge does after a project is reopened: the permission of remembered folders has lapsed until the user clicks "Allow".
window.__locked = new Set(); window.__prompts = []; window.__deny = false;
{ const P = FileSystemHandle.prototype, q = P.queryPermission, r = P.requestPermission;
  P.queryPermission = async function (o) { return window.__locked.has(this.name) ? 'prompt' : q.call(this, o); };
  // worst case: every permission prompt needs its own click (the browser may use up the click's "user activation")
  window.__act = 0; document.addEventListener('click', () => { window.__act = 1; }, true);
  P.requestPermission = async function (o) {
    if (window.__locked.has(this.name)) {
      if (window.__noact || window.__act < 1) throw new DOMException('User activation is required to request permissions.', 'SecurityError');
      window.__act--; window.__prompts.push(this.name); if (window.__deny) return 'denied'; window.__locked.delete(this.name);
    }
    return r.call(this, o); }; }
; 0
"""

errs=[]
def start(p, build=True, ctx=None):
    args=['--allow-file-access-from-files'] if URL.startswith('file:') else []
    if ctx is None and os.environ.get('BOOKCOMPARE_PERSISTENT'):
        # a browser profile on disk (some Chromium builds crash when a folder handle is read back from storage in a private window)
        import tempfile
        c=b=p.chromium.launch_persistent_context(tempfile.mkdtemp(prefix='bc-profile-'), args=args, viewport={'width':1500,'height':900}, service_workers='block')
    else:
        b=p.chromium.launch(args=args) if ctx is None else None
        c=ctx or b.new_context(viewport={'width':1500,'height':900}, service_workers='block')
    pg=c.new_page()
    pg.on('pageerror',lambda e:errs.append('PAGEERROR '+str(e)))
    pg.on('console',lambda m: errs.append('CONSOLE '+m.text) if m.type=='error' and '/api/' not in (m.location or {}).get('url','') else None)
    pg.goto(URL); pg.wait_for_timeout(900)
    for i in range(8):
        btn=pg.locator('#onboarding button:visible').last
        if btn.count()==0: break
        txt=btn.inner_text().strip(); btn.click(); pg.wait_for_timeout(300)
        if 'NEXT' not in txt.upper(): break
    pg.evaluate(HELPERS)
    if build:
        pg.evaluate("""(async () => {
          const root = await navigator.storage.getDirectory();
          for (const n of ['scans','proj']) { try { await root.removeEntry(n, {recursive:true}); } catch(e){} }
          const scans = await root.getDirectoryHandle('scans', {create:true}); await root.getDirectoryHandle('proj', {create:true});
          const a = await scans.getDirectoryHandle('Copy-A', {create:true}); const ab = await a.getDirectoryHandle('Gesamtes Buch', {create:true});
          for (let i = 1; i <= 8; i++) await mkScan(ab, 'scan_' + String(i).padStart(3,'0') + '.jpg', i, 0);
          const b = await scans.getDirectoryHandle('Copy-B', {create:true});
          for (const i of [1,2,3,10,11,12]) await mkScan(b, 'img_' + i + '.JPG', i, 1);
          const c = await scans.getDirectoryHandle('Copy-C', {create:true});
          const c1 = await c.getDirectoryHandle('JPG-1', {create:true}), c2 = await c.getDirectoryHandle('JPG-2', {create:true});
          for (const i of [1,3,5]) await mkScan(c1, 'x_' + i + '.jpg', i, 2);
          for (const i of [2,4,6]) await mkScan(c2, 'x_' + i + '.jpg', i, 2);
        })()""")
    return b,c,pg
def handles(pg):
    pg.evaluate("""(async () => { const r = await navigator.storage.getDirectory(); const s = await r.getDirectoryHandle('scans');
      window.__h = {A: await s.getDirectoryHandle('Copy-A'), B: await s.getDirectoryHandle('Copy-B'), C: await s.getDirectoryHandle('Copy-C'), scans: s, proj: await r.getDirectoryHandle('proj')};
      window.__h.AB = await window.__h.A.getDirectoryHandle('Gesamtes Buch'); })()""")
def add_copy(pg, key, name, start=None, ticks=()):
    pg.click('#ws .ws-tb[data-act=add]' if pg.locator('#ws .ws-tb[data-act=add]').count() else '#ws .ws-addbtn'); pg.wait_for_timeout(150)
    pg.evaluate("k=>window.__picks.push(window.__h[k])", key); pg.click('#ac-folder'); pg.wait_for_timeout(500)
    pg.fill('#ac-name', name)
    if start: pg.fill('#ac-start', str(start))
    for i in ticks: pg.check('#ac-groups input[data-g="%d"]'%i)
    pg.click('#ac-ok'); pg.wait_for_timeout(600)
def cellmenu(pg, act, right_click=None):
    # the less frequent cell actions are in the menu "More for this cell" (or the right mouse button on a cell, right_click = locator)
    if right_click is not None: right_click.click(button='right')
    else: pg.click('#ws-cellmore')
    pg.wait_for_timeout(120); pg.click('#ws-ctx [data-act=%s]' % act)
def cellmenu_enabled(pg, act):
    pg.click('#ws-cellmore'); pg.wait_for_timeout(100)
    on = pg.locator('#ws-ctx [data-act=%s]' % act).is_enabled()
    pg.keyboard.press('Escape'); pg.wait_for_timeout(80)
    return on
def insert_gap(pg, n):
    # "Insert gap above …" asks how many empty cells
    pg.click('#ws-toolbar [data-act=gap]'); pg.wait_for_timeout(120); pg.fill('#gapN', str(n)); pg.click('#gap-ok')
def leave_compare(pg):
    # from the Compare screen back to the pages: the Compare tab has the PAGES tab (it has no Back button any more); the old two-image screen has Back
    pg.click('#ct_tab_pages' if pg.is_visible('#ct_tab_pages') else '#back')
def thumbs(pg, n=1, seconds=20):
    # True as soon as at least n preview pictures are shown (making them takes a moment, longer on a slow computer)
    for _ in range(seconds * 5):
        if pg.locator('#ws-thumbs img').count() >= n: return True
        pg.wait_for_timeout(200)
    return False
def col(pg, ci): return pg.evaluate("(ci)=>[...document.querySelectorAll('#ws .ws-cell[data-c=\"'+ci+'\"]')].map(e=>e.classList.contains('empty')?'-':e.querySelector('.fn').textContent)",ci)
def snapshot(pg): return pg.evaluate("async()=>{const r=await navigator.storage.getDirectory(); return await snapshot(await r.getDirectoryHandle('scans'));}")
def setup3(p):
    b,c,pg=start(p); handles(pg); before=snapshot(pg)
    pg.click('#books_btn'); pg.wait_for_timeout(300)
    add_copy(pg,'A','A-Test'); add_copy(pg,'B','B-Test',start=2); add_copy(pg,'C','C-Test',ticks=(0,1))
    return b,c,pg,before

def lock(pg, *names): pg.evaluate("n=>{window.__locked=new Set(n); window.__prompts=[];}", list(names))
def prompts(pg): return pg.evaluate("window.__prompts")
def hid(pg, sel): return pg.evaluate("s=>document.querySelector(s).hidden", sel)
# 0.12.0: a .bookcompare file is a log of records (app/js/project-pack.js); the project is the last PROJ record. Files of older versions: JSON.
PACK_JS = """async (f) => { const b = new Uint8Array(await f.arrayBuffer()), M = [0x89,0x42,0x43,0x50,0x0d,0x0a,0x1a,0x0a];
  if (!M.every((v, i) => b[i] === v)) return new TextDecoder().decode(b);
  let off = 8, last = null; const v = new DataView(b.buffer);
  while (off + 12 <= b.length) { const k = String.fromCharCode(b[off], b[off+1], b[off+2], b[off+3]), n = v.getUint32(off + 4, true);
    if (off + 12 + n > b.length) break; if (k === 'PROJ') last = [off + 12, n]; off += 12 + n; }
  return new TextDecoder().decode(b.subarray(last[0], last[0] + last[1])); }"""
def read_project(pg, which='proj'):
    # the project file in that folder: <name>.bookcompare (or, if there is none, the project file of an older version)
    import json as _j
    return _j.loads(pg.evaluate("""async(w)=>{ const rd = """ + PACK_JS + """; let leg = null; for await (const [n, h] of __h[w].entries()) { if (h.kind !== 'file') continue;
      if (/\\.bookcompare$/i.test(n)) return await rd(await h.getFile()); if (n === 'book-compare-project.json') leg = h; }
      return await (await leg.getFile()).text(); }""", which))
def read_pack(path):
    """A project file on disk: {'project': dict, 'moves': {name: meta}, 'bins': {name: length}, 'size': bytes, 'pack': True/False}."""
    import json as _j, struct, zlib
    b = open(path, 'rb').read()
    if b[:8] != bytes([0x89, 0x42, 0x43, 0x50, 0x0d, 0x0a, 0x1a, 0x0a]):
        return {'project': _j.loads(b.decode('utf-8-sig')), 'moves': {}, 'bins': {}, 'size': len(b), 'pack': False}
    off, proj, moves, bins = 8, None, {}, {}
    while off + 12 <= len(b):
        k = b[off:off + 4].decode('ascii', 'replace'); n, crc = struct.unpack_from('<II', b, off + 4); c = b[off + 12:off + 12 + n]
        if len(c) < n: break
        if zlib.crc32(c) & 0xffffffff == crc:
            if k == 'PROJ': proj = _j.loads(c.decode('utf-8'))
            elif k == 'MOVE':
                nl = struct.unpack_from('<H', c, 0)[0]; name = c[2:2 + nl].decode('utf-8'); ml = struct.unpack_from('<I', c, 2 + nl)[0]
                moves[name] = _j.loads(c[6 + nl:6 + nl + ml].decode('utf-8')); bins[name] = n - 6 - nl - ml
            elif k == 'DROP':
                for name in _j.loads(c.decode('utf-8')): moves.pop(name, None); bins.pop(name, None)
        off += 12 + n
    return {'project': proj, 'moves': moves, 'bins': bins, 'size': len(b), 'pack': True}
def project_files(pg, which='proj'):
    return pg.evaluate("async(w)=>{const o=[]; for await (const [n, h] of __h[w].entries()) o.push(n); return o.sort();}", which)
def reopen(ctx, url=URL):
    pg2 = ctx.new_page(); pg2.on('pageerror', lambda e: errs.append('PAGEERROR '+str(e))); pg2.goto(url); pg2.wait_for_timeout(900)
    pg2.evaluate(HELPERS); handles(pg2); return pg2
def pick_opts(pg):
    import json as _j
    return [_j.loads(o) for o in pg.evaluate("window.__lastOpts||[]")]
