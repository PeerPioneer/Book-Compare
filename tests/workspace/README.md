# Tests for the whole-book workspace

`test_modes.py` checks the Visualization menu of the two-image screen : it loads a sample pair, presses Compare and walks through all six modes twice (Difference, Toggle, Top and bottom, Left and right, Only image 1, Only image 2), checks that the removed Slide mode has left nothing behind and that no script error appears.

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

`gridchecks.py` holds the checks of the grid editing (column width, moving copies, deleting a range with Shift); it is run by `test_workspace.py` and `test_desktop_server.py`, not on its own.

`test_desktop_server.py` checks the desktop program's scan reader (`desktop/server.js`) with real folders on disk, in Chromium and in Firefox: its safety rules (other web sites and other host names are refused, scan folders are read-only, only the project file `<name>.bookcompare` and its results folder can be written, never in a folder that holds pictures), choosing folders and single pictures, saving and reopening a project, a project of an older version, a double-clicked project file, and a simulated restart (no permission question, because the program holds the folder access). It needs Node:

    python3 tests/workspace/test_desktop_server.py      # prints ALL DESKTOP SERVER TESTS PASSED

`tests/windows/installer-checks.ps1` tests the installer of the desktop program on a real Windows machine (silent install into a chosen folder, test mode, uninstall; the installer's pages clicked through). It runs on GitHub (`.github/workflows/desktop.yml`).

`test_compare_tab.py` checks the Compare tab with the **real alignment engine** (sample pictures of the app in three made-up copies, one of them incomplete), through the desktop program's scan reader, in Chromium and Firefox: COMPARE opens the tab and aligns, next/previous page, keys (Page Up / Page Down turn the page; the arrow keys do not), copy menus and swap, the single bottom bar with the view switcher (opens when the pointer rests on the view name, by click, keys 1-6; the book map never covers an opened menu; copy names in the Difference colour note), page list and search, skipping pages a copy lacks, the PAGES tab, flags (button, colours, key F, filter, grid, undo) the book map (opens near the pointer, picture, jump, grey ticks, pin) and annotations (drawn, moved, resized, commented, coloured, deleted, hidden with the mouse; kept per page, shown for another pair, undo) and focus mode (what is hidden, keys, Esc and the Leave button). It takes a few minutes.
`test_compare_tab.py` also runs the **speed test** (menu, table with a scan the browser cannot open, the three alignment types, copy button, Stop, closing in the middle, nothing in the project changed).

    python3 tests/workspace/test_compare_tab.py   # prints ALL COMPARE TAB TESTS PASSED

`common.py` holds the helpers (making test scans, faking the folder picker and the Save/Open windows for the project file with private-storage folders).
Environment switches: `BOOKCOMPARE_BROWSERS=chromium` runs only Chromium where a test would also run Firefox; `BOOKCOMPARE_PERSISTENT=1` runs the
browser tests with a profile on disk (some Chromium builds crash in a private window when a remembered folder is read back from storage).
Not covered by these scripts: how the real Windows folder and Open windows look and feel, and the permission prompts of Edge/Chrome on the website; these must be tried by hand.


On GitHub (`.github/workflows/windows-test.yml`) the tests run automatically after every push that changes the program or the tests: the Windows job (`test_desktop_server.py`, `test_compare_tab.py`), a Linux job (`test_align_worker.py`, `test_modes.py`, `test_workspace.py`, `test_roots.py`, `test_desktop_links.py`) and, only when both passed, the publishing of the folder `app` as the website. The desktop program itself (installer, test mode, installer pages) is checked by `.github/workflows/desktop.yml` with `tests/windows/installer-checks.ps1`.


## test_align_worker.py
Loads the two sample scans of the traherne pair in Chromium, runs the tile-based alignment engine (js/align-engine.js, js/align-worker.js, OpenCV.js) on them
and checks that every step reports a time, that the tile step improves the match, and that a file that is not a picture gives a clear error.
Same way to run as the others: `python3 -m http.server 8765 -d app`, then `python3 tests/workspace/test_align_worker.py`.

## test_background.py
The reference copy (V7), the background alignment (V8, V9) and the stored alignments (V10), with the desktop program's scan reader and
real folders on disk (sample pictures, three copies, one with a wrong page): the project saved as a file, the reference copy proposed,
chosen (star in the heading), saved and undone; the background run with its strip, the pause on the page whose ink has no partner,
"Go to the page", "Continue, do not ask again", the finished summary and the files in the results folder; started again, everything is
skipped; the Compare tab shows a pair with the reference from the stored movement, aligns another pair directly and prepares the next
page; a changed tile setting is aligned again. Chromium (BOOKCOMPARE_BROWSERS=chromium,firefox for both). Needs Node.

    python3 tests/workspace/test_background.py    # prints ALL BACKGROUND ALIGNMENT TESTS PASSED
