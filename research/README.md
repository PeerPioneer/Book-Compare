# research/: alignment and printed-area detection (Python, not yet part of the app)

These scripts are the code behind the tests described in `FINDINGS.md`. They run on a normal computer with Python 3
and `pip install numpy opencv-python scipy`. **The Book Compare app does not use them yet**; the app's own alignment is the
sealed WebAssembly module in `app/js/transform.js`, so everything here still has to be rewritten in JavaScript (see `ROADMAP.md`).

| file | what it does |
|---|---|
| `ink_map.py` | turns a scan into an "ink map" (printed ink = 1, paper = 0) |
| `printed_area.py` | proposes the printed area (a rectangle) of a scan; `python3 printed_area.py out.jpg a.jpg b.jpg ...` draws the proposals |
| `rough_align.py` | whole-page alignment (scale, shift, small rotation/shear) |
| `tile_align.py` | local alignment with four rounds of ever smaller tiles |
| `align_pair.py` | everything together for two scans: `python3 align_pair.py reference.jpg other.jpg out_prefix` |

Run the scripts from inside this folder. Scans are only ever read, never changed. **No scan images are part of this repository**
(they belong to the libraries and to the thesis work); use your own.
