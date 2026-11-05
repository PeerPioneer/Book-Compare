"""Automatic test of how scan folders are remembered and reopened (the "roots" of app/js/workspace.js).

Goals checked here:
  * a folder that holds several copies is chosen ONCE; further copies come from a list, no folder picker
  * reopening a project never asks for the folder of each copy again: one permission for the folder is enough
  * projects saved by the first version (one remembered folder per copy) still open, and one folder choice merges them
  * the scan folders are never changed

Run: cd app && python3 -m http.server 8765 &   then   python3 tests/workspace/test_roots.py
"""
import json
from common import *

def add_known(pg, name, tick, option=1):
    pg.click('#ws .ws-addbtn'); pg.wait_for_timeout(150)
    pg.select_option('#ac-known', index=option); pg.wait_for_timeout(600)
    pg.fill('#ac-name', name)
    pg.check('#ac-groups input[data-g="%d"]' % tick)
    pg.click('#ac-ok'); pg.wait_for_timeout(500)

def picker_calls(pg): return pg.evaluate("(window.__lastOpts||[]).filter(o=>o.includes('book-scans')).length")

with sync_playwright() as p:
    b, ctx, pg, before = setup3(p)
    pg.close(); pg = ctx.new_page(); pg.goto(URL); pg.wait_for_timeout(900); pg.evaluate(HELPERS); handles(pg)
    pg.click('#books_btn'); pg.wait_for_timeout(300)
    # --- one folder holds several copies: pick it once -------------------------------------------------------------
    add_copy(pg, 'scans', 'Lib-A', ticks=(0,))
    assert picker_calls(pg) == 1 and col(pg, 0)[0] == 'scan_001.jpg'
    add_known(pg, 'Lib-B', 1)
    pg.click('#ws .ws-addbtn'); pg.wait_for_timeout(150); pg.select_option('#ac-known', index=1); pg.wait_for_timeout(600)
    assert 'already used by Lib-A' in pg.inner_text('#ac-groups') and 'already used by Lib-B' in pg.inner_text('#ac-groups')
    pg.fill('#ac-name', 'Lib-C'); pg.check('#ac-groups input[data-g="2"]'); pg.check('#ac-groups input[data-g="3"]'); pg.click('#ac-ok'); pg.wait_for_timeout(500)
    assert picker_calls(pg) == 1, 'the folder was chosen once; the other copies came from the list'
    assert pg.locator('#ws .ws-hname').count() == 3 and col(pg, 1)[0] == 'img_1.JPG' and col(pg, 2)[:2] == ['x_1.jpg', 'x_3.jpg'] and pg.locator('#ws-thumbs img').count() >= 2
    # a name has to be typed: it is never filled in from the folder
    pg.click('#ws .ws-addbtn'); pg.wait_for_timeout(150); pg.select_option('#ac-known', index=1); pg.wait_for_timeout(500); assert pg.input_value('#ac-name') == ''; pg.click('[data-close]')
    # a folder inside the known root joins that root (no second permission needed)
    pg.click('#ws .ws-addbtn'); pg.evaluate("window.__picks.push(window.__h.B)"); pg.click('#ac-folder'); pg.wait_for_timeout(600)
    assert pg.locator('#ac-known option').count() == 3 and 'Copy-B' in pg.inner_text('#ac-known'); pg.click('[data-close]')
    # save, then reopen with the permission gone
    pg.evaluate("window.__picks.push(window.__h.proj)"); pg.click('#ws-more'); pg.click('[data-m=save]'); pg.wait_for_timeout(1200)
    d = read_project(pg); assert len(d['roots']) == 1 and d['roots'][0]['name'] == 'scans', d['roots']
    assert [c['locs'] for c in d['copies']] == [[{'root': d['roots'][0]['id'], 'path': ''}]] * 3
    pg2 = reopen(ctx); lock(pg2, 'scans')
    pg2.click('#books_btn'); pg2.wait_for_timeout(600); pg2.click('#ws .ws-empty [data-act=continue]'); pg2.wait_for_timeout(1500)
    # previews of pages seen before appear at once, without any permission; COMPARE then asks for the one folder it needs
    assert not hid(pg2, '#ws-banner') and pg2.locator('#ws-thumbs img').count() >= 2 and prompts(pg2) == [], prompts(pg2)
    assert pg2.evaluate("(window.__lastOpts||[]).length") == 0, 'no folder picker was needed'
    pg2.click('#ws-compare'); pg2.wait_for_timeout(1500)
    assert pg2.evaluate("document.getElementById('ws').hidden") and prompts(pg2) == ['scans'], prompts(pg2)
    pg2.click('#back'); pg2.wait_for_timeout(600)
    assert hid(pg2, '#ws-banner') and pg2.locator('#ws .ws-hmeta.lost').count() == 0

    # --- the folder window starts where the last folder was chosen ---------------------------------------------------
    o = pick_opts(pg)
    assert o[0]['startIn'] == 'Copy-C' and o[1]['id'] == 'book-scans' and o[1]['startIn'] == 'scans', o
    pg.click('#ws .ws-addbtn'); pg.evaluate("window.__picks.push(window.__h.A)"); pg.click('#ac-folder'); pg.wait_for_timeout(500); pg.click('[data-close]')
    o = pick_opts(pg); assert o[-1]['startIn'] == 'scans', o                      # Copy-B lay inside the known folder "scans": the next window starts there, not inside Copy-B

    # --- a project saved by the first version: one remembered folder per copy ---------------------------------------
    legacy = {'format': 'book-compare-project', 'version': 1, 'projectId': 'legacy1', 'nextCopy': 3, 'ns': 0, 'folio': False, 'labels': {}, 'skip': {}, 'pair': [1, 2], 'sel': {'ci': 0, 'row': 0}, 'tray': [],
              'copies': [{'id': 1, 'name': 'Old-A', 'folder': 'Copy-A', 'keys': ['Gesamtes Buch/scan_001.jpg', 'Gesamtes Buch/scan_002.jpg'], 'cells': ['Gesamtes Buch/scan_001.jpg', 'Gesamtes Buch/scan_002.jpg']},
                         {'id': 2, 'name': 'Old-B', 'folder': 'Copy-B', 'keys': ['img_1.JPG', 'img_2.JPG'], 'cells': ['img_1.JPG', 'img_2.JPG']}]}
    pg3 = reopen(ctx)
    pg3.click('#books_btn'); pg3.wait_for_timeout(500)
    pg3.evaluate("""async(j)=>{ const r = await navigator.storage.getDirectory(); const bd = await r.getDirectoryHandle('legacyproj',{create:true});
      const fh = await bd.getFileHandle('book-compare-project.json',{create:true}); const w = await fh.createWritable(); await w.write(j); await w.close(); window.__h.legacy = bd;
      const d = await new Promise(res=>{const q=indexedDB.open('book-compare',1); q.onsuccess=()=>res(q.result)});
      await new Promise(res=>{const tx=d.transaction('handles','readwrite'); tx.objectStore('handles').put(__h.A,'legacy1/1'); tx.objectStore('handles').put(__h.B,'legacy1/2'); tx.oncomplete=res;}); }""", json.dumps(legacy))
    lock(pg3, 'Copy-A', 'Copy-B'); pg3.evaluate("window.__noact = true")           # as if the browser had used up the click already
    pg3.evaluate("window.__picks.push(window.__h.legacy)"); pg3.click('#ws-more'); pg3.click('[data-m=open]'); pg3.wait_for_timeout(1500)
    assert pg3.locator('#ws .ws-hname').count() == 2 and not hid(pg3, '#ws-banner')
    assert pg3.locator('#ws-banner [data-act=allow]').count() == 1 and pg3.locator('#ws-banner [data-act=reconnect]').count() == 1, pg3.inner_html('#ws-banner')
    # ... one choice of the folder that holds both merges them into a single remembered folder
    pg3.evaluate("window.__noact = false; window.__picks.push(window.__h.scans)"); pg3.click('#ws-banner [data-act=reconnect]'); pg3.wait_for_timeout(1500)
    assert hid(pg3, '#ws-banner') and pg3.locator('#ws-thumbs img').count() >= 2 and prompts(pg3) == []
    pg3.locator('#ws .ws-hname').first.click(); pg3.keyboard.type('Renamed-A'); pg3.keyboard.press('Enter'); pg3.wait_for_timeout(1500)
    d = read_project(pg3, 'legacy'); assert d['version'] == 2 and len(d['roots']) == 1 and d['roots'][0]['name'] == 'scans', d['roots']
    assert [c['locs'][0]['path'] for c in d['copies']] == ['Copy-A', 'Copy-B'] and d['copies'][0]['name'] == 'Renamed-A'
    # the same legacy project again, this time with one click per remembered folder
    pg4 = reopen(ctx)
    pg4.click('#books_btn'); pg4.wait_for_timeout(500)
    pg4.evaluate("""async(j)=>{ window.__h.legacy = await (await navigator.storage.getDirectory()).getDirectoryHandle('legacyproj'); const d = await new Promise(res=>{const q=indexedDB.open('book-compare',1); q.onsuccess=()=>res(q.result)});
      await new Promise(res=>{const tx=d.transaction('handles','readwrite'); tx.objectStore('handles').put(__h.A,'legacy1/1'); tx.objectStore('handles').put(__h.B,'legacy1/2'); tx.oncomplete=res;});
      const fh = await __h.legacy.getFileHandle('book-compare-project.json'); const w = await fh.createWritable(); await w.write(j); await w.close(); }""", json.dumps(legacy))
    lock(pg4, 'Copy-A', 'Copy-B')
    pg4.evaluate("window.__picks.push(window.__h.legacy)"); pg4.click('#ws-more'); pg4.click('[data-m=open]'); pg4.wait_for_timeout(1500)
    clicks = 0
    while not hid(pg4, '#ws-banner') and clicks < 4:
        pg4.click('#ws-banner [data-act=allow]'); clicks += 1; pg4.wait_for_timeout(700)
    assert hid(pg4, '#ws-banner') and pg4.locator('#ws-thumbs img').count() >= 2, clicks
    assert before == snapshot(pg4), 'scan folders must be unchanged'
    assert not errs, errs
    print('ALL ROOT TESTS PASSED')
    b.close()
