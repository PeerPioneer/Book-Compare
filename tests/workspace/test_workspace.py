"""Automatic test of the whole-book workspace (app/js/workspace.js).

It builds small made-up scan folders inside the browser's private storage (never your own folders), drives the workspace like a
person would, and checks with assert statements. Most important check: the scan folders are byte-for-byte unchanged afterwards.

Run (needs Python, `pip install playwright`, `playwright install chromium`):
    cd app && python3 -m http.server 8765 &        # serve the app
    python3 tests/workspace/test_workspace.py
"""
import json
from common import *

with sync_playwright() as p:
    b, ctx, pg, before = setup3(p)
    def cell(ci, r): return pg.locator('#ws .ws-cell[data-c="%d"][data-r="%d"]' % (ci, r))
    # the name field of "Add a copy" stays empty and only shows an example
    pg.click('#ws .ws-addbtn'); pg.wait_for_timeout(150)
    assert pg.get_attribute('#ac-name', 'placeholder') == 'Austria, Austrian National Library' and pg.input_value('#ac-name') == ''
    pg.click('#ac-ok'); assert 'Austria, Austrian National Library' in pg.inner_text('#ac-err'); pg.click('[data-close]')
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
    # "Start numbering" asks for pagination or foliation
    cell(0, 1).click(); pg.click('[data-act=startnum]'); pg.wait_for_timeout(150)
    assert pg.locator('#ws-scrim input[name=nm-style]').count() == 2 and pg.locator('#ws-scrim input[value=page]').is_checked()
    pg.check('#ws-scrim input[value=folio]'); pg.click('#nm-ok'); pg.wait_for_timeout(150)
    lbl = lambda r: pg.locator('#ws .ws-lbl[data-r="%d"] b' % r).inner_text()
    assert [lbl(0), lbl(1), lbl(2), lbl(3)] == ['Front 1', '1r', '1v', '2r'], [lbl(0), lbl(1), lbl(2), lbl(3)]
    pg.locator('#ws .ws-lbl[data-r="2"]').dblclick(); pg.keyboard.type('Index'); pg.keyboard.press('Enter'); pg.wait_for_timeout(150)
    assert lbl(2) == 'Index'
    # the switch under More keeps the rows you named yourself
    pg.click('#ws-more'); assert 'Switch to pagination' in pg.inner_text('#ws-menu'); pg.click('[data-m=folio]'); pg.wait_for_timeout(150)
    assert [lbl(1), lbl(2), lbl(3)] == ['Page 1', 'Index', 'Page 3']
    pg.click('#ws-more'); assert 'Switch to foliation' in pg.inner_text('#ws-menu'); pg.click('[data-m=folio]'); pg.wait_for_timeout(150)
    assert [lbl(1), lbl(2), lbl(3)] == ['1r', 'Index', '2r']
    pg.keyboard.press('Control+z'); pg.wait_for_timeout(150); assert lbl(1) == 'Page 1'      # undo also undoes the switch
    pg.keyboard.press('Control+y'); pg.wait_for_timeout(150); assert lbl(1) == '1r'
    # a project must never be saved in (or around) a scan folder
    for target in ('A', 'scans'):
        pg.evaluate("k=>window.__picks.push(window.__h[k])", target); pg.click('#ws-more'); pg.click('[data-m=save]'); pg.wait_for_timeout(400)
        assert 'scan folder' in pg.inner_text('#ws-toast'), 'saving into a scan folder must be refused'
    pg.evaluate("window.__picks.push(window.__h.proj)"); pg.click('#ws-more'); pg.click('[data-m=save]'); pg.wait_for_timeout(900)
    assert 'Saved in folder' in pg.inner_text('#ws-save')
    d = read_project(pg); assert [c['name'] for c in d['copies']] == ['A-Test', 'B-Test', 'C-Test'] and d['labels'] == {'2': 'Index'} and d['folio'] is True
    assert d['version'] == 2 and len(d['roots']) == 3 and all(len(c['locs']) == 1 for c in d['copies']) and 'tray' not in d
    # deleting a file: gone from the workspace, no "set aside" tray, the scan itself is untouched
    assert pg.locator('#ws-tray').count() == 0 and 'Set aside' not in pg.inner_text('#ws')
    cell(2, 0).click(); assert pg.inner_text('[data-act=del]') == 'Delete file'; pg.click('[data-act=del]'); pg.wait_for_timeout(1500)     # automatic saving
    assert col(pg, 2)[:2] == ['x_3.jpg', 'x_5.jpg'] and 'x_1.jpg' not in col(pg, 2)
    assert 'x_1.jpg' not in json.dumps(read_project(pg)['copies'][2]['cells'])
    pg.keyboard.press('Control+z'); pg.wait_for_timeout(150); assert col(pg, 2)[0] == 'x_1.jpg'          # undo
    pg.keyboard.press('Delete'); pg.wait_for_timeout(150); assert col(pg, 2)[0] == 'x_3.jpg'              # Delete key
    # add the deleted file to the copy again, at the end
    cell(2, 0).click(); pg.click('[data-act=addfiles]'); pg.wait_for_timeout(700)
    assert 'x_1.jpg' in pg.inner_text('#af-list') and 'x_3.jpg' not in pg.inner_text('#af-list')
    pg.check('#af-list input[data-gall]'); pg.click('#af-ok'); pg.wait_for_timeout(300)
    c2 = col(pg, 2)
    assert c2[:5] == ['x_3.jpg', 'x_5.jpg', 'x_2.jpg', 'x_4.jpg', 'x_6.jpg'] and c2[5] == 'x_1.jpg', c2
    # add pages from another folder (Copy-B, picked once) to the end of copy A
    cell(0, 7).click(); pg.click('[data-act=addfiles]'); pg.wait_for_timeout(500)
    assert pg.is_checked('input[name=af-where][value=end]')
    pg.evaluate("window.__picks.push(window.__h.B)"); pg.click('#af-folder'); pg.wait_for_timeout(600)
    assert 'img_1.JPG' in pg.inner_text('#af-list')
    pg.check('#af-list input[data-gall]'); pg.click('#af-ok'); pg.wait_for_timeout(600)
    a = col(pg, 0)
    assert a[8:14] == ['img_1.JPG', 'img_2.JPG', 'img_3.JPG', 'img_10.JPG', 'img_11.JPG', 'img_12.JPG'], a
    pg.wait_for_timeout(1300); dd = read_project(pg); assert len(dd['copies'][0]['locs']) == 2 and any(k.startswith('@1/') for k in dd['copies'][0]['cells'] if k), dd['copies'][0]['cells']
    assert len(dd['roots']) == 3, 'Copy-B is already a known folder: no new root'
    cell(0, 9).click(); pg.wait_for_timeout(900); assert pg.locator('#ws-thumbs img').count() >= 1       # previews of the files from the second folder
    # an empty cell is filled first ...
    cell(1, 0).click(); pg.click('[data-act=addfiles]'); pg.wait_for_timeout(500)
    assert pg.is_checked('input[name=af-where][value=row]') and pg.input_value('#af-row') == '1'
    pg.select_option('#af-known', label='Copy-A'); pg.wait_for_timeout(600)
    pg.locator('#af-list input[data-j="0"]').first.check(); pg.click('#af-ok'); pg.wait_for_timeout(500)
    assert col(pg, 1)[:3] == ['scan_001.jpg', 'img_1.JPG', 'img_2.JPG'], col(pg, 1)
    # ... and where a cell is taken, the pages below move down
    cell(1, 1).click(); pg.click('[data-act=addfiles]'); pg.wait_for_timeout(500)
    pg.select_option('#af-known', label='Copy-A'); pg.wait_for_timeout(600)
    pg.locator('#af-list details').first.evaluate("d => d.open = true"); pg.wait_for_timeout(200)
    pg.locator('#af-list input[data-j="0"]').first.check()
    pg.check('input[name=af-where][value=row]'); pg.fill('#af-row', '2'); pg.click('#af-ok'); pg.wait_for_timeout(500)
    assert col(pg, 1)[:4] == ['scan_001.jpg', 'scan_002.jpg', 'img_1.JPG', 'img_2.JPG'], col(pg, 1)       # scan_001 was no longer offered (already in the grid); scan_002 went in at row 2
    # a project folder must not be a scan folder, and a scan folder must not be the project folder
    pg.click('#ws .ws-addbtn'); pg.evaluate("window.__picks.push(window.__h.proj)"); pg.click('#ac-folder'); pg.wait_for_timeout(400)
    assert 'project folder' in pg.inner_text('#ac-err'); pg.click('[data-close]')
    # hand a pair to the two-image screen and come back
    cell(0, 1).click(); pg.wait_for_timeout(300)
    pg.click('#ws-compare'); pg.wait_for_timeout(1500)
    assert pg.evaluate("document.getElementById('ws').hidden")
    assert pg.evaluate("[...document.querySelectorAll('#compare_container ul.vertical-image-list img')].every(i=>i.src.startsWith('blob:') && i.naturalWidth>0)")
    pg.click('#back'); pg.wait_for_timeout(600)
    assert not pg.evaluate("document.getElementById('ws').hidden"), 'Back must return to the workspace'
    # the two-image screen starts in Perspective mode
    assert pg.evaluate("document.querySelector('#transform_select #selected-text').textContent.trim()") == 'Perspective'
    assert pg.evaluate("document.querySelector('#transform_select').MDCSelect.value") == 'perspective'
    # reopen later (new page): the browser has forgotten the permissions. One click on "Allow access", no folder is chosen again.
    pg2 = reopen(ctx); lock(pg2, 'Copy-A', 'Copy-B', 'Copy-C')
    pg2.click('#books_btn'); pg2.wait_for_timeout(600); pg2.click('#ws .ws-empty [data-act=continue]'); pg2.wait_for_timeout(1500)
    assert pg2.locator('#ws .ws-hname').count() == 3
    assert not hid(pg2, '#ws-banner') and pg2.locator('#ws-banner [data-act=allow]').count() == 1 and pg2.locator('#ws-banner [data-act=reconnect]').count() <= 1
    assert 1 <= pg2.locator('#ws .ws-hmeta.lost').count() <= 3          # the click on Continue may already have allowed the first folder
    clicks = 0
    while not hid(pg2, '#ws-banner') and clicks < 6:
        pg2.click('#ws-banner [data-act=allow]'); clicks += 1; pg2.wait_for_timeout(700)
    assert hid(pg2, '#ws-banner') and pg2.locator('#ws-thumbs img').count() >= 2 and pg2.locator('#ws .ws-hmeta.lost').count() == 0
    assert sorted(prompts(pg2)) == ['Copy-A', 'Copy-B', 'Copy-C'], prompts(pg2)       # three separate folders = three permissions, never a folder picker
    assert pg2.evaluate("window.__picks.length") == 0
    d2 = read_project(pg2); assert d2['labels'] == {'2': 'Index'} and d2['copies'][0]['cells'][8] == '@1/img_1.JPG'
    # refusing access leaves the banner in place
    pg3 = reopen(ctx); lock(pg3, 'Copy-A', 'Copy-B', 'Copy-C'); pg3.evaluate("window.__deny = true")
    pg3.click('#books_btn'); pg3.wait_for_timeout(600); pg3.click('#ws .ws-empty [data-act=continue]'); pg3.wait_for_timeout(1500)
    pg3.click('#ws-banner [data-act=allow]'); pg3.wait_for_timeout(800)
    assert not hid(pg3, '#ws-banner') and 'did not give access' in pg3.inner_text('#ws-toast')
    pg3.close()
    # the folders are not known any more (another computer / browser data cleared): ONE folder choice reconnects all copies
    pg2.evaluate("""(async()=>{ const d = await new Promise(r=>{const q=indexedDB.open('book-compare',1); q.onsuccess=()=>r(q.result)}); await new Promise(r=>{const tx=d.transaction('handles','readwrite'); tx.objectStore('handles').clear(); tx.oncomplete=r;}); })()""")
    pg2.evaluate("window.__picks.push(window.__h.proj)"); pg2.click('#ws-more'); pg2.click('[data-m=open]'); pg2.wait_for_timeout(1200)
    assert not hid(pg2, '#ws-banner') and pg2.locator('#ws-banner [data-act=reconnect]').count() == 1
    pg2.evaluate("window.__picks.push(window.__h.scans)"); pg2.click('#ws-banner [data-act=reconnect]'); pg2.wait_for_timeout(1500)
    assert hid(pg2, '#ws-banner') and pg2.locator('#ws-thumbs img').count() >= 2
    pg2.wait_for_timeout(1200)
    d3 = read_project(pg2); assert len(d3['roots']) == 1 and d3['roots'][0]['name'] == 'scans', d3['roots']       # all copies now share one folder
    # a wrong folder is not accepted
    pg2.evaluate("""(async()=>{ const d = await new Promise(r=>{const q=indexedDB.open('book-compare',1); q.onsuccess=()=>r(q.result)}); await new Promise(r=>{const tx=d.transaction('handles','readwrite'); tx.objectStore('handles').clear(); tx.oncomplete=r;}); })()""")
    pg2.evaluate("window.__picks.push(window.__h.proj)"); pg2.click('#ws-more'); pg2.click('[data-m=open]'); pg2.wait_for_timeout(1200)
    assert not hid(pg2, '#ws-banner')
    pg2.evaluate("window.__picks.push(window.__h.proj)"); pg2.click('#ws-banner [data-act=reconnect]'); pg2.wait_for_timeout(900)
    assert not hid(pg2, '#ws-banner'), 'a folder without the scans must not be accepted'
    # large project: only a few rows exist in the page at any time (project written by the first version, with no folder information)
    big = {'format': 'book-compare-project', 'version': 1, 'projectId': 'big', 'nextCopy': 21, 'ns': 0, 'folio': False, 'labels': {}, 'skip': {}, 'pair': [1, 2], 'sel': {'ci': 0, 'row': 0}, 'tray': [{'cid': 1, 'key': 'img_000.jpg'}],
           'copies': [{'id': i + 1, 'name': 'Copy-%02d' % (i + 1), 'folder': 'Copy-%02d' % (i + 1), 'keys': [], 'cells': [('img_%03d.jpg' % r) if (r + i * 7) % 53 > 3 else None for r in range(544)]} for i in range(20)]}
    pg2.evaluate("async(j)=>{ const r = await navigator.storage.getDirectory(); const bd = await r.getDirectoryHandle('bigproj',{create:true}); const fh = await bd.getFileHandle('book-compare-project.json',{create:true}); const w = await fh.createWritable(); await w.write(j); await w.close(); window.__h.big = bd; }", json.dumps(big))
    pg2.evaluate("window.__picks.push(window.__h.big)"); pg2.click('#ws-more'); pg2.click('[data-m=open]'); pg2.wait_for_timeout(1500)
    assert pg2.locator('#ws .ws-hname').count() == 20 and pg2.locator('#ws .ws-row').count() < 40
    # the scan folders were only read
    assert before == snapshot(pg2), 'scan folders must be unchanged'
    assert not errs, errs
    print('ALL WORKSPACE TESTS PASSED')
    b.close()
