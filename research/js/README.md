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

## How to run

    cd research/js
    npm install
    node test_rectmorph.js
    node run_printed_area.js scan1.jpg scan2.jpg ...      # prints box and times per scan

The scans themselves are never committed (they stay on the owner's computer).
