"""Visualization modes of the two-image screen (Chromium, no helper needed).

Loads one of the sample pairs, presses Compare, then walks through every entry of the Visualization menu and checks that
 * the menu offers exactly: Difference, Toggle, Top and bottom, Left and right, Only image 1, Only image 2 (the Slide mode is gone),
 * every mode can be chosen without a script error and without breaking the picture panels,
 * nothing of the old Slide mode is left on the page (its bar, its slider line, its Horizontal/Vertical switch).
Run:  python3 -m http.server 8765 -d app   (in the repository folder), then   python3 tests/workspace/test_modes.py"""
import sys
from playwright.sync_api import sync_playwright
import common
from common import URL, errs

EXPECT = ['diff', 'toggle', 'topbottom', 'leftright', 'onlyimage1', 'onlyimage2']

def main():
    with sync_playwright() as p:
        b = p.chromium.launch(args=['--allow-file-access-from-files'] if URL.startswith('file:') else [])
        pg = b.new_context(viewport={'width': 1500, 'height': 900}, service_workers='block').new_page()
        pg.on('pageerror', lambda e: errs.append('PAGEERROR ' + str(e)))
        pg.on('console', lambda m: errs.append('CONSOLE ' + m.text) if m.type == 'error' and '/api/' not in (m.location or {}).get('url', '') else None)
        pg.goto(URL); pg.wait_for_timeout(900)
        for _ in range(8):                                                   # the first-visit tour
            btn = pg.locator('#onboarding button:visible').last
            if btn.count() == 0: break
            txt = btn.inner_text().strip(); btn.click(); pg.wait_for_timeout(300)
            if 'NEXT' not in txt.upper(): break

        # a sample pair -> Compare screen -> Compare
        pg.click('#try_samples_btn'); pg.wait_for_timeout(500)
        pg.locator('.samples li.mdc-list-item').first.click(); pg.wait_for_timeout(800)
        pg.click('#compare')
        pg.wait_for_function("document.querySelector('#visualisation_select') && !document.querySelector('#visualisation_select').classList.contains('hide')", timeout=90000)
        pg.wait_for_timeout(1500)

        # 1. the menu
        pg.click('#visualisation_select .mdc-select__anchor'); pg.wait_for_timeout(400)
        values = pg.eval_on_selector_all('#visualisation_select li[data-value]', 'els => els.map(e => e.dataset.value)')
        assert values == EXPECT, 'Visualization menu offers ' + str(values) + ', expected ' + str(EXPECT)
        names = pg.eval_on_selector_all('#visualisation_select li[data-value]', 'els => els.map(e => e.innerText.trim())')
        assert not any('slide' in n.lower() for n in names), 'a Slide entry is still in the menu: ' + str(names)
        pg.keyboard.press('Escape'); pg.wait_for_timeout(300)

        # 2. nothing of the old mode is left
        left = pg.evaluate("""() => ({ slideBar: !!document.getElementById('slide'), seg: !!document.getElementById('slide_seg'),
            line: !!document.querySelector('.image_slider'), radios: !!document.querySelector('input[name=radio-slider]') })""")
        assert not any(left.values()), 'leftovers of the Slide mode on the page: ' + str(left)

        # 3. every mode can be chosen, and the picture panels stay usable
        for v in EXPECT * 2:                                                 # twice, so that coming back from every mode is tested
            pg.click('#visualisation_select .mdc-select__anchor'); pg.wait_for_timeout(350)
            pg.click('#visualisation_select li[data-value="%s"]' % v); pg.wait_for_timeout(600)
            shown = pg.evaluate("document.querySelector('#visualisation_select .mdc-select__selected-text').textContent.trim()")
            assert shown, 'no mode name shown after choosing ' + v
            vis = pg.evaluate("""() => [...document.querySelectorAll('#compare_container canvas')].filter(c => c.offsetWidth > 20 && c.offsetHeight > 20).length""")
            assert vis >= 1, 'no picture visible in mode ' + v
            print('ok ', v, '->', shown, '(', vis, 'picture panel(s) )')

        # 4. zoom buttons still work after all that
        pg.click('#zoom_in') if pg.locator('#zoom_in').count() else None
        pg.wait_for_timeout(300)
        b.close()
    bad = [e for e in errs if 'favicon' not in e]
    assert not bad, 'script errors: ' + '; '.join(bad[:5])
    print('MODES OK')

if __name__ == '__main__':
    try: main()
    except AssertionError as e: print('FAILED:', e); sys.exit(1)
