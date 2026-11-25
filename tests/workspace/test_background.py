"""Automatic test of the reference copy (V7), the background alignment (V8, V9) and the stored alignments (V10).

It uses the desktop program's scan reader (desktop/server.js) with REAL folders on disk and the sample pictures that come with the app
(app/images/usecases), in a temporary folder - never your own scans. Checked (Chromium; BOOKCOMPARE_BROWSERS=chromium,firefox for both):
  * the project is saved as a file; More > Reference copy … proposes a copy, the choice gets a star in the heading, is saved, can be undone;
    where the reference copy has no page, the first copy from the left that has one stands in
  * More > Align copies in the background …: the strip shows how far it is; a page whose ink has no partner (two different pages in one row)
    pauses it with a warning, "Go to the page" selects that page, "Continue, do not ask again" goes on; at the end every pair is stored
    in "<project>.bookcompare results" (index.json + one file per pair); started again, everything is skipped
  * the Compare tab shows a pair with the reference from the stored movement (no aligning), aligns any other pair directly and prepares
    the next page meanwhile (then shown from memory); a changed tile setting is aligned again and replaces the stored one
  * the printed area (V2b): shown on the pictures, a corner dragged on the superimposed picture, aligned again at once, saved for that scan,
    used again when coming back to the page, "Back to automatic"
  * the scan folders are never changed
Run:  python3 tests/workspace/test_background.py   (needs Node)
"""
import hashlib, json, os, shutil, subprocess, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); import common

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
PORT = int(os.environ.get('BOOKCOMPARE_HELPER_PORT', '8796'))
BASE = 'http://localhost:%d' % PORT
if not shutil.which('node'):
    print('SKIPPED: Node is not installed'); sys.exit(0)

TMP = os.path.realpath(tempfile.mkdtemp(prefix='bc_bg_'))
BOOKS = os.path.join(TMP, 'Books'); DATA = os.path.join(TMP, 'data'); PICKS = os.path.join(TMP, 'picks.txt')
for d in (BOOKS, DATA, os.path.join(BOOKS, 'Project')): os.makedirs(d)
open(PICKS, 'w').close()
U = os.path.join(REPO, 'app', 'images', 'usecases')
TRA = ('book/case2-traherne2-a-original.jpg', 'book/case2-traherne2-b-original.jpg')
MUS = ('music/case5-music-sheet-1.jpg', 'music/case5-music-sheet-2.jpg')
def put(folder, n, src):
    os.makedirs(os.path.join(BOOKS, folder), exist_ok=True); shutil.copy(os.path.join(U, src), os.path.join(BOOKS, folder, 'p%d.jpg' % n))
put('Copy-A', 1, TRA[0]); put('Copy-A', 2, TRA[0])                 # A: the reference (the sample page twice)
put('Copy-B', 1, TRA[1]); put('Copy-B', 2, TRA[1])                 # B: the same pages in another copy
put('Copy-C', 1, MUS[1]); put('Copy-C', 2, TRA[1])                 # C: a wrong page in row 1 (music against text)
errs = []
PROJ = os.path.join(BOOKS, 'Project'); RES = os.path.join(PROJ, 'Test book.bookcompare results')

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
    proc = subprocess.Popen(['node', os.path.join(REPO, 'desktop', 'server.js'), '--port', str(PORT), '--data-dir', DATA, '--test-pick-file', PICKS], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(80):
        try:
            if json.load(urllib.request.urlopen(BASE + '/api/ping', timeout=1)).get('app') == 'BookCompare': return
        except Exception: time.sleep(0.25)
    raise SystemExit('the scan reader did not start')
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
def menu(pg, m): pg.click('#ws-more'); pg.click('[data-m=%s]' % m); pg.wait_for_timeout(500)
def pack(): return common.read_pack(os.path.join(PROJ, 'Test book.bookcompare'))     # 0.12.0: the stored alignments are inside the project file
def project(): return pack()['project']
def strip(pg): return pg.inner_text('#ws-bg') if pg.is_visible('#ws-bg') else ''
def wait_strip(pg, words, secs=240):
    for _ in range(secs * 2):
        pg.wait_for_timeout(500)
        t = strip(pg)
        if any(w in t for w in words): return t
    raise AssertionError('the strip did not show %s: %r | %s' % (words, strip(pg), errs))
def wait_aligned(pg, why, secs=120):
    for _ in range(secs * 4):
        pg.wait_for_timeout(250)
        if pg.evaluate("!document.querySelector('.ct-busy').offsetParent && !document.querySelector('div.result_container').classList.contains('ct-stale')"): return
        if pg.locator('.ct-busy.bad:visible').count(): raise AssertionError(why + ': ' + pg.inner_text('.ct-busy'))
    raise AssertionError(why + ': the alignment did not finish. ' + pg.inner_text('.ct-busy'))
def index(): return {'entries': pack()['moves']}
def wait_index(n, secs=20):
    for _ in range(secs * 4):
        try:
            if len(index()['entries']) >= n: return index()
        except Exception: pass
        time.sleep(0.25)
    raise AssertionError('the project file did not get %d stored alignments' % n)

def scenario(p, kind):
    shutil.rmtree(RES, ignore_errors=True)
    for f in os.listdir(PROJ): os.remove(os.path.join(PROJ, f))
    c = getattr(p, kind).launch(); pg = c.new_page(viewport={'width': 1500, 'height': 900})
    pg.on('pageerror', lambda e: errs.append(kind + ' PAGEERROR ' + str(e)))
    pg.on('console', lambda m: errs.append(kind + ' CONSOLE ' + m.text) if m.type == 'error' and '/api/' not in (m.location or {}).get('url', '') else None)
    start_helper(); open_workspace(pg)
    add_copy(pg, 'Copy-A', 'A-Ref'); add_copy(pg, 'Copy-B', 'B-Test'); add_copy(pg, 'Copy-C', 'C-Test')
    assert pg.locator('#ws .ws-hname').count() == 3
    ids = pg.evaluate("BookWorkspace.tab.copyList().map(c => c.id)"); A, B, C = ids
    # --- before anything is set up, the background alignment asks for a saved project and a reference copy ----------------------------
    menu(pg, 'bg'); assert 'Save the project first' in pg.inner_text('#ws-scrim'), pg.inner_text('#ws-scrim')
    push_pick(os.path.join(PROJ, 'Test book.bookcompare')); pg.click('#bg-save'); pg.wait_for_timeout(1500)
    assert os.path.exists(os.path.join(PROJ, 'Test book.bookcompare')) and 'Choose the reference copy first' in pg.inner_text('#ws-scrim'), pg.inner_text('#ws-scrim')
    # --- the reference copy: proposed, chosen, starred, saved, undone -----------------------------------------------------------------
    pg.click('#bg-ref'); pg.wait_for_selector('#rf-ok'); dlg = pg.inner_text('#ws-scrim')
    assert 'Reference copy' in dlg and '(proposed' in dlg and 'C-Test · 2 pages' in dlg, dlg
    pg.check('input[name=ws-ref][value="%d"]' % A); pg.click('#rf-ok'); pg.wait_for_timeout(1500)
    assert pg.evaluate("BookWorkspace.tab.refCopy()") == A and project().get('ref') == A, project().get('ref')
    assert pg.locator('#ws .ws-hcell[data-c="0"] .ws-star').count() == 1 and pg.locator('#ws .ws-star').count() == 1
    pg.keyboard.press('Control+z'); pg.wait_for_timeout(300); assert pg.evaluate("BookWorkspace.tab.refCopy()") is None and pg.locator('#ws .ws-star').count() == 0
    pg.keyboard.press('Control+y'); pg.wait_for_timeout(1500); assert pg.evaluate("BookWorkspace.tab.refCopy()") == A
    assert pg.evaluate("[0, 1].map(r => BookWorkspace.tab.refFor(r))") == [A, A]
    # --- the background alignment: started, paused on the page with two different pages, continued, finished ----------------------------
    menu(pg, 'bg'); dlg = pg.inner_text('#ws-scrim')
    assert 'B-Test' in dlg and 'C-Test' in dlg and 'A-Ref' in dlg and 'helper' in dlg, dlg
    assert pg.locator('#ws-scrim .bg-copy').count() == 2, 'the reference itself is not offered'
    pg.click('#bg-go'); pg.wait_for_timeout(800)
    t = wait_strip(pg, ['Aligning in the background', 'Paused', 'finished'], 30)
    if os.environ.get('BOOKCOMPARE_SHOTS'): pg.wait_for_timeout(3000); pg.screenshot(path=os.path.join(os.environ['BOOKCOMPARE_SHOTS'], 'background-strip.png'))
    t = wait_strip(pg, ['Paused:', 'finished'])
    assert 'Paused:' in t and 'has no partner' in t and 'C-Test' in t, t
    if os.environ.get('BOOKCOMPARE_SHOTS'): pg.screenshot(path=os.path.join(os.environ['BOOKCOMPARE_SHOTS'], 'background-paused.png'))
    pg.click('#ws-bg [data-bg=goto]'); pg.wait_for_timeout(500)
    sel = pg.evaluate("[document.querySelector('#ws .ws-cell.sel') && document.querySelector('#ws .ws-cell.sel').dataset.c, document.querySelector('#ws .ws-cell.sel') && document.querySelector('#ws .ws-cell.sel').dataset.r]")
    assert sel[0] == '2', ('Go to the page selects the cell of C-Test', sel)
    pg.click('#ws-bg [data-bg=ignore]')
    t = wait_strip(pg, ['finished'])
    assert '4 pages aligned' in t, t
    idx = wait_index(4)
    names = sorted(pack()['bins'])
    assert len(names) == 4 and sorted(idx['entries']) == names and not os.path.exists(RES), (names, sorted(idx['entries']), 'no results folder any more')
    assert all(e['c0'] == A and e['c1'] in (B, C) for e in idx['entries'].values()), idx['entries']
    assert max(e['u'] for e in idx['entries'].values() if e['c1'] == C) > 0.3, 'the mismatched page is stored with its share of ink without partner'
    sizes = list(pack()['bins'].values()); assert all(5000 < s < 3000000 for s in sizes), sizes
    pg.click('#ws-bg [data-bg=close]'); pg.wait_for_timeout(200); assert not pg.is_visible('#ws-bg')
    # started again: everything is stored already
    menu(pg, 'bg'); pg.click('#bg-go'); t = wait_strip(pg, ['finished'], 60)
    assert '0 pages aligned' in t and '4 already stored' in t, t
    pg.click('#ws-bg [data-bg=close]')
    # item 21: a small dot in every stored cell, and how many pages of a copy are aligned, in its heading
    for _ in range(20):
        if pg.locator('#ws .ws-st').count() == 4: break
        pg.wait_for_timeout(250)
    assert pg.locator('#ws .ws-st').count() == 4, pg.locator('#ws .ws-st').count()
    assert '2 aligned' in pg.inner_text('#ws .ws-hcell[data-c="1"] .ws-hmeta') and 'aligned' not in pg.inner_text('#ws .ws-hcell[data-c="0"] .ws-hmeta')
    # item 29: a scan with another date but the same content (copied to another computer): the stored results still fit
    fb = os.path.join(BOOKS, 'Copy-B', 'p1.jpg'); st0 = os.stat(fb); os.utime(fb, ns=(st0.st_atime_ns, st0.st_mtime_ns + 10 * 86400 * 10**9))
    try:
        menu(pg, 'bg'); pg.click('#bg-go'); t = wait_strip(pg, ['finished'], 60)
        assert '0 pages aligned' in t and '4 already stored' in t, ('a new date alone does not make a stored result stale', t)
    finally: os.utime(fb, ns=(st0.st_atime_ns, st0.st_mtime_ns))
    pg.click('#ws-bg [data-bg=close]'); pg.wait_for_timeout(1300)
    assert project().get('bgRun') is None, 'a finished run is not remembered'
    # item 21: a run that did not finish is offered again (here: as if the program had been closed during the run)
    pg.evaluate("BookWorkspace.tab.setBgRun({ ids: [%d], n: 1 })" % B); pg.wait_for_timeout(1300); assert project().get('bgRun') == {'ids': [B], 'n': 1}
    pg.evaluate("BCBackground.offer({ ids: [%d], n: 1 })" % B); pg.wait_for_timeout(200)
    assert 'not finished' in pg.inner_text('#ws-bg') and 'B-Test' in pg.inner_text('#ws-bg'), pg.inner_text('#ws-bg')
    pg.click('#ws-bg [data-bg=resume]'); t = wait_strip(pg, ['finished'], 60); assert '2 already stored' in t, t
    pg.click('#ws-bg [data-bg=close]'); pg.wait_for_timeout(1300); assert project().get('bgRun') is None
    # --- the Compare tab: reference pair from the stored movement; another pair directly, the next page prepared meanwhile ----------------
    pg.locator('#ws .ws-lbl[data-r="0"]').first.click(); pg.wait_for_timeout(300)
    t0 = time.time(); pg.click('#ws-compare'); wait_aligned(pg, 'reference pair'); took = time.time() - t0
    lt = pg.evaluate("CompareTab.lastTiles()"); assert lt and lt.get('stored') is True and lt['w'] > 100, lt
    print('  %s: reference pair shown from the stored movement in %.1f s' % (kind, took))
    # the help text on what cannot be seen (B5)
    # (0.11.0: in the help dialog of the "?" button)
    pg.click('#ct_helpbtn'); pg.wait_for_timeout(300)
    assert not pg.is_visible('#ct_help li'); pg.click('#ct_help summary'); pg.wait_for_timeout(200)
    assert 'Lighter inks' in pg.inner_text('#ct_help') and 'Small shifts' in pg.inner_text('#ct_help')
    pg.click('#ws-float [data-close]'); pg.wait_for_timeout(300)
    if pg.get_attribute('#ct_alhead', 'aria-expanded') != 'true': pg.click('#ct_alhead'); pg.wait_for_timeout(150)      # the folded section "Alignment of this page"
    pg.select_option('#ct_c1', label='B-Test'); pg.wait_for_timeout(300); pg.select_option('#ct_c2', label='C-Test'); wait_aligned(pg, 'B against C')
    lt = pg.evaluate("CompareTab.lastTiles()"); assert not lt.get('stored'), 'B against C is not a pair with the reference: aligned directly'
    for _ in range(240):
        pg.wait_for_timeout(500)
        pr = pg.evaluate("CompareTab.prepared()")
        if pr['busy'] is None and pr['cached'] >= 1: break
    assert pr['cached'] >= 1, ('the next page should have been prepared', pr)
    pg.click('#ct_next'); wait_aligned(pg, 'prepared page')
    lt = pg.evaluate("CompareTab.lastTiles()"); assert lt.get('stored') is True, ('the prepared page is shown without aligning', lt)
    assert len(index()['entries']) == 4, 'pairs without the reference are not stored on disk'
    # a changed tile setting: the stored result no longer fits, the page is aligned again and stored anew
    pg.select_option('#ct_c1', label='A-Ref'); pg.wait_for_timeout(300); pg.select_option('#ct_c2', label='B-Test'); wait_aligned(pg, 'A against B, page 2')
    assert pg.evaluate("CompareTab.lastTiles()").get('stored') is True
    pg.click('#ct_tiles button[data-tp=stiff]'); wait_aligned(pg, 'stiffer')
    assert not pg.evaluate("CompareTab.lastTiles()").get('stored'), 'a changed setting is aligned again'
    def settings():
        for _ in range(40):
            v = [e['valid'].split('|')[-1] for e in index()['entries'].values()]
            if len(v) == 4: return sorted(v)
            time.sleep(0.25)
        return sorted(v)
    for _ in range(40):
        if settings() == ['8x2', 'std', 'std', 'std']: break
        time.sleep(0.25)
    assert settings() == ['8x2', 'std', 'std', 'std'], ('one file per pair of scans: it now holds the stiffer alignment', settings())
    pg.click('#ct_tiles button[data-tp=std]'); wait_aligned(pg, 'standard again')
    assert not pg.evaluate("CompareTab.lastTiles()").get('stored'), 'back to the standard setting: aligned again'
    for _ in range(40):
        if settings() == ['std'] * 4: break
        time.sleep(0.25)
    assert settings() == ['std'] * 4, settings()
    pg.click('#ct_prev'); wait_aligned(pg, 'page 1 again'); assert pg.evaluate("CompareTab.lastTiles()").get('stored') is True
    # --- the printed area (V2b): shown on the pictures, a corner dragged, aligned again at once, saved for the scan; back to automatic ---
    assert not pg.is_visible('#pane_main .ct-qbox')
    pg.check('#ct_box'); pg.wait_for_timeout(400)
    assert pg.is_visible('#pane_main .ct-qbox') and pg.locator('#pane_main .ct-qbox circle[data-h]').count() == 4 and pg.locator('#pane_o1 .ct-qbox circle').count() == 0
    lt = pg.evaluate("CompareTab.lastTiles()"); q0 = pg.evaluate("CompareBox.quad()")
    assert lt.get('box') and q0 == [lt['box'][0], lt['box'][1], lt['box'][2], lt['box'][1], lt['box'][2], lt['box'][3], lt['box'][0], lt['box'][3]], (lt.get('box'), q0)
    assert 'Found automatically' in pg.inner_text('#ct_boxnote') and not pg.is_visible('#ct_boxauto')
    hb = pg.locator('#pane_main .ct-qbox circle[data-h="0"]').bounding_box(); sv = pg.locator('#pane_main .ct-qbox svg').bounding_box()
    cx, cy = hb['x'] + hb['width'] / 2, hb['y'] + hb['height'] / 2
    pg.mouse.move(cx, cy); pg.mouse.down(); pg.mouse.move(cx + sv['width'] * 0.05, cy + sv['height'] * 0.03, steps=6); pg.mouse.up()
    wait_aligned(pg, 'after a corner was moved')
    lt = pg.evaluate("CompareTab.lastTiles()")
    assert lt.get('quad') and not lt.get('stored'), ('aligned again with the shape', lt.get('quad'), lt.get('stored'))
    assert abs(lt['quad'][0] - (q0[0] + 0.05)) < 0.02 and abs(lt['quad'][1] - (q0[1] + 0.03)) < 0.02 and lt['quad'][2:] == [round(v, 4) for v in q0[2:]], (q0, lt['quad'])
    for _ in range(20):
        bx = project().get('boxes') or {}
        if bx: break
        time.sleep(0.25)
    assert list(bx.keys()) == ['%d|p1.jpg' % A] and bx['%d|p1.jpg' % A] == lt['quad'], bx
    assert pg.is_visible('#ct_boxauto') and 'Set by hand' in pg.inner_text('#ct_boxnote')
    if os.environ.get('BOOKCOMPARE_SHOTS'): pg.screenshot(path=os.path.join(os.environ['BOOKCOMPARE_SHOTS'], 'printed-area.png'))
    pg.click('#ct_next'); wait_aligned(pg, 'page 2 has its own (automatic) area'); assert not pg.evaluate("CompareTab.lastTiles()").get('quad')
    pg.click('#ct_prev'); wait_aligned(pg, 'page 1 with the shape'); lt = pg.evaluate("CompareTab.lastTiles()"); assert lt.get('quad') and lt.get('stored') is True, 'the result with the shape was stored'
    pg.click('#ct_boxauto'); wait_aligned(pg, 'back to automatic')
    assert not pg.evaluate("CompareTab.lastTiles()").get('quad') and not pg.is_visible('#ct_boxauto')
    for _ in range(20):
        if not project().get('boxes'): break
        time.sleep(0.25)
    assert not project().get('boxes'), project().get('boxes')
    pg.uncheck('#ct_box'); pg.wait_for_timeout(200); assert not pg.is_visible('#pane_main .ct-qbox')
    # --- item 28: how much is stored, and removing what is no longer needed ------------------------------------------------------------
    pg.click('#ct_tab_pages'); pg.wait_for_timeout(500)
    menu(pg, 'stored'); dlg = pg.inner_text('#ws-scrim')
    assert '4 pages stored' in dlg and 'still needed' in dlg and 'MB' in dlg, dlg
    pg.click('#ws-scrim [data-close]')
    pg.locator('#ws .ws-cell[data-c="1"][data-r="1"]').click(); pg.click('#ws-toolbar [data-act=del]'); pg.wait_for_timeout(1500)    # p2 of B-Test leaves the grid
    menu(pg, 'stored'); dlg = pg.inner_text('#ws-scrim'); assert '1 of them is no longer needed' in dlg, dlg
    pg.click('#st-prune'); pg.wait_for_timeout(800)
    pk = pack(); assert len(pk['moves']) == 3 and len(pk['bins']) == 3, sorted(pk['moves'])
    c.close(); stop_helper()
    print('  %s: ok' % kind)

try:
    with sync_playwright() as p:
        for kind in os.environ.get('BOOKCOMPARE_BROWSERS', 'chromium').split(','):
            scenario(p, kind)
    assert BEFORE == snapshot(), 'scan folders must be unchanged'
    assert not errs, errs
    print('ALL BACKGROUND ALIGNMENT TESTS PASSED')
finally:
    stop_helper()
    shutil.rmtree(TMP, ignore_errors=True)
