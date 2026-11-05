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
    b=p.chromium.launch(args=['--allow-file-access-from-files'] if URL.startswith('file:') else []) if ctx is None else None
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
def read_project(pg, which='proj'):
    import json as _j
    return _j.loads(pg.evaluate("async(w)=>{const fh=await __h[w].getFileHandle('book-compare-project.json'); return await (await fh.getFile()).text();}", which))
def reopen(ctx, url=URL):
    pg2 = ctx.new_page(); pg2.on('pageerror', lambda e: errs.append('PAGEERROR '+str(e))); pg2.goto(url); pg2.wait_for_timeout(900)
    pg2.evaluate(HELPERS); handles(pg2); return pg2
def pick_opts(pg):
    import json as _j
    return [_j.loads(o) for o in pg.evaluate("window.__lastOpts||[]")]
