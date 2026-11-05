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
