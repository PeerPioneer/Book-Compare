# Tests for the whole-book workspace

`test_workspace.py` drives the workspace (`app/js/workspace.js`) in Chromium with Playwright and checks, among other things,
that the scan folders are **never changed** (it compares a listing of names, sizes and modification times before and after).
It uses made-up scans created inside the browser's private storage, so none of your own files are involved.

    pip install playwright && playwright install chromium
    cd app && python3 -m http.server 8765        # leave running
    python3 tests/workspace/test_workspace.py    # in another window; prints ALL WORKSPACE TESTS PASSED

`test_roots.py` checks how scan folders are remembered: one folder choice for a whole library, one permission after reopening a project (the browser's lapsed permission is simulated, even in the worst case that every prompt needs its own click), and projects saved by the first version.

    python3 tests/workspace/test_roots.py        # prints ALL ROOT TESTS PASSED

Set `BOOKCOMPARE_URL=file:///.../app/index.html` to run the tests against the app opened from a file path instead of the local server.

`common.py` holds the helpers (making test scans, faking the folder picker with private-storage folders).
Not covered by this script: the real Windows folder picker and permission prompts of Edge; these must be tried by hand.
