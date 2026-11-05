"""Automatic test of the whole-book workspace (app/js/workspace.js).

It builds small made-up scan folders inside the browser's private storage (never your own folders), drives the workspace like a
person would, and checks with assert statements. Most important check: the scan folders are byte-for-byte unchanged afterwards.

Run (needs Python, `pip install playwright`, `playwright install chromium`):
    cd app && python3 -m http.server 8765 &        # serve the app
    python3 tests/workspace/test_workspace.py
"""
import json
from common import *

def read_project(pg, which='proj'):
    return json.loads(pg.evaluate("async(w)=>{const fh=await __h[w].getFileHandle('book-compare-project.json'); return await (await fh.getFile()).text();}", which))

with sync_playwright() as p:
    b, ctx, pg, before = setup3(p)
    def cell(ci, r): return pg.locator('#ws .ws-cell[data-c="%d"][data-r="%d"]' % (ci, r))
    # folders were read, natural file-name order, start row, several sub-folders, TIFF ignored
    assert col(pg, 0)[:2] == ['scan_001.jpg', 'scan_002.jpg']
    assert col(pg, 1) == ['-', 'img_1.JPG', 'img_2.JPG', 'img_3.JPG', 'img_10.JPG', 'img_11.JPG', 'img_12.JPG', '-']
    assert col(pg, 2)[:6] == ['x_1.jpg', 'x_3.jpg', 'x_5.jpg', 'x_2.jpg', 'x_4.jpg', 'x_6.jpg']
    assert pg.locator('#ws-thumbs img').count() >= 2, 'thumbnails should load'
    # editing and undo/redo (also by keyboard)
    cell(1, 4).click(); pg.fill('#gapN', '2'); pg.click('[data-act=gap]'); pg.wait_for_timeout(150)
    assert col(pg, 1)[4:6] == ['-', '-']
    pg.keyboard.press('Control+z'); pg.wait_for_timeout(150); assert col(pg, 1)[4] == 'img_10.JPG'
    pg.keyboard.press('Control+y'); pg.wait_for_timeout(150); assert col(pg, 1)[4] == '-'
    pg.keyboard.press('Control+z'); pg.wait_for_timeout(150)
    cell(0, 1).click(); pg.click('[data-act=startnum]'); pg.wait_for_timeout(150)
    assert pg.locator('#ws .ws-lbl[data-r="0"] b').inner_text() == 'Front 1'
    pg.locator('#ws .ws-lbl[data-r="2"]').dblclick(); pg.keyboard.type('Index'); pg.keyboard.press('Enter'); pg.wait_for_timeout(150)
    assert pg.locator('#ws .ws-lbl[data-r="2"] b').inner_text() == 'Index'
    # a project must never be saved in (or around) a scan folder
    for target in ('A', 'scans'):
        pg.evaluate("k=>window.__picks.push(window.__h[k])", target); pg.click('#ws-more'); pg.click('[data-m=save]'); pg.wait_for_timeout(400)
        assert 'scan folder' in pg.inner_text('#ws-toast'), 'saving into a scan folder must be refused'
    pg.evaluate("window.__picks.push(window.__h.proj)"); pg.click('#ws-more'); pg.click('[data-m=save]'); pg.wait_for_timeout(900)
    assert 'Saved in folder' in pg.inner_text('#ws-save')
    d = read_project(pg); assert [c['name'] for c in d['copies']] == ['A-Test', 'B-Test', 'C-Test'] and d['labels'] == {'2': 'Index'}
    cell(2, 0).click(); pg.click('[data-act=out]'); pg.wait_for_timeout(1500)     # automatic saving
    assert len(read_project(pg)['tray']) == 1
    pg.click('#ws .ws-addbtn'); pg.evaluate("window.__picks.push(window.__h.proj)"); pg.click('#ac-folder'); pg.wait_for_timeout(400)
    assert 'project folder' in pg.inner_text('#ac-err'); pg.click('[data-close]')
    # hand a pair to the two-image screen and come back
    cell(0, 1).click(); pg.wait_for_timeout(300)
    pg.click('#ws-compare'); pg.wait_for_timeout(1500)
    assert pg.evaluate("document.getElementById('ws').hidden")
    assert pg.evaluate("[...document.querySelectorAll('#compare_container ul.vertical-image-list img')].every(i=>i.src.startsWith('blob:') && i.naturalWidth>0)")
    pg.click('#back'); pg.wait_for_timeout(600)
    assert not pg.evaluate("document.getElementById('ws').hidden"), 'Back must return to the workspace'
    # reopen in a new page: remembered project, then lost access -> reconnect
    pg2 = ctx.new_page(); pg2.goto(URL); pg2.wait_for_timeout(900); pg2.evaluate(HELPERS); handles(pg2)
    pg2.click('#books_btn'); pg2.wait_for_timeout(600); pg2.click('#ws .ws-empty [data-act=continue]'); pg2.wait_for_timeout(1500)
    assert pg2.locator('#ws .ws-hname').count() == 3 and pg2.locator('#ws-thumbs img').count() >= 2
    pg2.evaluate("""(async()=>{ const d = await new Promise(r=>{const q=indexedDB.open('book-compare',1); q.onsuccess=()=>r(q.result)}); await new Promise(r=>{const tx=d.transaction('handles','readwrite'); tx.objectStore('handles').clear(); tx.oncomplete=r;}); })()""")
    pg2.evaluate("window.__picks.push(window.__h.proj)"); pg2.click('#ws-more'); pg2.click('[data-m=open]'); pg2.wait_for_timeout(1200)
    assert not pg2.evaluate("document.getElementById('ws-banner').hidden")
    pg2.evaluate("window.__picks.push(window.__h.scans)"); pg2.click('#ws-banner [data-act=reconnect]'); pg2.wait_for_timeout(1500)
    assert pg2.evaluate("document.getElementById('ws-banner').hidden") and pg2.locator('#ws-thumbs img').count() >= 2
    # large project: only a few rows exist in the page at any time
    big = {'format': 'book-compare-project', 'version': 1, 'projectId': 'big', 'nextCopy': 21, 'ns': 0, 'folio': False, 'labels': {}, 'skip': {}, 'pair': [1, 2], 'sel': {'ci': 0, 'row': 0}, 'tray': [],
           'copies': [{'id': i + 1, 'name': 'Copy-%02d' % (i + 1), 'folder': 'Copy-%02d' % (i + 1), 'keys': [], 'cells': [('img_%03d.jpg' % r) if (r + i * 7) % 53 > 3 else None for r in range(544)]} for i in range(20)]}
    pg2.evaluate("async(j)=>{ const r = await navigator.storage.getDirectory(); const bd = await r.getDirectoryHandle('bigproj',{create:true}); const fh = await bd.getFileHandle('book-compare-project.json',{create:true}); const w = await fh.createWritable(); await w.write(j); await w.close(); window.__h.big = bd; }", json.dumps(big))
    pg2.evaluate("window.__picks.push(window.__h.big)"); pg2.click('#ws-more'); pg2.click('[data-m=open]'); pg2.wait_for_timeout(1500)
    assert pg2.locator('#ws .ws-hname').count() == 20 and pg2.locator('#ws .ws-row').count() < 40
    # the scan folders were only read
    assert before == snapshot(pg2), 'scan folders must be unchanged'
    assert not errs, errs
    print('ALL WORKSPACE TESTS PASSED')
    b.close()
