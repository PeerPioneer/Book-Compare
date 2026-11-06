"""Automatic test of the Compare tab (app/js/compare-tab.js) with the real alignment engine of the app.

It uses the helper (launcher/serve.ps1) with REAL folders on disk and the sample pictures that come with the app
(app/images/usecases): three copies "A", "B", "C" (C has only two pages), made in a temporary folder - never your own scans.
Checked, in Chromium and Firefox:
  COMPARE opens the Compare tab and aligns the pair by itself; next/previous page, keys, copy menus, swap, the page list and its
  search, skipping pages that a copy lacks, PAGES tab and back, and that the scan folders are never changed.

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
