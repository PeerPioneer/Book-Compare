# Roadmap and open questions (status 5 November 2026)

## Standing rules (from the project owner)
- Never change the original scan folders (`Diss_Pdfs`, `Liber selectarum cantionum. Digitalisate`,
  `Melopoiae. Digitalisate. Originale`): read-only, work on copies.
- Removing a copy from a project must never delete scan files.
- The copy-name field in the app stays empty (no pre-fill).
- Pages are not placed by numbers in file names (file names are inconsistent).
- No annotations in the two-image app; annotations only in the whole-book workspace.
- No scan images in this public repository.

## Long-term goals
1. other alignment methods  2. type comparison (Agata & Agata 2022)  3. whole-book upload with a page navigator
4. batch alignment saved to a file  5. OCR (very low priority)  6. other visualization modes (e.g. offset arrows, only after
alignment is settled)  7. host Book Compare on a website (browser-based)  8. a "cool" look (surface changes only)

## Next
1. **Speed tests**: a timing page for an ordinary PC and a JavaScript benchmark. This decides whether the tile method is feasible in the browser.
2. Rewrite printed-area detection, ink map, rough and tile alignment in JavaScript (the app has no OpenCV).
3. Printed-area UI: automatic outline, draggable edges/corners, "back to automatic", remembered per scan, split double-page spreads.
4. Robust rough alignment (D-W title page); examine F-Pm, A-Wn, D-ARk, D-SHk.
5. Two switchable views of a registered pair: tile-based and smooth-only.
6. Whole-book workspace: **first real version built** (`app/js/workspace.js`): real folders, thumbnails, manual page placement, project saving in a separate folder, hand-over of a pair to the Compare tab.
   Next for the workspace: automatic page matching ("Suggest matches", see FINDINGS section 7: ~99 % on Melopoiae, works on Liber scans; still to do: banded/faster version,
   confidence + blank-page handling, JavaScript port, multi-copy matching), then flags/annotations, book map, saving batch alignment.
   **Compare tab, first version built (6 November 2026)** (`app/js/compare-tab.js`): left panel (copies, page list, search), tabs Compare/Pages, previous/next page and keys, automatic alignment with the app's existing engine (one pair at a time, on the main thread). **Flags and book map added (6 November 2026)**: flag per page (six colours, key F, filter in the page list, saved in the project), book map along the bottom edge with hover picture, jump and pin. **Annotations added (6 November 2026)** (`app/js/compare-annot.js`): circle, rectangle, text note, six colours, comment card, shown on all three pictures, belong to the page and are saved in the project; not yet in exported pictures. **Focus mode added (6 November 2026)**: one button hides everything except the pictures, keys keep working, Esc leaves. Still missing from the approved mock-up: prepared/saved alignments ("Prepare whole book"), "next to check", quality dots, "All copies" chips.
   **Speed test built (6 November 2026)** (More > Measure speed on this computer, `app/js/speedtest.js`). First numbers on a test machine (2 CPU threads, headless Chromium, real f.4r scans of 3 to 20 megapixels, the alignment types of today): finding the alignment takes about 1.5-2 s per pair *whatever the size of the scans* (the engine seems to work on a fixed reduced size), drawing about 0.1-0.5 s, except thin plate spline drawing 9-15 s; reading and decoding a scan 0.1 s (3 MP) to about 1.5 s (15 MP). A 70-megapixel double-page scan (SK-Mmf) could not be opened by the browser there at all. So a whole book against one reference copy is of the order of 2-3 s x pages x copies (544 x 19 = about 10,000 pairs = roughly 6-8 hours on that machine), all of it freezing the page unless the engine moves to a background worker. The real numbers on Torge's PC are still to be measured with the button. The tile method is not in the app yet, so it is not covered.

## Still open
- saving batch alignment to a file; licences (the new folders have **no licence chosen yet**; the app itself is BSD 2-Clause, VGG);
  collaborator access for jeschkies; the approved start-screen UX recommendations; blind-search row scoring for f.4r;
  consensus / common-frame experiment (f.4r, f.158v); the hover pencil / "Rename row" hint on the mock-up.
