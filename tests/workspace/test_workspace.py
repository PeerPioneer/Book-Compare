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
    assert pg.get_attribute('#ac-name', 'placeholder') == 'e. g. Austria, Austrian National Library' and pg.input_value('#ac-name') == ''
    pg.click('#ac-ok'); assert 'Austria, Austrian National Library' in pg.inner_text('#ac-err'); pg.click('[data-close]')
    # a whole folder is the default; a folder can also be opened to take single pictures
    pg.click('#ws .ws-addbtn'); pg.wait_for_timeout(150)
    pg.evaluate("k=>window.__picks.push(window.__h[k])", 'B'); pg.click('#ac-folder'); pg.wait_for_timeout(500)
    assert pg.is_checked('#ac-groups input[data-g="0"]') and 'already used by B-Test' in pg.inner_text('#ac-groups'), 'one folder: all of it is the default'
    pg.evaluate("document.querySelector('#ac-groups details').open = true"); pg.wait_for_timeout(300)        # (the arrow; a click on the folder name would tick or untick it)
    boxes = pg.locator('#ac-groups .flist input'); assert boxes.count() == 6 and all(boxes.nth(i).is_checked() for i in range(6))
    for i in (0, 1, 2, 3, 5): boxes.nth(i).uncheck()
    assert pg.evaluate("document.querySelector('#ac-groups input[data-g=\"0\"]').indeterminate") and '1 of 6' in pg.inner_text('#ac-groups')
    pg.fill('#ac-name', 'B-One'); pg.click('#ac-ok'); pg.wait_for_timeout(600)
    assert pg.locator('#ws .ws-hname').count() == 4 and [x for x in col(pg, 3) if x != '-'] == ['img_11.JPG'], col(pg, 3)
    pg.keyboard.press('Control+z'); pg.wait_for_timeout(200); assert pg.locator('#ws .ws-hname').count() == 3, 'Undo takes the extra copy away again'
    pg.click('#ws .ws-addbtn'); pg.wait_for_timeout(150)
    pg.evaluate("k=>window.__picks.push(window.__h[k])", 'B'); pg.click('#ac-folder'); pg.wait_for_timeout(500)
    pg.uncheck('#ac-groups input[data-g="0"]'); pg.fill('#ac-name', 'B-None'); pg.click('#ac-ok')
    assert 'Tick at least one folder or picture' in pg.inner_text('#ac-err'); pg.click('[data-close]')
    # folders were read, natural file-name order, start row, several sub-folders, TIFF ignored
    assert col(pg, 0)[:2] == ['scan_001.jpg', 'scan_002.jpg']
    assert col(pg, 1) == ['-', 'img_1.JPG', 'img_2.JPG', 'img_3.JPG', 'img_10.JPG', 'img_11.JPG', 'img_12.JPG', '-']
    assert col(pg, 2)[:6] == ['x_1.jpg', 'x_3.jpg', 'x_5.jpg', 'x_2.jpg', 'x_4.jpg', 'x_6.jpg']
    assert thumbs(pg, 2), 'thumbnails should load'
    # editing and undo/redo (also by keyboard)
    cell(1, 4).click(); insert_gap(pg, 2); pg.wait_for_timeout(150)
    assert col(pg, 1)[4:6] == ['-', '-']
    pg.keyboard.press('Control+z'); pg.wait_for_timeout(150); assert col(pg, 1)[4] == 'img_10.JPG'
    pg.keyboard.press('Control+y'); pg.wait_for_timeout(150); assert col(pg, 1)[4] == '-'
    pg.keyboard.press('Control+z'); pg.wait_for_timeout(150)
    # "Start numbering" asks for pagination or foliation
    cell(0, 1).click(); cellmenu(pg, 'startnum'); pg.wait_for_timeout(150)
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
    # a project must never be saved in a folder that holds scans of this project (a folder that only contains such folders is fine, see test_roots.py)
    for target in ('B', 'AB'):
        pg.evaluate("k=>window.__picks.push(window.__h[k])", target); pg.click('#ws-more'); pg.click('[data-m=save]'); pg.wait_for_timeout(400)
        assert 'scan folder' in pg.inner_text('#ws-toast'), 'saving into a scan folder must be refused'
    pg.evaluate("window.__picks.push(window.__h.proj)"); pg.click('#ws-more'); pg.click('[data-m=save]'); pg.wait_for_timeout(900)
    assert '✓ Saved automatically' in pg.inner_text('#ws-save') and 'Book project' in (pg.get_attribute('#ws-save', 'title') or ''), pg.inner_text('#ws-save')
    assert project_files(pg) == ['Book project.bookcompare'], project_files(pg)        # the project is one file
    d = read_project(pg); assert [c['name'] for c in d['copies']] == ['A-Test', 'B-Test', 'C-Test'] and d['labels'] == {'2': 'Index'} and d['folio'] is True
    assert d['version'] == 2 and len(d['roots']) == 3 and all(len(c['locs']) == 1 for c in d['copies']) and 'tray' not in d
    # 0.11.0: the chip says that saving is automatic, with the time; Ctrl+S saves at once and says so
    import re as _re; assert _re.search(r'\d\d:\d\d', pg.inner_text('#ws-save')), pg.inner_text('#ws-save')
    pg.locator('#ws-vp').focus(); pg.keyboard.press('Control+s'); pg.wait_for_timeout(600)
    assert 'Saved in' in pg.inner_text('#ws-toast') and 'saved automatically' in pg.inner_text('#ws-toast'), pg.inner_text('#ws-toast')
    # 0.11.0: pictures in the grid (off at first, kept in the project; taller rows)
    assert pg.get_attribute('#ws-pics', 'aria-pressed') == 'false' and pg.locator('#ws .ws-cell .tn').count() == 0 and read_project(pg).get('thumbs') is False
    h40 = pg.locator('#ws .ws-row').first.bounding_box()['height']
    pg.click('#ws-pics'); pg.wait_for_timeout(300)
    assert pg.get_attribute('#ws-pics', 'aria-pressed') == 'true' and pg.locator('#ws .ws-row').first.bounding_box()['height'] > h40 + 40
    pg.wait_for_function("document.querySelectorAll('#ws .ws-cell .tn img').length >= 3", timeout=20000)
    pg.wait_for_timeout(1200); assert read_project(pg)['thumbs'] is True
    pg.click('#ws-pics'); pg.wait_for_timeout(300); assert pg.locator('#ws .ws-cell .tn').count() == 0 and abs(pg.locator('#ws .ws-row').first.bounding_box()['height'] - h40) < 1
    # the website shows the desktop-only items of the menu greyed, with a note
    pg.click('#ws-more'); assert pg.is_disabled('#ws-menu [data-m=bg]') and 'only in the desktop program' in pg.inner_text('#ws-menu [data-m=bg]'); pg.click('#ws-more')
    # column width, moving a copy, deleting a range of files with Shift (the grid is left as it was)
    import gridchecks; gridchecks.run(pg, col, lambda: read_project(pg))
    # N2: the project's name, in the top bar; kept in the project file
    assert 'De humani corporis fabrica' in pg.get_attribute('#ws-title', 'placeholder')
    pg.fill('#ws-title', 'Liber selectarum cantionum · Grimm & Wirsung, Augsburg 1520'); pg.keyboard.press('Enter'); pg.wait_for_timeout(1300)
    assert read_project(pg)['title'] == 'Liber selectarum cantionum · Grimm & Wirsung, Augsburg 1520'
    pg.keyboard.press('Control+z'); pg.wait_for_timeout(200); assert pg.input_value('#ws-title').startswith('Liber'), 'the grid undo leaves the name alone'
    pg.keyboard.press('Control+y'); pg.wait_for_timeout(200)
    # N6: the first column (row names) can be made wider and narrower, like the others; a double-click fits the names
    lw = lambda: pg.evaluate("document.querySelector('#ws .ws-corner').getBoundingClientRect().width")
    w0 = lw(); bb = pg.locator('#ws .ws-rz[data-c=lbl]').bounding_box(); x = bb['x'] + bb['width'] / 2; y = bb['y'] + bb['height'] / 2
    pg.mouse.move(x, y); pg.mouse.down(); pg.mouse.move(x + 30, y, steps=4); pg.mouse.move(x + 60, y, steps=4); pg.mouse.up(); pg.wait_for_timeout(1300)
    assert abs(lw() - (w0 + 60)) < 2 and abs(pg.evaluate("document.querySelector('#ws .ws-lbl').getBoundingClientRect().width") - (w0 + 60)) < 2, (w0, lw())
    assert read_project(pg)['lblw'] == round(w0 + 60), read_project(pg).get('lblw')
    pg.dblclick('#ws .ws-rz[data-c=lbl]'); pg.wait_for_timeout(200); assert 64 <= lw() < w0 + 60, lw()
    # N5 / item 18: the gap goes ABOVE the selected cell, and the number is asked for
    cell(1, 2).click(); pg.click('#ws-toolbar [data-act=gap]'); pg.wait_for_timeout(150)
    assert 'above' in pg.inner_text('#ws-scrim') and pg.input_value('#gapN') == '1'; pg.click('#ws-scrim [data-close]')
    # item 17: the right mouse button on a cell opens the menu of the cell, its copy and its row
    cell(1, 2).click(button='right'); pg.wait_for_timeout(150)
    assert pg.is_visible('#ws-ctx') and [t.strip().split(' (')[0].upper() for t in pg.locator('#ws-ctx .ws-mhead').all_inner_texts()] == ['THIS CELL', 'THIS COPY', 'THIS ROW']
    pg.keyboard.press('Escape'); pg.wait_for_timeout(100); assert pg.locator('#ws-ctx').count() == 0
    # the one menu: Project, Grid, Export (only in the Compare tab) and Help
    pg.click('#ws-more'); heads = [t.strip().upper() for t in pg.locator('#ws-menu .ws-mhead').all_inner_texts()]
    assert heads == ['PROJECT', 'GRID', 'EXPORT', 'HELP'] and not pg.locator('#ws-menu [data-m=x-view]').is_enabled(), heads
    pg.keyboard.press('Escape')
    # deleting a file: gone from the workspace, no "set aside" tray, the scan itself is untouched
    assert pg.locator('#ws-tray').count() == 0 and 'Set aside' not in pg.inner_text('#ws')
    cell(2, 0).click(); assert pg.inner_text('[data-act=del]') == 'Delete file'; pg.click('[data-act=del]'); pg.wait_for_timeout(1500)     # automatic saving
    assert col(pg, 2)[:2] == ['x_3.jpg', 'x_5.jpg'] and 'x_1.jpg' not in col(pg, 2)
    assert 'x_1.jpg' not in json.dumps(read_project(pg)['copies'][2]['cells'])
    pg.keyboard.press('Control+z'); pg.wait_for_timeout(150); assert col(pg, 2)[0] == 'x_1.jpg'          # undo
    pg.keyboard.press('Delete'); pg.wait_for_timeout(150); assert col(pg, 2)[0] == 'x_3.jpg'              # Delete key
    # add the deleted file to the copy again, at the end
    cell(2, 0).click(); cellmenu(pg, 'addfiles'); pg.wait_for_timeout(700)
    assert 'x_1.jpg' in pg.inner_text('#af-list') and 'x_3.jpg' not in pg.inner_text('#af-list')
    pg.check('#af-list input[data-gall]'); pg.click('#af-ok'); pg.wait_for_timeout(300)
    c2 = col(pg, 2)
    assert c2[:5] == ['x_3.jpg', 'x_5.jpg', 'x_2.jpg', 'x_4.jpg', 'x_6.jpg'] and c2[5] == 'x_1.jpg', c2
    # add pages from another folder (Copy-B, picked once) to the end of copy A
    cell(0, 7).click(); cellmenu(pg, 'addfiles'); pg.wait_for_timeout(500)
    assert pg.is_checked('input[name=af-where][value=end]')
    pg.evaluate("window.__picks.push(window.__h.B)"); pg.click('#af-folder'); pg.wait_for_timeout(600)
    assert 'img_1.JPG' in pg.inner_text('#af-list')
    pg.check('#af-list input[data-gall]'); pg.click('#af-ok'); pg.wait_for_timeout(600)
    a = col(pg, 0)
    assert a[8:14] == ['img_1.JPG', 'img_2.JPG', 'img_3.JPG', 'img_10.JPG', 'img_11.JPG', 'img_12.JPG'], a
    pg.wait_for_timeout(1300); dd = read_project(pg); assert len(dd['copies'][0]['locs']) == 2 and any(k.startswith('@1/') for k in dd['copies'][0]['cells'] if k), dd['copies'][0]['cells']
    assert len(dd['roots']) == 3, 'Copy-B is already a known folder: no new root'
    cell(0, 9).click(); pg.wait_for_timeout(900); assert thumbs(pg, 1)       # previews of the files from the second folder
    # an empty cell is filled first ...
    cell(1, 0).click(); cellmenu(pg, 'addfiles'); pg.wait_for_timeout(500)
    assert pg.is_checked('input[name=af-where][value=row]') and pg.input_value('#af-row') == '1'
    pg.select_option('#af-known', label='Copy-A'); pg.wait_for_timeout(600)
    pg.locator('#af-list input[data-j="0"]').first.check(); pg.click('#af-ok'); pg.wait_for_timeout(500)
    assert col(pg, 1)[:3] == ['scan_001.jpg', 'img_1.JPG', 'img_2.JPG'], col(pg, 1)
    # ... and where a cell is taken, the pages below move down
    cell(1, 1).click(); cellmenu(pg, 'addfiles'); pg.wait_for_timeout(500)
    pg.select_option('#af-known', label='Copy-A'); pg.wait_for_timeout(600)
    pg.locator('#af-list details').first.evaluate("d => d.open = true"); pg.wait_for_timeout(200)
    pg.locator('#af-list input[data-j="0"]').first.check()
    pg.check('input[name=af-where][value=row]'); pg.fill('#af-row', '2'); pg.click('#af-ok'); pg.wait_for_timeout(500)
    assert col(pg, 1)[:4] == ['scan_001.jpg', 'scan_002.jpg', 'img_1.JPG', 'img_2.JPG'], col(pg, 1)       # scan_001 was no longer offered (already in the grid); scan_002 went in at row 2
    # the folder that holds the project file cannot be a scan folder
    pg.click('#ws .ws-addbtn'); pg.evaluate("window.__picks.push(window.__h.proj)"); pg.click('#ac-folder'); pg.wait_for_timeout(400)
    assert 'project file' in pg.inner_text('#ac-err'), pg.inner_text('#ac-err'); pg.click('[data-close]')
    # hand a pair to the two-image screen and come back
    cell(0, 1).click(); pg.wait_for_timeout(300)
    pg.click('#ws-compare'); pg.wait_for_timeout(1500)
    assert pg.evaluate("document.getElementById('ws').hidden")
    assert pg.evaluate("[...document.querySelectorAll('#compare_container ul.vertical-image-list img')].every(i=>i.src.startsWith('blob:') && i.naturalWidth>0)")
    leave_compare(pg); pg.wait_for_timeout(600)
    assert not pg.evaluate("document.getElementById('ws').hidden"), 'Back (or the PAGES tab) must return to the workspace'
    # the two-image screen starts in Perspective mode
    assert pg.evaluate("document.querySelector('#transform_select #selected-text').textContent.trim()") == 'Perspective'
    assert pg.evaluate("document.querySelector('#transform_select').MDCSelect.value") == 'perspective'
    # reopen later (new page): the browser has forgotten the permissions. One click on "Allow access", no folder is chosen again.
    pg2 = reopen(ctx); lock(pg2, 'Copy-A', 'Copy-B', 'Copy-C')
    pg2.click('#books_btn'); pg2.wait_for_timeout(600); pg2.click('#ws .ws-empty [data-act=continue]'); pg2.wait_for_timeout(1500)
    assert pg2.locator('#ws .ws-hname').count() == 3
    assert not hid(pg2, '#ws-banner') and pg2.locator('#ws-banner [data-act=allow]').count() == 1 and pg2.locator('#ws-banner [data-act=reconnect]').count() <= 1
    assert pg2.locator('#ws .ws-hmeta.lost').count() == 3 and 'permission needed' in pg2.inner_text('#ws .ws-hmeta.lost')
    assert thumbs(pg2, 2) and prompts(pg2) == [], 'pages seen before are shown from memory, no permission asked yet'
    # COMPARE asks for the folders it needs (the test browser allows one folder per click, the worst case)
    pg2.locator('#ws .ws-cell[data-c="0"][data-r="2"]').click(); pg2.wait_for_timeout(300)
    pg2.click('#ws-compare'); pg2.wait_for_timeout(1000)
    assert not pg2.evaluate("document.getElementById('ws').hidden") and 'once more' in pg2.inner_text('#ws-toast'), pg2.inner_text('#ws-toast')
    pg2.click('#ws-compare'); pg2.wait_for_timeout(1500)
    assert pg2.evaluate("document.getElementById('ws').hidden") and prompts(pg2) == ['Copy-A', 'Copy-B'], prompts(pg2)
    leave_compare(pg2); pg2.wait_for_timeout(600)
    clicks = 0
    while not hid(pg2, '#ws-banner') and clicks < 6:
        pg2.click('#ws-banner [data-act=allow]'); clicks += 1; pg2.wait_for_timeout(700)
    assert hid(pg2, '#ws-banner') and pg2.locator('#ws .ws-hmeta.lost').count() == 0 and thumbs(pg2, 2)
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
    assert hid(pg2, '#ws-banner') and thumbs(pg2, 2)
    pg2.wait_for_timeout(1200)
    d3 = read_project(pg2); assert len(d3['roots']) == 1 and d3['roots'][0]['name'] == 'scans', d3['roots']       # all copies now share one folder
    # a wrong folder is not accepted
    pg2.evaluate("""(async()=>{ const d = await new Promise(r=>{const q=indexedDB.open('book-compare',1); q.onsuccess=()=>r(q.result)}); await new Promise(r=>{const tx=d.transaction('handles','readwrite'); tx.objectStore('handles').clear(); tx.oncomplete=r;}); })()""")
    pg2.evaluate("window.__picks.push(window.__h.proj)"); pg2.click('#ws-more'); pg2.click('[data-m=open]'); pg2.wait_for_timeout(1200)
    assert not hid(pg2, '#ws-banner')
    pg2.evaluate("window.__picks.push(window.__h.proj)"); pg2.click('#ws-banner [data-act=reconnect]'); pg2.wait_for_timeout(900)
    assert not hid(pg2, '#ws-banner'), 'a folder without the scans must not be accepted'
    # large project: only a few rows exist in the page at any time (project written by the first version, with no folder information)
    big = {'format': 'book-compare-project', 'version': 1, 'projectId': 'big', 'nextCopy': 21, 'ns': 0, 'folio': False, 'labels': {}, 'skip': {}, 'flags': {'0': 2, '5': 4, 'x': 1, '3': 9, '7': 'a', '8': -1, '9': 1.5}, 'nextAnn': 3, 'annotations': {'2': [{'id': 1, 't': 'ellipse', 'x': 0.2, 'y': 0.3, 'w': 0.1, 'h': 0.05, 'col': 3, 'text': 'ok', 'pair': [1, 2]}, {'id': 1, 't': 'star', 'x': 0.5, 'y': 0.5, 'w': 0.1, 'h': 0.1}, {'id': 2, 't': 'rect', 'x': 7, 'y': -3, 'w': 'abc', 'h': 0.2, 'col': 99, 'text': 5, 'pair': 'no'}, 'junk', None], 'x': [{'id': 9, 't': 'note', 'x': 0.1, 'y': 0.1}], '4': 'no'}, 'pair': [1, 2], 'sel': {'ci': 0, 'row': 0}, 'tray': [{'cid': 1, 'key': 'img_000.jpg'}],
           'copies': [{'id': i + 1, 'name': 'Copy-%02d' % (i + 1), 'folder': 'Copy-%02d' % (i + 1), 'keys': [], 'cells': [('img_%03d.jpg' % r) if (r + i * 7) % 53 > 3 else None for r in range(544)]} for i in range(20)]}
    pg2.evaluate("async(j)=>{ const r = await navigator.storage.getDirectory(); const bd = await r.getDirectoryHandle('bigproj',{create:true}); const fh = await bd.getFileHandle('book-compare-project.json',{create:true}); const w = await fh.createWritable(); await w.write(j); await w.close(); window.__h.big = bd; }", json.dumps(big))
    pg2.evaluate("window.__picks.push(window.__h.big)"); pg2.click('#ws-more'); pg2.click('[data-m=open]'); pg2.wait_for_timeout(1500)
    assert pg2.locator('#ws .ws-hname').count() == 20 and pg2.locator('#ws .ws-row').count() < 40
    # flags in a project file: only real row numbers with a colour 0-5 are taken over, nothing else (and they show in the grid)
    assert pg2.evaluate("[0, 3, 5, 7, 8, 9].map(i => BookWorkspace.tab.rowInfo(i).flag)") == [2, None, 4, None, None, None]
    assert pg2.locator('#ws .ws-lbl[data-r="0"] svg.ws-flag').count() == 1 and pg2.locator('#ws .ws-lbl[data-r="3"] svg.ws-flag').count() == 0
    # annotations in a project file: known shapes only, numbers kept inside the picture, a repeated or missing number replaced, nothing else
    an = pg2.evaluate("BookWorkspace.tab.annList(2)")
    assert [x['t'] for x in an] == ['ellipse', 'rect'] and an[0]['id'] == 1 and an[0]['text'] == 'ok' and an[0]['col'] == 3 and an[0]['pair'] == [1, 2], an
    assert an[1]['id'] == 2 and an[1]['x'] == 1 and an[1]['y'] == 0 and an[1]['w'] == 0 and an[1]['col'] == 0 and an[1]['text'] == '' and an[1]['pair'] == [None, None], an[1]
    assert pg2.evaluate("BookWorkspace.tab.annList(4).length + BookWorkspace.tab.annList(5).length") == 0 and pg2.evaluate("BookWorkspace.tab.rowInfo(2).ann") == 2
    nid = pg2.evaluate("BookWorkspace.tab.annAdd(2, {t: 'note', x: 0.4, y: 0.4, col: 1, text: 't', pair: [1, 2]})"); assert nid == 3, nid        # new numbers go on after the saved ones
    assert pg2.evaluate("BookWorkspace.tab.annSet(2, 3, {t: 'rect', id: 99, x: 5, text: 'u'})") and pg2.evaluate("BookWorkspace.tab.annList(2)[2]") == {'id': 3, 't': 'note', 'x': 1, 'y': 0.4, 'w': 0, 'h': 0, 'col': 1, 'text': 'u', 'pair': [1, 2]}
    assert pg2.evaluate("BookWorkspace.tab.annDel(2, 3)") and pg2.evaluate("BookWorkspace.tab.annList(2).length") == 2
    # the scan folders were only read
    assert before == snapshot(pg2), 'scan folders must be unchanged'
    assert not errs, errs
    print('ALL WORKSPACE TESTS PASSED')
    b.close()
