"""Automatic test of the Compare tab (app/js/compare-tab.js) with the real alignment engine of the app.

It uses the helper (launcher/serve.ps1) with REAL folders on disk and the sample pictures that come with the app
(app/images/usecases): three copies "A", "B", "C" (C has only two pages), made in a temporary folder - never your own scans.
Checked, in Chromium and Firefox:
  COMPARE opens the Compare tab and aligns the pair by itself; next/previous page, keys, copy menus, swap, the page list and its
  search, skipping pages that a copy lacks, PAGES tab and back, flags (button, colours, key F, list filter, shown in the Pages grid,
  undo), the book map (opens near the pointer, picture of the page, click to jump, grey ticks, pin), focus mode (hides everything but the pictures, keys work, Esc/Leave button), and that the scan folders are never changed.

Run:  PWSH=pwsh python3 tests/workspace/test_compare_tab.py
"""
import hashlib, json, os, shutil, subprocess, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
PORT = int(os.environ.get('BOOKCOMPARE_HELPER_PORT', '8795'))
BASE = 'http://localhost:%d' % PORT
PWSH = os.environ.get('PWSH') or shutil.which('pwsh') or shutil.which('powershell')
if not PWSH:
    print('SKIPPED: no PowerShell found (set PWSH)'); sys.exit(0)

TMP = os.path.realpath(tempfile.mkdtemp(prefix='bc_ctab_'))
BOOKS = os.path.join(TMP, 'Books'); DATA = os.path.join(TMP, 'data'); PICKS = os.path.join(TMP, 'picks.txt')
for d in (BOOKS, DATA, os.path.join(BOOKS, 'Project')): os.makedirs(d)
open(PICKS, 'w').close()
U = os.path.join(REPO, 'app', 'images', 'usecases')
PAIRS = [('book/case2-traherne2-a-original.jpg', 'book/case2-traherne2-b-original.jpg'),
         ('music/case5-music-sheet-1.jpg', 'music/case5-music-sheet-2.jpg'),
         ('churchill/case3-churchill-1.jpg', 'churchill/case3-churchill-2.jpg'),
         ('painting/giovanni-1.jpg', 'painting/giovanni-2.jpg')]
for ci, name in ((0, 'Copy-A'), (1, 'Copy-B')):
    os.makedirs(os.path.join(BOOKS, name))
    for i, pr in enumerate(PAIRS): shutil.copy(os.path.join(U, pr[ci]), os.path.join(BOOKS, name, 'p%d.jpg' % (i + 1)))
os.makedirs(os.path.join(BOOKS, 'Copy-C'))
for i in (0, 1): shutil.copy(os.path.join(U, PAIRS[i][1]), os.path.join(BOOKS, 'Copy-C', 'p%d.jpg' % (i + 1)))
errs = []
SHOTS = os.environ.get('BOOKCOMPARE_SHOTS', '')

def snapshot():
    out = {}
    for dp, dn, fn in os.walk(BOOKS):
        if os.path.relpath(dp, BOOKS).split(os.sep)[0] == 'Project': continue
        for f in fn:
            p = os.path.join(dp, f); st = os.stat(p); out[os.path.relpath(p, BOOKS)] = (st.st_size, st.st_mtime_ns, hashlib.sha1(open(p, 'rb').read()).hexdigest())
    return out
BEFORE = snapshot()

proc = None
def start_helper():
    global proc
    args = [PWSH, '-NoProfile']
    if os.name == 'nt': args += ['-ExecutionPolicy', 'Bypass']
    args += ['-File', os.path.join(REPO, 'launcher', 'serve.ps1'), '-Port', str(PORT), '-NoBrowser', '-NoTray', '-NoSetup', '-DataDir', DATA, '-TestPickFile', PICKS]
    proc = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(80):
        try:
            if json.load(urllib.request.urlopen(BASE + '/api/ping', timeout=1)).get('app') == 'BookCompare': return
        except Exception: time.sleep(0.25)
    raise SystemExit('the helper did not start')
def stop_helper():
    global proc
    if proc and proc.poll() is None:
        try: urllib.request.urlopen(urllib.request.Request(BASE + '/api/quit', data=b'', method='POST', headers={'X-BookCompare': '1'}), timeout=3)
        except Exception: pass
        try: proc.wait(timeout=6)
        except Exception: proc.kill()
    proc = None
def push_pick(path):
    with open(PICKS, 'a', encoding='utf-8') as f: f.write(path + '\n')

def open_workspace(pg):
    pg.goto(BASE + '/index.html'); pg.wait_for_timeout(1200)
    for _ in range(8):
        btn = pg.locator('#onboarding button:visible').last
        if btn.count() == 0: break
        txt = btn.inner_text().strip(); btn.click(); pg.wait_for_timeout(300)
        if 'NEXT' not in txt.upper(): break
    pg.click('#books_btn'); pg.wait_for_timeout(900)
def add_copy(pg, folder, name):
    push_pick(os.path.join(BOOKS, folder))
    pg.click('#ws .ws-tb[data-act=add]' if pg.locator('#ws .ws-tb[data-act=add]').count() else '#ws .ws-addbtn'); pg.wait_for_timeout(200)
    pg.click('#ac-folder'); pg.wait_for_timeout(900)
    pg.fill('#ac-name', name); pg.click('#ac-ok'); pg.wait_for_timeout(800)

def where(pg): return pg.inner_text('#ct_where').replace('\n', ' ')
def wait_aligned(pg, why, secs=90):
    """the alignment is finished: no 'busy' box, the pictures are not dimmed"""
    for _ in range(secs * 4):
        pg.wait_for_timeout(250)
        if pg.evaluate("!document.querySelector('.ct-busy').offsetParent && !document.querySelector('div.result_container').classList.contains('ct-stale')"): return
        if pg.locator('.ct-busy.bad:visible').count(): raise AssertionError(why + ': ' + pg.inner_text('.ct-busy'))
    raise AssertionError(why + ': the alignment did not finish. ' + pg.inner_text('.ct-busy'))
def fcolor(pg, i): return pg.evaluate("getComputedStyle(document.querySelector('#ct_list li[data-i=\"%d\"] svg.ct-fl')).color" % i)
def labels(pg): return [t.strip() for t in pg.locator('#workspace .pane__label').all_inner_texts()]

def scenario(p, kind):
    c = getattr(p, kind).launch(); pg = c.new_page(viewport={'width': 1500, 'height': 900})
    pg.on('pageerror', lambda e: errs.append(kind + ' PAGEERROR ' + str(e)))
    pg.on('console', lambda m: errs.append(kind + ' CONSOLE ' + m.text) if m.type == 'error' and '/api/' not in (m.location or {}).get('url', '') else None)
    start_helper(); open_workspace(pg)
    add_copy(pg, 'Copy-A', 'A-Test'); add_copy(pg, 'Copy-B', 'B-Test'); add_copy(pg, 'Copy-C', 'C-Test')
    assert pg.locator('#ws .ws-hname').count() == 3
    # COMPARE opens the Compare tab and aligns by itself
    pg.locator('#ws .ws-lbl[data-r="0"]').first.click(); pg.wait_for_timeout(300)
    pg.click('#ws-compare'); wait_aligned(pg, 'first pair')
    assert pg.evaluate("document.getElementById('ws').hidden"), 'the Pages layer should be hidden'
    assert pg.is_visible('.ct-top') and pg.is_visible('#ct_list'), 'tabs and left panel'
    assert 'Page 1' in where(pg) and 'position 1 of 4' in where(pg), where(pg)
    assert pg.evaluate("document.getElementById('ct_c1').selectedOptions[0].text") == 'A-Test' and pg.evaluate("document.getElementById('ct_c2').selectedOptions[0].text") == 'B-Test'
    labs = labels(pg); assert any('A-Test' in l for l in labs) and any('B-Test' in l for l in labs), labs
    assert pg.evaluate("document.querySelector('#result canvas').width") > 100, 'the superimposed picture should be drawn'
    # next page by the button, then by the key, then back
    pg.click('#ct_next'); wait_aligned(pg, 'next page'); assert 'Page 2' in where(pg), where(pg)
    pg.click('#ct_c1'); pg.keyboard.press('Escape'); pg.locator('body').click(position={'x': 700, 'y': 450}) if False else None
    pg.evaluate("document.activeElement && document.activeElement.blur()")
    pg.keyboard.press('ArrowRight'); wait_aligned(pg, 'key right'); assert 'Page 3' in where(pg), where(pg)
    pg.keyboard.press('ArrowLeft'); pg.keyboard.press('ArrowLeft'); wait_aligned(pg, 'key left x2'); assert 'Page 1' in where(pg), where(pg)
    pg.click('#ct_prev'); assert 'first page to compare' in pg.inner_text('#ct_note'), 'no page before the first'
    # the page list: click a row, search
    pg.fill('#ct_q', '4'); assert pg.locator('#ct_list li[data-i]').count() == 1, pg.inner_text('#ct_list')
    pg.click('#ct_list li[data-i="3"]'); wait_aligned(pg, 'list click'); assert 'Page 4' in where(pg), where(pg)
    pg.fill('#ct_q', ''); assert pg.locator('#ct_list li[data-i]').count() == 4
    # swap, and copy 2 = C (has only two pages): rows 3 and 4 are marked, and "next" skips them
    pg.click('#ct_swap'); wait_aligned(pg, 'swap'); assert pg.evaluate("document.getElementById('ct_c1').selectedOptions[0].text") == 'B-Test'
    pg.click('#ct_swap'); wait_aligned(pg, 'swap back')
    pg.select_option('#ct_c2', label='C-Test'); pg.wait_for_selector('.ct-busy.bad:visible', timeout=20000)
    assert 'C-Test has no page' in pg.inner_text('.ct-busy'), pg.inner_text('.ct-busy')      # page 4 does not exist in copy C
    assert pg.locator('#ct_list li.miss').count() == 2, pg.locator('#ct_list li.miss').count()
    pg.click('#ct_list li[data-i="0"]'); wait_aligned(pg, 'row 1 with C'); pg.click('#ct_next'); wait_aligned(pg, 'row 2 with C'); assert 'Page 2' in where(pg), where(pg)
    pg.click('#ct_next'); assert 'last page to compare' in pg.inner_text('#ct_note'), 'rows 3 and 4 lack a page in C: skipped'
    pg.evaluate("document.getElementById('ct_skip').click()")                       # no skipping: the next row is shown even if C lacks it
    pg.click('#ct_next'); pg.wait_for_timeout(400)
    assert pg.locator('.ct-busy.bad:visible').count() == 1 and 'no page' in pg.inner_text('.ct-busy').lower(), pg.inner_text('.ct-busy')
    pg.evaluate("document.getElementById('ct_skip').click()")
    # copy 2 menu by key, then back to B
    pg.click('#ct_list li[data-i="0"]'); wait_aligned(pg, 'row 1 again')
    pg.evaluate("document.activeElement && document.activeElement.blur()")
    pg.keyboard.press('ArrowUp'); wait_aligned(pg, 'copy 2 up'); assert pg.evaluate("document.getElementById('ct_c2').selectedOptions[0].text") == 'B-Test'
    # ---------------------------------------------------------------- flags
    pg.evaluate("document.activeElement && document.activeElement.blur()")
    assert pg.is_hidden('#ct_filters') and pg.is_hidden('#ct_fcols'), 'nothing flagged yet: no filter chips'
    assert pg.get_attribute('#ct_flag', 'aria-pressed') == 'false'
    pg.click('#ct_flag')                                                           # first click: flag in the standard colour
    assert pg.get_attribute('#ct_flag', 'aria-pressed') == 'true' and pg.is_hidden('#ct_flagpal')
    assert pg.locator('#ct_list li[data-i="0"] svg.ct-fl').count() == 1 and 'Flagged 1' in pg.inner_text('#ct_filters'), pg.inner_text('#ct_filters')
    assert fcolor(pg, 0) == 'rgb(239, 71, 111)', fcolor(pg, 0)                      # the first colour of the palette
    pg.click('#ct_next'); wait_aligned(pg, 'flag page 2'); assert 'Page 2' in where(pg)
    assert pg.get_attribute('#ct_flag', 'aria-pressed') == 'false', 'flags belong to a page: page 2 is not flagged'
    pg.keyboard.press('f'); assert pg.get_attribute('#ct_flag', 'aria-pressed') == 'true' and 'Flagged 2' in pg.inner_text('#ct_filters')       # key F flags
    pg.keyboard.press('f'); assert pg.get_attribute('#ct_flag', 'aria-pressed') == 'false' and 'Flagged 1' in pg.inner_text('#ct_filters')     # and removes
    pg.click('#ct_flag'); pg.click('#ct_flag')                                     # flag, then click again: the colours
    assert pg.is_visible('#ct_flagpal') and pg.locator('#ct_flagpal button[data-c]').count() == 6 and 'Remove flag' in pg.inner_text('#ct_flagpal')
    pg.click('#ct_flagpal button[data-c="3"]')                                     # green
    assert pg.is_hidden('#ct_flagpal') and fcolor(pg, 1) == 'rgb(6, 214, 160)', fcolor(pg, 1)
    pg.click('#ct_flag'); assert pg.is_visible('#ct_flagpal'); pg.keyboard.press('Escape'); assert pg.is_hidden('#ct_flagpal'), 'Escape closes the colours'
    pg.click('#ct_flag'); pg.click('#ct_flagpal .rm'); assert pg.get_attribute('#ct_flag', 'aria-pressed') == 'false' and 'Flagged 1' in pg.inner_text('#ct_filters')
    pg.click('#ct_flag'); pg.click('#ct_flag'); pg.click('#ct_flagpal button[data-c="3"]')       # flags now: page 1 pink-red, page 2 green
    assert pg.evaluate("[...document.querySelectorAll('#ct_list li svg.ct-fl')].length") == 2
    # the list filter
    pg.click('#ct_filters [data-f=flag]'); assert pg.locator('#ct_list li[data-i]').count() == 2 and pg.is_visible('#ct_fcols') and pg.locator('#ct_fcols button').count() == 6
    pg.click('#ct_fcols button[data-c="4"]'); assert pg.locator('#ct_list li[data-i]').count() == 0 and 'No flagged page in this colour' in pg.inner_text('#ct_list')
    pg.click('#ct_fcols button[data-c="4"]'); assert pg.locator('#ct_list li[data-i]').count() == 2
    pg.click('#ct_fcols button[data-c="3"]'); assert pg.locator('#ct_list li[data-i]').count() == 1 and pg.locator('#ct_list li[data-i="1"]').count() == 1
    pg.click('#ct_filters [data-f=all]'); assert pg.locator('#ct_list li[data-i]').count() == 4 and pg.is_hidden('#ct_fcols')
    # ---------------------------------------------------------------- the book map
    vb = pg.get_attribute('#ct_mapsvg', 'viewBox').split(); assert vb[0] == '0' and vb[3] == '12' and float(vb[2]) > 300, vb          # drawn in real pixels
    assert pg.locator('#ct_mapsvg rect[style*="fill"]').count() == 2, 'one coloured tick per flag'
    assert pg.evaluate("document.querySelector('#ct_map .ct-map-in').offsetHeight") <= 10, 'closed: a thin line'
    box = pg.locator('#ct_map').bounding_box(); pg.mouse.move(box['x'] + box['width'] / 2, box['y'] + 3); pg.wait_for_timeout(700)
    assert pg.evaluate("document.querySelector('#ct_map .ct-map-in').offsetHeight") >= 38, 'the pointer comes near: the map opens'
    sb = pg.locator('#ct_mapsvg').bounding_box()
    def at(row, n=4): return sb['x'] + (row + 0.5) / n * sb['width'], sb['y'] + sb['height'] / 2
    pg.mouse.move(*at(2)); pg.wait_for_timeout(300)
    assert pg.is_visible('#ct_tip') and 'Page 3' in pg.inner_text('#ct_tip'), pg.inner_text('#ct_tip')
    for _ in range(40):
        if pg.locator('#ct_tip img').count(): break
        pg.wait_for_timeout(250)
    assert pg.locator('#ct_tip img').count() == 1, 'a small picture of that page: ' + pg.inner_text('#ct_tip')
    pg.mouse.move(*at(1)); pg.wait_for_timeout(200); assert 'Page 2' in pg.inner_text('#ct_tip') and 'Flagged (green)' in pg.inner_text('#ct_tip'), pg.inner_text('#ct_tip')
    pg.mouse.click(*at(2)); wait_aligned(pg, 'map click'); assert 'Page 3' in where(pg), where(pg)       # a click jumps there
    pg.mouse.move(*at(0)); pg.wait_for_timeout(100); pg.mouse.click(*at(0)); wait_aligned(pg, 'map click first'); assert 'Page 1' in where(pg)
    # a page that one copy lacks: grey tick; the click goes to the nearest page both have
    pg.select_option('#ct_c2', label='C-Test'); wait_aligned(pg, 'copy C on the map')
    assert pg.locator('#ct_mapsvg .mgap').count() == 2, 'two pages are missing in C'
    box = pg.locator('#ct_map').bounding_box(); pg.mouse.move(box['x'] + box['width'] / 2, box['y'] + 3); pg.wait_for_timeout(700)
    sb = pg.locator('#ct_mapsvg').bounding_box(); pg.mouse.move(*at(3)); pg.wait_for_timeout(200)
    assert 'No page in C-Test' in pg.inner_text('#ct_tip'), pg.inner_text('#ct_tip')
    pg.mouse.click(*at(3)); wait_aligned(pg, 'map click on a gap'); assert 'Page 2' in where(pg), 'nearest page both copies have: ' + where(pg)
    pg.select_option('#ct_c2', label='B-Test'); wait_aligned(pg, 'back to B')
    assert pg.locator('#ct_mapsvg .mgap').count() == 0
    # pinned: stays open without the pointer; saved for next time
    box = pg.locator('#ct_map').bounding_box(); pg.mouse.move(box['x'] + box['width'] / 2, box['y'] + 3); pg.wait_for_timeout(700)
    pg.click('#ct_pin'); pg.mouse.move(700, 300); pg.wait_for_timeout(900)
    assert pg.evaluate("document.getElementById('ct_map').classList.contains('pinned')") and pg.evaluate("document.querySelector('#ct_map .ct-map-in').offsetHeight") >= 38, 'pinned: stays open'
    assert pg.evaluate("localStorage.getItem('bc-map-pinned')") == '1'
    pg.click('#ct_pin'); pg.mouse.move(700, 300); pg.wait_for_timeout(900)
    assert pg.evaluate("document.querySelector('#ct_map .ct-map-in').offsetHeight") <= 10, 'unpinned: closes again'
    # the flags show in the Pages grid, and the Pages view can undo them
    pg.click('#ct_tab_pages'); pg.wait_for_timeout(500)
    assert pg.locator('#ws .ws-lbl[data-r="0"] svg.ws-flag').count() == 1 and pg.locator('#ws .ws-lbl[data-r="1"] svg.ws-flag').count() == 1 and pg.locator('#ws .ws-lbl[data-r="2"] svg.ws-flag').count() == 0
    assert pg.evaluate("getComputedStyle(document.querySelector('#ws .ws-lbl[data-r=\"1\"] svg.ws-flag')).color") == 'rgb(6, 214, 160)'
    pg.locator('#ws-vp').focus() if pg.locator('#ws-vp').count() else None
    pg.keyboard.press('Control+z'); pg.wait_for_timeout(300)
    assert pg.evaluate("getComputedStyle(document.querySelector('#ws .ws-lbl[data-r=\"1\"] svg.ws-flag')).color") == 'rgb(239, 71, 111)', 'undo: the colour change is taken back'
    pg.keyboard.press('Control+Shift+z'); pg.wait_for_timeout(300)
    assert pg.evaluate("getComputedStyle(document.querySelector('#ws .ws-lbl[data-r=\"1\"] svg.ws-flag')).color") == 'rgb(6, 214, 160)', 'redo'
    pg.locator('#ws .ws-lbl[data-r="0"]').first.click(); pg.wait_for_timeout(300); pg.click('#ws-compare'); wait_aligned(pg, 'back from the pages')
    # ---------------------------------------------------------------- annotations (on page 2 of the book, pair A + B)
    pg.click('#ct_list li[data-i="1"]'); wait_aligned(pg, 'annotations: page 2'); assert 'Page 2' in where(pg), where(pg)
    assert pg.is_visible('.ct-atools') and pg.locator('.ct-atools button[data-t]').count() == 4
    def anns(): return pg.evaluate("BookWorkspace.tab.annList(1)")
    def svgbox(sel='#pane_main .ct-ann svg'): return pg.locator(sel).bounding_box()
    def pt(fx, fy):
        b = svgbox(); return b['x'] + fx * b['width'], b['y'] + fy * b['height']
    assert anns() == [] and pg.locator('#pane_main .ct-ann svg [data-id]').count() == 0
    pg.click('.ct-atools [data-t=ellipse]'); assert pg.get_attribute('.ct-atools [data-t=ellipse]', 'aria-pressed') == 'true'
    pg.mouse.move(*pt(0.20, 0.20)); pg.mouse.down(); pg.mouse.move(*pt(0.30, 0.25)); pg.mouse.move(*pt(0.40, 0.30)); pg.mouse.up(); pg.wait_for_timeout(200)
    a = anns(); assert len(a) == 1 and a[0]['t'] == 'ellipse', a
    assert abs(a[0]['x'] - 0.20) < 0.02 and abs(a[0]['y'] - 0.20) < 0.02 and abs(a[0]['w'] - 0.20) < 0.02 and abs(a[0]['h'] - 0.10) < 0.02, a   # stored as fractions of the picture
    assert pg.get_attribute('.ct-atools [data-t=select]', 'aria-pressed') == 'true', 'after drawing: back to the select tool'
    assert pg.is_visible('.ct-annocard') and 'Circle' in pg.inner_text('.ct-annocard') and 'Drawn with A-Test and B-Test' in pg.inner_text('.ct-annocard')
    assert pg.evaluate("document.activeElement && document.activeElement.id") == 'ct_annText', 'the comment box is ready for typing'
    pg.keyboard.type('Owner added a mark?'); assert anns()[0]['text'] == 'Owner added a mark?'
    assert pg.locator('#pane_o1 .ct-ann svg ellipse').count() == 1 and pg.locator('#pane_o2 .ct-ann svg ellipse').count() == 1, 'shown on copy 1 and copy 2 as well'
    assert pg.locator('#pane_o1 .ct-ann svg [data-id]').count() == 0, 'but only changed on the superimposed picture'
    pg.screenshot(path=SHOTS + '/annot1.png') if SHOTS else None
    pg.keyboard.press('Escape'); assert pg.locator('.ct-annocard').count() == 0, 'Escape closes the comment box'
    pg.click('.ct-atools [data-t=rect]'); pg.mouse.click(*pt(0.65, 0.55)); pg.wait_for_timeout(200)      # a click without dragging: a rectangle of a usual size
    a = anns(); assert len(a) == 2 and a[1]['t'] == 'rect' and a[1]['w'] > 0.03 and a[1]['h'] > 0.02, a
    pg.keyboard.press('Escape')
    pg.click('.ct-atools [data-t=note]'); pg.mouse.click(*pt(0.30, 0.70)); pg.wait_for_timeout(200)
    a = anns(); assert len(a) == 3 and a[2]['t'] == 'note' and abs(a[2]['x'] - 0.30) < 0.02, a
    assert 'Text note' in pg.inner_text('.ct-annocard')
    pg.click('#ct_acol'); assert pg.locator('#ct_apal button').count() == 6
    pg.click('#ct_apal button[data-c="3"]'); assert pg.is_hidden('#ct_apal')
    assert anns()[2]['col'] == 3, 'the colour of the selected annotation changes with it'
    pg.keyboard.type('x') if False else None
    pg.screenshot(path=SHOTS + '/annot2.png') if SHOTS else None
    # move: drag the rectangle; resize: drag its corner handle
    before = anns()[1]; cx, cy = pt(before['x'] + before['w'] / 2, before['y'] + before['h'] / 2)
    pg.mouse.move(cx, cy); pg.mouse.down(); pg.mouse.move(cx + 20, cy + 10); pg.mouse.move(cx + 40, cy + 20); pg.mouse.up(); pg.wait_for_timeout(200)
    after = anns()[1]; assert after['x'] > before['x'] + 0.005 and after['y'] > before['y'] + 0.005 and abs(after['w'] - before['w']) < 1e-6, (before, after)
    hb = pg.locator('#pane_main .ct-ann svg [data-h=se]').bounding_box(); hx, hy = hb['x'] + hb['width'] / 2, hb['y'] + hb['height'] / 2
    pg.mouse.move(hx, hy); pg.mouse.down(); pg.mouse.move(hx + 15, hy + 15); pg.mouse.move(hx + 30, hy + 30); pg.mouse.up(); pg.wait_for_timeout(200)
    grown = anns()[1]; assert grown['w'] > after['w'] + 0.005 and grown['h'] > after['h'] + 0.005 and abs(grown['x'] - after['x']) < 1e-6, (after, grown)
    assert 'Page 2' in where(pg) and pg.locator('#ct_list li[data-i="1"] svg.ct-an').count() == 1, 'the page list shows that this page has annotations'
    # delete (key), hide (eye), other pages show none
    pg.keyboard.press('Delete'); assert len(anns()) == 2 and pg.locator('.ct-annocard').count() == 0
    pg.click('#ct_aeye'); assert pg.locator('#pane_main .ct-ann svg *').count() == 0 and pg.locator('#pane_o1 .ct-ann svg *').count() == 0, 'hidden everywhere'
    pg.click('#ct_aeye'); assert pg.locator('#pane_main .ct-ann svg [data-id]').count() == 2
    pg.click('#ct_next'); wait_aligned(pg, 'annotations: next page'); assert pg.locator('#pane_main .ct-ann svg [data-id]').count() == 0 and pg.locator('#ct_list li[data-i="2"] svg.ct-an').count() == 0
    pg.click('#ct_prev'); wait_aligned(pg, 'annotations: back'); assert pg.locator('#pane_main .ct-ann svg [data-id]').count() == 2, 'they belong to the page'
    # another pair of copies: the annotations of the page are there too (and say that their position can be a little off)
    pg.select_option('#ct_c2', label='C-Test'); wait_aligned(pg, 'annotations: pair A + C'); assert pg.locator('#pane_main .ct-ann svg [data-id]').count() == 2
    pg.click('#pane_main .ct-ann svg ellipse[data-id]'); assert 'a little off' in pg.inner_text('.ct-annocard'), pg.inner_text('.ct-annocard')
    assert pg.input_value('#ct_annText') == 'Owner added a mark?'
    pg.keyboard.press('Escape') if False else None
    pg.select_option('#ct_c2', label='B-Test'); wait_aligned(pg, 'annotations: back to A + B')
    # the Pages view can undo what was done (the colour change of the note was the last step before the move, the move, the resize, the delete)
    pg.click('#ct_tab_pages'); pg.wait_for_timeout(500)
    pg.locator('#ws-vp').focus() if pg.locator('#ws-vp').count() else None
    pg.keyboard.press('Control+z'); pg.wait_for_timeout(300); assert len(anns()) == 3, 'undo: the deleted annotation is back'
    pg.keyboard.press('Control+Shift+z'); pg.wait_for_timeout(300); assert len(anns()) == 2
    pg.locator('#ws .ws-lbl[data-r="1"]').first.click(); pg.wait_for_timeout(300); pg.click('#ws-compare'); wait_aligned(pg, 'annotations: back from the pages')
    assert pg.locator('#pane_main .ct-ann svg [data-id]').count() == 2
    # ---------------------------------------------------------------- focus mode
    def row_now(): return pg.evaluate("BookWorkspace.tab.state().row")
    wait_aligned(pg, 'focus mode start'); assert row_now() == 1
    h0 = pg.locator('#pane_main').bounding_box()
    assert pg.is_visible('#ct_focusbtn') and pg.is_visible('.ct-top') and pg.is_visible('#ct_list') and pg.is_visible('#ct_prev') and pg.is_visible('#back')
    pg.click('#ct_focusbtn'); pg.wait_for_timeout(500)
    for sel in ('.ct-top', '#ct_list', '#ct_prev', '#ct_flag', '#ct_map', '#back', '.ct-side'):
        assert not pg.is_visible(sel), 'focus mode hides ' + sel
    assert pg.is_visible('.ct-leave') and pg.is_visible('#pane_main') and pg.is_visible('#pane_o1') and pg.is_visible('#pane_o2') and pg.is_visible('.ct-atools'), 'the pictures and the annotation tools stay'
    h1 = pg.locator('#pane_main').bounding_box(); assert h1['height'] > h0['height'] + 60 and h1['x'] < 5 and h1['y'] < 5, (h0, h1)      # the pictures got the room
    assert pg.is_visible('.ct-toast') and 'Focus mode' in pg.inner_text('.ct-toast')
    pg.keyboard.press('ArrowRight'); wait_aligned(pg, 'focus: key right'); assert row_now() == 2
    assert 'Page 3' in pg.inner_text('.ct-toast'), pg.inner_text('.ct-toast')
    pg.keyboard.press('f'); assert pg.evaluate("BookWorkspace.tab.rowInfo(2).flag") == 0 and 'flagged' in pg.inner_text('.ct-toast'), pg.inner_text('.ct-toast')
    pg.keyboard.press('f'); assert pg.evaluate("BookWorkspace.tab.rowInfo(2).flag") is None
    pg.keyboard.press('ArrowLeft'); wait_aligned(pg, 'focus: key left'); assert row_now() == 1 and 'Page 2' in pg.inner_text('.ct-toast') and 'flagged' in pg.inner_text('.ct-toast')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(500)
    assert pg.is_visible('.ct-top') and pg.is_visible('#ct_list') and pg.is_visible('#ct_prev') and pg.is_visible('#back') and not pg.is_visible('.ct-leave'), 'Esc brings everything back'
    h2 = pg.locator('#pane_main').bounding_box(); assert abs(h2['height'] - h0['height']) < 3, (h0, h2)
    pg.click('#ct_focusbtn'); pg.wait_for_timeout(300); pg.click('.ct-leave'); pg.wait_for_timeout(400); assert pg.is_visible('.ct-top') and not pg.is_visible('.ct-leave'), 'the Leave button works too'
    pg.click('#ct_focusbtn'); pg.wait_for_timeout(300); pg.evaluate("CompareTab.leave()"); pg.wait_for_timeout(400)       # leaving the tab ends focus mode
    assert not pg.evaluate("document.getElementById('ws').hidden")
    pg.locator('#ws .ws-lbl[data-r="1"]').first.click(); pg.wait_for_timeout(300); pg.click('#ws-compare'); wait_aligned(pg, 'focus: back from the pages')
    assert pg.is_visible('.ct-top') and pg.is_visible('#ct_list') and pg.is_visible('#back'), 'Compare opens normally again'
    # the Pages tab and back: the same pair and row are shown again without aligning anew
    pg.click('#ct_tab_pages'); pg.wait_for_timeout(500)
    assert not pg.evaluate("document.getElementById('ws').hidden"), 'Pages layer visible'
    assert pg.locator('#ws .ws-hname').count() == 3
    pg.click('#ws-compare'); pg.wait_for_timeout(700)
    assert pg.is_visible('.ct-top') and not pg.is_visible('.ct-busy'), 'same pair and row: shown at once'
    # the Back button of the teal bar also returns to the pages
    pg.click('#back'); pg.wait_for_timeout(500); assert not pg.evaluate("document.getElementById('ws').hidden")
    c.close(); stop_helper()
    print('  %s: ok' % kind)

try:
    with sync_playwright() as p:
        for kind in os.environ.get('BOOKCOMPARE_BROWSERS', 'chromium,firefox').split(','):
            scenario(p, kind)
    assert BEFORE == snapshot(), 'scan folders must be unchanged'
    assert not errs, errs
    print('ALL COMPARE TAB TESTS PASSED')
finally:
    stop_helper(); shutil.rmtree(TMP, ignore_errors=True)
