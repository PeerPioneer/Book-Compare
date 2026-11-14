# Tests for the whole-book workspace

`test_modes.py` checks the Visualization menu of the two-image screen (no helper needed): it loads a sample pair, presses Compare and walks through all six modes twice (Difference, Toggle, Top and bottom, Left and right, Only image 1, Only image 2), checks that the removed Slide mode has left nothing behind and that no script error appears.

    python3 -m http.server 8765 -d app          # in the repository folder, in another window
    python3 tests/workspace/test_modes.py       # prints MODES OK

`test_workspace.py` drives the workspace (`app/js/workspace.js`) in Chromium with Playwright and checks, among other things,
that the scan folders are **never changed** (it compares a listing of names, sizes and modification times before and after).
It uses made-up scans created inside the browser's private storage, so none of your own files are involved.

    pip install playwright && playwright install chromium
    cd app && python3 -m http.server 8765        # leave running
    python3 tests/workspace/test_workspace.py    # in another window; prints ALL WORKSPACE TESTS PASSED

`test_roots.py` checks how scan folders are remembered: one folder choice for a whole library, one permission after reopening a project (the browser's lapsed permission is simulated, even in the worst case that every prompt needs its own click), and projects saved by the first version.

    python3 tests/workspace/test_roots.py        # prints ALL ROOT TESTS PASSED

Set `BOOKCOMPARE_URL=file:///.../app/index.html` to run the tests against the app opened from a file path instead of the local server.

`gridchecks.py` holds the checks of the grid editing (column width, moving copies, deleting a range with Shift); it is run by `test_workspace.py` and `test_helper.py`, not on its own.

`test_helper.py` checks the Book Compare helper (`launcher/serve.ps1`) with real folders on disk, in Chromium and in Firefox: the helper's safety rules (other web sites and other host names are refused, scan folders are read-only, only `book-compare-project.json` can be written), choosing folders, saving and reopening a project, and a simulated restart of the browser (no permission question, because the helper holds the folder access). It needs PowerShell (on Windows the built-in one; elsewhere `pwsh`):

    pip install playwright && playwright install chromium firefox
    PWSH=pwsh python3 tests/workspace/test_helper.py      # prints ALL HELPER TESTS PASSED

`tests/windows/windows-checks.ps1` tests the Windows-only parts (folder window, shortcuts, hidden start, icon near the clock). It runs by itself on GitHub (`.github/workflows/windows-test.yml`, on a real Windows machine) after every push; see the "Actions" tab of the repository.

`test_compare_tab.py` checks the Compare tab with the **real alignment engine** (sample pictures of the app in three made-up copies, one of them incomplete), through the helper, in Chromium and Firefox: COMPARE opens the tab and aligns, next/previous page, keys, copy menus and swap, page list and search, skipping pages a copy lacks, the PAGES tab and Back, flags (button, colours, key F, filter, grid, undo) the book map (opens near the pointer, picture, jump, grey ticks, pin) and annotations (drawn, moved, resized, commented, coloured, deleted, hidden with the mouse; kept per page, shown for another pair, undo) and focus mode (what is hidden, keys, Esc and the Leave button). It takes a few minutes.
`test_compare_tab.py` also runs the **speed test** (menu, table with a scan the browser cannot open, the three alignment types, copy button, Stop, closing in the middle, nothing in the project changed).

    PWSH=pwsh python3 tests/workspace/test_compare_tab.py   # prints ALL COMPARE TAB TESTS PASSED

`common.py` holds the helpers (making test scans, faking the folder picker with private-storage folders).
Not covered by these scripts: how the real Windows folder window looks and feels and the permission prompts of Edge/Chrome; these must be tried by hand.

The test of the Photoshop script lives in `tests/photoshop/` (`node tests/photoshop/test_split_script.js`; needs Node, Python and Pillow). It uses a stand-in for Photoshop, so it checks the script's own logic, not Photoshop itself.

On GitHub (`.github/workflows/windows-test.yml`) the tests run automatically after every push that changes the program, the launcher, the tests or the tools: the Windows job (`windows-checks.ps1`, `test_helper.py`, `test_compare_tab.py`), a Linux job (`test_workspace.py`, `test_roots.py`, the Photoshop script test) and, only when both passed, the publishing of the folder `app` as the website.


## test_align_worker.py
Loads the two sample scans of the traherne pair in Chromium, runs the tile-based alignment engine (js/align-engine.js, js/align-worker.js, OpenCV.js) on them
and checks that every step reports a time, that the tile step improves the match, and that a file that is not a picture gives a clear error.
Same way to run as the others: `python3 -m http.server 8765 -d app`, then `python3 tests/workspace/test_align_worker.py`.
