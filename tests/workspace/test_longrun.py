"""Long run of the background alignment (item 38): a whole "book" of many pages, in the desktop program's scan reader.

Two copies of PAGES pages each are made from the app's sample pages (every page a little shifted, turned and darker or lighter,
so that no two pages are the same file). The copy B is aligned onto the reference A in the background with two helpers, the way the
owner would do it for a real book. Checked:
 * every page is aligned and stored (0.12.0: inside the project file, one record per page), nothing fails;
 * the helpers are replaced after 40 pages each (MAX_JOBS, they give their memory back), and the run still finishes;
 * the time per page does not grow during the run (the last pages are not much slower than the first ones);
 * the scan folders are unchanged afterwards (read only).
It takes several minutes (about PAGES x 4 s on two cores). Run:  python3 tests/workspace/test_longrun.py   (BOOKCOMPARE_LONGRUN_PAGES=120 for more)
"""
import hashlib, json, os, random, shutil, subprocess, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); import common
try:
    from PIL import Image, ImageEnhance
except ImportError:
    print('SKIPPED: Pillow is not installed'); sys.exit(0)

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
PORT = int(os.environ.get('BOOKCOMPARE_HELPER_PORT', '8797'))
BASE = 'http://localhost:%d' % PORT
PAGES = int(os.environ.get('BOOKCOMPARE_LONGRUN_PAGES', '90'))
if not shutil.which('node'):
    print('SKIPPED: Node is not installed'); sys.exit(0)

TMP = os.path.realpath(tempfile.mkdtemp(prefix='bc_long_'))
BOOKS = os.path.join(TMP, 'Books'); DATA = os.path.join(TMP, 'data'); PICKS = os.path.join(TMP, 'picks.txt')
PROJ = os.path.join(BOOKS, 'Project'); RES = os.path.join(PROJ, 'Long book.bookcompare results')
for d in (BOOKS, DATA, PROJ, os.path.join(BOOKS, 'Copy-A'), os.path.join(BOOKS, 'Copy-B')): os.makedirs(d)
open(PICKS, 'w').close()
U = os.path.join(REPO, 'app', 'images', 'usecases')
SRC = [('book/case2-traherne2-a-original.jpg', 'book/case2-traherne2-b-original.jpg'), ('music/case5-music-sheet-1.jpg', 'music/case5-music-sheet-2.jpg')]
rnd = random.Random(7)
def variant(src, dst):
    im = Image.open(os.path.join(U, src)).convert('RGB')
    w, h = im.size; k = 1400 / max(w, h); im = im.resize((int(w * k), int(h * k)))        # (smaller than real scans: the test is about the long run)
    im = im.rotate(rnd.uniform(-0.6, 0.6), expand=False, fillcolor=(235, 228, 210), translate=(rnd.randint(-12, 12), rnd.randint(-12, 12)))
    im = ImageEnhance.Brightness(im).enhance(rnd.uniform(0.93, 1.05))
    im.save(dst, quality=88)
for i in range(PAGES):
    a, b = SRC[i % len(SRC)]
    variant(a, os.path.join(BOOKS, 'Copy-A', 'p%03d.jpg' % (i + 1)))
    variant(b, os.path.join(BOOKS, 'Copy-B', 'p%03d.jpg' % (i + 1)))
def snapshot():
    out = {}
    for dp, dn, fn in os.walk(BOOKS):
        if os.path.relpath(dp, BOOKS).split(os.sep)[0] == 'Project': continue
        for f in fn:
            p = os.path.join(dp, f); st = os.stat(p); out[os.path.relpath(p, BOOKS)] = (st.st_size, st.st_mtime_ns, hashlib.sha1(open(p, 'rb').read()).hexdigest())
    return out
BEFORE = snapshot()
errs = []
proc = subprocess.Popen(['node', os.path.join(REPO, 'desktop', 'server.js'), '--port', str(PORT), '--data-dir', DATA, '--test-pick-file', PICKS], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
def push_pick(path):
    with open(PICKS, 'a', encoding='utf-8') as f: f.write(path + '\n')
def strip(pg): return pg.inner_text('#ws-bg') if pg.is_visible('#ws-bg') else ''

try:
    for _ in range(80):
        try:
            if json.load(urllib.request.urlopen(BASE + '/api/ping', timeout=1)).get('app') == 'BookCompare': break
        except Exception: time.sleep(0.25)
    with sync_playwright() as p:
        b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1400, 'height': 860})
        pg.on('pageerror', lambda e: errs.append('PAGEERROR ' + str(e)))
        pg.on('console', lambda m: errs.append('CONSOLE ' + m.text) if m.type == 'error' and '/api/' not in (m.location or {}).get('url', '') else None)
        pg.goto(BASE + '/index.html'); pg.wait_for_timeout(1200); pg.click('#books_btn'); pg.wait_for_timeout(900)
        for folder, name in (('Copy-A', 'A-Ref'), ('Copy-B', 'B-Test')):
            push_pick(os.path.join(BOOKS, folder))
            pg.click('#ws .ws-tb[data-act=add]' if pg.locator('#ws .ws-tb[data-act=add]').count() else '#ws .ws-addbtn'); pg.wait_for_timeout(200)
            pg.click('#ac-folder'); pg.wait_for_timeout(900); pg.fill('#ac-name', name); pg.click('#ac-ok'); pg.wait_for_timeout(900)
        A, B = pg.evaluate("BookWorkspace.tab.copyList().map(c => c.id)")
        push_pick(os.path.join(PROJ, 'Long book.bookcompare')); pg.click('#ws-more'); pg.click('[data-m=save]'); pg.wait_for_timeout(1500)
        pg.evaluate("BookWorkspace.tab.setBgRun(null)")
        # the reference, then the run with two helpers
        pg.click('#ws-more'); pg.click('[data-m=ref]'); pg.wait_for_selector('#rf-ok'); pg.check('input[name=ws-ref][value="%d"]' % A); pg.click('#rf-ok'); pg.wait_for_timeout(800)
        pg.click('#ws-more'); pg.click('[data-m=bg]'); pg.wait_for_timeout(500)
        if pg.locator('#ws-scrim input[name=bg-n][value="2"]').count(): pg.check('#ws-scrim input[name=bg-n][value="2"]')
        t0 = time.time(); pg.click('#bg-go')
        marks = []                                                          # (seconds, pages through) while it runs
        while True:
            pg.wait_for_timeout(2000)
            st = pg.evaluate("BCBackground.state()")
            if st: marks.append((time.time() - t0, st['done'] + st['skipped'] + st['failed']))
            if st and st.get('warn'): pg.click('#ws-bg [data-bg=ignore]')     # (a mismatch pause would stop the run; these pages all match)
            if st and st['finished']: break
            if time.time() - t0 > PAGES * 30: raise AssertionError('the run did not finish: %r | %s' % (st, strip(pg)))
        took = time.time() - t0
        assert st['done'] == PAGES and st['failed'] == 0, st
        # 0.12.0: every page is stored INSIDE the project file (common.read_pack), and there is no results folder
        pk = common.read_pack(os.path.join(PROJ, 'Long book.bookcompare'))
        for _ in range(40):
            if len(pk['moves']) == PAGES: break
            time.sleep(0.25); pk = common.read_pack(os.path.join(PROJ, 'Long book.bookcompare'))
        assert len(pk['moves']) == PAGES and len(pk['bins']) == PAGES and not os.path.exists(RES), (len(pk['moves']), len(pk['bins']))
        print('  project file: %.1f MB for %d stored pages' % (pk['size'] / 1048576, PAGES))
        # the speed does not fall off: pages per second in the last third against the first third (after the start)
        def rate(lo, hi):
            pts = [m for m in marks if lo <= m[1] <= hi]
            return (pts[-1][1] - pts[0][1]) / max(0.1, pts[-1][0] - pts[0][0]) if len(pts) >= 2 else None
        r1, r3 = rate(PAGES * 0.1, PAGES * 0.4), rate(PAGES * 0.6, PAGES * 0.95)
        print('  %d pages in %.0f s (%.1f s a page with two helpers); pages per second early %.2f, late %.2f' % (PAGES, took, took / PAGES, r1 or 0, r3 or 0))
        if r1 and r3: assert r3 > r1 * 0.6, ('the run slows down', r1, r3)
        assert not pg.evaluate("BookWorkspace.tab.state()") is None
        b.close()
    assert BEFORE == snapshot(), 'scan folders must be unchanged'
    assert not errs, errs
    print('LONG RUN TEST PASSED')
finally:
    try: urllib.request.urlopen(urllib.request.Request(BASE + '/api/quit', data=b'', method='POST', headers={'X-BookCompare': '1'}), timeout=3)
    except Exception: pass
    try: proc.wait(timeout=6)
    except Exception: proc.kill()
    shutil.rmtree(TMP, ignore_errors=True)
