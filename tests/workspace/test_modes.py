"""The examples project and the views of the Compare tab (Chromium, no helper needed).

0.11.0: the old two-image screens of Image Compare ("Compare two single pictures", "Try the samples") are gone. "Try the examples" on
the start screen opens a small project made of pictures that come with Book Compare; this test checks that
 * the start screen offers "Try the examples" and no longer the two old links,
 * the examples open in the Compare tab at the welcome page, with its card; the page list holds one row per example,
 * every example aligns, and the card follows the page ("Next example" goes on),
 * every view (keys 1-6: Superimposed, Toggle, Top and bottom, Left and right, Copy 1, Copy 2) can be chosen without a script
   error and shows a picture,
 * nothing is saved: the chip says so, Ctrl+S explains it, and "Start your own project" leads to an empty project.
Run:  python3 -m http.server 8765 -d app   (in the repository folder), then   python3 tests/workspace/test_modes.py"""
import sys
from playwright.sync_api import sync_playwright
import common
from common import URL, errs

VIEWS = ['diff', 'toggle', 'topbottom', 'leftright', 'onlyimage1', 'onlyimage2']

def wait_aligned(pg, why, secs=120):
    for _ in range(secs * 4):
        pg.wait_for_timeout(250)
        if pg.evaluate("!document.querySelector('.ct-busy').offsetParent && !document.querySelector('div.result_container').classList.contains('ct-stale')"): return
        if pg.locator('.ct-busy.bad:visible').count(): raise AssertionError(why + ': ' + pg.inner_text('.ct-busy'))
    raise AssertionError(why + ': the alignment did not finish. ' + pg.inner_text('.ct-busy'))

def main():
    with sync_playwright() as p:
        b = p.chromium.launch(args=['--allow-file-access-from-files'] if URL.startswith('file:') else [])
        pg = b.new_context(viewport={'width': 1500, 'height': 900}, service_workers='block').new_page()
        pg.on('pageerror', lambda e: errs.append('PAGEERROR ' + str(e)))
        pg.on('console', lambda m: errs.append('CONSOLE ' + m.text) if m.type == 'error' and '/api/' not in (m.location or {}).get('url', '') else None)
        pg.goto(URL); pg.wait_for_timeout(900)

        # the start screen
        assert pg.is_visible('#start_examples') and 'Try the examples' in pg.inner_text('#start_examples')
        assert pg.locator('#image_select_btn').count() == 0 and pg.locator('#try_samples_btn').count() == 0 and pg.locator('div.samples').count() == 0, 'the old two-image entries are gone'

        # the examples: Compare tab, welcome page and its card
        pg.click('#start_examples')
        pg.wait_for_function("document.querySelector('.ct-top') && document.querySelector('.ct-top').offsetParent", timeout=60000)
        wait_aligned(pg, 'welcome page')
        n = pg.evaluate("BCExamples.list.length")
        assert pg.locator('#ct_list li[data-i]').count() == n and 'Welcome' in pg.inner_text('#ct_list li[data-i="0"]'), pg.inner_text('#ct_list')
        assert pg.is_visible('#ct_excard') and 'Welcome to Book Compare' in pg.inner_text('#ct_excard') and 'example 1 of %d' % n in pg.inner_text('#ct_excard').lower()
        t = pg.evaluate("CompareTab.lastTiles()"); assert t and t['unmatched_tiles'] < 0.2, ('the welcome pair aligns', t)
        assert 'Examples' in pg.inner_text('.ct-top') and 'not saved' in pg.inner_text('.ct-top'), pg.inner_text('.ct-top')
        pg.evaluate("document.activeElement && document.activeElement.blur()")
        pg.keyboard.press('Control+s'); pg.wait_for_timeout(300)
        assert 'not saved' in pg.inner_text('.ct-toast'), pg.inner_text('.ct-toast')

        # every view on the welcome page
        for v in VIEWS * 2:                                                   # twice, so that coming back from every view is tested
            pg.keyboard.press(str(VIEWS.index(v) + 1)); pg.wait_for_timeout(500)
            assert pg.evaluate("CompareTab.view ? CompareTab.view() : null") in (v, None)
            vis = pg.evaluate("""() => [...document.querySelectorAll('#compare_container canvas')].filter(c => c.offsetWidth > 20 && c.offsetHeight > 20).length""")
            assert vis >= 1, 'no picture visible in view ' + v
            print('ok ', v, '(', vis, 'picture panel(s) )')
        pg.keyboard.press('1'); pg.wait_for_timeout(300)

        # the other examples, one after the other with the card's button
        for i in range(1, n):
            pg.click('#ct_excard [data-ex=next]'); wait_aligned(pg, 'example %d' % (i + 1))
            assert pg.evaluate("BookWorkspace.tab.state().row") == i and ('example %d of %d' % (i + 1, n)) in pg.inner_text('#ct_excard').lower()
            t = pg.evaluate("CompareTab.lastTiles()"); print('ok  example', i + 1, pg.evaluate("BCExamples.list[%d].label" % i), 'unmatched %.1f %%' % (100 * t['unmatched_tiles']))
            assert t['unmatched_tiles'] < 0.45, t
        assert pg.locator('#ct_excard [data-ex=next]').count() == 0, 'the last example has no "Next"'
        pg.click('#ct_excard [data-ex=close]'); pg.wait_for_timeout(200); assert not pg.is_visible('#ct_excard'), 'the card can be closed'

        # "Start your own project": an empty project, nothing of the examples is left
        pg.click('#ct_prev'); wait_aligned(pg, 'back one'); pg.click('#ct_excard [data-ex=own]'); pg.wait_for_timeout(800)
        assert pg.is_visible('#ws') and pg.locator('#ws .ws-empty').count() == 1 and pg.locator('#ws .ws-hname').count() == 0, 'an empty new project'
        b.close()
    bad = [e for e in errs if 'favicon' not in e]
    assert not bad, 'script errors: ' + '; '.join(bad[:5])
    print('EXAMPLES AND VIEWS OK')

if __name__ == '__main__':
    try: main()
    except AssertionError as e: print('FAILED:', e); sys.exit(1)
