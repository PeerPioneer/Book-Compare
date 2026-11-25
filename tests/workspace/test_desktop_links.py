"""Website or desktop program (21 Nov 2026): the same pages behave differently.
 * On the website: the start screen (Select 2 Images / Compare copies of a book / Try Samples) has the line "Desktop program for
   Windows" (link to the download page, the newest release on GitHub), and the More menu of the pages has "Desktop program for Windows …".
 * In the desktop program (recognised by "BookCompareDesktop/<version>" in the browser name): neither of these; instead, when GitHub
   names a newer version, a card (on every screen, the start screen too) with "Update now", "What is new" and "Later"; "Later"
   keeps it away for the rest of the day; the version and "Check for updates" on the start screen, in the menu and in About;
   no notice when the version is the same or older; nothing breaks when GitHub cannot be reached.
GitHub is not really asked: the test answers in its place.
Run:  python3 -m http.server 8765 -d app   (in the repository folder), then   python3 tests/workspace/test_desktop_links.py"""
import sys, json
from playwright.sync_api import sync_playwright
import common
from common import errs

RELEASES = 'https://github.com/PeerPioneer/Book-Compare/releases/latest'
API = 'https://api.github.com/repos/PeerPioneer/Book-Compare/releases/latest'

def context(p, b, desktop_version=None, latest=None, offline=False):
    ua = None
    if desktop_version:
        ua = p.devices['Desktop Chrome']['user_agent'] + ' BookCompareDesktop/' + desktop_version
    c = b.new_context(viewport={'width': 1500, 'height': 900}, service_workers='block', user_agent=ua) if ua else b.new_context(viewport={'width': 1500, 'height': 900}, service_workers='block')
    c.asked = []
    def answer(route):
        c.asked.append(route.request.url)
        if offline: return route.abort()
        route.fulfill(status=200, content_type='application/json', headers={'Access-Control-Allow-Origin': '*'}, body=json.dumps({'tag_name': 'v' + latest}))
    c.route(API, answer)
    return c

def menu_text(pg):
    pg.click('#ws-more'); t = pg.inner_text('#ws-menu'); pg.click('#ws-more'); return t

def main():
    with sync_playwright() as p:
        b = p.chromium.launch()
        # --- the website
        c = context(p, b)
        _, _, pg = common.start(p, build=False, ctx=c)
        link = pg.locator('#desktop_dl a')
        assert pg.is_visible('#desktop_dl') and link.inner_text() == 'Desktop program for Windows' and link.get_attribute('href') == RELEASES
        assert pg.is_visible('#desktop_dl_note') == ('Windows' not in pg.evaluate('navigator.userAgent')), 'the note "it does not run on this device" only off Windows'
        pg.click('#books_btn'); pg.wait_for_selector('#ws .ws-empty')
        assert 'Desktop program for Windows' in menu_text(pg)
        pg.wait_for_timeout(3500)
        assert pg.locator('#ws-update').is_hidden() and not c.asked, 'the website never asks GitHub for a new version'
        c.close(); print('  website: download line and menu entry ok')

        # --- the desktop program, a newer version exists (0.12.0: the card shows on every screen, already on the start screen,
        #     and the newest version is looked up at every start; "Later" keeps the card away for the day, not the menu and About)
        c = context(p, b, desktop_version='0.7.0', latest='0.9.1')
        _, _, pg = common.start(p, build=False, ctx=c)
        assert not pg.is_visible('#desktop_dl'), 'no download line in the desktop program'
        assert pg.is_visible('#start_version') and '0.7.0' in pg.inner_text('#start_version'), 'the start screen names the version'
        pg.wait_for_selector('#bc-update:visible', timeout=8000)
        t = pg.inner_text('#bc-update'); assert '0.9.1' in t and '0.7.0' in t and 'Update now' in t, t
        with c.expect_page() as newp:
            pg.click('#bc-update [data-act=upd-dl]')
        assert newp.value.url.startswith(RELEASES) or newp.value.url == 'about:blank' or 'github.com' in newp.value.url, newp.value.url
        newp.value.close()
        assert pg.locator('#bc-update').is_hidden()
        pg.reload(); pg.wait_for_timeout(4500)
        assert pg.locator('#bc-update').is_hidden(), 'after "What is new" / "Later": not again the same day'
        assert len(c.asked) == 2, ('the newest version is looked up at every start', c.asked)
        pg.click('#books_btn'); pg.wait_for_selector('#ws .ws-empty')
        m = menu_text(pg); assert 'Desktop program for Windows' not in m and 'Update to version 0.9.1' in m, m
        pg.click('#ws-more'); pg.click('#ws-menu [data-m=about]'); pg.wait_for_timeout(300)
        assert 'A newer version is available: 0.9.1' in pg.inner_text('.ws-dlg') and pg.locator('.ws-dlg [data-about=upd]').count() == 1
        pg.click('.ws-dlg [data-close]'); pg.wait_for_timeout(200)
        pg.click('#ws-more'); pg.click('#ws-menu [data-m=updates]'); pg.wait_for_timeout(800)
        assert pg.is_visible('#bc-update'), 'the menu shows the card again'
        c.close(); print('  desktop program: notice of a newer version ok (start screen, menu, About)')

        # --- the desktop program, same version / older / GitHub unreachable
        for latest, offline in (('0.7.0', False), ('0.6.9', False), ('9.0.0', True)):
            c = context(p, b, desktop_version='0.7.0', latest=latest, offline=offline)
            _, _, pg = common.start(p, build=False, ctx=c)
            pg.wait_for_timeout(4500)
            assert pg.locator('#bc-update').is_hidden(), ('no notice', latest, offline)
            if latest == '0.7.0':                                   # "Check for updates" on the start screen says so
                pg.click('#start_updates'); pg.wait_for_timeout(1200)
                assert 'newest version' in pg.inner_text('#bc-update'), pg.inner_text('#bc-update')
                pg.click('#bc-update [data-act=upd-close]'); assert pg.locator('#bc-update').is_hidden()
                pg.click('#books_btn'); pg.wait_for_selector('#ws .ws-empty'); pg.click('#ws-more'); pg.click('#ws-menu [data-m=about]'); pg.wait_for_timeout(300)
                assert 'This is the newest version.' in pg.inner_text('.ws-dlg'), pg.inner_text('.ws-dlg')
            c.close()
        print('  desktop program: no notice when up to date or offline ok')
        b.close()
    bad = [e for e in errs if 'api.github.com' not in e and 'ERR_FAILED' not in e]
    if bad:
        print('ERRORS ON THE PAGE:\n' + '\n'.join(bad)); sys.exit(1)
    print('ALL DESKTOP-LINK TESTS PASSED')

if __name__ == '__main__':
    main()
