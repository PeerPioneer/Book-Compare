# Alignment experiment in the browser's language (OpenCV.js)

The alignment steps from the Python prototype in `research/` are ported here one at a time,
each checked against the prototype before the next one is started (see PLAN.md, section 4).

## Step 1: printed area (done)

* `printed_area.js`: ink map and printed-area box, same recipe as `ink_map.py` / `printed_area.py`.
* `rectmorph.js`: erosion, dilation, opening and closing with rectangles. OpenCV.js needs about 7 s for a
  1200 x 15 pixel kernel; this version needs about 0.2 s, whatever the kernel size, and gives identical results
  (`node test_rectmorph.js` checks this against OpenCV on random shapes).
* Blurs with sigma 25 are done on a picture 4 times smaller (10 times faster; the boxes do not change).

Result on 24 test scans (single pages, text, woodcuts, coat of arms, music): the boxes of the browser version and of
the Python prototype differ by at most 1 px in 21 scans, by 4 px in 2 scans and by 14 px in 1 scan (all at the
working height of 3000 px). Time per scan in Node.js: about 2.7 s for the box plus about 0.6 s to decode the JPEG
(slower than the Python prototype's 1 s, far inside the 10 s budget; the browser's own JPEG decoder is faster).

## Step 2: rough alignment (done)

* `rough_align.js`: scale/position search by template matching, then ECC refinement and two refinements that look only
  at places where both copies agree; ported from `rough_align.py`. `run_rough.js ref.jpg other.jpg [q] [fast]` runs it.
* The faithful port (q = 1) gives the same result as the Python prototype (pair f4r A-Wn / D-B: matrix
  0.9129 0.0198 -16.10 / -0.0256 0.9154 112.21 against 0.9129 0.0198 -16.11 / -0.0256 0.9154 112.23; unmatched ink 22.0 % in both).
* The refinement is the slow part (about 48 s at full size here). Run on pictures 4 times smaller (q = 4) it takes about 3 s
  and the result is practically the same (22.9 % unmatched instead of 22.0 %); q = 2 takes 11 s (22.1 %).
  On the pair f158v A-Wn / F-Pm the small version was even better than the full-size one (25.9 % against 47.6 %).
* `fast` (scale search on one pre-shrunk picture) saves another second with the same matrix.
* Note: in OpenCV.js the constants for ECC's stop criteria are `cv.TermCriteria_EPS` / `cv.TermCriteria_COUNT`
  (the names used in Python and C++ do not exist there and silently give nothing).

## Step 3: tile alignment (done)

* `tile_align.js`: four levels of tiles, search by template matching with sub-pixel peak, repair of empty tiles and
  outliers by the median of the neighbours, smooth movement field, bending with `remap`; ported from `tile_align.py`
  (the two helper functions from scipy are rewritten by hand). `run_full.js ref.jpg other.jpg [prefix]` runs the whole
  chain (printed area, ink maps, rough, tiles) and prints the unmatched ink after each step and the times;
  with a prefix it also writes a picture of the result (reference red, other copy blue, agreement dark).
* Same result as the prototype on the test pair (f4r A-Wn / D-B): 22 % unmatched ink after the rough step, 0.4 % after the tiles, in both.
* More pairs (unmatched ink after rough step -> after tiles): f158v A-Wn / D-B 22.8 -> 0.7 %; Melopoiae contents page B-Br / D-Mu 6.4 -> 0.8 %;
  Mons Parnassus woodcut B-Br / D-Mu 6.1 -> 2.4 %; contents page DK-Kk / A-Wn2 1.4 -> 0.6 %. The two pairs with copy F-Pm
  (25.9 -> 5.8 %, 45.1 -> 16.5 %) stay high: the overlay picture shows that the page as a whole is in place but some
  stems and notes sit slightly differently in that copy; the tile step deliberately moves only a few pixels, so real differences stay visible.
* Time for one additional copy on Claude's computer (2 cores, Node.js): about 0.3 s ink map + 3 s rough + 4-5 s tiles
  (+ about 0.6 s to decode the JPEG): 7 to 9 s. Not yet measured: in the browser, on the owner's PC.

## Check against known differences (first case done)

* `check_known_differences.js "<Example pages folder>"`: Melopoiae contents page, reference B-Br against D-Mu, A-Wn1, CH-Bu (group A)
  and D-Mbs (group B), regions chosen from `List of Differences.odt` ("Pair 02"). Result: 16 of 16 checks pass. The table matches in every copy
  (0.3-3.2 % of the ink unmatched); poem lines 5, 9 and 13 match for the group A copies (0-3.4 %) and stay clearly different for D-Mbs
  (85-99 %), exactly as the list of differences describes (group B sets them much further right).
* Limits: only one page type so far. The thin white fracture lines of the Concert of Gods woodcut (pair 19) could not be located reliably
  without exact positions; the Folio 19v music table needs the other copies. Thresholds were set after looking at the measured values.
* `align_chain.js` holds the whole chain for one pair and is shared by the run and check scripts.

## How to run

    cd research/js
    npm install
    node test_rectmorph.js
    node run_printed_area.js scan1.jpg scan2.jpg ...      # prints box and times per scan
    node run_rough.js reference.jpg other.jpg 4 fast       # rough alignment, refinement at a quarter size
    node run_full.js reference.jpg other.jpg out/name      # the whole chain, with a picture of the result (reference red, other copy blue, agreement dark)
    node check_known_differences.js "<Example pages folder>"   # the known-differences check

The scans themselves are never committed (they stay on the owner's computer).
