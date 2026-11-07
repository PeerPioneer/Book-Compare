"""Automatic test of the Book Compare helper (launcher/serve.ps1) together with the workspace in the page.

Everything here uses REAL folders on disk (made-up scans in a temporary folder, never your own folders):
  * the helper's file service: listing, reading pictures, saving the project file, and everything it must refuse
  * the workspace in helper mode, in Chromium AND Firefox: add copies, save the project in a folder that lies next to the copy folders,
    restart the helper and the browser, reopen the project - without a single permission question - compare a pair
  * a moved scan folder is found again with one folder choice
  * the scan folders are never changed

Needs PowerShell: pwsh (Linux/Mac) or powershell (Windows), or set PWSH. The Windows folder window itself can not be tested here
(the helper hands out folder paths from a list instead, see -TestPickFile).
Run:  python3 tests/workspace/test_helper.py
"""
import hashlib, json, os, re, shutil, subprocess, sys, tempfile, time, urllib.request, urllib.error
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
PORT = int(os.environ.get('BOOKCOMPARE_HELPER_PORT', '8794'))
BASE = 'http://localhost:%d' % PORT
PWSH = os.environ.get('PWSH') or shutil.which('pwsh') or shutil.which('powershell')
if not PWSH:
    print('SKIPPED: no PowerShell found (set PWSH)'); sys.exit(0)

TMP = os.path.realpath(tempfile.mkdtemp(prefix='bc_helper_'))       # (real path: on Windows the temp folder may be given in the short form RUNNER~1)
BOOKS = os.path.join(TMP, 'Bücher mit Leerzeichen')       # spaces and a non-ASCII letter on purpose
DATA = os.path.join(TMP, 'data'); PICKS = os.path.join(TMP, 'picks.txt')
for d in (BOOKS, DATA): os.makedirs(d)
open(PICKS, 'w').close()
errs = []

def make_scans():
    from PIL import Image, ImageDraw
    def scan(path, n, variant):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        im = Image.new('RGB', (900, 1250), (239, 230, 210)); d = ImageDraw.Draw(im)
        for i in range(6):
            y = 150 + i * 170
            for l in range(5): d.rectangle([90, y + l * 10, 810, y + l * 10 + 1], fill=(42, 38, 34))
            for j in range(12): d.ellipse([110 + j * 55 + (n * 7 + i + j) % 9, y + 40, 130 + j * 55 + (n * 7 + i + j) % 9, y + 56], fill=(42, 38, 34))
        d.text((380, 60), 'p%d v%d' % (n, variant), fill=(0, 0, 0))
        im.save(path, 'JPEG', quality=80)
    for i in range(1, 9): scan(os.path.join(BOOKS, 'Copy-A', 'Gesamtes Buch', 'scan_%03d.jpg' % i), i, 0)
    for i in (1, 2, 3, 10, 11, 12): scan(os.path.join(BOOKS, 'Copy-B ä', 'img_%d.JPG' % i), i, 1)
    for i in (1, 3, 5): scan(os.path.join(BOOKS, 'Copy-C', 'JPG-1', 'x_%d.jpg' % i), i, 2)
    for i in (2, 4, 6): scan(os.path.join(BOOKS, 'Copy-C', 'JPG-2', 'x_%d.jpg' % i), i, 2)
    os.makedirs(os.path.join(BOOKS, 'Project'))             # the project folder lies NEXT TO the copy folders
    open(os.path.join(BOOKS, 'Copy-A', 'notes.txt'), 'w').write('not a picture')
make_scans()

def snapshot():
    out = {}
    for dp, dn, fn in os.walk(BOOKS):
        if os.path.relpath(dp, BOOKS).split(os.sep)[0] == 'Project': continue
        for f in fn:
            p = os.path.join(dp, f); st = os.stat(p)
            out[os.path.relpath(p, BOOKS)] = (st.st_size, st.st_mtime_ns, hashlib.sha1(open(p, 'rb').read()).hexdigest())
    return out
BEFORE = snapshot()

# ------------------------------------------------------------------------------------------------------------ the helper
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

def call(method, path, headers=None, data=None):
    h = {'X-BookCompare': '1'} if method in ('POST', 'PUT') else {}
    h.update(headers or {})
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=h)
    try:
        r = urllib.request.urlopen(req, timeout=5); return r.status, r.read(), dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read(), dict(e.headers)
def jcall(method, path, obj=None, headers=None):
    st, body, hd = call(method, path, headers, json.dumps(obj).encode() if obj is not None else (b'' if method == 'POST' else None))
    try: return st, json.loads(body)
    except Exception: return st, body

def api_tests():
    st, j = jcall('GET', '/api/ping'); assert st == 200 and j['app'] == 'BookCompare'
    st, sc = jcall('POST', '/api/register', {'path': os.path.join(BOOKS, 'Copy-A'), 'kind': 'scans'}); assert st == 200 and sc['name'] == 'Copy-A'
    st, pr = jcall('POST', '/api/register', {'path': os.path.join(BOOKS, 'Project'), 'kind': 'project'}); assert st == 200
    q = lambda r, p: '?root=%s&path=%s' % (r['id'], urllib.request.quote(p))
    # letters like a-umlaut in folder names (Windows PowerShell 5.1 reads addresses with the old code page unless told otherwise)
    st, allb = jcall('POST', '/api/register', {'path': BOOKS, 'kind': 'scans'}); assert st == 200
    st, j = jcall('GET', '/api/list' + q(allb, 'Copy-B ä')); assert st == 200 and len(j['entries']) == 6, (st, j)
    # listing shows folders and pictures only
    st, j = jcall('GET', '/api/list' + q(sc, '')); names = sorted(e['n'] for e in j['entries'])
    assert st == 200 and names == ['Gesamtes Buch'], names
    st, j = jcall('GET', '/api/list' + q(sc, 'Gesamtes Buch')); assert len(j['entries']) == 8
    # a picture is delivered unchanged
    st, body, hd = call('GET', '/api/file' + q(sc, 'Gesamtes Buch/scan_001.jpg'))
    assert st == 200 and body == open(os.path.join(BOOKS, 'Copy-A', 'Gesamtes Buch', 'scan_001.jpg'), 'rb').read() and hd.get('X-Mtime-Ms')
    # a picture that another program holds open (Dropbox, a virus scanner ...): a clear answer "busy" instead of a broken connection
    held = os.path.join(BOOKS, 'Copy-A', 'Gesamtes Buch', 'scan_002.jpg')
    if os.name == 'nt':
        import ctypes; k32 = ctypes.windll.kernel32; k32.CreateFileW.restype = ctypes.c_void_p
        hold = k32.CreateFileW(held, 0x80000000, 0, None, 3, 0x80, None)                  # open for reading, sharing with nobody
        release = lambda: k32.CloseHandle(ctypes.c_void_p(hold))
    else:
        import fcntl; fh = open(held, 'rb'); fcntl.flock(fh, fcntl.LOCK_EX)
        release = lambda: fh.close()
    try:
        st, body, hd = call('GET', '/api/file' + q(sc, 'Gesamtes Buch/scan_002.jpg'))
        if st == 200 and os.name != 'nt': print('  (this system does not lock files: the "busy" check is skipped)')
        else:
            assert st == 423 and json.loads(body)['error'] == 'busy', (st, body[:200])
            assert call('GET', '/api/ping')[0] == 200, 'the helper must keep running'
    finally: release()
    st, body, hd = call('GET', '/api/file' + q(sc, 'Gesamtes Buch/scan_002.jpg')); assert st == 200 and len(body) > 1000, 'readable again when the other program lets go'
    # refused: not a picture, leaving the folder, other folders, unknown folder, writing into a scan folder
    for p in ('notes.txt', '../Copy-C/JPG-1/x_1.jpg', 'Gesamtes Buch/../../Copy-C/JPG-1/x_1.jpg', '..%2fCopy-C', 'Gesamtes Buch\\scan_001.jpg', 'scan_001.jpg:stream', '/etc/passwd', 'C:/Windows/win.ini'):
        st, _, _ = call('GET', '/api/file?root=%s&path=%s' % (sc['id'], p if '%' in p else urllib.request.quote(p)))
        assert st in (400, 403, 404), (p, st)
    assert call('GET', '/api/file?root=nope&path=x.jpg')[0] == 404
    assert call('PUT', '/api/write' + q(sc, 'book-compare-project.json'), data=b'{}')[0] == 403
    assert call('PUT', '/api/write' + q(pr, 'other.json'), data=b'{}')[0] == 403
    assert call('PUT', '/api/write' + q(pr, 'x/book-compare-project.json'), data=b'{}')[0] in (400, 403)
    assert call('GET', '/api/list' + q(pr, ''))[0] == 403 and call('GET', '/api/file' + q(pr, 'scan.jpg'))[0] == 403
    # requests from other web sites or without the Book Compare header are refused
    assert call('GET', '/api/ping', headers={'Sec-Fetch-Site': 'cross-site'})[0] == 403
    assert call('GET', '/api/ping', headers={'Origin': 'http://evil.example'})[0] == 403
    assert call('GET', '/api/ping', headers={'Sec-Fetch-Site': 'same-origin', 'Origin': BASE})[0] == 200
    st, _, _ = call('POST', '/api/register', headers={'X-BookCompare': ''}, data=b'{}'); assert st == 403
    assert call('GET', '/api/ping', headers={'Host': 'evil.example:%d' % PORT})[0] in (400, 403, 404)
    # the project file: written, replaced, no leftovers
    assert call('PUT', '/api/write' + q(pr, 'book-compare-project.json'), data='{"a":"ä"}'.encode())[0] == 200
    assert call('PUT', '/api/write' + q(pr, 'book-compare-project.json'), data='{"a":"b"}'.encode())[0] == 200
    assert os.listdir(os.path.join(BOOKS, 'Project')) == ['book-compare-project.json']
    assert call('GET', '/api/file' + q(pr, 'book-compare-project.json'))[1] == b'{"a":"b"}'
    os.remove(os.path.join(BOOKS, 'Project', 'book-compare-project.json'))
    # the program files are still served, and nothing outside the folder "app"
    assert call('GET', '/index.html')[0] == 200 and call('GET', '/..%2fREADME.md')[0] in (400, 403, 404)
    # a folder window that cannot be shown is reported, a cancelled one too
    push_pick('FAIL'); assert jcall('POST', '/api/pick', {'kind': 'scans'})[0] == 501
    push_pick('CANCEL'); st, j = jcall('POST', '/api/pick', {'kind': 'scans'}); assert st == 200 and j.get('cancelled')
    push_pick(os.path.join(BOOKS, 'does not exist')); assert jcall('POST', '/api/pick', {'kind': 'scans'})[0] == 404
    assert BEFORE == snapshot(), 'scan folders must be unchanged'

# ------------------------------------------------------------------------------------------------------------ the page
def col(pg, ci):
    return pg.evaluate("(ci)=>[...document.querySelectorAll('#ws .ws-cell[data-c=\"'+ci+'\"]')].map(e=>e.classList.contains('empty')?'-':e.querySelector('.fn').textContent)", ci)
def open_workspace(pg):
    pg.goto(BASE + '/index.html'); pg.wait_for_timeout(1200)
    for _ in range(8):
        btn = pg.locator('#onboarding button:visible').last
        if btn.count() == 0: break
        txt = btn.inner_text().strip(); btn.click(); pg.wait_for_timeout(300)
        if 'NEXT' not in txt.upper(): break
    pg.click('#books_btn'); pg.wait_for_timeout(900)
def add_copy(pg, folder, name, ticks=(), start=None):
    push_pick(os.path.join(BOOKS, folder))
    pg.click('#ws .ws-tb[data-act=add]' if pg.locator('#ws .ws-tb[data-act=add]').count() else '#ws .ws-addbtn'); pg.wait_for_timeout(200)
    pg.click('#ac-folder'); pg.wait_for_timeout(900)
    pg.fill('#ac-name', name)
    if start: pg.fill('#ac-start', str(start))
    for i in ticks: pg.check('#ac-groups input[data-g="%d"]' % i)
    pg.click('#ac-ok'); pg.wait_for_timeout(800)
def project_json():
    return json.load(open(os.path.join(BOOKS, 'Project', 'book-compare-project.json'), encoding='utf-8'))

def scenario(p, kind):
    ud = os.path.join(TMP, 'profile-' + kind); os.makedirs(ud)
    for f in os.listdir(os.path.join(BOOKS, 'Project')): os.remove(os.path.join(BOOKS, 'Project', f))      # a project left by the previous browser
    launch = getattr(p, kind).launch_persistent_context
    def session():
        c = launch(ud, viewport={'width': 1500, 'height': 900}, service_workers='block')
        pg = c.pages[0] if c.pages else c.new_page()
        pg.on('pageerror', lambda e: errs.append(kind + ' PAGEERROR ' + str(e)))
        pg.on('console', lambda m: errs.append(kind + ' CONSOLE ' + m.text) if m.type == 'error' and '/api/' not in (m.location or {}).get('url', '') else None)
        return c, pg
    # --- first session: three copies, project saved next to them ---------------------------------------------------------
    start_helper(); c, pg = session(); open_workspace(pg)
    assert pg.evaluate("typeof BookWorkspace") == 'object'
    pg.click('#ws-more'); assert 'Quit the Book Compare helper' in pg.inner_text('#ws-menu'); pg.click('#ws-more')       # helper mode is on
    add_copy(pg, 'Copy-A', 'A-Test'); add_copy(pg, 'Copy-B ä', 'B-Test', start=2); add_copy(pg, 'Copy-C', 'C-Test', ticks=(0, 1))
    assert pg.locator('#ws .ws-hname').count() == 3, pg.inner_text('#ws')
    assert col(pg, 0)[:2] == ['scan_001.jpg', 'scan_002.jpg'] and col(pg, 1)[:3] == ['-', 'img_1.JPG', 'img_2.JPG'] and col(pg, 2)[:2] == ['x_1.jpg', 'x_2.jpg'] or col(pg, 2)[:2] == ['x_1.jpg', 'x_3.jpg'], (col(pg, 0), col(pg, 1), col(pg, 2))
    for _ in range(60):
        if pg.locator('#ws-thumbs img').count() >= 2: break
        pg.wait_for_timeout(500)
    assert pg.locator('#ws-thumbs img').count() >= 2, ('thumbnails: ' + pg.inner_text('#ws-thumbs') + ' | errors: ' + str(errs) + ' | helper.log: ' + (open(os.path.join(DATA, 'helper.log'), encoding='utf-8').read()[-1500:] if os.path.exists(os.path.join(DATA, 'helper.log')) else '-'))
    # a project folder that is one of the scan folders is refused; the folder NEXT to them is accepted
    push_pick(os.path.join(BOOKS, 'Copy-B ä')); pg.click('#ws-more'); pg.click('[data-m=save]'); pg.wait_for_timeout(600)
    assert 'scan folder' in pg.inner_text('#ws-toast'), pg.inner_text('#ws-toast')
    assert not os.path.exists(os.path.join(BOOKS, 'Copy-B ä', 'book-compare-project.json'))
    push_pick(os.path.join(BOOKS, 'Project')); pg.click('#ws-more'); pg.click('[data-m=save]'); pg.wait_for_timeout(1500)
    assert 'Saved in folder' in pg.inner_text('#ws-save') and 'Project' in pg.inner_text('#ws-save'), (pg.inner_text('#ws-save'), pg.inner_text('#ws-toast') if pg.locator('#ws-toast').count() else '', open(PICKS).read(), errs)
    d = project_json()
    assert d['version'] == 2 and len(d['roots']) == 3 and all(os.path.normcase(r['path']).startswith(os.path.normcase(BOOKS)) for r in d['roots']), d['roots']
    pg.locator('#ws .ws-hname').first.click(); pg.keyboard.type('A-Renamed'); pg.keyboard.press('Enter'); pg.wait_for_timeout(1500)      # changes are saved by themselves
    assert project_json()['copies'][0]['name'] == 'A-Renamed'
    c.close(); stop_helper()
    # --- the helper and the browser were closed: start both again --------------------------------------------------------
    start_helper(); c, pg = session(); open_workspace(pg)
    pg.wait_for_timeout(500)
    assert pg.locator('#ws .ws-empty [data-act=continue]').count() == 1, pg.inner_text('#ws')
    pg.click('#ws .ws-empty [data-act=continue]'); pg.wait_for_timeout(2000)
    assert pg.locator('#ws .ws-hname').count() == 3 and pg.inner_text('#ws .ws-hname >> nth=0') == 'A-Renamed'
    assert pg.evaluate("document.getElementById('ws-banner').hidden"), 'no question, no banner: ' + pg.inner_text('#ws-banner')
    assert pg.locator('#ws .ws-hmeta.lost').count() == 0 and pg.locator('#ws-thumbs img').count() >= 2
    # a picture that fails for a moment is loaded again by itself; one that keeps failing says why and offers "Reload"
    hits = {'n': 0, 'mode': 'once'}
    def flaky(route):
        hits['n'] += 1
        if hits['mode'] == 'once' and hits['n'] == 1: return route.abort()
        if hits['mode'] == 'busy': return route.fulfill(status=423, content_type='application/json', body='{"error":"busy","message":"Another program is using this file right now."}')
        if hits['mode'] == 'down': return route.abort()
        route.continue_()
    pg.route(re.compile(r'/api/file\?'), flaky)
    pg.locator('#ws .ws-lbl[data-r="6"]').first.click()
    for _ in range(30):
        pg.wait_for_timeout(300)
        if pg.locator('#ws-thumbs img').count() >= 2: break
    assert pg.locator('#ws-thumbs img').count() >= 2 and hits['n'] >= 2, ('retry: ' + pg.inner_text('#ws-thumbs'), hits)
    hits['mode'] = 'busy'; pg.locator('#ws .ws-lbl[data-r="5"]').first.click()                    # (row 7 stays unseen: the last check below needs a page that was never loaded)
    for _ in range(40):
        pg.wait_for_timeout(500)
        if pg.locator('#ws-thumbs .ws-rl').count() >= 1: break
    assert pg.locator('#ws-thumbs .ws-rl').count() >= 1 and 'using this file' in pg.inner_text('#ws-thumbs'), pg.inner_text('#ws-thumbs')
    hits['mode'] = 'pass'; pg.locator('#ws-thumbs .ws-rl').first.click()                         # the files are fine: Reload shows them
    for _ in range(30):
        pg.wait_for_timeout(300)
        if pg.locator('#ws-thumbs img').count() >= 1 and pg.locator('#ws-thumbs .ws-rl').count() == 0: break
    assert pg.locator('#ws-thumbs img').count() >= 1 and pg.locator('#ws-thumbs .ws-rl').count() == 0, pg.inner_text('#ws-thumbs')
    pg.unroute(re.compile(r'/api/file\?'), flaky)
    # width of the columns, moving a copy and deleting several files with Shift (everything is put back afterwards)
    import gridchecks; gridchecks.run(pg, col, project_json)
    # compare a pair of pages: the two-image screen gets the scans
    pg.locator('#ws .ws-cell[data-c="0"][data-r="1"]').click(); pg.wait_for_timeout(300)
    pg.click('#ws-compare'); pg.wait_for_timeout(2500)
    assert pg.evaluate("document.getElementById('ws').hidden") and pg.is_visible('.ct-top'), 'the Compare tab should be showing'
    pg.click('#ct_flag'); pg.wait_for_timeout(1800)                                          # a flag is saved with the project (by itself)
    assert project_json().get('flags') == {'1': 0}, project_json().get('flags')
    pg.wait_for_function("!document.querySelector('div.result_container').classList.contains('ct-stale')", timeout=120000)       # (annotations need the aligned picture)
    pg.click('.ct-atools [data-t=rect]'); bx = pg.locator('#pane_main .ct-ann svg').bounding_box()
    pg.mouse.click(bx['x'] + bx['width'] * 0.5, bx['y'] + bx['height'] * 0.5); pg.wait_for_timeout(200); pg.keyboard.type('Ä ö mark'); pg.wait_for_timeout(1800)      # an annotation too
    an = project_json().get('annotations', {}).get('1'); assert an and an[0]['t'] == 'rect' and an[0]['text'] == 'Ä ö mark' and len(an[0]['pair']) == 2, project_json().get('annotations')
    pg.click('#back'); pg.wait_for_timeout(700)
    assert not pg.evaluate("document.getElementById('ws').hidden"), 'back to the pages'
    assert pg.locator('#ws .ws-lbl[data-r="1"] svg.ws-flag').count() == 1, 'the flag shows in the grid'
    # --- a scan folder was moved: one choice of the folder that holds it is enough -----------------------------------------
    moved = os.path.join(BOOKS, 'Archiv'); os.makedirs(moved)
    shutil.move(os.path.join(BOOKS, 'Copy-B ä'), os.path.join(moved, 'Copy-B ä'))
    c.close(); stop_helper(); start_helper(); c, pg = session(); open_workspace(pg); pg.wait_for_timeout(400)
    pg.click('#ws .ws-empty [data-act=continue]'); pg.wait_for_timeout(2000)
    assert not pg.evaluate("document.getElementById('ws-banner').hidden") and pg.locator('#ws-banner [data-act=reconnect]').count() == 1, 'the missing folder should be reported'
    assert pg.locator('#ws .ws-hmeta.lost').count() == 1
    assert pg.locator('#ws .ws-lbl[data-r="1"] svg.ws-flag').count() == 1, 'the flag was kept in the project file'
    assert pg.evaluate("BookWorkspace.tab.annList(1).map(a => a.text)") == ['Ä ö mark'], 'the annotation was kept in the project file'
    push_pick(BOOKS); pg.click('#ws-banner [data-act=reconnect]')
    for _ in range(60):
        pg.wait_for_timeout(500)
        if pg.evaluate("document.getElementById('ws-banner').hidden") and pg.locator('#ws .ws-hmeta.lost').count() == 0: break
    assert pg.evaluate("document.getElementById('ws-banner').hidden") and pg.locator('#ws .ws-hmeta.lost').count() == 0, ('banner: ' + pg.inner_text('#ws-banner') + ' | toast: ' + (pg.inner_text('#ws-toast') if pg.locator('#ws-toast').count() else '-') + ' | lost: ' + str(pg.locator('#ws .ws-hmeta.lost').count()) + ' | errors: ' + str(errs) + ' | helper.log: ' + (open(os.path.join(DATA, 'helper.log'), encoding='utf-8').read()[-1500:] if os.path.exists(os.path.join(DATA, 'helper.log')) else '-'))
    pg.wait_for_timeout(1200)
    shutil.move(os.path.join(moved, 'Copy-B ä'), os.path.join(BOOKS, 'Copy-B ä')); os.rmdir(moved)       # put everything back for the next run
    # --- the helper is stopped while the page is open: seen pages stay visible, new ones say why they are missing ---------
    pg.click('#ws-more'); pg.click('[data-m=quit]'); pg.wait_for_timeout(300); pg.click('#cf-yes'); pg.wait_for_timeout(1200)
    for _ in range(40):
        if proc.poll() is not None: break
        time.sleep(0.25)
    assert proc.poll() is not None, 'the helper should have stopped'
    pg.locator('#ws .ws-lbl[data-r="1"]').first.click()
    for _ in range(40):
        pg.wait_for_timeout(500)
        if pg.locator('#ws-thumbs img').count() >= 1: break
    assert pg.locator('#ws-thumbs img').count() >= 1, 'pages seen before stay visible: ' + pg.inner_text('#ws-thumbs') + ' | errors: ' + str(errs)
    pg.locator('#ws .ws-lbl[data-r="7"]').first.click()
    for _ in range(120):                                                  # (Windows needs a few seconds to find out that nothing answers, and each picture is tried three times)
        pg.wait_for_timeout(500)
        if 'helper is not running' in pg.inner_text('#ws-thumbs'): break
    assert 'helper is not running' in pg.inner_text('#ws-thumbs'), pg.inner_text('#ws-thumbs')
    c.close(); stop_helper()
    print('  %s: ok' % kind)

try:
    start_helper(); api_tests(); stop_helper()
    with sync_playwright() as p:
        for kind in os.environ.get('BOOKCOMPARE_BROWSERS', 'chromium,firefox').split(','):
            scenario(p, kind)
    assert BEFORE == snapshot(), 'scan folders must be unchanged'
    assert not errs, errs
    print('ALL HELPER TESTS PASSED')
finally:
    stop_helper()
    shutil.rmtree(TMP, ignore_errors=True)
