# Tests for the whole-book workspace

`test_workspace.py` drives the workspace (`app/js/workspace.js`) in Chromium with Playwright and checks, among other things,
that the scan folders are **never changed** (it compares a listing of names, sizes and modification times before and after).
It uses made-up scans created inside the browser's private storage, so none of your own files are involved.

    pip install playwright && playwright install chromium
    cd app && python3 -m http.server 8765        # leave running
    python3 tests/workspace/test_workspace.py    # in another window; prints ALL WORKSPACE TESTS PASSED

`common.py` holds the helpers (making test scans, faking the folder picker with private-storage folders).
Not covered by this script: the real Windows folder picker and permission prompts of Edge; these must be tried by hand.
