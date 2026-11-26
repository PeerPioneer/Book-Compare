"""Automatic test of the Compare tab (app/js/compare-tab.js) with the real alignment engine of the app.

It uses the desktop program's scan reader (desktop/server.js) with REAL folders on disk and the sample pictures that come with the app
(app/images/usecases): three copies "A", "B", "C" (C has only two pages), made in a temporary folder - never your own scans.
Checked, in Chromium and Firefox:
  COMPARE opens the Compare tab and aligns the pair by itself; next/previous page, keys, copy menus, swap, the page list and its
  search, skipping pages that a copy lacks, PAGES tab and back, flags (button, colours, key F, list filter, shown in the Pages grid,
  undo), the book map (opens near the pointer, picture of the page, click to jump, grey ticks, pin), focus mode (hides everything but the pictures, keys work, Esc/Leave button),
  and that the scan folders are never changed.

Run:  python3 tests/workspace/test_compare_tab.py   (needs Node)
"""
import hashlib, json, os, shutil, subprocess, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
PORT = int(os.environ.get('BOOKCOMPARE_HELPER_PORT', '8795'))
BASE = 'http://localhost:%d' % PORT
if not shutil.which('node'):
    print('SKIPPED: Node is not installed'); sys.exit(0)

TMP = os.path.realpath(tempfile.mkdtemp(prefix='bc_ctab_'))
BOOKS = os.path.join(TMP, 'Books'); DATA = os.path.join(TMP, 'data'); PICKS = os.path.join(TMP, 'picks.txt')
for d in (BOOKS, DATA, os.path.join(BOOKS, 'Project')): os.makedirs(d)
open(PICKS, 'w').close()
U = os.path.join(REPO, 'app', 'images', 'usecases')
PAIRS = [('book/case2-traherne2-a-original.jpg', 'book/case2-traherne2-b-original.jpg'),
         ('music/case5-music-sheet-1.jpg', 'music/case5-music-sheet-2.jpg'),
         ('../../../tests/workspace/fixtures/case3-churchill-1.jpg', '../../../tests/workspace/fixtures/case3-churchill-2.jpg'),     # (photos, kept for the tests only:
         ('../../../tests/workspace/fixtures/giovanni-1.jpg', '../../../tests/workspace/fixtures/giovanni-2.jpg')]                 #  the examples leave them out, 0.11.0)
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
    args = ['node', os.path.join(REPO, 'desktop', 'server.js'), '--port', str(PORT), '--data-dir', DATA, '--test-pick-file', PICKS]
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
    # 0.15.0 (owner): a new project numbers its rows as folios (1r, 1v ...); this test uses pagination (Page 1, Page 2 ...)
    assert pg.locator('#ws .ws-lbl[data-r="0"] b').inner_text() == '1r', pg.locator('#ws .ws-lbl[data-r="0"] b').inner_text()
    pg.click('#ws-more'); pg.click('#ws-menu [data-m=folio]'); pg.wait_for_timeout(200)
    assert pg.locator('#ws .ws-lbl[data-r="0"] b').inner_text() == 'Page 1'
    # COMPARE opens the Compare tab and aligns by itself
    pg.locator('#ws .ws-lbl[data-r="0"]').first.click(); pg.wait_for_timeout(300)
    pg.click('#ws-compare'); wait_aligned(pg, 'first pair')
    assert pg.evaluate("document.getElementById('ws').hidden"), 'the Pages layer should be hidden'
    assert pg.is_visible('.ct-top') and pg.is_visible('#ct_list'), 'tabs and left panel'
    assert 'Page 1' in where(pg) and 'position 1 of 4' in where(pg), where(pg)
    assert pg.evaluate("document.getElementById('ct_c1').selectedOptions[0].text") == 'A-Test' and pg.evaluate("document.getElementById('ct_c2').selectedOptions[0].text") == 'B-Test'
    labs = labels(pg); assert any('A-Test' in l for l in labs) and any('B-Test' in l for l in labs), labs
    # item 7: copy 1 and copy 2 are folded away at first; the strip opens them, "Fold away" closes them (remembered)
    assert pg.is_visible('#pane_main') and not pg.is_visible('#pane_o1') and not pg.is_visible('#pane_o2') and pg.is_visible('#fold_strip'), 'the two small panels start folded'
    w0 = pg.locator('#pane_main').bounding_box()['width']
    pg.click('#fold_strip'); pg.wait_for_timeout(400)
    assert pg.is_visible('#pane_o1') and pg.is_visible('#pane_o2') and pg.is_visible('#fold_btn') and not pg.is_visible('#fold_strip')
    assert pg.locator('#pane_main').bounding_box()['width'] < w0 - 100 and pg.evaluate("localStorage.getItem('bookcompare_side_panels')") == 'open'
    pg.click('#fold_btn'); pg.wait_for_timeout(400); assert not pg.is_visible('#pane_o1') and pg.evaluate("localStorage.getItem('bookcompare_side_panels')") == 'folded'
    # item 2: no burger; a handle on the edge of the left panel folds it away and back
    assert pg.inner_text('#ct_sidebtn').strip() == '\u2039' and pg.is_visible('.ct-side')
    pg.click('#ct_sidebtn'); pg.wait_for_timeout(300); assert not pg.is_visible('.ct-side') and pg.inner_text('#ct_sidebtn').strip() == '\u203a' and pg.locator('#ct_sidebtn').bounding_box()['x'] <= 10      # (0.14.0: beside the slim line that is left of the panel)
    pg.click('#ct_sidebtn'); pg.wait_for_timeout(300); assert pg.is_visible('.ct-side')
    assert pg.evaluate("document.querySelector('#result canvas').width") > 100, 'the superimposed picture should be drawn'
    # the tile alignment (V3) is the default: it runs in the background helper and sends copy 2 back bent onto copy 1, as big as copy 1
    assert pg.locator('#ct_tf').count() == 0 and pg.locator('#ct_rough').count() == 0 and pg.locator('#ct_swap').count() == 0, '0.11.0: no type menu, no "Without fine alignment", no Swap'
    t = pg.evaluate("CompareTab.lastTiles()"); assert t and t['w'] > 100 and t['unmatched_tiles'] is not None, t
    assert pg.evaluate("document.querySelector('#result canvas').width") == t['w'], 'the result is as big as copy 1'
    # next page by the button, then by the key, then back
    pg.click('#ct_next'); wait_aligned(pg, 'next page'); assert 'Page 2' in where(pg), where(pg)
    t = pg.evaluate("CompareTab.lastTiles()"); assert t['unmatched_tiles'] <= t['unmatched_rough'] + 0.01, ('music page: the tiles do not make it worse', t)
    # option C (0.11.0): the alignment of this page is one folded section; its head names the setting
    assert pg.get_attribute('#ct_alhead', 'aria-expanded') == 'false' and not pg.is_visible('#ct_albody') and pg.inner_text('#ct_alval') == 'Standard'
    lh0 = pg.locator('#ct_list').bounding_box()['height']
    pg.click('#ct_alhead'); pg.wait_for_timeout(150)
    assert pg.get_attribute('#ct_alhead', 'aria-expanded') == 'true' and pg.is_visible('#ct_albody')
    lh1 = pg.locator('#ct_list').bounding_box()['height']; assert lh1 <= lh0 and lh1 >= 140, ('the page list gets the height the sections leave, at least 150 px (the panel scrolls when needed)', lh0, lh1)
    # the names of the two copies stand on the colours of the Superimposed view (blue / red by default; 0.15.0)
    assert pg.evaluate("getComputedStyle(document.querySelector('.ct-copy.c1 .ct-cname')).backgroundColor") == 'rgb(0, 70, 200)'
    assert pg.evaluate("getComputedStyle(document.querySelector('.ct-copy.c2 .ct-cname')).backgroundColor") == 'rgb(230, 0, 0)'
    # "Paper" (0.11.0; 0.14.0: in the options of the Superimposed view in the left panel): a copy's paper whiter, display only, kept in the project
    assert not pg.is_visible('#legend_paper') and not pg.is_visible('#legend_colors'), 'no buttons in the legend over the picture any more'
    pg.click('#ct_vhead'); pg.wait_for_timeout(350)                                    # (the View section is folded at first, 0.15.0)
    pg.click('#ct_paper'); pg.wait_for_timeout(300)
    assert pg.locator('#ws-float .ct-prow').count() == 2 and 'B-Test' in pg.inner_text('#ws-float .ws-dlg')
    c2id = pg.evaluate("BookWorkspace.tab.state().pair[1]")
    pg.click('#ws-float .ct-seg[data-k="1"] button[data-v="1"]'); pg.wait_for_timeout(300)
    assert pg.evaluate("BookWorkspace.tab.paper(%d)" % c2id) == 1 and pg.evaluate("window.BC_PAPER") == [0, 0.5]
    pg.click('#ws-float .ct-seg[data-k="1"] button[data-v="0"]'); pg.wait_for_timeout(300)
    assert pg.evaluate("BookWorkspace.tab.paper(%d)" % c2id) == 0 and pg.evaluate("window.BC_PAPER") == [0, 0]
    pg.click('#ws-float [data-close]'); pg.wait_for_timeout(200)
    pg.click('#ct_vhead'); pg.wait_for_timeout(350)                                    # (folded again)
    # tile settings for copy 2 on this page (V15): presets, advanced numbers, saved per copy and page, back to standard
    def tset(): return pg.evaluate("(() => { const s = BookWorkspace.tab.state(); return BookWorkspace.tab.tileSetting(s.row, s.pair[1]); })()")
    assert pg.is_visible('#ct_tiles') and pg.get_attribute('#ct_tiles button[data-tp=std]', 'aria-pressed') == 'true' and tset() is None
    pg.click('#ct_tiles button[data-tp=flex]'); wait_aligned(pg, 'more flexible')
    assert tset() == {'main': 8, 'sub': 4} and 'real differences' in pg.inner_text('#ct_tnote'), (tset(), pg.inner_text('#ct_tnote'))
    assert pg.inner_text('#ct_alval') == 'Flexible', pg.inner_text('#ct_alval')
    pg.click('#ct_tiles button[data-tp=stiff]'); wait_aligned(pg, 'stiffer')
    assert tset() == {'main': 8, 'sub': 2} and 'real differences' not in pg.inner_text('#ct_tnote')
    pg.click('#ct_tadvbtn'); pg.fill('#ct_tmain', '12'); pg.fill('#ct_tsub', '2'); pg.click('#ct_tapply'); wait_aligned(pg, 'advanced')
    assert tset() == {'main': 12, 'sub': 2} and '12 main tiles' in pg.inner_text('#ct_tnote'), pg.inner_text('#ct_tnote')
    pg.click('#ct_next'); wait_aligned(pg, 'next page, own setting'); assert tset() is None, 'the setting belongs to one page only'
    pg.click('#ct_prev'); wait_aligned(pg, 'back'); assert tset() == {'main': 12, 'sub': 2}
    pg.click('#ct_tiles button[data-tp=std]'); wait_aligned(pg, 'standard again'); assert tset() is None and pg.inner_text('#ct_tnote') == ''
    # what the fine alignment did (V16): movement map over the picture, the rough alignment alone and back; the mismatch warning (V18)
    t = pg.evaluate("CompareTab.lastTiles()"); m = t['movement']
    assert m and m['w'] > 50 and m['h'] > 50 and m['max'] >= 0, m
    pg.check('#ct_mv'); pg.wait_for_timeout(200)
    assert pg.is_visible('#pane_main .ct-mv') and pg.is_visible('#ct_mvleg'), 'movement map and legend shown'
    pg.screenshot(path=SHOTS + '/movement.png') if SHOTS else None
    pg.uncheck('#ct_mv'); pg.wait_for_timeout(100); assert not pg.is_visible('#pane_main .ct-mv')
    assert pg.is_visible('#ct_warn') == (t['unmatched_tiles'] > 0.30), ('mismatch warning only above 30 %', t['unmatched_tiles'])
    assert pg.is_visible('#ct_hint') == bool(m.get('hint')), 'the shift hint appears exactly when the engine reports one'
    pg.click('#ct_c1'); pg.keyboard.press('Escape'); pg.locator('body').click(position={'x': 700, 'y': 450}) if False else None
    pg.evaluate("document.activeElement && document.activeElement.blur()")
    pg.keyboard.press('PageDown'); wait_aligned(pg, 'key page down'); assert 'Page 3' in where(pg), where(pg)
    pg.keyboard.press('PageUp'); pg.keyboard.press('PageUp'); wait_aligned(pg, 'key page up x2'); assert 'Page 1' in where(pg), where(pg)
    # the arrow keys no longer turn pages or change copies (they move the picture, as in the base app)
    for k in ('ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown'): pg.keyboard.press(k)
    pg.wait_for_timeout(500)
    assert 'Page 1' in where(pg) and pg.evaluate("document.getElementById('ct_c1').selectedOptions[0].text") == 'A-Test' and pg.evaluate("document.getElementById('ct_c2').selectedOptions[0].text") == 'B-Test', 'arrow keys leave page and copies alone'
    pg.click('#ct_prev'); assert 'first page to compare' in pg.inner_text('.ct-toast'), 'no page before the first'
    # the page list: click a row, search
    pg.fill('#ct_q', '4'); assert pg.locator('#ct_list li[data-i]').count() == 1, pg.inner_text('#ct_list')
    pg.click('#ct_list li[data-i="3"]'); wait_aligned(pg, 'list click'); assert 'Page 4' in where(pg), where(pg)
    pg.fill('#ct_q', ''); assert pg.locator('#ct_list li[data-i]').count() == 4
    # item 6a (0.15.0: without the ‹ › buttons): the keys , and . step through the copies as copy 2 (copy 1 is left out); then copy 2 = C (has only two pages): rows 3 and 4 are marked, and "next" skips them
    assert pg.locator('#ct_c2up, #ct_c2dn').count() == 0, 'no ‹ › beside the copies'
    assert pg.inner_text('#ct_c1n') == 'A-Test' and pg.inner_text('#ct_c2n') == 'B-Test', 'the names of the copies are shown on their colours'
    nb = pg.locator('#ct_c2n').bounding_box(); ab = pg.locator('.ct-copy.c2 .ct-carr').bounding_box(); assert 0 <= ab['x'] - (nb['x'] + nb['width']) <= 10, ('the menu arrow right next to the name', nb, ab)
    bg = pg.evaluate("getComputedStyle(document.querySelector('.ct-copy.c1 .ct-cname')).backgroundColor"); assert bg == 'rgb(0, 70, 200)', ('copy 1 on its colour', bg)
    assert pg.evaluate("getComputedStyle(document.querySelector('.ct-copy.c1 .ct-cname')).color") == 'rgb(255, 255, 255)', 'white letters on the dark blue'
    pg.evaluate("document.activeElement && document.activeElement.blur()")
    pg.keyboard.press('.'); pg.wait_for_timeout(300); assert pg.evaluate("document.getElementById('ct_c2').selectedOptions[0].text") == 'C-Test', 'key . = next copy'
    pg.keyboard.press(','); wait_aligned(pg, 'key , back to B'); assert pg.evaluate("document.getElementById('ct_c2').selectedOptions[0].text") == 'B-Test'
    pg.select_option('#ct_c2', label='C-Test'); pg.wait_for_selector('.ct-busy.bad:visible', timeout=20000)
    assert 'C-Test has no page' in pg.inner_text('.ct-busy'), pg.inner_text('.ct-busy')      # page 4 does not exist in copy C
    assert pg.locator('#ct_list li.miss').count() == 2, pg.locator('#ct_list li.miss').count()
    pg.click('#ct_list li[data-i="0"]'); wait_aligned(pg, 'row 1 with C'); pg.click('#ct_next'); wait_aligned(pg, 'row 2 with C'); assert 'Page 2' in where(pg), where(pg)
    pg.click('#ct_next'); assert 'last page to compare' in pg.inner_text('.ct-toast'), 'rows 3 and 4 lack a page in C: skipped'
    assert pg.locator('#ct_skip').count() == 0, '0.16.0: no tick box - pages one copy lacks are always skipped'
    # copy 2: the up arrow button of the panel goes back to B (there are no keys for switching copies any more)
    pg.click('#ct_list li[data-i="0"]'); wait_aligned(pg, 'row 1 again')
    pg.select_option('#ct_c2', label='B-Test'); wait_aligned(pg, 'copy 2 back to B'); assert pg.evaluate("document.getElementById('ct_c2').selectedOptions[0].text") == 'B-Test' and pg.inner_text('#ct_c2n') == 'B-Test'
    # ---------------------------------------------------------------- 0.14.0 (owner, idea F): no teal bar; views, link and navigation in the left panel
    def vis(sel): return pg.evaluate("(s) => { const e = document.querySelector(s); return !!e && e.offsetParent !== null && getComputedStyle(e).visibility !== 'hidden'; }", sel)
    assert pg.evaluate("[...document.querySelectorAll('#compare_screen > footer .bar')].filter(b => b.offsetParent !== null).length") == 0, 'no teal bar below the pictures'
    assert not vis('#back') and not vis('#compare') and not vis('#visualisation_select') and not vis('#link_toggle') and not vis('#more'), 'no Back button, no old menus or buttons in the Compare tab'
    side = pg.locator('.ct-side').bounding_box(); nav = pg.locator('#ct_nav').bounding_box()
    for sel in ('#ct_prev', '#ct_next', '#ct_flag', '#ct_where'):
        bb = pg.locator(sel).bounding_box()
        assert bb['x'] >= side['x'] - 1 and bb['x'] + bb['width'] <= side['x'] + side['width'] + 1 and bb['y'] >= nav['y'] - 1, (sel, 'the page navigation is at the bottom of the left panel', bb, nav)
    vp = pg.viewport_size
    assert abs(nav['y'] + nav['height'] - (pg.locator('#ct_map').bounding_box()['y'])) <= 2 or nav['y'] + nav['height'] >= vp['height'] - 30, ('pinned to the bottom', nav)
    assert pg.evaluate("getComputedStyle(document.querySelector('#ct_where b')).fontWeight") == '700', 'the page name is bold'
    fb = pg.locator('#ct_flag').bounding_box(); nb = pg.locator('#ct_next').bounding_box(); assert 0 <= fb['x'] - (nb['x'] + nb['width']) <= 12 and fb['width'] <= 26, ('the flag: small, next to ›', fb, nb)
    # the View section: six radio buttons; the options of the chosen view only
    assert pg.get_attribute('#ct_vhead', 'aria-expanded') == 'false' and pg.inner_text('#ct_vval') == 'Superimposed', 'View is folded at first (0.15.0)'
    pg.click('#ct_vhead'); pg.wait_for_timeout(350); assert pg.get_attribute('#ct_vhead', 'aria-expanded') == 'true'
    assert [t.strip() for t in pg.locator('#ct_vlist .ct-vrow .nm').all_inner_texts()] == ['Superimposed', 'Toggle', 'Top and bottom', 'Left and right', 'Copy 1', 'Copy 2']
    assert pg.get_attribute('#ct_v_diff', 'aria-checked') == 'true' and pg.locator('#ct_vlist [role=radio][aria-checked=true]').count() == 1
    assert pg.get_attribute('#ct_v_onlyimage1', 'title') == 'A-Test' and pg.get_attribute('#ct_v_onlyimage2', 'title') == 'B-Test', 'the tip of Copy 1 / Copy 2 is the name the owner gave the copy'
    def optH(v): return pg.evaluate("(v) => document.querySelector('#ct_vo_' + v).getBoundingClientRect().height", v)
    assert vis('#ct_colors') and vis('#ct_paper') and optH('toggle') < 1 and optH('onlyimage2') < 1, 'only the options of the chosen view are open'
    sq = pg.evaluate("[...document.querySelectorAll('#ct_colors rect')].map(r => r.getAttribute('fill').toLowerCase())"); assert sq == ['#e60000', '#0046c8'], ('the colour squares: copy 2 behind, copy 1 in front', sq)
    pg.click('#ct_v_toggle'); pg.wait_for_timeout(450)
    assert pg.inner_text('#ct_vval') == 'Toggle' and pg.get_attribute('#ct_v_toggle', 'aria-checked') == 'true' and optH('diff') < 1 and optH('toggle') > 20, 'Toggle chosen: its speed unfolds, the Superimposed options fold away'
    # 0.16.0 (owner): no label over the toggling picture; the name of the copy on screen lights up in the left panel, in turn
    assert not pg.is_visible('#pane_main .pane__label'), 'no "Toggle" label over the picture'
    seen = set()
    for _ in range(16):
        pg.wait_for_timeout(110)
        lit = pg.evaluate("[...document.querySelectorAll('.ct-side.ct-toggling .ct-copy.lit')].map(e => e.classList.contains('c1') ? 1 : 2)")
        assert len(lit) == 1, lit; seen.add(lit[0])
    assert seen == {1, 2}, ('copy 1 and copy 2 light up in turn', seen)
    assert pg.get_attribute('#ct_speed button[data-sp="2"]', 'aria-pressed') == 'true'
    pg.click('#ct_speed button[data-sp="4"]'); pg.wait_for_timeout(150)
    assert pg.evaluate("document.querySelector('#toggle button.mdc-tab.active').dataset.speed") == '4' and pg.get_attribute('#ct_speed button[data-sp="4"]', 'aria-pressed') == 'true', 'Fast'
    pg.click('#ct_speed button[data-sp="2"]'); pg.wait_for_timeout(100)
    pg.keyboard.press('3'); pg.wait_for_timeout(300); assert pg.inner_text('#ct_vval') == 'Top and bottom', 'key 3 = Top and bottom'
    assert pg.locator('.ct-side.ct-toggling').count() == 0 and pg.locator('.ct-copy.lit').count() == 0, 'the names are lit only while toggling'
    assert not pg.is_visible('#pane_o1 .pane__label') and not pg.is_visible('#pane_o2 .pane__label'), '0.16.0: no labels over the two pictures'
    pg.keyboard.press('5'); pg.wait_for_timeout(450); assert pg.inner_text('#ct_vval') == 'Copy 1', 'key 5 = only copy 1'
    assert vis('#o1_note') and optH('onlyimage2') < 1, 'copy 1 is never changed: a note instead of the switch'
    assert not pg.is_visible('#pane_o1 .pane__label'), '0.16.0: no label over the picture'
    # N1: in the Copy 2 view, Aligned | Original scan (under its name in the panel)
    pg.keyboard.press('6'); pg.wait_for_timeout(450); assert pg.inner_text('#ct_vval') == 'Copy 2' and vis('#o2_switch') and optH('onlyimage1') < 1
    assert not pg.is_visible('#pane_o2 .pane__label') and pg.get_attribute('#o2_switch button[data-o2=aligned]', 'aria-pressed') == 'true'
    px_al = pg.evaluate("(() => { const c = document.querySelector('#pane_o2 canvas'); return [c.width, c.height, c.toDataURL().length]; })()")
    pg.click('#o2_switch button[data-o2=original]'); pg.wait_for_timeout(400)
    px_or = pg.evaluate("(() => { const c = document.querySelector('#pane_o2 canvas'); return [c.width, c.height, c.toDataURL().length]; })()")
    assert px_or[:2] == px_al[:2] and px_or[2] != px_al[2] and pg.evaluate("BCCopy2View.original()"), ('the original scan is drawn into the same frame', px_al, px_or)
    pg.keyboard.press('3'); pg.wait_for_timeout(400); assert not pg.evaluate("BCCopy2View.original()"), 'other views always show copy 2 aligned'
    pg.keyboard.press('6'); pg.wait_for_timeout(400); assert pg.evaluate("BCCopy2View.original()"), 'the choice is kept for the Copy 2 view'
    pg.click('#o2_switch button[data-o2=aligned]'); pg.wait_for_timeout(300)
    pg.click('#ct_v_diff'); pg.wait_for_timeout(300); assert pg.inner_text('#ct_vval') == 'Superimposed'
    # the link of the panels: a button with the link symbol, crossed out when the panels move on their own
    assert pg.get_attribute('#ct_link', 'aria-pressed') == 'true' and 'Zoom and move all panels together' in pg.inner_text('#ct_link') and pg.evaluate("BCLink.linked()")
    assert pg.evaluate("getComputedStyle(document.querySelector('#ct_link .ct-linkx')).opacity") == '0'
    assert pg.evaluate("getComputedStyle(document.querySelector('#ct_link')).backgroundColor") in ('rgba(0, 0, 0, 0)', 'transparent'), '0.16.0: no coloured background, the symbol says it'
    pg.click('#ct_link'); pg.wait_for_timeout(300)
    assert pg.get_attribute('#ct_link', 'aria-pressed') == 'false' and not pg.evaluate("BCLink.linked()") and pg.evaluate("getComputedStyle(document.querySelector('#ct_link .ct-linkx')).opacity") == '1', 'unlinked: the symbol is crossed out'
    pg.click('#ct_link'); pg.wait_for_timeout(250); assert pg.evaluate("BCLink.linked()")
    # the View section folds too, and is remembered
    pg.click('#ct_vhead'); pg.wait_for_timeout(350); assert pg.get_attribute('#ct_vhead', 'aria-expanded') == 'false' and pg.locator('#ct_vbody').bounding_box()['height'] < 2
    pg.click('#ct_vhead'); pg.wait_for_timeout(350); assert pg.get_attribute('#ct_vhead', 'aria-expanded') == 'true'
    # the panel folded away: a slim line with the tab, and the navigation stays as a small card in the bottom left corner
    pg.click('#ct_sidebtn'); pg.wait_for_timeout(500)
    assert not vis('.ct-side') and vis('.ct-sline') and pg.locator('.ct-sline').bounding_box()['width'] <= 10, 'a slim line is left of the panel'
    assert vis('#ct_prev') and vis('#ct_next') and vis('#ct_flag') and vis('#ct_where') and 'folded' in pg.get_attribute('#ct_nav', 'class')
    nav2 = pg.locator('#ct_nav').bounding_box(); assert nav2['x'] <= 1 and nav2['width'] <= 110 and nav2['y'] > vp['height'] / 2, ('a small card at the bottom left', nav2)
    assert pg.locator('#workspace').bounding_box()['x'] <= 10, 'the pictures get the width'
    pg.click('#ct_next'); wait_aligned(pg, 'next page with the panel folded'); pg.click('#ct_prev'); wait_aligned(pg, 'back')
    pg.click('#ct_sidebtn'); pg.wait_for_timeout(400); assert vis('.ct-side') and not vis('.ct-sline') and 'folded' not in pg.get_attribute('#ct_nav', 'class')
    # the colour note of the Superimposed view names the copies the way the grid does (not "image 1" / "image 2")
    wait_aligned(pg, 'difference again')
    assert not pg.is_visible('#pane_main .pane__label'), 'no colour legend over the superimposed picture (0.15.0: the names stand on their colours in the left panel)'
    # the one menu (⋮ in the top bar): Project, Export and Help; the export entries work here; Escape closes it
    pg.click('#ct_more'); pg.wait_for_timeout(300)
    heads = [t.strip().upper() for t in pg.locator('#ws-fmenu .ws-mhead').all_inner_texts()]
    assert heads == ['PROJECT', 'EXPORT', 'FONT', 'HELP'], heads
    assert all(pg.locator('#ws-fmenu [data-m=%s]' % m_).count() == 0 for m_ in ('ref', 'bg', 'help', 'speed')), '0.16.0: no reference copy, background, "How … works" or speed test entries'
    assert pg.locator('#ws-fmenu [data-m=x-view]').is_enabled() and pg.locator('#ws-fmenu [data-m=save]').count() == 1 and pg.locator('#ws-fmenu [data-m=about]').count() == 1
    mb = pg.locator('#ws-fmenu .ws-menu').bounding_box()
    top_el = pg.evaluate("(p) => { const e = document.elementFromPoint(p[0], p[1]); return e ? (e.closest('#ws-fmenu') ? 'menu' : e.className) : 'none'; }", [mb['x'] + mb['width'] / 2, mb['y'] + mb['height'] - 6])
    assert top_el == 'menu', 'the menu is above everything: ' + str(top_el)
    pg.keyboard.press('Escape'); pg.wait_for_timeout(200); assert pg.locator('#ws-fmenu').count() == 0
    pg.click('#ct_more'); pg.wait_for_timeout(200); pg.click('#ws-fmenu [data-m=about]'); pg.wait_for_timeout(300)
    assert pg.is_visible('#ws-float .ws-dlg') and 'About Book Compare' in pg.inner_text('#ws-float .ws-dlg'), 'dialogs open over the Compare tab'
    pg.click('#ws-float [data-close]'); pg.wait_for_timeout(200); assert pg.locator('#ws-float').count() == 0
    pg.click('#ct_helpbtn'); pg.wait_for_timeout(300); assert 'Page Down' in pg.inner_text('#ws-float .ws-dlg'), 'the keys are in the help'
    pg.click('#ws-float [data-close]'); pg.wait_for_timeout(200)
    # 0.16.0 (owner): Roboto again by default; ⋮ → Font … offers three humanist, three geometric and three grotesque fonts (and Roboto and
    # EB Garamond), each shown in itself; the choice applies at once and is remembered on this computer
    ff = lambda sel: pg.evaluate("(s) => getComputedStyle(document.querySelector(s)).fontFamily", sel)
    assert not pg.evaluate("document.documentElement.hasAttribute('data-bcfont')") and 'Roboto' in ff('#ct_where b') and 'Garamond' not in ff('#ct_where b'), 'Roboto at first'
    pg.click('#ct_more'); pg.wait_for_timeout(200); assert 'now: Roboto' in pg.inner_text('#ws-fmenu [data-m=font]')
    pg.click('#ws-fmenu [data-m=font]'); pg.wait_for_selector('#ws-float .ws-fonts')
    opts = pg.evaluate("[...document.querySelectorAll('#ws-float input[name=ws-font]')].map(i => i.value)")
    assert opts == ['source-sans', 'fira-sans', 'alegreya-sans', 'figtree', 'dm-sans', 'jost', 'inter', 'public-sans', 'ibm-plex-sans', 'roboto', 'garamond'], opts
    assert pg.is_checked('#ws-float input[value=roboto]') and [t.strip().split(' · ')[0].upper() for t in pg.locator('#ws-float .ws-fghead').all_inner_texts()] == ['HUMANIST', 'GEOMETRIC', 'GROTESQUE', 'USED BEFORE IN BOOK COMPARE']
    fams = pg.evaluate("[...document.querySelectorAll('#ws-float .ws-fname')].map(e => getComputedStyle(e).fontFamily)")
    assert 'BC Jost' in fams[5] and 'BC Inter' in fams[6] and 'EB Garamond' in fams[10] and fams[9].startswith('Roboto'), fams
    pg.click('#ws-float input[value=inter]'); pg.wait_for_timeout(400)
    assert pg.evaluate("document.documentElement.getAttribute('data-bcfont')") == 'inter' and 'BC Inter' in ff('#ct_where b') and 'BC Inter' in ff('#ct_list li') and pg.evaluate("localStorage.getItem('bookcompare_font')") == 'inter'
    assert 'BC Jost' in pg.evaluate("getComputedStyle(document.querySelectorAll('#ws-float .ws-fname')[5]).fontFamily"), 'the names keep their own fonts'
    pg.wait_for_function("document.fonts.check('16px \"BC Inter\"')", timeout=10000)
    pg.click('#ws-float input[value=garamond]'); pg.wait_for_timeout(300); assert 'EB Garamond' in ff('#ct_where b')
    pg.click('#ws-float input[value=roboto]'); pg.wait_for_timeout(300)
    assert not pg.evaluate("document.documentElement.hasAttribute('data-bcfont')") and pg.evaluate("localStorage.getItem('bookcompare_font')") == 'roboto' and 'Roboto' in ff('#ct_where b')
    pg.click('#ws-float [data-close]'); pg.wait_for_timeout(200)
    pg.evaluate("document.documentElement.setAttribute('data-bcfont', 'figtree')")
    assert pg.evaluate("[...document.querySelectorAll('.material-icons')].every(e => getComputedStyle(e).fontFamily.indexOf('Material Icons') >= 0)"), 'the icons keep their font'
    pg.evaluate("document.documentElement.removeAttribute('data-bcfont')")
    # 0.16.0 (owner): the text of the program cannot be selected; the search field can
    assert pg.evaluate("getComputedStyle(document.querySelector('#ct_where b')).userSelect") == 'none' and pg.evaluate("getComputedStyle(document.querySelector('#ct_q')).userSelect") != 'none'
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
    # 0.11.0: the tools are folded behind the pen button in the zoom column of the superimposed picture, right above the "Scroll up" arrow
    assert pg.is_visible('#ct_pen') and not pg.is_visible('.ct-atools') and pg.get_attribute('#ct_pen', 'aria-expanded') == 'false'
    assert pg.evaluate("document.getElementById('ct_pen').nextElementSibling.title") == 'Scroll up'
    pg.click('#ct_pen'); pg.wait_for_timeout(150)
    assert pg.is_visible('.ct-atools') and pg.locator('.ct-atools button[data-t]').count() == 4 and pg.get_attribute('#ct_pen', 'aria-expanded') == 'true'
    pb = pg.locator('#ct_pen').bounding_box(); tb = pg.locator('.ct-atools').bounding_box()
    assert tb['x'] + tb['width'] <= pb['x'] + 2 and abs(tb['y'] - pb['y']) < 4, ('the tools stand to the left of the pen', pb, tb)
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
    pg.click('#fold_strip'); pg.wait_for_timeout(500)                                                          # (drawn there once the two small panels are open)
    assert pg.locator('#pane_o1 .ct-ann svg ellipse').count() == 1 and pg.locator('#pane_o2 .ct-ann svg ellipse').count() == 1, 'shown on copy 1 and copy 2 as well'
    assert pg.locator('#pane_o1 .ct-ann svg [data-id]').count() == 0, 'but only changed on the superimposed picture'
    pg.screenshot(path=SHOTS + '/annot1.png') if SHOTS else None
    pg.click('#fold_btn'); pg.wait_for_timeout(400)
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
    assert pg.is_visible('#ct_focusbtn') and pg.is_visible('.ct-top') and pg.is_visible('#ct_list') and pg.is_visible('#ct_prev') and pg.is_visible('#ct_vsec')
    pg.click('#ct_focusbtn'); pg.wait_for_timeout(500)
    for sel in ('.ct-top', '#ct_list', '#ct_prev', '#ct_flag', '#ct_map', '#ct_vsec', '.ct-side'):
        assert not pg.is_visible(sel), 'focus mode hides ' + sel
    assert pg.is_visible('.ct-leave') and pg.is_visible('#pane_main') and pg.is_visible('#fold_strip') and pg.is_visible('#ct_pen') and not pg.is_visible('#ct_sidebtn'), 'the pictures and the annotation tools stay'
    h1 = pg.locator('#pane_main').bounding_box(); assert h1['height'] > h0['height'] + 40 and h1['x'] < 5 and h1['y'] < 5, (h0, h1)      # the pictures got the room
    assert pg.is_visible('.ct-toast') and 'Focus mode' in pg.inner_text('.ct-toast')
    pg.keyboard.press('PageDown'); wait_aligned(pg, 'focus: key page down'); assert row_now() == 2
    assert 'Page 3' in pg.inner_text('.ct-toast'), pg.inner_text('.ct-toast')
    pg.keyboard.press('f'); assert pg.evaluate("BookWorkspace.tab.rowInfo(2).flag") == 0 and 'flagged' in pg.inner_text('.ct-toast'), pg.inner_text('.ct-toast')
    pg.keyboard.press('f'); assert pg.evaluate("BookWorkspace.tab.rowInfo(2).flag") is None
    pg.keyboard.press('PageUp'); wait_aligned(pg, 'focus: key page up'); assert row_now() == 1 and 'Page 2' in pg.inner_text('.ct-toast') and 'flagged' in pg.inner_text('.ct-toast')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(500)
    assert pg.is_visible('.ct-top') and pg.is_visible('#ct_list') and pg.is_visible('#ct_prev') and pg.is_visible('#ct_vsec') and not pg.is_visible('.ct-leave'), 'Esc brings everything back'
    h2 = pg.locator('#pane_main').bounding_box(); assert abs(h2['height'] - h0['height']) < 3, (h0, h2)
    pg.click('#ct_focusbtn'); pg.wait_for_timeout(300); pg.click('.ct-leave'); pg.wait_for_timeout(400); assert pg.is_visible('.ct-top') and not pg.is_visible('.ct-leave'), 'the Leave button works too'
    pg.click('#ct_focusbtn'); pg.wait_for_timeout(300); pg.evaluate("CompareTab.leave()"); pg.wait_for_timeout(400)       # leaving the tab ends focus mode
    assert not pg.evaluate("document.getElementById('ws').hidden")
    pg.locator('#ws .ws-lbl[data-r="1"]').first.click(); pg.wait_for_timeout(300); pg.click('#ws-compare'); wait_aligned(pg, 'focus: back from the pages')
    assert pg.is_visible('.ct-top') and pg.is_visible('#ct_list') and pg.is_visible('#ct_vsec'), 'Compare opens normally again'
    # the Pages tab and back: the same pair and row are shown again without aligning anew
    pg.click('#ct_tab_pages'); pg.wait_for_timeout(500)
    assert not pg.evaluate("document.getElementById('ws').hidden"), 'Pages layer visible'
    assert pg.locator('#ws .ws-hname').count() == 3
    pg.click('#ws-compare'); pg.wait_for_timeout(700)
    assert pg.is_visible('.ct-top') and not pg.is_visible('.ct-busy'), 'same pair and row: shown at once'
    # the teal bar has no Back button any more: the Pages tab is the way back
    assert not pg.is_visible('#back'), 'no Back button in the Compare tab'
    pg.click('#ct_tab_pages'); pg.wait_for_timeout(500); assert not pg.evaluate("document.getElementById('ws').hidden")
    # 0.16.0 (owner): no menu entry for the reference copy; opening the Compare tab without one explains it and offers to choose one, with
    # "Don't warn me again" for this project (automatic tests see this window only when they ask for it)
    pg.evaluate("window.BC_TEST_REFWARN = true"); pg.click('#ws-compare'); pg.wait_for_selector('#ws-float #rf-ok', timeout=10000)
    dlg = pg.inner_text('#ws-float .ws-dlg'); assert 'Choose a reference copy' in dlg and 'double-click' in dlg and '(proposed' in dlg and pg.is_visible('#rf-nowarn'), dlg
    pg.click('#rf-cancel'); pg.wait_for_timeout(300); assert pg.locator('#ws-float').count() == 0 and pg.evaluate("BookWorkspace.tab.refCopy()") is None
    pg.click('#ct_tab_pages'); pg.wait_for_timeout(400); pg.click('#ws-compare'); pg.wait_for_selector('#ws-float #rf-ok', timeout=10000)
    pg.check('#rf-nowarn'); pg.click('#rf-cancel'); pg.wait_for_timeout(300)
    pg.click('#ct_tab_pages'); pg.wait_for_timeout(400); pg.click('#ws-compare'); pg.wait_for_timeout(800)
    assert pg.locator('#ws-float .ws-dlg').count() == 0, '"Don\'t warn me again": no window'
    pg.evaluate("window.BC_TEST_REFWARN = false"); pg.click('#ct_tab_pages'); pg.wait_for_timeout(400)
    # item 20: a double-click on a cell compares that page with the reference copy (or, without one, with copy 1)
    pair0 = pg.evaluate("BookWorkspace.tab.state().pair"); third = [cc['id'] for cc in pg.evaluate("BookWorkspace.tab.state().copies") if cc['id'] not in pair0][0]
    ci3 = [cc['id'] for cc in pg.evaluate("BookWorkspace.tab.state().copies")].index(third)
    r3 = pg.evaluate("([a, c]) => { for (let r = 0; r < BookWorkspace.tab.rowCount(); r++) if (BookWorkspace.tab.cellKey(a, r) && BookWorkspace.tab.cellKey(c, r)) return r; return -1; }", [pair0[0], third])
    pg.evaluate("r => { const v = document.getElementById('ws-vp'); if (v) v.scrollTop = Math.max(0, r * 40 - 40); }", r3); pg.wait_for_timeout(200)
    pg.locator('#ws .ws-cell.filled[data-c="%d"][data-r="%d"]' % (ci3, r3)).dblclick(); wait_aligned(pg, 'double-click')
    st3 = pg.evaluate("BookWorkspace.tab.state()"); assert st3['pair'] == [pair0[0], third] and st3['row'] == r3 and pg.is_visible('#ct_list'), st3
    # 0.15.0 (owner): back in the Pages tab, the page shown in the Compare tab is selected (in the column of copy 1) and in view
    pg.evaluate("() => { const v = document.getElementById('ws-vp'); if (v) v.scrollTop = 0; }")
    pg.click('#ct_tab_pages'); pg.wait_for_timeout(400)
    ci1 = [cc['id'] for cc in pg.evaluate("BookWorkspace.tab.state().copies")].index(pair0[0])
    sel = pg.locator('#ws .ws-cell.sel'); assert sel.count() == 1 and sel.get_attribute('data-r') == str(r3) and sel.get_attribute('data-c') == str(ci1), (r3, ci1, sel.count() and sel.get_attribute('data-r'))
    vb = pg.locator('#ws-vp').bounding_box(); sb = sel.bounding_box(); assert sb['y'] >= vb['y'] - 1 and sb['y'] + sb['height'] <= vb['y'] + vb['height'] + 1, 'the selected page is in view'
    # 0.15.0 (owner): "New project" in the Compare tab goes to the (empty) Pages tab
    pg.locator('#ws .ws-cell.filled').first.dblclick(); wait_aligned(pg, 'compare again')
    pg.evaluate("BookWorkspace.tab && 0"); pg.click('#ct_more'); pg.wait_for_timeout(200); pg.click('#ws-fmenu [data-m=new]'); pg.wait_for_timeout(600)
    if pg.locator('#ws-float .ws-dlg, #ws-scrim .ws-dlg').count():                         # (unsaved changes: confirm)
        pg.locator('#ws-float .ws-dlg button.primary, #ws-scrim .ws-dlg button.primary').first.click(); pg.wait_for_timeout(600)
    assert not pg.evaluate("document.getElementById('ws').hidden") and not pg.evaluate("CompareTab.isOpen()"), 'the Pages tab is shown'
    assert pg.locator('#ws .ws-hname').count() == 0, 'and it is empty'
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
