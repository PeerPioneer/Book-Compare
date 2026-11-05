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
6. Connect the whole-book workspace (`../prototypes/whole-book-workspace/`) to real folders: project saving, then automatic page matching.
   Page matching is researched (see FINDINGS section 7: ~99 % on Melopoiae, works on Liber scans); still to do: banded/faster version,
   confidence + blank-page handling, JavaScript port, multi-copy matching.

## Still open
- saving batch alignment to a file; licences (the new folders have **no licence chosen yet**; the app itself is BSD 2-Clause, VGG);
  collaborator access for jeschkies; the approved start-screen UX recommendations; blind-search row scoring for f.4r;
  consensus / common-frame experiment (f.4r, f.158v); the hover pencil / "Rename row" hint on the mock-up.
