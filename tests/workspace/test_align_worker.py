"""The tile-based alignment engine (js/align-engine.js + js/align-worker.js + OpenCV.js) in a real browser (Chromium).
Loads the two sample scans of the traherne book pair, sets the first as reference, aligns the second onto it and checks
 * every step reports a time, the picture sizes are right,
 * the tile step really improves the match (unmatched ink after the tiles is lower than after the rough step, and small),
 * a file that is not a picture gives a clear error instead of hanging,
 * no script error on the page.
Run:  python3 -m http.server 8765 -d app   (in the repository folder), then   python3 tests/workspace/test_align_worker.py"""
import sys
from playwright.sync_api import sync_playwright
import common
from common import URL, errs

A = 'images/usecases/book/case2-traherne2-a-original.jpg'
B = 'images/usecases/book/case2-traherne2-b-original.jpg'

JS = """async ([a, b]) => {
  const get = async u => new File([await (await fetch(u)).blob()], u.split('/').pop(), {type: 'image/jpeg'});
  if (!AlignEngine.supported()) return {unsupported: true};
  const e = AlignEngine.create(), out = {};
  let t = performance.now();
  out.init = await e.init(); out.init_wall = (performance.now() - t) / 1000;
  t = performance.now(); out.ref = await e.reference(await get(a)); out.ref_wall = (performance.now() - t) / 1000;
  t = performance.now(); out.al = await e.align(await get(b), true); out.al_wall = (performance.now() - t) / 1000;
  try { await e.align(new File(['this is not a picture'], 'bad.jpg', {type: 'image/jpeg'}), false); out.bad = 'no error'; }
  catch (err) { out.bad = String(err.message); }
  e.terminate();
  return out;
}"""

def main():
    with sync_playwright() as p:
        b = p.chromium.launch(args=['--allow-file-access-from-files'] if URL.startswith('file:') else [])
        pg = b.new_context(viewport={'width': 1200, 'height': 800}, service_workers='block').new_page()
        pg.on('pageerror', lambda e: errs.append('PAGEERROR ' + str(e)))
        pg.on('console', lambda m: errs.append('CONSOLE ' + m.text) if m.type == 'error' and '/api/' not in (m.location or {}).get('url', '') else None)
        pg.goto(URL); pg.wait_for_timeout(800)
        r = pg.evaluate(JS, [A, B])
        assert not r.get('unsupported'), 'this browser has no Worker / OffscreenCanvas / createImageBitmap'
        print('OpenCV.js loaded in %.1f s; reference %dx%d in %.1f s; aligned copy %dx%d in %.1f s' % (
            r['init']['load_s'], r['ref']['w'], r['ref']['h'], r['ref_wall'], r['al']['w'], r['al']['h'], r['al_wall']))
        al = r['al']
        print('steps: decode %.2f, ink %.2f, rough %.2f, tiles %.2f s; unmatched ink: rough %.1f %% -> tiles %.1f %%' % (
            al['decode_s'], al['ink_s'], al['rough_s'], al['tiles_s'], 100 * al['unmatched_rough'], 100 * al['unmatched_tiles']))
        for k in ('decode_s', 'ink_s', 'rough_s', 'tiles_s', 'total_s'):
            assert al[k] > 0, 'no time reported for ' + k
        assert r['ref']['w'] > 100 and r['ref']['h'] > 100 and al['w'] > 100 and al['h'] > 100, 'picture sizes missing'
        assert al['unmatched_tiles'] < al['unmatched_rough'], 'the tile step did not improve the match'
        assert al['unmatched_tiles'] < 0.15, 'too much ink unmatched after the tiles (limit 15 %): %.1f %%' % (100 * al['unmatched_tiles'])
        assert r['bad'] != 'no error' and 'could not open' in r['bad'], 'a bad file gave: ' + r['bad']
        bad = [e for e in errs if 'bad.jpg' not in e and 'Failed to load resource' not in e]
        assert not bad, 'script errors: ' + str(bad)
        print('ALIGN WORKER OK'); b.close()

if __name__ == '__main__':
    main()
