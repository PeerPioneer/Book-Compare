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
  // several alignments at the same time (the speed test's second part): 2 jobs with 1 and with 2 helpers
  const pool = [{name: 'A-Test', file: await get(a)}, {name: 'B-Test', file: await get(b)}];
  const par = await SpeedTest.parallel(pool, {helpers: [1, 2], jobs: 2}, {stopped: () => false, status: () => {}, row: () => {}});
  const rep = SpeedTest.parallelReport(par);
  out.par = {rows: par.rows.map(r => ({n: r.n, ok: r.ok, done: r.jobsDone, failed: r.failed, wall: r.wall_s, stall: r.stall_ms, speed: r.speed, errors: r.errors})),
             enough: par.enough ? par.enough.n : null, text: rep.text, summary: rep.summary.length, html: rep.rows.length};
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
        par = r['par']
        print('several at once: ' + ', '.join('%d helper(s): %.1f s, delay of the page %d ms, speed %s' % (x['n'], x['wall'], x['stall'], x['speed'] and round(x['speed'], 2)) for x in par['rows']))
        assert [x['n'] for x in par['rows']] == [1, 2] or [x['n'] for x in par['rows']] == [1], par['rows']     # 2 helpers only on a computer with 2 or more threads
        for x in par['rows']:
            assert x['ok'] and x['done'] == 2 and x['failed'] == 0 and not x['errors'] and x['wall'] > 0 and x['stall'] >= 0, x
        assert par['rows'][0]['speed'] is None or par['rows'][0]['speed'] == 1, par['rows'][0]
        assert par['summary'] >= 2 and par['html'] == len(par['rows']) and par['text'].startswith('Book Compare speed test: several alignments'), par
        bad = [e for e in errs if 'bad.jpg' not in e and 'Failed to load resource' not in e]
        assert not bad, 'script errors: ' + str(bad)
        # the window of the several-at-once test: the same page pair twice, 1 and 2 helpers (the project is replaced by a stand-in)
        pg.evaluate("""async ([a, b]) => {
          const get = async u => new File([await (await fetch(u)).blob()], u.split('/').pop(), {type: 'image/jpeg'}), t = BookWorkspace.tab;
          const fa = await get(a), fb = await get(b);
          t.speedPlan = () => ({ok: true, ref: {id: 1, name: 'A-Test'}, row: 0, rowLabel: 'Page 1', items: [{id: 2, name: 'B-Test'}], locked: [], pairsRef: 50, rowsRef: 50, pairsAll: 100, rows: 50, copies: 2});
          t.speedFile = async id => id === 1 ? fa : fb;
          t.modal = html => { const sc = document.createElement('div'); sc.id = 'ws-scrim'; sc.innerHTML = '<div class="ws-dlg">' + html + '</div>';
            sc.addEventListener('click', e => { if (e.target.closest('[data-close]')) sc.remove(); }); document.body.appendChild(sc); return sc; };
          SpeedTest.parallelConfig.helpers = [1, 2]; SpeedTest.parallelConfig.jobs = 2;
          SpeedTest.open();
        }""", [A, B])
        pg.wait_for_selector('#sp-par', state='attached'); pg.evaluate("document.querySelector('#sp-par').click()")  # (the welcome window of the page lies over it)
        pg.wait_for_function("document.querySelector('#ws-scrim h3') && /result/.test(document.querySelector('#ws-scrim h3').textContent)", timeout=150000)
        dlg = pg.inner_text('#ws-scrim .ws-dlg')
        assert 'Each helper took one job' in dlg and 'One helper needed' in dlg and 'Your project has 50 comparisons' in dlg, dlg
        assert pg.locator('#ws-scrim tr[data-par]').count() == len(par['rows']), 'one table row per number of helpers'
        assert pg.evaluate("SpeedTest.lastParallel.text") == pg.evaluate("document.querySelector('.sp-text').value"), 'the numbers are also shown as text'
        print('several-at-once window OK'); pg.evaluate("document.querySelector('#ws-scrim [data-close]').click()")
        print('ALIGN WORKER OK'); b.close()

if __name__ == '__main__':
    main()
