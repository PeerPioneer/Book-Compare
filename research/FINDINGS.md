# What the tests showed (status 5 November 2026)

All numbers come from scans of early prints c. 1500 (Liber selectarum cantionum, Melopoiae): text, table, title, music,
woodcut and coat-of-arms pages, 9 to 20 copies per page. Timings were measured in a cloud workspace with Python/OpenCV,
**not** on an ordinary PC; only the ratios are meant to carry over.

## 1. Contrast and black-and-white do not help alignment: dropped
Compared on the full alignment (rough + tile) with the automatic ink map, the plain red channel, plain luminance, contrast
1.5 and 2.0, and a hard black/white threshold (Otsu). Measure: share of ink without a partner (within 1 pixel) in the other copy.

- automatic ink map, red channel and luminance came out about equal
- contrast 1.5 / 2.0 and the hard threshold were never better and slightly worse on music
  (rough step 10.8 % -> 12.5 % unmatched; full alignment 1.33 % -> 1.50 % / 1.58 %)
- a colour woodcut test earlier gave the same picture

**Decision:** contrast and black-and-white are removed from the app, as alignment options and as display settings.

## 2. Ink map (`ink_map.py`)
Red channel, divided by a smooth estimate of the paper brightness, automatic threshold (Otsu) from the central half of the
page, soft ramp so thin strokes are kept. Working height 3000 px. Red stamps and rubrication nearly vanish in the red channel.

## 3. Printed-area detection (`printed_area.py`, version 7)
Steps: ink map -> remove big dark patches touching the scan border -> remove long thin straight lines (page edges, frames,
staff lines) -> remove long thick bands (scanner/board edges) -> blur, threshold, close, open -> take the largest region that does
**not** touch the scan border (fall back to the largest overall), plus smaller regions above/below it (headings) -> bounding box.

Result, checked by eye on 116 scans: **98 of 106 single-page scans right**, 2 marginal, 6 wrong; about 10 double-page spreads
need splitting into pages first. Known failures: Melopoiae title page of B-Br (whole frame), musical-notation page of US-CA
(top staff missing), f.4r of CZ-Jm (partial) and D-FUl (small box), f.158v of CH-E (tiny box), coat of arms of D-Mbs (copy is
incomplete); marginal: a binding strip (US-R p. 4), a sliver of the next page (D-ARk f.158v).
Agreed policy: pages with stamps or handwritten entries are not specially handled; the user corrects the box by hand.

## 4. Tile alignment (`tile_align.py`)
Four levels (tile, step, search radius, outlier threshold in px): (384,192,56,8), (192,96,14,3), (96,48,6,2), (48,24,3,1.5).
Each tile of the reference is searched for in the other copy (normalised cross-correlation, sub-pixel peak); empty or
unconvincing tiles and outliers are replaced by the median of their neighbours; the shifts are interpolated to a smooth field and
the other copy is bent with it. It works on text, music and woodcut test pages (typical unmatched ink: ~5-12 % after the rough
step, ~1-2 % after the tiles; 0.3 % on a text pair). It deliberately only moves a few pixels, so cracks, broken lines and real
variants stay visible.

## 5. Speed
Whole scan, one copy: about 28-30 s (rough ~19 s, tiles ~10 s). Cropped to the printed area: about 12-14 s (rough 7-8 s,
tiles 5-6 s), i.e. cropping roughly **halves** the work. Real speed on an ordinary PC has not been measured yet.

## 6. Lessons
- The rough step must be robust: it fails when the printed-area box is wrong or the page has little text (D-W title page).
- The initial scale/position guess matters more than the fine steps.
- Double-page spreads must be split before detection.
- Spine shadows fool simple luminance thresholds (D-W), so the red-channel ink map with background normalisation is used.
- Problem copies still to examine: F-Pm (ink map), A-Wn / D-ARk / D-SHk (distortion at edge and spine).

## 7. Automatic page matching (`page_matching.py`, tested 5 November 2026)
Goal: for every page of one copy, find the page of another copy that shows the same printed page, without using file names.
**Method**: each page gets a small "fingerprint" (ink map at 1000 px, big dark blobs touching the border removed, 2 % border
removed, long straight lines removed so that staves and frames do not dominate, shrunk to 240 px height, blurred). Two pages are
compared by normalised cross-correlation over 13 scales (0.7-1.45); near-blank pages score 0. Then two stages:
*anchors* (pairs that are each other's best match, clearly ahead of the runner-up, similarity >= 0.3; no page order assumed) and
*fill* (the rest, matched with an order-preserving dynamic programme, tau 0.25; reported as "probable").

**Test 1 - Melopoiae** (US-R, D-As, D-Mu, CH-Bu; raw scans, all 12 ordered pairs, 216 true shared pages, exact ground truth):
- fingerprint 160 px, staff lines kept, order-preserving only: 200 correct, 10 wrong, 4 missed
- fingerprint 240 px, lines removed, order-preserving only: **215 correct, 1 wrong, 0 missed (99.5 %)**
- the same without any order constraint (best match per page): 193 / 216
- anchors only (margin 0.05): **169 correct, 0 wrong, 0 false matches** (78 % recall, 100 % precision)
- anchors + fill: **213 correct / 216, 1 wrong**, plus ~38 "probable" matches among covers/blank leaves/endpapers that have no printed counterpart
  (harmless, but the app must show them as low confidence)
- resolution matters (120 px: 203, 160 px: 209, 240 px: 215 correct); 7 vs 13 scales made no real difference; a cheap
  40x56 moment-normalised descriptor was 100x faster but far too inaccurate (156 / 216).

**Test 2 - Liber selectarum cantionum**, D-ARk fol. 40r-54v against CH-E scans 0086-0115 (30 pages each; grey/dark backgrounds,
neighbouring page visible at the edge): every page with a counterpart in the window was found with similarity 0.48-0.68
(runner-up 0.26-0.49). **Finding: D-ARk's rectos match CH-E at offset 0, but D-ARk's versos match CH-E two positions
earlier** (D-ARk "fol. 041v" shows the same page as CH-E 0087, the back of the leaf whose front is 40r), i.e. the verso file
names/order of one copy are shifted by one leaf against the other. An order-preserving matcher alone would drop half of these
pairs (the pairs cross); the anchor stage found all 29 pairs correctly (offsets only 0 and -2). **Page order in file names cannot
be trusted - the workspace must be able to show and accept such shifts.**

**Cost** (Python + OpenCV, one core): about 27 ms per page pair with 13 scales. A full 544 x 544 matrix is ~8000 s per pair of copies,
which is too slow; the plan is (estimates, not yet measured): find the offset between two copies from a few probe pages, then
compare each page only with its neighbours within +-10..15 pages (banded), use ~3 scales around the scale found once per copy
(~6 ms), Web Workers in parallel, and a lower resolution (120 px) for the first pass. That gives roughly 1-2 minutes per pair of
copies in Python terms; the JavaScript speed has to be measured.

**Limits / open points**: no gap penalty yet; blank-page detection and a confidence score per match are needed for the UI;
multi-copy matching (progressive alignment against a reference copy) is not built; spreads (two pages per scan) must be split
first; copies whose scans contain two states of a page or different layouts will give low similarity and must be matched manually.
Result for the UI: matching *proposes* (sure / probable / none), the user corrects.

